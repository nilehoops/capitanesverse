import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

full_synergy = '''function buildTeammateSynergyCard(pid, playerName, allOffShots, allOffFts, allOffTovs, allOffPoss, baseEvents) {
  if (!pid || !_shotData?.players) return '';

  const pPoss = allOffPoss.filter(p => (p.on || []).includes(pid));
  const pShots = allOffShots.filter(s => s.pid === pid);
  const pFts = allOffFts.filter(f => f.pid === pid);
  const pTovs = allOffTovs.filter(t => t.pid === pid);
  const pEvs = (baseEvents || []).filter(e => e.pid === pid);

  if (pPoss.length < 75) return '';

  const calcStats = (hasMate, mateId) => {
    const chk = (x) => hasMate ? (x.on || []).includes(mateId) : !(x.on || []).includes(mateId);
    const fPoss = pPoss.filter(chk);
    const possCnt = fPoss.length;
    if (!possCnt) return null;

    const fS = pShots.filter(chk);
    const fF = pFts.filter(chk);
    const fT = pTovs.filter(chk);
    const fE = pEvs.filter(chk);

    const fga = fS.length;
    const fgm = fS.reduce((a, s) => a + s.made, 0);
    const astdM = fS.reduce((a, s) => a + (s.astd || 0), 0);
    const fg3m = fS.filter(s => s.val === 3 && s.made === 1).length;
    const pts = fS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + fF.reduce((a, x) => a + x.made, 0);
    const tsDenom = 2 * (fga + 0.44 * fF.length);

    // Shot diet (Rim <=4ft, Mid 2PT >4ft, 3PT)
    const rimS = fS.filter(s => s.val === 2 && s.dist <= 4);
    const midS = fS.filter(s => s.val === 2 && s.dist > 4);
    const thrS = fS.filter(s => s.val === 3);

    const rimSh = fga ? (rimS.length / fga) * 100 : 0;
    const midSh = fga ? (midS.length / fga) * 100 : 0;
    const thrSh = fga ? (thrS.length / fga) * 100 : 0;

    const rimFg = rimS.length ? (rimS.reduce((a, s) => a + s.made, 0) / rimS.length) * 100 : 0;
    const midFg = midS.length ? (midS.reduce((a, s) => a + s.made, 0) / midS.length) * 100 : 0;
    const thrFg = thrS.length ? (thrS.reduce((a, s) => a + s.made, 0) / thrS.length) * 100 : 0;

    // Turnover distribution (Pass vs Scoring)
    const passT = fT.filter(t => (t.sub || '').toLowerCase().includes('bad pass')).length;
    const passShare = fT.length ? (passT / fT.length) * 100 : 0;

    // Box counts per 75
    const reb = fE.filter(e => e.type === 'OREB' || e.type === 'DREB').length;
    const ast = fE.filter(e => e.type === 'AST').length;
    const stl = fE.filter(e => e.type === 'STL').length;
    const blk = fE.filter(e => e.type === 'BLK').length;
    const ftTrips = fF.filter(f => !f.and1 && f.val > 0).length / 2;
    const usg = ((fga + ftTrips + fT.length) / possCnt) * 100;

    return {
      poss: possCnt,
      pts75: (pts / possCnt) * 75,
      reb75: (reb / possCnt) * 75,
      ast75: (ast / possCnt) * 75,
      tov75: (fT.length / possCnt) * 75,
      stl75: (stl / possCnt) * 75,
      blk75: (blk / possCnt) * 75,
      usg,
      efg: fga ? ((fgm + 0.5 * fg3m) / fga) * 100 : 0,
      ts: tsDenom > 0 ? (pts / tsDenom) * 100 : 0,
      astdPct: fgm ? (astdM / fgm) * 100 : 0,
      rimSh, midSh, thrSh, rimFg, midFg, thrFg,
      passShare,
    };
  };

  const rows = [];
  (_shotData.players || []).forEach(mate => {
    if (mate.id === pid) return;
    const w = calcStats(true, mate.id);
    const wo = calcStats(false, mate.id);
    if (!w || !wo || w.poss < 75 || wo.poss < 50) return;

    const shortMate = mate.name.split(' ').slice(-1).shift() || mate.name;
    const tsDiff = w.ts - wo.ts;
    const passDiff = w.passShare - wo.passShare;
    const tsCol = tsDiff >= 2.5 ? 'var(--green)' : (tsDiff <= -2.5 ? 'var(--red)' : 'var(--dim)');

    rows.push({
      poss: w.poss,
      html: `<tr>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);font-weight:700;">w/ ${shortMate}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${w.poss}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${w.pts75.toFixed(1)}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.reb75.toFixed(1)}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.ast75.toFixed(1)}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.tov75.toFixed(1)}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.stl75.toFixed(1)}/${w.blk75.toFixed(1)}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.usg.toFixed(1)}%</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${w.ts.toFixed(1)}% <span style="color:${tsCol};">(${tsDiff >= 0 ? '+' : ''}${tsDiff.toFixed(1)})</span></td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.astdPct.toFixed(0)}%</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.rimSh.toFixed(0)}% (${w.rimFg.toFixed(0)}%)</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.midSh.toFixed(0)}% (${w.midFg.toFixed(0)}%)</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.thrSh.toFixed(0)}% (${w.thrFg.toFixed(0)}%)</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${w.passShare.toFixed(0)}% <span style="color:var(--muted);">(${passDiff >= 0 ? '+' : ''}${passDiff.toFixed(0)}%)</span></td>
      </tr>`
    });
  });

  if (!rows.length) return '';
  rows.sort((a, b) => b.poss - a.poss);

  return `
    <div class="sc-card" style="grid-column:1 / -1;">
      <div class="sc-card-title" style="font-size:13px;">Teammate Synergy &amp; Per-75 Production Splits — ${playerName}</div>
      <div class="sc-card-sub">Per-75 possession output, shooting diet (Share% &amp; FG%), assisted FGM%, and Passing TOV% shift when sharing the floor WITH vs. WITHOUT each teammate</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead>
            <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
              <th style="padding:2px 4px;text-align:left;border-bottom:1px solid var(--border);">Teammate</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">Poss</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">PTS/75</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">REB/75</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">AST/75</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">TOV/75</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">STL/BLK</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">USG%</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">TS% (vs Off)</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">%Ast'd</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">Rim (FG%)</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">Mid (FG%)</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">3PT (FG%)</th>
              <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">Pass TOV% (Diff)</th>
            </tr>
          </thead>
          <tbody>${rows.map(r => r.html).join('')}</tbody>
        </table>
      </div>
    </div>`;
}'''

js = re.sub(r'function buildTeammateSynergyCard\(.*?\n\}', full_synergy, js, count=1, flags=re.S)

# Filter baseEvents in renderShotPage and pass to buildTeammateSynergyCard
js = js.replace(
    "const basePoss = (_shotData.poss || []).filter(p => matchBaseFilters(p, gameVal, segVal, locVal, outVal, minOrder, periodVal));",
    "const basePoss = (_shotData.poss || []).filter(p => matchBaseFilters(p, gameVal, segVal, locVal, outVal, minOrder, periodVal));\n  const baseEvents = (_shotData.events || []).filter(e => matchBaseFilters(e, gameVal, segVal, locVal, outVal, minOrder, periodVal));"
)
js = js.replace(
    "buildTeammateSynergyCard(\n    pid, playerName,\n    allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off')\n  );",
    "buildTeammateSynergyCard(\n    pid, playerName,\n    allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'), baseEvents\n  );"
)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=65', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Upgraded Teammate Synergy with Per-75 REB/AST/TOV/STL/BLK, USG%, %Ast'd, Shot Diet & Turnover Shift (v=65)!")
