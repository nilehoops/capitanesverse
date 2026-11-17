with open("team.html", encoding="utf-8") as f:
    th = f.read()

old_tov = "if (o.tovPct >= 16.5) bullets.push(`<b>TURNOVER VULNERABILITY:</b> Commits turnovers on <b>${o.tovPct}%</b> of offensive possessions.`);"
new_tov = """const ord = (n) => { if (n == null) return ''; const s = new Array('th','st','nd','rd'), v = n % 100; return n + (s.slice((v - 20) % 10, (v - 20) % 10 + 1).pop() || s.slice(v, v + 1).pop() || 'th'); };
  if (o.tovPct != null) {
    const pctTxt = o.tovPctile != null ? ` (${ord(o.tovPctile)} percentile)` : '';
    const lbl = o.tovPct >= 16.5 ? 'TURNOVER VULNERABILITY:' : (o.tovPct <= 13.5 ? 'BALL SECURITY STRENGTH:' : 'BALL SECURITY:');
    bullets.push(`<b>${lbl}</b> Commits turnovers on <b>${o.tovPct}%</b> of offensive possessions${pctTxt}.`);
  }"""
th = th.replace(old_tov, new_tov)

lu_insights = """
  const luAll = active.lineups || {};
  const qual5 = (luAll.fiveman || new Array()).filter(x => x.poss >= 25);
  const qual3 = (luAll.trios || new Array()).filter(x => x.poss >= 45);
  const targetLu = qual5.length >= 2 ? qual5 : qual3;
  if (targetLu.length) {
    const bestLu = targetLu.slice().sort((a, b) => b.netRtg - a.netRtg).slice(0, 1).pop();
    const worstLu = targetLu.slice().sort((a, b) => a.netRtg - b.netRtg).slice(0, 1).pop();
    if (bestLu && bestLu.netRtg >= 5) bullets.push(`<span style="color:var(--green);font-weight:700;">LINEUP STRENGTH TO PLAN FOR:</span> <b>${bestLu.players}</b> (${bestLu.poss} poss) posts a <b>+${bestLu.netRtg} NetRtg</b> (${bestLu.ortg} ORtg / ${bestLu.drtg} DRtg).`);
    if (worstLu && worstLu.netRtg <= -5 && worstLu.players !== bestLu?.players) bullets.push(`<span style="color:var(--red);font-weight:700;">LINEUP WEAKNESS TO EXPLOIT:</span> <b>${worstLu.players}</b> (${worstLu.poss} poss) bleeds <b>${worstLu.netRtg} NetRtg</b> (${worstLu.ortg} ORtg / ${worstLu.drtg} DRtg).`);
  }
"""
th = th.replace("const roster = (active.rosterStats", lu_insights + "\n  const roster = (active.rosterStats")

lu_card = """
function buildFrequentLineupsCard(active) {
  const lu = active.lineups || {};
  const renderRows = (type) => {
    const list = (lu[type] || new Array()).slice(0, 3);
    if (!list.length) return '<tr><td colspan="6" style="padding:6px;color:var(--muted);">No lineup combinations logged yet for this group size.</td></tr>';
    return list.map((l, i) => `<tr><td style="padding:4px 6px;border-bottom:1px solid var(--border);font-weight:700;">#${i + 1} · ${l.players}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;">${l.min}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;">${l.poss}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;">${l.ortg}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;">${l.drtg}</td><td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:${l.netRtg >= 0 ? 'var(--green)' : 'var(--red)'};">${l.netRtg >= 0 ? '+' : ''}${l.netRtg}</td></tr>`).join('');
  };
  window._switchTeamLuType = (val) => { const tb = document.getElementById('tmFreqLuBody'); if (tb) tb.innerHTML = renderRows(val); };
  return `<div class="tm-card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><div class="tm-card-title" style="margin:0;">Most Frequent Lineups (Top 3 by Possessions)</div><select onchange="window._switchTeamLuType(this.value)" style="font-family:'Lora',serif;font-size:11px;padding:2px 6px;border:1px solid var(--border);"><option value="fiveman" selected>5-Man Units</option><option value="quads">Quads (4-Man)</option><option value="trios">Trios (3-Man)</option><option value="duos">Duos (2-Man)</option></select></div><table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;"><th style="padding:3px 6px;text-align:left;border-bottom:1px solid var(--border);">Lineup Combination</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">MIN</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">POSS</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">ORtg</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">DRtg</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">NetRtg</th></tr></thead><tbody id="tmFreqLuBody">${renderRows('fiveman')}</tbody></table></div>`;
}
"""
th = th.replace("function buildRotationsCard(active) {", lu_card + "\nfunction buildRotationsCard(active) {")
th = th.replace("buildRotationsCard(active) +", "buildFrequentLineupsCard(active) +\n    buildRotationsCard(active) +")
th = th.replace(">FG%</th>", ">2P%</th>")
th = th.replace(">TS%</th>", ">TS%</th><th style=\"padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);\">3PAr</th><th style=\"padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);\">FTr</th>")
th = th.replace("${p.fgPct ?? 0}%</td><td style=\"padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;\">${p.fg3Pct ?? 0}%</td><td style=\"padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;\">${p.tsPct ?? 0}%</td>", "${p.fg2Pct ?? 0}%</td><td style=\"padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;\">${p.fg3Pct ?? 0}%</td><td style=\"padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;\">${p.tsPct ?? 0}%</td><td style=\"padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;\">${p.threePar ?? 0}%</td><td style=\"padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;\">${p.ftr ?? 0}%</td>")

with open("team.html", "w", encoding="utf-8") as f:
    f.write(th)
print("Block 4 done: Updated team.html with TOV% percentile, Frequent Lineups dropdown, Lineup Insights & 2P%/3PAr/FTr!")
