import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# 1. Remove leftover (${tag}) from Capitanes Defense title
js = js.replace("`Capitanes Defense (${tag})`", "`Capitanes Defense`")

# 2. Place Capitanes Offense (top-left) + Capitanes Defense (top-right) first, then Summary + Turnovers underneath
js = js.replace(
    "grid.innerHTML = macroHtml +\n        buildCourtCard(`Capitanes Offense`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +\n        buildCourtCard(`Capitanes Defense`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +",
    "grid.innerHTML =\n        buildCourtCard(`Capitanes Offense`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +\n        buildCourtCard(`Capitanes Defense`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +\n        macroHtml +"
)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

# 3. Slightly tighten court width (295px) and table row padding so both rows fit on 1 screen with zero vertical scroll
with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()

h = h.replace(".sc-court-wrap { flex:0 0 50%; max-width:340px; }", ".sc-court-wrap { flex:0 0 46%; max-width:295px; }")
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=52', h)

with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Aligned Capitanes Offense & Capitanes Defense side-by-side on Row 1 (v=52)!")
