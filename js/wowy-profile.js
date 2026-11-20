(function () {
  const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  window._calcPossDre = function (p) {
    if (!p || typeof p !== 'object') return null;
    if (p.dre != null && !isNaN(Number(p.dre))) return Number(p.dre);
    const poss = Number(p.poss ?? p.POSS ?? 0);
    if (poss <= 0) return null;
    const pts = Number(p.pts ?? p.PTS ?? 0);
    const fga = Number(p.fga ?? p.FGA ?? 0);
    const fta = Number(p.fta ?? p.FTA ?? 0);
    const reb = Number(p.reb ?? p.REB ?? 0);
    const ast = Number(p.ast ?? p.AST ?? 0);
    const stl = Number(p.stl ?? p.STL ?? 0);
    const blk = Number(p.blk ?? p.BLK ?? 0);
    const tov = Number(p.tov ?? p.TOV ?? 0);
    return (100 / poss) * (0.792 * pts - 0.719 * fga - 0.299 * fta + 0.145 * reb + 0.369 * ast + 1.662 * stl + 0.696 * blk - 0.844 * tov);
  };

  window._buildLeagueDreIndex = function (liteJson, mexData, llJson) {
    const byPid = {}, byName = {}, byInitialLast = {}, allPlayers = [];
    const addPlayer = (raw, fallbackTeam) => {
      if (!raw || typeof raw !== 'object') return;
      const pid = Number(raw.PLAYER_ID || raw.pid || raw.id || 0);
      const name = String(raw.PLAYER_NAME || raw.name || raw.Player || '').trim();
      const dre = window._calcPossDre(raw);
      const poss = Number(raw.poss ?? raw.POSS ?? 0);
      if (!name || dre == null || isNaN(dre)) return;
      const rec = { pid, name, team: raw.TEAM_ABBREVIATION || raw.abbrev || raw.team || fallbackTeam || '', dre, poss };
      allPlayers.push(rec);
      if (pid) byPid[pid] = rec;
      const nn = normName(name);
      if (nn) byName[nn] = rec;
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const initKey = normName(parts[0][0] + parts.slice(1).join(''));
        if (initKey && !byInitialLast[initKey]) byInitialLast[initKey] = rec;
      }
    };

    const teamsObj = liteJson?.teams || {};
    (Array.isArray(teamsObj) ? teamsObj : Object.values(teamsObj)).forEach(tm => {
      (tm?.rosterStats || []).forEach(p => addPlayer(p, tm?.abbrev || tm?.TEAM_ABBREVIATION));
    });
    (mexData?.players || []).forEach(p => {
      const pid = Number(p.PLAYER_ID || p.id || 0);
      const nn = normName(p.PLAYER_NAME || p.Player || '');
      if ((pid && byPid[pid]) || (nn && byName[nn])) return;
      addPlayer(p, 'MXC');
    });

    const lineupDist = [];
    ['fiveman', 'quads', 'trios'].forEach(tier => {
      (llJson?.[tier] || []).forEach(lu => {
        const w = Number(lu.POSS || lu.MIN || 0);
        if (w <= 0) return;
        const ids = String(lu.GROUP_ID || '').split('-').filter(Boolean).map(Number);
        const names = String(lu.GROUP_NAME || '').split(' - ').map(x => x.trim()).filter(Boolean);
        const vals = [];
        ids.forEach((id, i) => {
          const hit = byPid[id] || (names[i] ? (byName[normName(names[i])] || byInitialLast[normName(names[i])]) : null);
          if (hit) vals.push(hit.dre);
        });
        if (!vals.length && names.length) {
          names.forEach(nm => {
            const hit = byName[normName(nm)] || byInitialLast[normName(nm)];
            if (hit) vals.push(hit.dre);
          });
        }
        if (vals.length) {
          lineupDist.push({ avgDre: vals.reduce((a, b) => a + b, 0) / vals.length, w });
        }
      });
    });

    return { byPid, byName, byInitialLast, allPlayers, lineupDist };
  };

  window._getLgZoneBench = function (liteJson) {
    const acc = { RIM: { m: 0, a: 0 }, MID: { m: 0, a: 0 }, '3P': { m: 0, a: 0 }, C3: { m: 0, a: 0 } };
    let tot = 0;
    Object.entries(liteJson?.leagueZones || {}).forEach(([z, pair]) => {
      if (!Array.isArray(pair) || pair.length < 2) return;
      const m = Number(pair[0] || 0), a = Number(pair[1] || 0);
      tot += a;
      const bk = /restricted/i.test(z) ? 'RIM' : (/corner 3/i.test(z) ? 'C3' : (/3/i.test(z) ? '3P' : 'MID'));
      acc[bk].m += m; acc[bk].a += a;
    });
    const out = {};
    ['RIM', 'MID', '3P', 'C3'].forEach(k => {
      out[k] = { freq: tot > 0 ? (acc[k].a / tot) * 100 : null, fg: acc[k].a > 0 ? (acc[k].m / acc[k].a) * 100 : null };
    });
    return out;
  };
})();

window._calcWowyProfileMetrics = async function (mask, ctx) {
  const { season, selItems, lgAvg, scData, mexData } = ctx;
  const v = '?v=' + Date.now();
  const [liteJson, llJson, idxJson, ldJson] = await Promise.all([
    fetch('data/league_lite_shots_' + season + '.json' + v).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/lineup_league_' + season + '.json' + v).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/players_index.json' + v).then(r => r.ok ? r.json() : null).catch(() => null),
    window._wowyLineupData ? Promise.resolve(window._wowyLineupData) : fetch('data/lineup_data_' + season + '.json' + v).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);

  const lgZones = window._getLgZoneBench(liteJson);
  const dreIdx = window._buildLeagueDreIndex(liteJson, mexData, llJson);
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const scPlayers = scData.players || [];

  const resolvedItems = selItems.map(it => {
    let pid = Number(it.pid || 0);
    if (!pid || !scPlayers.some(sp => Number(sp.id) === pid)) {
      const target = norm(it.fullName || it.cleanLast);
      const hit = scPlayers.find(sp => norm(sp.name) === target) || scPlayers.find(sp => norm(sp.name).endsWith(norm(it.cleanLast)));
      if (hit) pid = Number(hit.id);
    }
    return { ...it, pid };
  });

  const selPids = new Set(resolvedItems.map(x => Number(x.pid)));
  const matchOn = onArr => {
    const s = new Set((onArr || []).map(Number));
    for (let i = 0; i < resolvedItems.length; i++) {
      if (s.has(Number(resolvedItems[i].pid)) !== Boolean((mask >> i) & 1)) return false;
    }
    return true;
  };

  const calcSide = side => {
    const pArr = (scData.poss || []).filter(x => x.side === side && matchOn(x.on));
    const sArr = (scData.shots || []).filter(x => x.side === side && matchOn(x.on));
    const tArr = (scData.turnovers || []).filter(x => x.side === side && matchOn(x.on));
    const fArr = (scData.fts || []).filter(x => x.side === side && matchOn(x.on));
    const nP = pArr.length;
    const pts = sArr.reduce((a, s) => a + (Number(s.made) === 1 ? (Number(s.val) || 2) : 0), 0) + fArr.reduce((a, f) => a + (Number(f.made) === 1 ? 1 : 0), 0);
    const fga = sArr.length, fta = fArr.length;
    const fgm = sArr.reduce((a, s) => a + (Number(s.made) === 1 ? 1 : 0), 0);
    const fg3a = sArr.reduce((a, s) => a + (Number(s.val) === 3 ? 1 : 0), 0);
    const fg3m = sArr.reduce((a, s) => a + (Number(s.made) === 1 && Number(s.val) === 3 ? 1 : 0), 0);
    const rebOpps = (fga - fgm) + fArr.filter(ft => Number(ft.made) === 0 && /1 of 1|2 of 2|3 of 3/.test(String(ft.sub || ''))).length;
    const orebs = pArr.reduce((a, p) => a + (Number(p.oreb) || 0), 0);
    const zAcc = { RIM: { m: 0, a: 0 }, MID: { m: 0, a: 0 }, '3P': { m: 0, a: 0 }, C3: { m: 0, a: 0 } };
    sArr.forEach(s => {
      const z = String(s.zone || '');
      const val = Number(s.val || 2);
      const yCoord = s.y != null ? Number(s.y) : null;
      const isCorner3 = val === 3 && (/corner/i.test(z) || (yCoord != null && !isNaN(yCoord) && yCoord <= 92.5));
      const b = val === 3 ? (isCorner3 ? 'C3' : '3P') : ((/restricted/i.test(z) || Number(s.dist || 99) <= 4.2) ? 'RIM' : 'MID');
      zAcc[b].a++;
      if (Number(s.made) === 1) zAcc[b].m++;
    });
    const zones = {};
    ['RIM', 'MID', '3P', 'C3'].forEach(b => {
      zones[b] = { freq: fga > 0 ? (zAcc[b].a / fga) * 100 : 0, fg: zAcc[b].a > 0 ? (zAcc[b].m / zAcc[b].a) * 100 : 0 };
    });
    return {
      nP, zones,
      rtg: nP ? (pts / nP) * 100 : null,
      ts: (2 * (fga + 0.44 * fta)) > 0 ? (pts / (2 * (fga + 0.44 * fta))) * 100 : null,
      tov: nP ? (tArr.length / nP) * 100 : null,
      fg3: fg3a > 0 ? (fg3m / fg3a) * 100 : null,
      orb: rebOpps ? (orebs / rebOpps) * 100 : null
    };
  };

  const offS = calcSide('off'), defS = calcSide('def');
  const totPoss = Math.round((offS.nP + defS.nP) / 2);
  const netRtg = (offS.rtg != null && defS.rtg != null) ? (offS.rtg - defS.rtg) : null;
  const allPoss = [...(scData.poss || []).filter(x => x.side === 'off' && matchOn(x.on)), ...(scData.poss || []).filter(x => x.side === 'def' && matchOn(x.on))];
  const pNameById = {}; scPlayers.forEach(p => { pNameById[Number(p.id)] = p.name; });
  const mateCnt = {}; let wDre = 0, wSlots = 0;

  allPoss.forEach(px => (px.on || []).forEach(raw => {
    const pid = Number(raw); if (selPids.has(pid)) return;
    mateCnt[pid] = (mateCnt[pid] || 0) + 1;
    const nm = pNameById[pid] || '';
    const d = dreIdx.byPid[pid] || dreIdx.byName[norm(nm)];
    if (d) { wDre += d.dre; wSlots++; }
  }));

  const supNet = wSlots ? (wDre / wSlots) : null;
  let supPctile = null;
  if (supNet != null) {
    if (dreIdx.lineupDist.length >= 10) {
      const totW = dreIdx.lineupDist.reduce((a, b) => a + b.w, 0);
      const belowW = dreIdx.lineupDist.filter(x => x.avgDre <= supNet).reduce((a, b) => a + b.w, 0);
      supPctile = totW > 0 ? Math.round((belowW / totW) * 100) : null;
    } else if (dreIdx.allPlayers.length > 1) {
      const sorted = dreIdx.allPlayers.map(x => x.dre).sort((a, b) => a - b);
      const below = sorted.filter(v => v <= supNet).length;
      supPctile = Math.round((below / sorted.length) * 100);
    }
  }
  const pMap = window._wowyPhotoMap || {};
  const photoIndex = Object.assign({}, window._wowyPhotoMap || {});
  const addPhoto = (nm, url) => {
    if (!nm || !url) return;
    const low = String(nm).trim().toLowerCase();
    const clean = low.replace(/[.,'?\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');
    photoIndex[low] = url;
    photoIndex[clean] = url;
    photoIndex[norm(nm)] = url;
    const parts = clean.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      photoIndex[parts[0][0] + '. ' + parts[parts.length - 1]] = url;
    }
  };
  Object.values(mexData?.playerInfo || {}).forEach(info => addPhoto(info?.name, info?.photoUrl));
  (mexData?.roster || []).forEach(p => addPhoto(p?.name || p?.PLAYER_NAME, p?.photoUrl || p?.HEADSHOT_URL));
  (mexData?.players || []).forEach(p => addPhoto(p?.name || p?.PLAYER_NAME, p?.photoUrl || p?.HEADSHOT_URL));
  (scData?.players || []).forEach(p => addPhoto(p?.name, p?.photoUrl || p?.photo));
  resolvedItems.forEach(it => { if (it.photo) addPhoto(it.fullName, it.photo); });
  Object.entries(ldJson?.playerXref || {}).forEach(([ab, info]) => { addPhoto(ab, info?.photoUrl); addPhoto(info?.name, info?.photoUrl); });
  (Array.isArray(idxJson) ? idxJson : []).forEach(p => { addPhoto(p?.name, p?.photoUrl); });

  const coMates = Object.entries(mateCnt).map(([pidStr, cnt]) => {
    const pid = Number(pidStr), fullName = pNameById[pid] || ('#' + pid);
    const d = dreIdx.byPid[pid] || dreIdx.byName[norm(fullName)];
    const low = fullName.trim().toLowerCase();
    const clean = low.replace(/[.,'?\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');
    const parts = clean.split(' ').filter(Boolean);
    const initKey = parts.length >= 2 ? (parts[0][0] + '. ' + parts[parts.length - 1]) : '';
    const photo = photoIndex[low] || photoIndex[clean] || photoIndex[norm(fullName)] || (initKey && photoIndex[initKey]) || '';
    return { pid, fullName, share: allPoss.length ? Math.round((cnt / allPoss.length) * 100) : 0, dre: d ? d.dre : null, photo };
  }).sort((a, b) => b.share - a.share).slice(0, 7);

  return { season, resolvedItems, lgAvg, lgZones, offS, defS, totPoss, netRtg, supNet, supPctile, coMates, norm };
};

window.openWowyProfileModal = async function (mask, ctx) {
  if (!ctx || !ctx.scData) return;
  let modal = document.getElementById('wowyProfileModal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'wowyProfileModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.78);display:flex;align-items:center;justify-content:center;padding:12px;overflow-y:auto;';
    modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  modal.innerHTML = '<div style="background:#141b29;color:#f8fafc;padding:18px;border-radius:10px;font-family:Lora,serif;">Loading Lineup Support...</div>';
  try {
    const d = await window._calcWowyProfileMetrics(mask, ctx);
    window._renderWowyModalHtml(modal, mask, d);
  } catch (err) {
    console.error(err);
    modal.innerHTML = '<div style="background:#141b29;color:#f87171;padding:18px;border-radius:10px;">Error: ' + (err && err.message ? err.message : err) + '</div>';
  }
};

window._renderWowyModalHtml = function (modal, mask, d) {
  const { season, resolvedItems, lgAvg, lgZones, offS, defS, totPoss, netRtg, supNet, supPctile, coMates, norm } = d;
  const fmtD = (v, b, lb, isPct = true) => {
    if (v == null || b == null || isNaN(v) || isNaN(b)) return '<div style="font-size:10px;color:#64748b;">-</div>';
    const diff = v - (isPct && b <= 1.2 ? b * 100 : b);
    const col = Math.abs(diff) < 0.05 ? '#94a3b8' : ((lb ? diff < 0 : diff > 0) ? '#38bdf8' : '#f87171');
    return '<div style="font-size:10.5px;font-weight:700;color:' + col + ';margin-top:1px;">' + (diff >= 0 ? '+' : '') + diff.toFixed(1) + '</div>';
  };
  const lgO3 = (lgZones['3P'].freq != null && lgZones['C3'].freq != null && (lgZones['3P'].freq + lgZones['C3'].freq) > 0) ? ((lgZones['3P'].fg * lgZones['3P'].freq + lgZones['C3'].fg * lgZones['C3'].freq) / (lgZones['3P'].freq + lgZones['C3'].freq)) : null;
  const pMap = window._wowyPhotoMap || {};
  const avatars = resolvedItems.map((it, idx) => {
    const isOn = Boolean((mask >> idx) & 1);
    const url = it.photo || pMap[it.key] || pMap[it.fullName.toLowerCase()] || pMap[norm(it.fullName)] || '';
    const ring = isOn ? '3px solid #22d3ee;box-shadow:0 0 12px rgba(34,211,238,0.45);' : '2px solid #475569;filter:grayscale(1);opacity:0.45;';
    const img = url ? '<img src="' + url + '" referrerpolicy="no-referrer" style="width:56px;height:56px;border-radius:50%;object-fit:cover;object-position:top;border:' + ring + '">' : '<div style="width:56px;height:56px;border-radius:50%;background:#1e293b;border:' + ring + 'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#f8fafc;">' + it.cleanLast + '</div>';
    const badge = isOn ? '' : '<div style="position:absolute;inset:0;border-radius:50%;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;"><span style="background:#334155;color:#cbd5e1;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;">OFF</span></div>';
    return '<div style="text-align:center;"><div style="position:relative;display:inline-block;">' + img + badge + '</div><div style="font-size:11.5px;font-weight:600;color:#f1f5f9;margin-top:4px;">' + it.fullName.split(' ').map((w, i) => i === 0 ? w + '.' : w).join(' ') + '</div></div>';
  }).join('');
  const supCol = supNet == null ? '#94a3b8' : (supNet >= 0 ? '#22d3ee' : '#f87171');
  const supRing = '<div style="text-align:center;"><div style="width:56px;height:56px;border-radius:50%;background:#1e293b;border:3px solid ' + supCol + ';display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto;"><div style="font-size:14px;font-weight:700;color:' + supCol + ';line-height:1;">' + (supNet == null ? '-' : ((supNet >= 0 ? '+' : '') + supNet.toFixed(1))) + '</div><div style="font-size:8px;font-weight:700;color:#94a3b8;margin-top:2px;">' + supPctile + 'th %ile</div></div><div style="font-size:11.5px;font-weight:600;color:#cbd5e1;margin-top:4px;">Lineup Support</div></div>';
  const sideHtml = (title, sObj, isDef) => {
    const bks = ['RIM', 'MID', '3P', 'C3'];
    return '<div style="flex:1;min-width:225px;"><div style="text-align:center;font-family:Oswald,sans-serif;font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:8px;">' + title + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);text-align:center;margin-bottom:12px;">' +
        '<div><div style="font-size:9.5px;color:#94a3b8;">' + (isDef ? 'D-TS%' : 'TS%') + '</div><div style="font-size:16px;font-weight:700;color:#f8fafc;">' + (sObj.ts != null ? sObj.ts.toFixed(1) : '-') + '</div>' + fmtD(sObj.ts, isDef ? lgAvg.DEF_TS_PCT : lgAvg.OFF_TS_PCT, isDef, true) + '</div>' +
        '<div><div style="font-size:9.5px;color:#94a3b8;">' + (isDef ? 'D-TOV%' : 'TOV%') + '</div><div style="font-size:16px;font-weight:700;color:#f8fafc;">' + (sObj.tov != null ? sObj.tov.toFixed(1) : '-') + '</div>' + fmtD(sObj.tov, isDef ? lgAvg.DEF_TOV_PCT : lgAvg.OFF_TOV_PCT, !isDef, true) + '</div>' +
        '<div><div style="font-size:9.5px;color:#94a3b8;">' + (isDef ? 'D-ORB%' : 'ORB%') + '</div><div style="font-size:16px;font-weight:700;color:#f8fafc;">' + (sObj.orb != null ? sObj.orb.toFixed(1) : '-') + '</div>' + fmtD(sObj.orb, isDef ? lgAvg.DEF_ORB_PCT : lgAvg.OFF_ORB_PCT, isDef, true) + '</div>' +
      '</div><div style="text-align:center;font-family:Oswald,sans-serif;font-size:10.5px;font-weight:700;color:#94a3b8;margin-bottom:6px;">SHOT LOCATION</div>' +
      '<table style="width:100%;border-collapse:collapse;text-align:center;font-size:11px;"><thead><tr style="color:#64748b;font-size:9.5px;"><th></th>' + bks.map(b => '<th>' + b + '</th>').join('') + '</tr></thead><tbody>' +
        '<tr><td style="text-align:left;color:#94a3b8;font-size:9.5px;">FREQ</td>' + bks.map(b => '<td><div style="font-weight:700;color:#f8fafc;">' + sObj.zones[b].freq.toFixed(1) + '</div>' + fmtD(sObj.zones[b].freq, lgZones[b].freq, false, false) + '</td>').join('') + '</tr>' +
        '<tr><td style="text-align:left;color:#94a3b8;font-size:9.5px;">FG%</td>' + bks.map(b => '<td><div style="font-weight:700;color:#f8fafc;">' + sObj.zones[b].fg.toFixed(1) + '</div>' + fmtD(sObj.zones[b].fg, lgZones[b].fg, isDef, false) + '</td>').join('') + '</tr>' +
      '</tbody></table></div>';
  };
  const matesHtml = coMates.map(cm => {
    const dCol = cm.dre == null ? '#94a3b8' : (cm.dre >= 0 ? '#38bdf8' : '#f87171');
    const dTxt = cm.dre == null ? '' : (' <span style="color:' + dCol + ';">' + (cm.dre >= 0 ? '+' : '') + cm.dre.toFixed(1) + '</span>');
    const av = cm.photo ? '<img src="' + cm.photo + '" referrerpolicy="no-referrer" style="width:40px;height:40px;border-radius:50%;object-fit:cover;object-position:top;border:2px solid #38bdf8;">' : '<div style="width:40px;height:40px;border-radius:50%;background:#1e293b;border:2px solid #38bdf8;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#f8fafc;">' + cm.fullName.slice(0, 3) + '</div>';
    return '<div style="text-align:center;min-width:56px;"><div style="font-size:10.5px;font-weight:700;color:#e2e8f0;margin-bottom:3px;">' + cm.share + '%' + dTxt + '</div>' + av + '<div style="font-size:10px;color:#cbd5e1;margin-top:3px;line-height:1.15;">' + cm.fullName.split(' ').slice(0, 2).join('<br>') + '</div></div>';
  }).join('');
  const otherSlots = Math.max(1, 5 - resolvedItems.filter((_, i) => (mask >> i) & 1).length);
  const b1 = '<div style="background:#141b29;border-radius:10px;border:1px solid #283548;padding:14px 18px;width:100%;display:block;color:#f8fafc;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><div style="font-family:Oswald,sans-serif;font-size:12px;font-weight:700;color:#94a3b8;">CAPITANESVERSE · LINEUPS <span style="color:#38bdf8;margin-left:6px;">' + season + '</span></div><button type="button" onclick="document.getElementById(\'wowyProfileModal\').style.display=\'none\'" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;font-size:11px;padding:2px 8px;border-radius:4px;cursor:pointer;">✕</button></div>' +
    '<div style="display:flex;justify-content:center;align-items:flex-start;gap:22px;flex-wrap:wrap;margin-bottom:14px;">' + avatars + supRing + '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(6,1fr);text-align:center;padding-bottom:12px;border-bottom:1px solid #263244;margin-bottom:14px;">' +
      '<div><div style="font-size:9.5px;color:#94a3b8;">POSS</div><div style="font-size:17px;font-weight:700;color:#f8fafc;">' + totPoss + '</div></div>' +
      '<div><div style="font-size:9.5px;color:#94a3b8;">NET</div><div style="font-size:17px;font-weight:700;color:' + (netRtg >= 0 ? '#38bdf8' : '#f87171') + ';">' + (netRtg != null ? (netRtg >= 0 ? '+' : '') + netRtg.toFixed(1) : '-') + '</div></div>' +
      '<div><div style="font-size:9.5px;color:#94a3b8;">OFF</div><div style="font-size:17px;font-weight:700;color:#f8fafc;">' + (offS.rtg != null ? offS.rtg.toFixed(1) : '-') + '</div>' + fmtD(offS.rtg, lgAvg.OFF_RATING, false, false) + '</div>' +
      '<div><div style="font-size:9.5px;color:#94a3b8;">DEF</div><div style="font-size:17px;font-weight:700;color:#f8fafc;">' + (defS.rtg != null ? defS.rtg.toFixed(1) : '-') + '</div>' + fmtD(defS.rtg, lgAvg.DEF_RATING, true, false) + '</div>' +
      '<div><div style="font-size:9.5px;color:#94a3b8;">O-3P%</div><div style="font-size:17px;font-weight:700;color:#f8fafc;">' + (offS.fg3 != null ? offS.fg3.toFixed(1) + '%' : '-') + '</div>' + fmtD(offS.fg3, lgO3, false, false) + '</div>' +
      '<div><div style="font-size:9.5px;color:#94a3b8;">D-3P%</div><div style="font-size:17px;font-weight:700;color:#f8fafc;">' + (defS.fg3 != null ? defS.fg3.toFixed(1) + '%' : '-') + '</div>' + fmtD(defS.fg3, lgO3, true, false) + '</div>' +
    '</div><div style="display:flex;gap:18px;flex-wrap:wrap;">' + sideHtml('OFFENSIVE', offS, false) + '<div style="width:1px;background:#263244;"></div>' + sideHtml('DEFENSIVE', defS, true) + '</div></div>';
  const b2 = '<div style="background:#1c2536;border-radius:10px;border:1.5px solid #94a3b8;padding:11px 16px;text-align:center;width:100%;display:block;color:#f8fafc;"><div style="font-family:Oswald,sans-serif;font-size:11.5px;font-weight:700;color:#e2e8f0;">LINEUP SUPPORT (' + otherSlots + ') &middot; <span style="color:#22d3ee;">' + (supPctile != null ? (supPctile + 'th %ile') : '-') + '</span></div><div style="font-size:10px;color:#94a3b8;margin:3px 0 5px;">Possession-weighted average DRE of other teammates on floor (vs. G League)</div><div style="font-size:13.5px;font-weight:700;color:#38bdf8;">' + (supNet == null ? '-' : ((supNet >= 0 ? '+' : '') + supNet.toFixed(1) + ' DRE')) + '</div></div>';
  const b3 = '<div style="background:#141b29;border-radius:10px;border:1px solid #283548;padding:12px 16px;text-align:center;width:100%;display:block;color:#f8fafc;"><div style="font-family:Oswald,sans-serif;font-size:9.5px;font-weight:700;color:#94a3b8;margin-bottom:8px;">SHARED FLOOR WITH LINEUP % | DRE</div><div style="display:flex;justify-content:center;align-items:flex-start;gap:12px;flex-wrap:wrap;">' + matesHtml + '</div></div>';
  modal.innerHTML = '<style>#wowyProfileModal *{box-sizing:border-box}#wowyProfileModal .wm-wrap{width:540px;max-width:95vw;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;font-family:Lora,serif;color:#f8fafc}</style><div class="wm-wrap">' + b1 + b2 + b3 + '</div>';
};
