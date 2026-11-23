import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

old_row_block = re.search(r'  const renderRow = \(label, st, woSt, isBase = false\) => \{.*?\n  \};', js, flags=re.S)
new_row_block = '''  const fmtCell = (val, baseVal, dec, suffix, invert = false, bold = false) => {
    const vStr = `${val.toFixed(dec)}${suffix}`;
    if (baseVal == null) return bold ? `<b>${vStr}</b>` : vStr;
    const d = val - baseVal;
    const thresh = dec === 0 ? 3.0 : 0.5;
    const good = invert ? d <= -thresh : d >= thresh;
    const bad = invert ? d >= thresh : d <= -thresh;
    const col = good ? 'var(--green)' : (bad ? 'var(--red)' : 'var(--dim)');
    const dStr = `${d >= 0 ? '+' : ''}${d.toFixed(dec)}${suffix}`;
    return `${bold ? `<b>${vStr}</b>` : vStr} <span style="font-size:9px;color:${col};font-weight:700;">(${dStr})</span>`;
  };

  const renderRow = (label, st, woSt, isBase = false) => {
    const bg = isBase ? 'background:var(--surface);font-weight:700;' : '';
    const w = isBase ? null : woSt;
    return `<tr style="${bg}">
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);font-weight:700;white-space:nowrap;">${label}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${st.poss}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.pts75, w?.pts75, 1, '', false, true)}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.reb75, w?.reb75, 1, '')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.ast75, w?.ast75, 1, '')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.tov75, w?.tov75, 1, '', true)}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.stl75, w?.stl75, 1, '')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.blk75, w?.blk75, 1, '')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.usg, w?.usg, 1, '%')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.efg, w?.efg, 1, '%', false, true)}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.astdPct, w?.astdPct, 0, '%')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${st.rimSh.toFixed(0)}% (${fmtCell(st.rimFg, w?.rimFg, 0, '%')})</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${st.midSh.toFixed(0)}% (${fmtCell(st.midFg, w?.midFg, 0, '%')})</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${st.thrSh.toFixed(0)}% (${fmtCell(st.thrFg, w?.thrFg, 0, '%')})</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.passShare, w?.passShare, 0, '%')}</td>
    </tr>`;
  };'''

if old_row_block:
    js = js[:old_row_block.start()] + new_row_block + js[old_row_block.end():]

js = js.replace(
    'Per-75 possession stats, shooting efficiency (eFG% diff = WITH minus WITHOUT teammate), shot diet Share% (FG%), and Passing TOV Share%',
    'Every column shows WITH teammate value + (WITH minus WITHOUT teammate diff)'
)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=68', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Updated every column in Teammate Synergy to show Value (WITH vs OFF diff) (v=68)!")
