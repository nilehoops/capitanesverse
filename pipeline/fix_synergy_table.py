import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# Helper to strip Jr., Sr., II, III, IV when getting last name
name_helper = '''function getCleanLastName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\\s+/).filter(p => !/^(jr\\.?|sr\\.?|ii|iii|iv|v)$/i.test(p));
  return parts.length ? parts[parts.length - 1] : fullName;
}
'''

if "function getCleanLastName" not in js:
    js = name_helper + "\n" + js

js = js.replace("p.name.split(' ').slice(-1).shift() || p.name", "getCleanLastName(p.name)")
js = js.replace("mate.name.split(' ').slice(-1).shift() || mate.name", "getCleanLastName(mate.name)")

# Rebuild buildTeammateSynergyCard with Overall baseline row, separate STL/75 & BLK/75, and clearer labels
clean_synergy = '''function buildTeammateSynergyCard(pid, playerName, allOffShots, allOffFts, allOffTovs, allOffPoss, baseEvents) {
  if (!pid || !_shotData?.players) return '';

  const pPoss = allOffPoss.filter(p => (p.on || []).includes(pid));
  const pShots = allOffShots.filter(s => s.pid === pid);
  const pFts = allOffFts.filter(f => f.pid === pid);
  const pTovs = allOffTovs.filter(t => t.pid === pid);
  const pEvs = (baseEvents || []).filter(e => e.pid === pid);

  if (pPoss.length < 75) return '';

  const calcStats = (filterMode, mateId) => {
    const chk = (x) => {
      if (filterMode === 'all') return true;
      return filterMode === 'with' ? (x.on || []).includes(mateId) : !(x.on || []).includes(mateId);
    };
    const fPoss = pPoss.filter(chk);
    const possCnt = fPoss.length;
    if (!possCnt) return null;

    const fS = pShots.filter(chk);
    const fF = pFts.filter(chk);
    const fT = pTovs.filter(chk);
    const fE = pEvs.filter(chk);

    const fga = fS.length;
    const fgm = fS.reduce((a, s) => a + s.made, 0);
    const astdM = fS.reduce((a, s) => a + (s.astd || 0), 0);
    const fg3m = fS.filter(s => s.val === 3 && s.made === 1).length;
    const pts = fS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + fF.reduce((a, x) => a + x.made, 0);
    const tsDenom = 2 * (fga + 0.44 * fF.length);

    const rimS = fS.filter(s => s.val === 2 && s.dist <= 4);
    const midS = fS.filter(s => s.val === 2 && s.dist > 4);
    const thrS = fS.filter(s => s.val === 3);

    const rimSh = fga ? (rimS.length / fga) * 100 : 0;
    const midSh = fga ? (midS.length / fga) * 100 : 0;
    const thrSh = fga ? (thrS.length / fga) * 100 : 0;

    const rimFg = rimS.length ? (rimS.reduce((a, s) => a + s.made, 0) / rimS.length) * 100 : 0;
    const midFg = midS.length ? (midS.reduce((a, s) => a + s.made, 0) / midS.length) * 100 : 0;
    const thrFg = thrS.length ? (thrS.reduce((a, s) => a + s.made, 0) / thrS.length) * 100 : 0;

    const passT = fT.filter(t => (t.sub || '').toLowerCase().includes('bad pass')).length;
    const passShare = fT.length ? (passT / fT.length) * 100 : 0;

    const reb = fE.filter(e => e.type === 'OREB' || e.type === 'DREB').length;
    const ast = fE.filter(e => e.type === 'AST').length;
    const stl = fE.filter(e => e.type === 'STL').length;
    const blk = fE.filter(e => e.type === 'BLK').length;
    const ftTrips = fF.filter(f => !f.and1 && f.val > 0).length / 2;
    const usg = ((fga + ftTrips + fT.length) / possCnt) * 100;

    return {
      poss: possCnt,
      pts75: (pts / possCnt) * 75,
      reb75: (reb / possCnt) * 75,
      ast75: (ast / possCnt) * 75,
      tov75: (fT.length / possCnt) * 75,
      stl75: (stl / possCnt) * 75,
      blk75: (blk / possCnt) * 75,
      usg,
      efg: fga ? ((fgm + 0.5 * fg3m) / fga) * 100 : 0,
      ts: tsDenom > 0 ? (pts / tsDenom) * 100 : 0,
      astdPct: fgm ? (astdM / fgm) * 100 : 0,
      rimSh, midSh, thrSh, rimFg, midFg, thrFg,
      passShare,
    };
  };

  const base = calcStats('all', null);
  if (!base) return '';

  const renderRow = (label, st, woSt, isBase = false) => {
    const bg = isBase ? 'background:var(--surface);font-weight:700;' : '';
    let tsDeltaHtml = '';
    if (!isBase && woSt) {
      const d = st.ts - woSt.ts;
      const col = d >= 2.5 ? 'var(--green)' : (d <= -2.5 ? 'var(--red)' : 'var(--dim)');
      tsDeltaHtml = ` <span style="color:${col};font-weight:700;">(${d >= 0 ? '+' : ''}${d.toFixed(1)}%)</span>`;
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
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.efg.toFixed(1)}%</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${st.ts.toFixed(1)}%${tsDeltaHtml}</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.astdPct.toFixed(0)}%</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.rimSh.toFixed(0)}% (${st.rimFg.toFixed(0)}%)</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.midSh.toFixed(0)}% (${st.midFg.toFixed(0)}%)</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.thrSh.toFixed(0)}% (${st.thrFg.toFixed(0)}%)</td>
      <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${st.passShare.toFixed(0)}%</td>
    </tr>`;
  };

  const mateRows = [];
  (_shotData.players || []).forEach(mate => {
    if (mate.id === pid) return;
    const w = calcStats('with', mate.id);
    const wo = calcStats('without', mate.id);
    if (!w || !wo || w.poss < 75 || wo.poss < 50) return;
    mateRows.push({ poss: w.poss, html: renderRow(`w/ ${getCleanLastName(mate.name)}`, w, wo, false) });
  });

  if (!mateRows.length) return '';
  mateRows.sort((a, b) => b.poss - a.poss);

  return `
    <div class="sc-card" style="grid-column:1 / -1;">
      <div class="sc-card-title" style="font-size:13px;">Teammate Synergy &amp; Per-75 Production — ${playerName}</div>
      <div class="sc-card-sub">Per-75 possession stats, shooting efficiency (TS% diff = WITH minus WITHOUT teammate), shot diet Share% (FG%), and Passing TOV Share%</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead>
            <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
              <th style="padding:3px 5px;text-align:left;border-bottom:1px solid var(--border);">Lineup Context</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">Poss</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">PTS/75</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">REB/75</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">AST/75</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">TOV/75</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">STL/75</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">BLK/75</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">USG%</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG%</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">TS% (vs Off)</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">%Ast'd</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">Rim (FG%)</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">Mid (FG%)</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">3PT (FG%)</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">Pass TOV%</th>
            </tr>
          </thead>
          <tbody>
            ${renderRow('Season Overall', base, null, true)}
            ${mateRows.map(r => r.html).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}'''

js = re.sub(r'function buildTeammateSynergyCard\(.*?\n\}', clean_synergy, js, count=1, flags=re.S)

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=66', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Fixed STL/BLK, III/IV names, and added Season Overall baseline row (v=66)!")
