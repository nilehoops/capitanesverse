import re

# 1. Remove the old wireMainSearch script from inseason.html so there are zero syntax errors
with open("inseason.html", encoding="utf-8") as f:
    h = f.read()

h = re.sub(r'<script>\s*\(async function wireMainSearch\(\).*?</script>', '', h, flags=re.S)
h = h.replace("<script src='js/app.js'></script>", "<script src='js/app.js?v=2027'></script>")

with open("inseason.html", "w", encoding="utf-8") as f:
    f.write(h)

# 2. Append clean, bracket-safe #mainSearch handler directly into js/app.js
search_addon = '''
// ── Global Top-Bar Search (#mainSearch on inseason.html) ──────────────────────
(async function initInseasonMainSearch() {
  const inp = document.getElementById('mainSearch');
  if (!inp) return;

  let res = document.getElementById('mainSearchRes');
  if (!res) {
    res = document.createElement('div');
    res.id = 'mainSearchRes';
  }
  document.body.appendChild(res);
  res.style.cssText = 'display:none;position:fixed;width:290px;max-height:300px;overflow-y:auto;background:#FFFFFF;border:1px solid #004B8D;box-shadow:0 6px 18px rgba(0,0,0,0.18);z-index:999999;font-size:11px;font-family:Lora,serif;';

  const pool = new Array();
  const seen = new Set();

  const responses = await Promise.all(new Array(
    fetch('data/league_lite_shots_2026-27.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/gleague_roster_2026-27.json?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/players_index.json?v=' + Date.now()).then(r => r.ok ? r.json() : new Array()).catch(() => new Array())
  ));

  const lite = responses.shift();
  const ros = responses.shift();
  const idx = responses.shift();

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

  const idxArr = Array.isArray(idx) ? idx : Object.values(idx || {});
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
    if (!q) {
      res.style.display = 'none';
      res.innerHTML = '';
      return;
    }
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
    if (e.target !== inp && !res.contains(e.target)) {
      res.style.display = 'none';
    }
  });
})();
'''

with open("js/app.js", encoding="utf-8") as f:
    app_js = f.read()

if "initInseasonMainSearch" not in app_js:
    with open("js/app.js", "w", encoding="utf-8") as f:
        f.write(app_js + "\n" + search_addon)

print("Wired #mainSearch cleanly inside js/app.js (v=2027)!")
