import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

exact_macro = '''function buildMacroStrip(label, offShots, defShots, offFts, defFts, offTovs, defTovs, offPoss, defPoss, allOffShots, allOffFts, allOffTovs, allOffPoss, allDefShots, allDefFts, allDefTovs, allDefPoss) {
  const calc = (shots, fts, tovs, poss, oppPoss) => {
    const pCount = poss.length || 1;
    const fga = shots.length || 1;
    const fgm = shots.reduce((a, s) => a + s.made, 0);
    const fg3m = shots.filter(s => s.val === 3 && s.made === 1).length;
    const pts = shots.reduce((a, s) => a + (s.made ? s.val : 0), 0) + fts.reduce((a, f) => a + f.made, 0);
    const oreb = poss.reduce((a, p) => a + (p.oreb || 0), 0);
    const oppDreb = (oppPoss || []).reduce((a, p) => a + (p.dreb || 0), 0);
    const rebChances = Math.max(1, oreb + oppDreb);

    return {
      poss: poss.length,
      rtg: (pts / pCount) * 100,
      efg: ((fgm + 0.5 * fg3m) / fga) * 100,
      tov: (tovs.length / pCount) * 100,
      oreb: (oreb / rebChances) * 100,
      ftr: (fts.length / fga) * 100,
    };
  };

  const o = calc(offShots, offFts, offTovs, offPoss, defPoss);
  const d = calc(defShots, defFts, defTovs, defPoss, offPoss);
  const net = o.rtg - d.rtg;

  const tmO = calc(allOffShots, allOffFts, allOffTovs, allOffPoss, allDefPoss);
  const tmD = calc(allDefShots, allDefFts, allDefTovs, allDefPoss, allOffPoss);
  const tmNet = tmO.rtg - tmD.rtg;
  const netDiff = net - tmNet;

  const netCol = net >= 0 ? 'var(--green)' : 'var(--red)';
  const diffCol = netDiff >= 0 ? 'var(--green)' : 'var(--red)';

  return `
    <div class="sc-card" style="grid-column:1 / -1;background:var(--surface);padding:5px 10px;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;font-size:11px;">
        <div>
          <span style="font-family:'Oswald',sans-serif;font-weight:700;color:var(--blue);font-size:12px;">MACRO SUMMARY (${label})</span>
          <span style="color:var(--muted);margin-left:6px;">Sample: <b>${o.poss}</b> Off Poss / <b>${d.poss}</b> Def Poss</span>
        </div>
        <div style="display:flex;gap:12px;font-family:'Oswald',sans-serif;font-size:12px;">
          <span>OFF RTG: <b style="color:var(--blue);">${o.rtg.toFixed(1)}</b></span>
          <span>DEF RTG: <b style="color:var(--blue);">${d.rtg.toFixed(1)}</b></span>
          <span>NET RTG: <b style="color:${netCol};">${net >= 0 ? '+' : ''}${net.toFixed(1)}</b> <span style="font-size:10px;color:${diffCol};">(${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)} vs MXC)</span></span>
        </div>
        <div style="font-size:10.5px;color:var(--text);">
          <b style="color:var(--blue);">MXC 4-Factors:</b> eFG <b>${o.efg.toFixed(1)}%</b> · TOV <b>${o.tov.toFixed(1)}%</b> · OREB <b>${o.oreb.toFixed(1)}%</b> · FTr <b>${o.ftr.toFixed(1)}%</b>
          &nbsp;|&nbsp;
          <b style="color:var(--dim);">OPP 4-Factors:</b> eFG <b>${d.efg.toFixed(1)}%</b> · TOV <b>${d.tov.toFixed(1)}%</b> · OREB <b>${d.oreb.toFixed(1)}%</b> · FTr <b>${d.ftr.toFixed(1)}%</b>
        </div>
      </div>
    </div>`;
}'''

js = re.sub(r'function buildMacroStrip\(.*?\n\}', exact_macro, js, count=1, flags=re.S)
with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=37', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Updated buildMacroStrip to exact oreb / (oreb + oppDreb)!")
