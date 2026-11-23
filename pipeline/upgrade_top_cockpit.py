import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# 1. Add Quick Split pill state & handlers
pill_js = '''const _quickSplits = { seg: 'ALL', loc: 'ALL', wl: 'ALL', per: 'ALL' };

function toggleQuickPill(btn) {
  const grp = btn.dataset.grp;
  const val = btn.dataset.val;
  if (_quickSplits[grp] === val) {
    _quickSplits[grp] = 'ALL';
    btn.classList.remove('active');
  } else {
    document.querySelectorAll(`.sc-pill[data-grp="${grp}"]`).forEach(el => el.classList.remove('active'));
    _quickSplits[grp] = val;
    btn.classList.add('active');
  }
  renderShotPage();
}
'''

js = pill_js + "\n" + js

# 2. Update resetAllFilters to clear pills too
js = js.replace(
    "['scSegment','scLocation','scOutcome','scLastN','scPeriod','scShotType'].forEach(id => {\n    const el = document.getElementById(id);\n    if (el) el.value = 'ALL';\n  });",
    "_quickSplits.seg = 'ALL'; _quickSplits.loc = 'ALL'; _quickSplits.wl = 'ALL'; _quickSplits.per = 'ALL';\n  document.querySelectorAll('.sc-pill').forEach(el => el.classList.remove('active'));\n  ['scLastN','scShotType'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 'ALL'; });"
)

# 3. Read segVal, locVal, outVal, periodVal from _quickSplits instead of removed dropdowns
js = js.replace("const segVal = document.getElementById('scSegment')?.value || 'ALL';", "const segVal = _quickSplits.seg;")
js = js.replace("const locVal = document.getElementById('scLocation')?.value || 'ALL';", "const locVal = _quickSplits.loc;")
js = js.replace("const outVal = document.getElementById('scOutcome')?.value || 'ALL';", "const outVal = _quickSplits.wl;")
js = js.replace("const periodVal = document.getElementById('scPeriod')?.value || 'ALL';", "const periodVal = _quickSplits.per;")

# 4. Format buildMacroStrip specifically for the compact top-right #scTopMacro box
top_macro_fn = '''function renderTopMacro(label, offShots, defShots, offFts, defFts, offTovs, defTovs, offPoss, defPoss, allOffShots, allOffFts, allOffTovs, allOffPoss, allDefShots, allDefFts, allDefTovs, allDefPoss, hasToggles) {
  const box = document.getElementById('scTopMacro');
  if (!box) return;
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
  const netDiff = net - (tmO.rtg - tmD.rtg);

  const netCol = net >= 0 ? 'var(--green)' : 'var(--red)';
  const diffCol = netDiff >= 0 ? 'var(--green)' : 'var(--red)';
  const diffTag = hasToggles ? ` <span style="font-size:10px;color:${diffCol};">(${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)} vs Team)</span>` : '';

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-family:'Oswald',sans-serif;">
      <div style="font-size:14px;font-weight:700;">
        OffRtg: <span style="color:var(--blue);">${o.rtg.toFixed(1)}</span> &nbsp;
        DefRtg: <span style="color:var(--blue);">${d.rtg.toFixed(1)}</span> &nbsp;
        NetRtg: <span style="color:${netCol};">${net >= 0 ? '+' : ''}${net.toFixed(1)}</span>${diffTag}
      </div>
      <div style="font-size:9.5px;color:var(--muted);">${o.poss.toLocaleString()} Off / ${d.poss.toLocaleString()} Def Poss</div>
    </div>
    <div style="font-size:10px;color:var(--text);margin-top:3px;line-height:1.3;">
      <div><b style="color:var(--blue);">Capitanes:</b> eFG <b>${o.efg.toFixed(1)}%</b> · TOV <b>${o.tov.toFixed(1)}%</b> · OREB <b>${o.oreb.toFixed(1)}%</b> · FTr <b>${o.ftr.toFixed(1)}%</b></div>
      <div><b style="color:var(--dim);">Opponents:</b> eFG <b>${d.efg.toFixed(1)}%</b> · TOV <b>${d.tov.toFixed(1)}%</b> · OREB <b>${d.oreb.toFixed(1)}%</b> · FTr <b>${d.ftr.toFixed(1)}%</b></div>
    </div>`;
}
'''

js = top_macro_fn + "\n" + js

# 5. Call renderTopMacro on every renderShotPage() run and remove macroHtml from the bottom grid
js = js.replace("const macroHtml = buildMacroStrip(", "renderTopMacro(")
js = js.replace("const leftBottomStack = `<div class=\"sc-stack\">${macroHtml}${dTov}${dIns ? dIns : ''}</div>`;", "const leftBottomStack = `<div class=\"sc-stack\">${dTov}${dIns ? dIns : ''}</div>`;")
js = js.replace("(dDelta ? leftBottomStack + dDelta : macroHtml + dTov)", "(dDelta ? leftBottomStack + dDelta : dTov + (dIns ? dIns : ''))")

# Also populate #scTopMacro when viewing an Individual Player
ind_macro_call = '''  renderTopMacro(
    playerName, allOff, allDef,
    baseFts.filter(f => f.side === 'off'), baseFts.filter(f => f.side === 'def'),
    baseTovs.filter(t => t.side === 'off'), baseTovs.filter(t => t.side === 'def'),
    basePoss.filter(p => p.side === 'off'), basePoss.filter(p => p.side === 'def'),
    allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'),
    allDef, baseFts.filter(f => f.side === 'def'), baseTovs.filter(t => t.side === 'def'), basePoss.filter(p => p.side === 'def'),
    false
  );
  const insHtml = buildInsightsBox('''

js = js.replace("  const insHtml = buildInsightsBox(", ind_macro_call, 1)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

print("Upgraded top bar to 4-column cockpit with Quick Split pills and Top-Right Macro Summary (v=60)!")
