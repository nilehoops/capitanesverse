import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# 1. Helper that extracts <li> bullets from any rendered insights card so we can merge them cleanly
merge_helper = '''function extractInsightBullets(htmlStr) {
  if (!htmlStr) return [];
  const matches = [...htmlStr.matchAll(/<li[^>]*>(.*?)<\\/li>/g)];
  return matches.map(m => m[1]);
}

function renderMergedInsights(bulletLists) {
  const all = bulletLists.flat().filter(Boolean);
  if (!all.length) return '';
  return `
    <div class="sc-card" style="border-left:4px solid var(--blue);background:var(--surface);">
      <div class="sc-card-title" style="font-size:13px;">Insights</div>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:11px;line-height:1.45;color:var(--text);">
        ${all.slice(0, 6).map(b => `<li style="margin-bottom:3px;">${b}</li>`).join('')}
      </ul>
    </div>`;
}
'''

js = merge_helper + "\n" + js

# 2. Merge Quick Split + Zone/Shot-Diet/Defensive insights in Team view
old_team_ins = "const dIns = hasToggles ? buildInsightsBox(tag, offShots, defShots, allOff, allDef, hasToggles) : (buildQuickSplitInsights(allOff, offFts, offTovs, comboPoss, true) || buildInsightsBox(tag, offShots, defShots, allOff, allDef, false));"
new_team_ins = """const dIns = renderMergedInsights([
        extractInsightBullets(buildQuickSplitInsights(allOff, offFts, offTovs, comboPoss, true)),
        extractInsightBullets(buildInsightsBox(tag, offShots, defShots, allOff, allDef, hasToggles))
      ]);"""

js = js.replace(old_team_ins, new_team_ins)

# 3. Merge Teammate Synergy + Quick Split + Zone/Shot-Diet insights in Individual Player view
old_ind_ins = "const insHtml = buildPlayerInsights(pid, playerName, sub, allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off')) || buildQuickSplitInsights(sub, subFts, subTovs, null, false) || buildInsightsBox(playerName, sub, null, allOff, null, false);"
new_ind_ins = """const insHtml = renderMergedInsights([
    extractInsightBullets(buildPlayerInsights(pid, playerName, sub, allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'))),
    extractInsightBullets(buildQuickSplitInsights(sub, subFts, subTovs, null, false)),
    extractInsightBullets(buildInsightsBox(playerName, sub, null, allOff, null, false))
  ]);"""

js = js.replace(old_ind_ins, new_ind_ins)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=71', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Merged Quick Splits, Teammate Synergy & Zone/Shot-Diet Insights (v=71)!")
