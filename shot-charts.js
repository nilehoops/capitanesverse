let _shotData = null;

async function loadShotSeason() {
  const season = document.getElementById('scSeason').value;
  const grid = document.getElementById('scGrid');
  grid.innerHTML = `<div style="color:var(--muted);font-size:12px;">Loading ${season} shot data...</div>`;

  try {
    const resp = await fetch(`data/shot_charts_${season}.json?v=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    _shotData = await resp.json();

    const sel = document.getElementById('scPlayer');
    const prev = sel.value;
    const opts = (_shotData.players || [])
      .map(p => `<option value="${p.id}">${p.name}</option>`)
      .join('');
    sel.innerHTML = `<option value="ALL">All Capitanes (Team)</option>${opts}`;
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;

    renderShotPage();
  } catch (e) {
    grid.innerHTML = `<div style="color:var(--red);font-size:12px;">No shot chart file found for ${season}.</div>`;
  }
}

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
  'Restricted Area': 0.655,
  'Paint (Non-RA)': 0.435,
  'Left Baseline Mid': 0.405,
  'Right Baseline Mid': 0.405,
  'Left Elbow / Wing Mid': 0.415,
  'Right Elbow / Wing Mid': 0.415,
  'Top of Key Mid': 0.420,
  'Left Corner 3': 0.382,
  'Right Corner 3': 0.382,
  'Left Wing 3': 0.358,
  'Right Wing 3': 0.358,
  'Top of Key 3': 0.355,
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

function getZoneFill(fgPct, bench, fga) {
  if (fga === 0) return { fill: '#F3F4F6', text: '#6B7280' };
  const diff = fgPct - bench;
  if (diff >= 0.08)  return { fill: 'rgba(24, 175, 74, 0.78)', text: '#FFFFFF' };
  if (diff >= 0.03)  return { fill: 'rgba(24, 175, 74, 0.42)', text: '#0A0A0A' };
  if (diff <= -0.08) return { fill: 'rgba(216, 31, 42, 0.78)', text: '#FFFFFF' };
  if (diff <= -0.03) return { fill: 'rgba(216, 31, 42, 0.42)', text: '#0A0A0A' };
  return { fill: 'rgba(255, 212, 0, 0.35)', text: '#0A0A0A' };
}
function buildCourtCard(title, shots, view) {
  const totalFga = shots.length;
  const totalFgm = shots.reduce((a, s) => a + s.made, 0);
  const total3a = shots.reduce((a, s) => a + (s.val === 3 ? 1 : 0), 0);
  const total3m = shots.reduce((a, s) => a + (s.made && s.val === 3 ? 1 : 0), 0);
  const totalPts = shots.reduce((a, s) => a + (s.made ? s.val : 0), 0);

  const fgPct = totalFga ? ((totalFgm / totalFga) * 100).toFixed(1) : '0.0';
  const efgPct = totalFga ? (((totalFgm + 0.5 * total3m) / totalFga) * 100).toFixed(1) : '0.0';
  const pps = totalFga ? (totalPts / totalFga).toFixed(2) : '0.00';
  const threePar = totalFga ? ((total3a / totalFga) * 100).toFixed(1) : '0.0';

  const grouped = {};
  Object.keys(ZONE_SHAPES).forEach(z => grouped[z] = { fga: 0, fgm: 0, pts: 0 });
  shots.forEach(s => {
    const z = classifyCbbZone(s);
    grouped[z].fga += 1;
    grouped[z].fgm += s.made;
    grouped[z].pts += s.made ? s.val : 0;
  });

  let polygonsSvg = '';
  let labelsSvg = '';
  if (view === 'zones' || view === 'hybrid') {
    Object.entries(ZONE_SHAPES).forEach(([z, cfg]) => {
      const g = grouped[z];
      const bench = LG_ZONE_BENCH[z] || 0.40;
      const pct = g.fga > 0 ? g.fgm / g.fga : 0;
      const { fill, text } = getZoneFill(pct, bench, g.fga);
      const share = totalFga > 0 ? ((g.fga / totalFga) * 100).toFixed(0) : '0';
      const pctLabel = g.fga > 0 ? `${(pct * 100).toFixed(0)}%` : '—';

      polygonsSvg += `<path d="${cfg.d}" fill="${fill}" stroke="#FFFFFF" stroke-width="2">
        <title>${z}: ${g.fgm}/${g.fga} (${pctLabel}) | LG Avg: ${(bench * 100).toFixed(1)}% | Share: ${share}%</title>
      </path>`;

      labelsSvg += `
        <g transform="translate(${cfg.lx}, ${cfg.ly})" pointer-events="none">
          <text x="0" y="-4" text-anchor="middle" font-family="Oswald, sans-serif" font-size="11" font-weight="700" fill="${text}">${pctLabel}</text>
          <text x="0" y="7" text-anchor="middle" font-family="Lora, serif" font-size="8" font-weight="600" fill="${text}">${g.fgm}/${g.fga} (${share}%)</text>
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
      const bench = LG_ZONE_BENCH[z] || 0.40;
      const pct = g.fgm / g.fga;
      const diff = (pct - bench) * 100;
      const share = ((g.fga / totalFga) * 100).toFixed(1);
      const zPps = (g.pts / g.fga).toFixed(2);
      const diffColor = diff >= 3 ? 'var(--green)' : (diff <= -3 ? 'var(--red)' : 'var(--dim)');
      return `<tr>
        <td style="padding:3px 6px;border-bottom:1px solid var(--border);font-weight:600;">${z}</td>
        <td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;">${g.fgm}-${g.fga}</td>
        <td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;">${(pct * 100).toFixed(1)}%</td>
        <td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);">${(bench * 100).toFixed(1)}%</td>
        <td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:${diffColor};">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%</td>
        <td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;">${share}%</td>
        <td style="padding:3px 6px;border-bottom:1px solid var(--border);text-align:right;">${zPps}</td>
      </tr>`;
    }).join('');

  return `
    <div class="sc-card">
      <div class="sc-card-title">${title}</div>
      <div class="sc-card-sub">
        FGM-FGA: <span style="color:var(--blue);">${totalFgm}-${totalFga}</span> (${fgPct}%) &nbsp;·&nbsp;
        eFG%: <span style="color:var(--blue);">${efgPct}%</span> &nbsp;·&nbsp;
        PPS: <span style="color:var(--blue);">${pps}</span> &nbsp;·&nbsp;
        3PAr: <span style="color:var(--blue);">${threePar}%</span>
      </div>
      <svg viewBox="-250 -47.5 500 470" style="width:100%;max-width:500px;height:auto;display:block;background:#FAFAFA;margin-bottom:10px;">
        ${polygonsSvg}
        ${courtLines}
        ${dotsSvg}
        ${labelsSvg}
      </svg>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="background:var(--surface);color:var(--muted);font-family:'Oswald',sans-serif;font-size:10px;">
              <th style="padding:4px 6px;text-align:left;border-bottom:1px solid var(--border);">Zone</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">FGM-FGA</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">FG%</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">LG Avg</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">Diff</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">Share%</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">PPS</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderShotPage() {
  if (!_shotData) return;
  const sel = document.getElementById('scPlayer');
  const pidVal = sel.value;
  const pid = pidVal === 'ALL' ? null : Number(pidVal);
  const playerName = sel.options.item(sel.selectedIndex).text;
  const mode = document.getElementById('scMode').value;
  const view = document.getElementById('scView').value;
  const periodVal = document.getElementById('scPeriod').value;
  const grid = document.getElementById('scGrid');

  const periodShots = _shotData.shots.filter(s => {
    if (periodVal === 'ALL') return true;
    if (periodVal === 'OT') return s.p > 4;
    return s.p === Number(periodVal);
  });

  if (mode === 'ind') {
    const sub = periodShots.filter(s => s.side === 'off' && (pid === null || s.pid === pid));
    grid.innerHTML = buildCourtCard(`${playerName} — CBB-Style Shot Breakdown`, sub, view);
    return;
  }

  if (pid === null) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:12px;">Select a specific player from the dropdown above to compare On-Court vs. Off-Court shot breakdowns.</div>`;
    return;
  }

  const side = mode === 'onoff_off' ? 'off' : 'def';
  const label = mode === 'onoff_off' ? 'Capitanes Offense' : 'Opponent Offense (Defense)';
  const onShots = periodShots.filter(s => s.side === side && s.on.includes(pid));
  const offShots = periodShots.filter(s => s.side === side && !s.on.includes(pid));

  grid.innerHTML =
    buildCourtCard(`${playerName} ON Court — ${label}`, onShots, view) +
    buildCourtCard(`${playerName} OFF Court — ${label}`, offShots, view);
}

document.addEventListener('DOMContentLoaded', loadShotSeason);
