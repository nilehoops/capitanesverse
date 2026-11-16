import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

new_insights = '''function buildInsightsBox(label, offShots, defShots, allOffShots, allDefShots, hasToggles) {
  const bullets = [];
  const offTot = offShots.length;
  const defTot = defShots ? defShots.length : 0;

  // Require meaningful overall sample size before generating any notes
  if (offTot < 35) return '';

  const gOff = groupShotsByZone(offShots);
  const allOffGrp = groupShotsByZone(allOffShots);
  const allOffTot = allOffShots.length || 1;

  // 1. Macro Shot Diet & eFG% Comparison vs. Capitanes Team Baseline
  const calcMacro = (list, grp) => {
    const tot = list.length || 1;
    const fgm = list.reduce((a, s) => a + s.made, 0);
    const fg3m = list.filter(s => s.val === 3 && s.made === 1).length;
    const fg3a = list.filter(s => s.val === 3).length;
    const rimA = grp['Restricted Area'].fga;
    const midA = tot - rimA - fg3a - grp['Paint (Non-RA)'].fga;
    return {
      efg: ((fgm + 0.5 * fg3m) / tot) * 100,
      rimRate: (rimA / tot) * 100,
      threeRate: (fg3a / tot) * 100,
      midRate: (midA / tot) * 100
    };
  };

  const curM = calcMacro(offShots, gOff);
  const tmM = calcMacro(allOffShots, allOffGrp);

  if (hasToggles) {
    const efgDiff = curM.efg - tmM.efg;
    if (Math.abs(efgDiff) >= 3.5) {
      const col = efgDiff > 0 ? 'var(--green)' : 'var(--red)';
      bullets.push(`<span style="color:${col};font-weight:700;">LINEUP EFFICIENCY SWING:</span> Team eFG% is <b>${curM.efg.toFixed(1)}%</b> (<b>${efgDiff >= 0 ? '+' : ''}${efgDiff.toFixed(1)}%</b> vs. Capitanes season avg of ${tmM.efg.toFixed(1)}%).`);
    }
    const rimDiff = curM.rimRate - tmM.rimRate;
    if (Math.abs(rimDiff) >= 5.0) {
      const col = rimDiff > 0 ? 'var(--green)' : 'var(--red)';
      bullets.push(`<span style="color:${col};font-weight:700;">RIM PRESSURE:</span> Restricted Area share shifts to <b>${curM.rimRate.toFixed(1)}%</b> (<b>${rimDiff >= 0 ? '+' : ''}${rimDiff.toFixed(1)}%</b> vs. team avg).`);
    }
    const threeDiff = curM.threeRate - tmM.threeRate;
    if (Math.abs(threeDiff) >= 5.0) {
      bullets.push(`<span style="color:var(--blue);font-weight:700;">PERIMETER VOLUME:</span> 3-Point Attempt Rate is <b>${curM.threeRate.toFixed(1)}%</b> (<b>${threeDiff >= 0 ? '+' : ''}${threeDiff.toFixed(1)}%</b> vs. team avg).`);
    }
  }

  if (curM.midRate >= 22.0) {
    bullets.push(`<span style="color:var(--red);font-weight:700;">SHOT DIET WARNING:</span> <b>${curM.midRate.toFixed(1)}%</b> of shots are non-paint mid-range jumpers — emphasize paint touches and kick-outs.`);
  }

  // 2. High-Volume Zone Outliers Only (>= 15 FGA AND >= 10% of total shot diet)
  const highVolZones = Object.entries(gOff)
    .filter(([, g]) => g.fga >= 15 && (g.fga / offTot) >= 0.10)
    .map(([z, g]) => {
      const pct = (g.fgm / g.fga) * 100;
      const lg = (LG_ZONE_BENCH[z] || 0.40) * 100;
      const share = (g.fga / offTot) * 100;
      return { z, fgm: g.fgm, fga: g.fga, pct, diffLg: pct - lg, share };
    });

  if (highVolZones.length) {
    const topZone = [...highVolZones].sort((a, b) => b.diffLg - a.diffLg)[0];
    const coldZone = [...highVolZones].sort((a, b) => a.diffLg - b.diffLg)[0];
    if (topZone && topZone.diffLg >= 5.5) {
      bullets.push(`<span style="color:var(--green);font-weight:700;">HIGH-VOLUME STRENGTH:</span> <b>${topZone.z}</b> (${topZone.share.toFixed(0)}% of shots) is converting at <b>${topZone.pct.toFixed(1)}%</b> (${topZone.fgm}-${topZone.fga}, <b>+${topZone.diffLg.toFixed(1)}%</b> vs. LG avg).`);
    }
    if (coldZone && coldZone.diffLg <= -5.5) {
      bullets.push(`<span style="color:var(--red);font-weight:700;">HIGH-VOLUME DRAG:</span> Struggling on heavy volume in <b>${coldZone.z}</b> (${coldZone.share.toFixed(0)}% of shots) at <b>${coldZone.pct.toFixed(1)}%</b> (${coldZone.fgm}-${coldZone.fga}, <b>${coldZone.diffLg.toFixed(1)}%</b> vs. LG avg).`);
    }
  }

  // 3. High-Volume Defensive Anchors / Leaks (>= 15 Opp FGA AND >= 10% of Opp shots)
  if (defTot >= 35) {
    const gDef = groupShotsByZone(defShots);
    const defVol = Object.entries(gDef)
      .filter(([, g]) => g.fga >= 15 && (g.fga / defTot) >= 0.10)
      .map(([z, g]) => {
        const pct = (g.fgm / g.fga) * 100;
        const lg = (LG_ZONE_BENCH[z] || 0.40) * 100;
        const share = (g.fga / defTot) * 100;
        return { z, fgm: g.fgm, fga: g.fga, pct, diffLg: pct - lg, share };
      });

    if (defVol.length) {
      const leak = [...defVol].sort((a, b) => b.diffLg - a.diffLg)[0];
      const lock = [...defVol].sort((a, b) => a.diffLg - b.diffLg)[0];
      if (leak && leak.diffLg >= 5.5) {
        bullets.push(`<span style="color:var(--red);font-weight:700;">DEFENSIVE VULNERABILITY:</span> Opponents are shooting <b>${leak.pct.toFixed(1)}%</b> (${leak.fgm}-${leak.fga}, <b>+${leak.diffLg.toFixed(1)}%</b> vs. LG avg) in <b>${leak.z}</b> (${leak.share.toFixed(0)}% of opp FGA).`);
      }
      if (lock && lock.diffLg <= -5.5) {
        bullets.push(`<span style="color:var(--green);font-weight:700;">DEFENSIVE ANCHOR:</span> Holding opponents to <b>${lock.pct.toFixed(1)}%</b> (${lock.fgm}-${lock.fga}, <b>${lock.diffLg.toFixed(1)}%</b> vs. LG avg) in <b>${lock.z}</b>.`);
      }
    }
  }

  if (!bullets.length) return '';

  return `
    <div class="sc-card" style="border-left:4px solid var(--blue);background:var(--surface);">
      <div class="sc-card-title" style="font-size:13px;">Scouting Insights &amp; Points of Emphasis — ${label}</div>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:11px;line-height:1.45;color:var(--text);">
        ${bullets.map(b => `<li style="margin-bottom:3px;">${b}</li>`).join('')}
      </ul>
    </div>`;
}'''

js = re.sub(r'function buildInsightsBox\(.*?\n\}', new_insights, js, count=1, flags=re.S)
with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=33', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Upgraded buildInsightsBox to high-volume, macro-metric insights!")
