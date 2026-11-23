import re

with open("index.html", encoding="utf-8") as f:
    h = f.read()

old_fn = re.search(r'function setupSearch\(players\) \{.*?\n\}', h, flags=re.S)

new_fn = '''function setupSearch(players) {
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  let searchPool = [...players];

  Promise.all([
    fetch('data/league_lite_shots_2026-27.json').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/gleague_roster_2026-27.json').then(r => r.ok ? r.json() : null).catch(() => null)
  ]).then(([lite, ros]) => {
    const existingNames = new Set(searchPool.map(p => (p.name || '').toLowerCase()));
    if (lite && lite.teams) {
      lite.teams.forEach(t => {
        searchPool.unshift({
          isTeam: true,
          id: t.abbrev || t.id,
          name: `${t.name} (${t.abbrev || 'G League'})`,
          position: 'TEAM LITE SHOT CHART',
          team: ''
        });
      });
    }
    if (ros && ros.players) {
      ros.players.forEach(rp => {
        if (rp.name && !existingNames.has(rp.name.toLowerCase())) {
          existingNames.add(rp.name.toLowerCase());
          searchPool.push({
            id: rp.name,
            name: rp.name,
            position: 'G League',
            team: rp.team || '',
            liteOnly: true
          });
        }
      });
    }
  });

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.innerHTML = ''; return; }
    const matches = searchPool.filter(p =>
      p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q)
    ).slice(0, 10);
    results.innerHTML = matches.map(p => {
      if (p.isTeam) {
        return `<a href="team.html?team=${encodeURIComponent(p.id)}" style="font-weight:700;color:var(--blue);">${p.name}<span class="pos">${p.position}</span></a>`;
      }
      if (p.liteOnly) {
        return `<a href="team.html?team=${encodeURIComponent(p.team || 'MXC')}">${p.name}<span class="pos">${p.position}${p.team ? ' · ' + p.team : ''}</span></a>`;
      }
      return `<a href="player.html?id=${p.id}">${nameHtml(p)}<span class="pos">${p.position || ''}${p.team ? ' · ' + p.team : ''}</span></a>`;
    }).join('') || `<div class="board-empty">No matches.</div>`;
  });
}'''

if old_fn:
    h = h[:old_fn.start()] + new_fn + h[old_fn.end():]
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(h)
    print("Upgraded setupSearch on index.html with all 31 G League Teams + 2026-27 Players!")
