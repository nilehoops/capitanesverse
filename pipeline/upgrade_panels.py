import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

player_extra_fn = '''function buildPlayerExtraCards(pid, playerName, playerShots, allOffShots, allOffFts, allOffTovs, allOffPoss, allDefShots, allDefFts, allDefTovs, allDefPoss) {
  if (!pid) return '';

  const calcSplit = (isOn) => {
    const f = (arr) => arr.filter(x => isOn ? (x.on || []).includes(pid) : !(x.on || []).includes(pid));
    const oS = f(allOffShots), oF = f(allOffFts), oT = f(allOffTovs), oP = f(allOffPoss);
    const dS = f(allDefShots), dF = f(allDefFts), dT = f(allDefTovs), dP = f(allDefPoss);

    const oPoss = oP.length || 1, dPoss = dP.length || 1;
    const oPts = oS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + oF.reduce((a, x) => a + x.made, 0);
    const dPts = dS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + dF.reduce((a, x) => a + x.made, 0);
    const oRtg = (oPts / oPoss) * 100, dRtg = (dPts / dPoss) * 100;

    const oFgm = oS.reduce((a, s) => a + s.made, 0);
    const o3m = oS.filter(s => s.val === 3 && s.made === 1).length;
    const oEfg = oS.length ? ((oFgm + 0.5 * o3m) / oS.length) * 100 : 0;
    const oTov = (oT.length / oPoss) * 100;
    const oOreb = oP.reduce((a, p) => a + (p.oreb || 0), 0);
    const dDreb = dP.reduce((a, p) => a + (p.dreb || 0), 0);
    const oOrebPct = (oOreb + dDreb) > 0 ? (oOreb / (oOreb + dDreb)) * 100 : 0;
    const oFtr = oS.length ? (oF.length / oS.length) * 100 : 0;

    return { poss: oP.length, oRtg, dRtg, net: oRtg - dRtg, efg: oEfg, tov: oTov, oreb: oOrebPct, ftr: oFtr };
  };

  const onM = calcSplit(true);
  const offM = calcSplit(false);
  const netDiff = onM.net - offM.net;
  const diffCol = netDiff >= 0 ? 'var(--green)' : 'var(--red)';

  const buckets = [
    { name: 'Rim / Layups / Dunks', fn: s => /(layup|dunk|tip|alley)/i.test(s.sub || '') },
    { name: 'Catch & Shoot Jumpers', fn: s => /jump/i.test(s.sub || '') && !/pullup|step back|turnaround|fadeaway/i.test(s.sub || '') },
    { name: 'Pullup / Step-Back', fn: s => /(pullup|step back|fadeaway)/i.test(s.sub || '') },
    { name: 'Floaters / Hooks / Post', fn: s => /(floating|hook|bank|turnaround)/i.test(s.sub || '') },
  ];
  const totFga = playerShots.length || 1;
  const shotRows = buckets.map(b => {
    const sub = playerShots.filter(b.fn);
    const fga = sub.length;
    const fgm = sub.reduce((a, s) => a + s.made, 0);
    const fg3m = sub.filter(s => s.val === 3 && s.made === 1).length;
    const fgPct = fga ? ((fgm / fga) * 100).toFixed(1) : '—';
    const efgPct = fga ? (((fgm + 0.5 * fg3m) / fga) * 100).toFixed(1) : '—';
    const share = ((fga / totFga) * 100).toFixed(1);
    return `<tr>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);font-weight:600;">${b.name}</td>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${fgm}-${fga}</td>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${fgPct}${fga ? '%' : ''}</td>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${efgPct}${fga ? '%' : ''}</td>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${share}%</td>
    </tr>`;
  }).join('');
  return `
    <div class="sc-card">
      <div class="sc-card-title" style="font-size:13px;">Team On/Off Impact — ${playerName}</div>
      <div class="sc-card-sub">
        Net Swing: <span style="color:${diffCol};font-weight:700;">${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)} pts/100</span>
        (${onM.poss.toLocaleString()} ON Poss vs. ${offM.poss.toLocaleString()} OFF Poss)
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <thead>
          <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
            <th style="padding:2px 5px;text-align:left;border-bottom:1px solid var(--border);">Split</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">OffRtg</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">DefRtg</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">NetRtg</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG%</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">TOV%</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">OREB%</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">FTr</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);font-weight:700;color:var(--green);">ON Court</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.oRtg.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.dRtg.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${onM.net >= 0 ? '+' : ''}${onM.net.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.efg.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.tov.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.oreb.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.ftr.toFixed(1)}%</td>
          </tr>
          <tr>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);font-weight:700;color:var(--red);">OFF Court</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.oRtg.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.dRtg.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${offM.net >= 0 ? '+' : ''}${offM.net.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.efg.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.tov.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.oreb.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.ftr.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="sc-card">
      <div class="sc-card-title" style="font-size:13px;">Shot Creation Breakdown — ${playerName}</div>
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-top:4px;">
        <thead>
          <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
            <th style="padding:2px 5px;text-align:left;border-bottom:1px solid var(--border);">Shot Type</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">FGM-FGA</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">FG%</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG%</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">Share%</th>
          </tr>
        </thead>
        <tbody>${shotRows}</tbody>
      </table>
    </div>`;
}
'''

js = player_extra_fn + "\n" + js

old_dual_grid = '''      grid.innerHTML =
        buildCourtCard(`Capitanes Offense`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +
        buildCourtCard(`Capitanes Defense`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +
        macroHtml +
        dTov +
        (dIns ? dIns : '') +
        (dDelta ? dDelta : '');'''

new_dual_grid = '''      const leftBottomStack = `<div class="sc-stack">${macroHtml}${dTov}${dIns ? dIns : ''}</div>`;
      grid.innerHTML =
        buildCourtCard(`Capitanes Offense`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +
        buildCourtCard(`Capitanes Defense`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +
        (dDelta ? leftBottomStack + dDelta : macroHtml + dTov);'''

js = js.replace(old_dual_grid, new_dual_grid)

old_ind_block = '''  const insHtml = buildInsightsBox(playerName, sub, null, filteredBase.filter(s => s.side === 'off'), null, false);
  const tovHtml = buildTurnoverCard(playerName, baseTovs.filter(t => t.side === 'off'), baseTovs.filter(t => t.side === 'def'), pid !== null, pid, sub, subFts);
  grid.innerHTML =
    buildCourtCard(playerName, sub, view, baseMode, false, subFts, subTovs, subPossCount) +
    `<div class="sc-stack">${insHtml}${tovHtml}</div>`;'''

new_ind_block = '''  const allOff = filteredBase.filter(s => s.side === 'off');
  const allDef = filteredBase.filter(s => s.side === 'def');
  const insHtml = buildInsightsBox(playerName, sub, null, allOff, null, false);
  const tovHtml = buildTurnoverCard(playerName, baseTovs.filter(t => t.side === 'off'), baseTovs.filter(t => t.side === 'def'), pid !== null, pid, sub, subFts);
  const extraHtml = buildPlayerExtraCards(
    pid, playerName, sub,
    allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'),
    allDef, baseFts.filter(f => f.side === 'def'), baseTovs.filter(t => t.side === 'def'), basePoss.filter(p => p.side === 'def')
  );
  grid.innerHTML =
    buildCourtCard(playerName, sub, view, baseMode, false, subFts, subTovs, subPossCount) +
    `<div class="sc-stack">${tovHtml}${extraHtml}${insHtml}</div>`;'''

js = js.replace(old_ind_block, new_ind_block)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=53', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Balanced ON/OFF bottom row and enriched Individual Player profiles (v=53)!")
