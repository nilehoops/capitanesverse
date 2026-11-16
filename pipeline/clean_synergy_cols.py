import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

old_row_fn = re.search(r'  const renderRow = \(label, st, woSt, isBase = false\) => \{.*?\n  \};', js, flags=re.S)
new_row_fn = '''  const renderRow = (label, st, woSt, isBase = false) => {
    const bg = isBase ? 'background:var(--surface);font-weight:700;' : '';
    let efgDeltaHtml = '';
    if (!isBase && woSt) {
      const d = st.efg - woSt.efg;
      const col = d >= 2.5 ? 'var(--green)' : (d <= -2.5 ? 'var(--red)' : 'var(--dim)');
      efgDeltaHtml = ` <span style="color:${col};font-weight:700;">(${d >= 0 ? '+' : ''}${d.toFixed(1)}%)</span>`;
    }
    return `<tr style="${bg}">
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);font-weight:700;">${label}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${st.poss}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${st.pts75.toFixed(1)}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.reb75.toFixed(1)}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.ast75.toFixed(1)}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.tov75.toFixed(1)}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.stl75.toFixed(1)}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.blk75.toFixed(1)}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.usg.toFixed(1)}%</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${st.efg.toFixed(1)}%${efgDeltaHtml}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.astdPct.toFixed(0)}%</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.rimSh.toFixed(0)}% (${st.rimFg.toFixed(0)}%)</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.midSh.toFixed(0)}% (${st.midFg.toFixed(0)}%)</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.thrSh.toFixed(0)}% (${st.thrFg.toFixed(0)}%)</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.passShare.toFixed(0)}%</td>
    </tr>`;
  };'''

if old_row_fn:
    js = js[:old_row_fn.start()] + new_row_fn + js[old_row_fn.end():]

js = js.replace(
    '<th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG%</th>\n              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">TS% (vs Off)</th>',
    '<th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG% (vs Off)</th>'
)
js = js.replace('(TS% diff = WITH minus WITHOUT teammate)', '(eFG% diff = WITH minus WITHOUT teammate)')

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=67', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Removed TS%, moved (+Diff) format to eFG%, and bumped to v=67!")
