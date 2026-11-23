import re

with open("inseason.html", encoding="utf-8") as f:
    h = f.read()

# 1. Remove any duplicate #inseasonSearch block if present
h = re.sub(r'<div style="position:relative;display:inline-block;">\s*<input id="inseasonSearch".*?</div>\s*', '', h, flags=re.S)
h = re.sub(r'<script>\s*\(async function initInseasonSearch\(\).*?</script>\s*', '', h, flags=re.S)

# 2. Add dropdown container right inside .page-search next to #mainSearch
if 'id="mainSearchRes"' not in h:
    h = h.replace(
        '<input id="mainSearch" type="text" placeholder="(players or teams)">',
        '<div style="position:relative;display:inline-block;"><input id="mainSearch" type="text" placeholder="(players or teams)" autocomplete="off"><div id="mainSearchRes" style="display:none;position:absolute;top:100%;left:0;width:260px;max-height:280px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);box-shadow:0 4px 12px rgba(0,0,0,0.14);z-index:9999;font-size:11px;"></div></div>'
    )

# 3. Populate #mainSearchRes with all 31 G League teams + 2026-27/2025-26 players
main_search_js = '''<script>
(async function wireMainSearch() {
  const inp = document.getElementById('mainSearch');
  const res = document.getElementById('mainSearchRes');
  if (!inp || !res) return;

  const pool = [];
  const seen = new Set();

  const [lite, ros, idx] = await Promise.all([
    fetch('data/league_lite_shots_2026-27.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/gleague_roster_2026-27.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/players_index.json?v=' + Date.now()).then(r => r.ok ? r.json() : []).catch(() => [])
  ]);

  if (lite && lite.teams) {
    lite.teams.forEach(t => {
      pool.push({
        isTeam: true,
        label: `${t.name} (${t.abbrev || 'GL'})`,
        sub: 'Team Shot Profile',
        href: `team.html?team=${encodeURIComponent(t.abbrev || t.id)}`
      });
    });
  }

  const idxArr = Array.isArray(idx) ? idx : Object.values(idx);
  idxArr.forEach(p => {
    if (!p || !p.name) return;
    seen.add(p.name.toLowerCase());
    pool.push({
      label: p.name,
      sub: `${p.position || ''}${p.team ? ' · ' + p.team : ''}`,
      href: `player.html?id=${encodeURIComponent(p.id)}`
    });
  });

  if (ros && ros.players) {
    ros.players.forEach(rp => {
      if (rp.name && !seen.has(rp.name.toLowerCase())) {
        seen.add(rp.name.toLowerCase());
        pool.push({
          label: rp.name,
          sub: `G League · ${rp.team || ''}`,
          href: `player.html?name=${encodeURIComponent(rp.name)}`
        });
      }
    });
  }

  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { res.style.display = 'none'; res.innerHTML = ''; return; }
    const hits = pool.filter(x => x.label.toLowerCase().includes(q) || x.sub.toLowerCase().includes(q)).slice(0, 10);
    res.style.display = 'block';
    res.innerHTML = hits.map(x => `
      <a href="${x.href}" style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-bottom:1px solid var(--border);text-decoration:none;color:${x.isTeam ? 'var(--blue)' : 'var(--text)'};font-weight:${x.isTeam ? '700' : '600'};">
        <span>${x.label}</span>
        <span style="font-size:9.5px;color:var(--muted);margin-left:6px;">${x.sub}</span>
      </a>`).join('') || '<div style="padding:6px 8px;color:var(--muted);">No matches</div>';
  });

  document.addEventListener('click', (e) => {
    if (!inp.contains(e.target) && !res.contains(e.target)) res.style.display = 'none';
  });
})();
</script>
</body>'''

if 'wireMainSearch' not in h:
    h = h.replace('</body>', main_search_js)

with open("inseason.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Wired existing #mainSearch on inseason.html to all 31 G League teams & players!")
