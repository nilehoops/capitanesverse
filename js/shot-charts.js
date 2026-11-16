function extractInsightBullets(htmlStr) {
  if (!htmlStr) return [];
  const matches = [...htmlStr.matchAll(/<li[^>]*>(.*?)<\/li>/g)];
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

function buildQuickSplitInsights(shots, fts, tovs, poss, isTeam) {
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

function buildShotTypeTableHtml(shots) {
  const buckets = [
    { name: 'Rim / Layups / Dunks', fn: s => /(layup|dunk|tip|alley)/i.test(s.sub || '') },
    { name: 'Catch & Shoot Jumpers', fn: s => /jump/i.test(s.sub || '') && !/pullup|step back|turnaround|fadeaway/i.test(s.sub || '') },
    { name: 'Pullup / Step-Back', fn: s => /(pullup|step back|fadeaway)/i.test(s.sub || '') },
    { name: 'Floaters / Hooks / Post', fn: s => /(floating|hook|bank|turnaround)/i.test(s.sub || '') },
  ];
  const totFga = shots.length || 1;
  const rows = buckets.map(b => {
    const sub = shots.filter(b.fn);
    const fga = sub.length;
    const fgm = sub.reduce((a, s) => a + s.made, 0);
    const fg3m = sub.filter(s => s.val === 3 && s.made === 1).length;
    const fgPct = fga ? ((fgm / fga) * 100).toFixed(1) : '—';
    const efgPct = fga ? (((fgm + 0.5 * fg3m) / fga) * 100).toFixed(1) : '—';
    const share = ((fga / totFga) * 100).toFixed(1);
    return `<tr>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);font-weight:600;">${b.name}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${fgm}-${fga}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${fgPct}${fga ? '%' : ''}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${efgPct}${fga ? '%' : ''}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${share}%</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border);">
      <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;color:var(--blue);margin-bottom:3px;">SHOT TYPE BREAKDOWN</div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead>
          <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
            <th style="padding:2px 4px;text-align:left;border-bottom:1px solid var(--border);">Shot Type</th>
            <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">FGM-FGA</th>
            <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">FG%</th>
            <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">eFG%</th>
            <th style="padding:2px 4px;text-align:right;border-bottom:1px solid var(--border);">Share%</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildPlayerInsights(pid, playerName, playerShots, allOffShots, allOffFts, allOffTovs, allOffPoss) {
  const bullets = [];
  if (!pid || !_shotData?.players) return '';

  const pPoss = allOffPoss.filter(p => (p.on || []).includes(pid));
  const pShots = allOffShots.filter(s => s.pid === pid);
  if (pPoss.length < 150) return '';

  const calc = (hasMate, mateId) => {
    const chk = (x) => hasMate ? (x.on || []).includes(mateId) : !(x.on || []).includes(mateId);
    const fP = pPoss.filter(chk);
    if (!fP.length) return null;
    const fS = pShots.filter(chk);
    const fF = allOffFts.filter(f => f.pid === pid && chk(f));
    const fga = fS.length || 1;
    const fgm = fS.reduce((a, s) => a + s.made, 0);
    const fg3m = fS.filter(s => s.val === 3 && s.made === 1).length;
    const pts = fS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + fF.reduce((a, x) => a + x.made, 0);
    const rimSh = (fS.filter(s => s.val === 2 && s.dist <= 4).length / fga) * 100;
    const thrSh = (fS.filter(s => s.val === 3).length / fga) * 100;
    return {
      poss: fP.length,
      pts75: (pts / fP.length) * 75,
      efg: fS.length ? ((fgm + 0.5 * fg3m) / fS.length) * 100 : 0,
      rimSh,
      thrSh
    };
  };

  const efgSwings = [];
  const ptsSwings = [];
  const dietSwings = [];

  (_shotData.players || []).forEach(mate => {
    if (mate.id === pid) return;
    const w = calc(true, mate.id);
    const wo = calc(false, mate.id);
    if (!w || !wo || w.poss < 150 || wo.poss < 100) return;

    const name = getCleanLastName(mate.name);
    const efgD = w.efg - wo.efg;
    const ptsD = w.pts75 - wo.pts75;
    const rimD = w.rimSh - wo.rimSh;
    const thrD = w.thrSh - wo.thrSh;

    if (Math.abs(efgD) >= 5.0) efgSwings.push({ name, poss: w.poss, val: w.efg, d: efgD });
    if (Math.abs(ptsD) >= 3.5) ptsSwings.push({ name, poss: w.poss, val: w.pts75, d: ptsD });
    if (Math.abs(rimD) >= 8.0) dietSwings.push({ name, poss: w.poss, zone: 'Rim', val: w.rimSh, d: rimD });
    if (Math.abs(thrD) >= 8.0) dietSwings.push({ name, poss: w.poss, zone: '3PT', val: w.thrSh, d: thrD });
  });

  efgSwings.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2).forEach(x => {
    const col = x.d > 0 ? 'var(--green)' : 'var(--red)';
    bullets.push(`<span style="color:${col};font-weight:700;">EFFICIENCY WITH ${x.name.toUpperCase()}:</span> Shoots <b>${x.val.toFixed(1)}% eFG</b> (<b>${x.d >= 0 ? '+' : ''}${x.d.toFixed(1)}%</b> vs. off) across ${x.poss} poss.`);
  });

  ptsSwings.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2).forEach(x => {
    const col = x.d > 0 ? 'var(--green)' : 'var(--red)';
    bullets.push(`<span style="color:${col};font-weight:700;">SCORING VOLUME WITH ${x.name.toUpperCase()}:</span> Averages <b>${x.val.toFixed(1)} PTS/75</b> (<b>${x.d >= 0 ? '+' : ''}${x.d.toFixed(1)}</b> vs. off).`);
  });

  dietSwings.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 1).forEach(x => {
    bullets.push(`<span style="color:var(--blue);font-weight:700;">SHOT DIET SHIFT WITH ${x.name.toUpperCase()}:</span> <b>${x.zone}</b> attempt share shifts to <b>${x.val.toFixed(0)}%</b> (<b>${x.d >= 0 ? '+' : ''}${x.d.toFixed(0)}%</b> vs. off).`);
  });

  if (!bullets.length) return '';
  return `
    <div class="sc-card" style="border-left:4px solid var(--blue);background:var(--surface);">
      <div class="sc-card-title" style="font-size:13px;">Insights</div>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:11px;line-height:1.45;color:var(--text);">
        ${bullets.map(b => `<li style="margin-bottom:3px;">${b}</li>`).join('')}
      </ul>
    </div>`;
}

function getCleanLastName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/).filter(p => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(p));
  return parts.length ? parts[parts.length - 1] : fullName;
}

function buildTeammateSynergyCard(pid, playerName, allOffShots, allOffFts, allOffTovs, allOffPoss, baseEvents) {
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

  const fmtCell = (val, baseVal, dec, suffix, invert = false, bold = false) => {
    const vStr = `${val.toFixed(dec)}${suffix}`;
    if (baseVal == null) return bold ? `<b>${vStr}</b>` : vStr;
    const d = val - baseVal;
    const thresh = dec === 0 ? 3.0 : 0.5;
    const good = invert ? d <= -thresh : d >= thresh;
    const bad = invert ? d >= thresh : d <= -thresh;
    const col = good ? 'var(--green)' : (bad ? 'var(--red)' : 'var(--dim)');
    const dStr = `${d >= 0 ? '+' : ''}${d.toFixed(dec)}${suffix}`;
    return `${bold ? `<b>${vStr}</b>` : vStr} <span style="font-size:9px;color:${col};font-weight:700;">(${dStr})</span>`;
  };

  const renderRow = (label, st, woSt, isBase = false) => {
    const bg = isBase ? 'background:var(--surface);font-weight:700;' : '';
    const w = isBase ? null : woSt;
    return `<tr style="${bg}">
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);font-weight:700;white-space:nowrap;">${label}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${st.poss}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.pts75, w?.pts75, 1, '', false, true)}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.reb75, w?.reb75, 1, '')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.ast75, w?.ast75, 1, '')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.tov75, w?.tov75, 1, '', true)}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.stl75, w?.stl75, 1, '')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.blk75, w?.blk75, 1, '')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.usg, w?.usg, 1, '%')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.efg, w?.efg, 1, '%', false, true)}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.astdPct, w?.astdPct, 0, '%')}</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${st.rimSh.toFixed(0)}% (${fmtCell(st.rimFg, w?.rimFg, 0, '%')})</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${st.midSh.toFixed(0)}% (${fmtCell(st.midFg, w?.midFg, 0, '%')})</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap;">${st.thrSh.toFixed(0)}% (${fmtCell(st.thrFg, w?.thrFg, 0, '%')})</td>
      <td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmtCell(st.passShare, w?.passShare, 0, '%')}</td>
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
      <div class="sc-card-sub">Every column shows WITH teammate value + (WITH minus WITHOUT teammate diff)</div>
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
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG% (vs Off)</th>
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
}

function renderTopMacro(label, offShots, defShots, offFts, defFts, offTovs, defTovs, offPoss, defPoss, allOffShots, allOffFts, allOffTovs, allOffPoss, allDefShots, allDefFts, allDefTovs, allDefPoss, hasToggles) {
  const box = document.getElementById('scTopMacro');
  if (!box) return;
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
  const netDiff = net - (tmO.rtg - tmD.rtg);

  const netCol = net >= 0 ? 'var(--green)' : 'var(--red)';
  const diffCol = netDiff >= 0 ? 'var(--green)' : 'var(--red)';
  const diffTag = hasToggles ? ` <span style="font-size:10px;color:${diffCol};">(${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)} vs Team)</span>` : '';

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-family:'Oswald',sans-serif;">
      <div style="font-size:14px;font-weight:700;">
        OffRtg: <span style="color:var(--blue);">${o.rtg.toFixed(1)}</span> &nbsp;
        DefRtg: <span style="color:var(--blue);">${d.rtg.toFixed(1)}</span> &nbsp;
        NetRtg: <span style="color:${netCol};">${net >= 0 ? '+' : ''}${net.toFixed(1)}</span>${diffTag}
      </div>
      <div style="font-size:9.5px;color:var(--muted);">${o.poss.toLocaleString()} Off / ${d.poss.toLocaleString()} Def Poss</div>
    </div>
    <div style="font-size:10px;color:var(--text);margin-top:3px;line-height:1.3;">
      <div><b style="color:var(--blue);">Capitanes:</b> eFG <b>${o.efg.toFixed(1)}%</b> · TOV <b>${o.tov.toFixed(1)}%</b> · OREB <b>${o.oreb.toFixed(1)}%</b> · FTr <b>${o.ftr.toFixed(1)}%</b></div>
      <div><b style="color:var(--dim);">Opponents:</b> eFG <b>${d.efg.toFixed(1)}%</b> · TOV <b>${d.tov.toFixed(1)}%</b> · OREB <b>${d.oreb.toFixed(1)}%</b> · FTr <b>${d.ftr.toFixed(1)}%</b></div>
    </div>`;
}

const _quickSplits = { seg: 'ALL', loc: 'ALL', wl: 'ALL', per: 'ALL' };

function toggleQuickPill(btn) {
  const grp = btn.dataset.grp;
  const val = btn.dataset.val;
  if (_quickSplits[grp] === val) {
    _quickSplits[grp] = 'ALL';
    btn.classList.remove('active');
  } else {
    document.querySelectorAll(`.sc-pill[data-grp="${grp}"]`).forEach(el => el.classList.remove('active'));
    _quickSplits[grp] = val;
    btn.classList.add('active');
  }
  renderShotPage();
}

const _incGames = new Set();
const _excGames = new Set();

function toggleGameMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('scGameMenu');
  if (menu) menu.classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('scGameMenu');
  const btn = document.getElementById('scGameBtn');
  if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.remove('open');
  }
});

function toggleGameFilter(gid, mode) {
  if (mode === 'inc') {
    if (_incGames.has(gid)) _incGames.delete(gid);
    else { _excGames.delete(gid); _incGames.add(gid); }
  } else {
    if (_excGames.has(gid)) _excGames.delete(gid);
    else { _incGames.delete(gid); _excGames.add(gid); }
  }
  buildGameMenu();
  renderShotPage();
}

function clearGameFilters() {
  _incGames.clear();
  _excGames.clear();
  buildGameMenu();
  renderShotPage();
}

function resetAllFilters() {
  _incGames.clear();
  _excGames.clear();
  _quickSplits.seg = 'ALL'; _quickSplits.loc = 'ALL'; _quickSplits.wl = 'ALL'; _quickSplits.per = 'ALL';
  document.querySelectorAll('.sc-pill').forEach(el => el.classList.remove('active'));
  ['scLastN','scShotType'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 'ALL'; });
  buildGameMenu();
  renderShotPage();
}

function buildGameMenu() {
  const menu = document.getElementById('scGameMenu');
  const btn = document.getElementById('scGameBtn');
  if (!menu || !_shotData) return;
  const games = _shotData.games || [];

  if (btn) {
    if (_incGames.size > 0) btn.textContent = `Games: ${_incGames.size} selected ▾`;
    else if (_excGames.size > 0) btn.textContent = `Games: ${_excGames.size} excluded ▾`;
    else btn.textContent = `All Games (${games.length}) ▾`;
  }

  const head = `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-bottom:1px solid var(--border);background:var(--surface);font-family:'Oswald',sans-serif;font-size:9.5px;position:sticky;top:0;">
    <span style="color:var(--muted);">✓ INCLUDE &nbsp;|&nbsp; ✕ EXCLUDE</span>
    <button type="button" onclick="clearGameFilters()" style="font-family:'Oswald',sans-serif;font-size:9px;padding:1px 6px;border:1px solid var(--border);background:var(--bg);cursor:pointer;">Clear</button>
  </div>`;

  const rows = games.map(g => {
    const isInc = _incGames.has(g.id);
    const isExc = _excGames.has(g.id);
    return `<div class="sc-game-row">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${isExc ? 'var(--muted);text-decoration:line-through' : 'var(--text)'};" title="${g.label}">${g.label}</span>
      <div style="display:flex;gap:3px;flex-shrink:0;">
        <button type="button" class="sc-gbtn ${isInc ? 'inc-active' : ''}" onclick="toggleGameFilter('${g.id}','inc')">✓</button>
        <button type="button" class="sc-gbtn ${isExc ? 'exc-active' : ''}" onclick="toggleGameFilter('${g.id}','exc')">✕</button>
      </div>
    </div>`;
  }).join('');

  menu.innerHTML = head + rows;
}

function buildPlayerExtraCards(pid, playerName, playerShots, allOffShots, allOffFts, allOffTovs, allOffPoss, allDefShots, allDefFts, allDefTovs, allDefPoss) {
  if (!pid) return '';

  const calcSplit = (isOn) => {
    const f = (arr) => arr.filter(x => isOn ? (x.on || []).includes(pid) : !(x.on || []).includes(pid));
    const oS = f(allOffShots), oF = f(allOffFts), oT = f(allOffTovs), oP = f(allOffPoss);
    const dS = f(allDefShots), dF = f(allDefFts), dT = f(allDefTovs), dP = f(allDefPoss);

    const oPoss = oP.length || 1, dPoss = dP.length || 1;
    const oPts = oS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + oF.reduce((a, x) => a + x.made, 0);
    const dPts = dS.reduce((a, s) => a + (s.made ? s.val : 0), 0) + dF.reduce((a, x) => a + x.made, 0);
    const oRtg = (oPts / oPoss) * 100, dRtg = (dPts / dPoss) * 100;

    const oFgm = oS.reduce((a, s) => a + s.made, 0);
    const o3m = oS.filter(s => s.val === 3 && s.made === 1).length;
    const oEfg = oS.length ? ((oFgm + 0.5 * o3m) / oS.length) * 100 : 0;
    const oTov = (oT.length / oPoss) * 100;
    const oOreb = oP.reduce((a, p) => a + (p.oreb || 0), 0);
    const dDreb = dP.reduce((a, p) => a + (p.dreb || 0), 0);
    const oOrebPct = (oOreb + dDreb) > 0 ? (oOreb / (oOreb + dDreb)) * 100 : 0;
    const oFtr = oS.length ? (oF.length / oS.length) * 100 : 0;

    return { poss: oP.length, oRtg, dRtg, net: oRtg - dRtg, efg: oEfg, tov: oTov, oreb: oOrebPct, ftr: oFtr };
  };

  const onM = calcSplit(true);
  const offM = calcSplit(false);
  const netDiff = onM.net - offM.net;
  const diffCol = netDiff >= 0 ? 'var(--green)' : 'var(--red)';

  const buckets = [
    { name: 'Rim / Layups / Dunks', fn: s => /(layup|dunk|tip|alley)/i.test(s.sub || '') },
    { name: 'Catch & Shoot Jumpers', fn: s => /jump/i.test(s.sub || '') && !/pullup|step back|turnaround|fadeaway/i.test(s.sub || '') },
    { name: 'Pullup / Step-Back', fn: s => /(pullup|step back|fadeaway)/i.test(s.sub || '') },
    { name: 'Floaters / Hooks / Post', fn: s => /(floating|hook|bank|turnaround)/i.test(s.sub || '') },
  ];
  const totFga = playerShots.length || 1;
  const shotRows = buckets.map(b => {
    const sub = playerShots.filter(b.fn);
    const fga = sub.length;
    const fgm = sub.reduce((a, s) => a + s.made, 0);
    const fg3m = sub.filter(s => s.val === 3 && s.made === 1).length;
    const fgPct = fga ? ((fgm / fga) * 100).toFixed(1) : '—';
    const efgPct = fga ? (((fgm + 0.5 * fg3m) / fga) * 100).toFixed(1) : '—';
    const share = ((fga / totFga) * 100).toFixed(1);
    return `<tr>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);font-weight:600;">${b.name}</td>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${fgm}-${fga}</td>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${fgPct}${fga ? '%' : ''}</td>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${efgPct}${fga ? '%' : ''}</td>
      <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${share}%</td>
    </tr>`;
  }).join('');
  return `
    <div class="sc-card">
      <div class="sc-card-title" style="font-size:13px;">Team On/Off Impact — ${playerName}</div>
      <div class="sc-card-sub">
        Net Swing: <span style="color:${diffCol};font-weight:700;">${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)} pts/100</span>
        (${onM.poss.toLocaleString()} ON Poss vs. ${offM.poss.toLocaleString()} OFF Poss)
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <thead>
          <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
            <th style="padding:2px 5px;text-align:left;border-bottom:1px solid var(--border);">Split</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">OffRtg</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">DefRtg</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">NetRtg</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">eFG%</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">TOV%</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">OREB%</th>
            <th style="padding:2px 5px;text-align:right;border-bottom:1px solid var(--border);">FTr</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);font-weight:700;color:var(--green);">ON Court</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.oRtg.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.dRtg.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${onM.net >= 0 ? '+' : ''}${onM.net.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.efg.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.tov.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.oreb.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${onM.ftr.toFixed(1)}%</td>
          </tr>
          <tr>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);font-weight:700;color:var(--red);">OFF Court</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.oRtg.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.dRtg.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${offM.net >= 0 ? '+' : ''}${offM.net.toFixed(1)}</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.efg.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.tov.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.oreb.toFixed(1)}%</td>
            <td style="padding:2px 5px;border-bottom:1px solid var(--border);text-align:right;">${offM.ftr.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
    </div>
    `;
}


function buildMacroStrip(label, offShots, defShots, offFts, defFts, offTovs, defTovs, offPoss, defPoss, allOffShots, allOffFts, allOffTovs, allOffPoss, allDefShots, allDefFts, allDefTovs, allDefPoss, hasToggles) {
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
  const diffTag = hasToggles ? ` <span style="font-size:10px;color:${diffCol};">(${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)} vs Team)</span>` : '';

  return `
    <div class="sc-card" style="background:var(--surface);padding:6px 8px;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;font-size:11px;">
        <div>
          <span style="font-family:'Oswald',sans-serif;font-weight:700;color:var(--blue);font-size:12px;">Summary · ${label}</span>
          <span style="color:var(--muted);margin-left:6px;">${o.poss.toLocaleString()} Off / ${d.poss.toLocaleString()} Def Poss</span>
        </div>
        <div style="display:flex;gap:10px;font-family:'Oswald',sans-serif;font-size:12px;">
          <span>OffRtg: <b style="color:var(--blue);">${o.rtg.toFixed(1)}</b></span>
          <span>DefRtg: <b style="color:var(--blue);">${d.rtg.toFixed(1)}</b></span>
          <span>NetRtg: <b style="color:${netCol};">${net >= 0 ? '+' : ''}${net.toFixed(1)}</b>${diffTag}</span>
        </div>
      </div>
      <div style="font-size:10.5px;color:var(--text);margin-top:4px;padding-top:4px;border-top:1px solid var(--border);">
        <b style="color:var(--blue);">Capitanes:</b> eFG <b>${o.efg.toFixed(1)}%</b> · TOV <b>${o.tov.toFixed(1)}%</b> · OREB <b>${o.oreb.toFixed(1)}%</b> · FTr <b>${o.ftr.toFixed(1)}%</b>
        &nbsp;|&nbsp;
        <b style="color:var(--dim);">Opponents:</b> eFG <b>${d.efg.toFixed(1)}%</b> · TOV <b>${d.tov.toFixed(1)}%</b> · OREB <b>${d.oreb.toFixed(1)}%</b> · FTr <b>${d.ftr.toFixed(1)}%</b>
      </div>
    </div>`;
}

﻿function computeHeaderMetrics(shots, fts, tovs, exactPossCount) {
  const fga = shots.length;
  const fg2a = shots.filter(s => s.val === 2).length;
  const fg2m = shots.filter(s => s.val === 2 && s.made === 1).length;
  const fg3a = shots.filter(s => s.val === 3).length;
  const fg3m = shots.filter(s => s.val === 3 && s.made === 1).length;

  const ftList = fts || [];
  const tovCount = (tovs || []).length;

  const ft2List = ftList.filter(f => f.val === 2);
  const ft2Made = ft2List.reduce((a, f) => a + f.made, 0);
  const ft2NoAnd1Att = ft2List.filter(f => !f.and1).length;
  const ts2Denom = 2 * (fg2a + 0.5 * ft2NoAnd1Att);
  const ts2Pct = ts2Denom > 0 ? (((2 * fg2m + ft2Made) / ts2Denom) * 100).toFixed(1) : '0.0';

  const ft3List = ftList.filter(f => f.val === 3);
  const ft3Made = ft3List.reduce((a, f) => a + f.made, 0);
  const ft3NoAnd1Att = ft3List.filter(f => !f.and1).length;
  const ts3Denom = 2 * (fg3a + 0.3333 * ft3NoAnd1Att);
  const ts3Pct = ts3Denom > 0 ? (((3 * fg3m + ft3Made) / ts3Denom) * 100).toFixed(1) : '0.0';

  const totFta = ftList.length;
  const fg2Pct = fg2a > 0 ? ((fg2m / fg2a) * 100).toFixed(1) : '0.0';
  const fg3Pct = fg3a > 0 ? ((fg3m / fg3a) * 100).toFixed(1) : '0.0';
  const ftr = fga > 0 ? ((totFta / fga) * 100).toFixed(1) : '0.0';
  const threePar = fga > 0 ? ((fg3a / fga) * 100).toFixed(1) : '0.0';
  const ftTrips = ftList.filter(f => !f.and1 && f.val > 0).length / 2;
  const possDenom = exactPossCount > 0 ? exactPossCount : (fga + ftTrips + tovCount);
  const tovPct = possDenom > 0 ? ((tovCount / possDenom) * 100).toFixed(1) : '0.0';

  return `
    2PM-2PA: <span style="color:var(--blue);">${fg2m}-${fg2a}</span> ·
    2PT%: <span style="color:var(--blue);">${fg2Pct}%</span> ·
    2PT TS%: <span style="color:var(--blue);">${ts2Pct}%</span> &nbsp;|&nbsp;
    3PM-3PA: <span style="color:var(--blue);">${fg3m}-${fg3a}</span> ·
    3PT%: <span style="color:var(--blue);">${fg3Pct}%</span> ·
    3PT TS%: <span style="color:var(--blue);">${ts3Pct}%</span> &nbsp;|&nbsp;
    FTr: <span style="color:var(--blue);">${ftr}%</span> ·
    3PAr: <span style="color:var(--blue);">${threePar}%</span> ·
    TOV%: <span style="color:var(--blue);">${tovPct}%</span>
  `;
}
let _shotData = null;
let _xrefMap = {};
let _teamOffBench = {};
let _teamDefBench = {};
const _onSet = new Set();
const _offSet = new Set();

const SILHOUETTE_SVG = `<svg viewBox="0 0 44 44"><circle cx="22" cy="16" r="8" fill="#CBD5E1"/><path d="M8 40c0-8 6-13 14-13s14 5 14 13" fill="#CBD5E1"/></svg>`;

function classifyCbbZone(s) {
  const { x, y, dist, val } = s;
  if (dist <= 4) return 'Restricted Area';
  if (val === 2 && Math.abs(x) <= 80 && y <= 142.5) return 'Paint (Non-RA)';
  if (val === 2) {
    if (x < -75 && y <= 115) return 'Left Baseline Mid';
    if (x > 75 && y <= 115) return 'Right Baseline Mid';
    if (x < -55) return 'Left Elbow / Wing Mid';
    if (x > 55) return 'Right Elbow / Wing Mid';
    return 'Top of Key Mid';
  }
  if (y <= 92.5 && x <= -220) return 'Left Corner 3';
  if (y <= 92.5 && x >= 220) return 'Right Corner 3';
  if (x < -85) return 'Left Wing 3';
  if (x > 85) return 'Right Wing 3';
  return 'Top of Key 3';
}

const LG_ZONE_BENCH = {
  'Restricted Area': 0.655, 'Paint (Non-RA)': 0.435,
  'Left Baseline Mid': 0.405, 'Right Baseline Mid': 0.405,
  'Left Elbow / Wing Mid': 0.415, 'Right Elbow / Wing Mid': 0.415, 'Top of Key Mid': 0.420,
  'Left Corner 3': 0.382, 'Right Corner 3': 0.382,
  'Left Wing 3': 0.358, 'Right Wing 3': 0.358, 'Top of Key 3': 0.355,
};

const ZONE_SHAPES = {
  'Left Corner 3':         { d: 'M -250 -47.5 L -220 -47.5 L -220 92.5 L -250 92.5 Z', lx: -235, ly: 25 },
  'Right Corner 3':        { d: 'M 220 -47.5 L 250 -47.5 L 250 92.5 L 220 92.5 Z',   lx: 235,  ly: 25 },
  'Left Wing 3':           { d: 'M -250 92.5 L -220 92.5 A 237.5 237.5 0 0 0 -85 221.5 L -165 422.5 L -250 422.5 Z', lx: -175, ly: 225 },
  'Top of Key 3':          { d: 'M -85 221.5 A 237.5 237.5 0 0 0 85 221.5 L 165 422.5 L -165 422.5 Z',               lx: 0,    ly: 295 },
  'Right Wing 3':          { d: 'M 85 221.5 A 237.5 237.5 0 0 0 220 92.5 L 250 92.5 L 250 422.5 L 165 422.5 Z',    lx: 175,  ly: 225 },
  'Left Baseline Mid':     { d: 'M -220 -47.5 L -80 -47.5 L -80 92.5 L -220 92.5 Z',  lx: -150, ly: 25 },
  'Right Baseline Mid':    { d: 'M 80 -47.5 L 220 -47.5 L 220 92.5 L 80 92.5 Z',     lx: 150,  ly: 25 },
  'Left Elbow / Wing Mid': { d: 'M -220 92.5 L -80 92.5 L -80 142.5 L -50 142.5 L -85 221.5 A 237.5 237.5 0 0 1 -220 92.5 Z', lx: -135, ly: 145 },
  'Top of Key Mid':        { d: 'M -50 142.5 L 50 142.5 L 85 221.5 A 237.5 237.5 0 0 1 -85 221.5 Z', lx: 0, ly: 185 },
  'Right Elbow / Wing Mid':{ d: 'M 50 142.5 L 80 142.5 L 80 92.5 L 220 92.5 A 237.5 237.5 0 0 1 85 221.5 Z', lx: 135, ly: 145 },
  'Paint (Non-RA)':        { d: 'M -80 -47.5 L 80 -47.5 L 80 142.5 L -80 142.5 Z',    lx: 0,    ly: 95 },
  'Restricted Area':       { d: 'M -40 -47.5 L 40 -47.5 L 40 0 A 40 40 0 0 1 -40 0 Z', lx: 0,   ly: 12 },
};

function computeTeamBenchmarks(shots, side) {
  const counts = {};
  Object.keys(ZONE_SHAPES).forEach(z => counts[z] = { fga: 0, fgm: 0 });
  shots.filter(s => s.side === side).forEach(s => {
    const z = classifyCbbZone(s);
    counts[z].fga += 1;
    counts[z].fgm += s.made;
  });
  const out = {};
  Object.entries(counts).forEach(([z, g]) => {
    out[z] = g.fga > 0 ? g.fgm / g.fga : (LG_ZONE_BENCH[z] || 0.40);
  });
  return out;
}
async function loadShotSeason() {
  const season = document.getElementById('scSeason')?.value || '2025-26';
  const grid = document.getElementById('scGrid');
  grid.innerHTML = `<div style="color:var(--muted);font-size:12px;">Loading ${season} shot data...</div>`;

  try {
    const [sResp, lResp] = await Promise.all([
      fetch(`data/shot_charts_${season}.json?v=${Date.now()}`),
      fetch(`data/lineup_data_${season}.json?v=${Date.now()}`).catch(() => null),
    ]);
    if (!sResp.ok) throw new Error(`HTTP ${sResp.status}`);
    _shotData = await sResp.json();

    _teamOffBench = computeTeamBenchmarks(_shotData.shots || [], 'off');
    _teamDefBench = computeTeamBenchmarks(_shotData.shots || [], 'def');

    _xrefMap = {};
    if (lResp && lResp.ok) {
      const lJson = await lResp.json();
      Object.values(lJson.playerXref || {}).forEach(info => {
        if (info?.name) _xrefMap[info.name.toLowerCase()] = info;
      });
    }

    const sel = document.getElementById('scPlayer');
    if (sel) {
      const opts = (_shotData.players || [])
        .slice().sort((a, b) => a.name.localeCompare(b.name))
        .map(p => `<option value="${p.id}">${p.name}</option>`)
        .join('');
      sel.innerHTML = `<option value="ALL">All Capitanes (Team)</option>${opts}`;
    }

    _incGames.clear();
    _excGames.clear();
    buildGameMenu();

    _onSet.clear();
    _offSet.clear();
    buildRosterStrip();
    renderShotPage();
  } catch (e) {
    grid.innerHTML = `<div style="color:var(--red);font-size:12px;">Error: ${e.message}</div>`;
  }
}

function buildRosterStrip() {
  const strip = document.getElementById('scRosterStrip');
  if (!strip || !_shotData) return;

  const shotCounts = {};
  _shotData.shots.forEach(s => {
    if (s.side === 'off') (s.on || []).forEach(id => shotCounts[id] = (shotCounts[id] || 0) + 1);
  });

  const sortedPlayers = [...(_shotData.players || [])]
    .filter(p => (shotCounts[p.id] || 0) > 0)
    .sort((a, b) => (shotCounts[b.id] || 0) - (shotCounts[a.id] || 0));

  strip.innerHTML = sortedPlayers.map(p => {
    const isOn = _onSet.has(p.id);
    const isOff = _offSet.has(p.id);
    const meta = _xrefMap[p.name.toLowerCase()] || {};
    const imgHtml = meta.photoUrl
      ? `<img src="${meta.photoUrl}" alt="${p.name}" onerror="this.outerHTML='${SILHOUETTE_SVG.replace(/"/g, '&quot;')}'">`
      : SILHOUETTE_SVG;
    const shortName = getCleanLastName(p.name);

    return `
      <div class="sc-pcard ${isOn ? 'is-on' : (isOff ? 'is-off' : '')}">
        ${imgHtml}
        <span class="sc-pname" title="${p.name} (click for individual shots)" onclick="selectIndividualShooter(${p.id})">${shortName}</span>
        <div class="sc-toggles">
          <button class="sc-tbtn ${isOn ? 'on-active' : ''}" onclick="togglePlayerState(${p.id}, 'on')">ON</button>
          <button class="sc-tbtn ${isOff ? 'off-active' : ''}" onclick="togglePlayerState(${p.id}, 'off')">OFF</button>
        </div>
      </div>`;
  }).join('');
}

function togglePlayerState(pid, state) {
  if (state === 'on') {
    if (_onSet.has(pid)) _onSet.delete(pid);
    else { if (_onSet.size >= 5) return; _offSet.delete(pid); _onSet.add(pid); }
  } else {
    if (_offSet.has(pid)) _offSet.delete(pid);
    else { _onSet.delete(pid); _offSet.add(pid); }
  }
  const sel = document.getElementById('scPlayer');
  if (sel && (_onSet.size > 0 || _offSet.size > 0)) sel.value = 'ALL';
  const mSel = document.getElementById('scMode');
  if (mSel) mSel.value = 'team';
  buildRosterStrip();
  renderShotPage();
}

function clearLineupToggles() {
  _onSet.clear();
  _offSet.clear();
  const sel = document.getElementById('scPlayer');
  if (sel) sel.value = 'ALL';
  buildRosterStrip();
  renderShotPage();
}

function selectIndividualShooter(pid) {
  _onSet.clear();
  _offSet.clear();
  const sel = document.getElementById('scPlayer');
  if (sel) sel.value = String(pid);
  const modeSel = document.getElementById('scMode');
  if (modeSel) modeSel.value = 'ind';
  buildRosterStrip();
  renderShotPage();
}

function onShooterSelect() {
  _onSet.clear();
  _offSet.clear();
  const mSel = document.getElementById('scMode');
  const pSel = document.getElementById('scPlayer');
  if (mSel && pSel) mSel.value = (pSel.value === 'ALL') ? 'team' : 'ind';
  buildRosterStrip();
  renderShotPage();
}
function getZoneFill(fgPct, bench, fga, sharePct, baseMode, isDef) {
  if (fga === 0) return { fill: '#F3F4F6', text: '#6B7280' };
  if (baseMode === 'freq') {
    if (sharePct >= 22) return { fill: 'rgba(22, 49, 255, 0.78)', text: '#FFFFFF' };
    if (sharePct >= 12) return { fill: 'rgba(22, 49, 255, 0.45)', text: '#FFFFFF' };
    if (sharePct >= 6)  return { fill: 'rgba(22, 49, 255, 0.20)', text: '#0A0A0A' };
    return { fill: '#F3F4F6', text: '#333333' };
  }
  const diff = isDef ? (bench - fgPct) : (fgPct - bench);
  if (diff >= 0.08)  return { fill: 'rgba(24, 175, 74, 0.78)', text: '#FFFFFF' };
  if (diff >= 0.03)  return { fill: 'rgba(24, 175, 74, 0.42)', text: '#0A0A0A' };
  if (diff <= -0.08) return { fill: 'rgba(216, 31, 42, 0.78)', text: '#FFFFFF' };
  if (diff <= -0.03) return { fill: 'rgba(216, 31, 42, 0.42)', text: '#0A0A0A' };
  return { fill: 'rgba(255, 212, 0, 0.35)', text: '#0A0A0A' };
}

function groupShotsByZone(shots) {
  const grouped = {};
  Object.keys(ZONE_SHAPES).forEach(z => grouped[z] = { fga: 0, fgm: 0, pts: 0 });
  shots.forEach(s => {
    const z = classifyCbbZone(s);
    grouped[z].fga += 1;
    grouped[z].fgm += s.made;
    grouped[z].pts += s.made ? s.val : 0;
  });
  return grouped;
}

function buildCourtCard(title, shots, view, baseMode, isDef, subFts, subTovs, exactPossCount) {
  const totalFga = shots.length;
  const totalFgm = shots.reduce((a, s) => a + s.made, 0);
  const total3a = shots.reduce((a, s) => a + (s.val === 3 ? 1 : 0), 0);
  const total3m = shots.reduce((a, s) => a + (s.made && s.val === 3 ? 1 : 0), 0);
  const totalPts = shots.reduce((a, s) => a + (s.made ? s.val : 0), 0);

  const fgPct = totalFga ? ((totalFgm / totalFga) * 100).toFixed(1) : '0.0';
  const efgPct = totalFga ? (((totalFgm + 0.5 * total3m) / totalFga) * 100).toFixed(1) : '0.0';
  const pps = totalFga ? (totalPts / totalFga).toFixed(2) : '0.00';
  const threePar = totalFga ? ((total3a / totalFga) * 100).toFixed(1) : '0.0';

  const grouped = groupShotsByZone(shots);
  const teamBench = isDef ? _teamDefBench : _teamOffBench;
  const benchLabel = baseMode === 'team' ? 'MXC Avg' : 'LG Avg';

  let polygonsSvg = '';
  let labelsSvg = '';
  if (view === 'zones' || view === 'hybrid') {
    Object.entries(ZONE_SHAPES).forEach(([z, cfg]) => {
      const g = grouped[z];
      const bench = baseMode === 'team' ? (teamBench[z] || 0.40) : (LG_ZONE_BENCH[z] || 0.40);
      const pct = g.fga > 0 ? g.fgm / g.fga : 0;
      const shareNum = totalFga > 0 ? (g.fga / totalFga) * 100 : 0;
      const { fill, text } = getZoneFill(pct, bench, g.fga, shareNum, baseMode, isDef);
      const pctLabel = g.fga > 0 ? `${(pct * 100).toFixed(0)}%` : '—';

      polygonsSvg += `<path d="${cfg.d}" fill="${fill}" stroke="#FFFFFF" stroke-width="2">
        <title>${z}: ${g.fgm}/${g.fga} (${pctLabel}) | ${benchLabel}: ${(bench * 100).toFixed(1)}% | Share: ${shareNum.toFixed(1)}%</title>
      </path>`;

      const halo = text === '#FFFFFF' ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
      const isCorner = z.includes('Corner');
      const subTxt = isCorner ? `${shareNum.toFixed(0)}% sh` : `${g.fgm}/${g.fga} (${shareNum.toFixed(0)}%)`;
      labelsSvg += `
        <g transform="translate(${cfg.lx}, ${cfg.ly})" pointer-events="none">
          <text class="sc-svg-lbl" stroke="${halo}" x="0" y="-4" text-anchor="middle" font-family="Oswald, sans-serif" font-size="${isCorner ? 13 : 16}" font-weight="700" fill="${text}">${pctLabel}</text>
          <text class="sc-svg-lbl" stroke="${halo}" x="0" y="9" text-anchor="middle" font-family="Oswald, sans-serif" font-size="${isCorner ? 9.5 : 11}" font-weight="600" fill="${text}">${subTxt}</text>
        </g>`;
    });
  }

  let dotsSvg = '';
  if (view === 'dots' || view === 'hybrid') {
    dotsSvg = shots.map(s => {
      const color = s.made ? '#117A34' : '#B91C1C';
      const fill = s.made ? '#18AF4A' : 'none';
      return `<circle cx="${s.x}" cy="${s.y}" r="3.6" fill="${fill}" fill-opacity="0.8" stroke="${color}" stroke-width="1.2">
        <title>${s.shooter} — ${s.made ? 'MADE' : 'MISS'} (${s.dist}ft ${s.sub})</title>
      </circle>`;
    }).join('');
  }

  const courtLines = `
    <rect x="-250" y="-47.5" width="500" height="470" fill="none" stroke="#222" stroke-width="2"/>
    <rect x="-80" y="-47.5" width="160" height="190" fill="none" stroke="#222" stroke-width="1.4"/>
    <circle cx="0" cy="142.5" r="60" fill="none" stroke="#222" stroke-width="1.4"/>
    <line x1="-220" y1="-47.5" x2="-220" y2="92.5" stroke="#222" stroke-width="1.6"/>
    <line x1="220" y1="-47.5" x2="220" y2="92.5" stroke="#222" stroke-width="1.6"/>
    <path d="M -220 92.5 A 237.5 237.5 0 0 0 220 92.5" fill="none" stroke="#222" stroke-width="1.6"/>
    <path d="M -40 0 A 40 40 0 0 0 40 0" fill="none" stroke="#222" stroke-width="1.4"/>
    <line x1="-30" y1="-7.5" x2="30" y2="-7.5" stroke="#111" stroke-width="2.5"/>
    <circle cx="0" cy="0" r="7.5" fill="none" stroke="#111" stroke-width="2"/>
  `;

  const tableRows = Object.entries(grouped)
    .filter(([, g]) => g.fga > 0)
    .sort((a, b) => b.fga - a.fga)
    .map(([z, g]) => {
      const lgB = LG_ZONE_BENCH[z] || 0.40;
      const tmB = teamBench[z] || 0.40;
      const pct = g.fgm / g.fga;
      const diffLg = (pct - lgB) * 100;
      const diffTm = (pct - tmB) * 100;
      const share = ((g.fga / totalFga) * 100).toFixed(1);
      const zPps = (g.pts / g.fga).toFixed(2);
      const cLg = (isDef ? -diffLg : diffLg) >= 3 ? 'var(--green)' : ((isDef ? -diffLg : diffLg) <= -3 ? 'var(--red)' : 'var(--dim)');
      const cTm = (isDef ? -diffTm : diffTm) >= 3 ? 'var(--green)' : ((isDef ? -diffTm : diffTm) <= -3 ? 'var(--red)' : 'var(--dim)');
      return `<tr>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);font-weight:600;">${z}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${g.fgm}-${g.fga}</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${(pct * 100).toFixed(1)}%</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:${cTm};">${diffTm >= 0 ? '+' : ''}${diffTm.toFixed(1)}%</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:${cLg};">${diffLg >= 0 ? '+' : ''}${diffLg.toFixed(1)}%</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${share}%</td>
        <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${zPps}</td>
      </tr>`;
    }).join('');

  return `
    <div class="sc-card">
      <div class="sc-card-title">${title}</div>
      <div class="sc-card-sub">
        ${computeHeaderMetrics(shots, subFts, subTovs, exactPossCount)}
      </div>
      <div class="sc-card-body"><div class="sc-court-wrap"><svg viewBox="-250 -47.5 500 470" style="width:100%;height:auto;display:block;background:#FAFAFA;border:1px solid var(--border);">
        ${polygonsSvg}
        ${courtLines}
        ${dotsSvg}
        ${labelsSvg}
      </svg></div><div class="sc-table-wrap">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <thead>
            <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
              <th style="padding:4px 5px;text-align:left;border-bottom:1px solid var(--border);">Zone</th>
              <th style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);">FGM-FGA</th>
              <th style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);">FG%</th>
              <th style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);">vs MXC</th>
              <th style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);">vs LG</th>
              <th style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);">Share%</th>
              <th style="padding:4px 5px;text-align:right;border-bottom:1px solid var(--border);">PPS</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody></table>${buildShotTypeTableHtml(shots)}</div></div></div>`;
}
function buildOnOffDeltaCard(tag, onOffShots, allTeamOffShots, onDefShots, allTeamDefShots) {
  const gOn = groupShotsByZone(onOffShots);
  const gTm = groupShotsByZone(allTeamOffShots);
  const dOn = groupShotsByZone(onDefShots);
  const dTm = groupShotsByZone(allTeamDefShots);

  const totOn = onOffShots.length || 1;
  const totTm = allTeamOffShots.length || 1;
  const totDOn = onDefShots.length || 1;
  const totDTm = allTeamDefShots.length || 1;

  const rows = Object.keys(ZONE_SHAPES).map(z => {
    const offFreqDiff = ((gOn[z].fga / totOn) - (gTm[z].fga / totTm)) * 100;
    const offFgOn = gOn[z].fga ? (gOn[z].fgm / gOn[z].fga) * 100 : null;
    const offFgTm = gTm[z].fga ? (gTm[z].fgm / gTm[z].fga) * 100 : null;
    const offFgDiff = (offFgOn != null && offFgTm != null) ? (offFgOn - offFgTm) : null;

    const defFreqDiff = ((dOn[z].fga / totDOn) - (dTm[z].fga / totDTm)) * 100;
    const defFgOn = dOn[z].fga ? (dOn[z].fgm / dOn[z].fga) * 100 : null;
    const defFgTm = dTm[z].fga ? (dTm[z].fgm / dTm[z].fga) * 100 : null;
    const defFgDiff = (defFgOn != null && defFgTm != null) ? (defFgOn - defFgTm) : null;

    const fmt = (v, invert = false) => {
      if (v == null) return '<span style="color:var(--muted);">—</span>';
      const good = invert ? v <= -2.5 : v >= 2.5;
      const bad = invert ? v >= 2.5 : v <= -2.5;
      const col = good ? 'var(--green)' : (bad ? 'var(--red)' : 'var(--dim)');
      return `<span style="color:${col};font-weight:700;">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
    };

    return `<tr>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);font-weight:600;">${z}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmt(offFreqDiff)}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmt(offFgDiff)}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmt(defFreqDiff, true)}</td>
      <td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:right;">${fmt(defFgDiff, true)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="sc-card" >
      <div class="sc-card-title">Lineup Shot Profile Shift vs. Capitanes Team Baseline (${tag})</div>
      <div class="sc-card-sub">Compares Shot Frequency Share% and FG% when this combination is on court against full-team averages</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;font-size:10px;">
              <th style="padding:4px 6px;text-align:left;border-bottom:1px solid var(--border);">Zone</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">Off Freq Shift</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">Off FG% vs MXC</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">Opp Freq Shift</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">Opp FG% vs MXC</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderShotPage() {
  if (!_shotData) return;
  const sel = document.getElementById('scPlayer');
  const pidVal = sel?.value || 'ALL';
  const pid = pidVal === 'ALL' ? null : Number(pidVal);
  const playerName = sel && sel.selectedIndex >= 0 ? sel.options.item(sel.selectedIndex).text : 'All Capitanes (Team)';
  const mode = document.getElementById('scMode')?.value || 'auto';
  const baseMode = document.getElementById('scBaseline')?.value || 'lg';
  const view = document.getElementById('scView')?.value || 'zones';
  const gameVal = document.getElementById('scGame')?.value || 'ALL';
  const segVal = _quickSplits.seg;
  const locVal = _quickSplits.loc;
  const outVal = _quickSplits.wl;
  const lastNVal = document.getElementById('scLastN')?.value || 'ALL';
  const periodVal = _quickSplits.per;
  const shotTypeVal = document.getElementById('scShotType')?.value || 'ALL';
  const grid = document.getElementById('scGrid');

  const maxOrder = _shotData.meta?.total_games || Math.max(..._shotData.shots.map(s => s.gord || 0), 0);
  const minOrder = lastNVal === 'ALL' ? 0 : maxOrder - Number(lastNVal) + 1;

  const filteredBase = _shotData.shots.filter(s => {
    if (gameVal !== 'ALL' && s.gid !== gameVal) return false;
    if (segVal !== 'ALL' && s.st && s.st !== segVal) return false;
    if (locVal !== 'ALL' && s.loc && s.loc !== locVal) return false;
    if (outVal !== 'ALL' && s.wl && s.wl !== outVal) return false;
    if (lastNVal !== 'ALL' && s.gord && s.gord < minOrder) return false;
    if (periodVal === 'H1' && s.p > 2) return false;
    if (periodVal === 'H2' && (s.p < 3 || s.p > 4)) return false;
    if (periodVal === 'OT' && s.p <= 4) return false;
    if (['1', '2', '3', '4'].includes(periodVal) && s.p !== Number(periodVal)) return false;

    if (shotTypeVal !== 'ALL') {
      const sub = (s.sub || '').toLowerCase();
      if (shotTypeVal === 'RIM' && !/(layup|dunk|tip|alley)/i.test(sub)) return false;
      if (shotTypeVal === 'CATCH' && (!/jump/i.test(sub) || /pullup|step back|turnaround|fadeaway/i.test(sub))) return false;
      if (shotTypeVal === 'PULLUP' && !/(pullup|step back|fadeaway)/i.test(sub)) return false;
      if (shotTypeVal === 'FLOATER' && !/(floating|hook|bank)/i.test(sub)) return false;
    }
    return true;
  });

  const hasToggles = _onSet.size > 0 || _offSet.size > 0;
  const idToLast = {};
  (_shotData.players || []).forEach(p => idToLast[p.id] = getCleanLastName(p.name));

  if (mode === 'team' || hasToggles || pid === null) {
    const onIds = [..._onSet];
    const offIds = [..._offSet];
    const comboShots = filteredBase.filter(s =>
      onIds.every(id => (s.on || []).includes(id)) &&
      offIds.every(id => !(s.on || []).includes(id))
    );

    const parts = [];
    if (onIds.length) parts.push(`ON: ${onIds.map(id => idToLast[id]).join(', ')}`);
    if (offIds.length) parts.push(`OFF: ${offIds.map(id => idToLast[id]).join(', ')}`);
    const tag = parts.length ? parts.join(' | ') : 'All Capitanes';

    const offShots = comboShots.filter(s => s.side === 'off');
    const defShots = comboShots.filter(s => s.side === 'def');
    const allOff = filteredBase.filter(s => s.side === 'off');
    const allDef = filteredBase.filter(s => s.side === 'def');

    if (mode === 'team_off') {
      grid.innerHTML = buildCourtCard(`Capitanes Offense`, offShots, view, baseMode, false);
    } else if (mode === 'team_def') {
      grid.innerHTML = buildCourtCard(`Capitanes Defense`, defShots, view, baseMode, true);
    } else {
      grid.innerHTML = 
        buildCourtCard(`Capitanes Offense`, offShots, view, baseMode, false) +
        buildCourtCard(`Capitanes Defense`, defShots, view, baseMode, true) +
        (hasToggles ? buildOnOffDeltaCard(tag, offShots, allOff, defShots, allDef) : '');
    }
    return;
  }

  const sub = filteredBase.filter(s => s.side === 'off' && (pid === null || s.pid === pid));
  grid.innerHTML = buildInsightsBox(playerName, sub, null, filteredBase.filter(s => s.side === 'off'), null, false) + buildCourtCard(playerName, sub, view, baseMode, false);
}

document.addEventListener('DOMContentLoaded', loadShotSeason);
function buildInsightsBox(label, offShots, defShots, allOffShots, allDefShots, hasToggles) {
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
      <div class="sc-card-title" style="font-size:13px;">Insights</div>
      <ul style="margin:4px 0 0 16px;padding:0;font-size:11px;line-height:1.45;color:var(--text);">
        ${bullets.map(b => `<li style="margin-bottom:3px;">${b}</li>`).join('')}
      </ul>
    </div>`;
}
function buildTurnoverCard(label, offTovs, defTovs, isIndividual, pid, playerShots, playerFts) {
  if ((!offTovs || !offTovs.length) && (!defTovs || !defTovs.length)) return '';

  const splitPassScore = (list) => {
    let pass = 0, scoring = 0;
    list.forEach(t => {
      const s = (t.sub || '').toLowerCase();
      if (s.includes('bad pass')) pass++;
      else scoring++;
    });
    return { tot: list.length, pass, scoring };
  };

  // Verified 558-game G League TM_TOV_PCT * full-season Passing/Scoring share
  const lgFf = _shotData?.leagueFourFactors || {};
  const passShare = lgFf.pass_share != null ? (lgFf.pass_share / 100) : 0.4358;
  const scoreShare = lgFf.score_share != null ? (lgFf.score_share / 100) : 0.5642;
  const lgTotTov = lgFf.tov_pct != null ? lgFf.tov_pct : 15.12;
  const LG_PASS_RATE = lgTotTov * passShare;
  const LG_SCORE_RATE = lgTotTov * scoreShare;

  const fmtLgDelta = (val, base) => {
    const d = val - base;
    const col = d >= 1.5 ? 'var(--red)' : (d <= -1.5 ? 'var(--green)' : 'var(--dim)');
    return `<span style="color:${col};font-weight:700;">${d >= 0 ? '+' : ''}${d.toFixed(1)}% vs LG</span>`;
  };

  if (isIndividual && pid) {
    const pTovs = offTovs.filter(t => t.pid === pid);
    if (!pTovs.length) return '';

    const pShots = playerShots || [];
    const pFts = playerFts || [];
    const pFtTrips = pFts.filter(f => !f.and1 && f.val > 0).length / 2;
    const pUsed = Math.max(1, pShots.length + pFtTrips + pTovs.length);

    const pCat = splitPassScore(pTovs);
    const passRate = (pCat.pass / pUsed) * 100;
    const scoreRate = (pCat.scoring / pUsed) * 100;
    const totRate = (pCat.tot / pUsed) * 100;

    return `
      <div class="sc-card">
        <div class="sc-card-title" style="font-size:13px;">Turnovers · ${label}</div>
        <div class="sc-card-sub">
          Total: <b>${pCat.tot}</b> TOVs across <b>${Math.round(pUsed)}</b> Plays Used (<b>${totRate.toFixed(1)}%</b> Indiv TOV% · ${fmtLgDelta(totRate, lgTotTov)})
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
          <thead>
            <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;">
              <th style="padding:3px 5px;text-align:left;border-bottom:1px solid var(--border);">Category</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">Count</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">TOV Share</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">Rate / Play</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">LG Avg</th>
              <th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">vs. League</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);font-weight:600;">Passing Turnovers</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${pCat.pass}</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${((pCat.pass / pCat.tot) * 100).toFixed(0)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${passRate.toFixed(1)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${LG_PASS_RATE.toFixed(1)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${fmtLgDelta(passRate, LG_PASS_RATE)}</td>
            </tr>
            <tr>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);font-weight:600;">Scoring Turnovers</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${pCat.scoring}</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${((pCat.scoring / pCat.tot) * 100).toFixed(0)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${scoreRate.toFixed(1)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${LG_SCORE_RATE.toFixed(1)}%</td>
              <td style="padding:3px 5px;border-bottom:1px solid var(--border);text-align:right;">${fmtLgDelta(scoreRate, LG_SCORE_RATE)}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  const mxc = splitPassScore(offTovs);
  const opp = splitPassScore(defTovs);

  return `
    <div class="sc-card">
      <div class="sc-card-title" style="font-size:13px;">Turnovers · ${label}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;font-size:10.5px;">
        <div style="border:1px solid var(--border);padding:5px 7px;background:var(--surface);">
          <div style="font-family:'Oswald',sans-serif;font-weight:700;color:var(--red);margin-bottom:2px;">CAPITANES TOVs (${mxc.tot})</div>
          <div>Passing: <b>${mxc.pass}</b> (${mxc.tot ? ((mxc.pass / mxc.tot) * 100).toFixed(0) : 0}%) · Scoring: <b>${mxc.scoring}</b> (${mxc.tot ? ((mxc.scoring / mxc.tot) * 100).toFixed(0) : 0}%)</div>
        </div>
        <div style="border:1px solid var(--border);padding:5px 7px;background:var(--surface);">
          <div style="font-family:'Oswald',sans-serif;font-weight:700;color:var(--green);margin-bottom:2px;">FORCED OPP TOVs (${opp.tot})</div>
          <div>Passing: <b>${opp.pass}</b> (${opp.tot ? ((opp.pass / opp.tot) * 100).toFixed(0) : 0}%) · Scoring: <b>${opp.scoring}</b> (${opp.tot ? ((opp.scoring / opp.tot) * 100).toFixed(0) : 0}%)</div>
        </div>
      </div>
    </div>`;
}
function matchBaseFilters(item, gameVal, segVal, locVal, outVal, minOrder, periodVal) {
  if (_incGames.size > 0 && !_incGames.has(item.gid)) return false;
  if (_excGames.has(item.gid)) return false;
  if (segVal !== 'ALL' && item.st && item.st !== segVal) return false;
  if (locVal !== 'ALL' && item.loc && item.loc !== locVal) return false;
  if (outVal !== 'ALL' && item.wl && item.wl !== outVal) return false;
  if (minOrder > 0 && item.gord && item.gord < minOrder) return false;
  if (periodVal === 'H1' && item.p > 2) return false;
  if (periodVal === 'H2' && (item.p < 3 || item.p > 4)) return false;
  if (periodVal === 'OT' && item.p <= 4) return false;
  if (['1', '2', '3', '4'].includes(periodVal) && item.p !== Number(periodVal)) return false;
  return true;
}

function renderShotPage() {
  if (!_shotData) return;
  const sel = document.getElementById('scPlayer');
  const pidVal = sel?.value || 'ALL';
  const pid = pidVal === 'ALL' ? null : Number(pidVal);
  const playerName = sel && sel.selectedIndex >= 0 ? sel.options.item(sel.selectedIndex).text : 'All Capitanes (Team)';
  const mode = document.getElementById('scMode')?.value || 'auto';
  const baseMode = document.getElementById('scBaseline')?.value || 'lg';
  const view = document.getElementById('scView')?.value || 'zones';
  const gameVal = document.getElementById('scGame')?.value || 'ALL';
  const segVal = _quickSplits.seg;
  const locVal = _quickSplits.loc;
  const outVal = _quickSplits.wl;
  const lastNVal = document.getElementById('scLastN')?.value || 'ALL';
  const periodVal = _quickSplits.per;
  const shotTypeVal = document.getElementById('scShotType')?.value || 'ALL';
  const grid = document.getElementById('scGrid');

  const maxOrder = _shotData.meta?.total_games || Math.max(..._shotData.shots.map(s => s.gord || 0), 0);
  const minOrder = lastNVal === 'ALL' ? 0 : maxOrder - Number(lastNVal) + 1;

  const filteredBase = _shotData.shots.filter(s => {
    if (!matchBaseFilters(s, gameVal, segVal, locVal, outVal, minOrder, periodVal)) return false;
    if (shotTypeVal !== 'ALL') {
      const sub = (s.sub || '').toLowerCase();
      if (shotTypeVal === 'RIM' && !/(layup|dunk|tip|alley)/i.test(sub)) return false;
      if (shotTypeVal === 'CATCH' && (!/jump/i.test(sub) || /pullup|step back|turnaround|fadeaway/i.test(sub))) return false;
      if (shotTypeVal === 'PULLUP' && !/(pullup|step back|fadeaway)/i.test(sub)) return false;
      if (shotTypeVal === 'FLOATER' && !/(floating|hook|bank)/i.test(sub)) return false;
    }
    return true;
  });

  const baseFts = (_shotData.fts || []).filter(f => matchBaseFilters(f, gameVal, segVal, locVal, outVal, minOrder, periodVal));
  const baseTovs = (_shotData.turnovers || []).filter(t => matchBaseFilters(t, gameVal, segVal, locVal, outVal, minOrder, periodVal));
  const basePoss = (_shotData.poss || []).filter(p => matchBaseFilters(p, gameVal, segVal, locVal, outVal, minOrder, periodVal));
  const baseEvents = (_shotData.events || []).filter(e => matchBaseFilters(e, gameVal, segVal, locVal, outVal, minOrder, periodVal));

  const hasToggles = _onSet.size > 0 || _offSet.size > 0;
  const idToLast = {};
  (_shotData.players || []).forEach(p => idToLast[p.id] = getCleanLastName(p.name));

  if (mode === 'team' || hasToggles || pid === null) {
    const onIds = [..._onSet];
    const offIds = [..._offSet];
    const matchLineup = (item) =>
      onIds.every(id => (item.on || []).includes(id)) &&
      offIds.every(id => !(item.on || []).includes(id));

    const comboShots = filteredBase.filter(matchLineup);
    const comboFts = baseFts.filter(matchLineup);
    const comboTovs = baseTovs.filter(matchLineup);
    const comboPoss = basePoss.filter(matchLineup);

    const parts = [];
    if (onIds.length) parts.push(`ON: ${onIds.map(id => idToLast[id]).join(', ')}`);
    if (offIds.length) parts.push(`OFF: ${offIds.map(id => idToLast[id]).join(', ')}`);
    const tag = parts.length ? parts.join(' | ') : 'All Capitanes';

    const offShots = comboShots.filter(s => s.side === 'off');
    const defShots = comboShots.filter(s => s.side === 'def');
    const offFts = comboFts.filter(f => f.side === 'off');
    const defFts = comboFts.filter(f => f.side === 'def');
    const offTovs = comboTovs.filter(t => t.side === 'off');
    const defTovs = comboTovs.filter(t => t.side === 'def');
    const offPossList = comboPoss.filter(p => p.side === 'off');
    const defPossList = comboPoss.filter(p => p.side === 'def');
    const offPossCount = offPossList.length;
    const defPossCount = defPossList.length;

    const allOff = filteredBase.filter(s => s.side === 'off');
    const allDef = filteredBase.filter(s => s.side === 'def');
    renderTopMacro(
      tag, offShots, defShots, offFts, defFts, offTovs, defTovs, offPossList, defPossList,
      allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'),
      allDef, baseFts.filter(f => f.side === 'def'), baseTovs.filter(t => t.side === 'def'), basePoss.filter(p => p.side === 'def'), hasToggles
    );

    if (mode === 'team_off') {
      grid.innerHTML = 
        buildCourtCard(`Capitanes Offense`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +
        buildTurnoverCard(tag, offTovs, defTovs, false, null);
    } else if (mode === 'team_def') {
      grid.innerHTML =
        buildCourtCard(`Capitanes Defense`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +
        buildTurnoverCard(tag, offTovs, defTovs, false, null);
    } else {
      const dIns = renderMergedInsights([
        extractInsightBullets(buildQuickSplitInsights(allOff, offFts, offTovs, comboPoss, true)),
        extractInsightBullets(buildInsightsBox(tag, offShots, defShots, allOff, allDef, hasToggles))
      ]);
      const dTov = buildTurnoverCard(tag, offTovs, defTovs, false, null);
      const dDelta = hasToggles ? buildOnOffDeltaCard(tag, offShots, allOff, defShots, allDef) : '';
      grid.innerHTML =
        buildCourtCard(`Capitanes Offense`, offShots, view, baseMode, false, offFts, offTovs, offPossCount) +
        buildCourtCard(`Capitanes Defense`, defShots, view, baseMode, true, defFts, defTovs, defPossCount) +
        
        (dDelta ? dDelta : '') +
        ((dIns || dTov) ? `<div class="sc-stack">${dIns}${dTov}</div>` : '');
    }
    return;
  }

  const sub = filteredBase.filter(s => s.side === 'off' && (pid === null || s.pid === pid));
  const subFts = baseFts.filter(f => f.side === 'off' && (pid === null || f.pid === pid));
  const subTovs = baseTovs.filter(t => t.side === 'off' && (pid === null || t.pid === pid));
  const subPossCount = pid === null ? basePoss.filter(p => p.side === 'off').length : 0;

  const allOff = filteredBase.filter(s => s.side === 'off');
  const allDef = filteredBase.filter(s => s.side === 'def');
  renderTopMacro(
    playerName, allOff, allDef,
    baseFts.filter(f => f.side === 'off'), baseFts.filter(f => f.side === 'def'),
    baseTovs.filter(t => t.side === 'off'), baseTovs.filter(t => t.side === 'def'),
    basePoss.filter(p => p.side === 'off'), basePoss.filter(p => p.side === 'def'),
    allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'),
    allDef, baseFts.filter(f => f.side === 'def'), baseTovs.filter(t => t.side === 'def'), basePoss.filter(p => p.side === 'def'),
    false
  );
  const insHtml = renderMergedInsights([
    extractInsightBullets(buildPlayerInsights(pid, playerName, sub, allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'))),
    extractInsightBullets(buildQuickSplitInsights(sub, subFts, subTovs, null, false)),
    extractInsightBullets(buildInsightsBox(playerName, sub, null, allOff, null, false))
  ]);
  const tovHtml = buildTurnoverCard(playerName, baseTovs.filter(t => t.side === 'off'), baseTovs.filter(t => t.side === 'def'), pid !== null, pid, sub, subFts);
  const extraHtml = buildPlayerExtraCards(
    pid, playerName, sub,
    allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'),
    allDef, baseFts.filter(f => f.side === 'def'), baseTovs.filter(t => t.side === 'def'), basePoss.filter(p => p.side === 'def')
  );
  const synHtml = buildTeammateSynergyCard(
    pid, playerName,
    allOff, baseFts.filter(f => f.side === 'off'), baseTovs.filter(t => t.side === 'off'), basePoss.filter(p => p.side === 'off'), baseEvents
  );
  grid.innerHTML =
    buildCourtCard(playerName, sub, view, baseMode, false, subFts, subTovs, subPossCount) +
    `<div class="sc-stack">${tovHtml}${extraHtml}${insHtml}</div>` +
    synHtml;
}

