with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# 1. Upgrade SVG label legibility (larger fonts + contrast halo + compact Corner 3 labels)
old_lbl = '''      labelsSvg += `
        <g transform="translate(${cfg.lx}, ${cfg.ly})" pointer-events="none">
          <text x="0" y="-4" text-anchor="middle" font-family="Oswald, sans-serif" font-size="11" font-weight="700" fill="${text}">${pctLabel}</text>
          <text x="0" y="7" text-anchor="middle" font-family="Lora, serif" font-size="8" font-weight="600" fill="${text}">${g.fgm}/${g.fga} (${shareNum.toFixed(0)}%)</text>
        </g>`;'''

new_lbl = '''      const halo = text === '#FFFFFF' ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
      const isCorner = z.includes('Corner');
      const subTxt = isCorner ? `${shareNum.toFixed(0)}% sh` : `${g.fgm}/${g.fga} (${shareNum.toFixed(0)}%)`;
      labelsSvg += `
        <g transform="translate(${cfg.lx}, ${cfg.ly})" pointer-events="none">
          <text class="sc-svg-lbl" stroke="${halo}" x="0" y="-4" text-anchor="middle" font-family="Oswald, sans-serif" font-size="${isCorner ? 13 : 16}" font-weight="700" fill="${text}">${pctLabel}</text>
          <text class="sc-svg-lbl" stroke="${halo}" x="0" y="9" text-anchor="middle" font-family="Oswald, sans-serif" font-size="${isCorner ? 9.5 : 11}" font-weight="600" fill="${text}">${subTxt}</text>
        </g>`;'''

js = js.replace(old_lbl, new_lbl)

# 2. Ensure header metrics uses 2PM-2PA, 2PT%, 2PT TS%, 3PM-3PA, 3PT%, 3PT TS%, FTr, 3PAr, TOV%
js = js.replace(
'''        FGM-FGA: <span style="color:var(--blue);">${totalFgm}-${totalFga}</span> (${fgPct}%) &nbsp;·&nbsp;
        eFG%: <span style="color:var(--blue);">${efgPct}%</span> &nbsp;·&nbsp;
        PPS: <span style="color:var(--blue);">${pps}</span> &nbsp;·&nbsp;
        3PAr: <span style="color:var(--blue);">${threePar}%</span>''',
'''        ${computeHeaderMetrics(shots, subFts, subTovs, exactPossCount)}'''
)
js = js.replace(
    'function buildCourtCard(title, shots, view, baseMode, isDef, subFts, subTovs) {',
    'function buildCourtCard(title, shots, view, baseMode, isDef, subFts, subTovs, exactPossCount) {'
)

# 3. Make buildInsightsBox fire for 2-5 man lineups (min 4 FGA when hasToggles is true)
js = js.replace('.filter(([, g]) => g.fga >= 10)', '.filter(([, g]) => g.fga >= (hasToggles ? 4 : 10))')
js = js.replace('if (offTot >= 25 && midRate >= 24)', 'if (offTot >= (hasToggles ? 12 : 25) && midRate >= 24)')
js = js.replace('else if (offTot >= 25 && rim3Rate >= 78)', 'else if (offTot >= (hasToggles ? 12 : 25) && rim3Rate >= 78)')

# 4. Pack cards into balanced 2-column grid (zero wasted half-screen)
old_ind_render = '''  grid.innerHTML =
    buildInsightsBox(playerName, sub, null, filteredBase.filter(s => s.side === 'off'), null, false) +
    buildCourtCard(playerName, sub, view, baseMode, false, subFts, subTovs, subPossCount) +
    buildTurnoverCard(playerName, baseTovs.filter(t => t.side === 'off'), baseTovs.filter(t => t.side === 'def'), pid !== null, pid);'''

new_ind_render = '''  const insHtml = buildInsightsBox(playerName, sub, null, filteredBase.filter(s => s.side === 'off'), null, false);
  const tovHtml = buildTurnoverCard(playerName, baseTovs.filter(t => t.side === 'off'), baseTovs.filter(t => t.side === 'def'), pid !== null, pid);
  grid.innerHTML =
    buildCourtCard(playerName, sub, view, baseMode, false, subFts, subTovs, subPossCount) +
    `<div class="sc-stack">${insHtml}${tovHtml}</div>`;'''

js = js.replace(old_ind_render, new_ind_render)

old_dual_render = '''      grid.innerHTML =
        buildCourtCard(`Capitanes Offense (${tag})`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +
        buildCourtCard(`Opponent Defense (${tag})`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +
        buildInsightsBox(tag, offShots, defShots, allOff, allDef, hasToggles) +
        (hasToggles ? buildOnOffDeltaCard(tag, offShots, allOff, defShots, allDef) : '') +
        buildTurnoverCard(tag, offTovs, defTovs, false, null);'''

new_dual_render = '''      const dIns = buildInsightsBox(tag, offShots, defShots, allOff, allDef, hasToggles);
      const dTov = buildTurnoverCard(tag, offTovs, defTovs, false, null);
      const dDelta = hasToggles ? buildOnOffDeltaCard(tag, offShots, allOff, defShots, allDef) : '';
      grid.innerHTML =
        buildCourtCard(`Capitanes Offense (${tag})`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +
        buildCourtCard(`Opponent Defense (${tag})`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +
        (dDelta ? dDelta : '') +
        ((dIns || dTov) ? `<div class="sc-stack">${dIns}${dTov}</div>` : '');'''

js = js.replace(old_dual_render, new_dual_render)
js = js.replace('style="grid-column:1 / -1;"', '')

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

print("Upgraded legibility, 2-column viewport packing, and lineup insights!")
