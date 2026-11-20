(function () {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const shortInit = name => {
    const parts = String(name || '').trim().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
    return parts.length < 2 ? norm(name) : norm(parts.at(0).charAt(0) + parts.slice(1).join(''));
  };
  const altLastInit = name => {
    const parts = String(name || '').trim().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
    return parts.length < 3 ? '' : norm(parts.at(0).charAt(0) + parts.slice(-1).join(''));
  };
  const calcDre = p => {
    if (!p || typeof p !== 'object') return null;
    if (p.dre != null && !isNaN(Number(p.dre))) return Number(p.dre);
    const poss = Number(p.poss ?? p.POSS ?? 0);
    if (poss <= 0) return null;
    return (100 / poss) * (0.792 * Number(p.pts || 0) - 0.719 * Number(p.fga || 0) - 0.299 * Number(p.fta || 0) + 0.145 * Number(p.reb || 0) + 0.369 * Number(p.ast || 0) + 1.662 * Number(p.stl || 0) + 0.696 * Number(p.blk || 0) - 0.844 * Number(p.tov || 0));
  };

  window.initTeamWowy = async function (active, allTeams, szn, idxList) {
    const host = document.getElementById('tmWowyHost');
    if (!host || !active) return;
    try {

    const photoMap = {};
    const addPhoto = (nm, u) => {
      if (!nm || !u) return;
      photoMap[norm(nm)] = u;
      const si = shortInit(nm), ai = altLastInit(nm);
      if (si && !photoMap[si]) photoMap[si] = u;
      if (ai && !photoMap[ai]) photoMap[ai] = u;
    };
    (Array.isArray(idxList) ? idxList : []).forEach(p => addPhoto(p?.name, p?.photoUrl));

    const [ldJson, llJson] = await Promise.all([
      fetch('data/lineup_data_' + szn + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('data/lineup_league_' + szn + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    Object.entries(ldJson?.playerXref || {}).forEach(([ab, info]) => { addPhoto(ab, info?.photoUrl); addPhoto(info?.name, info?.photoUrl); });

    const allDre = [], teamDreByKey = {};
    const lgOffRtg = (allTeams || []).length ? (allTeams.reduce((s, t) => s + Number(t.offStats?.rtg || 0), 0) / allTeams.length) : null;
    const lgDefRtg = (allTeams || []).length ? (allTeams.reduce((s, t) => s + Number(t.defStats?.rtg || 0), 0) / allTeams.length) : null;
    const lgTs = (allTeams || []).length ? (allTeams.reduce((s, t) => s + Number(t.offStats?.tsPct || 0), 0) / allTeams.length) : null;
    const lgTov = (allTeams || []).length ? (allTeams.reduce((s, t) => s + Number(t.offStats?.tovPct || 0), 0) / allTeams.length) : null;
    const lg3p = (allTeams || []).length ? (allTeams.reduce((s, t) => s + Number(t.offStats?.fg3Pct || 0), 0) / allTeams.length) : null;
    const lgD3p = (allTeams || []).length ? (allTeams.reduce((s, t) => s + Number(t.defStats?.fg3Pct || 0), 0) / allTeams.length) : null;

    (allTeams || []).forEach(tm => {
      (tm.rosterStats || []).forEach(p => {
        const d = calcDre(p);
        if (d == null || isNaN(d)) return;
        allDre.push(d);
        if (tm.abbrev === active.abbrev) {
          const rec = { name: p.name, dre: d };
          teamDreByKey[norm(p.name)] = rec;
          const si = shortInit(p.name), ai = altLastInit(p.name);
          if (si) teamDreByKey[si] = rec;
          if (ai) teamDreByKey[ai] = rec;
        }
      });
    });

    const roster = (active.rosterStats || []).slice().sort((a, b) => (b.poss || 0) - (a.poss || 0));
    const teamGp = Number(active.offStats?.gp || 0);
    const estTeamPoss = roster.length ? Math.max(teamGp * 102, Math.round(roster.reduce((s, p) => s + Number(p.poss || 0), 0) / 5)) : (teamGp * 102);
    const teamOrtg = Number(active.offStats?.rtg || 0);
    const teamDrtg = Number(active.defStats?.rtg || 0);

    const mergeTier = tier => {
      const base = (active.lineups?.[tier] || []).slice();
      (llJson?.[tier] || []).filter(x => x.TEAM_ABBREVIATION === active.abbrev).forEach(x => {
        const pStr = String(x.GROUP_NAME || '');
        if (!base.some(u => norm(u.players) === norm(pStr))) {
          base.push({
            players: pStr,
            poss: Number(x.POSS || 0),
            ortg: Number(x.OFF_RATING || 0),
            drtg: Number(x.DEF_RATING || 0),
            tsPct: x.TS_PCT != null ? Number(x.TS_PCT) * 100 : null,
            tovPct: x.TM_TOV_PCT != null ? Number(x.TM_TOV_PCT) * 100 : null,
            orebPct: x.OREB_PCT != null ? Number(x.OREB_PCT) * 100 : null,
            drebPct: x.DREB_PCT != null ? Number(x.DREB_PCT) * 100 : null
          });
        }
      });
      return base.map(lu => {
        const names = String(lu.players || '').split(/\s+-\s+/).map(x => x.trim()).filter(Boolean);
        const keys = new Set();
        names.forEach(nm => { keys.add(norm(nm)); const si = shortInit(nm), ai = altLastInit(nm); if (si) keys.add(si); if (ai) keys.add(ai); });
        return { ...lu, names, keys, poss: Number(lu.poss || 0), ortg: Number(lu.ortg || 0), drtg: Number(lu.drtg || 0) };
      }).filter(x => x.poss > 0);
    };
    const tiers = { 2: mergeTier('duos'), 3: mergeTier('trios'), 4: mergeTier('quads'), 5: mergeTier('fiveman') };
    const getAllOnStats = onIndices => {
      const k = onIndices.length;
      if (k === 0) return { poss: estTeamPoss, ptsFor: (teamOrtg * estTeamPoss) / 100, ptsAg: (teamDrtg * estTeamPoss) / 100, tsPct: active.offStats?.tsPct ?? null, tovPct: active.offStats?.tovPct ?? null, fg3Pct: active.offStats?.fg3Pct ?? null, threePar: active.offStats?.threePar ?? null, ftr: active.offStats?.ftr ?? null, orebPct: null, drebPct: null };
      if (k === 1) {
        const p = roster.find(r => r.name === selected[onIndices.at(0)]);
        if (!p || !p.poss) return null;
        return { poss: Number(p.poss), ptsFor: (Number(p.ortg) * Number(p.poss)) / 100, ptsAg: (Number(p.drtg) * Number(p.poss)) / 100, tsPct: p.tsPct ?? null, tovPct: p.tov75 && p.poss ? null : null, fg3Pct: p.fg3Pct ?? null, threePar: p.threePar ?? null, ftr: p.ftr ?? null, orebPct: null, drebPct: null };
      }
      const list = tiers[k] || [];
      const req = onIndices.map(idx => ({ k1: norm(selected[idx]), k2: shortInit(selected[idx]), k3: altLastInit(selected[idx]) }));
      const hit = list.find(lu => req.every(q => lu.keys.has(q.k1) || (q.k2 && lu.keys.has(q.k2)) || (q.k3 && lu.keys.has(q.k3))));
      if (!hit) return null;
      return { poss: hit.poss, ptsFor: (hit.ortg * hit.poss) / 100, ptsAg: (hit.drtg * hit.poss) / 100, tsPct: hit.tsPct ?? null, tovPct: hit.tovPct ?? null, fg3Pct: null, threePar: null, ftr: null, orebPct: hit.orebPct ?? null, drebPct: hit.drebPct ?? null };
    };

    const selected = roster.slice(0, Math.min(2, roster.length)).map(r => r.name);

    const computePermutations = () => {
      const n = selected.length;
      if (!n) return [];
      const rows = [];
      for (let mask = (1 << n) - 1; mask >= 0; mask--) {
        const onIdx = [], offIdx = [];
        for (let i = 0; i < n; i++) (((mask >> i) & 1) ? onIdx : offIdx).push(i);
        let poss = 0, ptsFor = 0, ptsAg = 0, valid = true;
        const m = offIdx.length;
        for (let sub = 0; sub < (1 << m); sub++) {
          const subset = onIdx.slice();
          let bits = 0;
          for (let j = 0; j < m; j++) { if ((sub >> j) & 1) { subset.push(offIdx[j]); bits++; } }
          const st = getAllOnStats(subset);
          if (!st) { valid = false; break; }
          const sign = (bits % 2 === 0) ? 1 : -1;
          poss += sign * st.poss; ptsFor += sign * st.ptsFor; ptsAg += sign * st.ptsAg;
        }
        const baseOn = offIdx.length === 0 ? getAllOnStats(onIdx) : (mask === 0 ? getAllOnStats([]) : null);
        if (!valid || poss <= 0) {
          rows.push({ mask, poss: 0, ortg: null, drtg: null, netRtg: null, extra: baseOn });
        } else {
          const ortg = (ptsFor / poss) * 100, drtg = (ptsAg / poss) * 100;
          rows.push({ mask, poss: Math.round(poss), ortg, drtg, netRtg: ortg - drtg, extra: baseOn });
        }
      }
      return rows;
    };

    window._openTeamWowyProfile = function (mask) {
      const row = computePermutations().find(r => r.mask === mask);
      if (!row) return;
      let modal = document.getElementById('teamWowyProfileModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'teamWowyProfileModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.78);display:flex;align-items:center;justify-content:center;padding:12px;overflow-y:auto;';
        modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      const onNames = selected.filter((_, i) => (mask >> i) & 1);
      const offNames = selected.filter((_, i) => !((mask >> i) & 1));
      const onSet = new Set();
      onNames.forEach(nm => { onSet.add(norm(nm)); const si = shortInit(nm), ai = altLastInit(nm); if (si) onSet.add(si); if (ai) onSet.add(ai); });
      const offSet = new Set();
      offNames.forEach(nm => { offSet.add(norm(nm)); const si = shortInit(nm), ai = altLastInit(nm); if (si) offSet.add(si); if (ai) offSet.add(ai); });

      const coMates = [];
      let wDre = 0, wSlots = 0;
      if (onNames.length === 1 && row.poss > 0) {
        const pKey = norm(onNames.at(0)), pSi = shortInit(onNames.at(0)), pAi = altLastInit(onNames.at(0));
        roster.forEach(mate => {
          const mk = norm(mate.name);
          if (onSet.has(mk) || offSet.has(mk)) return;
          const mSi = shortInit(mate.name), mAi = altLastInit(mate.name);
          const duo = (tiers[2] || []).find(lu => (lu.keys.has(pKey) || lu.keys.has(pSi) || (pAi && lu.keys.has(pAi))) && (lu.keys.has(mk) || lu.keys.has(mSi) || (mAi && lu.keys.has(mAi))));
          if (duo && duo.poss > 0) {
            const dRec = teamDreByKey[mk];
            const share = Math.min(100, Math.round((duo.poss / row.poss) * 100));
            coMates.push({ fullName: mate.name, share, poss: duo.poss, dre: dRec ? dRec.dre : null, photo: photoMap[mk] || photoMap[mSi] || '' });
            if (dRec) { wDre += dRec.dre * duo.poss; wSlots += duo.poss; }
          }
        });
      } else {
        (tiers[5] || []).forEach(lu => {
          for (let i = 0; i < selected.length; i++) {
            const wantOn = Boolean((mask >> i) & 1);
            const isOn = lu.keys.has(norm(selected[i])) || lu.keys.has(shortInit(selected[i])) || (altLastInit(selected[i]) && lu.keys.has(altLastInit(selected[i])));
            if (isOn !== wantOn) return;
          }
          lu.names.forEach(rawNm => {
            const k = norm(rawNm);
            if (onSet.has(k) || offSet.has(k)) return;
            const hit = roster.find(r => norm(r.name) === k || shortInit(r.name) === k || altLastInit(r.name) === k);
            const full = hit ? hit.name : rawNm;
            const prev = coMates.find(c => c.fullName === full);
            if (prev) prev.poss += lu.poss;
            else coMates.push({ fullName: full, poss: lu.poss, share: 0, dre: (teamDreByKey[norm(full)] || teamDreByKey[k])?.dre ?? null, photo: photoMap[norm(full)] || photoMap[k] || '' });
            const dRec = teamDreByKey[norm(full)] || teamDreByKey[k];
            if (dRec) { wDre += dRec.dre * lu.poss; wSlots += lu.poss; }
          });
        });
        const denom = (tiers[5] || []).filter(lu => selected.every((nm, i) => (lu.keys.has(norm(nm)) || lu.keys.has(shortInit(nm))) === Boolean((mask >> i) & 1))).reduce((s, u) => s + u.poss, 0) || row.poss;
        coMates.forEach(c => { c.share = denom > 0 ? Math.min(100, Math.round((c.poss / denom) * 100)) : 0; });
      }
      coMates.sort((a, b) => b.share - a.share);
      const topMates = coMates.slice(0, 7);
      const supNet = wSlots > 0 ? (wDre / wSlots) : null;
      const supPctile = (supNet != null && allDre.length > 1) ? Math.round((allDre.filter(v => v <= supNet).length / allDre.length) * 100) : null;
      const fmtD = (v, b, lb) => {
        if (v == null || b == null || isNaN(v) || isNaN(b)) return '<div style="font-size:10px;color:#64748b;">-</div>';
        const diff = v - b;
        const col = Math.abs(diff) < 0.05 ? '#94a3b8' : ((lb ? diff < 0 : diff > 0) ? '#38bdf8' : '#f87171');
        return `<div style="font-size:10.5px;font-weight:700;color:${col};margin-top:1px;">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}</div>`;
      };
      const avatars = selected.map((nm, idx) => {
        const isOn = Boolean((mask >> idx) & 1), u = photoMap[norm(nm)] || photoMap[shortInit(nm)] || photoMap[altLastInit(nm)] || '';
        const ring = isOn ? '3px solid #22d3ee;box-shadow:0 0 12px rgba(34,211,238,0.45);' : '2px solid #475569;filter:grayscale(1);opacity:0.45;';
        const img = u ? `<img src="${u}" referrerpolicy="no-referrer" style="width:54px;height:54px;border-radius:50%;object-fit:cover;object-position:top;border:${ring}">` : `<div style="width:54px;height:54px;border-radius:50%;background:#1e293b;border:${ring}display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:#f8fafc;">${nm.split(' ').pop()}</div>`;
        const badge = isOn ? '' : '<div style="position:absolute;inset:0;border-radius:50%;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;"><span style="background:#334155;color:#cbd5e1;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;">OFF</span></div>';
        return `<div style="text-align:center;"><div style="position:relative;display:inline-block;">${img}${badge}</div><div style="font-size:11px;font-weight:600;color:#f1f5f9;margin-top:4px;">${nm}</div></div>`;
      }).join('');
      const supCol = supNet == null ? '#94a3b8' : (supNet >= 0 ? '#22d3ee' : '#f87171');
      const supRing = `<div style="text-align:center;"><div style="width:54px;height:54px;border-radius:50%;background:#1e293b;border:3px solid ${supCol};display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto;"><div style="font-size:13.5px;font-weight:700;color:${supCol};line-height:1;">${supNet == null ? '-' : ((supNet >= 0 ? '+' : '') + supNet.toFixed(1))}</div><div style="font-size:8px;font-weight:700;color:#94a3b8;margin-top:2px;">${supPctile != null ? supPctile + 'th %ile' : '-'}</div></div><div style="font-size:11px;font-weight:600;color:#cbd5e1;margin-top:4px;">Lineup Support</div></div>`;
      const matesHtml = topMates.map(cm => {
        const dCol = cm.dre == null ? '#94a3b8' : (cm.dre >= 0 ? '#38bdf8' : '#f87171');
        const dTxt = cm.dre == null ? '' : ` <span style="color:${dCol};">${cm.dre >= 0 ? '+' : ''}${cm.dre.toFixed(1)}</span>`;
        const av = cm.photo ? `<img src="${cm.photo}" referrerpolicy="no-referrer" style="width:40px;height:40px;border-radius:50%;object-fit:cover;object-position:top;border:2px solid #38bdf8;">` : `<div style="width:40px;height:40px;border-radius:50%;background:#1e293b;border:2px solid #38bdf8;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#f8fafc;">${cm.fullName.slice(0, 3)}</div>`;
        return `<div style="text-align:center;min-width:56px;"><div style="font-size:10.5px;font-weight:700;color:#e2e8f0;margin-bottom:3px;">${cm.share}%${dTxt}</div>${av}<div style="font-size:10px;color:#cbd5e1;margin-top:3px;line-height:1.15;">${cm.fullName.split(' ').slice(0, 2).join('<br>')}</div></div>`;
      }).join('');

      const ex = row.extra || {};
      const otherSlots = Math.max(1, 5 - onNames.length);
      const extraRow = (ex.tsPct != null || ex.tovPct != null || ex.fg3Pct != null || ex.orebPct != null || ex.drebPct != null)
        ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);text-align:center;padding-top:10px;margin-top:10px;border-top:1px solid #263244;">
            <div><div style="font-size:9.5px;color:#94a3b8;">TS%</div><div style="font-size:15px;font-weight:700;color:#f8fafc;">${ex.tsPct != null ? ex.tsPct.toFixed(1) : '-'}</div>${fmtD(ex.tsPct, lgTs, false)}</div>
            <div><div style="font-size:9.5px;color:#94a3b8;">TOV%</div><div style="font-size:15px;font-weight:700;color:#f8fafc;">${ex.tovPct != null ? ex.tovPct.toFixed(1) : '-'}</div>${fmtD(ex.tovPct, lgTov, true)}</div>
            <div><div style="font-size:9.5px;color:#94a3b8;">${ex.orebPct != null ? 'ORB%' : '3P%'}</div><div style="font-size:15px;font-weight:700;color:#f8fafc;">${ex.orebPct != null ? ex.orebPct.toFixed(1) : (ex.fg3Pct != null ? ex.fg3Pct.toFixed(1) : '-')}</div>${ex.orebPct != null ? '' : fmtD(ex.fg3Pct, lg3p, false)}</div>
            <div><div style="font-size:9.5px;color:#94a3b8;">${ex.drebPct != null ? 'DREB%' : '3PAr'}</div><div style="font-size:15px;font-weight:700;color:#f8fafc;">${ex.drebPct != null ? ex.drebPct.toFixed(1) : (ex.threePar != null ? ex.threePar.toFixed(1) : '-')}</div></div>
          </div>` : '';

      const b1 = `<div style="background:#141b29;border-radius:10px;border:1px solid #283548;padding:14px 18px;width:100%;display:block;color:#f8fafc;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><div style="font-family:Oswald,sans-serif;font-size:12px;font-weight:700;color:#94a3b8;">${active.abbrev} &middot; LINEUPS <span style="color:#38bdf8;margin-left:6px;">${szn}</span></div><button type="button" onclick="document.getElementById('teamWowyProfileModal').style.display='none'" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;font-size:11px;padding:2px 8px;border-radius:4px;cursor:pointer;">✕</button></div><div style="display:flex;justify-content:center;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:14px;">${avatars}${supRing}</div><div style="display:grid;grid-template-columns:repeat(4,1fr);text-align:center;padding-top:10px;border-top:1px solid #263244;"><div><div style="font-size:9.5px;color:#94a3b8;">POSS</div><div style="font-size:17px;font-weight:700;color:#f8fafc;">${row.poss}</div></div><div><div style="font-size:9.5px;color:#94a3b8;">NET</div><div style="font-size:17px;font-weight:700;color:${(row.netRtg ?? 0) >= 0 ? '#38bdf8' : '#f87171'};">${row.netRtg != null ? ((row.netRtg >= 0 ? '+' : '') + row.netRtg.toFixed(1)) : '-'}</div></div><div><div style="font-size:9.5px;color:#94a3b8;">OFF</div><div style="font-size:17px;font-weight:700;color:#f8fafc;">${row.ortg != null ? row.ortg.toFixed(1) : '-'}</div>${fmtD(row.ortg, lgOffRtg, false)}</div><div><div style="font-size:9.5px;color:#94a3b8;">DEF</div><div style="font-size:17px;font-weight:700;color:#f8fafc;">${row.drtg != null ? row.drtg.toFixed(1) : '-'}</div>${fmtD(row.drtg, lgDefRtg, true)}</div></div>${extraRow}</div>`;
      const b2 = `<div style="background:#1c2536;border-radius:10px;border:1.5px solid #94a3b8;padding:11px 16px;text-align:center;width:100%;display:block;color:#f8fafc;"><div style="font-family:Oswald,sans-serif;font-size:11.5px;font-weight:700;color:#e2e8f0;">LINEUP SUPPORT (${otherSlots}) &middot; <span style="color:#22d3ee;">${supPctile != null ? supPctile + 'th %ile' : '-'}</span></div><div style="font-size:10px;color:#94a3b8;margin:3px 0 5px;">Possession-weighted average DRE of other teammates on floor (vs. G League)</div><div style="font-size:13.5px;font-weight:700;color:#38bdf8;">${supNet == null ? '-' : ((supNet >= 0 ? '+' : '') + supNet.toFixed(1) + ' DRE')}</div></div>`;
      const b3 = `<div style="background:#141b29;border-radius:10px;border:1px solid #283548;padding:12px 16px;text-align:center;width:100%;display:block;color:#f8fafc;"><div style="font-family:Oswald,sans-serif;font-size:9.5px;font-weight:700;color:#94a3b8;margin-bottom:8px;">SHARED FLOOR WITH LINEUP % | DRE</div><div style="display:flex;justify-content:center;align-items:flex-start;gap:12px;flex-wrap:wrap;">${matesHtml || '<span style="font-size:11px;color:#64748b;">No duo/lineup overlap logged for this split</span>'}</div></div>`;
      modal.innerHTML = `<style>#teamWowyProfileModal *{box-sizing:border-box}#teamWowyProfileModal .twm-wrap{width:540px;max-width:95vw;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;font-family:Lora,serif;color:#f8fafc}</style><div class="twm-wrap">${b1}${b2}${b3}</div>`;
    };

    const renderWowy = () => {
      const chips = roster.slice(0, 14).map(r => {
        const activeSel = selected.includes(r.name);
        return `<button type="button" data-nm="${r.name.replace(/"/g, '&quot;')}" style="padding:3px 8px;font-size:10.5px;font-family:'Lora',serif;font-weight:${activeSel ? '700' : '500'};border-radius:4px;cursor:pointer;border:1px solid ${activeSel ? 'var(--blue)' : 'var(--border)'};background:${activeSel ? 'var(--blue)' : '#fff'};color:${activeSel ? '#fff' : 'var(--ink)'};">${r.name}</button>`;
      }).join('');
      const perms = computePermutations();
      const rowsHtml = !perms.length
        ? '<tr><td colspan="5" style="padding:8px;color:var(--muted);">Select 1–4 players above to view WOWY combinations.</td></tr>'
        : perms.map(r => {
            const tags = selected.map((nm, i) => {
              const isOn = Boolean((r.mask >> i) & 1);
              return `<span style="display:inline-block;padding:2px 6px;margin-right:4px;border-radius:3px;font-size:10.5px;font-weight:700;background:${isOn ? '#dcfce7' : '#fee2e2'};color:${isOn ? '#166534' : '#991b1b'};">${isOn ? 'ON' : 'OFF'} ${nm.split(' ').pop()}</span>`;
            }).join('');
            const netCol = r.netRtg == null ? 'var(--muted)' : (r.netRtg >= 0 ? 'var(--green)' : 'var(--red)');
return `<tr onclick="window._openTeamWowyProfile(${r.mask})" style="cursor:pointer;border-bottom:1px solid var(--border);"><td style="padding:5px 6px;">${tags}<button type="button" onclick="event.stopPropagation();window._openTeamWowyProfile(${r.mask})" style="margin-left:4px;padding:2px 6px;font-family:Oswald,sans-serif;font-size:9.5px;font-weight:700;background:var(--blue);color:#fff;border:none;border-radius:3px;cursor:pointer;">Profile &#8599;</button></td><td style="padding:5px 6px;text-align:right;font-weight:700;">${r.poss}</td><td style="padding:5px 6px;text-align:right;">${r.ortg != null ? r.ortg.toFixed(1) : '—'}</td><td style="padding:5px 6px;text-align:right;">${r.drtg != null ? r.drtg.toFixed(1) : '—'}</td><td style="padding:5px 6px;text-align:right;font-weight:700;color:${netCol};">${r.netRtg != null ? ((r.netRtg >= 0 ? '+' : '') + r.netRtg.toFixed(1)) : '—'}</td></tr>`;
}).join('');
host.innerHTML = `<div class="tm-card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><div class="tm-card-title" style="margin:0;">Lineup WOWY Builder &amp; On/Off Combinations (Select up to 4 Players)</div><span style="font-size:10px;color:var(--muted);">Click any row or Profile &#8599; for Lineup Support</span></div><div id="tmWowyChips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${chips}</div><div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;"><th style="padding:3px 6px;text-align:left;border-bottom:1px solid var(--border);">Combination</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">POSS</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">ORtg</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">DRtg</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid var(--border);">NetRtg</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div>`;
host.querySelectorAll('#tmWowyChips button').forEach(btn => {
btn.onclick = () => {
const nm = btn.getAttribute('data-nm'), idx = selected.indexOf(nm);
if (idx >= 0) selected.splice(idx, 1); else if (selected.length < 4) selected.push(nm);
renderWowy();
};
});
};
renderWowy();
} catch (e) { console.error(e); host.innerHTML = '<div class="tm-card" style="color:var(--red);">WOWY Error: ' + e.message + '</div>'; }
};
})();;
