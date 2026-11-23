import re

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()

# 1. Ensure CSS for the multi-game ✓/✕ dropdown menu is present
game_css = """  .sc-control { display:flex; flex-direction:column; gap:0; position:relative; }
  .sc-game-btn { font-family:'Lora',serif; font-size:9.5px; padding:1px 5px; border:1px solid var(--border); background:var(--surface); color:var(--text); cursor:pointer; text-align:left; }
  .sc-game-menu { display:none; position:absolute; top:100%; right:0; width:260px; max-height:280px; overflow-y:auto; background:var(--bg); border:1px solid var(--border); box-shadow:0 4px 12px rgba(0,0,0,0.12); z-index:999; padding:4px; }
  .sc-game-menu.open { display:block; }
  .sc-game-row { display:flex; align-items:center; justify-content:space-between; gap:4px; padding:2px 4px; border-bottom:1px solid var(--border); font-size:10px; }
  .sc-gbtn { font-family:'Oswald',sans-serif; font-size:9px; font-weight:700; padding:0 5px; border:1px solid var(--border); background:var(--surface); color:var(--muted); cursor:pointer; }
  .sc-gbtn.inc-active { background:var(--green); color:#fff; border-color:var(--green); }
  .sc-gbtn.exc-active { background:var(--red); color:#fff; border-color:var(--red); }"""

if ".sc-game-menu" not in h:
    h = h.replace(".sc-control { display:flex; flex-direction:column; gap:0; }", game_css)

# 2. Replace <select id="scGame">...</select> with the multi-game ✓/✕ button + menu
old_game_ctrl = re.search(r'<div class="sc-control"><label>Game</label><select id="scGame".*?</select></div>', h)
new_game_ctrl = '<div class="sc-control"><label>Games</label><button type="button" id="scGameBtn" class="sc-game-btn" onclick="toggleGameMenu(event)">All Games (51) ▾</button><div id="scGameMenu" class="sc-game-menu" onclick="event.stopPropagation()"></div></div>'

if old_game_ctrl:
    h = h[:old_game_ctrl.start()] + new_game_ctrl + h[old_game_ctrl.end():]

# 3. Also hook Reset All Filters button to clear game filters too
h = h.replace(
    "['scGame','scSegment','scLocation','scOutcome','scLastN','scPeriod','scShotType'].forEach(id=>document.getElementById(id).value='ALL');renderShotPage()",
    "resetAllFilters()"
)

h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=56', h)

with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Updated shotcharts.html with scGameBtn & ✓/✕ multi-game menu (v=56)!")
