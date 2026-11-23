import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# Make default landing state (pid === null and no ON/OFF toggles) render full Team Offense + Defense cockpit
js = js.replace(
    "if (hasToggles || mode === 'team_off' || mode === 'team_def') {",
    "if (hasToggles || mode === 'team_off' || mode === 'team_def' || (mode === 'auto' && pid === null)) {"
)

# Label cleanly when viewing full team without toggles
js = js.replace(
    "const tag = parts.length ? parts.join(' | ') : 'All Capitanes Lineups';",
    "const tag = parts.length ? parts.join(' | ') : 'All Capitanes (Full Team)';"
)

# Arrange Macro Summary + Turnovers + Insights cleanly in the 2-column bottom row
old_dual = re.search(r'      const dIns = buildInsightsBox\(.*?return;\n    \}', js, flags=re.S)
new_dual = '''      const dIns = buildInsightsBox(tag, offShots, defShots, allOff, allDef, hasToggles);
      const dTov = buildTurnoverCard(tag, offTovs, defTovs, false, null);
      const dDelta = hasToggles ? buildOnOffDeltaCard(tag, offShots, allOff, defShots, allDef) : '';
      grid.innerHTML =
        buildCourtCard(`Capitanes Offense (${tag})`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +
        buildCourtCard(`Opponent Defense (${tag})`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +
        macroHtml +
        dTov +
        (dIns ? dIns : '') +
        (dDelta ? dDelta : '');
    }
    return;'''

if old_dual:
    js = js[:old_dual.start()] + new_dual + js[old_dual.end():]

# Keep Macro Summary half-width when paired with Turnovers in the 2-column grid
js = js.replace(
    '<div class="sc-card" style="grid-column:1 / -1;background:var(--surface);padding:5px 10px;">',
    '<div class="sc-card" style="background:var(--surface);padding:6px 8px;">'
)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=48', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Updated opening view to Full Offense + Defense Cockpit (v=48)!")
