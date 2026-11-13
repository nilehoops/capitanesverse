const STAFF_PATH = 'data/staff_notes.json';
// XREF_PATH is now dynamic via dataPath('lineup_data')

const MXC_TEAM_ID = 1612709931;
const AVAILABLE_SEASONS = ['2026-27', '2025-26'];
let SEASON = localStorage.getItem('capitanes_season') || '2026-27';

// Season-specific file paths
function dataPath(file) {
  return `data/${file}_${SEASON}.json`;
}

// Set this to your deployed Cloudflare Worker URL after deployment.
// e.g. 'https://nba-proxy.YOUR-NAME.workers.dev'
// Leave as empty string to disable proxy (live fetches will fail due to CORS).
const PROXY_BASE = '';

// Route a stats.nba.com URL through the proxy if configured
function proxyUrl(nbaUrl) {
  if (!PROXY_BASE) return nbaUrl; // no proxy — will likely CORS-fail from browser
  return `${PROXY_BASE}?url=${encodeURIComponent(nbaUrl)}`;
}

// When using the proxy, no custom headers needed (Worker adds them server-side)
function nbaFetch(url) {
  if (PROXY_BASE) {
    return fetch(proxyUrl(url)); // proxy handles headers
  }
  return fetch(url, { headers: {
    'User-Agent':          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer':             'https://www.nba.com/',
    'Accept':              'application/json, text/plain, */*',
    'Accept-Language':     'en-US,en;q=0.9',
    'Origin':              'https://www.nba.com',
    'x-nba-stats-origin':  'stats',
    'x-nba-stats-token':   'true',
  }});
}

let playerXref = {};   // loaded once from stored lineup_data.json
let currentFetch = null; // AbortController for in-flight request
let debounceTimer = null;

function photoForLineupName(n) { return playerXref[n]?.photoUrl || null; }
function idForLineupName(n)    { return playerXref[n]?.id || null; }

// 30th-percentile minutes threshold — computed from actual data so it
// adapts to however many combinations exist for each group size.
function getPoss(row) {
  return row.POSS ?? row.MIN_ACTUAL ?? row.MIN ?? 0;
}

// Dynamic floor: minimum possessions to show a lineup combination.
// Scales with season progress — early season a 10-poss duo is meaningful,
// late season the same combo is noise.
// groupSize: 2=duos, 3=trios, 4=quads, 5=fiveman
function dynamicFloor(rows, groupSize) {
  if (!rows.length) return 0;
  const totalPoss = rows.reduce((s, r) => s + getPoss(r), 0);
  // Minimum share of total group possessions to be considered meaningful.
  // Larger groups have fewer combinations and each one is rarer — lower threshold.
  const minShare = { 2: 0.015, 3: 0.008, 4: 0.004, 5: 0.002 }[groupSize] || 0.01;
  const absMin   = { 2: 8,     3: 5,     4: 3,     5: 2    }[groupSize] || 5;
  return Math.max(absMin, totalPoss * minShare);
}

function pct30Threshold(rows, groupSize) {
  // Legacy name kept for compatibility — now delegates to dynamicFloor
  return dynamicFloor(rows, groupSize || 2);
}

function getLabFilters() {
  return {
    location:    document.getElementById('labLocation').value,
    period:      document.getElementById('labPeriod').value,
    gameSegment: document.getElementById('labHalf').value,
    lastNGames:  document.getElementById('labLastN').value,
    outcome:     document.getElementById('labOutcome').value,
  };
}

async function fetchMXCLineups(groupQuantity, filters = {}) {
  const params = new URLSearchParams({
    LeagueID:       '20',
    Season:         SEASON,
    SeasonType:     'Regular+Season',
    MeasureType:    'Advanced',
    PerMode:        'PerMinute',
    GroupQuantity:  String(groupQuantity),
    TeamID:         String(MXC_TEAM_ID),
    PaceAdjust:     'N',
    Rank:           'N',
    Outcome:        filters.outcome     || '',
    Location:       filters.location    || '',
    Month:          '0',
    SeasonSegment:  '',
    DateFrom:       filters.dateFrom    || '',
    DateTo:         filters.dateTo      || '',
    OpponentTeamID: '0',
    VsConference:   '',
    VsDivision:     '',
    GameSegment:    filters.gameSegment || '',
    Period:         filters.period      || '0',
    ShotClockRange: '',
    LastNGames:     filters.lastNGames  || '0',
    MinutesFilter:  '0',
  });

  const url = `https://stats.nba.com/stats/leaguedashlineups?${params}`;
  const resp = await nbaFetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const rs   = data.resultSets?.[0];
  if (!rs)   throw new Error('No resultSets in response');
  const hdrs = rs.headers;
  return rs.rowSet.map(row => Object.fromEntries(hdrs.map((h, i) => [h, row[i]])));
}

let labFetch = null;
let labDebounce = null;

async function fetchAllGroupsLive() {
  // Main page — no filters, 30th percentile threshold
  const container = document.getElementById('lineupContent');
  const statusEl  = document.getElementById('lineupFetchStatus');

  if (currentFetch) currentFetch.abort();
  currentFetch = new AbortController();
  const signal = currentFetch.signal;

  container.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:8px 0;">Fetching…</div>`;
  statusEl.textContent = 'Loading…';

  try {
    const [duos, trios, quads, fiveman] = await Promise.all([
      fetchMXCLineups(2, { signal }),
      fetchMXCLineups(3, { signal }),
      fetchMXCLineups(4, { signal }),
      fetchMXCLineups(5, { signal }),
    ]);
    const data = { duos, trios, quads, fiveman };
    // Compute 30th-percentile threshold per group size from actual data
    data._thresholds = {
      duos:    dynamicFloor(duos,    2),
      trios:   dynamicFloor(trios,   3),
      quads:   dynamicFloor(quads,   4),
      fiveman: dynamicFloor(fiveman, 5),
    };
    statusEl.textContent = `${duos.length} duos · ${trios.length} trios · ${quads.length} quads`;
    renderLineupContent(data);
  } catch (e) {
    if (e.name === 'AbortError') return;
    statusEl.textContent = '';
    container.innerHTML = `<div style="color:var(--red);font-size:12px;">Could not fetch: ${esc(e.message)}</div>`;
  }
}

async function fetchLabData() {
  const statusEl = document.getElementById('labStatus');
  const inner    = document.getElementById('lineupLabInner');
  const minMins  = Number(document.getElementById('labMinsSlider').value);

  if (labFetch) labFetch.abort();
  labFetch = new AbortController();
  const signal = labFetch.signal;

  statusEl.textContent = 'Loading…';
  inner.innerHTML = '';

  const filters = { ...getLabFilters(), signal };

  try {
    const [duos, trios, quads, fiveman] = await Promise.all([
      fetchMXCLineups(2, filters),
      fetchMXCLineups(3, filters),
      fetchMXCLineups(4, filters),
      fetchMXCLineups(5, filters),
    ]);
    statusEl.textContent = `${duos.length} duos · ${trios.length} trios · ${quads.length} quads`;
    renderLabContent({ duos, trios, quads, fiveman }, minMins);
  } catch (e) {
    if (e.name === 'AbortError') return;
    statusEl.textContent = '';
    inner.innerHTML = `<div style="color:var(--red);font-size:12px;">Could not fetch: ${esc(e.message)}</div>`;
  }
}

function triggerLabFetch() {
  clearTimeout(labDebounce);
  labDebounce = setTimeout(fetchLabData, 400);
}

// Data paths are season-aware — use dataPath() helper
let MEX_DATA_PATH    = () => dataPath('mex_data');
let LINEUP_DATA_PATH = () => dataPath('lineup_data');
let mexData = null;

async function loadMexData() {
  if (mexData) return mexData;
  const resp = await fetch(MEX_DATA_PATH() + '?v=' + Date.now());
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  mexData = await resp.json();
  return mexData;
}

function switchLabTab(tab) {
  ['lineups','players','wowy'].forEach(t => {
    document.getElementById(`labTab-${t}`).style.display = t === tab ? '' : 'none';
    document.querySelectorAll('.lab-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
  });
  if (tab === 'players') renderPlayerStats();
  if (tab === 'wowy') renderWowyInit();
}

async function renderTeamProfile() {} // kept as no-op to avoid reference errors

async function renderTrajectory() {
  const container = document.getElementById('trajectoryContent');
  if (!container) return;

  try {
    if (!cachedTeamStats) {
      const r = await fetch(TEAM_STATS_PATH() + '?v=' + Date.now());
      if (r.ok) cachedTeamStats = await r.json();
    }
  } catch(e) {}

  if (!cachedTeamStats) {
    container.innerHTML = '<div style="font-size:11px;color:var(--muted);">No data — commit team_stats.json.</div>';
    return;
  }

  const MXC_ID = 1612709931;
  const pctFields = new Set(['EFG_PCT','TM_TOV_PCT','OREB_PCT','DREB_PCT','OPP_EFG_PCT','OPP_TOV_PCT','OPP_OREB_PCT']);
  const lowerBetter = new Set(['TM_TOV_PCT','DEF_RATING','OPP_EFG_PCT','OPP_TOV_PCT','OPP_OREB_PCT']);

  function getMXC(slice) {
    return (cachedTeamStats.slices?.[slice] || []).find(t => t.TEAM_ID === MXC_ID);
  }

  function getRank(slice, key, val) {
    const teams = (cachedTeamStats.slices?.[slice] || []).filter(t => t[key] != null);
    if (!teams.length || val == null) return null;
    const better = lowerBetter.has(key)
      ? teams.filter(t => t[key] <= val).length
      : teams.filter(t => t[key] >= val).length;
    return better;
  }

  function fmt(key, val) {
    if (val == null) return '—';
    const v = Number(val);
    if (pctFields.has(key)) return (v * 100).toFixed(1) + '%';
    return v.toFixed(1);
  }

  function netColor(v) {
    if (v == null) return '';
    return v >= 0 ? 'color:var(--green);font-weight:700;' : 'color:var(--red);font-weight:700;';
  }

  // Define comparison groups: each is a set of slices shown side by side
  const comparisons = [
    { label: 'Home vs Away', slices: ['home','away'], keys: ['NET_RATING','OFF_RATING','DEF_RATING','EFG_PCT','TM_TOV_PCT'] },
    { label: 'By Half', slices: ['first_half','second_half'], keys: ['NET_RATING','OFF_RATING','DEF_RATING','EFG_PCT','TM_TOV_PCT'] },
    { label: 'By Quarter', slices: ['q1','q2','q3','q4'], keys: ['NET_RATING','OFF_RATING','DEF_RATING'] },
    { label: 'Opponent Strength', slices: ['vs_elite','vs_middle','vs_weak'], keys: ['NET_RATING','OFF_RATING','DEF_RATING','EFG_PCT','TM_TOV_PCT','OPP_EFG_PCT'] },
  ];

  const sliceLabels = {
    home:'Home', away:'Away', first_half:'1st Half', second_half:'2nd Half',
    q1:'Q1', q2:'Q2', q3:'Q3', q4:'Q4',
    vs_elite:'vs Elite', vs_middle:'vs Mid', vs_weak:'vs Weak',
  };

  const keyLabels = {
    NET_RATING:'NetRtg', OFF_RATING:'OffRtg', DEF_RATING:'DefRtg',
    EFG_PCT:'eFG%', TM_TOV_PCT:'TOV%', OREB_PCT:'OREB%',
    OPP_EFG_PCT:'Opp eFG%', OPP_TOV_PCT:'Opp TOV%',
  };

  const html = comparisons.map(comp => {
    const sliceData = comp.slices.map(sl => ({ sl, row: getMXC(sl) }));
    const header = `<tr><th style="text-align:left;font-size:8px;color:var(--muted);padding:0 2px;width:38px;"></th>${
      sliceData.map(({sl}) => `<th style="font-size:8px;color:var(--muted);padding:0 2px;text-align:right;white-space:nowrap;">${sliceLabels[sl]}</th>`).join('')
    }</tr>`;
    const rows = comp.keys.map(key => {
      const cells = sliceData.map(({sl, row}) => {
        const val = row ? row[key] : null;
        const rank = getRank(sl, key, val);
        const color = key === 'NET_RATING' ? netColor(val) : '';
        const rankStr = rank != null ? `<sup style="font-size:6px;color:var(--muted);">${rank}</sup>` : '';
        return `<td style="text-align:right;font-size:9px;padding:0 2px;white-space:nowrap;${color}">${fmt(key,val)}${rankStr}</td>`;
      }).join('');
      return `<tr><td style="font-size:8px;color:var(--muted);padding:0 2px;width:38px;">${keyLabels[key]||key}</td>${cells}</tr>`;
    }).join('');
    return `<div style="margin-bottom:5px;">
      <div style="font-size:8px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:0;">${comp.label}</div>
      <table style="border-collapse:collapse;">
        <thead>${header}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');

  container.innerHTML = html;
}

async function renderPlayerStats() {
  const container = document.getElementById('playerStatsContent');
  try {
    const d = await loadMexData();
    const players = d.players;
    // Key columns to show — full set available but we pick the most meaningful
    const cols = ['Player','MIN','TS%','eFG%','3P%','FT%','ORB%','DRB%','AST%','TOV%','USG%','ORtg','DRtg','PIE'];
    // Fields stored 0-1 in API that need ×100 for display
    const pct01 = new Set(['TS%','eFG%','3P%','FT%','ORB%','DRB%','AST%','USG%','STL%','BLK%']);
    const getName = p => p['Player'] || p['PLAYER_NAME'] || '—';
    const sorted = [...players].sort((a, b) => (b['MIN'] || 0) - (a['MIN'] || 0));

    function fmtStat(col, val) {
      if (val == null) return '—';
      const v = Number(val);
      if (pct01.has(col)) return (v * 100).toFixed(1) + '%';
      if (col === 'TOV%') return v.toFixed(1) + '%';
      if (col === 'PIE') return (v * 100).toFixed(1);
      if (col === 'ORtg' || col === 'DRtg') return v.toFixed(1);
      if (col === 'MIN') return v.toFixed(1);
      return Number.isInteger(v) ? v : v.toFixed(1);
    }

    container.innerHTML = `<div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr>${cols.map(c => `<th style="background:var(--surface);padding:4px 8px;border-bottom:1px solid var(--border);text-align:${c==='Player'?'left':'right'};white-space:nowrap;color:var(--muted);font-weight:600;">${c}</th>`).join('')}</tr></thead>
        <tbody>${sorted.filter(p => (p['MIN']||0) > 0).map(p => `<tr>
          ${cols.map(c => {
            const v = c === 'Player' ? getName(p) : p[c];
            const disp = c === 'Player' ? esc(v) : fmtStat(c, v);
            return `<td style="padding:3px 8px;border-bottom:1px solid var(--border);text-align:${c==='Player'?'left':'right'};">${disp}</td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
      </table></div>`;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--red);font-size:12px;">Could not load player stats: ${esc(e.message)}</div>`;
  }
}

// ── Multi-player WOWY ─────────────────────────────────────────
let _wowyPlayers = [];  // array of wowy entries loaded from mex_data

let _wowyPhotoMap = {};  // abbrev/name -> photoUrl

async function initWowySlots() {
  const d  = await loadMexData();
  // Load lineup data for playerXref photos
  if (!window._wowyLineupData) {
    window._wowyLineupData = await fetch(LINEUP_DATA_PATH() + '?v=' + Date.now())
      .then(r => r.ok ? r.json() : null).catch(() => null);
  }
  const ld = window._wowyLineupData;
  _wowyPlayers = (d.wowy || []).sort((a,b) => (a.player||'').localeCompare(b.player||''));

  // Build photo map: abbrev -> photoUrl from playerXref, then players_index
  const xref = ld?.playerXref || {};
  Object.entries(xref).forEach(([abbrev, info]) => {
    if (info?.photoUrl) _wowyPhotoMap[abbrev] = info.photoUrl;
    if (info?.name && info?.photoUrl) _wowyPhotoMap[info.name.toLowerCase()] = info.photoUrl;
  });
  // Also pull from players_index (already loaded via loadBap)
  try {
    const idx = await loadBap();
    (idx || []).forEach(p => {
      if (p.photoUrl) {
        if (p.name) _wowyPhotoMap[p.name.toLowerCase()] = p.photoUrl;
        // Build abbrev key
        const parts = (p.name||'').split(/\s+/);
        const SFXS = new Set(['jr','sr','ii','iii','iv','v']);
        if (parts.length >= 2) {
          const last = parts.filter(w => !SFXS.has(w.toLowerCase())).pop();
          if (last) _wowyPhotoMap[`${parts[0][0].toLowerCase()}. ${last.toLowerCase()}`] = p.photoUrl;
        }
      }
    });
  } catch(e) {}

  const container = document.getElementById('wowySlots');
  if (!container || !_wowyPlayers.length) return;

  container.innerHTML = Array.from({length:5}, (_, i) => `
    <div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:2px;text-align:center;">Player ${i+1}</div>
      <select id="wowySlot${i}" style="width:100%;font-size:10px;padding:2px 3px;border:1px solid var(--border);">
        <option value="">—</option>
        ${_wowyPlayers.map(p => `<option value="${esc(p.abbrev||p.player)}">${esc(p.player||p.abbrev)}</option>`).join('')}
      </select>
    </div>`).join('');
}

function getSelectedWowyPlayers() {
  return Array.from({length:5}, (_,i) => {
    const sel = document.getElementById(`wowySlot${i}`);
    return sel?.value || '';
  }).filter(Boolean);
}

function clearWowy() {
  for (let i=0;i<5;i++) {
    const sel = document.getElementById(`wowySlot${i}`);
    if (sel) sel.value = '';
  }
  document.getElementById('wowyContent').innerHTML = '';
  document.getElementById('wowyDiag').innerHTML = '';
}

function toggleWowyDiag() {
  const el = document.getElementById('wowyDiag');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function showWowyDiag(selected, d, pbpBuckets) {
  const el = document.getElementById('wowyDiag');
  if (!el || el.style.display === 'none') return;
  const lines = [];
  lines.push(`mex_data has ${(d.wowy||[]).length} wowy entries, ${(d.combo_wowy||[]).length} combo groups`);
  lines.push(`Selected: ${selected.join(', ')}`);
  selected.forEach(abbrev => {
    const e = _wowyPlayers.find(p=>p.abbrev===abbrev||p.player===abbrev);
    if (!e) { lines.push(`  ${abbrev}: NOT FOUND in wowy`); return; }
    const w = e.with || {};
    lines.push(`  ${e.player} (${abbrev}):`);
    lines.push(`    with:    POSS=${w.POSS} NetRtg=${w.NetRtg} OFF_EFG=${w.OFF_EFG_PCT} DEF_EFG=${w.DEF_EFG_PCT}`);
    lines.push(`    without: POSS=${(e.without||{}).POSS} NetRtg=${(e.without||{}).NetRtg}`);
    lines.push(`    source: ${e.rating_source||'none'}`);
  });
  if (pbpBuckets) {
    lines.push(`PBP bucket: POSS=${pbpBuckets.POSS} OFF_EFG=${pbpBuckets.OFF_EFG_PCT} DEF_EFG=${pbpBuckets.DEF_EFG_PCT} OFF_TOV=${pbpBuckets.OFF_TOV_PCT} DEF_TOV=${pbpBuckets.DEF_TOV_PCT}`);
  } else {
    lines.push(`PBP bucket: none (using lineup combo fallback)`);
  }
  el.textContent = lines.join('\n');
}

async function runWowy() {
  const selected = getSelectedWowyPlayers();
  if (!selected.length) {
    document.getElementById('wowyContent').innerHTML = '<div style="color:var(--muted);font-size:11px;">Select at least one player.</div>';
    return;
  }

  const d  = await loadMexData();
  const ld = window._wowyLineupData;
  const container = document.getElementById('wowyContent');
  container.innerHTML = '<div style="color:var(--muted);font-size:11px;">Computing…</div>';

  function getPlayers(c) { return (c.GROUP_NAME||'').split(' - ').map(n=>n.trim()); }

  // Use 5-man for POSS (non-overlapping, accurate sample size)
  // Use duos for ratings (most complete coverage, consistent bias in differential)
  const fivemanCombos = ld?.fiveman || [];
  const ratingCombos  = [...(ld?.duos||[]), ...(ld?.trios||[]), ...(ld?.quads||[]), ...(ld?.fiveman||[])];

  // Available fields: E_OFF_RATING, E_DEF_RATING, E_NET_RATING (smoothed for small samples)
  // EFG_PCT, TM_TOV_PCT, OREB_PCT, DREB_PCT, TS_PCT
  // No OPP_ fields — Four Factors not fetched for lineups yet
  const API_KEYS = {
    OFF: 'E_OFF_RATING', DEF: 'E_DEF_RATING', NET: 'E_NET_RATING',
    'OFF eFG%': 'EFG_PCT',    'OFF TOV%': 'TM_TOV_PCT', 'OFF ORB%': 'OREB_PCT',
    'DEF eFG%': 'OPP_EFG_PCT','DEF TOV%': 'OPP_TOV_PCT','DEF ORB%': 'OPP_OREB_PCT',
  };
  // PBP four factor keys in mex_data wowy entries
  const PBP_KEYS = {
    'OFF eFG%': 'OFF_EFG_PCT', 'OFF TOV%': 'OFF_TOV_PCT', 'OFF ORB%': 'OFF_ORB_PCT',
    'DEF eFG%': 'DEF_EFG_PCT', 'DEF TOV%': 'DEF_TOV_PCT', 'DEF ORB%': 'DEF_ORB_PCT',
  };
  const LB  = new Set(['DEF','OFF TOV%','DEF eFG%','DEF ORB%']);
  const PCT = new Set(['OFF eFG%','OFF TOV%','OFF ORB%','DEF eFG%','DEF TOV%','DEF ORB%']);

  function statsFromCombos(fivemanFiltered, ratingFiltered, pbpBucket) {
    // POSS: prefer PBP rotation (exact), fall back to 5-man lineups
    const fivePoss = fivemanFiltered.reduce((s,c)=>s+(c.POSS||0),0);
    const poss = pbpBucket?.POSS ?? fivePoss;
    const rPoss = ratingFiltered.reduce((s,c)=>s+(c.POSS||0),0);
    if (!poss && !rPoss) return null;
    const basePoss = rPoss || poss;
    const out = { POSS: poss || null };
    Object.entries(API_KEYS).forEach(([key, apiKey]) => {
      // Ratings: prefer PBP if available
      if (pbpBucket) {
        if (key==='OFF' && pbpBucket.OffRtg != null)      { out[key] = pbpBucket.OffRtg; return; }
        if (key==='DEF' && pbpBucket.DefRtg != null)      { out[key] = pbpBucket.DefRtg; return; }
        if (key==='NET' && pbpBucket.NetRtg != null)      { out[key] = pbpBucket.NetRtg; return; }
        const pbpKey = PBP_KEYS[key];
        if (pbpKey && pbpBucket[pbpKey] != null)           { out[key] = pbpBucket[pbpKey]; return; }
      }
      // Fall back to lineup combo weighted avg
      out[key] = basePoss
        ? ratingFiltered.reduce((s,c)=>s+((c[apiKey]||0)*(c.POSS||0)),0)/basePoss
        : null;
    });
    return out;
  }

  // League averages
  const leagueAvgs = {};
  if (cachedTeamStats?.slices?.all) {
    Object.entries(API_KEYS).forEach(([key, apiKey]) => {
      if (key==='POSS') return;
      const vals = cachedTeamStats.slices.all.map(t=>t[apiKey]).filter(v=>v!=null);
      if (vals.length) leagueAvgs[key] = vals.reduce((a,b)=>a+b,0)/vals.length;
    });
  }

  function fmtStat(key, val) {
    if (val==null) return '—';
    if (key==='POSS') return Math.round(val).toLocaleString();
    return PCT.has(key) ? (val*100).toFixed(1) : val.toFixed(1);
  }
  function deltaCell(key, val) {
    const avg = leagueAvgs[key];
    if (val==null||avg==null) return '<div style="font-size:8px;color:#aaa;">—</div>';
    // Both val and avg are raw API decimals (e.g. 0.13 for 13%)
    // Scale both the same way before comparing
    const scale = PCT.has(key) ? 100 : 1;
    const diff = (val * scale) - (avg * scale);
    const better = LB.has(key) ? diff<0 : diff>0;
    const sign = diff>=0 ? '+' : '';
    return `<div style="font-size:8px;color:${better?'#E6A817':'#aaa'};">${sign}${diff.toFixed(1)}${PCT.has(key)?'%':''}</div>`;
  }

  // Player photo circle — large Databallr style with OFF overlay
  function playerCircle(abbrev, isOn) {
    const entry = _wowyPlayers.find(p=>p.abbrev===abbrev||p.player===abbrev);
    const name  = entry ? (entry.player||abbrev).split(' ').pop() : abbrev;
    const url   = _wowyPhotoMap[abbrev] || _wowyPhotoMap[(abbrev||'').toLowerCase()] || null;
    const photoEl = url
      ? `<img src="${esc(url)}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;object-position:top;display:block;${!isOn?'filter:grayscale(1);opacity:0.45;':''}" onerror="this.src='';this.style.display='none'">`
      : `<div style="width:52px;height:52px;border-radius:50%;background:#ddd;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#888;${!isOn?'opacity:0.4;':''}">${esc(name[0]||'?')}</div>`;
    const offBadge = !isOn
      ? `<div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;color:#fff;letter-spacing:.05em;">OFF</div>`
      : '';
    const ring = isOn ? `border:2px solid var(--blue);` : `border:2px solid #ccc;`;
    return `<div style="text-align:center;min-width:60px;">
      <div style="position:relative;display:inline-block;border-radius:50%;${ring}">${photoEl}${offBadge}</div>
      <div style="font-size:9px;font-weight:700;margin-top:3px;color:${isOn?'var(--text)':'var(--muted)'};">${esc(name)}</div>
    </div>`;
  }

  // Generate all 2^N combinations
  const N = selected.length;
  const combos = [];
  for (let mask=(1<<N)-1; mask>=0; mask--) {
    const onSet  = selected.filter((_,i)=>  (mask>>(i))&1);
    const offSet = selected.filter((_,i)=>!((mask>>(i))&1));
    const filterFn = c => {
      const ps=getPlayers(c);
      return onSet.every(a=>ps.includes(a)) && offSet.every(a=>!ps.includes(a));
    };
    // For 1 player: use their PBP wowy bucket
    // For 2 players: use pre-computed duo combo PBP stats
    let pbpBucket = null;
    if (selected.length === 1) {
      const abbrev = selected[0];
      const wowyE  = _wowyPlayers.find(p=>p.abbrev===abbrev||p.player===abbrev);
      pbpBucket = onSet.length===1 ? wowyE?.with : wowyE?.without;
    } else if (selected.length >= 2) {
      const comboWowy = d.combo_wowy || [];
      const selNames = selected.map(a => {
        const e = _wowyPlayers.find(p=>p.abbrev===a||p.player===a);
        return e?.player || a;
      });
      const selSet = new Set(selNames);

      if (selected.length === 2) {
        // Exact duo lookup from pre-computed combo_wowy
        const comboEntry = comboWowy.find(c => {
          const ps = c.players || [];
          return ps.length === 2 && ps.every(n => selSet.has(n));
        });
        if (comboEntry) {
          const key = (comboEntry.players || []).map(n => {
            const abbrev = selected[selNames.indexOf(n)];
            return onSet.includes(abbrev) ? '1' : '0';
          }).join('');
          pbpBucket = comboEntry.combos?.[key] || null;
        }
      } else {
        // 3+ players: use individual PBP data for the player with least POSS in this bucket
        // as the best single-player approximation of the intersection
        const bucketKey = onSet.length === selected.length ? 'with' : 'without';
        const entries = selNames.map(n => _wowyPlayers.find(p=>p.player===n)).filter(Boolean);
        if (entries.length === selected.length) {
          // Use the entry with fewest POSS (tightest constraint)
          const minimal = entries.reduce((a,b) =>
            (a[bucketKey]?.POSS||0) < (b[bucketKey]?.POSS||0) ? a : b
          );
          pbpBucket = minimal[bucketKey] || null;
        }
      }
    }
    const stats = statsFromCombos(fivemanCombos.filter(filterFn), ratingCombos.filter(filterFn), pbpBucket);
    if (mask === (1<<N)-1) showWowyDiag(selected, d, pbpBucket); // show diag for all-on row
    const comboObj = {}; selected.forEach((_,i)=>{ comboObj[selected[i]]=!!((mask>>i)&1); });
    combos.push({ comboObj, stats, isAll: mask===(1<<N)-1, isNone: mask===0 });
  }

  // Stat columns config
  const COLS = [
    { key:'POSS',    label:'POSS' },
    { key:'OFF',     label:'OFF'  },
    { key:'DEF',     label:'DEF'  },
    { key:'NET',     label:'NET'  },
    null,
    { key:'OFF eFG%', label:'OFF eFG%' },
    { key:'OFF TOV%', label:'OFF TOV%' },
    { key:'OFF ORB%', label:'OFF ORB%' },
    null,
    { key:'DEF eFG%', label:'DEF eFG%' },
    { key:'DEF TOV%', label:'DEF TOV%' },
    { key:'DEF ORB%', label:'DEF ORB%' },
  ];

  const colHdrs = COLS.map(c => c
    ? `<th style="font-size:9px;color:var(--muted);padding:4px 6px;text-align:right;white-space:nowrap;border-bottom:2px solid #000;">${c.label}</th>`
    : `<th style="width:8px;border-bottom:2px solid #000;"></th>`
  ).join('');

  const rows = combos.map(({comboObj, stats, isAll, isNone}) => {
    const photos = selected.map(a=>playerCircle(a, comboObj[a])).join('');
    const bg = isAll ? 'background:#f4f8ff;' : isNone ? 'background:#fafafa;' : '';

    const cells = COLS.map(c => {
      if (!c) return `<td style="border-left:1px solid var(--border);"></td>`;
      const val = stats?.[c.key] ?? null;
      let mainStyle = '';
      if (c.key==='NET') mainStyle = val!=null ? (val>=0?'color:var(--green);font-weight:700;':'color:var(--red);font-weight:700;') : '';
      else if (c.key==='OFF'||c.key==='DEF') mainStyle = 'font-weight:700;';
      return `<td style="padding:4px 6px;text-align:right;vertical-align:top;">
        <div style="font-size:11px;${mainStyle}">${fmtStat(c.key,val)}</div>
        ${c.key!=='POSS'?deltaCell(c.key,val):''}
      </td>`;
    }).join('');

    return `<tr style="border-bottom:1px solid var(--border);${bg}">
      <td style="padding:8px 6px;">
        <div style="display:flex;gap:6px;align-items:flex-end;">${photos}</div>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="font-size:9px;color:var(--muted);margin-bottom:6px;">Lineup combo weighted avg · Δ vs. league avg</div>
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;width:100%;">
        <thead><tr>
          <th style="border-bottom:2px solid #000;padding:4px 6px;text-align:left;font-size:9px;color:var(--muted);">LINEUP</th>
          ${colHdrs}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function renderWowyInit() {
  try {
    const [d, ld] = await Promise.all([
      loadMexData(),
      fetch(LINEUP_DATA_PATH() + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    window._wowyLineupData = ld;

    const sel = document.getElementById('wowyPlayerSelect');
    if (sel.options.length === 1) {
      // Use players from mex_data (full names) with abbrev lookup from playerXref
      const xref = ld?.playerXref || {};
      // Build abbrev -> full name map from xref
      const abbrevToFull = Object.fromEntries(
        Object.entries(xref).filter(([,v]) => v).map(([abbrev, info]) => [abbrev, info.name || abbrev])
      );
      // Fall back: collect all abbrevs from duo GROUP_NAME if not in xref
      const abbrevs = new Set(Object.keys(abbrevToFull));
      (ld?.duos || []).forEach(c => {
        (c.GROUP_NAME || '').split(' - ').forEach(n => { if(n.trim()) abbrevs.add(n.trim()); });
      });
      [...abbrevs].sort((a, b) => {
        const na = abbrevToFull[a] || a;
        const nb = abbrevToFull[b] || b;
        return na.localeCompare(nb);
      }).forEach(abbrev => {
        const opt = document.createElement('option');
        opt.value = abbrev;
        opt.textContent = abbrevToFull[abbrev] || abbrev;
        sel.appendChild(opt);
      });
    }
    document.getElementById('wowyContent').innerHTML =
      '<div style="color:var(--muted);font-size:12px;">Select a player above.</div>';
  } catch(e) {
    document.getElementById('wowyContent').innerHTML =
      `<div style="color:var(--red);font-size:12px;">Could not load WOWY data: ${esc(e.message)}</div>`;
  }
}

async function renderWowy(abbrev) {
  if (!abbrev) abbrev = document.getElementById('wowyPlayerSelect')?.value || '';
  const container = document.getElementById('wowyContent');
  if (!abbrev) { container.innerHTML = '<div style="color:var(--muted);font-size:12px;">Select a player above.</div>'; return; }

  const ld = window._wowyLineupData;
  if (!ld) { container.innerHTML = '<div style="color:var(--muted);font-size:12px;">Loading…</div>'; return; }

  const xref = ld.playerXref || {};
  const playerInfo = xref[abbrev] || {};
  const playerName = playerInfo.name || abbrev;
  const photoUrl = playerInfo.photoUrl || null;

  const d = await loadMexData();

  // Use the pre-computed wowy array from mex_data (built by fetch script)
  const wowyEntry = (d.wowy || []).find(p =>
    p.abbrev === abbrev || p.player === abbrev || p.player === playerName
  );

  const STATS = [
    { key: 'OffRtg',  label: 'OFF',      pct: false, lowerBetter: false },
    { key: 'DefRtg',  label: 'DEF',      pct: false, lowerBetter: true  },
    { key: 'NetRtg',  label: 'NET',      pct: false, lowerBetter: false },
    { key: 'eFG%',    label: 'eFG%',     pct: true,  lowerBetter: false },
    { key: 'TOV%',    label: 'TOV%',     pct: true,  lowerBetter: true  },
    { key: 'OREB%',   label: 'OREB%',    pct: true,  lowerBetter: false },
    { key: 'OppeFG%', label: 'Opp eFG%', pct: true,  lowerBetter: true  },
  ];

  // League averages from team_stats.json all slice
  const leagueAvgMap = { OffRtg:'OFF_RATING', DefRtg:'DEF_RATING', NetRtg:'NET_RATING',
                         'eFG%':'EFG_PCT', 'TOV%':'TM_TOV_PCT', 'OREB%':'OREB_PCT', 'OppeFG%':'OPP_EFG_PCT' };
  const leagueAvgs = {};
  if (cachedTeamStats?.slices?.all) {
    const teams = cachedTeamStats.slices.all;
    STATS.forEach(s => {
      const apiKey = leagueAvgMap[s.key];
      if (!apiKey) return;
      const vals = teams.map(t => t[apiKey]).filter(v => v != null);
      if (vals.length) leagueAvgs[s.key] = vals.reduce((a,b) => a+b, 0) / vals.length * (s.pct ? 100 : 1);
    });
  }

  let onRow  = wowyEntry ? { ...wowyEntry.with,    MIN: wowyEntry.with?.POSS,    _isPoss: true } : null;
  let offRow = wowyEntry ? { ...wowyEntry.without,  MIN: wowyEntry.without?.POSS, _isPoss: true } : null;
  const dataSource = wowyEntry
    ? (wowyEntry.rating_source === '5man' ? '5-man lineup data (exact)' : 'duo lineup weighted avg')
    : null;

  if (!onRow || !offRow) {
    container.innerHTML = `<div style="color:var(--muted);font-size:12px;">
      No WOWY data for ${esc(playerName)}. Re-run fetch_lineup_data.py to update mex_data.json.
    </div>`;
    return;
  }

  function fmt(key, val, pct) {
    if (val == null) return '—';
    return pct ? (val * 100).toFixed(1) + '%' : val.toFixed(1);
  }

  function delta(key, val, pct, lb) {
    const avg = leagueAvgs[key];
    if (val == null || avg == null) return '';
    // val is raw (0-1 for pct), avg is already scaled (* 100 in leagueAvgs)
    const scaledVal = pct ? val * 100 : val;
    const diff = scaledVal - avg;
    const better = lb ? diff < 0 : diff > 0;
    const sign = diff >= 0 ? '+' : '';
    const dispDiff = diff.toFixed(1) + (pct ? '%' : '');
    return `<div style="font-size:9px;color:${better?'#E6A817':'#888'};margin-top:1px;">${sign}${dispDiff}</div>`;
  }

  function photoHtml(active) {
    const img = photoUrl
      ? `<img src="${esc(photoUrl)}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;object-position:top;${active?'':'filter:grayscale(1);opacity:0.5;'}">`
      : `<div style="width:48px;height:48px;border-radius:50%;background:#ddd;display:flex;align-items:center;justify-content:center;font-size:10px;color:#888;">${active?'ON':'OFF'}</div>`;
    return `<div style="text-align:center;margin-right:10px;">
      <div style="position:relative;display:inline-block;">
        ${img}
        ${active ? '' : '<div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;">OFF</div>'}
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px;">${esc(playerName.split(' ').pop())}</div>
    </div>`;
  }

  function buildRow(row, active) {
    const vol = row.MIN != null ? Number(row.MIN).toFixed(0) : '—';
    const volLabel = row._isPoss ? 'poss' : 'min';
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px 4px 8px 0;">${photoHtml(active)}</td>
      <td style="padding:4px 8px;text-align:right;font-size:11px;">
        <div style="font-weight:700;">${vol}</div>
        <div style="font-size:9px;color:var(--muted);">${volLabel}</div>
      </td>
      ${STATS.map(s => {
        const val = row[s.key];
        const netC = s.key === 'NetRtg' ? (val >= 0 ? 'color:var(--green);' : 'color:var(--red);') : '';
        const dispVal = val == null ? '—' : (s.pct ? (val * 100).toFixed(1) + '%' : val.toFixed(1));
        return `<td style="padding:4px 8px;text-align:right;">
          <div style="font-size:12px;font-weight:600;${netC}">${dispVal}</div>
          ${delta(s.key, val, s.pct, s.lowerBetter)}
        </td>`;
      }).join('')}
    </tr>`;
  }

  function buildDiffRow() {
    return `<tr style="border-top:2px solid #000;">
      <td style="padding:6px 4px;font-size:11px;font-weight:700;color:var(--muted);">ON - OFF</td>
      <td></td>
      ${STATS.map(s => {
        const on  = onRow[s.key];
        const off = offRow[s.key];
        if (on == null || off == null) return `<td style="text-align:right;font-size:11px;">—</td>`;
        const diff = on - off;
        const better = s.lowerBetter ? diff < 0 : diff > 0;
        const sign = diff >= 0 ? '+' : '';
        const disp = s.pct ? (diff * 100).toFixed(1) + '%' : diff.toFixed(1);
        return `<td style="text-align:right;padding:4px 8px;">
          <span style="font-size:12px;font-weight:700;color:${better?'#E6A817':'#888'};">${sign}${disp}</span>
        </td>`;
      }).join('')}
    </tr>`;
  }

  const colHeaders = `<tr style="border-bottom:1px solid var(--border);">
    <th style="text-align:left;font-size:10px;color:var(--muted);padding:4px 4px 6px;">LINEUP</th>
    <th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px 6px;">POSS</th>
    ${STATS.map(s => `<th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px 6px;white-space:nowrap;">${s.label}</th>`).join('')}
  </tr>`;

  container.innerHTML = `
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px;">
      Source: ${esc(dataSource)} · subscripts vs. league average
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>${colHeaders}</thead>
        <tbody>
          ${buildRow(onRow,  true)}
          ${buildRow(offRow, false)}
          ${buildDiffRow()}
        </tbody>
      </table>
    </div>`;
}

function buildWowyMiniTable(rows) {
  if (!rows.length) return '<div style="color:var(--muted);font-size:11px;">No combinations.</div>';
  const cols = ['lineup','POSS','NetRtg','OffRtg','DefRtg','TS%','TOV%','OREB%'];
  return `<table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead><tr>${cols.map(c=>`<th style="background:var(--surface);padding:3px 8px;border-bottom:1px solid var(--border);text-align:${c==='lineup'?'left':'right'};color:var(--muted);">${c}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${cols.map(c=>{
      const v=r[c];
      const disp = v==null?'—':typeof v==='number'?v.toFixed(1):v;
      const color = c==='NetRtg'?(Number(v)>=0?'var(--green)':'var(--red)'):'';
      return `<td style="padding:2px 8px;border-bottom:1px solid var(--border);text-align:${c==='lineup'?'left':'right'};${color?'color:'+color+';font-weight:700;':''}">${disp}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

function renderLabContent(data, minMins) {
  window._lastLabData = data;
  const inner = document.getElementById('lineupLabInner');
  // Render full sortable tables for each group size with the given min-minutes filter
  const tiers = [
    { key: 'duos',    n: 2, label: 'Duos' },
    { key: 'trios',   n: 3, label: 'Trios' },
    { key: 'quads',   n: 4, label: 'Quads' },
    { key: 'fiveman', n: 5, label: '5-Man Units' },
  ];
  inner.innerHTML = tiers.map(t => {
    const rows = (data[t.key] || []).filter(c => getPoss(c) >= minMins).sort((a, b) => b.NET_RATING - a.NET_RATING);
    if (!rows.length) return `<div style="margin-bottom:14px;"><div style="font-weight:700;margin-bottom:4px;">${t.label}</div><div style="color:var(--muted);font-size:11px;">No combinations meet the minutes threshold.</div></div>`;
    return `<div style="margin-bottom:18px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;">${t.label} (${rows.length} combinations, ${minMins}+ min)</div>
      <div style="overflow-x:auto;">${buildFullTable(rows, 0)}</div>
    </div>`;
  }).join('');
}

let MIN_MINUTES = 25; // user-controlled via slider, shared across all tiers

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

function fmt(v, dp=1) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + Number(v).toFixed(dp);
}

// Person silhouette SVG (fallback when no photo)
function personSvg(size=22) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#111">
    <circle cx="12" cy="7.5" r="4.5"/>
    <path d="M3.5 21c0-4.7 3.8-8.5 8.5-8.5s8.5 3.8 8.5 8.5"/>
  </svg>`;
}

// Photo or silhouette for a single player, optionally linked to their profile
function playerIcon(abbrevName, size=22, linkToProfile=false) {
  const photo = photoForLineupName(abbrevName);
  const id = idForLineupName(abbrevName);
  const imgHtml = photo
    ? `<img src="${esc(photo)}" alt="${esc(abbrevName)}"
        style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;object-position:top;"
        onerror="this.style.display='none'">`
    : personSvg(size);
  if (linkToProfile && id) {
    return `<a href="player.html?id=${esc(id)}" title="${esc(abbrevName)}" onclick="event.stopPropagation()">${imgHtml}</a>`;
  }
  return imgHtml;
}

// Group icons using real player names from the combo, each linking to their profile
function groupIcons(names, size=22) {
  if (!names || !names.length) {
    return `<div class="lc-icons">${Array(2).fill(personSvg(size)).join('')}</div>`;
  }
  return `<div class="lc-icons">${names.map(n => playerIcon(n, size, true)).join('')}</div>`;
}

function rotationPersonSvg(size=28) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#111">
    <circle cx="12" cy="7.5" r="4.5"/>
    <path d="M3.5 21c0-4.7 3.8-8.5 8.5-8.5s8.5 3.8 8.5 8.5"/>
  </svg>`;
}

function buildRotationPlayer(name, mins) {
  const icon = name && name !== '—'
    ? playerIcon(name, 32)
    : rotationPersonSvg(32);
  return `<div class="rot-player">
    ${icon}
    <span class="rot-player-mins">${mins}</span>
    <span class="rot-player-name">${esc(name)}</span>
  </div>`;
}

function buildLineupCard(combo, n) {
  const names = combo.GROUP_NAME.split(' - ').map(p => p.trim());
  const net = combo.NET_RATING;
  const mins = Math.round(getPoss(combo));
  const iconSize = n <= 2 ? 26 : n === 3 ? 22 : n === 4 ? 19 : 16;
  return `<div class="lineup-card" onclick="openLineupLab(${esc(JSON.stringify(combo))})" style="cursor:pointer;">
    ${groupIcons(names, iconSize)}
    <span class="lc-net ${net >= 0 ? 'pos' : 'neg'}">${fmt(net)} net rtg,<br>${mins} poss</span>
    <span class="lc-names">${names.map(esc).join('<br>')}</span>
  </div>`;
}

function buildTier(tierName, bestCombos, worstCombos, n, allCombos, minMins, tierId) {
  const n_cards = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lineup-cards-per-row')) || 5;
  const bestCards = bestCombos.slice(0, n_cards).map(c => buildLineupCard(c, n)).join('');
  const worstCards = worstCombos.slice(0, n_cards).map(c => buildLineupCard(c, n)).join('');
  const tableHtml = buildFullTable(allCombos, minMins);
  return `<div class="lineup-tier">
    <div class="lineup-tier-cols">
      <div class="lineup-half">
        <div class="lineup-half-title best">${esc('best ' + tierName)}</div>
        <div class="lineup-cards-row">${bestCards}</div>
      </div>
      <div class="lineup-half">
        <div class="lineup-half-title worst">${esc('worst ' + tierName)}</div>
        <div class="lineup-cards-row">${worstCards}</div>
        <div class="see-all-row" onclick="toggleTable('${tierId}')">See All ${esc(tierName.charAt(0).toUpperCase() + tierName.slice(1))}...</div>
      </div>
    </div>
    <div class="full-table-wrap" id="${tierId}">${tableHtml}</div>
  </div>`;
}

function buildFullTable(combos, minMins) {
  const rows = combos.filter(c => getPoss(c) >= minMins).sort((a, b) => b.NET_RATING - a.NET_RATING);
  if (!rows.length) return '<div style="color:var(--muted);padding:6px;font-size:11px;">No combinations meet the minutes threshold.</div>';
  return `<table>
    <thead><tr><th>Lineup</th><th>Poss</th><th>GP</th><th>Net</th><th>OFF</th><th>DEF</th><th>EFG%</th><th>TOV%</th></tr></thead>
    <tbody>${rows.map(c => `<tr>
      <td>${esc(c.GROUP_NAME)}</td>
      <td>${Math.round(getPoss(c))}</td>
      <td>${c.GP}</td>
      <td style="color:${c.NET_RATING >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:700;">${fmt(c.NET_RATING)}</td>
      <td>${(c.OFF_RATING||0).toFixed(1)}</td>
      <td>${(c.DEF_RATING||0).toFixed(1)}</td>
      <td>${((c.EFG_PCT||0)*100).toFixed(1)}</td>
      <td>${((c.TM_TOV_PCT||0)*100).toFixed(1)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function toggleTable(id) {
  document.getElementById(id).classList.toggle('open');
}

function openLineupLab(combo) {
  const modal = document.getElementById('lineupLabModal');
  const inner = document.getElementById('lineupLabInner');
  const players = combo.GROUP_NAME.split(' - ');
  inner.innerHTML = `
    <div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text);">${esc(combo.GROUP_NAME)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:12px;">
      ${[
        ['Net Rating', fmt(combo.NET_RATING)],
        ['Off Rating', (combo.OFF_RATING||0).toFixed(1)],
        ['Def Rating', (combo.DEF_RATING||0).toFixed(1)],
        ['Minutes', Math.round(combo.MIN)],
        ['GP', combo.GP],
        ['W-L', `${combo.W}-${combo.L}`],
        ['EFG%', ((combo.EFG_PCT||0)*100).toFixed(1)],
        ['TOV%', ((combo.TM_TOV_PCT||0)*100).toFixed(1)],
        ['OREB%', ((combo.OREB_PCT||0)*100).toFixed(1)],
        ['DREB%', ((combo.DREB_PCT||0)*100).toFixed(1)],
        ['AST/TO', (combo.AST_TO||0).toFixed(2)],
        ['PIE', (combo.PIE||0).toFixed(3)],
      ].map(([label, val]) => `<div style="background:var(--bg);padding:8px;border:1px solid var(--border);">
        <span style="color:var(--muted);font-size:10px;display:block;">${label}</span>
        <span style="font-weight:700;font-size:16px;color:var(--text);">${val}</span>
      </div>`).join('')}
    </div>`;
  modal.style.display = 'flex';
}

function renderLineupContent(data) {
  window._lastLineupData = data;
  const container = document.getElementById('lineupContent');
  const thresholds = data._thresholds || {};

  function getBestWorst(arr, key) {
    const minMins = thresholds[key] || 0;
    const q = arr.filter(c => getPoss(c) >= minMins);
    return {
      best: [...q].sort((a, b) => b.NET_RATING - a.NET_RATING),
      worst: [...q].sort((a, b) => a.NET_RATING - b.NET_RATING),
    };
  }

  const duos  = getBestWorst(data.duos    || [], 'duos');
  const trios = getBestWorst(data.trios   || [], 'trios');
  const quads = getBestWorst(data.quads   || [], 'quads');
  const five  = getBestWorst(data.fiveman || [], 'fiveman');

  const fetchedAt = data.meta?.fetched_at
    ? new Date(data.meta.fetched_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
    : '';

  const tDuo   = thresholds.duos    || 0;
  const tTrio  = thresholds.trios   || 0;
  const tQuad  = thresholds.quads   || 0;
  const tFive  = thresholds.fiveman || 0;

  let html = fetchedAt ? `<div style="font-size:10px;color:var(--muted);margin-bottom:8px;">Full 2025-26 season · updated ${fetchedAt}</div>` : '';
  html += buildTier('duos',  duos.best,  duos.worst,  2, data.duos  ||[], tDuo,  'tbl-duo');
  html += buildTier('trios', trios.best, trios.worst, 3, data.trios ||[], tTrio, 'tbl-trio');
  if ((data.quads||[]).length) {
    html += buildTier('quads', quads.best, quads.worst, 4, data.quads||[], tQuad, 'tbl-quad');
  } else {
    html += `<div class="lineup-tier"><div class="lineup-half-title best">best quads</div>
      <div style="font-size:11px;color:var(--muted);padding:6px 0;">Re-run fetch_lineup_data.py to add 4-man lineup data</div></div>`;
  }
  // 5-man units available in Lineup Lab only

  container.innerHTML = html;
}



async function loadStaffNotes() {
  const feed = document.getElementById('staffFeed');
  try {
    const resp = await fetch(STAFF_PATH + '?v=' + Date.now());
    if (!resp.ok) throw new Error();
    const notes = await resp.json();
    const list = Array.isArray(notes) ? notes : (notes.comments || []);
    if (!list.length) { feed.innerHTML = '<div style="color:var(--muted);">No recent notes.</div>'; return; }
    feed.innerHTML = list.slice(0,12).map(n => {
      const full = n.body || '';
      const excerpt = full.slice(0, 110) + (full.length > 110 ? '…' : '');
      const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US',{month:'numeric',day:'numeric'}) : '';
      const meta = `<span class="staff-feed-meta"> ${esc(n.author||'')}${date?' · '+date:''}</span>`;
      return `<div class="staff-feed-row" onclick="this.classList.toggle('expanded')">
        <span class="staff-feed-excerpt">${esc(excerpt)}${meta}</span>
        <span class="staff-feed-full">${esc(full)}${meta}</span>
      </div>`;
    }).join('');
  } catch(e) {
    feed.innerHTML = '<div style="color:var(--muted);">No staff notes loaded.</div>';
  }
}

// Rotation placeholder — 10 silhouettes with XX Minutes
async function buildRotationPlaceholders() {
  const r1 = document.getElementById('rotationRow1');
  const r2 = document.getElementById('rotationRow2');
  if (!r1 || !r2) return;

  // Load real rotation from mex_data players sorted by minutes
  // Cross-reference with players_index for photos
  try {
    const [d, idx] = await Promise.all([
      loadMexData(),
      loadBap().catch(() => []),
    ]);

    const players = (d.players || [])
      .filter(p => (p.MIN || 0) > 0)
      .sort((a, b) => (b.MIN || 0) - (a.MIN || 0))
      .slice(0, 10);

    // Build name->photoUrl map from players_index
    const photoMap = {};
    (idx || []).forEach(p => {
      if (p.name && p.photoUrl) photoMap[p.name.toLowerCase()] = p.photoUrl;
    });
    // Also try nameLookup from mex_data
    const nameLookup = d.nameLookup || {};

    if (players.length > 0) {
      function rotCard(p) {
        const fullName = p.Player || p.PLAYER_NAME || '';
        // Try nameLookup for display name, then split
        const displayName = nameLookup[fullName] || fullName;
        const parts = displayName.split(' ');
        const shortName = parts.length > 1
          ? `${parts[0][0]}. ${parts[parts.length - 1]}`
          : (parts[0] || '');
        const mins = p.MIN != null ? Number(p.MIN).toFixed(0) + ' Min' : 'XX Min';
        const photoUrl = photoMap[fullName.toLowerCase()] || photoMap[displayName.toLowerCase()];
        const photo = photoUrl
          ? `<img src="${esc(photoUrl)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;object-position:top;display:block;margin:0 auto 1px;" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><svg width="36" height="36" viewBox="0 0 36 36" style="display:none;margin:0 auto 1px;"><circle cx="18" cy="13" r="8" fill="#999"/><ellipse cx="18" cy="32" rx="13" ry="9" fill="#999"/></svg>`
          : `<svg width="36" height="36" viewBox="0 0 36 36" style="display:block;margin:0 auto 1px;"><circle cx="18" cy="13" r="8" fill="#999"/><ellipse cx="18" cy="32" rx="13" ry="9" fill="#999"/></svg>`;
        return `<div class="rot-player">${photo}<span class="rot-player-mins">${mins}</span><span class="rot-player-name">${esc(shortName)}</span></div>`;
      }
      r1.innerHTML = players.slice(0, 5).map(rotCard).join('');
      r2.innerHTML = players.slice(5, 10).map(rotCard).join('');
      return;
    }
  } catch(e) {}

  // Fallback placeholders
  for (let i = 0; i < 5; i++) r1.innerHTML += buildRotationPlayer('—', 'XX Min');
  for (let i = 0; i < 5; i++) r2.innerHTML += buildRotationPlayer('—', 'XX Min');
}

let TEAM_STATS_PATH = () => dataPath('team_stats');
const FOCUS_ABBREV = 'MXC';
let cachedTeamStats = null; // the full slices file, loaded once

function renderTeamRanks(data) {
  const mxc = (data.teams || []).find(t => t.TEAM_ID === 1612709931 || t.TEAM_ABBREVIATION === FOCUS_ABBREV);
  if (!mxc) return;
  const total = data.teams.length;

  function set(rankId, valId, rankKey, valKey, fmt) {
    const r = document.getElementById(rankId);
    const v = document.getElementById(valId);
    if (r) r.textContent = mxc[rankKey] != null ? ordinal(mxc[rankKey]) : '—';
    if (v && mxc[valKey] != null) v.textContent = ` (${fmt ? fmt(mxc[valKey]) : mxc[valKey]})`;
  }
  const pct = v => (v * 100).toFixed(1) + '%';
  const dec = v => Number(v).toFixed(1);
  set('r-ortg', 'v-ortg', 'OFF_RATING_RANK', 'OFF_RATING', dec);
  set('r-netrtg', 'v-netrtg', 'NET_RATING_RANK', 'NET_RATING', dec);
  set('r-drtg', 'v-drtg', 'DEF_RATING_RANK', 'DEF_RATING', dec);
  set('r-efg', 'v-efg', 'EFG_PCT_RANK', 'EFG_PCT', pct);
  set('r-tov', 'v-tov', 'TM_TOV_PCT_RANK', 'TM_TOV_PCT', pct);
  set('r-defg', 'v-defg', 'OPP_EFG_PCT_RANK', 'OPP_EFG_PCT', pct);
  set('r-dtov', 'v-dtov', 'OPP_TOV_PCT_RANK', 'OPP_TOV_PCT', pct);
  set('r-oreb', 'v-oreb', 'OREB_PCT_RANK', 'OREB_PCT', pct);
  set('r-dreb', 'v-dreb', 'DREB_PCT_RANK', 'DREB_PCT', pct);

  // Color ranks: good=blue, bad=red (bottom half), neutral=black
  ['r-ortg','r-netrtg','r-efg','r-oreb','r-dtov'].forEach(id => {
    const el = document.getElementById(id);
    const rank = parseInt(el?.textContent);
    if (el && rank) el.style.color = rank <= total/2 ? 'var(--blue)' : 'var(--red)';
  });
  ['r-drtg','r-tov','r-defg'].forEach(id => {
    const el = document.getElementById(id);
    const rank = parseInt(el?.textContent);
    if (el && rank) el.style.color = rank <= total/2 ? 'var(--blue)' : 'var(--red)';
  });
  document.getElementById('r-dreb').style.color = '';
}

async function loadRanksByDate() {
  const dateFrom = document.getElementById('rankDateFrom').value;
  const dateTo   = document.getElementById('rankDateTo').value;
  if (!dateFrom || !dateTo) return;

  // Reset dropdown to avoid confusion about which filter is active
  document.getElementById('rankSliceSelect').value = '';

  const url = (
    `https://stats.nba.com/stats/leaguedashteamstats`
    + `?LeagueID=20&Season=${SEASON}&SeasonType=Regular+Season`
    + `&PerMode=PerGame&PaceAdjust=N&PlusMinus=N&Rank=N`
    + `&MeasureType=Advanced`
    + `&Outcome=&Location=&Month=0&SeasonSegment=`
    + `&DateFrom=${dateFrom}&DateTo=${dateTo}&OpponentTeamID=0`
    + `&VsConference=&VsDivision=&GameSegment=&Period=0`
    + `&ShotClockRange=&LastNGames=0`
  );

  try {
    const resp = await nbaFetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const rs = data.resultSets?.[0];
    if (!rs) throw new Error('No data');
    const hdrs = rs.headers;
    const teams = rs.rowSet.map(row => Object.fromEntries(hdrs.map((h, i) => [h, row[i]])));
    renderTeamRanks({ teams });
  } catch(e) {
    // CORS fallback: use cached data with a note
    const note = document.getElementById('r-netrtg');
    if (note) note.textContent = '—';
  }
}

async function loadRanks(slice) {
  slice = slice || 'all';
  try {
    if (!cachedTeamStats) {
      const resp = await fetch(TEAM_STATS_PATH() + '?v=' + Date.now());
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      cachedTeamStats = await resp.json();
    }
    const teams = cachedTeamStats.slices?.[slice];
    if (!teams) return; // slice not in file yet — silently leave dashes
    renderTeamRanks({ teams });
  } catch(e) {
    // silently leave ranks as dashes if file doesn't exist yet
  }
}

// Init season toggle
const seasonLabel = document.getElementById('seasonLabel');
if (seasonLabel) seasonLabel.textContent = SEASON;
const psTabEl = document.getElementById('pstab-inseason');
if (psTabEl) psTabEl.textContent = SEASON;
document.querySelectorAll('.season-btn').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.season === SEASON);
});

buildRotationPlaceholders();
loadStaffNotes();
renderTrajectory();

// Load playerXref from players_index.json
fetch('data/players_index.json?v=' + Date.now())
  .then(r => r.ok ? r.json() : [])
  .then(idx => {
    (idx || []).forEach(p => {
      const parts = (p.name || '').split(/\s+/);
      if (parts.length >= 2) {
        const key = `${parts[0][0]}. ${parts[parts.length - 1]}`;
        playerXref[key] = { id: p.id, name: p.name, photoUrl: p.photoUrl };
      }
    });
  }).catch(() => {});

// Main page reads from lineup_data.json (all 4 group sizes from fetch script)
// Falls back to mex_data.json duos if lineup_data.json not yet committed
fetch(LINEUP_DATA_PATH() + '?v=' + Date.now())
  .then(r => {
    if (!r.ok) throw new Error('lineup_data.json not found — run fetch_lineup_data.py and commit the output');
    return r.json();
  })
  .then(d => {
    const data = {
      duos:    d.duos    || [],
      trios:   d.trios   || [],
      quads:   d.quads   || [],
      fiveman: d.fiveman || [],
    };
    // Merge playerXref from lineup_data.json if present
    if (d.playerXref) playerXref = { ...playerXref, ...Object.fromEntries(
      Object.entries(d.playerXref).filter(([,v]) => v).map(([k,v]) => [k, v])
    )};
    data._thresholds = {
      duos:    dynamicFloor(data.duos,    2),
      trios:   dynamicFloor(data.trios,   3),
      quads:   dynamicFloor(data.quads,   4),
      fiveman: dynamicFloor(data.fiveman, 5),
    };
    window._lastLineupData = data;
    populateLineupPlayerFilters(data);
    document.getElementById('lineupFetchStatus').textContent =
      `${data.duos.length} duos · ${data.trios.length} trios · ${data.quads.length} quads`;
    renderLineupContent(data);
  })
  .catch(e => {
    // Fallback: use mex_data.json duos while lineup_data.json isn't committed yet
    loadMexData().then(d => {
      renderTeamProfile(d);
      const normalize = c => ({
        GROUP_NAME: c.lineup, NET_RATING: c.NetRtg, OFF_RATING: c.OffRtg,
        DEF_RATING: c.DefRtg, MIN: c.MIN, GP: null,
        EFG_PCT: c['eFG%'] != null ? c['eFG%'] / 100 : null,
        TM_TOV_PCT: c['TOV%'] != null ? c['TOV%'] / 100 : null,
      });
      const duos = d.lineups.map(normalize);
      const data = { duos, trios: [], quads: [], fiveman: [],
        _thresholds: { duos: dynamicFloor(duos, 2), trios: 0, quads: 0, fiveman: 0 } };
      document.getElementById('lineupFetchStatus').textContent =
        `${duos.length} duos · trios/quads/5-man: commit lineup_data.json`;
      renderLineupContent(data);
    }).catch(() => {
      document.getElementById('lineupContent').innerHTML =
        `<div style="color:var(--red);font-size:12px;">Could not load lineup data: ${esc(e.message)}</div>`;
    });
  });

// Wire all filter controls — slider is client-side only, rest trigger a refetch
const minMinsSlider = document.getElementById('minMinsSlider');
if (minMinsSlider) {
  minMinsSlider.addEventListener('input', function() {
    const lbl = document.getElementById('minMinsLabel');
    if (lbl) lbl.textContent = this.value;
    if (window._lastLineupData) renderLineupContent(window._lastLineupData, Number(this.value));
  });
}

// Lab filter controls — trigger a new fetch when any filter changes
document.querySelectorAll('.lab-filter').forEach(el => el.addEventListener('change', triggerLabFetch));
const labMinsSlider = document.getElementById('labMinsSlider');
if (labMinsSlider) {
  labMinsSlider.addEventListener('input', function() {
    const lbl = document.getElementById('labMinsLabel');
    if (lbl) lbl.textContent = this.value;
    if (window._lastLabData) renderLabContent(window._lastLabData, Number(this.value));
  });
}

function switchSeason(season) {
  if (season === SEASON) return;
  SEASON = season;
  localStorage.setItem('capitanes_season', season);
  // Clear all caches
  mexData = null;
  cachedTeamStats = null;
  window._wowyLineupData = null;
  window._labEverOpened = false;
  // Update active button state
  document.querySelectorAll('.season-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.season === season);
  });
  // Update season label and inseason tab
  const lbl = document.getElementById('seasonLabel');
  if (lbl) lbl.textContent = season;
  const psTabInseason = document.getElementById('pstab-inseason');
  if (psTabInseason) psTabInseason.textContent = season;
  // Re-render all sections
  loadStaffNotes();
  loadRanks('all');
  renderTrajectory();
  document.getElementById('lineupFetchStatus').textContent = 'Loading…';
  document.getElementById('lineupContent').innerHTML = '';
  // Re-fetch lineup data for new season
  fetch(LINEUP_DATA_PATH() + '?v=' + Date.now())
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(d => {
      const data = { duos: d.duos||[], trios: d.trios||[], quads: d.quads||[], fiveman: d.fiveman||[] };
      if (d.playerXref) playerXref = { ...playerXref, ...Object.fromEntries(
        Object.entries(d.playerXref).filter(([,v]) => v).map(([k,v]) => [k,v])
      )};
      data._thresholds = {
        duos: dynamicFloor(data.duos, 2), trios: dynamicFloor(data.trios, 3),
        quads: dynamicFloor(data.quads, 4), fiveman: dynamicFloor(data.fiveman, 5),
      };
      document.getElementById('lineupFetchStatus').textContent =
        `${data.duos.length} duos · ${data.trios.length} trios · ${data.quads.length} quads`;
      renderLineupContent(data);
    })
    .catch(e => {
      document.getElementById('lineupContent').innerHTML =
        `<div style="color:var(--red);font-size:12px;">No ${SEASON} lineup data yet — run fetch_lineup_data.py ${SEASON}</div>`;
      document.getElementById('lineupFetchStatus').textContent = '';
    });
}

function populateLineupPlayerFilters(data) {
  const players = new Set();
  (data.duos || []).forEach(c => {
    (c.GROUP_NAME || '').split(' - ').forEach(n => { if(n.trim()) players.add(n.trim()); });
  });
  ['lineupWithFilter','lineupWithoutFilter'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    [...players].sort().forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
}

function applyLineupFilters() {
  if (!window._lastLineupData) return;
  const withPlayer    = document.getElementById('lineupWithFilter')?.value    || '';
  const withoutPlayer = document.getElementById('lineupWithoutFilter')?.value || '';
  const floorMode     = document.getElementById('lineupFloorMode')?.value     || 'dynamic';

  function matchesFilters(combo) {
    const players = (combo.GROUP_NAME || '').split(' - ').map(n => n.trim());
    if (withPlayer    && !players.includes(withPlayer))    return false;
    if (withoutPlayer &&  players.includes(withoutPlayer)) return false;
    return true;
  }

  const base = window._lastLineupData;
  const filtered = {
    duos:    (base.duos    || []).filter(matchesFilters),
    trios:   (base.trios   || []).filter(matchesFilters),
    quads:   (base.quads   || []).filter(matchesFilters),
    fiveman: (base.fiveman || []).filter(matchesFilters),
  };

  // Compute thresholds for filtered data
  function getFloor(rows, groupSize) {
    if (floorMode === 'dynamic') return dynamicFloor(rows, groupSize);
    return Number(floorMode);
  }

  filtered._thresholds = {
    duos:    getFloor(filtered.duos,    2),
    trios:   getFloor(filtered.trios,   3),
    quads:   getFloor(filtered.quads,   4),
    fiveman: getFloor(filtered.fiveman, 5),
  };

  renderLineupContent(filtered);
}

// ── Best Available Players ────────────────────────────────────
let _bapData = null;
let _bapTab  = 'gleague'; // 'gleague' = Low-minute G League, 'lnbp' = LNBP Players

async function loadBap() {
  if (_bapData) return _bapData;
  const r = await fetch('data/players_index.json?v=' + Date.now());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  _bapData = await r.json();
  return _bapData;
}

function switchBapTab(tab, btn) {
  _bapTab = tab;
  document.querySelectorAll('.bap-btn').forEach(b => {
    b.style.color = b.dataset.tab === tab ? 'var(--blue)' : 'var(--text)';
    b.style.fontWeight = b.dataset.tab === tab ? '700' : '';
  });
  renderBap();
}

function bapNameHtml(p) {
  const name = esc(p.name || '');
  if (p.onRoster) return `<span style="background:var(--yellow);color:var(--blue);padding:0 2px;">${name}</span>`;
  if (p.trainingCampInvite) return `<span style="background:var(--blue);color:var(--yellow);padding:0 2px;">${name}</span>`;
  return name;
}

function bapRankRow(rank, p) {
  const teamTag = p._currentTeam
    ? ` <span style="font-size:9px;color:var(--muted);">(${esc(p._currentTeam)})</span>`
    : '';
  return `<a href="player.html?id=${esc(p.id)}" style="font-size:11px;line-height:1.4;display:block;color:inherit;text-decoration:none;">
    <span style="margin-right:3px;color:var(--muted);">${rank}.</span>${bapNameHtml(p)}${teamTag}
  </a>`;
}

function bapRenderBoard(title, list, href) {
  const rows = list.length
    ? list.map((p, i) => bapRankRow(i + 1, p)).join('')
    : `<div style="font-size:11px;color:var(--muted);">None yet.</div>`;
  return `<div>
    <div style="font-size:11px;font-weight:700;border-bottom:1px solid var(--border);padding-bottom:2px;margin-bottom:3px;">
      ${esc(title)}<a href="${esc(href)}" style="font-size:9px;font-weight:600;text-decoration:underline;margin-left:4px;color:inherit;">(Show All)</a>
    </div>
    <div style="max-height:var(--board-row-height);overflow-y:auto;">${rows}</div>
  </div>`;
}

async function renderBap() {
  const container = document.getElementById('bapBoards');
  if (!container) return;
  try {
    const all = await loadBap();

    // Load exact G League roster file (name -> team abbrev lookup)
    const rosterResp = await fetch(`data/gleague_roster_${SEASON}.json?v=` + Date.now());
    const rosterData = rosterResp.ok ? await rosterResp.json() : null;
    const nameToTeam = rosterData?.nameToTeam || {}; // lowercase name -> team abbrev

    // Load league lineup data for possession counts
    const llResp = await fetch(dataPath('lineup_league') + '?v=' + Date.now());
    const llData = llResp.ok ? await llResp.json() : null;

    // Compute total poss per player from league duos using exact name lookup
    // Build full-name -> poss map via playerXref in lineup_data
    const ldResp = await fetch(dataPath('lineup_data') + '?v=' + Date.now());
    const ldData = ldResp.ok ? await ldResp.json() : {};
    const xref = ldData.playerXref || {};

    // Map full name (lowercase) -> total poss across all duos
    const namePoss = {};
    if (llData) {
      (llData.duos || []).forEach(c => {
        const poss = c.POSS || 0;
        (c.GROUP_NAME || '').split(' - ').forEach(abbrev => {
          abbrev = abbrev.trim();
          const fullName = xref[abbrev]?.name || abbrev;
          namePoss[fullName.toLowerCase()] = (namePoss[fullName.toLowerCase()] || 0) + poss;
        });
      });
    }

    // 40th percentile poss threshold
    const allPoss = Object.values(namePoss).sort((a, b) => a - b);
    const p40 = allPoss[Math.floor(allPoss.length * 0.4)] || 0;

    // Tag each player in players_index with their current team if in roster
    const idToTeam = {};
    const idToPoss = {};
    all.forEach(p => {
      if (!p.name) return;
      const key = p.name.toLowerCase();
      if (nameToTeam[key]) {
        idToTeam[p.id] = nameToTeam[key];
        idToPoss[p.id] = namePoss[key] || 0;
      }
    });

    let pool;
    if (_bapTab === 'gleague') {
      // a) In current G League AND bottom 40th percentile poss
      // b) Unsigned (availabilitySimple !== 'no', not onRoster) with overallRank
      pool = all.filter(p => {
        if (!p.overallRank) return false;
        const inGLeagueBottomPoss = idToTeam[p.id] && (idToPoss[p.id] || 0) <= p40;
        const unsigned = p.availabilitySimple !== 'no' && !p.onRoster;
        return inGLeagueBottomPoss || unsigned;
      });
    } else if (_bapTab === 'lnbp') {
      // c) LNBP — currently signed in LNBP, pursuable
      pool = all.filter(p =>
        p.overallRank != null &&
        (p.availabilityNote || '').toUpperCase().includes('LNBP')
      );
    } else {
      // d) Unsigned — all ranked players not on a roster, not signed elsewhere
      pool = all.filter(p =>
        p.overallRank != null &&
        p.availabilitySimple !== 'no' &&
        !p.onRoster
      );
    }

    // Attach current team tag to each player
    pool = pool.map(p => ({ ...p, _currentTeam: idToTeam[p.id] || null }));

    const latino = pool.filter(p => p.latino === true).sort((a, b) => a.overallRank - b.overallRank);
    const byPos  = pos => pool.filter(p => p.position === pos && p.positionalRank != null)
                              .sort((a, b) => a.positionalRank - b.positionalRank);

    container.innerHTML = [
      bapRenderBoard('Latino Ranks:', latino,         'rankings.html?pos=overall&latino=yes'),
      bapRenderBoard('Guard Ranks:',  byPos('Guard'), 'rankings.html?pos=guard'),
      bapRenderBoard('Wing Ranks:',   byPos('Wing'),  'rankings.html?pos=wing'),
      bapRenderBoard('Big Ranks:',    byPos('Big'),   'rankings.html?pos=big'),
    ].join('');
  } catch(e) {
    container.innerHTML = `<div style="color:var(--muted);font-size:11px;">Could not load: ${esc(e.message)}</div>`;
  }
}

// ── In-Season Player Stats tabs ───────────────────────────────
let _psTab  = 'inseason';
let _psView = 'overall';

function switchPsTab(tab) {
  _psTab = tab;
  document.querySelectorAll('.pstab').forEach(b =>
    b.style.color = b.dataset.tab === tab ? 'var(--blue)' : 'var(--muted)'
  );
  renderPsTab();
}

function switchPsView(view) {
  _psView = view;
  document.querySelectorAll('.psview').forEach(b =>
    b.style.color = b.dataset.view === view ? 'var(--blue)' : 'var(--muted)'
  );
  renderPsTab();
}

async function renderPsTab() {
  const container = document.getElementById('psContent');
  if (!container) return;
  if (_psTab === 'inseason') {
    try {
      const d = await loadMexData();
      const players = (d.players || []).sort((a, b) => (b.MIN||0) - (a.MIN||0));
      const allCols = {
        overall: [['Player', p => p.Player || p.PLAYER_NAME],
                  ['MIN',    p => p.MIN?.toFixed(1)],
                  ['TS%',    p => p['TS%'] != null ? (p['TS%']*100).toFixed(1)+'%' : '—'],
                  ['eFG%',   p => p['eFG%'] != null ? (p['eFG%']*100).toFixed(1)+'%' : '—'],
                  ['ORtg',   p => p['ORtg']?.toFixed(1)],
                  ['DRtg',   p => p['DRtg']?.toFixed(1)],
                  ['USG%',   p => p['USG%'] != null ? (p['USG%']*100).toFixed(1)+'%' : '—'],
                  ['PIE',    p => p['PIE'] != null ? (p['PIE']*100).toFixed(1) : '—']],
        offense: [['Player', p => p.Player || p.PLAYER_NAME],
                  ['MIN',    p => p.MIN?.toFixed(1)],
                  ['TS%',    p => p['TS%'] != null ? (p['TS%']*100).toFixed(1)+'%' : '—'],
                  ['eFG%',   p => p['eFG%'] != null ? (p['eFG%']*100).toFixed(1)+'%' : '—'],
                  ['3P%',    p => p['3P%'] != null ? (p['3P%']*100).toFixed(1)+'%' : '—'],
                  ['FT%',    p => p['FT%'] != null ? (p['FT%']*100).toFixed(1)+'%' : '—'],
                  ['AST%',   p => p['AST%'] != null ? (p['AST%']*100).toFixed(1)+'%' : '—'],
                  ['TOV%',   p => p['TOV%'] != null ? p['TOV%'].toFixed(1)+'%' : '—'],
                  ['ORtg',   p => p['ORtg']?.toFixed(1)]],
        defense: [['Player', p => p.Player || p.PLAYER_NAME],
                  ['MIN',    p => p.MIN?.toFixed(1)],
                  ['DRB%',   p => p['DRB%'] != null ? (p['DRB%']*100).toFixed(1)+'%' : '—'],
                  ['STL/100', p => p['STL'] != null && p['POSS'] ? (p['STL'] / p['POSS'] * 100).toFixed(1) : '—'],
                  ['BLK/100', p => p['BLK'] != null && p['POSS'] ? (p['BLK'] / p['POSS'] * 100).toFixed(1) : '—'],
                  ['DRtg',   p => p['DRtg']?.toFixed(1)]],
      };
      const cols = allCols[_psView] || allCols.overall;
      container.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr>${cols.map(([h]) => `<th style="padding:2px 4px;text-align:${h==='Player'?'left':'right'};color:var(--muted);border-bottom:1px solid var(--border);">${h}</th>`).join('')}</tr></thead>
        <tbody>${players.filter(p => (p.MIN||0) > 0).map(p =>
          `<tr>${cols.map(([, fn]) => `<td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:${fn===cols[0][1]?'left':'right'};">${fn(p) ?? '—'}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table></div>`;
    } catch(e) {
      container.innerHTML = `<div style="color:var(--muted);font-size:11px;">No in-season stats yet.</div>`;
    }
  } else {
    // G League Career / All Pro Career / NCAA — from players_detail.json via players_index slug
    try {
      const [mexData, idxData, detailData] = await Promise.all([
        loadMexData(),
        loadBap(),
        fetch('data/players_detail.json?v=' + Date.now()).then(r => r.ok ? r.json() : []),
      ]);

      // Build name → slug map from players_index
      const nameToSlug = {};
      (idxData || []).forEach(p => {
        if (p.name && p.id) nameToSlug[p.name.toLowerCase()] = p.id;
      });

      // Build slug → detail map from players_detail
      const slugToDetail = {};
      (detailData || []).forEach(p => { if (p.id) slugToDetail[p.id] = p; });

      // Filter stints by tab
      const leagueFilter = {
        gleague: s => s.league === 'G League',
        pro:     s => s.league !== 'NCAA',
        ncaa:    s => s.league === 'NCAA',
      }[_psTab];

      // Build rows: one per player, aggregate relevant stints
      const roster = (mexData.players || []).sort((a, b) => (b.MIN||0) - (a.MIN||0));
      const cols = [
        ['Player',  p => p.name],
        ['League',  p => p.league],
        ['Season',  p => p.season || '—'],
        ['Pts/40',  p => p.pts40?.toFixed(1)   ?? '—'],
        ['Reb/40',  p => ((p.orb40||0) + (p.drb40||0)).toFixed(1)],
        ['Ast/40',  p => p.ast40?.toFixed(1)   ?? '—'],
        ['Stl/40',  p => p.stl40?.toFixed(1)   ?? '—'],
        ['Blk/40',  p => p.blk40?.toFixed(1)   ?? '—'],
        ['3P%',     p => p['3p_pct'] != null ? (p['3p_pct']*100).toFixed(1)+'%' : '—'],
        ['FT%',     p => p.ft_pct   != null ? (p.ft_pct*100).toFixed(1)+'%'    : '—'],
      ];

      // Collect all stint rows across roster
      const rows = [];
      roster.forEach(rp => {
        const name = rp.Player || rp.PLAYER_NAME || '';
        const slug = nameToSlug[name.toLowerCase()];
        const detail = slug ? slugToDetail[slug] : null;
        const stints = (detail?.proStints || []).filter(leagueFilter);
        stints.forEach(s => rows.push({ ...s, name }));
      });

      if (!rows.length) {
        container.innerHTML = `<div style="color:var(--muted);font-size:11px;">No ${_psTab === 'gleague' ? 'G League' : _psTab === 'pro' ? 'pro' : 'NCAA'} career data found.</div>`;
        return;
      }

      container.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:10px;">
        <thead><tr>${cols.map(([h]) => `<th style="padding:2px 4px;text-align:${h==='Player'||h==='League'?'left':'right'};color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap;">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row =>
          `<tr>${cols.map(([, fn], i) => `<td style="padding:2px 4px;border-bottom:1px solid var(--border);text-align:${i<=1?'left':'right'};white-space:nowrap;">${fn(row) ?? '—'}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table></div>`;
    } catch(e) {
      container.innerHTML = `<div style="color:var(--muted);font-size:11px;">Could not load career data: ${esc(e.message)}</div>`;
    }
  }
}

function openLineupLab() {
  document.getElementById('lineupLabModal').style.display = 'flex';
  if (!window._labEverOpened) {
    window._labEverOpened = true;
    fetchLabData();
  }
}

// Deferred startup calls that depend on functions declared later in the script
renderBap();
renderPsTab();
initWowySlots();

const EDITOR_DEFAULTS = {
  'staff-notes-width':   { val: 42,    unit: '%',  prop: '--staff-notes-width' },
  'rotation-width':      { val: 23.9,  unit: '%',  prop: '--rotation-width' },
  'season-splits-width': { val: 12.2,  unit: '%',  prop: '--season-splits-width' },
  'player-stats-width':  { val: 27.8,  unit: '%',  prop: '--player-stats-width' },
  'big-label-size':      { val: 40,    unit: 'px', prop: '--big-label-size' },
  'feed-max-height':     { val: 200,   unit: 'px', prop: '--feed-max-height' },
  'board-row-height':    { val: 160,   unit: 'px', prop: '--board-row-height' },
  'base-font':           { val: 14,    unit: 'px', prop: '--base-font' },
  'lineup-cards-per-row':{ val: 5,     unit: '',   prop: '--lineup-cards-per-row' },
};
const COLOR_VARS = {
  'blue':  '--blue',
  'green': '--green',
  'red':   '--red',
};

function loadEditorFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem('capitanesEditor') || '{}');
    Object.entries(EDITOR_DEFAULTS).forEach(([key, def]) => {
      const el = document.getElementById('ctrl-' + key);
      if (el && saved[key] != null) el.value = saved[key];
    });
    Object.keys(COLOR_VARS).forEach(key => {
      const el = document.getElementById('ctrl-' + key);
      if (el && saved['color-' + key]) el.value = saved['color-' + key];
    });
  } catch(e) {}
  applyEditor(false);
}

function applyEditor(save = true) {
  const root = document.documentElement;
  const values = {};

  Object.entries(EDITOR_DEFAULTS).forEach(([key, def]) => {
    const el = document.getElementById('ctrl-' + key);
    if (!el) return;
    const v = parseFloat(el.value);
    root.style.setProperty(def.prop, v + def.unit);
    document.getElementById('lbl-' + key).textContent = v + def.unit;
    values[key] = v;
  });

  // Apply big-label font size directly
  document.querySelectorAll('.big-label').forEach(el => {
    el.style.fontSize = values['big-label-size'] + 'px';
  });

  // Apply base font to body
  document.body.style.fontSize = values['base-font'] + 'px';

  // Apply board scroll height
  document.querySelectorAll('#bapBoards [style*="max-height"]').forEach(el => {
    el.style.maxHeight = values['board-row-height'] + 'px';
  });

  // Re-render lineup data if card count changed
  if (save && window._lastLineupData) {
    const prev = applyEditor._prevCardCount;
    if (prev !== undefined && prev !== values['lineup-cards-per-row']) {
      renderLineupContent(window._lastLineupData);
    }
    applyEditor._prevCardCount = values['lineup-cards-per-row'];
  }

  // Staff Notes section width
  const sn = document.getElementById('staffNotesSection');
  if (sn) {
    const w = values['staff-notes-width'] + '%';
    sn.style.width = w; sn.style.minWidth = w; sn.style.maxWidth = w;
  }

  Object.entries(COLOR_VARS).forEach(([key, prop]) => {
    const el = document.getElementById('ctrl-' + key);
    if (!el) return;
    root.style.setProperty(prop, el.value);
    values['color-' + key] = el.value;
  });

  if (save) {
    try { localStorage.setItem('capitanesEditor', JSON.stringify(values)); } catch(e) {}
  }
}

function resetEditor() {
  Object.entries(EDITOR_DEFAULTS).forEach(([key, def]) => {
    const el = document.getElementById('ctrl-' + key);
    if (el) el.value = def.val;
  });
  document.getElementById('ctrl-blue').value  = '#1631FF';
  document.getElementById('ctrl-green').value = '#18AF4A';
  document.getElementById('ctrl-red').value   = '#D81F2A';
  try { localStorage.removeItem('capitanesEditor'); } catch(e) {}
  applyEditor(false);
}

function toggleEditor() {
  const p = document.getElementById('editorPanel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

function exportEditorCSS() {
  const lines = Object.entries(EDITOR_DEFAULTS).map(([key, def]) => {
    const el = document.getElementById('ctrl-' + key);
    return `  ${def.prop}: ${el.value}${def.unit};`;
  });
  Object.entries(COLOR_VARS).forEach(([key, prop]) => {
    const el = document.getElementById('ctrl-' + key);
    lines.push(`  ${prop}: ${el.value};`);
  });
  const css = `:root {\n${lines.join('\n')}\n}`;
  navigator.clipboard.writeText(css).catch(() => {});
  const out = document.getElementById('exportOutput');
  out.style.display = 'block';
  out.textContent = css;
}

// Load saved values on startup
loadEditorFromStorage();