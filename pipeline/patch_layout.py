import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

old_svg = '<svg viewBox="-250 -47.5 500 470" style="width:100%;max-width:500px;height:auto;display:block;background:#FAFAFA;margin-bottom:10px;">'
new_svg = '<div class="sc-card-body"><div class="sc-court-wrap"><svg viewBox="-250 -47.5 500 470" style="width:100%;height:auto;display:block;background:#FAFAFA;border:1px solid var(--border);">'

js = js.replace(old_svg, new_svg)
js = re.sub(r'</svg>\s*<div style="overflow-x:auto;">', '</svg></div><div class="sc-table-wrap">', js)
js = re.sub(r'<tbody>\$\{tableRows\}</tbody>\s*</table>\s*</div>\s*</div>`;', '<tbody>${tableRows}</tbody></table></div></div></div>`;', js)
js = js.replace('padding:3px 5px;', 'padding:2px 4px;')

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

print("Updated court card to side-by-side no-scroll layout!")
