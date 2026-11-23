import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# 1. Add multi-game include/exclude state + UI helpers right at top
game_picker_js = '''const _incGames = new Set();
const _excGames = new Set();

function toggleGameMenu(e) {
  e.stopPropagation();
  document.getElementById('scGameMenu')?.classList.toggle('open');
}
document.addEventListener('click', () => document.getElementById('scGameMenu')?.classList.remove('open'));

function toggleGameFilter(gid, mode) {
  if (mode === 'inc') {
    if (_incGames.has(gid)) _incGames.delete(gid);
    else { _excGames.delete(gid); _incGames.add(gid); }
  } else {
    if (_excGames.has(gid)) _excGames.delete(gid);
    else { _incGames.delete(gid); _excGames.add(gid); }
  }
  buildGameMenu();
  renderShotPage();
}

function clearGameFilters() {
  _incGames.clear();
  _excGames.clear();
  buildGameMenu();
  renderShotPage();
}

function resetAllFilters() {
  _incGames.clear();
  _excGames.clear();
  ['scSegment','scLocation','scOutcome','scLastN','scPeriod','scShotType'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'ALL';
  });
  buildGameMenu();
  renderShotPage();
}

function buildGameMenu() {
  const menu = document.getElementById('scGameMenu');
  const btn = document.getElementById('scGameBtn');
  if (!menu || !_shotData) return;
  const games = _shotData.games || [];

  if (btn) {
    if (_incGames.size > 0) btn.textContent = `Games: ${_incGames.size} selected ▾`;
    else if (_excGames.size > 0) btn.textContent = `Games: ${_excGames.size} excluded ▾`;
    else btn.textContent = `All Games (${games.length}) ▾`;
  }

  const head = `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 4px;border-bottom:1px solid var(--border);background:var(--surface);font-family:'Oswald',sans-serif;font-size:9px;">
    <span style="color:var(--muted);">✓ INCLUDE &nbsp;|&nbsp; ✕ EXCLUDE</span>
    <button onclick="clearGameFilters()" style="font-family:'Oswald',sans-serif;font-size:9px;padding:0 5px;border:1px solid var(--border);background:var(--bg);cursor:pointer;">Clear</button>
  </div>`;

  const rows = games.map(g => {
    const isInc = _incGames.has(g.id);
    const isExc = _excGames.has(g.id);
    return `<div class="sc-game-row">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${isExc ? 'var(--muted);text-decoration:line-through' : 'var(--text)'};" title="${g.label}">${g.label}</span>
      <div style="display:flex;gap:2px;flex-shrink:0;">
        <button class="sc-gbtn ${isInc ? 'inc-active' : ''}" onclick="toggleGameFilter('${g.id}','inc')">✓</button>
        <button class="sc-gbtn ${isExc ? 'exc-active' : ''}" onclick="toggleGameFilter('${g.id}','exc')">✕</button>
      </div>
    </div>`;
  }).join('');

  menu.innerHTML = head + rows;
}
'''

js = game_picker_js + "\n" + js

# 2. Wire buildGameMenu() inside loadShotSeason
old_gsel = re.search(r'    const gSel = document\.getElementById\(\'scGame\'\);.*?    \}', js, flags=re.S)
if old_gsel:
    js = js[:old_gsel.start()] + "    _incGames.clear();\n    _excGames.clear();\n    buildGameMenu();" + js[old_gsel.end():]

# 3. Update matchBaseFilters to support _incGames and _excGames
js = js.replace(
    "if (gameVal !== 'ALL' && item.gid !== gameVal) return false;",
    "if (_incGames.size > 0 && !_incGames.has(item.gid)) return false;\n  if (_excGames.has(item.gid)) return false;"
)

# 4. Clean up natural verbiage in buildMacroStrip (Summary · Label, hide +0.0 vs MXC when full team)
clean_macro = '''function buildMacroStrip(label, offShots, defShots, offFts, defFts, offTovs, defTovs, offPoss, defPoss, allOffShots, allOffFts, allOffTovs, allOffPoss, allDefShots, allDefFts, allDefTovs, allDefPoss, hasToggles) {
  const calc = (shots, fts, tovs, poss, oppPoss) => {
    const pCount = poss.length || 1;
    const fga = shots.length || 1;
    const fgm = shots.reduce((a, s) => a + s.made, 0);
    const fg3m = shots.filter(s => s.val === 3 && s.made === 1).length;
    const pts = shots.reduce((a, s) => a + (s.made ? s.val : 0), 0) + fts.reduce((a, f) => a + f.made, 0);
    const oreb = poss.reduce((a, p) => a + (p.oreb || 0), 0);
    const oppDreb = (oppPoss || []).reduce((a, p) => a + (p.dreb || 0), 0);
    const rebChances = Math.max(1, oreb + oppDreb);

    return {
      poss: poss.length,
      rtg: (pts / pCount) * 100,
      efg: ((fgm + 0.5 * fg3m) / fga) * 100,
      tov: (tovs.length / pCount) * 100,
      oreb: (oreb / rebChances) * 100,
      ftr: (fts.length / fga) * 100,
    };
  };

  const o = calc(offShots, offFts, offTovs, offPoss, defPoss);
  const d = calc(defShots, defFts, defTovs, defPoss, offPoss);
  const net = o.rtg - d.rtg;

  const tmO = calc(allOffShots, allOffFts, allOffTovs, allOffPoss, allDefPoss);
  const tmD = calc(allDefShots, allDefFts, allDefTovs, allDefPoss, allOffPoss);
  const tmNet = tmO.rtg - tmD.rtg;
  const netDiff = net - tmNet;

  const netCol = net >= 0 ? 'var(--green)' : 'var(--red)';
  const diffCol = netDiff >= 0 ? 'var(--green)' : 'var(--red)';
  const diffTag = hasToggles ? ` <span style="font-size:10px;color:${diffCol};">(${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)} vs Team)</span>` : '';

  return `
    <div class="sc-card" style="background:var(--surface);padding:6px 8px;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;font-size:11px;">
        <div>
          <span style="font-family:'Oswald',sans-serif;font-weight:700;color:var(--blue);font-size:12px;">Summary · ${label}</span>
          <span style="color:var(--muted);margin-left:6px;">${o.poss.toLocaleString()} Off / ${d.poss.toLocaleString()} Def Poss</span>
        </div>
        <div style="display:flex;gap:10px;font-family:'Oswald',sans-serif;font-size:12px;">
          <span>OffRtg: <b style="color:var(--blue);">${o.rtg.toFixed(1)}</b></span>
          <span>DefRtg: <b style="color:var(--blue);">${d.rtg.toFixed(1)}</b></span>
          <span>NetRtg: <b style="color:${netCol};">${net >= 0 ? '+' : ''}${net.toFixed(1)}</b>${diffTag}</span>
        </div>
      </div>
      <div style="font-size:10.5px;color:var(--text);margin-top:4px;padding-top:4px;border-top:1px solid var(--border);">
        <b style="color:var(--blue);">Capitanes:</b> eFG <b>${o.efg.toFixed(1)}%</b> · TOV <b>${o.tov.toFixed(1)}%</b> · OREB <b>${o.oreb.toFixed(1)}%</b> · FTr <b>${o.ftr.toFixed(1)}%</b>
        &nbsp;|&nbsp;
        <b style="color:var(--dim);">Opponents:</b> eFG <b>${d.efg.toFixed(1)}%</b> · TOV <b>${d.tov.toFixed(1)}%</b> · OREB <b>${d.oreb.toFixed(1)}%</b> · FTr <b>${d.ftr.toFixed(1)}%</b>
      </div>
    </div>`;
}'''

js = re.sub(r'function buildMacroStrip\(.*?\n\}', clean_macro, js, count=1, flags=re.S)

# 5. Clean up natural court titles, turnover title, and pass hasToggles to buildMacroStrip
js = js.replace("const tag = parts.length ? parts.join(' | ') : 'All Capitanes (Full Team)';", "const tag = parts.length ? parts.join(' | ') : 'All Capitanes';")
js = js.replace("`Capitanes Offense (${tag})`", "`Capitanes Offense`")
js = js.replace("`Opponent Defense (${tag})`", "`Opponent Defense`")
js = js.replace("Passing vs. Scoring Turnovers — ${label}", "Turnovers · ${label}")
js = js.replace("Passing vs. Scoring Turnovers (League-Relative) — ${label}", "Turnovers · ${label}")
js = js.replace("allDef, baseFts.filter(f => f.side === 'def'), baseTovs.filter(t => t.side === 'def'), basePoss.filter(p => p.side === 'def')\n    );", "allDef, baseFts.filter(f => f.side === 'def'), baseTovs.filter(t => t.side === 'def'), basePoss.filter(p => p.side === 'def'), hasToggles\n    );")

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

print("Cleaned verbiage, added ✓/✕ multi-game picker, and aligned dual courts on row 1 (v=50)!")
