import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

quick_split_insights_fn = '''function buildQuickSplitInsights(shots, fts, tovs, poss, isTeam) {
  const bullets = [];
  if (!shots || shots.length < 120) return '';

  const isAllSplits = (_quickSplits.seg === 'ALL' && _quickSplits.loc === 'ALL' && _quickSplits.wl === 'ALL' && _quickSplits.per === 'ALL');
  if (!isAllSplits) return '';

  const evalPair = (labelA, fnA, labelB, fnB) => {
    const sA = shots.filter(fnA), sB = shots.filter(fnB);
    if (sA.length < 60 || sB.length < 60) return;

    const efg = (arr) => {
      const m = arr.reduce((a, s) => a + s.made, 0);
      const m3 = arr.filter(s => s.val === 3 && s.made === 1).length;
      return ((m + 0.5 * m3) / arr.length) * 100;
    };
    const efgA = efg(sA), efgB = efg(sB);
    const efgDiff = efgA - efgB;

    if (Math.abs(efgDiff) >= 4.5) {
      const hi = efgDiff > 0 ? { lbl: labelA, val: efgA, d: efgDiff } : { lbl: labelB, val: efgB, d: -efgDiff };
      const lo = efgDiff > 0 ? labelB : labelA;
      bullets.push(`<span style="color:var(--green);font-weight:700;">${labelA.toUpperCase()} VS ${labelB.toUpperCase()} SPLIT:</span> eFG% is <b>${hi.val.toFixed(1)}%</b> in <b>${hi.lbl}</b> (<b>+${hi.d.toFixed(1)}%</b> vs. ${lo}).`);
    }

    if (isTeam && poss && poss.length) {
      const rtg = (fn, side) => {
        const pList = poss.filter(p => p.side === side && fn(p));
        if (pList.length < 100) return null;
        const pts = pList.reduce((a, p) => a + (p.pts || 0), 0);
        return (pts / pList.length) * 100;
      };
      const netA = (rtg(fnA, 'off') != null && rtg(fnA, 'def') != null) ? (rtg(fnA, 'off') - rtg(fnA, 'def')) : null;
      const netB = (rtg(fnB, 'off') != null && rtg(fnB, 'def') != null) ? (rtg(fnB, 'off') - rtg(fnB, 'def')) : null;
      if (netA != null && netB != null && Math.abs(netA - netB) >= 9.0) {
        const hi = netA > netB ? { lbl: labelA, val: netA, d: netA - netB } : { lbl: labelB, val: netB, d: netB - netA };
        bullets.push(`<span style="color:var(--blue);font-weight:700;">NET RATING SPLIT:</span> NetRtg jumps to <b>${hi.val >= 0 ? '+' : ''}${hi.val.toFixed(1)}</b> in <b>${hi.lbl}</b> (<b>+${hi.d.toFixed(1)}</b> swing).`);
      }
    }
  };

  evalPair('Home', x => x.loc === 'Home', 'Away', x => x.loc === 'Away');
  evalPair('Wins', x => x.wl === 'W', 'Losses', x => x.wl === 'L');
  evalPair('Reg Season', x => x.st === 'Regular Season', 'Showcase', x => x.st === 'Showcase');
  evalPair('1st Half', x => x.p <= 2, '2nd Half', x => x.p >= 3 && x.p <= 4);

  if (!bullets.length) return '';
  return `
    <div class="sc-card" style="border-left:4px solid var(--blue);background:var(--surface);">
      <div class="sc-card-title" style="font-size:13px;">Insights</div>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:11px;line-height:1.45;color:var(--text);">
        ${bullets.slice(0, 4).map(b => `<li style="margin-bottom:3px;">${b}</li>`).join('')}
      </ul>
    </div>`;
}
'''

js = quick_split_insights_fn + "\n" + js

# Wire Quick Split insights into Team view when no toggles are active, and merge into Individual view
js = js.replace(
    "const dIns = buildInsightsBox(tag, offShots, defShots, allOff, allDef, hasToggles);",
    "const dIns = hasToggles ? buildInsightsBox(tag, offShots, defShots, allOff, allDef, hasToggles) : (buildQuickSplitInsights(allOff, offFts, offTovs, comboPoss, true) || buildInsightsBox(tag, offShots, defShots, allOff, allDef, false));"
)

js = js.replace(
    "const insHtml = buildPlayerInsights(pid, playerName, sub, allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off')) || buildInsightsBox(playerName, sub, null, allOff, null, false);",
    "const insHtml = buildPlayerInsights(pid, playerName, sub, allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off')) || buildQuickSplitInsights(sub, subFts, subTovs, null, false) || buildInsightsBox(playerName, sub, null, allOff, null, false);"
)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=70', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Added Quick Split divergence detection to Insights on All (v=70)!")
