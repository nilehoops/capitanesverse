import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# 1. Simplify Insights card title to "Insights"
js = re.sub(r'<div class="sc-card-title" style="font-size:13px;">Scouting Insights &amp; Points of Emphasis — \$\{label\}</div>',
            '<div class="sc-card-title" style="font-size:13px;">Insights</div>', js)

# 2. Add big teammate synergy differences into buildInsightsBox when viewing an individual player
syn_insights_helper = '''function buildPlayerInsights(pid, playerName, playerShots, allOffShots, allOffFts, allOffTovs, allOffPoss) {
  const bullets = [];
  if (!pid || !_shotData?.players) return '';

  const pPoss = allOffPoss.filter(p => (p.on || []).includes(pid));
  const pShots = allOffShots.filter(s => s.pid === pid);
  if (pPoss.length < 150) return '';

  const calc = (hasMate, mateId) => {
    const chk = (x) => hasMate ? (x.on || []).includes(mateId) : !(x.on || []).includes(mateId);
    const fP = pPoss.filter(chk);
    if (!fP.length) return null;
    const fS = pShots.filter(chk);
    const fF = allOffFts.filter(f => f.pid === pid && chk(f));
    const fga = fS.length || 1;
    const fgm = fS.reduce((a, s) => a + s.made, 0);
    const fg3m = fS.filter(s => s.val === 3 && s.made === 1).length;
    const pts = fS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + fF.reduce((a, x) => a + x.made, 0);
    const rimSh = (fS.filter(s => s.val === 2 && s.dist <= 4).length / fga) * 100;
    const thrSh = (fS.filter(s => s.val === 3).length / fga) * 100;
    return {
      poss: fP.length,
      pts75: (pts / fP.length) * 75,
      efg: fS.length ? ((fgm + 0.5 * fg3m) / fS.length) * 100 : 0,
      rimSh,
      thrSh
    };
  };

  const efgSwings = [];
  const ptsSwings = [];
  const dietSwings = [];

  (_shotData.players || []).forEach(mate => {
    if (mate.id === pid) return;
    const w = calc(true, mate.id);
    const wo = calc(false, mate.id);
    if (!w || !wo || w.poss < 150 || wo.poss < 100) return;

    const name = getCleanLastName(mate.name);
    const efgD = w.efg - wo.efg;
    const ptsD = w.pts75 - wo.pts75;
    const rimD = w.rimSh - wo.rimSh;
    const thrD = w.thrSh - wo.thrSh;

    if (Math.abs(efgD) >= 5.0) efgSwings.push({ name, poss: w.poss, val: w.efg, d: efgD });
    if (Math.abs(ptsD) >= 3.5) ptsSwings.push({ name, poss: w.poss, val: w.pts75, d: ptsD });
    if (Math.abs(rimD) >= 8.0) dietSwings.push({ name, poss: w.poss, zone: 'Rim', val: w.rimSh, d: rimD });
    if (Math.abs(thrD) >= 8.0) dietSwings.push({ name, poss: w.poss, zone: '3PT', val: w.thrSh, d: thrD });
  });

  efgSwings.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2).forEach(x => {
    const col = x.d > 0 ? 'var(--green)' : 'var(--red)';
    bullets.push(`<span style="color:${col};font-weight:700;">EFFICIENCY WITH ${x.name.toUpperCase()}:</span> Shoots <b>${x.val.toFixed(1)}% eFG</b> (<b>${x.d >= 0 ? '+' : ''}${x.d.toFixed(1)}%</b> vs. off) across ${x.poss} poss.`);
  });

  ptsSwings.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2).forEach(x => {
    const col = x.d > 0 ? 'var(--green)' : 'var(--red)';
    bullets.push(`<span style="color:${col};font-weight:700;">SCORING VOLUME WITH ${x.name.toUpperCase()}:</span> Averages <b>${x.val.toFixed(1)} PTS/75</b> (<b>${x.d >= 0 ? '+' : ''}${x.d.toFixed(1)}</b> vs. off).`);
  });

  dietSwings.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 1).forEach(x => {
    bullets.push(`<span style="color:var(--blue);font-weight:700;">SHOT DIET SHIFT WITH ${x.name.toUpperCase()}:</span> <b>${x.zone}</b> attempt share shifts to <b>${x.val.toFixed(0)}%</b> (<b>${x.d >= 0 ? '+' : ''}${x.d.toFixed(0)}%</b> vs. off).`);
  });

  if (!bullets.length) return '';
  return `
    <div class="sc-card" style="border-left:4px solid var(--blue);background:var(--surface);">
      <div class="sc-card-title" style="font-size:13px;">Insights</div>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:11px;line-height:1.45;color:var(--text);">
        ${bullets.map(b => `<li style="margin-bottom:3px;">${b}</li>`).join('')}
      </ul>
    </div>`;
}
'''

js = syn_insights_helper + "\n" + js

# 3. Build Shot Type Breakdown table helper so it sits inside the left Shot Chart card
shot_type_table_fn = '''function buildShotTypeTableHtml(shots) {
  const buckets = [
    { name: 'Rim / Layups / Dunks', fn: s => /(layup|dunk|tip|alley)/i.test(s.sub || '') },
    { name: 'Catch & Shoot Jumpers', fn: s => /jump/i.test(s.sub || '') && !/pullup|step back|turnaround|fadeaway/i.test(s.sub || '') },
    { name: 'Pullup / Step-Back', fn: s => /(pullup|step back|fadeaway)/i.test(s.sub || '') },
    { name: 'Floaters / Hooks / Post', fn: s => /(floating|hook|bank|turnaround)/i.test(s.sub || '') },
  ];
  const totFga = shots.length || 1;
  const rows = buckets.map(b => {
    const sub = shots.filter(b.fn);
    const fga = sub.length;
    const fgm = sub.reduce((a, s) => a + s.made, 0);
    const fg3m = sub.filter(s => s.val === 3 && s.made === 1).length;
    const fgPct = fga ? ((fgm / fga) * 100).toFixed(1) : '—';
    const efgPct = fga ? (((fgm + 0.5 * fg3m) / fga) * 100).toFixed(1) : '—';
    const share = ((fga / totFga) * 100).toFixed(1);
    return `<tr>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);font-weight:600;">${b.name}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${fgm}-${fga}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${fgPct}${fga ? '%' : ''}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${efgPct}${fga ? '%' : ''}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${share}%</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border);">
      <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;color:var(--blue);margin-bottom:3px;">SHOT TYPE BREAKDOWN</div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead>
          <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
            <th style="padding:2px 4px;text-align:left;border-bottom:1px solid var(--border);">Shot Type</th>
            <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">FGM-FGA</th>
            <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">FG%</th>
            <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">eFG%</th>
            <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">Share%</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
'''

js = shot_type_table_fn + "\n" + js

# Place Shot Type Breakdown inside buildCourtCard directly below the 12-zone table
js = js.replace(
    '<tbody>${tableRows}</tbody></table></div></div></div>`;',
    '<tbody>${tableRows}</tbody></table>${buildShotTypeTableHtml(shots)}</div></div></div>`;'
)

# Remove duplicate Shot Creation Breakdown card from buildPlayerExtraCards
js = re.sub(
    r'<div class="sc-card">\s*<div class="sc-card-title" style="font-size:13px;">Shot Creation Breakdown.*?</table>\s*</div>',
    '',
    js,
    flags=re.S
)

# Use buildPlayerInsights + buildInsightsBox in Individual player view
js = js.replace(
    'const insHtml = buildInsightsBox(playerName, sub, null, allOff, null, false);',
    'const insHtml = buildPlayerInsights(pid, playerName, sub, allOff, baseFts.filter(f => f.side === \'off\'), baseTovs.filter(t => t.side === \'off\'), basePoss.filter(p => p.side === \'off\')) || buildInsightsBox(playerName, sub, null, allOff, null, false);'
)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=69', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Moved Shot Type Breakdown into Shot Chart card & upgraded Insights (v=69)!")
