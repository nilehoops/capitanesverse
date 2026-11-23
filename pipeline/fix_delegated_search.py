import re

with open("inseason.html", encoding="utf-8") as f:
    h = f.read()

# Replace wireMainSearch with a delegated document listener + explicit solid background & z-index
old_js = re.search(r'<script>\s*\(async function wireMainSearch\(\).*?</script>', h, flags=re.S)

new_js = '''<script>
(async function wireMainSearch() {
  let res = document.getElementById('mainSearchRes');
  if (!res) {
    res = document.createElement('div');
    res.id = 'mainSearchRes';
  }
  document.body.appendChild(res);
  res.style.cssText = 'display:none;position:fixed;width:290px;max-height:300px;overflow-y:auto;background:#FFFFFF;border:1px solid #004B8D;box-shadow:0 6px 18px rgba(0,0,0,0.18);z-index:999999;font-size:11px;font-family:Lora,serif;';

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

  document.addEventListener('input', (e) => {
    if (!e.target || e.target.id !== 'mainSearch') return;
    const inp = e.target;
    const q = inp.value.trim().toLowerCase();
    if (!q) { res.style.display = 'none'; res.innerHTML = ''; return; }
    const hits = pool.filter(x => x.label.toLowerCase().includes(q) || x.sub.toLowerCase().includes(q)).slice(0, 10);
    const r = inp.getBoundingClientRect();
    res.style.top = (r.bottom + 2) + 'px';
    res.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + 'px';
    res.style.display = 'block';
    res.innerHTML = hits.map(x => `
      <a href="${x.href}" style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-bottom:1px solid #E2E5E9;text-decoration:none;color:${x.isTeam ? '#004B8D' : '#111111'};font-weight:${x.isTeam ? '700' : '600'};background:#FFFFFF;">
        <span>${x.label}</span>
        <span style="font-size:9.5px;color:#666666;margin-left:6px;">${x.sub}</span>
      </a>`).join('') || '<div style="padding:6px 8px;color:#666666;">No matches</div>';
  });

  document.addEventListener('click', (e) => {
    if (e.target?.id !== 'mainSearch' && !res.contains(e.target)) res.style.display = 'none';
  });
})();
</script>'''

if old_js:
    h = h[:old_js.start()] + new_js + h[old_js.end():]
    with open("inseason.html", "w", encoding="utf-8") as f:
        f.write(h)
    print("Upgraded #mainSearch with delegated listener & solid floating dropdown!")
