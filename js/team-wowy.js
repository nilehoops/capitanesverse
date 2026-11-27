(function () {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,'’\-]/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const shortInit = s => {
    const parts = norm(s).split(' ').filter(Boolean);
    return parts.length >= 2 ? (parts[0][0] + ' ' + parts.slice(1).join(' ')) : (parts[0] || '');
  };
  const calcDre = p => {
    if (!p || typeof p !== 'object') return null;
    if (p.dre != null && !isNaN(Number(p.dre))) return Number(p.dre);
    const poss = Number(p.poss ?? p.POSS ?? 0);
    if (poss <= 0) return null;
    const pts = Number(p.pts ?? p.PTS ?? 0), fga = Number(p.fga ?? p.FGA ?? 0), fta = Number(p.fta ?? p.FTA ?? 0);
    const reb = Number(p.reb ?? p.REB ?? (Number(p.oreb || 0) + Number(p.dreb || 0))), ast = Number(p.ast ?? p.AST ?? 0);
    const stl = Number(p.stl ?? p.STL ?? 0), blk = Number(p.blk ?? p.BLK ?? 0), tov = Number(p.tov ?? p.TOV ?? 0);
    return (100 / poss) * (0.792 * pts - 0.719 * fga - 0.299 * fta + 0.145 * reb + 0.369 * ast + 1.662 * stl + 0.696 * blk - 0.844 * tov);
  };

  window.initTeamWowy = async function (active, allTeams, szn, idxJson) {
    const host = document.getElementById('tmWowyHost');
    if (!host || !active) return;

    const v = '?v=' + Date.now();
    const [llJson, ldJson, rosJson] = await Promise.all([
      fetch('data/lineup_league_' + szn + '.json' + v).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('data/lineup_data_' + szn + '.json' + v).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('data/gleague_roster_' + szn + '.json' + v).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    const photoMap = {}, jerseyMap = {};
    (Array.isArray(idxJson) ? idxJson : Object.values(idxJson || {})).forEach(p => {
      if (p && p.name) {
        if (p.photoUrl && !String(p.photoUrl).includes('://nba.com')) {
          photoMap[norm(p.name)] = p.photoUrl;
          photoMap[shortInit(p.name)] = p.photoUrl;
        }
        const j = p.jersey || p.num || p.number;
        if (j != null && String(j).trim() !== '') {
          jerseyMap[norm(p.name)] = '#' + String(j).replace(/^#/, '').trim();
          jerseyMap[shortInit(p.name)] = '#' + String(j).replace(/^#/, '').trim();
        }
      }
    });
    const rosList = Array.isArray(rosJson?.players) ? rosJson.players : (Array.isArray(rosJson) ? rosJson : Object.values(rosJson?.players || {}));
    rosList.forEach(p => {
      if (p && p.name) {
        const j = p.num || p.jersey || p.number || p.JERSEY;
        if (j != null && String(j).trim() !== '') {
          jerseyMap[norm(p.name)] = '#' + String(j).replace(/^#/, '').trim();
          jerseyMap[shortInit(p.name)] = '#' + String(j).replace(/^#/, '').trim();
        }
      }
    });
    (active.rosterStats || []).forEach(p => {
      if (p && p.name && (p.num || p.jersey)) {
        const j = '#' + String(p.num || p.jersey).replace(/^#/, '').trim();
        jerseyMap[norm(p.name)] = j;
        jerseyMap[shortInit(p.name)] = j;
      }
    });

    const allDre = [], teamDreByKey = {};
    (allTeams || []).forEach(tm => {
      (tm.rosterStats || []).forEach(p => {
        const d = calcDre(p);
        if (d == null || isNaN(d)) return;
        allDre.push(d);
        if (tm.abbrev === active.abbrev) {
          const rec = { name: p.name, dre: d };
          teamDreByKey[norm(p.name)] = rec;
          teamDreByKey[shortInit(p.name)] = rec;
        }
      });
    });

    const avgField = (arr, fn) => {
      const vals = arr.map(fn).filter(x => x != null && !isNaN(x));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const lg = {
      offRtg: avgField(allTeams || [], t => Number(t.offStats?.rtg)),
      defRtg: avgField(allTeams || [], t => Number(t.defStats?.rtg)),
      oTs: avgField(allTeams || [], t => Number(t.offStats?.tsPct)),
      dTs: avgField(allTeams || [], t => Number(t.defStats?.tsPct)),
      oTov: avgField(allTeams || [], t => Number(t.offStats?.tovPct)),
      dTov: avgField(allTeams || [], t => Number(t.defStats?.tovPct)),
      oOrb: avgField(allTeams || [], t => Number(t.offStats?.orebPct)),
      dOrb: avgField(allTeams || [], t => t.defStats?.orebPct != null ? Number(t.defStats.orebPct) : (t.offStats?.drebPct != null ? 100 - Number(t.offStats.drebPct) : null)),
      o3p: avgField(allTeams || [], t => Number(t.offStats?.fg3Pct)),
      d3p: avgField(allTeams || [], t => Number(t.defStats?.fg3Pct)),
    };
    const roster = (active.rosterStats || []).slice().sort((a, b) => (b.poss || 0) - (a.poss || 0));
    const teamGp = Number(active.offStats?.gp || 0);
    const estTeamPoss = roster.length ? Math.max(teamGp * 102, Math.round(roster.reduce((s, p) => s + Number(p.poss || 0), 0) / 5)) : (teamGp * 102);

    const mergeTier = tier => {
      const base = (active.lineups?.[tier] || []).map(x => ({ ...x }));
      const srcRows = [...(llJson?.[tier] || []), ...(ldJson?.[tier] || [])].filter(x => x.TEAM_ABBREVIATION === active.abbrev || !x.TEAM_ABBREVIATION);
      srcRows.forEach(x => {
        const pStr = String(x.GROUP_NAME || x.players || '');
        if (!pStr) return;
        const fga = Number(x.FGA || 0), fta = Number(x.FTA || 0), pts = Number(x.PTS || 0);
        const tsCalc = (x.TS_PCT != null) ? Number(x.TS_PCT) * 100 : ((fga + 0.44 * fta) > 0 ? (pts / (2 * (fga + 0.44 * fta))) * 100 : null);
        const extra = {
          tsPct: tsCalc,
          tovPct: x.TM_TOV_PCT != null ? Number(x.TM_TOV_PCT) * 100 : null,
          orebPct: x.OREB_PCT != null ? Number(x.OREB_PCT) * 100 : null,
          fg3Pct: x.FG3_PCT != null ? Number(x.FG3_PCT) * 100 : null,
          dTsPct: x.OPP_TS_PCT != null ? Number(x.OPP_TS_PCT) * 100 : null,
          dTovPct: x.OPP_TOV_PCT != null ? Number(x.OPP_TOV_PCT) * 100 : null,
          dOrbPct: x.OPP_OREB_PCT != null ? Number(x.OPP_OREB_PCT) * 100 : (x.DREB_PCT != null ? (1 - Number(x.DREB_PCT)) * 100 : null),
          d3pPct: x.OPP_FG3_PCT != null ? Number(x.OPP_FG3_PCT) * 100 : null
        };
        const hit = base.find(u => norm(u.players) === norm(pStr));
        if (hit) Object.entries(extra).forEach(([k, val]) => { if (val != null && !isNaN(val)) hit[k] = val; });
        else if (x.TEAM_ABBREVIATION === active.abbrev) base.push({ players: pStr, poss: Number(x.POSS || 0), ortg: Number(x.OFF_RATING || 0), drtg: Number(x.DEF_RATING || 0), ...extra });
      });
      return base.map(lu => {
        const names = String(lu.players || '').split(/\s+-\s+/).map(x => x.trim()).filter(Boolean);
        const keys = new Set();
        names.forEach(nm => { keys.add(norm(nm)); keys.add(shortInit(nm)); });
        return { ...lu, names, keys, poss: Number(lu.poss || 0), ortg: Number(lu.ortg || 0), drtg: Number(lu.drtg || 0) };
      }).filter(x => x.poss > 0);
    };

    const tiers = { 2: mergeTier('duos'), 3: mergeTier('trios'), 4: mergeTier('quads'), 5: mergeTier('fiveman') };
    const selected = roster.slice(0, Math.min(2, roster.length)).map(r => r.name);

    const getAllOnStats = onIndices => {
      const k = onIndices.length;
      const allTeamLus = Object.values(tiers).flat();
const tmWAvg = fld => { let num = 0, den = 0; allTeamLus.forEach(lu => { if (lu[fld] != null && !isNaN(lu[fld])) { num += lu[fld] * lu.poss; den += lu.poss; } }); return den > 0 ? num / den : null; };
const tmOreb = active.offStats?.orebPct ?? tmWAvg('orebPct');
const tmDorb = active.defStats?.orebPct ?? (active.offStats?.drebPct != null ? 100 - Number(active.offStats.drebPct) : tmWAvg('dOrbPct'));
if (k === 0) return { poss: estTeamPoss, ptsFor: (Number(active.offStats?.rtg || 0) * estTeamPoss) / 100, ptsAg: (Number(active.defStats?.rtg || 0) * estTeamPoss) / 100, tsPct: active.offStats?.tsPct ?? null, tovPct: active.offStats?.tovPct ?? null, orebPct: tmOreb, fg3Pct: active.offStats?.fg3Pct ?? null, dTsPct: active.defStats?.tsPct ?? null, dTovPct: active.defStats?.tovPct ?? null, dOrbPct: tmDorb, d3pPct: active.defStats?.fg3Pct ?? null };
if (k === 1) {
const p = roster.find(r => r.name === selected[onIndices]);
if (!p || !p.poss) return null;
const pPoss = Number(p.poss), tovPct = (p.fga + 0.44 * (p.fta || 0) + (p.tov || 0)) > 0 ? ((p.tov || 0) / (p.fga + 0.44 * (p.fta || 0) + (p.tov || 0))) * 100 : (active.offStats?.tovPct ?? null);
const pKey = norm(p.name), pSi = shortInit(p.name), pLus = allTeamLus.filter(lu => lu.keys.has(pKey) || lu.keys.has(pSi));
const wAvg = fld => { let num = 0, den = 0; pLus.forEach(lu => { if (lu[fld] != null && !isNaN(lu[fld])) { num += lu[fld] * lu.poss; den += lu.poss; } }); return den > 0 ? num / den : null; };
return { poss: pPoss, ptsFor: (Number(p.ortg) * pPoss) / 100, ptsAg: (Number(p.drtg) * pPoss) / 100, tsPct: wAvg('tsPct') ?? p.tsPct ?? active.offStats?.tsPct ?? null, tovPct: wAvg('tovPct') ?? tovPct, orebPct: wAvg('orebPct') ?? tmOreb, fg3Pct: wAvg('fg3Pct') ?? p.fg3Pct ?? active.offStats?.fg3Pct ?? null, dTsPct: wAvg('dTsPct') ?? active.defStats?.tsPct ?? null, dTovPct: wAvg('dTovPct') ?? active.defStats?.tovPct ?? null, dOrbPct: wAvg('dOrbPct') ?? tmDorb, d3pPct: wAvg('d3pPct') ?? active.defStats?.fg3Pct ?? null };
}
      const list = tiers[k] || [], req = onIndices.map(idx => ({ k1: norm(selected[idx]), k2: shortInit(selected[idx]) }));
      const hit = list.find(lu => req.every(q => lu.keys.has(q.k1) || lu.keys.has(q.k2)));
      if (!hit) return null;
      return { poss: hit.poss, ptsFor: (hit.ortg * hit.poss) / 100, ptsAg: (hit.drtg * hit.poss) / 100, tsPct: hit.tsPct ?? active.offStats?.tsPct ?? null, tovPct: hit.tovPct ?? active.offStats?.tovPct ?? null, orebPct: hit.orebPct ?? active.offStats?.orebPct ?? null, fg3Pct: hit.fg3Pct ?? active.offStats?.fg3Pct ?? null, dTsPct: hit.dTsPct ?? active.defStats?.tsPct ?? null, dTovPct: hit.dTovPct ?? active.defStats?.tovPct ?? null, dOrbPct: hit.dOrbPct ?? active.defStats?.orebPct ?? (active.offStats?.drebPct != null ? 100 - Number(active.offStats.drebPct) : null), d3pPct: hit.d3pPct ?? active.defStats?.fg3Pct ?? null };
    };
    const STAT_KEYS = ['tsPct', 'tovPct', 'orebPct', 'fg3Pct', 'dTsPct', 'dTovPct', 'dOrbPct', 'd3pPct'];
    const computePermutations = () => {
      const n = selected.length;
      if (!n) return [];
      const rows = [];
      for (let mask = (1 << n) - 1; mask >= 0; mask--) {
        const onIdx = [], offIdx = [];
        for (let i = 0; i < n; i++) (((mask >> i) & 1) ? onIdx : offIdx).push(i);
        let poss = 0, ptsFor = 0, ptsAg = 0, valid = true;
        const wSums = {}, wPoss = {};
        STAT_KEYS.forEach(k => { wSums[k] = 0; wPoss[k] = 0; });
        const m = offIdx.length;
        for (let sub = 0; sub < (1 << m); sub++) {
          const subset = onIdx.slice();
          let bits = 0;
          for (let j = 0; j < m; j++) { if ((sub >> j) & 1) { subset.push(offIdx[j]); bits++; } }
          const st = getAllOnStats(subset);
          if (!st) { valid = false; break; }
          const sign = (bits % 2 === 0) ? 1 : -1;
          poss += sign * st.poss; ptsFor += sign * st.ptsFor; ptsAg += sign * st.ptsAg;
          STAT_KEYS.forEach(fk => { if (st[fk] != null && !isNaN(st[fk])) { wSums[fk] += sign * st[fk] * st.poss; wPoss[fk] += sign * st.poss; } });
        }
        const direct = offIdx.length === 0 ? getAllOnStats(onIdx) : (mask === 0 ? getAllOnStats([]) : null);
        const extra = direct ? { ...direct } : {};
        STAT_KEYS.forEach(fk => { if (extra[fk] == null && wPoss[fk] > 0) extra[fk] = wSums[fk] / wPoss[fk]; });
        if (!valid || poss <= 0) rows.push({ mask, poss: 0, ortg: null, drtg: null, netRtg: null, extra });
        else { const ortg = (ptsFor / poss) * 100, drtg = (ptsAg / poss) * 100; rows.push({ mask, poss: Math.round(poss), ortg, drtg, netRtg: ortg - drtg, extra }); }
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
      const onNames = selected.filter((_, i) => (mask >> i) & 1), offNames = selected.filter((_, i) => !((mask >> i) & 1));
      const onSet = new Set(onNames.flatMap(nm => [norm(nm), shortInit(nm)])), offSet = new Set(offNames.flatMap(nm => [norm(nm), shortInit(nm)]));
      const coMates = [];
      let wDre = 0, wSlots = 0;
      if (onNames.length === 1 && row.poss > 0) {
        roster.forEach(mate => {
          const mk = norm(mate.name), mSi = shortInit(mate.name);
          if (onSet.has(mk) || offSet.has(mk)) return;
          const duo = Object.values(tiers).flat().find(lu => (lu.keys.has(norm(onNames)) || lu.keys.has(shortInit(onNames))) && (lu.keys.has(mk) || lu.keys.has(mSi)));
          const sharedPoss = duo ? duo.poss : Object.values(tiers).flat().filter(lu => (lu.keys.has(norm(onNames)) || lu.keys.has(shortInit(onNames))) && (lu.keys.has(mk) || lu.keys.has(mSi))).reduce((s, u) => s + u.poss, 0);
          if (sharedPoss > 0) {
            const dRec = teamDreByKey[mk] || teamDreByKey[mSi];
            coMates.push({ fullName: mate.name, share: Math.min(100, Math.round((sharedPoss / row.poss) * 100)), poss: sharedPoss, dre: dRec ? dRec.dre : null, photo: photoMap[mk] || photoMap[mSi] || '' });
            if (dRec) { wDre += dRec.dre * sharedPoss; wSlots += sharedPoss; }
          }
        });
      } else {
        tiers.forEach(lu => {
          for (let i = 0; i < selected.length; i++) if ((lu.keys.has(norm(selected[i])) || lu.keys.has(shortInit(selected[i]))) !== Boolean((mask >> i) & 1)) return;
          lu.names.forEach(rawNm => {
            const k = norm(rawNm), si = shortInit(rawNm);
            if (onSet.has(k) || onSet.has(si) || offSet.has(k) || offSet.has(si)) return;
            const hit = roster.find(r => norm(r.name) === k || shortInit(r.name) === si), full = hit ? hit.name : rawNm;
            const prev = coMates.find(c => c.fullName === full);
            if (prev) prev.poss += lu.poss;
            else coMates.push({ fullName: full, poss: lu.poss, share: 0, dre: (teamDreByKey[norm(full)] || teamDreByKey[si])?.dre ?? null, photo: photoMap[norm(full)] || photoMap[si] || '' });
            const dRec = teamDreByKey[norm(full)] || teamDreByKey[si];
            if (dRec) { wDre += dRec.dre * lu.poss; wSlots += lu.poss; }
          });
        });
        const denom = Object.values(tiers).flat().filter(lu => selected.every((nm, i) => (lu.keys.has(norm(nm)) || lu.keys.has(shortInit(nm))) === Boolean((mask >> i) & 1))).reduce((s, u) => s + u.poss, 0) || row.poss;
        coMates.forEach(c => { c.share = denom > 0 ? Math.min(100, Math.round((c.poss / denom) * 100)) : 0; });
      }
      coMates.sort((a, b) => b.share - a.share);
      const topMates = coMates.slice(0, 7), supNet = wSlots > 0 ? (wDre / wSlots) : null;
      const supPctile = (supNet != null && allDre.length > 1) ? Math.round((allDre.filter(v => v <= supNet).length / allDre.length) * 100) : null;
      const fmtD = (v, b, lb) => {
        if (v == null || b == null || isNaN(v) || isNaN(b)) return '<div style="font-size:10px;color:#64748b;">-</div>';
        const diff = v - b, col = Math.abs(diff) < 0.05 ? '#94a3b8' : ((lb ? diff < 0 : diff > 0) ? '#38bdf8' : '#f87171');
        return `<div style="font-size:10.5px;font-weight:700;color:${col};margin-top:1px;">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}</div>`;
      };
      const avatars = selected.map((nm, idx) => {
        const isOn = Boolean((mask >> idx) & 1), u = photoMap[norm(nm)] || photoMap[shortInit(nm)] || '';
        const lbl = jerseyMap[norm(nm)] || jerseyMap[shortInit(nm)] || nm.split(' ').map(w => w.at(0)).join('').slice(0, 2).toUpperCase();
        const ring = isOn ? '3px solid #22d3ee;box-shadow:0 0 12px rgba(34,211,238,0.45);' : '2px solid #475569;filter:grayscale(1);opacity:0.45;';
        const img = u ? `<img src="${u}" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" style="width:54px;height:54px;border-radius:50%;object-fit:cover;object-position:top;border:${ring}"><div style="display:none;width:54px;height:54px;border-radius:50%;background:#1e293b;border:${ring}align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-weight:700;font-size:15px;color:#f8fafc;">${lbl}</div>` : `<div style="width:54px;height:54px;border-radius:50%;background:#1e293b;border:${ring}display:flex;align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-weight:700;font-size:15px;color:#f8fafc;">${lbl}</div>`;
        const badge = isOn ? '' : '<div style="position:absolute;inset:0;border-radius:50%;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;"><span style="background:#334155;color:#cbd5e1;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;">OFF</span></div>';
        return `<div style="text-align:center;"><div style="position:relative;display:inline-block;">${img}${badge}</div><div style="font-size:11px;font-weight:600;color:#f1f5f9;margin-top:4px;">${nm}</div></div>`;
      }).join('');
      const supCol = supNet == null ? '#94a3b8' : (supNet >= 0 ? '#22d3ee' : '#f87171');
      const supRing = `<div style="text-align:center;"><div style="width:54px;height:54px;border-radius:50%;background:#1e293b;border:3px solid ${supCol};display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto;"><div style="font-size:13.5px;font-weight:700;color:${supCol};line-height:1;">${supNet == null ? '-' : ((supNet >= 0 ? '+' : '') + supNet.toFixed(1))}</div><div style="font-size:8px;font-weight:700;color:#94a3b8;margin-top:2px;">${supPctile != null ? supPctile + 'th %ile' : '-'}</div></div><div style="font-size:11px;font-weight:600;color:#cbd5e1;margin-top:4px;">Lineup Support</div></div>`;
      const matesHtml = topMates.map(cm => {
        const dCol = cm.dre == null ? '#94a3b8' : (cm.dre >= 0 ? '#38bdf8' : '#f87171'), dTxt = cm.dre == null ? '' : ` <span style="color:${dCol};">${cm.dre >= 0 ? '+' : ''}${cm.dre.toFixed(1)}</span>`;
        const mLbl = jerseyMap[norm(cm.fullName)] || jerseyMap[shortInit(cm.fullName)] || cm.fullName.split(' ').map(w => w.at(0)).join('').slice(0, 2).toUpperCase();
        const av = cm.photo ? `<img src="${cm.photo}" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" style="width:40px;height:40px;border-radius:50%;object-fit:cover;object-position:top;border:2px solid #38bdf8;"><div style="display:none;width:40px;height:40px;border-radius:50%;background:#1e293b;border:2px solid #38bdf8;align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-size:12px;font-weight:700;color:#f8fafc;">${mLbl}</div>` : `<div style="width:40px;height:40px;border-radius:50%;background:#1e293b;border:2px solid #38bdf8;display:flex;align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-size:12px;font-weight:700;color:#f8fafc;">${mLbl}</div>`;
        return `<div style="text-align:center;min-width:56px;"><div style="font-size:10.5px;font-weight:700;color:#e2e8f0;margin-bottom:3px;">${cm.share}%${dTxt}</div>${av}<div style="font-size:10px;color:#cbd5e1;margin-top:3px;line-height:1.15;">${cm.fullName.split(' ').slice(0, 2).join('<br>')}</div></div>`;
      }).join('');
      const ex = row.extra || {}, otherSlots = Math.max(1, 5 - onNames.length);
      const b1 = `<div style="background:#141b29;border-radius:10px;border:1px solid #283548;padding:14px 18px;width:100%;display:block;color:#f8fafc;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><div style="font-family:Oswald,sans-serif;font-size:12px;font-weight:700;color:#94a3b8;">${active.abbrev} &middot; LINEUPS <span style="color:#38bdf8;margin-left:6px;">${szn}</span></div><button type="button" onclick="document.getElementById('teamWowyProfileModal').style.display='none'" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;font-size:11px;padding:2px 8px;border-radius:4px;cursor:pointer;">✕</button></div><div style="display:flex;justify-content:center;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:14px;">${avatars}${supRing}</div><div style="display:grid;grid-template-columns:repeat(6,1fr);text-align:center;padding-top:10px;border-top:1px solid #263244;"><div><div style="font-size:9.5px;color:#94a3b8;">POSS</div><div style="font-size:16px;font-weight:700;">${row.poss}</div></div><div><div style="font-size:9.5px;color:#94a3b8;">NET</div><div style="font-size:16px;font-weight:700;color:${(row.netRtg ?? 0) >= 0 ? '#38bdf8' : '#f87171'};">${row.netRtg != null ? ((row.netRtg >= 0 ? '+' : '') + row.netRtg.toFixed(1)) : '-'}</div></div><div><div style="font-size:9.5px;color:#94a3b8;">OFF</div><div style="font-size:16px;font-weight:700;">${row.ortg != null ? row.ortg.toFixed(1) : '-'}</div>${fmtD(row.ortg, lg.offRtg, false)}</div><div><div style="font-size:9.5px;color:#94a3b8;">DEF</div><div style="font-size:16px;font-weight:700;">${row.drtg != null ? row.drtg.toFixed(1) : '-'}</div>${fmtD(row.drtg, lg.defRtg, true)}</div><div><div style="font-size:9.5px;color:#94a3b8;">O-3P%</div><div style="font-size:16px;font-weight:700;">${ex.fg3Pct != null ? ex.fg3Pct.toFixed(1) + '%' : '-'}</div>${fmtD(ex.fg3Pct, lg.o3p, false)}</div><div><div style="font-size:9.5px;color:#94a3b8;">D-3P%</div><div style="font-size:16px;font-weight:700;">${ex.d3pPct != null ? ex.d3pPct.toFixed(1) + '%' : '-'}</div>${fmtD(ex.d3pPct, lg.d3p, true)}</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;padding-top:10px;border-top:1px solid #263244;text-align:center;"><div><div style="font-family:Oswald,sans-serif;font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:6px;">OFFENSIVE</div><div style="display:grid;grid-template-columns:repeat(3,1fr);"><div><div style="font-size:9px;color:#94a3b8;">TS%</div><div style="font-size:14px;font-weight:700;">${ex.tsPct != null ? ex.tsPct.toFixed(1) : '-'}</div>${fmtD(ex.tsPct, lg.oTs, false)}</div><div><div style="font-size:9px;color:#94a3b8;">TOV%</div><div style="font-size:14px;font-weight:700;">${ex.tovPct != null ? ex.tovPct.toFixed(1) : '-'}</div>${fmtD(ex.tovPct, lg.oTov, true)}</div><div><div style="font-size:9px;color:#94a3b8;">ORB%</div><div style="font-size:14px;font-weight:700;">${ex.orebPct != null ? ex.orebPct.toFixed(1) : '-'}</div>${fmtD(ex.orebPct, lg.oOrb, false)}</div></div></div><div style="border-left:1px solid #263244;padding-left:12px;"><div style="font-family:Oswald,sans-serif;font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:6px;">DEFENSIVE</div><div style="display:grid;grid-template-columns:repeat(3,1fr);"><div><div style="font-size:9px;color:#94a3b8;">D-TS%</div><div style="font-size:14px;font-weight:700;">${ex.dTsPct != null ? ex.dTsPct.toFixed(1) : '-'}</div>${fmtD(ex.dTsPct, lg.dTs, true)}</div><div><div style="font-size:9px;color:#94a3b8;">D-TOV%</div><div style="font-size:14px;font-weight:700;">${ex.dTovPct != null ? ex.dTovPct.toFixed(1) : '-'}</div>${fmtD(ex.dTovPct, lg.dTov, false)}</div><div><div style="font-size:9px;color:#94a3b8;">D-ORB%</div><div style="font-size:14px;font-weight:700;">${ex.dOrbPct != null ? ex.dOrbPct.toFixed(1) : '-'}</div>${fmtD(ex.dOrbPct, lg.dOrb, true)}</div></div></div></div></div>`;
            const calcZ = zObj => {
        const z = zObj || {};
        const sumZ = keys => keys.reduce((acc, k) => {
          const pair = z[k] || {};
          const m = Number(pair.at ? pair.at(0) : 0), a = Number(pair.at ? pair.at(1) : 0);
          return { m: acc.m + m, a: acc.a + a };
        }, { m: 0, a: 0 });
        const rim = sumZ(['Restricted Area']);
        const mid = sumZ(['Paint (Non-RA)', 'Left Baseline Mid', 'Left Elbow / Wing Mid', 'Center Mid-Range', 'Right Elbow / Wing Mid', 'Right Baseline Mid']);
        const c3 = sumZ(['Left Corner 3', 'Right Corner 3']);
        const p3 = sumZ(['Left Corner 3', 'Left Wing 3', 'Center / Top 3', 'Right Wing 3', 'Right Corner 3']);
        const totA = Math.max(1, rim.a + mid.a + p3.a);
        const pack = o => ({ freq: (o.a / totA) * 100, fg: o.a > 0 ? (o.m / o.a) * 100 : null });
        return { RIM: pack(rim), MID: pack(mid), '3P': pack(p3), C3: pack(c3) };
      };
      const oZ = calcZ(active.zones), dZ = calcZ(active.defZones);
      const lgOz = { RIM:{freq:0,fg:0,n:0}, MID:{freq:0,fg:0,n:0}, '3P':{freq:0,fg:0,n:0}, C3:{freq:0,fg:0,n:0} };
      const lgDz = { RIM:{freq:0,fg:0,n:0}, MID:{freq:0,fg:0,n:0}, '3P':{freq:0,fg:0,n:0}, C3:{freq:0,fg:0,n:0} };
      (allTeams || []).forEach(tm => {
        const oz = calcZ(tm.zones), dz = calcZ(tm.defZones);
        ['RIM','MID','3P','C3'].forEach(k => {
          if (oz[k].fg != null) { lgOz[k].freq += oz[k].freq; lgOz[k].fg += oz[k].fg; lgOz[k].n++; }
          if (dz[k].fg != null) { lgDz[k].freq += dz[k].freq; lgDz[k].fg += dz[k].fg; lgDz[k].n++; }
        });
      });
      const zBlock = (title, cur, lgMap, isDef, borderL) => {
        const cols = ['RIM','MID','3P','C3'];
        const hdrs = cols.map(k => `<div style="font-size:8.5px;color:#94a3b8;font-weight:700;">${k}</div>`).join('');
        const freqs = cols.map(k => { const b = lgMap[k].n ? lgMap[k].freq / lgMap[k].n : null; return `<div><div style="font-size:12px;font-weight:700;">${cur[k].freq.toFixed(1)}</div>${fmtD(cur[k].freq, b, false)}</div>`; }).join('');
        const fgs = cols.map(k => { const b = lgMap[k].n ? lgMap[k].fg / lgMap[k].n : null; return `<div><div style="font-size:12px;font-weight:700;">${cur[k].fg != null ? cur[k].fg.toFixed(1) : '-'}</div>${fmtD(cur[k].fg, b, isDef)}</div>`; }).join('');
        return `<div style="${borderL ? 'border-left:1px solid #263244;padding-left:12px;' : ''}"><div style="font-family:Oswald,sans-serif;font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:6px;text-align:center;">${title}</div><div style="display:grid;grid-template-columns:34px repeat(4,1fr);align-items:center;text-align:center;gap:2px;"><div></div>${hdrs}<div style="font-size:8.5px;color:#94a3b8;text-align:left;">FREQ</div>${freqs}<div style="font-size:8.5px;color:#94a3b8;text-align:left;margin-top:4px;">FG%</div>${fgs}</div></div>`;
      };
      const bShot = `<div style="background:#141b29;border-radius:10px;border:1px solid #283548;padding:12px 16px;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:12px;color:#f8fafc;">${zBlock('SHOT LOCATION (OFF)', oZ, lgOz, false, false)}${zBlock('SHOT LOCATION (DEF)', dZ, lgDz, true, true)}</div>`;
      const b2 = `<div style="background:#1c2536;border-radius:10px;border:1.5px solid #94a3b8;padding:11px 16px;text-align:center;width:100%;display:block;color:#f8fafc;"><div style="font-family:Oswald,sans-serif;font-size:11.5px;font-weight:700;color:#e2e8f0;">LINEUP SUPPORT (${otherSlots}) &middot; <span style="color:#22d3ee;">${supPctile != null ? supPctile + 'th %ile' : '-'}</span></div><div style="font-size:10px;color:#94a3b8;margin:3px 0 5px;">Possession-weighted average DRE of other teammates on floor (vs. G League)</div><div style="font-size:13.5px;font-weight:700;color:#38bdf8;">${supNet == null ? '-' : ((supNet >= 0 ? '+' : '') + supNet.toFixed(1) + ' DRE')}</div></div>`;
      const b3 = `<div style="background:#141b29;border-radius:10px;border:1px solid #283548;padding:12px 16px;text-align:center;width:100%;display:block;color:#f8fafc;"><div style="font-family:Oswald,sans-serif;font-size:9.5px;font-weight:700;color:#94a3b8;margin-bottom:8px;">SHARED FLOOR WITH LINEUP % | DRE</div><div style="display:flex;justify-content:center;align-items:flex-start;gap:12px;flex-wrap:wrap;">${matesHtml || '<span style="font-size:11px;color:#64748b;">No duo/lineup overlap logged for this split</span>'}</div></div>`;
      modal.innerHTML = `<style>#teamWowyProfileModal *{box-sizing:border-box}#teamWowyProfileModal .twm-wrap{width:560px;max-width:95vw;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;font-family:Lora,serif;color:#f8fafc}</style><div class="twm-wrap">${b1}${bShot}${b2}${b3}</div>`;
    };

    const renderWowy = () => {
      const chips = roster.slice(0, 14).map(r => {
        const activeSel = selected.includes(r.name);
        return `<button type="button" data-nm="${r.name.replace(/"/g, '&quot;')}" style="padding:3px 8px;font-size:10.5px;font-family:'Lora',serif;font-weight:${activeSel ? '700' : '500'};border-radius:4px;cursor:pointer;border:1px solid ${activeSel ? 'var(--blue)' : 'var(--border)'};background:${activeSel ? 'var(--blue)' : '#fff'};color:${activeSel ? '#fff' : 'var(--ink)'};">${r.name}</button>`;
      }).join('');
const perms = computePermutations(), fmtCell = v => v != null && !isNaN(v) ? v.toFixed(1) + '%' : '—';
const rowsHtml = !perms.length
? 'Select 1–4 players above to view WOWY combinations.'
: perms.map(r => {
const tags = selected.map((nm, i) => {
const isOn = Boolean((r.mask >> i) & 1);
return `<span style="display:inline-block;padding:2px 6px;margin-right:4px;border-radius:3px;font-size:10.5px;font-weight:700;background:${isOn ? '#dcfce7' : '#fee2e2'};color:${isOn ? '#166534' : '#991b1b'};">${isOn ? 'ON' : 'OFF'} ${nm.split(' ').pop()}</span>`;
}).join('');
const netCol = r.netRtg == null ? 'var(--muted)' : (r.netRtg >= 0 ? 'var(--green)' : 'var(--red)'), ex = r.extra || {};
return `<tr onclick="window._openTeamWowyProfile(${r.mask})" style="cursor:pointer;border-bottom:1px solid var(--border);"><td style="padding:5px 6px;white-space:nowrap;">${tags}<button type="button" onclick="event.stopPropagation();window._openTeamWowyProfile(${r.mask})" style="margin-left:4px;padding:2px 6px;font-family:Oswald,sans-serif;font-size:9.5px;font-weight:700;background:var(--blue);color:#fff;border:none;border-radius:3px;cursor:pointer;">Profile ↗</button></td><td style="padding:5px 5px;text-align:right;font-weight:700;">${r.poss}</td><td style="padding:5px 5px;text-align:right;">${r.ortg != null ? r.ortg.toFixed(1) : '—'}</td><td style="padding:5px 5px;text-align:right;">${r.drtg != null ? r.drtg.toFixed(1) : '—'}</td><td style="padding:5px 5px;text-align:right;font-weight:700;color:${netCol};">${r.netRtg != null ? ((r.netRtg >= 0 ? '+' : '') + r.netRtg.toFixed(1)) : '—'}</td><td style="padding:5px 5px;text-align:right;">${fmtCell(ex.tsPct)}</td><td style="padding:5px 5px;text-align:right;">${fmtCell(ex.tovPct)}</td><td style="padding:5px 5px;text-align:right;">${fmtCell(ex.orebPct)}</td><td style="padding:5px 5px;text-align:right;">${fmtCell(ex.dTsPct)}</td><td style="padding:5px 5px;text-align:right;">${fmtCell(ex.dTovPct)}</td><td style="padding:5px 5px;text-align:right;">${fmtCell(ex.dOrbPct)}</td></tr>`;
}).join('') + (() => {
        if (perms.length === 2 && perms.at(0).poss > 0 && perms.at(1).poss > 0) {
          const a = perms.at(0), b = perms.at(1), ea = a.extra || {}, eb = b.extra || {};
          const dNet = (a.netRtg != null && b.netRtg != null) ? a.netRtg - b.netRtg : null;
          const dOff = (a.ortg != null && b.ortg != null) ? a.ortg - b.ortg : null;
          const dDef = (a.drtg != null && b.drtg != null) ? a.drtg - b.drtg : null;
          const dP = (x, y, lb) => {
            if (x == null || y == null || isNaN(x) || isNaN(y)) return '?';
            const df = x - y, col = Math.abs(df) < 0.05 ? 'var(--muted)' : ((lb ? df < 0 : df > 0) ? 'var(--green)' : 'var(--red)');
            return `<span style="color:${col};font-weight:700;">${df >= 0 ? '+' : ''}${df.toFixed(1)}%</span>`;
          };
          const dR = (x, lb) => x == null ? '?' : `<span style="color:${(lb ? x < 0 : x > 0) ? 'var(--green)' : 'var(--red)'};font-weight:700;">${x >= 0 ? '+' : ''}${x.toFixed(1)}</span>`;
          return `<tr style="background:var(--surface);border-top:1px solid var(--border);font-size:10.5px;"><td style="padding:5px 6px;font-family:Oswald,sans-serif;font-weight:700;color:var(--muted);">ON - OFF</td><td style="padding:5px 5px;text-align:right;color:var(--muted);">diff</td><td style="padding:5px 5px;text-align:right;">${dR(dOff, false)}</td><td style="padding:5px 5px;text-align:right;">${dR(dDef, true)}</td><td style="padding:5px 5px;text-align:right;">${dR(dNet, false)}</td><td style="padding:5px 5px;text-align:right;">${dP(ea.tsPct, eb.tsPct, false)}</td><td style="padding:5px 5px;text-align:right;">${dP(ea.tovPct, eb.tovPct, true)}</td><td style="padding:5px 5px;text-align:right;">${dP(ea.orebPct, eb.orebPct, false)}</td><td style="padding:5px 5px;text-align:right;">${dP(ea.dTsPct, eb.dTsPct, true)}</td><td style="padding:5px 5px;text-align:right;">${dP(ea.dTovPct, eb.dTovPct, false)}</td><td style="padding:5px 5px;text-align:right;">${dP(ea.dOrbPct, eb.dOrbPct, true)}</td></tr>`;
        }
        return '';
      })();
host.innerHTML = `<div class="tm-card"  style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><div class="tm-card-title" style="margin:0;">Lineup WOWY Builder &amp; On/Off Combinations (Select up to 4 Players)</div><span style="font-size:10px;color:var(--muted);">Click any row or Profile ↗ for Lineup Support</span></div><div id="tmWowyChips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${chips}</div><div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;"><th style="padding:3px 6px;text-align:left;border-bottom:1px solid var(--border);">LINEUP</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">POSS</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">OFF</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">DEF</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">NET</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">OFF TS%</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">OFF TOV%</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">OFF ORB%</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">DEF TS%</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">DEF TOV%</th><th style="padding:3px 5px;text-align:right;border-bottom:1px solid var(--border);">DEF ORB%</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div>`;
host.querySelectorAll('#tmWowyChips button').forEach(btn => {
btn.onclick = () => {
const nm = btn.dataset.nm, idx = selected.indexOf(nm);
if (idx >= 0) selected.splice(idx, 1);
else if (selected.length < 4) selected.push(nm);
renderWowy();
};
});
};
renderWowy();
};
})();
