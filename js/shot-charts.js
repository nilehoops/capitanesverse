// js/shot-charts.js — Standalone Individual & Side-by-Side On/Off Shot Charts
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
    grid.innerHTML = `<div style="color:var(--red);font-size:12px;">No shot chart file found for ${season} (expected data/shot_charts_${season}.json).</div>`;
  }
}

function classifyZone(s) {
  if (s.dist <= 4) return 'Restricted Area';
  if (s.val === 2 && s.dist <= 14) return 'Paint (Non-RA)';
  if (s.val === 2) return 'Mid-Range';
  if (s.y <= 92.5 && Math.abs(s.x) >= 220) return 'Corner 3';
  return 'Above Break 3';
}

function buildCourtCard(title, shots, view) {
  const fga = shots.length;
  const fgm = shots.reduce((acc, s) => acc + s.made, 0);
  const fg3a = shots.reduce((acc, s) => acc + (s.val === 3 ? 1 : 0), 0);
  const fg3m = shots.reduce((acc, s) => acc + (s.made && s.val === 3 ? 1 : 0), 0);

  const fgPct = fga ? ((fgm / fga) * 100).toFixed(1) : '0.0';
  const efgPct = fga ? (((fgm + 0.5 * fg3m) / fga) * 100).toFixed(1) : '0.0';
  const threePar = fga ? ((fg3a / fga) * 100).toFixed(1) : '0.0';

  const courtLines = `
    <rect x="-250" y="-47.5" width="500" height="470" fill="#FAFAFA" stroke="#DEDEDE" stroke-width="2"/>
    <rect x="-80" y="-47.5" width="160" height="190" fill="none" stroke="#CCCCCC" stroke-width="1.5"/>
    <circle cx="0" cy="142.5" r="60" fill="none" stroke="#CCCCCC" stroke-width="1.5"/>
    <line x1="-220" y1="-47.5" x2="-220" y2="92.5" stroke="#CCCCCC" stroke-width="1.5"/>
    <line x1="220" y1="-47.5" x2="220" y2="92.5" stroke="#CCCCCC" stroke-width="1.5"/>
    <path d="M -220 92.5 A 237.5 237.5 0 0 0 220 92.5" fill="none" stroke="#CCCCCC" stroke-width="1.5"/>
    <path d="M -40 0 A 40 40 0 0 0 40 0" fill="none" stroke="#CCCCCC" stroke-width="1.5"/>
    <line x1="-30" y1="-7.5" x2="30" y2="-7.5" stroke="#555" stroke-width="2.5"/>
    <circle cx="0" cy="0" r="7.5" fill="none" stroke="#FF6B00" stroke-width="2"/>
  `;

  let overlay = '';
  if (view === 'dots') {
    overlay = shots.map(s => {
      const color = s.made ? 'var(--green)' : 'var(--red)';
      const fill = s.made ? 'var(--green)' : 'none';
      return `<circle cx="${s.x}" cy="${s.y}" r="4.0" fill="${fill}" fill-opacity="0.72" stroke="${color}" stroke-width="1.3">
        <title>${s.shooter} — ${s.made ? 'MADE' : 'MISS'} (${s.dist}ft ${s.sub})</title>
      </circle>`;
    }).join('');
  } else {
    const zoneCoords = {
      'Restricted Area':,
      'Paint (Non-RA)':,
      'Mid-Range': [-135, 130],
      'Corner 3': [-232, 35],
      'Above Break 3':,
    };
    const grouped = {};
    shots.forEach(s => {
      const z = classifyZone(s);
      if (!grouped[z]) grouped[z] = { fga: 0, fgm: 0 };
      grouped[z].fga += 1;
      grouped[z].fgm += s.made;
    });

    overlay = Object.entries(zoneCoords).map(([z, [zx, zy]]) => {
      const g = grouped[z] || { fga: 0, fgm: 0 };
      const pctStr = g.fga ? ((g.fgm / g.fga) * 100).toFixed(0) + '%' : '—';
      const freqStr = fga ? ((g.fga / fga) * 100).toFixed(0) + '% freq' : '0%';
      const bg = g.fga === 0
        ? '#888'
        : (g.fgm / g.fga >= 0.48 ? 'var(--green)' : (g.fgm / g.fga <= 0.35 ? 'var(--red)' : 'var(--blue)'));
      return `
        <g transform="translate(${zx}, ${zy})">
          <rect x="-46" y="-22" width="92" height="44" rx="4" fill="#fff" stroke="${bg}" stroke-width="2"/>
          <text x="0" y="-5" text-anchor="middle" font-family="Oswald, sans-serif" font-size="13" font-weight="700" fill="${bg}">${pctStr} (${g.fgm}/${g.fga})</text>
          <text x="0" y="12" text-anchor="middle" font-family="Lora, serif" font-size="10" fill="#333">${z} · ${freqStr}</text>
        </g>`;
    }).join('');
  }

  return `
    <div class="sc-card">
      <div class="sc-card-title">${title}</div>
      <div class="sc-card-sub">
        FGM/FGA: <span style="color:var(--blue);">${fgm}/${fga}</span> (${fgPct}%) &nbsp;·&nbsp;
        eFG%: <span style="color:var(--blue);">${efgPct}%</span> &nbsp;·&nbsp;
        3PAr: <span style="color:var(--blue);">${threePar}%</span>
      </div>
      <svg viewBox="-250 -47.5 500 470" style="width:100%;max-width:480px;height:auto;display:block;border:1px solid var(--border);">
        ${courtLines}
        ${overlay}
      </svg>
    </div>`;
}

function renderShotPage() {
  if (!_shotData) return;
  const pidVal = document.getElementById('scPlayer').value;
  const pid = pidVal === 'ALL' ? null : Number(pidVal);
  const playerName = document.getElementById('scPlayer').selectedOptions.text;
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
    grid.innerHTML = buildCourtCard(`${playerName} — Individual Shot Chart`, sub, view);
    return;
  }

  if (pid === null) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:12px;">Select a specific player from the dropdown above to compare On-Court vs. Off-Court shot locations.</div>`;
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
