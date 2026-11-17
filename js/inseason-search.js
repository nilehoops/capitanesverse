function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,'’\-]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w))
    .join(' ');
}

﻿(async function buildInseasonSearch() {
  const inp = document.getElementById('mainSearch');
  if (!inp) return;

  const box = document.createElement('div');
  box.id = 'inseasonSearchDropdown';
  box.style.cssText = [
    'display:none',
    'position:fixed',
    'width:310px',
    'max-height:340px',
    'overflow-y:auto',
    'background:#FFFFFF',
    'border:1px solid #004B8D',
    'box-shadow:0 8px 20px rgba(0,0,0,0.18)',
    'z-index:999999',
    'font-family:Lora,serif',
    'font-size:11.5px'
  ].join(';');
  document.body.appendChild(box);

  const items = new Array();
  const seenNames = new Set();

  const fetched = await Promise.all(new Array(
    fetch('data/league_lite_shots_2026-27.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/players_index.json?v=' + Date.now()).then(r => r.ok ? r.json() : new Array()).catch(() => new Array()),
    fetch('data/gleague_roster_2026-27.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null)
  ));

  const lite = fetched.shift();
  const idx = fetched.shift();
  const ros = fetched.shift();

  // 1. All 31 G League Teams -> team.html
  if (lite && Array.isArray(lite.teams)) {
    lite.teams.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(t => {
      const code = t.abbrev || t.id;
      items.push({
        kind: 'team',
        name: t.name,
        code: code,
        meta: 'TEAM SHOT PROFILE',
        href: `team.html?team=${encodeURIComponent(code)}`
      });
    });
  }

  // 2. Scouting Database Players -> player.html?id=...
  const idxList = Array.isArray(idx) ? idx : Object.values(idx || {});
  idxList.forEach(p => {
    if (!p || !p.name) return;
    seenNames.add(normName(p.name));
    items.push({
      kind: p.onRoster ? 'mxc' : 'player',
      name: p.name,
      code: p.team || '',
      meta: p.onRoster ? 'MXC ROSTER' : `${p.position || ''}${p.team ? ' · ' + p.team : ''}`,
      href: `player.html?id=${encodeURIComponent(p.id)}`
    });
  });

  // 3. Remaining Active 2026-27 G League Players -> player.html?name=...
  if (ros && Array.isArray(ros.players)) {
    ros.players.forEach(rp => {
      if (!rp || !rp.name) return;
      const low = rnormName(p.name);
      if (seenNames.has(low)) return;
      seenNames.add(low);
      items.push({
        kind: 'player',
        name: rp.name,
        code: rp.team || '',
        meta: `G LEAGUE · ${rp.team || ''}`,
        href: `player.html?name=${encodeURIComponent(rp.name)}`
      });
    });
  }

  let activeIdx = -1;
  let currentHits = new Array();

  function positionBox() {
    const r = inp.getBoundingClientRect();
    box.style.top = (r.bottom + 3) + 'px';
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 320)) + 'px';
  }

  function renderHits() {
    if (!currentHits.length) {
      box.innerHTML = '<div style="padding:7px 10px;color:#666;">No matching players or teams</div>';
      return;
    }
    box.innerHTML = currentHits.map((it, i) => {
      const isSel = i === activeIdx;
      const bg = isSel ? '#EEF4FB' : '#FFFFFF';
      const badge = it.kind === 'mxc'
        ? '<span style="background:#FFD400;color:#1631FF;font-family:Oswald,sans-serif;font-size:9px;font-weight:700;padding:1px 4px;">MXC</span>'
        : `<span style="font-family:Oswald,sans-serif;font-size:9px;color:${it.kind === 'team' ? '#004B8D' : '#666'};font-weight:700;">${it.meta}</span>`;
      const nameColor = it.kind === 'team' ? '#004B8D' : '#111111';
      return `<a href="${it.href}" data-idx="${i}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid #E5E8EC;text-decoration:none;background:${bg};color:${nameColor};font-weight:${it.kind === 'team' || it.kind === 'mxc' ? '700' : '600'};">
        <span>${it.name}${it.kind === 'team' && it.code ? ' (' + it.code + ')' : ''}</span>
        <span style="margin-left:8px;flex-shrink:0;">${badge}</span>
      </a>`;
    }).join('');
  }

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    activeIdx = -1;
    if (!q) {
      box.style.display = 'none';
      currentHits = new Array();
      return;
    }
    currentHits = items.filter(it =>
      (it.name.toLowerCase().includes(q) || normName(it.name).includes(normName(q))) || it.code.toLowerCase().includes(q)
    ).slice(0, 12);
    positionBox();
    box.style.display = 'block';
    renderHits();
  });

  inp.addEventListener('keydown', (e) => {
    if (box.style.display === 'none' || !currentHits.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % currentHits.length;
      renderHits();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + currentHits.length) % currentHits.length;
      renderHits();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = activeIdx >= 0 ? currentHits.slice(activeIdx, activeIdx + 1).pop() : currentHits.slice(0, 1).pop();
      if (pick) window.location.href = pick.href;
    } else if (e.key === 'Escape') {
      box.style.display = 'none';
    }
  });

  window.addEventListener('resize', () => { if (box.style.display === 'block') positionBox(); });
  document.addEventListener('click', (e) => {
    if (e.target !== inp && !box.contains(e.target)) box.style.display = 'none';
  });
})();
