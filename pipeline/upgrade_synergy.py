import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

synergy_fn = '''function buildTeammateSynergyCard(pid, playerName, allOffShots, allOffFts, allOffTovs, allOffPoss) {
  if (!pid || !_shotData?.players) return '';

  // Filter to offensive possessions where this player is ON the court
  const pPoss = allOffPoss.filter(p => (p.on || []).includes(pid));
  const pShots = allOffShots.filter(s => s.pid === pid);
  const pFts = allOffFts.filter(f => f.pid === pid);
  const pTovs = allOffTovs.filter(t => t.pid === pid);

  if (pPoss.length < 75) return '';

  const calcStats = (hasMate, mateId) => {
    const fPoss = pPoss.filter(p => hasMate ? (p.on || []).includes(mateId) : !(p.on || []).includes(mateId));
    const possCnt = fPoss.length;
    if (!possCnt) return null;

    const fS = pShots.filter(s => hasMate ? (s.on || []).includes(mateId) : !(s.on || []).includes(mateId));
    const fF = pFts.filter(f => hasMate ? (f.on || []).includes(mateId) : !(f.on || []).includes(mateId));
    const fT = pTovs.filter(t => hasMate ? (t.on || []).includes(mateId) : !(t.on || []).includes(mateId));

    const fga = fS.length;
    const fgm = fS.reduce((a, s) => a + s.made, 0);
    const fg3m = fS.filter(s => s.val === 3 && s.made === 1).length;
    const pts = fS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + fF.reduce((a, x) => a + x.made, 0);
    const fta = fF.length;

    const efg = fga > 0 ? ((fgm + 0.5 * fg3m) / fga) * 100 : 0;
    const tsDenom = 2 * (fga + 0.44 * fta);
    const ts = tsDenom > 0 ? (pts / tsDenom) * 100 : 0;

    return {
      poss: possCnt,
      pts75: (pts / possCnt) * 75,
      fga75: (fga / possCnt) * 75,
      tov75: (fT.length / possCnt) * 75,
      efg,
      ts,
    };
  };

  const rows = [];
  (_shotData.players || []).forEach(mate => {
    if (mate.id === pid) return;
    const w = calcStats(true, mate.id);
    const wo = calcStats(false, mate.id);
    if (!w || !wo || w.poss < 75 || wo.poss < 50) return;

    const efgDiff = w.efg - wo.efg;
    const tsDiff = w.ts - wo.ts;
    const ptsDiff = w.pts75 - wo.pts75;
    const shortMate = mate.name.split(' ').slice(-1).shift() || mate.name;

    const fmtDiff = (d) => {
      const col = d >= 2.5 ? 'var(--green)' : (d <= -2.5 ? 'var(--red)' : 'var(--dim)');
      return `<span style="color:${col};font-weight:700;">${d >= 0 ? '+' : ''}${d.toFixed(1)}%</span>`;
    };

    rows.push({
      poss: w.poss,
      html: `<tr>
        <td style="padding:2px 5px;border-bottom:1px solid var(--border);font-weight:600;">w/ ${shortMate}</td>
        <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${w.poss}</td>
        <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${w.pts75.toFixed(1)} <span style="font-size:9px;color:var(--muted);">(${ptsDiff >= 0 ? '+' : ''}${ptsDiff.toFixed(1)})</span></td>
        <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${w.fga75.toFixed(1)}</td>
        <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${w.efg.toFixed(1)}%</td>
        <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${fmtDiff(efgDiff)}</td>
        <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${w.ts.toFixed(1)}%</td>
        <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${fmtDiff(tsDiff)}</td>
      </tr>`
    });
  });

  if (!rows.length) return '';
  rows.sort((a, b) => b.poss - a.poss);

  return `
    <div class="sc-card" style="grid-column:1 / -1;">
      <div class="sc-card-title" style="font-size:13px;">Teammate Synergy &amp; Per-75 Possession Splits — ${playerName}</div>
      <div class="sc-card-sub">Individual scoring volume &amp; shooting efficiency when sharing the floor WITH vs. WITHOUT each teammate (min 75 shared poss)</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
          <thead>
            <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
              <th style="padding:2px 5px;text-align:left;border-bottom:1px solid var(--border);">Teammate</th>
              <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">Shared Poss</th>
              <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">PTS/75 (vs Off)</th>
              <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">FGA/75</th>
              <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG% With</th>
              <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG% Diff</th>
              <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">TS% With</th>
              <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">TS% Diff</th>
            </tr>
          </thead>
          <tbody>${rows.map(r => r.html).join('')}</tbody>
        </table>
      </div>
    </div>`;
}
'''

js = synergy_fn + "\n" + js

# Auto-sync Mode dropdown between Team and Individual
js = js.replace(
    "const sel = document.getElementById('scPlayer');\n  if (sel && (_onSet.size > 0 || _offSet.size > 0)) sel.value = 'ALL';",
    "const sel = document.getElementById('scPlayer');\n  if (sel && (_onSet.size > 0 || _offSet.size > 0)) sel.value = 'ALL';\n  const mSel = document.getElementById('scMode');\n  if (mSel) mSel.value = 'team';"
)
js = js.replace(
    "function onShooterSelect() {\n  _onSet.clear();\n  _offSet.clear();",
    "function onShooterSelect() {\n  _onSet.clear();\n  _offSet.clear();\n  const mSel = document.getElementById('scMode');\n  const pSel = document.getElementById('scPlayer');\n  if (mSel && pSel) mSel.value = (pSel.value === 'ALL') ? 'team' : 'ind';"
)

# Simplify renderShotPage condition to Team vs Individual
js = js.replace(
    "if (hasToggles || mode === 'team_off' || mode === 'team_def' || (mode === 'auto' && pid === null)) {",
    "if (mode === 'team' || hasToggles || pid === null) {"
)

# Include Teammate Synergy & Per-75 Possession Splits card in Individual view
old_ind_grid = '''  grid.innerHTML =
    buildCourtCard(playerName, sub, view, baseMode, false, subFts, subTovs, subPossCount) +
    `<div class="sc-stack">${tovHtml}${extraHtml}${insHtml}</div>`;'''

new_ind_grid = '''  const synHtml = buildTeammateSynergyCard(
    pid, playerName,
    allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off')
  );
  grid.innerHTML =
    buildCourtCard(playerName, sub, view, baseMode, false, subFts, subTovs, subPossCount) +
    `<div class="sc-stack">${tovHtml}${extraHtml}${insHtml}</div>` +
    synHtml;'''

js = js.replace(old_ind_grid, new_ind_grid)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

print("Added Teammate Synergy (Per 75 Possessions) & simplified Mode to Team/Individual (v=62)!")
