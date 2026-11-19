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
  if (!PROXY_BASE) return nbaUrl; // no proxy â€” will likely CORS-fail from browser
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

// 30th-percentile minutes threshold â€” computed from actual data so it
// adapts to however many combinations exist for each group size.
function getPoss(row) {
  return row.POSS ?? row.MIN_ACTUAL ?? row.MIN ?? 0;
}

// Dynamic floor: minimum possessions to show a lineup combination.
// Scales with season progress â€” early season a 10-poss duo is meaningful,
// late season the same combo is noise.
// groupSize: 2=duos, 3=trios, 4=quads, 5=fiveman
function dynamicFloor(rows, groupSize) {
  if (!rows.length) return 0;
  const totalPoss = rows.reduce((s, r) => s + getPoss(r), 0);
  // Minimum share of total group possessions to be considered meaningful.
  // Larger groups have fewer combinations and each one is rarer â€” lower threshold.
  const minShare = { 2: 0.015, 3: 0.008, 4: 0.004, 5: 0.002 }[groupSize] || 0.01;
  const absMin   = { 2: 8,     3: 5,     4: 3,     5: 2    }[groupSize] || 5;
  return Math.max(absMin, totalPoss * minShare);
}

function pct30Threshold(rows, groupSize) {
  // Legacy name kept for compatibility â€” now delegates to dynamicFloor
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
  // Main page â€” no filters, 30th percentile threshold
  const container = document.getElementById('lineupContent');
  const statusEl  = document.getElementById('lineupFetchStatus');

  if (currentFetch) currentFetch.abort();
  currentFetch = new AbortController();
  const signal = currentFetch.signal;

  container.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:8px 0;">Fetchingâ€¦</div>`;
  statusEl.textContent = 'Loadingâ€¦';

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
    statusEl.textContent = `${duos.length} duos Â· ${trios.length} trios Â· ${quads.length} quads`;
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

  statusEl.textContent = 'Loadingâ€¦';
  inner.innerHTML = '';

  const filters = { ...getLabFilters(), signal };

  try {
    const [duos, trios, quads, fiveman] = await Promise.all([
      fetchMXCLineups(2, filters),
      fetchMXCLineups(3, filters),
      fetchMXCLineups(4, filters),
      fetchMXCLineups(5, filters),
    ]);
    statusEl.textContent = `${duos.length} duos Â· ${trios.length} trios Â· ${quads.length} quads`;
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

// Data paths are season-aware â€” use dataPath() helper
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
    container.innerHTML = '<div style="font-size:11px;color:var(--muted);">No data â€” commit team_stats.json.</div>';
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
    if (val == null) return 'â€”';
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
    // Key columns to show â€” full set available but we pick the most meaningful
    const cols = ['Player','MIN','TS%','eFG%','3P%','FT%','ORB%','DRB%','AST%','TOV%','USG%','ORtg','DRtg','PIE'];
    // Fields stored 0-1 in API that need Ã—100 for display
    const pct01 = new Set(['TS%','eFG%','3P%','FT%','ORB%','DRB%','AST%','USG%','STL%','BLK%']);
    const getName = p => p['Player'] || p['PLAYER_NAME'] || 'â€”';
    const sorted = [...players].sort((a, b) => (b['MIN'] || 0) - (a['MIN'] || 0));

    function fmtStat(col, val) {
      if (val == null) return 'â€”';
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

// â”€â”€ Multi-player WOWY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _wowyPlayers = [];  // array of wowy entries loaded from mex_data

let _wowyPhotoMap = {};  // abbrev/name -> photoUrl

async function renderSeasonSplits() {
  const el = document.getElementById('seasonSplitsContainer');
  if (!el) return;
  try {
    if (!cachedTeamStats) {
      const r = await fetch(TEAM_STATS_PATH() + '?v=' + Date.now());
      if (r.ok) cachedTeamStats = await r.json();
    }
    const slices = cachedTeamStats?.slices || {};
    const MXC_TID = 1612709931;

    const getCell = (sliceKeys, statKey, isPct, isNet, lowerBetter) => {
      const keys = Array.isArray(sliceKeys) ? sliceKeys : [sliceKeys];
      let teams = null;
      for (const k of keys) {
        if (Array.isArray(slices[k]) && slices[k].length) { teams = slices[k]; break; }
      }
      if (!teams) return '—';
      const mxc = teams.find(t => Number(t.TEAM_ID) === MXC_TID || String(t.TEAM_ABBREVIATION || '').toUpperCase() === 'MXC');
      if (!mxc || mxc[statKey] == null || Number(mxc.GP || 0) === 0) return '—';
      const val = Number(mxc[statKey]);
      const valid = teams.filter(t => t[statKey] != null && Number(t.GP || 0) > 0).map(t => Number(t[statKey]));
      valid.sort((a, b) => lowerBetter ? (a - b) : (b - a));
      const rk = valid.findIndex(v => Math.abs(v - val) < 1e-6) + 1;
      const disp = isPct ? ((val * 100).toFixed(1) + '%') : val.toFixed(1);
      const col = isNet ? (val > 0 ? 'color:var(--green);' : (val < 0 ? 'color:var(--red);' : 'color:var(--text);')) : 'color:var(--text);';
      return '<span style="font-weight:700;' + col + '">' + disp + '</span>' + (rk > 0 ? '<sup style="font-size:6.8px;color:var(--muted);font-weight:400;">' + rk + '</sup>' : '');
    };

    const buildSection = (title, cols, rows, isLast) => {
      let html = '<div style="' + (isLast ? '' : 'margin-bottom:3px;padding-bottom:2px;border-bottom:1px solid var(--border);') + '">';
      if (title) html += '<div style="font-family:Oswald,sans-serif;font-size:8.5px;font-weight:700;color:var(--muted);letter-spacing:0.3px;margin-bottom:1px;">' + title + '</div>';
      html += '<table style="width:100%;border-collapse:collapse;table-layout:fixed;"><thead><tr><th style="width:25%;text-align:left;"></th>';
      cols.forEach(c => {
        const divL = c.sep ? 'border-left:1px solid var(--border);padding-left:2px;' : '';
        html += '<th style="text-align:right;font-family:Lora,serif;font-size:8px;font-weight:600;color:var(--muted);padding:0 1px 1px;white-space:nowrap;' + divL + '">' + c.lbl + '</th>';
      });
      html += '</tr></thead><tbody>';
      rows.forEach(r => {
        html += '<tr><td style="text-align:left;color:var(--muted);font-size:8.5px;padding:0;line-height:1.05;white-space:nowrap;">' + r.lbl + '</td>';
        cols.forEach(c => {
          const divL = c.sep ? 'border-left:1px solid var(--border);padding-left:2px;' : '';
          html += '<td style="text-align:right;font-size:9px;padding:0 1px;line-height:1.05;white-space:nowrap;' + divL + '">' + getCell(c.keys, r.key, r.pct, r.net, r.lb) + '</td>';
        });
        html += '</tr>';
      });
      return html + '</tbody></table></div>';
    };

    const r5 = [
      { lbl: 'NetRtg', key: 'NET_RATING', pct: false, net: true,  lb: false },
      { lbl: 'OffRtg', key: 'OFF_RATING', pct: false, net: false, lb: false },
      { lbl: 'DefRtg', key: 'DEF_RATING', pct: false, net: false, lb: true  },
      { lbl: 'eFG%',   key: 'EFG_PCT',    pct: true,  net: false, lb: false },
      { lbl: 'TOV%',   key: 'TM_TOV_PCT', pct: true,  net: false, lb: true  }
    ];
    el.innerHTML =
      buildSection('HOME/AWAY & HALF', [
        { lbl: 'Home', keys: ['home', 'Home'] },
        { lbl: 'Away', keys: ['away', 'road', 'Away', 'Road'] },
        { lbl: '1st H', keys: ['h1', 'half1', '1st_half', 'first_half'], sep: true },
        { lbl: '2nd H', keys: ['h2', 'half2', '2nd_half', 'second_half'] }
      ], r5, false) +
      buildSection('BY QUARTER', [
        { lbl: 'Q1', keys: ['q1', 'Q1', 'period_1'] },
        { lbl: 'Q2', keys: ['q2', 'Q2', 'period_2'] },
        { lbl: 'Q3', keys: ['q3', 'Q3', 'period_3'] },
        { lbl: 'Q4', keys: ['q4', 'Q4', 'period_4'] }
      ], r5.slice(0, 3), false) +
      buildSection('OPPONENT STRENGTH', [
        { lbl: 'vs Elite', keys: ['vs_elite', 'elite', 'top'] },
        { lbl: 'vs Mid', keys: ['vs_mid', 'mid', 'middle'] },
        { lbl: 'vs Weak', keys: ['vs_weak', 'weak', 'bottom'] }
      ], r5.concat([{ lbl: 'Opp eFG%', key: 'OPP_EFG_PCT', pct: true, net: false, lb: true }]), true);
  } catch (e) { el.textContent = 'Splits unavailable.'; }
}

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
        if (p.name) { _wowyPhotoMap[p.name.toLowerCase()] = p.photoUrl; _wowyPhotoMap[p.name.toLowerCase().replace(/[.,'â€™\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ')] = p.photoUrl; }
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
        <option value="">â€”</option>
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
  container.innerHTML = '<div style="color:var(--muted);font-size:11px;">Computingâ€¦</div>';

  function getPlayers(c) { return (c.GROUP_NAME||'').split(' - ').map(n=>n.trim()); }

  // Use 5-man for POSS (non-overlapping, accurate sample size)
  // Use duos for ratings (most complete coverage, consistent bias in differential)
  const fivemanCombos = ld?.fiveman || [];
  const ratingCombos  = [...(ld?.duos||[]), ...(ld?.trios||[]), ...(ld?.quads||[]), ...(ld?.fiveman||[])];

  // Available fields: E_OFF_RATING, E_DEF_RATING, E_NET_RATING (smoothed for small samples)
  // EFG_PCT, TM_TOV_PCT, OREB_PCT, DREB_PCT, TS_PCT
  // No OPP_ fields â€” Four Factors not fetched for lineups yet
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

  if (!window._scWowyCache) window._scWowyCache = {};
  if (!window._scWowyCache.hasOwnProperty(SEASON)) {
    const scResp = await fetch(`data/shot_charts_${SEASON}.json?v=` + Date.now()).catch(() => null);
    window._scWowyCache[SEASON] = (scResp && scResp.ok) ? await scResp.json() : null;
  }
  const scData = window._scWowyCache[SEASON];

  if (scData && Array.isArray(scData.poss) && Array.isArray(scData.shots)) {
    const normNm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,'â€™\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');
    const scPlayers = Array.isArray(scData.players) ? scData.players : Object.values(scData.players || {});

    const selItems = selected.map(selKey => {
      const entry = _wowyPlayers.find(p => p.abbrev === selKey || p.player === selKey);
      const fullName = entry?.player || selKey;
      const cleanFull = normNm(fullName);
      const fPts = cleanFull.split(' ');
      const match = scPlayers.find(sp => {
        const cSp = normNm(sp.name);
        if (cSp === cleanFull) return true;
        const sPts = cSp.split(' ');
        return fPts.length >= 2 && sPts.length >= 2 && fPts.at(0).at(0) === sPts.at(0).at(0) && fPts.at(-1) === sPts.at(-1);
      });
      const cleanLast = fullName.replace(/,\s*(jr|sr|ii|iii|iv|v)\.?$/i, '').split(/\s+/).filter(w => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w)).pop() || fullName;
      return { key: selKey, fullName, cleanLast, pid: match ? Number(match.id) : null };
    });

    if (selItems.every(x => x.pid != null)) {
      const calcState = (mask) => {
        const matchOn = (onArr) => {
          const setOn = new Set((onArr || []).map(Number));
          for (let i = 0; i < selItems.length; i++) {
            const wantOn = Boolean((mask >> i) & 1);
            if (setOn.has(selItems.at(i).pid) !== wantOn) return false;
          }
          return true;
        };

        const sideStats = (side) => {
          const pArr = scData.poss.filter(x => x.side === side && matchOn(x.on));
          const sArr = scData.shots.filter(x => x.side === side && matchOn(x.on));
          const tArr = (scData.turnovers || []).filter(x => x.side === side && matchOn(x.on));
          const fArr = (scData.fts || []).filter(x => x.side === side && matchOn(x.on));

          const nPoss = pArr.length;
          const shotPts = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 ? (Number(s.val) || 2) : 0), 0);
          const ftPts = fArr.reduce((acc, ft) => acc + (Number(ft.made) === 1 ? 1 : 0), 0);
          const rtg = nPoss ? ((shotPts + ftPts) / nPoss) * 100 : null;

          const fga = sArr.length;
          const fgm = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 ? 1 : 0), 0);
          const fg3m = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 && Number(s.val) === 3 ? 1 : 0), 0);
          const efg = fga ? ((fgm + 0.5 * fg3m) / fga) : null;
          const tovPct = nPoss ? (tArr.length / nPoss) : null;

          const missedFga = fga - fgm;
          const missedFinalFt = fArr.filter(ft => Number(ft.made) === 0 && /1 of 1|2 of 2|3 of 3/.test(String(ft.sub || ''))).length;
          const rebOpps = missedFga + missedFinalFt;
          const orebs = pArr.reduce((acc, p) => acc + (Number(p.oreb) || 0), 0);
          const orbPct = rebOpps ? (side === 'off' ? (orebs / rebOpps) : (1 - orebs / rebOpps)) : null;

          return { nPoss, rtg, efg, tovPct, orbPct };
        };

        const offS = sideStats('off');
        const defS = sideStats('def');
        const totPoss = Math.round((offS.nPoss + defS.nPoss) / 2);
        if (!totPoss) return null;
        return {
          POSS: totPoss, OffRtg: offS.rtg, DefRtg: defS.rtg,
          NetRtg: (offS.rtg != null && defS.rtg != null) ? (offS.rtg - defS.rtg) : null,
          OFF_EFG_PCT: offS.efg, OFF_TOV_PCT: offS.tovPct, OFF_ORB_PCT: offS.orbPct,
          DEF_EFG_PCT: defS.efg, DEF_TOV_PCT: defS.tovPct, DEF_ORB_PCT: defS.orbPct,
        };
      };
      const lgMap = {
        OffRtg: 'OFF_RATING', DefRtg: 'DEF_RATING', NetRtg: 'NET_RATING',
        OFF_EFG_PCT: 'EFG_PCT', OFF_TOV_PCT: 'TM_TOV_PCT', OFF_ORB_PCT: 'OREB_PCT',
        DEF_EFG_PCT: 'OPP_EFG_PCT', DEF_TOV_PCT: 'OPP_TOV_PCT', DEF_ORB_PCT: 'DREB_PCT'
      };
      const lgAvg = {};
      if (cachedTeamStats?.slices?.all) {
        const tms = cachedTeamStats.slices.all;
        Object.entries(lgMap).forEach(([k, ak]) => {
          const vals = tms.map(t => t[ak]).filter(v => v != null);
          if (vals.length) lgAvg[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
        });
      }

      const rowsData = new Array();
      const totalMasks = 1 << selItems.length;
      for (let m = totalMasks - 1; m >= 0; m--) {
        const st = calcState(m);
        if (st) rowsData.push({ mask: m, st });
      }

      const cols = [
        { k: 'OffRtg', pct: false, lb: false }, { k: 'DefRtg', pct: false, lb: true }, { k: 'NetRtg', pct: false, lb: false },
        { k: 'OFF_EFG_PCT', pct: true, lb: false }, { k: 'OFF_TOV_PCT', pct: true, lb: true }, { k: 'OFF_ORB_PCT', pct: true, lb: false },
        { k: 'DEF_EFG_PCT', pct: true, lb: true }, { k: 'DEF_TOV_PCT', pct: true, lb: false }, { k: 'DEF_ORB_PCT', pct: true, lb: false },
      ];

      const rowsHtml = new Array();
      rowsData.forEach(({ mask: m, st }) => {
        const icons = selItems.map((item, idx) => {
          const isOn = Boolean((m >> idx) & 1);
          const url = _wowyPhotoMap[item.key] || _wowyPhotoMap[item.fullName.toLowerCase()] || _wowyPhotoMap[normNm(item.fullName)];
          const imgTag = url
            ? `<img src="${esc(url)}" referrerpolicy="no-referrer" style="width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:top;border:2px solid ${isOn ? 'var(--blue)' : '#ccc'};${isOn ? '' : 'filter:grayscale(1);opacity:0.45;'}">`
            : `<div style="width:44px;height:44px;border-radius:50%;background:#ddd;border:2px solid ${isOn ? 'var(--blue)' : '#ccc'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#666;">${isOn ? 'ON' : 'OFF'}</div>`;
          return `<div style="text-align:center;margin-right:8px;">
            <div style="position:relative;display:inline-block;">${imgTag}${isOn ? '' : '<div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff;">OFF</div>'}</div>
            <div style="font-size:9.5px;color:var(--muted);margin-top:2px;">${esc(item.cleanLast)}</div>
          </div>`;
        }).join('');

        const valsHtml = cols.map(col => {
          const v = st[col.k];
          const disp = v == null ? 'â€”' : (col.pct ? (v * 100).toFixed(1) + '%' : v.toFixed(1));
          const nc = col.k === 'NetRtg' ? (v >= 0 ? 'color:var(--green);' : 'color:var(--red);') : '';
          let subHtml = '';
          if (v != null && lgAvg[col.k] != null && col.k !== 'NetRtg') {
            const diff = col.pct ? (v - lgAvg[col.k]) * 100 : (v - lgAvg[col.k]);
            const better = col.lb ? diff < 0 : diff > 0;
            subHtml = `<div style="font-size:9.5px;font-weight:600;color:${better ? 'var(--green)' : 'var(--red)'};margin-top:1px;">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}${col.pct ? '%' : ''}</div>`;
          }
          return `<td style="padding:7px 8px;text-align:right;vertical-align:middle;"><div style="font-size:12.5px;font-weight:700;${nc}">${disp}</div>${subHtml}</td>`;
        }).join('');

        rowsHtml.push(`<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;display:flex;align-items:center;">${icons}</td><td style="padding:7px 8px;text-align:right;font-weight:700;font-size:12px;vertical-align:middle;">${st.POSS.toLocaleString()}</td>${valsHtml}</tr>`);
      });

      // Dedicated bottom ON - OFF summary row (All-ON minus All-OFF)
      if (rowsData.length >= 2) {
        const onSt = rowsData.at(0).st;
        const offSt = rowsData.at(-1).st;
        const diffCells = cols.map(col => {
          const vOn = onSt[col.k];
          const vOff = offSt[col.k];
          if (vOn == null || vOff == null) return '<td style="padding:8px;text-align:right;">â€”</td>';
          const diff = col.pct ? (vOn - vOff) * 100 : (vOn - vOff);
          const better = col.lb ? diff < 0 : diff > 0;
          const colCss = better ? 'var(--green)' : 'var(--red)';
          return `<td style="padding:8px;text-align:right;font-size:12.5px;font-weight:700;color:${colCss};">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}${col.pct ? '%' : ''}</td>`;
        }).join('');

        rowsHtml.push(`<tr style="border-top:2px solid #000;background:rgba(0,0,0,0.025);">
          <td style="padding:8px 4px;font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.4px;">ON âˆ’ OFF</td>
          <td style="padding:8px;text-align:right;font-size:10px;color:var(--muted);">diff</td>
          ${diffCells}
        </tr>`);
      }

      container.innerHTML = `<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Shot-Chart Play-by-Play Splits Â· Subscript: Î” vs. league avg Â· Bottom row: ON âˆ’ OFF</div>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid #000;font-family:'Oswald',sans-serif;font-size:10.5px;color:var(--muted);">
            <th style="text-align:left;padding:4px;">LINEUP</th><th style="text-align:right;padding:4px 8px;">POSS</th>
            <th style="text-align:right;padding:4px 8px;">OFF</th><th style="text-align:right;padding:4px 8px;">DEF</th><th style="text-align:right;padding:4px 8px;">NET</th>
            <th style="text-align:right;padding:4px 8px;">OFF eFG%</th><th style="text-align:right;padding:4px 8px;">OFF TOV%</th><th style="text-align:right;padding:4px 8px;">OFF ORB%</th>
            <th style="text-align:right;padding:4px 8px;">DEF eFG%</th><th style="text-align:right;padding:4px 8px;">DEF TOV%</th><th style="text-align:right;padding:4px 8px;">DEF ORB%</th>
          </tr></thead>
          <tbody>${rowsHtml.join('')}</tbody>
        </table></div>`;
      return;
    }
  }

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
    if (val==null) return 'â€”';
    if (key==='POSS') return Math.round(val).toLocaleString();
    return PCT.has(key) ? (val*100).toFixed(1) : val.toFixed(1);
  }
  function deltaCell(key, val) {
    const avg = leagueAvgs[key];
    if (val==null||avg==null) return '<div style="font-size:8px;color:#aaa;">â€”</div>';
    // Both val and avg are raw API decimals (e.g. 0.13 for 13%)
    // Scale both the same way before comparing
    const scale = PCT.has(key) ? 100 : 1;
    const diff = (val * scale) - (avg * scale);
    const better = LB.has(key) ? diff<0 : diff>0;
    const sign = diff>=0 ? '+' : '';
    return `<div style="font-size:8px;color:${better?'#E6A817':'#aaa'};">${sign}${diff.toFixed(1)}${PCT.has(key)?'%':''}</div>`;
  }

  // Player photo circle â€” large Databallr style with OFF overlay
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
    <div style="font-size:9px;color:var(--muted);margin-bottom:6px;">Lineup combo weighted avg Â· Î” vs. league avg</div>
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
  if (!ld) { container.innerHTML = '<div style="color:var(--muted);font-size:12px;">Loadingâ€¦</div>'; return; }

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
    if (val == null) return 'â€”';
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
      ? `<img src="${esc(photoUrl)}" referrerpolicy="no-referrer" style="width:48px;height:48px;border-radius:50%;object-fit:cover;object-position:top;${active?'':'filter:grayscale(1);opacity:0.5;'}">`
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
    const vol = row.MIN != null ? Number(row.MIN).toFixed(0) : 'â€”';
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
        const dispVal = val == null ? 'â€”' : (s.pct ? (val * 100).toFixed(1) + '%' : val.toFixed(1));
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
        if (on == null || off == null) return `<td style="text-align:right;font-size:11px;">â€”</td>`;
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
      Source: ${esc(dataSource)} Â· subscripts vs. league average
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
      const disp = v==null?'â€”':typeof v==='number'?v.toFixed(1):v;
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
  if (v == null) return 'â€”';
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
  const icon = name && name !== 'â€”'
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
    <span class="lc-net ${net >= 0 ? 'pos' : 'neg'}">${fmt(net)} net,<br>${mins} poss</span>
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

  let html = fetchedAt ? `<div style="font-size:10px;color:var(--muted);margin-bottom:8px;">Full 2025-26 season Â· updated ${fetchedAt}</div>` : '';
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



function toggleNoteForm() {
  const f = document.getElementById('noteForm');
  if (!f) return;
  const open = f.style.display === 'none' || !f.style.display;
  f.style.display = open ? 'block' : 'none';
  if (open) document.getElementById('noteText')?.focus();
}

function submitStaffNote() {
  const bodyEl = document.getElementById('noteText');
  const authEl = document.getElementById('noteAuthor');
  const plyEl  = document.getElementById('notePlayer');
  const body = (bodyEl?.value || '').trim();
  if (!body) return;
  const author = (authEl?.value || '').trim() || 'Staff';
  const playerName = (plyEl?.value || '').trim();
  const slug = playerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let local = new Array();
  try { local = JSON.parse(localStorage.getItem('capitanes_staff_notes') || '[]'); } catch (e) {}
  local.unshift({
    playerId: slug || '',
    playerName: playerName || '',
    playerUrl: slug ? ('player.html?id=' + slug) : '',
    author,
    body,
    createdAt: new Date().toISOString(),
    _local: true
  });
  try { localStorage.setItem('capitanes_staff_notes', JSON.stringify(local)); } catch (e) {}
  if (bodyEl) bodyEl.value = '';
  if (plyEl) plyEl.value = '';
  const f = document.getElementById('noteForm');
  if (f) f.style.display = 'none';
  loadStaffNotes();
}

async function loadStaffNotes() {
  const feed = document.getElementById('staffFeed');
  if (!feed) return;
  let base = new Array();
  let idx = new Array();
  try {
    const [resp, idxResp] = await Promise.all([
      fetch(STAFF_PATH + '?v=' + Date.now()),
      fetch('data/players_index.json?v=' + Date.now()).catch(() => null)
    ]);
    if (resp.ok) {
      const notes = await resp.json();
      base = Array.isArray(notes) ? notes : (notes.comments || new Array());
    }
    if (idxResp && idxResp.ok) {
      idx = await idxResp.json();
    }
  } catch (e) {}

  const idToName = {};
  const dl = document.getElementById('notePlayerList');
  if (dl && !dl.options.length && Array.isArray(idx)) {
    idx.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).forEach(p => {
      if (!p?.name) return;
      const opt = document.createElement('option');
      opt.value = p.name;
      dl.appendChild(opt);
    });
  }
  (Array.isArray(idx) ? idx : new Array()).forEach(p => {
    if (p?.id != null && p?.name) idToName[String(p.id).toLowerCase()] = p.name;
  });

  const resolvePlayer = (n) => {
    if (n.playerName) return n.playerName;
    const pid = String(n.playerId || '').trim();
    if (!pid) return '';
    if (idToName[pid.toLowerCase()]) return idToName[pid.toLowerCase()];
    return pid.split('-').map(w => w ? (w.charAt(0).toUpperCase() + w.slice(1)) : '').join(' ');
  };

  let local = new Array();
  try { local = JSON.parse(localStorage.getItem('capitanes_staff_notes') || '[]'); } catch (e) {}
  const list = new Array(...local, ...base);
  if (!list.length) {
    feed.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:4px 0;">No recent notes. Click + New Note to add one.</div>';
    return;
  }
  feed.innerHTML = list.slice(0, 19).map(n => {
    const pName = resolvePlayer(n);
    const pUrl = n.playerUrl || (n.playerId ? ('player.html?id=' + encodeURIComponent(n.playerId)) : '');
    const playerTag = pName
      ? (pUrl
          ? `<a href="${esc(pUrl)}" onclick="event.stopPropagation()" style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;color:var(--blue);text-decoration:none;margin-right:5px;">${esc(pName)}</a>`
          : `<span style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;color:var(--blue);margin-right:5px;">${esc(pName)}</span>`)
      : '';
    const full = n.body || '';
    const flat = full.replace(/\s+/g, ' ').trim();
    const excerpt = flat.slice(0, 115) + (flat.length > 115 ? '…' : '');
    const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '';
    const meta = `<span class="staff-feed-meta"> — ${esc(n.author || '')}${date ? ' · ' + date : ''}</span>`;
    return `<div class="staff-feed-row" onclick="this.classList.toggle('expanded')">
      <span class="staff-feed-excerpt">${playerTag}${esc(excerpt)}${meta}</span>
      <span class="staff-feed-full" style="white-space:pre-line;">${playerTag}${esc(full)}${meta}</span>
    </div>`;
  }).join('');
}

// Rotation placeholder â€” 10 silhouettes with XX Minutes
async function buildRotationPlaceholders() {
  const r1 = document.getElementById('rotationRow1');
  const r2 = document.getElementById('rotationRow2');
  if (!r1 || !r2) return;

  // Load real rotation from mex_data players sorted by minutes
  // Cross-reference with players_index for photos
  try {
    const [d, idx, ld] = await Promise.all([
      loadMexData(),
      loadBap().catch(() => []),
      (window._wowyLineupData
        ? Promise.resolve(window._wowyLineupData)
        : fetch(LINEUP_DATA_PATH() + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null)),
    ]);

    const players = (d.players || [])
      .filter(p => (p.MIN || 0) > 0)
      .sort((a, b) => (b.MIN || 0) - (a.MIN || 0))
      .slice(0, 10);

    const normKey = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[.,'â€™\-]/g, ' ')
      .split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');

    const photoMap = {};
    const registerPhoto = (nameStr, url) => {
      if (!nameStr || !url) return;
      const low = String(nameStr).trim().toLowerCase();
      const clean = normKey(nameStr);
      if (!photoMap[low]) photoMap[low] = url;
      if (clean && !photoMap[clean]) photoMap[clean] = url;
      const pts = clean.split(' ');
      if (pts.length >= 2) {
        const firstLast = `${pts.at(0)} ${pts.at(-1)}`;
        const initLast = `${pts.at(0).at(0)}. ${pts.at(-1)}`;
        if (!photoMap[firstLast]) photoMap[firstLast] = url;
        if (!photoMap[initLast]) photoMap[initLast] = url;
      }
    };

    // 1. Primary source: Lineup Data playerXref (exact same images as Lineup Data section)
    Object.entries(ld?.playerXref || {}).forEach(([abbrev, info]) => {
      if (info?.photoUrl) {
        registerPhoto(abbrev, info.photoUrl);
        if (info.name) registerPhoto(info.name, info.photoUrl);
      }
    });

    // 2. Fallback source: players_index
    (idx || []).forEach(p => {
      if (p.name && p.photoUrl) registerPhoto(p.name, p.photoUrl);
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
        const cleanDisp = normKey(displayName);
        const dPts = cleanDisp.split(' ');
        const flDisp = dPts.length >= 2 ? `${dPts.at(0)} ${dPts.at(-1)}` : cleanDisp;
        const photoUrl = photoMap[fullName.toLowerCase()]
          || photoMap[displayName.toLowerCase()]
          || photoMap[shortName.toLowerCase()]
          || photoMap[normKey(fullName)]
          || photoMap[cleanDisp]
          || photoMap[flDisp];
        const photo = photoUrl
          ? `<img src="${esc(photoUrl)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;object-position:top;display:block;margin:0 auto 1px;" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><svg width="36" height="36" viewBox="0 0 36 36" style="display:none;margin:0 auto 1px;"><circle cx="18" cy="13" r="8" fill="#999"/><ellipse cx="18" cy="32" rx="13" ry="9" fill="#999"/></svg>`
          : `<svg width="36" height="36" viewBox="0 0 36 36" style="display:block;margin:0 auto 1px;"><circle cx="18" cy="13" r="8" fill="#999"/><ellipse cx="18" cy="32" rx="13" ry="9" fill="#999"/></svg>`;
        return `<div class="rot-player">${photo}<span class="rot-player-mins">${mins}</span><span class="rot-player-name">${esc(shortName)}</span></div>`;
      }
      r1.innerHTML = players.slice(0, 4).map(rotCard).join('');
      r2.innerHTML = players.slice(5, 10).map(rotCard).join('');
      return;
    }
  } catch(e) {}

  // Fallback placeholders
  for (let i = 0; i < 5; i++) r1.innerHTML += buildRotationPlayer('â€”', 'XX Min');
  for (let i = 0; i < 5; i++) r2.innerHTML += buildRotationPlayer('â€”', 'XX Min');
}



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
        if (p.name) { _wowyPhotoMap[p.name.toLowerCase()] = p.photoUrl; _wowyPhotoMap[p.name.toLowerCase().replace(/[.,'â€™\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ')] = p.photoUrl; }
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
        <option value="">â€”</option>
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
  container.innerHTML = '<div style="color:var(--muted);font-size:11px;">Computingâ€¦</div>';

  function getPlayers(c) { return (c.GROUP_NAME||'').split(' - ').map(n=>n.trim()); }

  // Use 5-man for POSS (non-overlapping, accurate sample size)
  // Use duos for ratings (most complete coverage, consistent bias in differential)
  const fivemanCombos = ld?.fiveman || [];
  const ratingCombos  = [...(ld?.duos||[]), ...(ld?.trios||[]), ...(ld?.quads||[]), ...(ld?.fiveman||[])];

  // Available fields: E_OFF_RATING, E_DEF_RATING, E_NET_RATING (smoothed for small samples)
  // EFG_PCT, TM_TOV_PCT, OREB_PCT, DREB_PCT, TS_PCT
  // No OPP_ fields â€” Four Factors not fetched for lineups yet
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

  if (!window._scWowyCache) window._scWowyCache = {};
  if (!window._scWowyCache.hasOwnProperty(SEASON)) {
    const scResp = await fetch(`data/shot_charts_${SEASON}.json?v=` + Date.now()).catch(() => null);
    window._scWowyCache[SEASON] = (scResp && scResp.ok) ? await scResp.json() : null;
  }
  const scData = window._scWowyCache[SEASON];

  if (scData && Array.isArray(scData.poss) && Array.isArray(scData.shots)) {
    const normNm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,'â€™\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');
    const scPlayers = Array.isArray(scData.players) ? scData.players : Object.values(scData.players || {});

    const selItems = selected.map(selKey => {
      const entry = _wowyPlayers.find(p => p.abbrev === selKey || p.player === selKey);
      const fullName = entry?.player || selKey;
      const cleanFull = normNm(fullName);
      const fPts = cleanFull.split(' ');
      const match = scPlayers.find(sp => {
        const cSp = normNm(sp.name);
        if (cSp === cleanFull) return true;
        const sPts = cSp.split(' ');
        return fPts.length >= 2 && sPts.length >= 2 && fPts.at(0).at(0) === sPts.at(0).at(0) && fPts.at(-1) === sPts.at(-1);
      });
      const cleanLast = fullName.replace(/,\s*(jr|sr|ii|iii|iv|v)\.?$/i, '').split(/\s+/).filter(w => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w)).pop() || fullName;
      return { key: selKey, fullName, cleanLast, pid: match ? Number(match.id) : null };
    });

    if (selItems.every(x => x.pid != null)) {
      const calcState = (mask) => {
        const matchOn = (onArr) => {
          const setOn = new Set((onArr || []).map(Number));
          for (let i = 0; i < selItems.length; i++) {
            const wantOn = Boolean((mask >> i) & 1);
            if (setOn.has(selItems.at(i).pid) !== wantOn) return false;
          }
          return true;
        };

        const sideStats = (side) => {
          const pArr = scData.poss.filter(x => x.side === side && matchOn(x.on));
          const sArr = scData.shots.filter(x => x.side === side && matchOn(x.on));
          const tArr = (scData.turnovers || []).filter(x => x.side === side && matchOn(x.on));
          const fArr = (scData.fts || []).filter(x => x.side === side && matchOn(x.on));

          const nPoss = pArr.length;
          const shotPts = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 ? (Number(s.val) || 2) : 0), 0);
          const ftPts = fArr.reduce((acc, ft) => acc + (Number(ft.made) === 1 ? 1 : 0), 0);
          const rtg = nPoss ? ((shotPts + ftPts) / nPoss) * 100 : null;

          const fga = sArr.length;
          const fgm = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 ? 1 : 0), 0);
          const fg3m = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 && Number(s.val) === 3 ? 1 : 0), 0);
          const efg = fga ? ((fgm + 0.5 * fg3m) / fga) : null;
          const tovPct = nPoss ? (tArr.length / nPoss) : null;

          const missedFga = fga - fgm;
          const missedFinalFt = fArr.filter(ft => Number(ft.made) === 0 && /1 of 1|2 of 2|3 of 3/.test(String(ft.sub || ''))).length;
          const rebOpps = missedFga + missedFinalFt;
          const orebs = pArr.reduce((acc, p) => acc + (Number(p.oreb) || 0), 0);
          const orbPct = rebOpps ? (side === 'off' ? (orebs / rebOpps) : (1 - orebs / rebOpps)) : null;

          return { nPoss, rtg, efg, tovPct, orbPct };
        };

        const offS = sideStats('off');
        const defS = sideStats('def');
        const totPoss = Math.round((offS.nPoss + defS.nPoss) / 2);
        if (!totPoss) return null;
        return {
          POSS: totPoss, OffRtg: offS.rtg, DefRtg: defS.rtg,
          NetRtg: (offS.rtg != null && defS.rtg != null) ? (offS.rtg - defS.rtg) : null,
          OFF_EFG_PCT: offS.efg, OFF_TOV_PCT: offS.tovPct, OFF_ORB_PCT: offS.orbPct,
          DEF_EFG_PCT: defS.efg, DEF_TOV_PCT: defS.tovPct, DEF_ORB_PCT: defS.orbPct,
        };
      };
      const lgMap = {
        OffRtg: 'OFF_RATING', DefRtg: 'DEF_RATING', NetRtg: 'NET_RATING',
        OFF_EFG_PCT: 'EFG_PCT', OFF_TOV_PCT: 'TM_TOV_PCT', OFF_ORB_PCT: 'OREB_PCT',
        DEF_EFG_PCT: 'OPP_EFG_PCT', DEF_TOV_PCT: 'OPP_TOV_PCT', DEF_ORB_PCT: 'DREB_PCT'
      };
      const lgAvg = {};
      if (cachedTeamStats?.slices?.all) {
        const tms = cachedTeamStats.slices.all;
        Object.entries(lgMap).forEach(([k, ak]) => {
          const vals = tms.map(t => t[ak]).filter(v => v != null);
          if (vals.length) lgAvg[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
        });
      }

      const rowsData = new Array();
      const totalMasks = 1 << selItems.length;
      for (let m = totalMasks - 1; m >= 0; m--) {
        const st = calcState(m);
        if (st) rowsData.push({ mask: m, st });
      }

      const cols = [
        { k: 'OffRtg', pct: false, lb: false }, { k: 'DefRtg', pct: false, lb: true }, { k: 'NetRtg', pct: false, lb: false },
        { k: 'OFF_EFG_PCT', pct: true, lb: false }, { k: 'OFF_TOV_PCT', pct: true, lb: true }, { k: 'OFF_ORB_PCT', pct: true, lb: false },
        { k: 'DEF_EFG_PCT', pct: true, lb: true }, { k: 'DEF_TOV_PCT', pct: true, lb: false }, { k: 'DEF_ORB_PCT', pct: true, lb: false },
      ];

      const rowsHtml = new Array();
      rowsData.forEach(({ mask: m, st }) => {
        const icons = selItems.map((item, idx) => {
          const isOn = Boolean((m >> idx) & 1);
          const url = _wowyPhotoMap[item.key] || _wowyPhotoMap[item.fullName.toLowerCase()] || _wowyPhotoMap[normNm(item.fullName)];
          const imgTag = url
            ? `<img src="${esc(url)}" referrerpolicy="no-referrer" style="width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:top;border:2px solid ${isOn ? 'var(--blue)' : '#ccc'};${isOn ? '' : 'filter:grayscale(1);opacity:0.45;'}">`
            : `<div style="width:44px;height:44px;border-radius:50%;background:#ddd;border:2px solid ${isOn ? 'var(--blue)' : '#ccc'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#666;">${isOn ? 'ON' : 'OFF'}</div>`;
          return `<div style="text-align:center;margin-right:8px;">
            <div style="position:relative;display:inline-block;">${imgTag}${isOn ? '' : '<div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff;">OFF</div>'}</div>
            <div style="font-size:9.5px;color:var(--muted);margin-top:2px;">${esc(item.cleanLast)}</div>
          </div>`;
        }).join('');

        const valsHtml = cols.map(col => {
          const v = st[col.k];
          const disp = v == null ? 'â€”' : (col.pct ? (v * 100).toFixed(1) + '%' : v.toFixed(1));
          const nc = col.k === 'NetRtg' ? (v >= 0 ? 'color:var(--green);' : 'color:var(--red);') : '';
          let subHtml = '';
          if (v != null && lgAvg[col.k] != null && col.k !== 'NetRtg') {
            const diff = col.pct ? (v - lgAvg[col.k]) * 100 : (v - lgAvg[col.k]);
            const better = col.lb ? diff < 0 : diff > 0;
            subHtml = `<div style="font-size:9.5px;font-weight:600;color:${better ? 'var(--green)' : 'var(--red)'};margin-top:1px;">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}${col.pct ? '%' : ''}</div>`;
          }
          return `<td style="padding:7px 8px;text-align:right;vertical-align:middle;"><div style="font-size:12.5px;font-weight:700;${nc}">${disp}</div>${subHtml}</td>`;
        }).join('');

        rowsHtml.push(`<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;display:flex;align-items:center;">${icons}</td><td style="padding:7px 8px;text-align:right;font-weight:700;font-size:12px;vertical-align:middle;">${st.POSS.toLocaleString()}</td>${valsHtml}</tr>`);
      });

      // Dedicated bottom ON - OFF summary row (All-ON minus All-OFF)
      if (rowsData.length >= 2) {
        const onSt = rowsData.at(0).st;
        const offSt = rowsData.at(-1).st;
        const diffCells = cols.map(col => {
          const vOn = onSt[col.k];
          const vOff = offSt[col.k];
          if (vOn == null || vOff == null) return '<td style="padding:8px;text-align:right;">â€”</td>';
          const diff = col.pct ? (vOn - vOff) * 100 : (vOn - vOff);
          const better = col.lb ? diff < 0 : diff > 0;
          const colCss = better ? 'var(--green)' : 'var(--red)';
          return `<td style="padding:8px;text-align:right;font-size:12.5px;font-weight:700;color:${colCss};">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}${col.pct ? '%' : ''}</td>`;
        }).join('');

        rowsHtml.push(`<tr style="border-top:2px solid #000;background:rgba(0,0,0,0.025);">
          <td style="padding:8px 4px;font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.4px;">ON âˆ’ OFF</td>
          <td style="padding:8px;text-align:right;font-size:10px;color:var(--muted);">diff</td>
          ${diffCells}
        </tr>`);
      }

      container.innerHTML = `<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Shot-Chart Play-by-Play Splits Â· Subscript: Î” vs. league avg Â· Bottom row: ON âˆ’ OFF</div>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid #000;font-family:'Oswald',sans-serif;font-size:10.5px;color:var(--muted);">
            <th style="text-align:left;padding:4px;">LINEUP</th><th style="text-align:right;padding:4px 8px;">POSS</th>
            <th style="text-align:right;padding:4px 8px;">OFF</th><th style="text-align:right;padding:4px 8px;">DEF</th><th style="text-align:right;padding:4px 8px;">NET</th>
            <th style="text-align:right;padding:4px 8px;">OFF eFG%</th><th style="text-align:right;padding:4px 8px;">OFF TOV%</th><th style="text-align:right;padding:4px 8px;">OFF ORB%</th>
            <th style="text-align:right;padding:4px 8px;">DEF eFG%</th><th style="text-align:right;padding:4px 8px;">DEF TOV%</th><th style="text-align:right;padding:4px 8px;">DEF ORB%</th>
          </tr></thead>
          <tbody>${rowsHtml.join('')}</tbody>
        </table></div>`;
      return;
    }
  }

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
    if (val==null) return 'â€”';
    if (key==='POSS') return Math.round(val).toLocaleString();
    return PCT.has(key) ? (val*100).toFixed(1) : val.toFixed(1);
  }
  function deltaCell(key, val) {
    const avg = leagueAvgs[key];
    if (val==null||avg==null) return '<div style="font-size:8px;color:#aaa;">â€”</div>';
    // Both val and avg are raw API decimals (e.g. 0.13 for 13%)
    // Scale both the same way before comparing
    const scale = PCT.has(key) ? 100 : 1;
    const diff = (val * scale) - (avg * scale);
    const better = LB.has(key) ? diff<0 : diff>0;
    const sign = diff>=0 ? '+' : '';
    return `<div style="font-size:8px;color:${better?'#E6A817':'#aaa'};">${sign}${diff.toFixed(1)}${PCT.has(key)?'%':''}</div>`;
  }

  // Player photo circle â€” large Databallr style with OFF overlay
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
    <div style="font-size:9px;color:var(--muted);margin-bottom:6px;">Lineup combo weighted avg Â· Î” vs. league avg</div>
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
  if (!ld) { container.innerHTML = '<div style="color:var(--muted);font-size:12px;">Loadingâ€¦</div>'; return; }

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
    if (val == null) return 'â€”';
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
      ? `<img src="${esc(photoUrl)}" referrerpolicy="no-referrer" style="width:48px;height:48px;border-radius:50%;object-fit:cover;object-position:top;${active?'':'filter:grayscale(1);opacity:0.5;'}">`
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
    const vol = row.MIN != null ? Number(row.MIN).toFixed(0) : 'â€”';
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
        const dispVal = val == null ? 'â€”' : (s.pct ? (val * 100).toFixed(1) + '%' : val.toFixed(1));
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
        if (on == null || off == null) return `<td style="text-align:right;font-size:11px;">â€”</td>`;
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
      Source: ${esc(dataSource)} Â· subscripts vs. league average
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
      const disp = v==null?'â€”':typeof v==='number'?v.toFixed(1):v;
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

MIN_MINUTES = 25; // user-controlled via slider, shared across all tiers

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
  if (v == null) return 'â€”';
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
  const icon = name && name !== 'â€”'
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
    <span class="lc-net ${net >= 0 ? 'pos' : 'neg'}">${fmt(net)} net,<br>${mins} poss</span>
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

  let html = fetchedAt ? `<div style="font-size:10px;color:var(--muted);margin-bottom:8px;">Full 2025-26 season Â· updated ${fetchedAt}</div>` : '';
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



function toggleNoteForm() {
  const f = document.getElementById('noteForm');
  if (!f) return;
  const open = f.style.display === 'none' || !f.style.display;
  f.style.display = open ? 'block' : 'none';
  if (open) document.getElementById('noteText')?.focus();
}

function submitStaffNote() {
  const bodyEl = document.getElementById('noteText');
  const authEl = document.getElementById('noteAuthor');
  const plyEl  = document.getElementById('notePlayer');
  const body = (bodyEl?.value || '').trim();
  if (!body) return;
  const author = (authEl?.value || '').trim() || 'Staff';
  const playerName = (plyEl?.value || '').trim();
  const slug = playerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let local = new Array();
  try { local = JSON.parse(localStorage.getItem('capitanes_staff_notes') || '[]'); } catch (e) {}
  local.unshift({
    playerId: slug || '',
    playerName: playerName || '',
    playerUrl: slug ? ('player.html?id=' + slug) : '',
    author,
    body,
    createdAt: new Date().toISOString(),
    _local: true
  });
  try { localStorage.setItem('capitanes_staff_notes', JSON.stringify(local)); } catch (e) {}
  if (bodyEl) bodyEl.value = '';
  if (plyEl) plyEl.value = '';
  const f = document.getElementById('noteForm');
  if (f) f.style.display = 'none';
  loadStaffNotes();
}

async function loadStaffNotes() {
  const feed = document.getElementById('staffFeed');
  if (!feed) return;
  let base = new Array();
  let idx = new Array();
  try {
    const [resp, idxResp] = await Promise.all([
      fetch(STAFF_PATH + '?v=' + Date.now()),
      fetch('data/players_index.json?v=' + Date.now()).catch(() => null)
    ]);
    if (resp.ok) {
      const notes = await resp.json();
      base = Array.isArray(notes) ? notes : (notes.comments || new Array());
    }
    if (idxResp && idxResp.ok) {
      idx = await idxResp.json();
    }
  } catch (e) {}

  const idToName = {};
  const dl = document.getElementById('notePlayerList');
  if (dl && !dl.options.length && Array.isArray(idx)) {
    idx.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).forEach(p => {
      if (!p?.name) return;
      const opt = document.createElement('option');
      opt.value = p.name;
      dl.appendChild(opt);
    });
  }
  (Array.isArray(idx) ? idx : new Array()).forEach(p => {
    if (p?.id != null && p?.name) idToName[String(p.id).toLowerCase()] = p.name;
  });

  const resolvePlayer = (n) => {
    if (n.playerName) return n.playerName;
    const pid = String(n.playerId || '').trim();
    if (!pid) return '';
    if (idToName[pid.toLowerCase()]) return idToName[pid.toLowerCase()];
    return pid.split('-').map(w => w ? (w.charAt(0).toUpperCase() + w.slice(1)) : '').join(' ');
  };

  let local = new Array();
  try { local = JSON.parse(localStorage.getItem('capitanes_staff_notes') || '[]'); } catch (e) {}
  const list = new Array(...local, ...base);
  if (!list.length) {
    feed.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:4px 0;">No recent notes. Click + New Note to add one.</div>';
    return;
  }
  feed.innerHTML = list.slice(0, 19).map(n => {
    const pName = resolvePlayer(n);
    const pUrl = n.playerUrl || (n.playerId ? ('player.html?id=' + encodeURIComponent(n.playerId)) : '');
    const playerTag = pName
      ? (pUrl
          ? `<a href="${esc(pUrl)}" onclick="event.stopPropagation()" style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;color:var(--blue);text-decoration:none;margin-right:5px;">${esc(pName)}</a>`
          : `<span style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;color:var(--blue);margin-right:5px;">${esc(pName)}</span>`)
      : '';
    const full = n.body || '';
    const flat = full.replace(/\s+/g, ' ').trim();
    const excerpt = flat.slice(0, 115) + (flat.length > 115 ? '…' : '');
    const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '';
    const meta = `<span class="staff-feed-meta"> — ${esc(n.author || '')}${date ? ' · ' + date : ''}</span>`;
    return `<div class="staff-feed-row" onclick="this.classList.toggle('expanded')">
      <span class="staff-feed-excerpt">${playerTag}${esc(excerpt)}${meta}</span>
      <span class="staff-feed-full" style="white-space:pre-line;">${playerTag}${esc(full)}${meta}</span>
    </div>`;
  }).join('');
}

// Rotation placeholder â€” 10 silhouettes with XX Minutes
async function buildRotationPlaceholders() {
  const r1 = document.getElementById('rotationRow1');
  const r2 = document.getElementById('rotationRow2');
  if (!r1 || !r2) return;

  // Load real rotation from mex_data players sorted by minutes
  // Cross-reference with players_index for photos
  try {
    const [d, idx, ld] = await Promise.all([
      loadMexData(),
      loadBap().catch(() => []),
      (window._wowyLineupData
        ? Promise.resolve(window._wowyLineupData)
        : fetch(LINEUP_DATA_PATH() + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null)),
    ]);

    const players = (d.players || [])
      .filter(p => (p.MIN || 0) > 0)
      .sort((a, b) => (b.MIN || 0) - (a.MIN || 0))
      .slice(0, 10);

    const normKey = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[.,'â€™\-]/g, ' ')
      .split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');

    const photoMap = {};
    const registerPhoto = (nameStr, url) => {
      if (!nameStr || !url) return;
      const low = String(nameStr).trim().toLowerCase();
      const clean = normKey(nameStr);
      if (!photoMap[low]) photoMap[low] = url;
      if (clean && !photoMap[clean]) photoMap[clean] = url;
      const pts = clean.split(' ');
      if (pts.length >= 2) {
        const firstLast = `${pts.at(0)} ${pts.at(-1)}`;
        const initLast = `${pts.at(0).at(0)}. ${pts.at(-1)}`;
        if (!photoMap[firstLast]) photoMap[firstLast] = url;
        if (!photoMap[initLast]) photoMap[initLast] = url;
      }
    };

    // 1. Primary source: Lineup Data playerXref (exact same images as Lineup Data section)
    Object.entries(ld?.playerXref || {}).forEach(([abbrev, info]) => {
      if (info?.photoUrl) {
        registerPhoto(abbrev, info.photoUrl);
        if (info.name) registerPhoto(info.name, info.photoUrl);
      }
    });

    // 2. Fallback source: players_index
    (idx || []).forEach(p => {
      if (p.name && p.photoUrl) registerPhoto(p.name, p.photoUrl);
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
        const cleanDisp = normKey(displayName);
        const dPts = cleanDisp.split(' ');
        const flDisp = dPts.length >= 2 ? `${dPts.at(0)} ${dPts.at(-1)}` : cleanDisp;
        const photoUrl = photoMap[fullName.toLowerCase()]
          || photoMap[displayName.toLowerCase()]
          || photoMap[shortName.toLowerCase()]
          || photoMap[normKey(fullName)]
          || photoMap[cleanDisp]
          || photoMap[flDisp];
        const photo = photoUrl
          ? `<img src="${esc(photoUrl)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;object-position:top;display:block;margin:0 auto 1px;" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><svg width="36" height="36" viewBox="0 0 36 36" style="display:none;margin:0 auto 1px;"><circle cx="18" cy="13" r="8" fill="#999"/><ellipse cx="18" cy="32" rx="13" ry="9" fill="#999"/></svg>`
          : `<svg width="36" height="36" viewBox="0 0 36 36" style="display:block;margin:0 auto 1px;"><circle cx="18" cy="13" r="8" fill="#999"/><ellipse cx="18" cy="32" rx="13" ry="9" fill="#999"/></svg>`;
        return `<div class="rot-player">${photo}<span class="rot-player-mins">${mins}</span><span class="rot-player-name">${esc(shortName)}</span></div>`;
      }
      r1.innerHTML = players.slice(0, 4).map(rotCard).join('');
      r2.innerHTML = players.slice(5, 10).map(rotCard).join('');
      return;
    }
  } catch(e) {}

  // Fallback placeholders
  for (let i = 0; i < 5; i++) r1.innerHTML += buildRotationPlayer('â€”', 'XX Min');
  for (let i = 0; i < 5; i++) r2.innerHTML += buildRotationPlayer('â€”', 'XX Min');
}




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
        if (p.name) { _wowyPhotoMap[p.name.toLowerCase()] = p.photoUrl; _wowyPhotoMap[p.name.toLowerCase().replace(/[.,'â€™\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ')] = p.photoUrl; }
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
        <option value="">â€”</option>
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
  container.innerHTML = '<div style="color:var(--muted);font-size:11px;">Computingâ€¦</div>';

  function getPlayers(c) { return (c.GROUP_NAME||'').split(' - ').map(n=>n.trim()); }

  // Use 5-man for POSS (non-overlapping, accurate sample size)
  // Use duos for ratings (most complete coverage, consistent bias in differential)
  const fivemanCombos = ld?.fiveman || [];
  const ratingCombos  = [...(ld?.duos||[]), ...(ld?.trios||[]), ...(ld?.quads||[]), ...(ld?.fiveman||[])];

  // Available fields: E_OFF_RATING, E_DEF_RATING, E_NET_RATING (smoothed for small samples)
  // EFG_PCT, TM_TOV_PCT, OREB_PCT, DREB_PCT, TS_PCT
  // No OPP_ fields â€” Four Factors not fetched for lineups yet
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

  if (!window._scWowyCache) window._scWowyCache = {};
  if (!window._scWowyCache.hasOwnProperty(SEASON)) {
    const scResp = await fetch(`data/shot_charts_${SEASON}.json?v=` + Date.now()).catch(() => null);
    window._scWowyCache[SEASON] = (scResp && scResp.ok) ? await scResp.json() : null;
  }
  const scData = window._scWowyCache[SEASON];

  if (scData && Array.isArray(scData.poss) && Array.isArray(scData.shots)) {
    const normNm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,'â€™\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');
    const scPlayers = Array.isArray(scData.players) ? scData.players : Object.values(scData.players || {});

    const selItems = selected.map(selKey => {
      const entry = _wowyPlayers.find(p => p.abbrev === selKey || p.player === selKey);
      const fullName = entry?.player || selKey;
      const cleanFull = normNm(fullName);
      const fPts = cleanFull.split(' ');
      const match = scPlayers.find(sp => {
        const cSp = normNm(sp.name);
        if (cSp === cleanFull) return true;
        const sPts = cSp.split(' ');
        return fPts.length >= 2 && sPts.length >= 2 && fPts.at(0).at(0) === sPts.at(0).at(0) && fPts.at(-1) === sPts.at(-1);
      });
      const cleanLast = fullName.replace(/,\s*(jr|sr|ii|iii|iv|v)\.?$/i, '').split(/\s+/).filter(w => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w)).pop() || fullName;
      return { key: selKey, fullName, cleanLast, pid: match ? Number(match.id) : null };
    });

    if (selItems.every(x => x.pid != null)) {
      const calcState = (mask) => {
        const matchOn = (onArr) => {
          const setOn = new Set((onArr || []).map(Number));
          for (let i = 0; i < selItems.length; i++) {
            const wantOn = Boolean((mask >> i) & 1);
            if (setOn.has(selItems.at(i).pid) !== wantOn) return false;
          }
          return true;
        };

        const sideStats = (side) => {
          const pArr = scData.poss.filter(x => x.side === side && matchOn(x.on));
          const sArr = scData.shots.filter(x => x.side === side && matchOn(x.on));
          const tArr = (scData.turnovers || []).filter(x => x.side === side && matchOn(x.on));
          const fArr = (scData.fts || []).filter(x => x.side === side && matchOn(x.on));

          const nPoss = pArr.length;
          const shotPts = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 ? (Number(s.val) || 2) : 0), 0);
          const ftPts = fArr.reduce((acc, ft) => acc + (Number(ft.made) === 1 ? 1 : 0), 0);
          const rtg = nPoss ? ((shotPts + ftPts) / nPoss) * 100 : null;

          const fga = sArr.length;
          const fgm = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 ? 1 : 0), 0);
          const fg3m = sArr.reduce((acc, s) => acc + (Number(s.made) === 1 && Number(s.val) === 3 ? 1 : 0), 0);
          const efg = fga ? ((fgm + 0.5 * fg3m) / fga) : null;
          const tovPct = nPoss ? (tArr.length / nPoss) : null;

          const missedFga = fga - fgm;
          const missedFinalFt = fArr.filter(ft => Number(ft.made) === 0 && /1 of 1|2 of 2|3 of 3/.test(String(ft.sub || ''))).length;
          const rebOpps = missedFga + missedFinalFt;
          const orebs = pArr.reduce((acc, p) => acc + (Number(p.oreb) || 0), 0);
          const orbPct = rebOpps ? (side === 'off' ? (orebs / rebOpps) : (1 - orebs / rebOpps)) : null;

          return { nPoss, rtg, efg, tovPct, orbPct };
        };

        const offS = sideStats('off');
        const defS = sideStats('def');
        const totPoss = Math.round((offS.nPoss + defS.nPoss) / 2);
        if (!totPoss) return null;
        return {
          POSS: totPoss, OffRtg: offS.rtg, DefRtg: defS.rtg,
          NetRtg: (offS.rtg != null && defS.rtg != null) ? (offS.rtg - defS.rtg) : null,
          OFF_EFG_PCT: offS.efg, OFF_TOV_PCT: offS.tovPct, OFF_ORB_PCT: offS.orbPct,
          DEF_EFG_PCT: defS.efg, DEF_TOV_PCT: defS.tovPct, DEF_ORB_PCT: defS.orbPct,
        };
      };
      const lgMap = {
        OffRtg: 'OFF_RATING', DefRtg: 'DEF_RATING', NetRtg: 'NET_RATING',
        OFF_EFG_PCT: 'EFG_PCT', OFF_TOV_PCT: 'TM_TOV_PCT', OFF_ORB_PCT: 'OREB_PCT',
        DEF_EFG_PCT: 'OPP_EFG_PCT', DEF_TOV_PCT: 'OPP_TOV_PCT', DEF_ORB_PCT: 'DREB_PCT'
      };
      const lgAvg = {};
      if (cachedTeamStats?.slices?.all) {
        const tms = cachedTeamStats.slices.all;
        Object.entries(lgMap).forEach(([k, ak]) => {
          const vals = tms.map(t => t[ak]).filter(v => v != null);
          if (vals.length) lgAvg[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
        });
      }

      const rowsData = new Array();
      const totalMasks = 1 << selItems.length;
      for (let m = totalMasks - 1; m >= 0; m--) {
        const st = calcState(m);
        if (st) rowsData.push({ mask: m, st });
      }

      const cols = [
        { k: 'OffRtg', pct: false, lb: false }, { k: 'DefRtg', pct: false, lb: true }, { k: 'NetRtg', pct: false, lb: false },
        { k: 'OFF_EFG_PCT', pct: true, lb: false }, { k: 'OFF_TOV_PCT', pct: true, lb: true }, { k: 'OFF_ORB_PCT', pct: true, lb: false },
        { k: 'DEF_EFG_PCT', pct: true, lb: true }, { k: 'DEF_TOV_PCT', pct: true, lb: false }, { k: 'DEF_ORB_PCT', pct: true, lb: false },
      ];

      const rowsHtml = new Array();
      rowsData.forEach(({ mask: m, st }) => {
        const icons = selItems.map((item, idx) => {
          const isOn = Boolean((m >> idx) & 1);
          const url = _wowyPhotoMap[item.key] || _wowyPhotoMap[item.fullName.toLowerCase()] || _wowyPhotoMap[normNm(item.fullName)];
          const imgTag = url
            ? `<img src="${esc(url)}" referrerpolicy="no-referrer" style="width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:top;border:2px solid ${isOn ? 'var(--blue)' : '#ccc'};${isOn ? '' : 'filter:grayscale(1);opacity:0.45;'}">`
            : `<div style="width:44px;height:44px;border-radius:50%;background:#ddd;border:2px solid ${isOn ? 'var(--blue)' : '#ccc'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#666;">${isOn ? 'ON' : 'OFF'}</div>`;
          return `<div style="text-align:center;margin-right:8px;">
            <div style="position:relative;display:inline-block;">${imgTag}${isOn ? '' : '<div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff;">OFF</div>'}</div>
            <div style="font-size:9.5px;color:var(--muted);margin-top:2px;">${esc(item.cleanLast)}</div>
          </div>`;
        }).join('');

        const valsHtml = cols.map(col => {
          const v = st[col.k];
          const disp = v == null ? 'â€”' : (col.pct ? (v * 100).toFixed(1) + '%' : v.toFixed(1));
          const nc = col.k === 'NetRtg' ? (v >= 0 ? 'color:var(--green);' : 'color:var(--red);') : '';
          let subHtml = '';
          if (v != null && lgAvg[col.k] != null && col.k !== 'NetRtg') {
            const diff = col.pct ? (v - lgAvg[col.k]) * 100 : (v - lgAvg[col.k]);
            const better = col.lb ? diff < 0 : diff > 0;
            subHtml = `<div style="font-size:9.5px;font-weight:600;color:${better ? 'var(--green)' : 'var(--red)'};margin-top:1px;">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}${col.pct ? '%' : ''}</div>`;
          }
          return `<td style="padding:7px 8px;text-align:right;vertical-align:middle;"><div style="font-size:12.5px;font-weight:700;${nc}">${disp}</div>${subHtml}</td>`;
        }).join('');

        rowsHtml.push(`<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;display:flex;align-items:center;">${icons}</td><td style="padding:7px 8px;text-align:right;font-weight:700;font-size:12px;vertical-align:middle;">${st.POSS.toLocaleString()}</td>${valsHtml}</tr>`);
      });

      // Dedicated bottom ON - OFF summary row (All-ON minus All-OFF)
      if (rowsData.length >= 2) {
        const onSt = rowsData.at(0).st;
        const offSt = rowsData.at(-1).st;
        const diffCells = cols.map(col => {
          const vOn = onSt[col.k];
          const vOff = offSt[col.k];
          if (vOn == null || vOff == null) return '<td style="padding:8px;text-align:right;">â€”</td>';
          const diff = col.pct ? (vOn - vOff) * 100 : (vOn - vOff);
          const better = col.lb ? diff < 0 : diff > 0;
          const colCss = better ? 'var(--green)' : 'var(--red)';
          return `<td style="padding:8px;text-align:right;font-size:12.5px;font-weight:700;color:${colCss};">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}${col.pct ? '%' : ''}</td>`;
        }).join('');

        rowsHtml.push(`<tr style="border-top:2px solid #000;background:rgba(0,0,0,0.025);">
          <td style="padding:8px 4px;font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.4px;">ON âˆ’ OFF</td>
          <td style="padding:8px;text-align:right;font-size:10px;color:var(--muted);">diff</td>
          ${diffCells}
        </tr>`);
      }

      container.innerHTML = `<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Shot-Chart Play-by-Play Splits Â· Subscript: Î” vs. league avg Â· Bottom row: ON âˆ’ OFF</div>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid #000;font-family:'Oswald',sans-serif;font-size:10.5px;color:var(--muted);">
            <th style="text-align:left;padding:4px;">LINEUP</th><th style="text-align:right;padding:4px 8px;">POSS</th>
            <th style="text-align:right;padding:4px 8px;">OFF</th><th style="text-align:right;padding:4px 8px;">DEF</th><th style="text-align:right;padding:4px 8px;">NET</th>
            <th style="text-align:right;padding:4px 8px;">OFF eFG%</th><th style="text-align:right;padding:4px 8px;">OFF TOV%</th><th style="text-align:right;padding:4px 8px;">OFF ORB%</th>
            <th style="text-align:right;padding:4px 8px;">DEF eFG%</th><th style="text-align:right;padding:4px 8px;">DEF TOV%</th><th style="text-align:right;padding:4px 8px;">DEF ORB%</th>
          </tr></thead>
          <tbody>${rowsHtml.join('')}</tbody>
        </table></div>`;
      return;
    }
  }

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
    if (val==null) return 'â€”';
    if (key==='POSS') return Math.round(val).toLocaleString();
    return PCT.has(key) ? (val*100).toFixed(1) : val.toFixed(1);
  }
  function deltaCell(key, val) {
    const avg = leagueAvgs[key];
    if (val==null||avg==null) return '<div style="font-size:8px;color:#aaa;">â€”</div>';
    // Both val and avg are raw API decimals (e.g. 0.13 for 13%)
    // Scale both the same way before comparing
    const scale = PCT.has(key) ? 100 : 1;
    const diff = (val * scale) - (avg * scale);
    const better = LB.has(key) ? diff<0 : diff>0;
    const sign = diff>=0 ? '+' : '';
    return `<div style="font-size:8px;color:${better?'#E6A817':'#aaa'};">${sign}${diff.toFixed(1)}${PCT.has(key)?'%':''}</div>`;
  }

  // Player photo circle â€” large Databallr style with OFF overlay
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
    <div style="font-size:9px;color:var(--muted);margin-bottom:6px;">Lineup combo weighted avg Â· Î” vs. league avg</div>
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
  if (!ld) { container.innerHTML = '<div style="color:var(--muted);font-size:12px;">Loadingâ€¦</div>'; return; }

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
    if (val == null) return 'â€”';
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
      ? `<img src="${esc(photoUrl)}" referrerpolicy="no-referrer" style="width:48px;height:48px;border-radius:50%;object-fit:cover;object-position:top;${active?'':'filter:grayscale(1);opacity:0.5;'}">`
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
    const vol = row.MIN != null ? Number(row.MIN).toFixed(0) : 'â€”';
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
        const dispVal = val == null ? 'â€”' : (s.pct ? (val * 100).toFixed(1) + '%' : val.toFixed(1));
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
        if (on == null || off == null) return `<td style="text-align:right;font-size:11px;">â€”</td>`;
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
      Source: ${esc(dataSource)} Â· subscripts vs. league average
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
      const disp = v==null?'â€”':typeof v==='number'?v.toFixed(1):v;
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

MIN_MINUTES = 25; // user-controlled via slider, shared across all tiers

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
  if (v == null) return 'â€”';
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
  const icon = name && name !== 'â€”'
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
    <span class="lc-net ${net >= 0 ? 'pos' : 'neg'}">${fmt(net)} net,<br>${mins} poss</span>
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

  let html = fetchedAt ? `<div style="font-size:10px;color:var(--muted);margin-bottom:8px;">Full 2025-26 season Â· updated ${fetchedAt}</div>` : '';
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



function toggleNoteForm() {
  const f = document.getElementById('noteForm');
  if (!f) return;
  const open = f.style.display === 'none' || !f.style.display;
  f.style.display = open ? 'block' : 'none';
  if (open) document.getElementById('noteText')?.focus();
}

function submitStaffNote() {
  const bodyEl = document.getElementById('noteText');
  const authEl = document.getElementById('noteAuthor');
  const plyEl  = document.getElementById('notePlayer');
  const body = (bodyEl?.value || '').trim();
  if (!body) return;
  const author = (authEl?.value || '').trim() || 'Staff';
  const playerName = (plyEl?.value || '').trim();
  const slug = playerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let local = new Array();
  try { local = JSON.parse(localStorage.getItem('capitanes_staff_notes') || '[]'); } catch (e) {}
  local.unshift({
    playerId: slug || '',
    playerName: playerName || '',
    playerUrl: slug ? ('player.html?id=' + slug) : '',
    author,
    body,
    createdAt: new Date().toISOString(),
    _local: true
  });
  try { localStorage.setItem('capitanes_staff_notes', JSON.stringify(local)); } catch (e) {}
  if (bodyEl) bodyEl.value = '';
  if (plyEl) plyEl.value = '';
  const f = document.getElementById('noteForm');
  if (f) f.style.display = 'none';
  loadStaffNotes();
}

async function loadStaffNotes() {
  const feed = document.getElementById('staffFeed');
  if (!feed) return;
  let base = new Array();
  let idx = new Array();
  try {
    const [resp, idxResp] = await Promise.all([
      fetch(STAFF_PATH + '?v=' + Date.now()),
      fetch('data/players_index.json?v=' + Date.now()).catch(() => null)
    ]);
    if (resp.ok) {
      const notes = await resp.json();
      base = Array.isArray(notes) ? notes : (notes.comments || new Array());
    }
    if (idxResp && idxResp.ok) {
      idx = await idxResp.json();
    }
  } catch (e) {}

  const idToName = {};
  const dl = document.getElementById('notePlayerList');
  if (dl && !dl.options.length && Array.isArray(idx)) {
    idx.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).forEach(p => {
      if (!p?.name) return;
      const opt = document.createElement('option');
      opt.value = p.name;
      dl.appendChild(opt);
    });
  }
  (Array.isArray(idx) ? idx : new Array()).forEach(p => {
    if (p?.id != null && p?.name) idToName[String(p.id).toLowerCase()] = p.name;
  });

  const resolvePlayer = (n) => {
    if (n.playerName) return n.playerName;
    const pid = String(n.playerId || '').trim();
    if (!pid) return '';
    if (idToName[pid.toLowerCase()]) return idToName[pid.toLowerCase()];
    return pid.split('-').map(w => w ? (w.charAt(0).toUpperCase() + w.slice(1)) : '').join(' ');
  };

  let local = new Array();
  try { local = JSON.parse(localStorage.getItem('capitanes_staff_notes') || '[]'); } catch (e) {}
  const list = new Array(...local, ...base);
  if (!list.length) {
    feed.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:4px 0;">No recent notes. Click + New Note to add one.</div>';
    return;
  }
  feed.innerHTML = list.slice(0, 19).map(n => {
    const pName = resolvePlayer(n);
    const pUrl = n.playerUrl || (n.playerId ? ('player.html?id=' + encodeURIComponent(n.playerId)) : '');
    const playerTag = pName
      ? (pUrl
          ? `<a href="${esc(pUrl)}" onclick="event.stopPropagation()" style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;color:var(--blue);text-decoration:none;margin-right:5px;">${esc(pName)}</a>`
          : `<span style="font-family:'Oswald',sans-serif;font-weight:700;font-size:11px;color:var(--blue);margin-right:5px;">${esc(pName)}</span>`)
      : '';
    const full = n.body || '';
    const flat = full.replace(/\s+/g, ' ').trim();
    const excerpt = flat.slice(0, 115) + (flat.length > 115 ? '…' : '');
    const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '';
    const meta = `<span class="staff-feed-meta"> — ${esc(n.author || '')}${date ? ' · ' + date : ''}</span>`;
    return `<div class="staff-feed-row" onclick="this.classList.toggle('expanded')">
      <span class="staff-feed-excerpt">${playerTag}${esc(excerpt)}${meta}</span>
      <span class="staff-feed-full" style="white-space:pre-line;">${playerTag}${esc(full)}${meta}</span>
    </div>`;
  }).join('');
}

// Rotation placeholder â€” 10 silhouettes with XX Minutes
async function buildRotationPlaceholders() {
  const r1 = document.getElementById('rotationRow1');
  const r2 = document.getElementById('rotationRow2');
  if (!r1 || !r2) return;

  // Load real rotation from mex_data players sorted by minutes
  // Cross-reference with players_index for photos
  try {
    const [d, idx, ld] = await Promise.all([
      loadMexData(),
      loadBap().catch(() => []),
      (window._wowyLineupData
        ? Promise.resolve(window._wowyLineupData)
        : fetch(LINEUP_DATA_PATH() + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null)),
    ]);

    const players = (d.players || [])
      .filter(p => (p.MIN || 0) > 0)
      .sort((a, b) => (b.MIN || 0) - (a.MIN || 0))
      .slice(0, 10);

    const normKey = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[.,'â€™\-]/g, ' ')
      .split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');

    const photoMap = {};
    const registerPhoto = (nameStr, url) => {
      if (!nameStr || !url) return;
      const low = String(nameStr).trim().toLowerCase();
      const clean = normKey(nameStr);
      if (!photoMap[low]) photoMap[low] = url;
      if (clean && !photoMap[clean]) photoMap[clean] = url;
      const pts = clean.split(' ');
      if (pts.length >= 2) {
        const firstLast = `${pts.at(0)} ${pts.at(-1)}`;
        const initLast = `${pts.at(0).at(0)}. ${pts.at(-1)}`;
        if (!photoMap[firstLast]) photoMap[firstLast] = url;
        if (!photoMap[initLast]) photoMap[initLast] = url;
      }
    };

    // 1. Primary source: Lineup Data playerXref (exact same images as Lineup Data section)
    Object.entries(ld?.playerXref || {}).forEach(([abbrev, info]) => {
      if (info?.photoUrl) {
        registerPhoto(abbrev, info.photoUrl);
        if (info.name) registerPhoto(info.name, info.photoUrl);
      }
    });

    // 2. Fallback source: players_index
    (idx || []).forEach(p => {
      if (p.name && p.photoUrl) registerPhoto(p.name, p.photoUrl);
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
        const cleanDisp = normKey(displayName);
        const dPts = cleanDisp.split(' ');
        const flDisp = dPts.length >= 2 ? `${dPts.at(0)} ${dPts.at(-1)}` : cleanDisp;
        const photoUrl = photoMap[fullName.toLowerCase()]
          || photoMap[displayName.toLowerCase()]
          || photoMap[shortName.toLowerCase()]
          || photoMap[normKey(fullName)]
          || photoMap[cleanDisp]
          || photoMap[flDisp];
        const photo = photoUrl
          ? `<img src="${esc(photoUrl)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;object-position:top;display:block;margin:0 auto 1px;" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><svg width="36" height="36" viewBox="0 0 36 36" style="display:none;margin:0 auto 1px;"><circle cx="18" cy="13" r="8" fill="#999"/><ellipse cx="18" cy="32" rx="13" ry="9" fill="#999"/></svg>`
          : `<svg width="36" height="36" viewBox="0 0 36 36" style="display:block;margin:0 auto 1px;"><circle cx="18" cy="13" r="8" fill="#999"/><ellipse cx="18" cy="32" rx="13" ry="9" fill="#999"/></svg>`;
        return `<div class="rot-player">${photo}<span class="rot-player-mins">${mins}</span><span class="rot-player-name">${esc(shortName)}</span></div>`;
      }
      r1.innerHTML = players.slice(0, 4).map(rotCard).join('');
      r2.innerHTML = players.slice(5, 10).map(rotCard).join('');
      return;
    }
  } catch(e) {}

  // Fallback placeholders
  for (let i = 0; i < 5; i++) r1.innerHTML += buildRotationPlayer('â€”', 'XX Min');
  for (let i = 0; i < 5; i++) r2.innerHTML += buildRotationPlayer('â€”', 'XX Min');
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
    if (r) r.textContent = mxc[rankKey] != null ? ordinal(mxc[rankKey]) : 'â€”';
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
    if (note) note.textContent = 'â€”';
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
    if (!teams) return; // slice not in file yet â€” silently leave dashes
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
    if (!r.ok) throw new Error('lineup_data.json not found â€” run fetch_lineup_data.py and commit the output');
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
      `${data.duos.length} duos Â· ${data.trios.length} trios Â· ${data.quads.length} quads`;
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
        `${duos.length} duos Â· trios/quads/5-man: commit lineup_data.json`;
      renderLineupContent(data);
    }).catch(() => {
      document.getElementById('lineupContent').innerHTML =
        `<div style="color:var(--red);font-size:12px;">Could not load lineup data: ${esc(e.message)}</div>`;
    });
  });

// Wire all filter controls â€” slider is client-side only, rest trigger a refetch
const minMinsSlider = document.getElementById('minMinsSlider');
if (minMinsSlider) {
  minMinsSlider.addEventListener('input', function() {
    const lbl = document.getElementById('minMinsLabel');
    if (lbl) lbl.textContent = this.value;
    if (window._lastLineupData) renderLineupContent(window._lastLineupData, Number(this.value));
  });
}

// Lab filter controls â€” trigger a new fetch when any filter changes
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
  document.getElementById('lineupFetchStatus').textContent = 'Loadingâ€¦';
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
        `${data.duos.length} duos Â· ${data.trios.length} trios Â· ${data.quads.length} quads`;
      renderLineupContent(data);
    })
    .catch(e => {
      document.getElementById('lineupContent').innerHTML =
        `<div style="color:var(--red);font-size:12px;">No ${SEASON} lineup data yet â€” run fetch_lineup_data.py ${SEASON}</div>`;
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

// â”€â”€ Best Available Players â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _bapData = null;
const _bapActiveCats = new Set(['twoway', 'latino', 'gleague', 'notes', 'hidesigned', 'lnbp', 'hightier', 'midtier', 'lowtier']);

async function loadBap() {
  if (_bapData) return _bapData;
  const r = await fetch('data/players_index.json?v=' + Date.now());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  _bapData = await r.json();
  return _bapData;
}

function toggleBapCat(cat, btn) {
  if (_bapActiveCats.has(cat)) {
    _bapActiveCats.delete(cat);
    btn.classList.add('off');
  } else {
    _bapActiveCats.add(cat);
    btn.classList.remove('off');
  }
  renderBap();
}

function bapNameHtml(p) {
  const name = esc(p.name || '');
  if (p.onRoster) return `<span style="background:var(--yellow);color:var(--blue);padding:0 2px;">${name}</span>`;
  if (p.trainingCampInvite) return `<span style="background:var(--blue);color:var(--yellow);padding:0 2px;">${name}</span>`;
  return name;
}

function bapRankRow(rank, p) {
  const twBadge = p._isTwoWay
    ? ` <span style="font-size:8.5px;font-weight:700;color:#1631FF;background:#EEF4FB;padding:0 3px;border:1px solid #B8D0F0;">2W/E10</span>`
    : '';
  const noteBadge = p._hasNote
    ? ` <span style="font-size:8.5px;font-weight:700;color:#854D0E;background:#FEF9C3;padding:0 3px;border:1px solid #FDE047;">NOTE</span>`
    : '';
  const teamTag = p._currentTeam
    ? ` <span style="font-size:9px;color:var(--muted);">(${esc(p._currentTeam)})</span>`
    : '';
  return `<a href="player.html?id=${esc(p.id)}" style="font-size:11px;line-height:1.4;display:block;color:inherit;text-decoration:none;">
    <span style="margin-right:3px;color:var(--muted);">${rank}.</span>${bapNameHtml(p)}${twBadge}${noteBadge}${teamTag}
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

    if (!window._bapStaffNoteIds) {
      const snResp = await fetch('data/staff_notes.json?v=' + Date.now()).catch(() => null);
      const snArr = (snResp && snResp.ok) ? await snResp.json() : [];
      window._bapStaffNoteIds = new Set(snArr.map(n => String(n.playerId || '')).filter(Boolean));
    }
    const staffNoteIds = window._bapStaffNoteIds;

    const noteStr = (p) => `${p.availabilityNote || ''} ${p.availabilityDetail || ''} ${p.contract || ''} ${p.league || ''}`;
    const isTwoWayOrE10 = (p) => /two[-\s]?way|2[-\s]?way|exhibit[-\s]?10|\be10\b/i.test(noteStr(p));
    const isLnbp = (p) => /\blnbp\b/i.test(noteStr(p));
    const isHighTier = (p) => /\b(nba|acb|jeep elite|betclic|euroleague|eurocup|vtb|cba)\b/i.test(noteStr(p)) && !isTwoWayOrE10(p);
    const isMidTier = (p) => /\b(bbl|bsl|lkl|lega basket|lba|aba|bcl|kbl|bleague|b\.league|nbl)\b/i.test(noteStr(p));
    const isLowTier = (p) => /\b(nbb|bnxt|pro b|leb|primera feb|bal|cibacopa|spb|bsn)\b/i.test(noteStr(p));
    const isAnyLeagueTier = (p) => isHighTier(p) || isMidTier(p) || isLowTier(p);
    const isLowMinGl = (p) => Boolean(idToTeam[p.id] && (idToPoss[p.id] || 0) <= p40 && !isTwoWayOrE10(p));
    const hasStaffNotes = (p) => staffNoteIds.has(String(p.id || ''));
    const isSigned = (p) => p.availabilitySimple === 'no' || Boolean(p.onRoster) || Boolean(idToTeam[p.id]) || isTwoWayOrE10(p) || isLnbp(p) || isAnyLeagueTier(p);

    const bapQ = (document.getElementById('bapSearch')?.value || '').trim().toLowerCase();

    let pool = all.filter(p => {
      if (p.overallRank == null) return false;
      if (!_bapActiveCats.has('latino') && p.latino === true) return false;

      if (bapQ) {
        const hay = `${p.name || ''} ${p.team || ''} ${idToTeam[p.id] || ''} ${noteStr(p)} ${p.position || ''}`.toLowerCase();
        if (!hay.includes(bapQ)) return false;
      }

      // When 'Hide Signed Players' is active, strictly show ONLY unsigned players across all levels
      if (_bapActiveCats.has('hidesigned')) {
        return !isSigned(p);
      }

      // When 'Hide Signed Players' is off, show unsigned players plus any active signed categories
      if (!isSigned(p)) return true;
      if (_bapActiveCats.has('twoway') && isTwoWayOrE10(p)) return true;
      if (_bapActiveCats.has('gleague') && isLowMinGl(p)) return true;
      if (_bapActiveCats.has('notes') && hasStaffNotes(p)) return true;
      if (_bapActiveCats.has('lnbp') && isLnbp(p)) return true;
      if (_bapActiveCats.has('hightier') && isHighTier(p)) return true;
      if (_bapActiveCats.has('midtier') && isMidTier(p)) return true;
      if (_bapActiveCats.has('lowtier') && isLowTier(p)) return true;
      return false;
    });

    // Attach current team tag to each player
    pool = pool.map(p => ({ ...p, _currentTeam: idToTeam[p.id] || null, _isTwoWay: isTwoWayOrE10(p), _hasNote: hasStaffNotes(p) }));

    const latino = pool.filter(p => p.latino === true).sort((a, b) => a.overallRank - b.overallRank);
    const byPos  = pos => pool.filter(p => p.position === pos && p.positionalRank != null)
                              .sort((a, b) => a.positionalRank - b.positionalRank);

    container.innerHTML = [
      bapRenderBoard('Guard Ranks:',  byPos('Guard'), 'rankings.html?pos=guard'),
      bapRenderBoard('Wing Ranks:',   byPos('Wing'),  'rankings.html?pos=wing'),
      bapRenderBoard('Big Ranks:',    byPos('Big'),   'rankings.html?pos=big'),
    ].join('');
  } catch(e) {
    container.innerHTML = `<div style="color:var(--muted);font-size:11px;">Could not load: ${esc(e.message)}</div>`;
  }
}

// â”€â”€ In-Season Player Stats tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  if (typeof PS_PRESETS !== 'undefined' && PS_PRESETS[view]) {
    _psSelectedCols = PS_PRESETS[view].slice();
    try { localStorage.setItem('capitanes_ps_cols', JSON.stringify(_psSelectedCols)); } catch (e) {}
  }
  document.querySelectorAll('.psview').forEach(b =>
    b.style.color = b.dataset.view === view ? 'var(--blue)' : 'var(--muted)'
  );
  renderPsTab();
}

const PS_METRIC_DEFS = [
  { id: 'gp',       lbl: 'GP',      grp: 'Volume',   fn: r => r.gp || '—', num: r => r.gp },
  { id: 'mpg',      lbl: 'MPG',     grp: 'Volume',   fn: r => r.mpg != null ? r.mpg.toFixed(1) : '—', num: r => r.mpg },
  { id: 'min',      lbl: 'MIN',     grp: 'Volume',   fn: r => r.min != null ? r.min.toFixed(0) : '—', num: r => r.min },
  { id: 'poss',     lbl: 'POSS',    grp: 'Volume',   fn: r => r.poss != null ? Math.round(r.poss) : '—', num: r => r.poss },
  { id: 'pts75',    lbl: 'PTS/75',  grp: 'Per-75',   fn: r => r.pts75 != null ? r.pts75.toFixed(1) : '—', num: r => r.pts75 },
  { id: 'reb75',    lbl: 'REB/75',  grp: 'Per-75',   fn: r => r.reb75 != null ? r.reb75.toFixed(1) : '—', num: r => r.reb75 },
  { id: 'ast75',    lbl: 'AST/75',  grp: 'Per-75',   fn: r => r.ast75 != null ? r.ast75.toFixed(1) : '—', num: r => r.ast75 },
  { id: 'tov75',    lbl: 'TOV/75',  grp: 'Per-75',   fn: r => r.tov75 != null ? r.tov75.toFixed(1) : '—', num: r => r.tov75 },
  { id: 'stl75',    lbl: 'STL/75',  grp: 'Per-75',   fn: r => r.stl75 != null ? r.stl75.toFixed(1) : '—', num: r => r.stl75 },
  { id: 'blk75',    lbl: 'BLK/75',  grp: 'Per-75',   fn: r => r.blk75 != null ? r.blk75.toFixed(1) : '—', num: r => r.blk75 },
  { id: 'tsPct',    lbl: 'TS%',     grp: 'Shooting', fn: r => r.tsPct != null ? r.tsPct.toFixed(1) + '%' : '—', num: r => r.tsPct },
  { id: 'efg',      lbl: 'eFG%',    grp: 'Shooting', fn: r => r.efg != null ? r.efg.toFixed(1) + '%' : '—', num: r => r.efg },
  { id: 'fg2Pct',   lbl: '2P%',     grp: 'Shooting', fn: r => r.fg2Pct != null ? r.fg2Pct.toFixed(1) + '%' : '—', num: r => r.fg2Pct },
  { id: 'fg3Pct',   lbl: '3P%',     grp: 'Shooting', fn: r => r.fg3Pct != null ? r.fg3Pct.toFixed(1) + '%' : '—', num: r => r.fg3Pct },
  { id: 'threePar', lbl: '3PAr',    grp: 'Shooting', fn: r => r.threePar != null ? r.threePar.toFixed(1) + '%' : '—', num: r => r.threePar },
  { id: 'ftr',      lbl: 'FTr',     grp: 'Shooting', fn: r => r.ftr != null ? r.ftr.toFixed(1) + '%' : '—', num: r => r.ftr },
  { id: 'tovPct',   lbl: 'TOV%',    grp: 'Shooting', fn: r => r.tovPct != null ? r.tovPct.toFixed(1) + '%' : '—', num: r => r.tovPct },
  { id: 'usg',      lbl: 'USG%',    grp: 'Impact',   fn: r => r.usg != null ? r.usg.toFixed(1) + '%' : '—', num: r => r.usg },
  { id: 'ortg',     lbl: 'ORtg',    grp: 'Impact',   fn: r => r.ortg != null ? r.ortg.toFixed(1) : '—', num: r => r.ortg },
  { id: 'drtg',     lbl: 'DRtg',    grp: 'Impact',   fn: r => r.drtg != null ? r.drtg.toFixed(1) : '—', num: r => r.drtg },
  { id: 'netRtg',   lbl: 'NET',     grp: 'Impact',   fn: r => r.netRtg != null ? ((r.netRtg >= 0 ? '+' : '') + r.netRtg.toFixed(1)) : '—', num: r => r.netRtg, signed: true },
  { id: 'onOff',    lbl: 'ON/OFF',  grp: 'Impact',   fn: r => r.onOff != null ? ((r.onOff >= 0 ? '+' : '') + r.onOff.toFixed(1)) : '—', num: r => r.onOff, signed: true },
  { id: 'dre',      lbl: 'DRE',     grp: 'Impact',   fn: r => r.dre != null ? ((r.dre >= 0 ? '+' : '') + r.dre.toFixed(1)) : '—', num: r => r.dre, signed: true },
  { id: 'age',      lbl: 'AGE',     grp: 'Bio',      fn: r => r.age != null ? Number(r.age).toFixed(1) : '—', num: r => r.age },
  { id: 'height',   lbl: 'HT',      grp: 'Bio',      fn: r => r.height || '—', num: r => r.heightIn },
  { id: 'weight',   lbl: 'WT',      grp: 'Bio',      fn: r => r.weight != null ? Math.round(r.weight) : '—', num: r => r.weight }
];

const PS_PRESETS = {
  overall: ['gp', 'mpg', 'pts75', 'tsPct', 'usg', 'netRtg', 'onOff', 'dre'],
  offense: ['mpg', 'pts75', 'tsPct', 'efg', 'fg2Pct', 'fg3Pct', 'threePar', 'ftr', 'ast75', 'tovPct', 'ortg'],
  defense: ['mpg', 'reb75', 'stl75', 'blk75', 'drtg', 'onOff', 'height', 'weight']
};

let _psSelectedCols = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('capitanes_ps_cols') || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) {}
  return PS_PRESETS.overall.slice();
})();
let _psPickerOpen = false;
let _psQueryOpen = false;
let _psScope = 'MXC';
let _psConditions = new Array({ metric: 'tsPct', op: '>=', val: '' });
let _psActiveConditions = new Array();
let _psSortCol = 'mpg';
let _psSortDir = -1;

function togglePsPicker() { _psPickerOpen = !_psPickerOpen; if (_psPickerOpen) _psQueryOpen = false; renderPsTab(); }
function togglePsQuery()  { _psQueryOpen = !_psQueryOpen;   if (_psQueryOpen) _psPickerOpen = false; renderPsTab(); }
function setPsScope(sc)   { _psScope = sc; renderPsTab(); }
function addPsCondition() { _psConditions.push({ metric: 'mpg', op: '>=', val: '' }); renderPsTab(); }
function removePsCondition(i) {
  _psConditions.splice(i, 1);
  if (!_psConditions.length) _psConditions.push({ metric: 'tsPct', op: '>=', val: '' });
  renderPsTab();
}
function updatePsCondition(i, key, value) { if (_psConditions[i]) _psConditions[i][key] = value; }
function runPsQuery() {
  _psActiveConditions = _psConditions
    .filter(c => c.val !== '' && !Number.isNaN(Number(c.val)))
    .map(c => ({ metric: c.metric, op: c.op, val: Number(c.val) }));
  _psActiveConditions.forEach(c => { if (!_psSelectedCols.includes(c.metric)) _psSelectedCols.push(c.metric); });
  renderPsTab();
}
function clearPsQuery() {
  _psConditions = new Array({ metric: 'tsPct', op: '>=', val: '' });
  _psActiveConditions = new Array();
  renderPsTab();
}
function togglePsCol(id) {
  const idx = _psSelectedCols.indexOf(id);
  if (idx >= 0) { if (_psSelectedCols.length > 1) _psSelectedCols.splice(idx, 1); }
  else { _psSelectedCols.push(id); }
  try { localStorage.setItem('capitanes_ps_cols', JSON.stringify(_psSelectedCols)); } catch (e) {}
  renderPsTab();
}
function sortPsBy(colId) {
  if (_psSortCol === colId) _psSortDir *= -1;
  else { _psSortCol = colId; _psSortDir = colId === 'nm' ? 1 : -1; }
  renderPsTab();
}

async function renderPsTab() {
  const container = document.getElementById('psContent');
  if (!container) return;
  try {
    const lite = await fetch('data/league_lite_shots_' + SEASON + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    const allTeams = lite?.teams || new Array();
    const targetTeams = _psScope === 'ALL'
      ? allTeams
      : allTeams.filter(t => String(t.id) === '1612709931' || String(t.abbrev || '').toUpperCase() === 'MXC');

    const rawPlayers = new Array();
    targetTeams.forEach(tm => {
      const ab = String(tm.abbrev || '').toUpperCase();
      (tm.rosterStats || new Array()).forEach(rp => rawPlayers.push({ ...rp, _tm: ab }));
    });

    let rows = rawPlayers.map(rp => {
      const gp = Number(rp.gp ?? 0), min = Number(rp.min ?? 0);
      const mpg = rp.mpg != null ? Number(rp.mpg) : (gp > 0 ? min / gp : 0);
      const poss = Number(rp.poss ?? 0), pts = Number(rp.pts ?? 0);
      const fga = Number(rp.fga ?? 0), fgm = Number(rp.fgm ?? 0), fg3m = Number(rp.fg3m ?? 0), fta = Number(rp.fta ?? 0);
      const reb = Number(rp.reb ?? 0), ast = Number(rp.ast ?? 0), stl = Number(rp.stl ?? 0), blk = Number(rp.blk ?? 0), tov = Number(rp.tov ?? 0);
      const efg = fga > 0 ? ((fgm + 0.5 * fg3m) / fga) * 100 : null;
      const tovPct = (fga + 0.44 * fta + tov) > 0 ? (tov / (fga + 0.44 * fta + tov)) * 100 : null;
      const dre = poss > 0 ? (100 / poss) * (0.792 * pts - 0.719 * fga - 0.299 * fta + 0.145 * reb + 0.369 * ast + 1.662 * stl + 0.696 * blk - 0.844 * tov) : null;
      return {
        nm: rp.name || '', tm: rp._tm || rp.team || '', gp, min, mpg, poss, efg, tovPct, dre,
        pts75: rp.pts75 != null ? Number(rp.pts75) : null, reb75: rp.reb75 != null ? Number(rp.reb75) : null,
        ast75: rp.ast75 != null ? Number(rp.ast75) : null, tov75: rp.tov75 != null ? Number(rp.tov75) : null,
        stl75: rp.stl75 != null ? Number(rp.stl75) : null, blk75: rp.blk75 != null ? Number(rp.blk75) : null,
        tsPct: rp.tsPct != null ? Number(rp.tsPct) : null, fg2Pct: rp.fg2Pct != null ? Number(rp.fg2Pct) : null,
        fg3Pct: rp.fg3Pct != null ? Number(rp.fg3Pct) : null, threePar: rp.threePar != null ? Number(rp.threePar) : null,
        ftr: rp.ftr != null ? Number(rp.ftr) : null, usg: rp.usg != null ? Number(rp.usg) : null,
        ortg: rp.ortg != null ? Number(rp.ortg) : null, drtg: rp.drtg != null ? Number(rp.drtg) : null,
        netRtg: rp.netRtg != null ? Number(rp.netRtg) : null, onOff: rp.onOff != null ? Number(rp.onOff) : null,
        age: rp.age != null ? Number(rp.age) : null, height: rp.height || null,
        heightIn: rp.heightIn != null ? Number(rp.heightIn) : null, weight: rp.weight != null ? Number(rp.weight) : null
      };
    });

    if (_psActiveConditions.length) {
      rows = rows.filter(r => _psActiveConditions.every(c => {
        const def = PS_METRIC_DEFS.find(m => m.id === c.metric);
        const v = def ? def.num(r) : null;
        if (v == null || Number.isNaN(v)) return false;
        if (c.op === '>=') return v >= c.val;
        if (c.op === '<=') return v <= c.val;
        if (c.op === '>')  return v > c.val;
        if (c.op === '<')  return v < c.val;
        return Math.abs(v - c.val) < 1e-6;
      }));
    }

    const activeDefs = _psSelectedCols.map(id => PS_METRIC_DEFS.find(m => m.id === id)).filter(Boolean);
    const sortDef = PS_METRIC_DEFS.find(m => m.id === _psSortCol);
    rows.sort((a, b) => {
      if (_psSortCol === 'nm') return a.nm.localeCompare(b.nm) * _psSortDir;
      const va = sortDef ? sortDef.num(a) : a.mpg, vb = sortDef ? sortDef.num(b) : b.mpg;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * _psSortDir;
    });

    const qBadge = _psActiveConditions.length ? ` (${_psActiveConditions.length})` : '';
    const toolbarHtml = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:4px;gap:5px;">
      <div style="display:flex;align-items:center;gap:4px;">
        <button onclick="setPsScope('MXC')" style="font-family:'Oswald',sans-serif;font-size:9.5px;font-weight:700;padding:1px 7px;background:${_psScope === 'MXC' ? 'var(--blue)' : '#fff'};color:${_psScope === 'MXC' ? '#fff' : 'var(--dim)'};border:1px solid #000;cursor:pointer;">MXC Only</button>
        <button onclick="setPsScope('ALL')" style="font-family:'Oswald',sans-serif;font-size:9.5px;font-weight:700;padding:1px 7px;background:${_psScope === 'ALL' ? 'var(--blue)' : '#fff'};color:${_psScope === 'ALL' ? '#fff' : 'var(--dim)'};border:1px solid #000;cursor:pointer;">All G League (${rows.length})</button>
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        <button onclick="togglePsQuery()" style="font-family:'Oswald',sans-serif;font-size:9.5px;font-weight:700;padding:1px 8px;background:${_psQueryOpen || _psActiveConditions.length ? 'var(--blue)' : '#fff'};color:${_psQueryOpen || _psActiveConditions.length ? '#fff' : 'var(--blue)'};border:1.5px solid #000;cursor:pointer;">+ Query Players${qBadge}</button>
        <button onclick="togglePsPicker()" style="font-family:'Oswald',sans-serif;font-size:9.5px;font-weight:700;padding:1px 8px;background:${_psPickerOpen ? 'var(--blue)' : '#fff'};color:${_psPickerOpen ? '#fff' : 'var(--blue)'};border:1.5px solid #000;cursor:pointer;">${_psPickerOpen ? 'Done Metrics' : '+ Select Metrics'}</button>
      </div>
    </div>`;

    let queryHtml = '';
    if (_psQueryOpen) {
      const condRows = _psConditions.map((c, idxC) => {
        const opts = PS_METRIC_DEFS.map(m => `<option value="${m.id}" ${c.metric === m.id ? 'selected' : ''}>${m.lbl}</option>`).join('');
        const ops = ['>=', '<=', '>', '<', '='].map(op => `<option value="${op}" ${c.op === op ? 'selected' : ''}>${op}</option>`).join('');
        return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
          <select onchange="updatePsCondition(${idxC},'metric',this.value)" style="font-family:'Lora',serif;font-size:10px;padding:2px 4px;border:1px solid var(--border);background:#fff;">${opts}</select>
          <select onchange="updatePsCondition(${idxC},'op',this.value)" style="font-family:'Lora',serif;font-size:10px;padding:2px 4px;border:1px solid var(--border);background:#fff;">${ops}</select>
          <input type="number" step="any" value="${esc(String(c.val))}" placeholder="Value" oninput="updatePsCondition(${idxC},'val',this.value)" onkeydown="if(event.key==='Enter')runPsQuery()" style="width:68px;font-family:'Lora',serif;font-size:10px;padding:2px 5px;border:1px solid var(--border);background:#fff;">
          <button onclick="removePsCondition(${idxC})" style="font-family:'Oswald',sans-serif;font-size:10px;padding:1px 6px;background:#fff;color:var(--red);border:1px solid var(--border);cursor:pointer;">×</button>
        </div>`;
      }).join('');
      queryHtml = `<div style="background:var(--surface);border:1px solid var(--border);padding:6px 7px;margin-bottom:5px;">
        ${condRows}
        <div style="display:flex;align-items:center;gap:5px;margin-top:4px;">
          <button onclick="addPsCondition()" style="font-family:'Oswald',sans-serif;font-size:9.5px;font-weight:700;padding:2px 8px;background:#fff;color:var(--text);border:1px solid #000;cursor:pointer;">+ Add Condition (AND)</button>
          <button onclick="runPsQuery()" style="font-family:'Oswald',sans-serif;font-size:9.5px;font-weight:700;padding:2px 10px;background:var(--blue);color:#fff;border:none;cursor:pointer;">Search</button>
          <button onclick="clearPsQuery()" style="font-family:'Oswald',sans-serif;font-size:9.5px;font-weight:700;padding:2px 8px;background:#fff;color:var(--muted);border:1px solid var(--border);cursor:pointer;">Clear</button>
        </div>
      </div>`;
    }

    let pickerHtml = '';
    if (_psPickerOpen) {
      const groups = ['Volume', 'Per-75', 'Shooting', 'Impact', 'Bio'];
      pickerHtml = `<div style="background:var(--surface);border:1px solid var(--border);padding:5px 6px;margin-bottom:5px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;font-size:9.5px;">` +
        groups.map(g => {
          const items = PS_METRIC_DEFS.filter(m => m.grp === g).map(m => `<label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-family:'Lora',serif;color:var(--text);"><input type="checkbox" ${_psSelectedCols.includes(m.id) ? 'checked' : ''} onchange="togglePsCol('${m.id}')" style="margin:0;">${m.lbl}</label>`).join('');
          return `<div><div style="font-family:'Oswald',sans-serif;font-weight:700;color:var(--blue);font-size:9.5px;margin-bottom:2px;">${g.toUpperCase()}</div>${items}</div>`;
        }).join('') + `</div>`;
    }

    if (!rows.length) { container.innerHTML = toolbarHtml + queryHtml + pickerHtml + '<div style="color:var(--muted);font-size:11px;padding:6px 0;">No players match your query conditions.</div>'; return; }

    const showRows = _psScope === 'ALL' ? rows.slice(0, 60) : rows;
    const thPlayer = `<th onclick="sortPsBy('nm')" style="text-align:left;padding:3px 4px;border-bottom:1.5px solid var(--border);font-family:'Oswald',sans-serif;font-size:10px;color:${_psSortCol === 'nm' ? 'var(--blue)' : 'var(--muted)'};cursor:pointer;white-space:nowrap;">Player${_psSortCol === 'nm' ? (_psSortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const thRest = activeDefs.map(m => `<th onclick="sortPsBy('${m.id}')" style="text-align:right;padding:3px 4px;border-bottom:1.5px solid var(--border);font-family:'Oswald',sans-serif;font-size:10px;color:${_psSortCol === m.id ? 'var(--blue)' : 'var(--muted)'};cursor:pointer;white-space:nowrap;">${m.lbl}${_psSortCol === m.id ? (_psSortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const tbHtml = showRows.map(r => {
      const tmTag = _psScope === 'ALL' && r.tm ? ` <span style="font-size:9px;color:var(--muted);font-weight:400;">(${esc(r.tm)})</span>` : '';
      const tds = activeDefs.map(m => {
        const val = m.fn(r);
        const colStyle = m.signed && typeof val === 'string' && (val.startsWith('+') || val.startsWith('-')) ? (val.startsWith('+') ? 'color:var(--green);font-weight:700;' : 'color:var(--red);font-weight:700;') : 'color:var(--dim);';
        return `<td style="text-align:right;padding:3px 4px;border-bottom:1px solid var(--border);font-family:'Lora',serif;font-size:10.5px;white-space:nowrap;${colStyle}">${val}</td>`;
      }).join('');
      return `<tr><td style="text-align:left;padding:3px 4px;border-bottom:1px solid var(--border);font-family:'Lora',serif;font-size:10.5px;font-weight:700;color:var(--text);white-space:nowrap;">${esc(r.nm)}${tmTag}</td>${tds}</tr>`;
    }).join('');

    container.innerHTML = toolbarHtml + queryHtml + pickerHtml + `<div style="overflow-x:auto;max-height:360px;overflow-y:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>${thPlayer}${thRest}</tr></thead><tbody>${tbHtml}</tbody></table></div>`;
  } catch (e) {
    container.innerHTML = '<div style="color:var(--muted);font-size:11px;">Player stats unavailable.</div>';
  }
}



// Deferred startup calls that depend on functions declared later in the script
renderBap();
renderPsTab();
initWowySlots();
  renderLastGameRecap();
  renderInlineShotCharts();
renderLastGameRecap();
renderInlineShotCharts();

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

// â”€â”€ Last Game Recap & Inline Shot Charts (Row 1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ── Last Game Recap & Future Game Preview (with ◄ / ► Arrows) ────────────────
let _inlineScSpan = 'full';

const GL_LOGO_ID = {
  MXC: 1612709931, AUS: 1612709913, BIR: 1612709930, CCG: 1612709928, CLC: 1612709921,
  CPS: 1612709929, DEL: 1612709923, GRG: 1612709917, GBO: 1612709922, IWA: 1612709911,
  LIN: 1612709924, MNE: 1612709915, MCC: 1612709932, MOT: 1612709933, NOB: 1612709934,
  OKL: 1612709914, OSC: 1612709925, RGV: 1612709908, RAP: 1612709926, RCR: 1612709935,
  SLC: 1612709903, SCW: 1612709902, SBL: 1612709905, SXF: 1612709904, STK: 1612709910,
  TEX: 1612709918, VAL: 1612709936, WES: 1612709919, WCB: 1612709927, WIS: 1612709920,
  LONG: 1612709924, CAP: 1612709928, MEM: 1612709926
};

function glLogoUrl(ab) {
  const code = String(ab || '').toUpperCase();
  const tid = GL_LOGO_ID[code];
  return tid ? new Array('https:/', '://nba.com', 'logos', 'gleague', tid, 'global', 'L', 'logo.svg').join('/') : '';
}

function setInlineScSpan(span, btn) {
  _inlineScSpan = span;
  document.querySelectorAll('.isc-span').forEach(b => {
    const act = b.dataset.span === span;
    b.style.background = act ? 'var(--blue)' : '#fff';
    b.style.color = act ? '#fff' : 'var(--text)';
  });
  renderInlineShotCharts();
}

async function renderLastGameRecap() {
  const el = document.getElementById('lastGameRecapContent');
  if (!el) return;
  try {
    const [sc, idx, ld, sched, lite] = await Promise.all([
      fetch('data/shot_charts_' + SEASON + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null),
      fetch('data/players_index.json?v=' + Date.now()).then(r => r.ok ? r.json() : new Array()).catch(() => new Array()),
      (window._wowyLineupData ? Promise.resolve(window._wowyLineupData) : fetch(LINEUP_DATA_PATH() + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null)),
      fetch('data/schedule_' + SEASON + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('data/league_lite_shots_' + SEASON + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    if (!cachedTeamStats) {
      const rTs = await fetch(TEAM_STATS_PATH() + '?v=' + Date.now()).catch(() => null);
      if (rTs && rTs.ok) cachedTeamStats = await rTs.json();
    }

    const playedList = (sc && Array.isArray(sc.games) ? sc.games : new Array()).map((gm, i) => ({ ...gm, _played: true, _pIdx: i }));
    const playedIds = new Set(playedList.map(gm => String(gm.id || gm.gid)));
    const rawSched = Array.isArray(sched) ? sched : (sched?.games || sched?.upcoming || new Array());
    const futureList = rawSched
      .filter(ug => !playedIds.has(String(ug.id || ug.gid || '')) && (ug.future || ug.upcoming || !ug.wl))
      .map(ug => ({ ...ug, _played: false }));
    const allGames = new Array(...futureList, ...playedList);

    if (!allGames.length) {
      el.innerHTML = '';
      el.textContent = 'No game data available yet.';
      return;
    }

    if (window._recapSeason !== SEASON) {
      window._recapSeason = SEASON;
      window._recapIdx = futureList.length < allGames.length ? futureList.length : 0;
    }
    const curIdx = Math.max(0, Math.min(allGames.length - 1, Number(window._recapIdx ?? 0)));
    window._recapIdx = curIdx;
    const g = allGames.at(curIdx);

    const normN = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,'’\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');
    const pPhoto = {};
    const regP = (k, u) => {
      if (!k || !u) return;
      pPhoto[String(k).toLowerCase()] = u;
      pPhoto[normN(k)] = u;
      const pts = normN(k).split(' ');
      if (pts.length >= 2) pPhoto[pts.at(0).at(0) + '_' + pts.at(-1)] = u;
    };
    Object.entries(ld?.playerXref || {}).forEach(([ab, info]) => { if (info?.photoUrl) { regP(ab, info.photoUrl); regP(info.name, info.photoUrl); } });
    (Array.isArray(idx) ? idx : Object.values(idx || {})).forEach(p => { if (p?.name && p?.photoUrl) regP(p.name, p.photoUrl); });
    (lite?.teams || new Array()).forEach(tm => {
      (tm.rosterStats || new Array()).forEach(rp => {
        if (rp?.id && rp?.name && !pPhoto[normN(rp.name)]) {
          regP(rp.name, 'https://nba.com' + rp.id + '.png');
        }
      });
    });

    const getPhoto = (nm) => {
      const c = normN(nm), pts = c.split(' ');
      return pPhoto[String(nm || '').toLowerCase()] || pPhoto[c] || (pts.length >= 2 ? pPhoto[pts.at(0).at(0) + '_' + pts.at(-1)] : null);
    };

    const h = (tag, css, ...kids) => {
      const node = document.createElement(tag);
      if (css) node.style.cssText = css;
      kids.flat().forEach(k => {
        if (k == null || k === false) return;
        node.appendChild((typeof k === 'string' || typeof k === 'number') ? document.createTextNode(String(k)) : k);
      });
      return node;
    };

    const avatarNode = (fullNm, size = 24) => {
      const u = getPhoto(fullNm);
      const last = String(fullNm || '').replace(/,\s*(jr|sr|ii|iii|iv|v)\.?$/i, '').split(' ').pop();
      const wrap = h('div', 'text-align:center;min-width:0;');
      if (u) {
        const img = h('img', 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;object-position:top;border:1.5px solid var(--border);display:block;margin:0 auto;');
        img.src = u;
        img.referrerPolicy = 'no-referrer';
        img.onerror = function() { this.style.display = 'none'; };
        wrap.appendChild(img);
      } else {
        wrap.appendChild(h('div', 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:#ddd;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;margin:0 auto;', last.slice(0, 2)));
      }
      wrap.appendChild(h('div', 'font-size:8px;color:var(--muted);line-height:1.1;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', last));
      return wrap;
    };

    const dreLinkNode = () => {
      const a = h('a', 'color:var(--blue);text-decoration:underline;', 'DRE');
      a.href = 'https://fansided.com';
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = 'Daily RAPM Estimate (Kevin Ferrigan, Nylon Calculus) — empirical box-score regression estimating per-100-possession RAPM impact';
      return a;
    };

    const logoNode = (ab) => {
      const u = glLogoUrl(ab);
      if (!u) return h('div', 'font-family:Oswald,sans-serif;font-weight:700;font-size:13px;color:var(--muted);', ab);
      const img = h('img', 'width:38px;height:38px;object-fit:contain;display:block;margin:0 auto;');
      img.src = u;
      img.title = ab;
      img.onerror = function() { this.replaceWith(h('div', 'font-family:Oswald,sans-serif;font-weight:700;font-size:13px;color:var(--muted);', ab)); };
      return img;
    };

    const buildDuoCard = (title, dObj, isGood) => {
      if (!dObj) return h('div', '');
      const col = isGood ? 'var(--green)' : 'var(--red)';
      return h('div', 'background:#f8fafc;border:1px solid var(--border);padding:3px 5px;min-width:0;',
        h('div', 'display:flex;justify-content:space-between;align-items:baseline;font-size:8.5px;margin-bottom:2px;gap:2px;',
          h('span', 'font-weight:700;color:#000;white-space:nowrap;', title + ' ', h('span', 'color:var(--muted);font-weight:400;', '(' + dObj.poss + 'p)')),
          h('span', 'font-weight:700;color:' + col + ';white-space:nowrap;', (dObj.net >= 0 ? '+' : '') + dObj.net.toFixed(1))
        ),
        h('div', 'display:grid;grid-template-columns:repeat(2,1fr);gap:2px;', ...dObj.avatars)
      );
    };

    const buildDreCard = (labelPrefix, obj, isGood) => {
      if (!obj) return null;
      const col = isGood ? 'var(--green)' : 'var(--red)';
      return h('div', 'display:flex;align-items:center;gap:5px;background:#f8fafc;padding:3px 4px;border:1px solid var(--border);min-width:0;',
        avatarNode(obj.name, 26),
        h('div', 'font-size:9px;line-height:1.2;min-width:0;',
          h('div', 'font-weight:700;', labelPrefix + ' ', dreLinkNode()),
          h('div', 'color:' + col + ';font-weight:700;font-size:10.5px;', (obj.dre >= 0 ? '+' : '') + obj.dre.toFixed(1)),
          h('div', 'color:var(--muted);', obj.poss + ' poss')
        )
      );
    };

    const renderOutliersBox = (titleTxt, items) => {
      if (!items || !items.length) return null;
      const wrap = h('div', 'margin-top:5px;padding-top:4px;border-top:1px solid var(--border);');
      wrap.appendChild(h('div', 'font-family:Oswald,sans-serif;font-size:10px;font-weight:700;color:var(--blue);letter-spacing:0.3px;margin-bottom:3px;text-align:center;', titleTxt));
      items.slice(0, 2).forEach(it => {
        const bg = it.tone === 'pos' ? '#f0fdf4' : (it.tone === 'neg' ? '#fef2f2' : '#eff6ff');
        const bdr = it.tone === 'pos' ? '#86efac' : (it.tone === 'neg' ? '#fca5a5' : '#93c5fd');
        const tagCol = it.tone === 'pos' ? 'var(--green)' : (it.tone === 'neg' ? 'var(--red)' : 'var(--blue)');
        wrap.appendChild(h('div', 'background:' + bg + ';border:1px solid ' + bdr + ';padding:3px 5px;margin-bottom:3px;font-family:Lora,serif;font-size:9px;line-height:1.25;color:var(--text);',
          h('span', 'font-family:Oswald,sans-serif;font-weight:700;font-size:8.5px;color:' + tagCol + ';margin-right:4px;', '[' + it.tag + ']'),
          it.text
        ));
      });
      return wrap;
    };

    const cellBg = (pct) => pct >= 75 ? 'background:#b7ebbf;' : (pct >= 55 ? 'background:#dcfce7;' : (pct >= 45 ? 'background:#ffffff;' : (pct >= 25 ? 'background:#fee2e2;' : 'background:#f5a3a3;')));
    const snapTd = (valStr, pct) => h('td', 'padding:11px 3px 4px;border:1px solid #d4d4d4;position:relative;text-align:center;' + cellBg(pct),
      h('div', 'position:absolute;top:1px;right:2px;font-size:7.5px;line-height:1;color:#444;font-weight:600;', pct + '%'),
      h('div', 'font-size:11px;font-weight:700;color:#000;line-height:1.1;', valStr)
    );

    const navBar = h('div', 'display:flex;align-items:center;justify-content:space-between;gap:3px;margin-bottom:5px;padding-bottom:4px;border-bottom:1px solid var(--border);');
    const prevBtn = h('button', 'font-family:Oswald,sans-serif;font-size:10px;font-weight:700;padding:1px 6px;border:1px solid var(--border);background:' + (curIdx < allGames.length - 1 ? '#fff' : 'var(--surface)') + ';color:' + (curIdx < allGames.length - 1 ? 'var(--blue)' : 'var(--muted)') + ';cursor:' + (curIdx < allGames.length - 1 ? 'pointer' : 'default') + ';', '\u25C0');
    prevBtn.title = 'Older Game';
    if (curIdx < allGames.length - 1) prevBtn.onclick = () => { window._recapIdx = curIdx + 1; renderLastGameRecap(); };

    const nextBtn = h('button', 'font-family:Oswald,sans-serif;font-size:10px;font-weight:700;padding:1px 6px;border:1px solid var(--border);background:' + (curIdx > 0 ? '#fff' : 'var(--surface)') + ';color:' + (curIdx > 0 ? 'var(--blue)' : 'var(--muted)') + ';cursor:' + (curIdx > 0 ? 'pointer' : 'default') + ';', '\u25B6');
    nextBtn.title = 'Newer / Upcoming Game';
    if (curIdx > 0) nextBtn.onclick = () => { window._recapIdx = curIdx - 1; renderLastGameRecap(); };

    const gSel = h('select', 'flex:1;min-width:0;font-family:Lora,serif;font-size:9.5px;padding:1px 3px;border:1px solid var(--border);background:#fff;color:var(--text);');
    allGames.forEach((gm, idxOpt) => {
      const opt = document.createElement('option');
      opt.value = String(idxOpt);
      opt.textContent = (gm.label || ((gm.date || '') + ' vs ' + (gm.opp || 'OPP'))) + (gm._played ? '' : ' [PREVIEW]');
      if (idxOpt === curIdx) opt.selected = true;
      gSel.appendChild(opt);
    });
    gSel.onchange = () => { window._recapIdx = Number(gSel.value); renderLastGameRecap(); };
    navBar.appendChild(prevBtn);
    navBar.appendChild(gSel);
    navBar.appendChild(nextBtn);

    const thCss = 'padding:3px 4px;border:1px solid #d4d4d4;';
    el.innerHTML = '';
    el.appendChild(navBar);

    const tms = cachedTeamStats?.slices?.all || new Array();
    const lgMean = (key, fallback) => {
      const arr = tms.map(t => t[key]).filter(v => v != null);
      return arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : fallback;
    };
    const rankPct = (val, arr, lb) => {
      if (!arr.length || val == null) return 50;
      const sorted = arr.slice().sort((a, b) => lb ? (b - a) : (a - b));
      const idxR = sorted.findIndex(v => lb ? (v <= val) : (v >= val));
      const pos = idxR === -1 ? sorted.length - 1 : idxR;
      return Math.max(1, Math.min(99, Math.round((pos / Math.max(1, sorted.length - 1)) * 100)));
    };

    if (!g._played) {
      const oppU = String(g.opp || 'OPP').toUpperCase();
      const dtU = String(g.date || '');
      const locU = String(g.loc || (String(g.label || '').includes('@') ? 'Away' : 'Home'));
      const allLite = lite?.teams || new Array();
      const oppLite = allLite.find(t => String(t.abbrev || '').toUpperCase() === oppU);
      const oppTs = tms.find(t => String(t.TEAM_ABBREVIATION || '').toUpperCase() === oppU);

      if (dtU || g.time) {
        el.appendChild(h('div', 'font-size:9px;color:var(--muted);text-align:center;margin-bottom:2px;', [dtU, g.time, locU].filter(Boolean).join(' · ')));
      }
      el.appendChild(h('div', 'display:flex;align-items:center;justify-content:space-around;padding:2px 0 6px;border-bottom:1px solid var(--border);margin-bottom:5px;',
        logoNode('MXC'),
        h('div', 'font-family:Oswald,sans-serif;font-weight:700;font-size:18px;color:var(--blue);', locU === 'Away' ? '@' : 'VS'),
        logoNode(oppU)
      ));

      // 1. Opposing Team's 8 Factors
      const oEfg = oppTs?.EFG_PCT != null ? Number(oppTs.EFG_PCT) : ((oppLite?.offStats?.tsPct || 56) / 105);
      const oTov = oppTs?.TM_TOV_PCT != null ? Number(oppTs.TM_TOV_PCT) : ((oppLite?.offStats?.tovPct || 15.5) / 100);
      const oOrb = oppTs?.OREB_PCT != null ? Number(oppTs.OREB_PCT) : 0.285;
      const oFtr = oppLite?.offStats?.ftr != null ? (Number(oppLite.offStats.ftr) / 100) : 0.265;

      const dEfg = oppTs?.OPP_EFG_PCT != null ? Number(oppTs.OPP_EFG_PCT) : ((oppLite?.defStats?.tsPct || 56) / 105);
      const dTov = oppTs?.OPP_TOV_PCT != null ? Number(oppTs.OPP_TOV_PCT) : ((oppLite?.defStats?.tovPct || 15.5) / 100);
      const dOrb = oppTs?.DREB_PCT != null ? (1 - Number(oppTs.DREB_PCT)) : 0.285;
      const dFtr = oppLite?.defStats?.ftr != null ? (Number(oppLite.defStats.ftr) / 100) : 0.265;

      const offCells = new Array(
        snapTd((oEfg * 100).toFixed(1) + '%', rankPct(oEfg, tms.map(t => t.EFG_PCT).filter(v => v != null), false)),
        snapTd((oTov * 100).toFixed(1) + '%', rankPct(oTov, tms.map(t => t.TM_TOV_PCT).filter(v => v != null), true)),
        snapTd((oOrb * 100).toFixed(1) + '%', rankPct(oOrb, tms.map(t => t.OREB_PCT).filter(v => v != null), false)),
        snapTd((oFtr * 100).toFixed(1) + '%', rankPct(oFtr * 100, allLite.map(t => t.offStats?.ftr).filter(v => v != null), false))
      );
      const defCells = new Array(
        snapTd((dEfg * 100).toFixed(1) + '%', rankPct(dEfg, tms.map(t => t.OPP_EFG_PCT).filter(v => v != null), true)),
        snapTd((dTov * 100).toFixed(1) + '%', rankPct(dTov, tms.map(t => t.OPP_TOV_PCT).filter(v => v != null), false)),
        snapTd((dOrb * 100).toFixed(1) + '%', rankPct(dOrb, tms.map(t => t.DREB_PCT != null ? (1 - t.DREB_PCT) : null).filter(v => v != null), true)),
        snapTd((dFtr * 100).toFixed(1) + '%', rankPct(dFtr * 100, allLite.map(t => t.defStats?.ftr).filter(v => v != null), true))
      );

      el.appendChild(h('div', 'font-family:Oswald,sans-serif;font-size:11px;font-weight:700;text-align:center;color:#000;margin-bottom:3px;', oppU + ' Eight Factors Snapshot'));
      el.appendChild(h('table', 'width:100%;border-collapse:collapse;margin-bottom:4px;',
        h('thead', '', h('tr', 'background:#f1f5f9;font-family:Oswald,sans-serif;font-size:9.5px;color:#000;',
          h('th', thCss, ''), h('th', thCss, 'EFG%'), h('th', thCss, 'TOV%'), h('th', thCss, 'OR%'), h('th', thCss, 'FTR%')
        )),
        h('tbody', '',
          h('tr', '', h('td', 'padding:4px 5px;border:1px solid #d4d4d4;font-weight:700;font-size:10px;text-align:center;', oppU + ' Off'), ...offCells),
          h('tr', '', h('td', 'padding:4px 5px;border:1px solid #d4d4d4;font-weight:700;font-size:10px;text-align:center;', oppU + ' Def'), ...defCells)
        )
      ));

      // 2. Opposing Team's Best & Worst Duos
      const oppDuos = (oppLite?.lineups?.duos || new Array())
        .filter(d => Number(d.poss || 0) >= 25)
        .map(d => ({
          poss: Number(d.poss || 0),
          net: Number(d.netRtg || 0),
          avatars: String(d.players || '').split(' - ').map(nm => avatarNode(nm.trim(), 24))
        }))
        .sort((a, b) => b.net - a.net);

      if (oppDuos.length) {
        el.appendChild(h('div', 'margin-top:4px;padding-top:4px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:4px;',
          buildDuoCard('Best Duo', oppDuos.at(0), true),
          buildDuoCard('Worst Duo', oppDuos.length > 1 ? oppDuos.at(-1) : null, false)
        ));
      }

      // 3. Opposing Team's High & Low DRE Players
      const oppDres = (oppLite?.rosterStats || new Array())
        .filter(p => Number(p.poss || 0) >= 35)
        .map(p => {
          const poss = Number(p.poss || 1);
          const dre = (100 / poss) * (0.792 * Number(p.pts || 0) - 0.719 * Number(p.fga || 0) - 0.299 * Number(p.fta || 0) + 0.145 * Number(p.reb || 0) + 0.369 * Number(p.ast || 0) + 1.662 * Number(p.stl || 0) + 0.696 * Number(p.blk || 0) - 0.844 * Number(p.tov || 0));
          return { name: p.name, dre, poss: Math.round(poss) };
        })
        .sort((a, b) => b.dre - a.dre);

      if (oppDres.length) {
        el.appendChild(h('div', 'margin-top:5px;padding-top:4px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:4px;',
          buildDreCard('High', oppDres.at(0), true),
          oppDres.length > 1 ? buildDreCard('Low', oppDres.at(-1), false) : null
        ));
      }

      // 4. Top 2 Most Drastic League-Wide Outlier Insights for Opponent
      if (oppLite && allLite.length > 3) {
        const zInfo = (arr, val) => {
          const clean = arr.filter(v => v != null && !Number.isNaN(v));
          if (clean.length < 3 || val == null) return null;
          const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
          const sd = Math.sqrt(clean.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / clean.length) || 1;
          const sorted = clean.slice().sort((a, b) => b - a);
          const rk = sorted.findIndex(v => Math.abs(v - val) < 1e-6) + 1;
          return { z: (val - mean) / sd, mean, rk, n: clean.length };
        };
        const zoneShare = (zObj, keys) => {
          if (!zObj) return null;
          const tot = Object.values(zObj).reduce((a, pair) => a + (Array.isArray(pair) ? Number(pair.at(1) || 0) : 0), 0);
          if (!tot) return null;
          const sub = keys.reduce((a, k) => a + (Array.isArray(zObj[k]) ? Number(zObj[k].at(1) || 0) : 0), 0);
          return (sub / tot) * 100;
        };
        const rimKeys = new Array('Restricted Area');
        const midKeys = new Array('Left Baseline Mid', 'Left Elbow / Wing Mid', 'Center Mid-Range', 'Right Elbow / Wing Mid', 'Right Baseline Mid');

        const cands = new Array(
          { lbl: 'Offensive TS%', val: oppLite.offStats?.tsPct, pool: allLite.map(t => t.offStats?.tsPct), goodHigh: true, fmt: v => v.toFixed(1) + '%' },
          { lbl: 'Defensive TS% Allowed', val: oppLite.defStats?.tsPct, pool: allLite.map(t => t.defStats?.tsPct), goodHigh: false, fmt: v => v.toFixed(1) + '%' },
{ lbl: '3PT Attempt Rate', val: oppLite.offStats?.threePar, pool: allLite.map(t => t.offStats?.threePar), style: true, fmt: v => v.toFixed(1) + '%' },
{ lbl: 'Opp 3PT Attempt Rate', val: oppLite.defStats?.threePar, pool: allLite.map(t => t.defStats?.threePar), style: true, fmt: v => v.toFixed(1) + '%' },
{ lbl: 'Offensive Turnover Rate', val: oppLite.offStats?.tovPct, pool: allLite.map(t => t.offStats?.tovPct), goodHigh: false, fmt: v => v.toFixed(1) + '%' },
{ lbl: 'Forced Turnover Rate', val: oppLite.defStats?.tovPct, pool: allLite.map(t => t.defStats?.tovPct), goodHigh: true, fmt: v => v.toFixed(1) + '%' },
{ lbl: 'Free Throw Rate', val: oppLite.offStats?.ftr, pool: allLite.map(t => t.offStats?.ftr), goodHigh: true, fmt: v => v.toFixed(1) + '%' },
{ lbl: 'Rim Frequency', val: zoneShare(oppLite.zones, rimKeys), pool: allLite.map(t => zoneShare(t.zones, rimKeys)), style: true, fmt: v => v.toFixed(1) + '%' },
{ lbl: 'Mid-Range Frequency', val: zoneShare(oppLite.zones, midKeys), pool: allLite.map(t => zoneShare(t.zones, midKeys)), style: true, fmt: v => v.toFixed(1) + '%' }
).map(c => {
const zi = zInfo(c.pool, c.val);
if (!zi) return null;
const tone = c.style ? 'style' : ((c.goodHigh ? zi.z >= 0 : zi.z <= 0) ? 'pos' : 'neg');
const tag = c.style ? 'STYLISTIC' : (tone === 'pos' ? 'STRENGTH' : 'WEAKNESS');
return {
absZ: Math.abs(zi.z),
tone,
tag,
text: oppU + ' ranks #' + zi.rk + '/' + zi.n + ' in ' + c.lbl + ' at ' + c.fmt(c.val) + ' (lg avg ' + c.fmt(zi.mean) + ').'
};
}).filter(Boolean).sort((a, b) => b.absZ - a.absZ);
const outBox = renderOutliersBox(oppU + ' League-Wide Outliers', cands);
if (outBox) el.appendChild(outBox);
}
return;
}
// Completed Game Recap
const gid = g.id || g.gid;
const lblStr = String(g.label || '');
const lblMatch = lblStr.match(/MXC\s+(?:vs.?|@)\s+([A-Z]{2,4})/i);
const dateMatch = lblStr.match(/^(\d{4}-\d{2}-\d{2})/);
const oppAb = (g.opp || (lblMatch ? lblMatch.at(1) : 'OPP')).toUpperCase();
const gameDate = g.date || (dateMatch ? dateMatch.at(1) : '');
const gPoss = (sc.poss || new Array()).filter(p => p.gid === gid);
const gShots = (sc.shots || new Array()).filter(s => s.gid === gid);
const gFts = (sc.fts || new Array()).filter(f => f.gid === gid);
const gTovs = (sc.turnovers || new Array()).filter(t => t.gid === gid);
const periods = Array.from(new Set(gPoss.map(p => Number(p.p || 1)))).sort((a, b) => a - b);
let mxcTot = 0, oppTot = 0;
const qCols = periods.map(pNum => {
const mPts = gShots.filter(s => Number(s.p) === pNum && s.side === 'off' && Number(s.made) === 1).reduce((a, s) => a + (Number(s.val) || 2), 0)
+ gFts.filter(f => Number(f.p) === pNum && f.side === 'off' && Number(f.made) === 1).length;
const oPts = gShots.filter(s => Number(s.p) === pNum && s.side === 'def' && Number(s.made) === 1).reduce((a, s) => a + (Number(s.val) || 2), 0)
+ gFts.filter(f => Number(f.p) === pNum && f.side === 'def' && Number(f.made) === 1).length;
mxcTot += mPts; oppTot += oPts;
return { lbl: pNum <= 4 ? ('Q' + pNum) : ('OT' + (pNum - 4)), mPts, oPts };
});
const calc4F = (side) => {
const pA = gPoss.filter(p => p.side === side);
const sA = gShots.filter(s => s.side === side);
const fA = gFts.filter(f => f.side === side);
const tA = gTovs.filter(t => t.side === side);
const fgm = sA.filter(s => Number(s.made) === 1).length;
const fg3m = sA.filter(s => Number(s.made) === 1 && Number(s.val) === 3).length;
const efg = sA.length ? (fgm + 0.5 * fg3m) / sA.length : 0;
const tov = pA.length ? tA.length / pA.length : 0;
const rebOpps = (sA.length - fgm) + fA.filter(f => Number(f.made) === 0 && /1 of 1|2 of 2|3 of 3/.test(String(f.sub || ''))).length;
const orb = rebOpps ? pA.reduce((a, p) => a + (Number(p.oreb) || 0), 0) / rebOpps : 0;
const ftr = sA.length ? fA.length / sA.length : 0;
return { efg, tov, orb, ftr, sA, fA, tA, pA, fg3m };
};
const tm4 = calc4F('off');
const op4 = calc4F('def');
const normCdfPct = (z) => {
const t = 1 / (1 + 0.2316419 * Math.abs(z));
const d = 0.3989423 * Math.exp(-z * z / 2);
const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
const cdf = z > 0 ? (1 - p) : p;
return Math.max(1, Math.min(99, Math.round(cdf * 100)));
};
const singleGamePct = (val, mean, sd, lb) => normCdfPct(lb ? -((val - mean) / sd) : ((val - mean) / sd));
const mEfg = lgMean('EFG_PCT', 0.535), mTov = lgMean('TM_TOV_PCT', 0.155), mOrb = lgMean('OREB_PCT', 0.285), mFtr = 0.265;
const tmCells = new Array(
snapTd((tm4.efg * 100).toFixed(1) + '%', singleGamePct(tm4.efg, mEfg, 0.055, false)),
snapTd((tm4.tov * 100).toFixed(1) + '%', singleGamePct(tm4.tov, mTov, 0.038, true)),
snapTd((tm4.orb * 100).toFixed(1) + '%', singleGamePct(tm4.orb, mOrb, 0.065, false)),
snapTd((tm4.ftr * 100).toFixed(1) + '%', singleGamePct(tm4.ftr, mFtr, 0.085, false))
);
const opCells = new Array(
snapTd((op4.efg * 100).toFixed(1) + '%', singleGamePct(op4.efg, mEfg, 0.055, true)),
snapTd((op4.tov * 100).toFixed(1) + '%', singleGamePct(op4.tov, mTov, 0.038, false)),
snapTd((op4.orb * 100).toFixed(1) + '%', singleGamePct(op4.orb, mOrb, 0.065, true)),
snapTd((op4.ftr * 100).toFixed(1) + '%', singleGamePct(op4.ftr, mFtr, 0.085, true))
);
const duoMap = {};
gPoss.forEach(p => {
const on = (p.on || new Array()).map(Number).sort((a, b) => a - b);
if (on.length < 2) return;
for (let i = 0; i < on.length; i++) {
for (let j = i + 1; j < on.length; j++) {
const dk = on.at(i) + '-' + on.at(j);
if (!duoMap[dk]) duoMap[dk] = { ids: new Array(on.at(i), on.at(j)), off: 0, def: 0 };
if (p.side === 'off') duoMap[dk].off++; else duoMap[dk].def++;
}
}
});
const pList = Array.isArray(sc.players) ? sc.players : Object.values(sc.players || {});
const idFull = {}; pList.forEach(p => { idFull[Number(p.id)] = p.name || String(p.id); });
const allDuos = Object.values(duoMap).map(d => ({ ...d, totPoss: Math.round((d.off + d.def) / 2) }));
const minDuoPoss = new Array(45, 38, 32, 26).find(t => allDuos.filter(d => d.totPoss >= t).length >= 2) || 24;
const duoScores = allDuos
.filter(d => d.totPoss >= minDuoPoss)
.map(d => {
const hasAll = (arr) => d.ids.every(id => (arr || new Array()).map(Number).includes(id));
const ptsFor = gShots.filter(s => s.side === 'off' && Number(s.made) === 1 && hasAll(s.on)).reduce((a, s) => a + (Number(s.val) || 2), 0)
+ gFts.filter(f => f.side === 'off' && Number(f.made) === 1 && hasAll(f.on)).length;
const ptsAg = gShots.filter(s => s.side === 'def' && Number(s.made) === 1 && hasAll(s.on)).reduce((a, s) => a + (Number(s.val) || 2), 0)
+ gFts.filter(f => f.side === 'def' && Number(f.made) === 1 && hasAll(f.on)).length;
const net = (ptsFor / Math.max(1, d.off) * 100) - (ptsAg / Math.max(1, d.def) * 100);
return { poss: d.totPoss, net, avatars: d.ids.map(id => avatarNode(idFull[id] || id, 24)) };
}).sort((a, b) => b.net - a.net);
const pDres = pList.map(pe => {
const pid = Number(pe.id);
const pOff = gPoss.filter(p => p.side === 'off' && (p.on || new Array()).map(Number).includes(pid)).length;
const pDef = gPoss.filter(p => p.side === 'def' && (p.on || new Array()).map(Number).includes(pid)).length;
const poss = Math.round((pOff + pDef) / 2);
if (poss < 30) return null;
const sh = gShots.filter(s => s.side === 'off' && Number(s.pid) === pid);
const ft = gFts.filter(f => f.side === 'off' && Number(f.pid) === pid);
const tv = gTovs.filter(t => t.side === 'off' && Number(t.pid) === pid).length;
const st = gTovs.filter(t => t.side === 'def' && Number(t.spid) === pid).length;
const pts = sh.filter(s => Number(s.made) === 1).reduce((a, s) => a + (Number(s.val) || 2), 0) + ft.filter(f => Number(f.made) === 1).length;
const dre = (100 / poss) * (0.792 * pts - 0.719 * sh.length - 0.299 * ft.length + 1.662 * st - 0.844 * tv);
return { name: pe.name, dre, poss };
}).filter(Boolean).sort((a, b) => b.dre - a.dre);
if (gameDate) el.appendChild(h('div', 'font-size:9px;color:var(--muted);text-align:center;margin-bottom:2px;', gameDate));
el.appendChild(h('div', 'display:flex;align-items:center;justify-content:space-around;padding:2px 0 6px;border-bottom:1px solid var(--border);margin-bottom:5px;',
logoNode('MXC'),
h('div', 'font-family:Oswald,sans-serif;font-weight:700;font-size:22px;color:#000;', mxcTot + ' – ' + oppTot),
logoNode(oppAb)
));
el.appendChild(h('table', 'width:100%;border-collapse:collapse;font-size:9.5px;text-align:right;margin-bottom:6px;',
h('thead', '', h('tr', 'border-bottom:1px solid var(--border);color:var(--muted);',
h('th', 'text-align:left;', 'QTR'), ...qCols.map(q => h('th', '', q.lbl)), h('th', '', 'TOT')
)),
h('tbody', '',
h('tr', '', h('td', 'text-align:left;font-weight:700;color:var(--blue);', 'MXC'), ...qCols.map(q => h('td', '', q.mPts)), h('td', 'font-weight:700;', mxcTot)),
h('tr', 'border-bottom:1px solid var(--border);', h('td', 'text-align:left;font-weight:700;', oppAb), ...qCols.map(q => h('td', '', q.oPts)), h('td', 'font-weight:700;', oppTot))
)
));
el.appendChild(h('div', 'font-family:Oswald,sans-serif;font-size:11px;font-weight:700;text-align:center;color:#000;margin-bottom:3px;', 'Four Factors Team Snapshot'));
el.appendChild(h('table', 'width:100%;border-collapse:collapse;margin-bottom:4px;',
h('thead', '', h('tr', 'background:#f1f5f9;font-family:Oswald,sans-serif;font-size:9.5px;color:#000;',
h('th', thCss, ''), h('th', thCss, 'EFG%'), h('th', thCss, 'TOV%'), h('th', thCss, 'OR%'), h('th', thCss, 'FTR%')
)),
h('tbody', '',
h('tr', '', h('td', 'padding:4px 5px;border:1px solid #d4d4d4;font-weight:700;font-size:10px;text-align:center;', 'Team'), ...tmCells),
h('tr', '', h('td', 'padding:4px 5px;border:1px solid #d4d4d4;font-weight:700;font-size:10px;text-align:center;', 'Opponent'), ...opCells)
)
));
el.appendChild(h('div', 'margin-top:4px;padding-top:4px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:4px;',
buildDuoCard('Best Duo', duoScores.at(0), true),
buildDuoCard('Worst Duo', duoScores.length > 1 ? duoScores.at(-1) : null, false)
));
if (pDres.length) {
el.appendChild(h('div', 'margin-top:5px;padding-top:4px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:4px;',
buildDreCard('High', pDres.at(0), true),
pDres.length > 1 ? buildDreCard('Low', pDres.at(-1), false) : null
));
}
// Top 2 Single-Game Outliers vs. Season Normal
const allShotsSzn = sc.shots || new Array();
const mxcOffSzn = allShotsSzn.filter(s => s.side === 'off');
const oppOffSzn = allShotsSzn.filter(s => s.side === 'def');
const szn3Rate = (arr) => arr.length ? arr.filter(s => Number(s.val) === 3).length / arr.length : 0.38;
const sznRimRate = (arr) => arr.length ? arr.filter(s => Math.hypot(Number(s.x || 250) - 250, Number(s.y || 80) - 52) <= 48).length / arr.length : 0.36;
const szn3Pct = (arr) => {
const t = arr.filter(s => Number(s.val) === 3);
return t.length ? t.filter(s => Number(s.made) === 1).length / t.length : 0.35;
};
const g3AttMxc = tm4.sA.filter(s => Number(s.val) === 3).length;
const g3PctMxc = g3AttMxc ? tm4.fg3m / g3AttMxc : 0;
const g3RateMxc = tm4.sA.length ? g3AttMxc / tm4.sA.length : 0;
const gRimRateMxc = tm4.sA.length ? tm4.sA.filter(s => Math.hypot(Number(s.x || 250) - 250, Number(s.y || 80) - 52) <= 48).length / tm4.sA.length : 0;
const g3AttOpp = op4.sA.filter(s => Number(s.val) === 3).length;
const g3PctOpp = g3AttOpp ? op4.fg3m / g3AttOpp : 0;
const nMxcEfg = szn3Pct(mxcOffSzn) ? mEfg : 0.535;
const nMxc3Pct = szn3Pct(mxcOffSzn);
const nMxc3Rate = szn3Rate(mxcOffSzn);
const nMxcRim = sznRimRate(mxcOffSzn);
const nOpp3Pct = szn3Pct(oppOffSzn);
const gameOutliers = new Array(
{ z: (tm4.efg - nMxcEfg) / 0.055, tone: tm4.efg >= nMxcEfg ? 'pos' : 'neg', tag: tm4.efg >= nMxcEfg ? 'SURGE' : 'COLD', text: 'MXC posted a ' + (tm4.efg * 100).toFixed(1) + '% eFG vs. ' + (nMxcEfg * 100).toFixed(1) + '% season normal.' },
{ z: (g3PctMxc - nMxc3Pct) / 0.085, tone: g3PctMxc >= nMxc3Pct ? 'pos' : 'neg', tag: g3PctMxc >= nMxc3Pct ? 'HOT 3PT' : 'COLD 3PT', text: 'MXC shot ' + (g3PctMxc * 100).toFixed(1) + '% from 3 (' + tm4.fg3m + '/' + g3AttMxc + ') vs. ' + (nMxc3Pct * 100).toFixed(1) + '% normal.' },
{ z: (g3PctOpp - nOpp3Pct) / 0.085, tone: g3PctOpp <= nOpp3Pct ? 'pos' : 'neg', tag: 'OPP 3PT', text: oppAb + ' shot ' + (g3PctOpp * 100).toFixed(1) + '% from 3 (' + op4.fg3m + '/' + g3AttOpp + ') vs. ' + (nOpp3Pct * 100).toFixed(1) + '% allowed normal.' },
{ z: (tm4.tov - mTov) / 0.038, tone: tm4.tov <= mTov ? 'pos' : 'neg', tag: 'BALL SECURITY', text: 'MXC turnover rate was ' + (tm4.tov * 100).toFixed(1) + '% (' + tm4.tA.length + ' TOV) vs. ' + (mTov * 100).toFixed(1) + '% normal.' },
{ z: (op4.tov - mTov) / 0.038, tone: op4.tov >= mTov ? 'pos' : 'neg', tag: 'DISRUPTION', text: 'Forced ' + oppAb + ' into a ' + (op4.tov * 100).toFixed(1) + '% TOV rate (' + op4.tA.length + ' TOV) vs. ' + (mTov * 100).toFixed(1) + '% normal.' },
{ z: (tm4.orb - mOrb) / 0.065, tone: tm4.orb >= mOrb ? 'pos' : 'neg', tag: 'GLASS', text: 'MXC grabbed ' + (tm4.orb * 100).toFixed(1) + '% of offensive boards vs. ' + (mOrb * 100).toFixed(1) + '% normal.' },
{ z: (g3RateMxc - nMxc3Rate) / 0.075, tone: 'style', tag: 'STYLISTIC', text: (g3RateMxc * 100).toFixed(1) + '% of MXC shots came from 3PT vs. ' + (nMxc3Rate * 100).toFixed(1) + '% normal.' },
{ z: (gRimRateMxc - nMxcRim) / 0.075, tone: 'style', tag: 'STYLISTIC', text: (gRimRateMxc * 100).toFixed(1) + '% of MXC shots came at the rim vs. ' + (nMxcRim * 100).toFixed(1) + '% normal.' }
).map(o => ({ ...o, absZ: Math.abs(o.z) })).sort((a, b) => b.absZ - a.absZ);
const gOutBox = renderOutliersBox('Game Outliers vs. Season Normal', gameOutliers);
if (gOutBox) el.appendChild(gOutBox);
} catch (e) {
el.textContent = 'Recap unavailable.';
}
}


async function renderInlineShotCharts() {
  const grid = document.getElementById('inlineShotChartsGrid');
  const sel = document.getElementById('inlineScPlayer');
  if (!grid) return;
  try {
    const sc = await fetch('data/shot_charts_' + SEASON + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null);
    if (!sc || !Array.isArray(sc.games) || !sc.games.length) {
      grid.innerHTML = '<div style="color:var(--muted);font-size:11px;">No shot chart data available yet.</div>';
      return;
    }

    const pList = Array.isArray(sc.players) ? sc.players : Object.values(sc.players || {});
    if (sel && sel.options.length <= 1) {
      const mxcIds = new Set((sc.shots || new Array()).filter(s => s.side === 'off').map(s => String(s.pid)));
      pList
        .filter(p => !mxcIds.size || mxcIds.has(String(p.id)))
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .forEach(p => {
          const opt = document.createElement('option');
          opt.value = String(p.id);
          opt.textContent = p.name || String(p.id);
          sel.appendChild(opt);
        });
    }

    const games = sc.games;
    const gSlice = _inlineScSpan === 'last1' ? games.slice(0, 1) : (_inlineScSpan === 'last3' ? games.slice(0, 3) : games);
    const gidSet = new Set(gSlice.map(g => g.id || g.gid));
    const pidFilter = sel ? sel.value : 'ALL';

    const shots = (sc.shots || new Array()).filter(s =>
      gidSet.has(s.gid) && (pidFilter === 'ALL' || s.side !== 'off' || String(s.pid) === pidFilter)
    );
    const fts = (sc.fts || new Array()).filter(f =>
      gidSet.has(f.gid) && (pidFilter === 'ALL' || f.side !== 'off' || String(f.pid) === pidFilter)
    );
    const tovs = (sc.turnovers || new Array()).filter(t =>
      gidSet.has(t.gid) && (pidFilter === 'ALL' || t.side !== 'off' || String(t.pid) === pidFilter)
    );
    const poss = (sc.poss || new Array()).filter(p => gidSet.has(p.gid));

    const ZONE_POLYS = new Array(
      { k: 'c3_l',   d: 'M 0 0 L 30 0 L 30 140 L 0 140 Z', lx: 15, ly: 76, avg: 0.375 },
      { k: 'c3_r',   d: 'M 470 0 L 500 0 L 500 140 L 470 140 Z', lx: 485, ly: 76, avg: 0.375 },
      { k: 'w3_l',   d: 'M 0 140 L 30 140 A 237.5 237.5 0 0 0 185 280 L 90 385 L 0 385 Z', lx: 82, ly: 292, avg: 0.355 },
      { k: 'ab3_c',  d: 'M 185 280 A 237.5 237.5 0 0 0 315 280 L 410 385 L 90 385 Z', lx: 250, ly: 334, avg: 0.355 },
      { k: 'w3_r',   d: 'M 470 140 L 500 140 L 500 385 L 410 385 L 315 280 A 237.5 237.5 0 0 0 470 140 Z', lx: 418, ly: 292, avg: 0.355 },
      { k: 'mid_l',  d: 'M 30 0 L 170 0 L 170 140 L 30 140 Z', lx: 100, ly: 76, avg: 0.395 },
      { k: 'mid_r',  d: 'M 330 0 L 470 0 L 470 140 L 330 140 Z', lx: 400, ly: 76, avg: 0.395 },
      { k: 'mid_bl', d: 'M 30 140 L 170 140 L 170 190 L 198 228 L 185 280 A 237.5 237.5 0 0 1 30 140 Z', lx: 118, ly: 205, avg: 0.395 },
      { k: 'mid_bc', d: 'M 198 228 L 302 228 L 315 280 A 237.5 237.5 0 0 1 185 280 Z', lx: 250, ly: 256, avg: 0.405 },
      { k: 'mid_br', d: 'M 330 140 L 470 140 A 237.5 237.5 0 0 1 315 280 L 302 228 L 330 190 Z', lx: 382, ly: 205, avg: 0.395 },
      { k: 'paint',  d: 'M 170 0 L 330 0 L 330 190 L 302 228 L 198 228 L 170 190 Z', lx: 250, ly: 158, avg: 0.425 },
      { k: 'rim',    d: 'M 205 0 L 295 0 L 295 52 A 45 45 0 0 1 205 52 Z', lx: 250, ly: 52, avg: 0.635 }
    );

    const mapZoneKey = (s) => {
      let x = Number(s.x ?? 250);
      let y = Number(s.y ?? 80);
      if (x < 0 || (Math.abs(x) <= 250 && s.x != null && Number(s.x) < 0)) x = x + 250;
      if (y < 0) y = y + 52;
      const dx = x - 250, dy = y - 52, dist = Math.hypot(dx, dy);
      const is3 = Number(s.val) === 3 || dist >= 225 || x <= 42 || x >= 458;
      if (!is3) {
        if (dist <= 48) return 'rim';
        if (x >= 170 && x <= 330 && y <= 215) return 'paint';
        if (y <= 140) return x < 250 ? 'mid_l' : 'mid_r';
        if (x < 198) return 'mid_bl';
        if (x > 302) return 'mid_br';
        return 'mid_bc';
      }
      if (y <= 140) return x < 250 ? 'c3_l' : 'c3_r';
      if (x < 185) return 'w3_l';
      if (x > 315) return 'w3_r';
      return 'ab3_c';
    };

    const buildCourtCard = (side, title) => {
      const sSide = shots.filter(s => s.side === side);
      const fSide = fts.filter(f => f.side === side);
      const tSide = tovs.filter(t => t.side === side);
      const pSide = poss.filter(p => p.side === side);

      const totA = sSide.length;
      const s2 = sSide.filter(s => Number(s.val) !== 3);
      const s3 = sSide.filter(s => Number(s.val) === 3);
      const m2 = s2.filter(s => Number(s.made) === 1).length, a2 = s2.length;
      const m3 = s3.filter(s => Number(s.made) === 1).length, a3 = s3.length;

      const ts2Pct = a2 ? ((m2 / a2) * 100).toFixed(1) : '0.0';
      const ts3Pct = a3 ? (((1.5 * m3) / a3) * 100).toFixed(1) : '0.0';
      const ftrPct = totA ? ((fSide.length / totA) * 100).toFixed(1) : '0.0';
      const par3Pct = totA ? ((a3 / totA) * 100).toFixed(1) : '0.0';
      const possDen = pSide.length || (totA + 0.44 * fSide.length + tSide.length);
      const tovPct = possDen ? ((tSide.length / possDen) * 100).toFixed(1) : '0.0';

      const byZ = {};
      ZONE_POLYS.forEach(z => { byZ[z.k] = { m: 0, a: 0 }; });
      sSide.forEach(s => {
        const zk = mapZoneKey(s);
        if (!byZ[zk]) byZ[zk] = { m: 0, a: 0 };
        byZ[zk].a++;
        if (Number(s.made) === 1) byZ[zk].m++;
      });

      const ns = ['http:/', 'www.w3.org', '2000', 'svg'].join('/');
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 500 385');
      svg.style.cssText = 'width:100%;height:auto;border:1px solid #94a3b8;background:#f4f4f4;display:block;';

      const addEl = (tag, attrs) => {
        const node = document.createElementNS(ns, tag);
        Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
        svg.appendChild(node);
        return node;
      };

      const zoneStyle = (st, avg) => {
        if (!st.a) return { fill: '#f1f5f9', dark: false };
        const diff = (st.m / st.a) - avg;
        const rel = side === 'def' ? -diff : diff;
        if (rel >= 0.06) return { fill: '#22a559', dark: true };
        if (rel >= 0.02) return { fill: '#86efac', dark: false };
        if (rel > -0.025) return { fill: '#fef08a', dark: false };
        if (rel > -0.065) return { fill: '#fca5a5', dark: false };
        return { fill: '#dc3545', dark: true };
      };

      ZONE_POLYS.forEach(z => {
        const st = byZ[z.k] || { m: 0, a: 0 };
        const sty = zoneStyle(st, z.avg);
        addEl('path', { d: z.d, fill: sty.fill, stroke: '#ffffff', 'stroke-width': 1.5 });
      });

      addEl('rect', { x: 0, y: 0, width: 500, height: 385, fill: 'none', stroke: '#334155', 'stroke-width': 2 });
      addEl('rect', { x: 170, y: 0, width: 160, height: 190, fill: 'none', stroke: '#ffffff', 'stroke-width': 1.6 });
      addEl('circle', { cx: 250, cy: 190, r: 60, fill: 'none', stroke: '#334155', 'stroke-width': 1.4 });
      addEl('path', { d: 'M 210 52 A 40 40 0 0 0 290 52', fill: 'none', stroke: '#ffffff', 'stroke-width': 1.4 });
      addEl('path', { d: 'M 30 0 L 30 140 A 237.5 237.5 0 0 0 470 140 L 470 0', fill: 'none', stroke: '#ffffff', 'stroke-width': 2.5 });
      addEl('path', { d: 'M 30 0 L 30 140 A 237.5 237.5 0 0 0 470 140 L 470 0', fill: 'none', stroke: '#1e293b', 'stroke-width': 1.2 });
      addEl('line', { x1: 220, y1: 40, x2: 280, y2: 40, stroke: '#ffffff', 'stroke-width': 3 });
      addEl('circle', { cx: 250, cy: 52, r: 8, fill: 'none', stroke: '#ffffff', 'stroke-width': 2 });

      ZONE_POLYS.forEach(z => {
        const st = byZ[z.k] || { m: 0, a: 0 };
        const sty = zoneStyle(st, z.avg);
        const pct = st.a ? Math.round((st.m / st.a) * 100) : 0;
        const freq = totA ? Math.round((st.a / totA) * 100) : 0;
        const isCorner = z.k === 'c3_l' || z.k === 'c3_r';
        const txtCol = sty.dark ? '#ffffff' : '#0A0A0A';
        const strokeCol = sty.dark ? '#111827' : '#ffffff';

        const t1 = addEl('text', {
          x: z.lx, y: z.ly - 2, 'text-anchor': 'middle',
          'font-family': 'Oswald,sans-serif', 'font-size': isCorner ? '11' : '15', 'font-weight': '700',
          fill: txtCol, stroke: strokeCol, 'stroke-width': '2.4px', 'paint-order': 'stroke', 'stroke-linejoin': 'round'
        });
        t1.textContent = st.a ? (pct + '%') : '0%';

        const t2 = addEl('text', {
          x: z.lx, y: z.ly + 11, 'text-anchor': 'middle',
          'font-family': 'Oswald,sans-serif', 'font-size': isCorner ? '8' : '9.8', 'font-weight': '600',
          fill: txtCol, stroke: strokeCol, 'stroke-width': '2px', 'paint-order': 'stroke', 'stroke-linejoin': 'round'
        });
        t2.textContent = st.m + '/' + st.a + ' (' + freq + '%)';
      });

      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--border);background:#fff;padding:6px 8px 6px;';

      const hdr = document.createElement('div');
      hdr.style.cssText = 'font-family:Oswald,sans-serif;font-size:14px;font-weight:700;color:var(--blue);line-height:1.1;text-transform:uppercase;margin-bottom:2px;';
      hdr.textContent = title;
      card.appendChild(hdr);

      const sub = document.createElement('div');
      sub.style.cssText = 'font-family:Lora,serif;font-size:10px;color:var(--dim);margin-bottom:5px;line-height:1.3;';
      sub.innerHTML = '2PM-2PA: <b style="color:var(--blue);">' + m2 + '-' + a2 + '</b> &middot; '
                    + '2PT TS%: <b style="color:var(--blue);">' + ts2Pct + '%</b> &middot; '
                    + '3PM-3PA: <b style="color:var(--blue);">' + m3 + '-' + a3 + '</b> &middot; '
                    + '3PT TS%: <b style="color:var(--blue);">' + ts3Pct + '%</b> &middot; '
                    + 'FTr: <b style="color:var(--blue);">' + ftrPct + '%</b> &middot; '
                    + '3PAr: <b style="color:var(--blue);">' + par3Pct + '%</b> &middot; '
                    + 'TOV%: <b style="color:var(--blue);">' + tovPct + '%</b>';
      card.appendChild(sub);

      card.appendChild(svg);
      return card;
    };

    grid.innerHTML = '';
    const offTitle = pidFilter === 'ALL' ? 'MXC OFFENSE' : ((sel.options[sel.selectedIndex]?.textContent || 'PLAYER').toUpperCase() + ' OFFENSE');
    grid.appendChild(buildCourtCard('off', offTitle));
    grid.appendChild(buildCourtCard('def', 'MXC DEFENSE'));
  } catch (e) {
    grid.innerHTML = '<div style="color:var(--red);font-size:11px;">Shot charts unavailable.</div>';
  }
}




async function initWowySlots() {
  const wrap = document.getElementById('wowySlots');
  if (!wrap) return;
  try {
    const [sc, ld] = await Promise.all([
      fetch('data/shot_charts_' + SEASON + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
      (window._wowyLineupData ? Promise.resolve(window._wowyLineupData) : fetch(LINEUP_DATA_PATH() + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null))
    ]);
    if (sc) window._wowyShotData = sc;
    if (ld) window._wowyLineupData = ld;

    const normKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,'’\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');
    const initLast = (s) => { const p = normKey(s).split(' '); return p.length >= 2 ? (p + '_' + p[p.length - 1]) : normKey(s); };

    const rosterMap = new Map();
    const scPlayers = Array.isArray(sc?.players) ? sc.players : Object.values(sc?.players || {});
    scPlayers.forEach(p => {
      if (!p || !p.name) return;
      const k = normKey(p.name);
      if (!rosterMap.has(k)) rosterMap.set(k, { key: k, name: p.name, scIds: new Set() });
      rosterMap.get(k).scIds.add(Number(p.id));
    });
    Object.entries(ld?.playerXref || {}).forEach(([ab, info]) => {
      const full = info?.name || ab;
      const k = normKey(full), il = initLast(full);
      let entry = rosterMap.get(k);
      if (!entry) { for (const v of rosterMap.values()) { if (initLast(v.name) === il) { entry = v; break; } } }
      if (!entry) { entry = { key: k, name: full, scIds: new Set() }; rosterMap.set(k, entry); }
      if (info?.id != null) entry.scIds.add(Number(info.id));
    });

    window._wowyRosterList = Array.from(rosterMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    wrap.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const col = document.createElement('div');
      col.style.cssText = 'min-width:0;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-family:Lora,serif;font-size:9.5px;color:var(--muted);text-align:center;margin-bottom:2px;';
      lbl.textContent = 'Player ' + i;
      const sel = document.createElement('select');
      sel.id = 'wowySlot' + i;
      sel.style.cssText = 'width:100%;font-family:Lora,serif;font-size:10px;padding:2px 2px;border:1px solid var(--border);background:#fff;';
      const blank = document.createElement('option'); blank.value = ''; sel.appendChild(blank);
      window._wowyRosterList.forEach(p => { const o = document.createElement('option'); o.value = p.key; o.textContent = p.name; sel.appendChild(o); });
      sel.addEventListener('change', () => { if (typeof runWowy === 'function') runWowy(); });
      col.appendChild(lbl); col.appendChild(sel); wrap.appendChild(col);
    }
  } catch (e) {}
}

function clearWowySlots() {
  for (let i = 1; i <= 5; i++) { const s = document.getElementById('wowySlot' + i); if (s) s.value = ''; }
  const res = document.getElementById('wowyResults');
  if (res) res.innerHTML = '<div style="padding:10px;border:1px dashed var(--border);color:var(--muted);text-align:center;font-family:Lora,serif;font-size:11px;">Select at least one player above to generate visual on/off splits.</div>';
}

async function runWowy() {
  const res = document.getElementById('wowyResults');
  if (!res) return;
  const selectedKeys = [];
  for (let i = 1; i <= 5; i++) {
    const v = document.getElementById('wowySlot' + i)?.value;
    if (v && !selectedKeys.includes(v)) selectedKeys.push(v);
  }
  if (!selectedKeys.length) { clearWowySlots(); return; }

  let [sc, idx, ld] = [
    window._wowyShotData,
    window._wowyPlayersIdx,
    window._wowyLineupData
  ];
  if (!sc) {
    sc = await fetch('data/shot_charts_' + SEASON + '.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    if (sc) window._wowyShotData = sc;
  }
  if (!idx) {
    idx = await fetch('data/players_index.json?v=' + Date.now()).then(r => r.ok ? r.json() : []).catch(() => []);
    window._wowyPlayersIdx = idx;
  }
  if (!ld) {
    ld = await fetch(LINEUP_DATA_PATH() + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    if (ld) window._wowyLineupData = ld;
  }
  if (!sc || !Array.isArray(sc.poss)) {
    res.innerHTML = '<span style="color:var(--muted);">Play-by-play lineup data unavailable.</span>';
    return;
  }

  const normN = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.,'’\-]/g, ' ').split(/\s+/).filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w)).join(' ');
  const photoMap = {};
  const addPhoto = (nm, u) => {
    if (!nm || !u) return;
    photoMap[normN(nm)] = u;
    const pts = normN(nm).split(' ');
    if (pts.length >= 2) photoMap[pts[0] + '_' + pts[pts.length - 1]] = u;
  };
  Object.entries(ld?.playerXref || {}).forEach(([ab, info]) => { if (info?.photoUrl) { addPhoto(ab, info.photoUrl); addPhoto(info.name, info.photoUrl); } });
  (Array.isArray(idx) ? idx : Object.values(idx || {})).forEach(p => { if (p?.name && p?.photoUrl) addPhoto(p.name, p.photoUrl); });
  const getPhoto = (nm) => {
    const c = normN(nm), pts = c.split(' ');
    return photoMap[c] || (pts.length >= 2 ? photoMap[pts[0] + '_' + pts[pts.length - 1]] : null);
  };

  const roster = window._wowyRosterList || [];
  const selectedObjs = selectedKeys.map(k => {
    const found = roster.find(r => r.key === k) || { key: k, name: k, scIds: new Set() };
    const last = String(found.name || '').replace(/,\s*(jr|sr|ii|iii|iv|v)\.?$/i, '').split(' ').pop();
    return { ...found, last, photo: getPhoto(found.name), ids: Array.from(found.scIds) };
  });

  const tms = cachedTeamStats?.slices?.all || [];
  const lgAvg = (k, fb) => {
    const vals = tms.map(t => t[k]).filter(v => v != null).map(Number);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : fb;
  };
  const lgOff  = lgAvg('OFF_RATING', 110.5);
  const lgDef  = lgAvg('DEF_RATING', 110.5);
  const lgNet  = lgOff - lgDef;
  const lgTs   = lgAvg('TS_PCT', 0.568) * 100;
  const lgTov  = lgAvg('TM_TOV_PCT', 0.155) * 100;
  const lgOrb  = lgAvg('OREB_PCT', 0.285) * 100;
  const lgDrb  = lgAvg('DREB_PCT', 0.715) * 100;

  const calcCombo = (mask) => {
    const matches = (onArr) => {
      const floorIds = (onArr || []).map(Number);
      for (let i = 0; i < selectedObjs.length; i++) {
        const wantOn = ((mask >> i) & 1) === 1;
        const isOn = selectedObjs[i].ids.some(id => floorIds.includes(id));
        if (isOn !== wantOn) return false;
      }
      return true;
    };

    const pOff = sc.poss.filter(p => p.side === 'off' && matches(p.on));
    const pDef = sc.poss.filter(p => p.side === 'def' && matches(p.on));
    const sOff = (sc.shots || []).filter(s => s.side === 'off' && matches(s.on));
    const sDef = (sc.shots || []).filter(s => s.side === 'def' && matches(s.on));
    const fOff = (sc.fts || []).filter(f => f.side === 'off' && matches(f.on));
    const fDef = (sc.fts || []).filter(f => f.side === 'def' && matches(f.on));
    const tOff = (sc.turnovers || []).filter(t => t.side === 'off' && matches(t.on));
    const tDef = (sc.turnovers || []).filter(t => t.side === 'def' && matches(t.on));

    const ptsFor = sOff.filter(s => Number(s.made) === 1).reduce((a, s) => a + (Number(s.val) || 2), 0) + fOff.filter(f => Number(f.made) === 1).length;
    const ptsAg  = sDef.filter(s => Number(s.made) === 1).reduce((a, s) => a + (Number(s.val) || 2), 0) + fDef.filter(f => Number(f.made) === 1).length;

    const offPoss = pOff.length, defPoss = pDef.length;
    const offRtg = offPoss ? (ptsFor / offPoss) * 100 : 0;
    const defRtg = defPoss ? (ptsAg / defPoss) * 100 : 0;
    const netRtg = offRtg - defRtg;

    const offTsa = sOff.length + 0.44 * fOff.length;
    const defTsa = sDef.length + 0.44 * fDef.length;
    const offTs  = offTsa ? (ptsFor / (2 * offTsa)) * 100 : 0;
    const defTs  = defTsa ? (ptsAg  / (2 * defTsa)) * 100 : 0;

    const offTov = offPoss ? (tOff.length / offPoss) * 100 : 0;
    const defTov = defPoss ? (tDef.length / defPoss) * 100 : 0;

    const offFgm = sOff.filter(s => Number(s.made) === 1).length;
    const defFgm = sDef.filter(s => Number(s.made) === 1).length;
    const offRebOpps = (sOff.length - offFgm) + fOff.filter(f => Number(f.made) === 0 && /1 of 1|2 of 2|3 of 3/.test(String(f.sub || ''))).length;
    const defRebOpps = (sDef.length - defFgm) + fDef.filter(f => Number(f.made) === 0 && /1 of 1|2 of 2|3 of 3/.test(String(f.sub || ''))).length;

    const offOreb = pOff.reduce((a, p) => a + (Number(p.oreb) || 0), 0);
    const defOreb = pDef.reduce((a, p) => a + (Number(p.oreb) || 0), 0);
    const offOrb = offRebOpps ? (offOreb / offRebOpps) * 100 : 0;
    const defOrb = defRebOpps ? ((defRebOpps - defOreb) / defRebOpps) * 100 : 0;

    return { poss: Math.round((offPoss + defPoss) / 2), offRtg, defRtg, netRtg, offTs, offTov, offOrb, defTs, defTov, defOrb };
  };

  const n = selectedObjs.length;
  const totalCombos = 1 << n;
  const rows = [];
  for (let idxM = 0; idxM < totalCombos; idxM++) {
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const bit = ((idxM >> i) & 1) === 0 ? 1 : 0;
      mask |= (bit << i);
    }
    rows.push({ mask, st: calcCombo(mask) });
  }

  const statCell = (val, avg, isPct, inv, colorMain) => {
    const d = val - avg;
    const good = inv ? (d <= 0) : (d >= 0);
    const dCol = good ? 'var(--green)' : 'var(--red)';
    const mainCol = colorMain ? (val >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text)';
    return `<td style="padding:5px 3px;text-align:right;vertical-align:middle;">
      <div style="font-family:Lora,serif;font-weight:700;font-size:11px;color:${mainCol};line-height:1.1;">${val.toFixed(1)}</div>
      <div style="font-family:Lora,serif;font-size:8.5px;color:${dCol};line-height:1.1;margin-top:1px;">${d >= 0 ? '+' : ''}${d.toFixed(1)}${isPct ? '%' : ''}</div>
    </td>`;
  };

  const bodyHtml = rows.map(r => {
    const avatars = selectedObjs.map((p, i) => {
      const isOn = ((r.mask >> i) & 1) === 1;
      const circle = isOn
        ? (p.photo
            ? `<img src="${p.photo}" referrerpolicy="no-referrer" style="width:32px;height:32px;border-radius:50%;object-fit:cover;object-position:top;border:2px solid var(--blue);display:block;margin:0 auto;">`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--surface);border:2px solid var(--blue);display:flex;align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-size:10px;font-weight:700;margin:0 auto;">${p.last.slice(0,2)}</div>`)
        : `<div style="width:32px;height:32px;border-radius:50%;background:#666;color:#fff;display:flex;align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-size:9px;font-weight:700;margin:0 auto;letter-spacing:0.3px;">OFF</div>`;
      return `<div style="text-align:center;width:40px;">${circle}<div style="font-family:Lora,serif;font-size:9px;color:var(--dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.last}</div></div>`;
    }).join('');

    const s = r.st;
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:5px 4px 5px 0;text-align:left;vertical-align:middle;"><div style="display:flex;align-items:center;gap:4px;">${avatars}</div></td>
      <td style="padding:5px 4px;text-align:right;vertical-align:top;font-family:Lora,serif;font-weight:700;font-size:11px;color:var(--text);">${s.poss}</td>
      ${statCell(s.offRtg, lgOff, false, false, false)}
      ${statCell(s.defRtg, lgDef, false, true,  false)}
      ${statCell(s.netRtg, lgNet, false, false, true)}
      ${statCell(s.offTs,  lgTs,  true,  false, false)}
      ${statCell(s.offTov, lgTov, true,  true,  false)}
      ${statCell(s.offOrb, lgOrb, true,  false, false)}
      ${statCell(s.defTs,  lgTs,  true,  true,  false)}
      ${statCell(s.defTov, lgTov, true,  false, false)}
      ${statCell(s.defOrb, lgDrb, true,  false, false)}
    </tr>`;
  }).join('');

  res.innerHTML =
    `<div style="font-family:Lora,serif;font-size:9.5px;color:var(--muted);margin-bottom:4px;">Lineup combo weighted avg &middot; &Delta; vs. league avg</div>
     <div style="overflow-x:auto;">
       <table style="width:100%;border-collapse:collapse;table-layout:auto;">
         <thead>
           <tr style="border-bottom:1px solid var(--border);font-family:Oswald,sans-serif;font-size:9.5px;font-weight:700;color:var(--muted);">
             <th style="text-align:left;padding:2px 4px 3px 0;">LINEUP</th>
             <th style="text-align:right;padding:2px 4px 3px;">POSS</th>
             <th style="text-align:right;padding:2px 3px 3px;">OFF</th>
             <th style="text-align:right;padding:2px 3px 3px;">DEF</th>
             <th style="text-align:right;padding:2px 3px 3px;">NET</th>
             <th style="text-align:right;padding:2px 3px 3px;">OFF TS%</th>
             <th style="text-align:right;padding:2px 3px 3px;">OFF TOV%</th>
             <th style="text-align:right;padding:2px 3px 3px;">OFF ORB%</th>
             <th style="text-align:right;padding:2px 3px 3px;">DEF TS%</th>
             <th style="text-align:right;padding:2px 3px 3px;">DEF TOV%</th>
             <th style="text-align:right;padding:2px 2px 3px;">DEF ORB%</th>
           </tr>
         </thead>
         <tbody>${bodyHtml}</tbody>
       </table>
     </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof renderLastGameRecap === 'function') renderLastGameRecap();
  if (typeof renderInlineShotCharts === 'function') renderInlineShotCharts();
  if (typeof renderBap === 'function') renderBap();
  if (typeof renderSeasonSplits === 'function') renderSeasonSplits();
  if (typeof renderPsTab === 'function') renderPsTab();
  if (typeof initWowySlots === 'function') initWowySlots();
});
