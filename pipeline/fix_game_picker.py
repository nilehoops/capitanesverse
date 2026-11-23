import re

with open("js/shot-charts.js", encoding="utf-8") as f:
    js = f.read()

# 1. Remove any partial/broken multi-game block if present so we start clean
js = re.sub(r'const _incGames = new Set\(\);.*?function buildGameMenu\(\) \{.*?\n\}\n', '', js, flags=re.S)

# 2. Insert clean, self-contained multi-game picker logic at the top
picker_code = '''const _incGames = new Set();
const _excGames = new Set();

function toggleGameMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('scGameMenu');
  if (menu) menu.classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('scGameMenu');
  const btn = document.getElementById('scGameBtn');
  if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.remove('open');
  }
});

function toggleGameFilter(gid, mode) {
  if (mode === 'inc') {
    if (_incGames.has(gid)) _incGames.delete(gid);
    else { _excGames.delete(gid); _incGames.add(gid); }
  } else {
    if (_excGames.has(gid)) _excGames.delete(gid);
    else { _incGames.delete(gid); _excGames.add(gid); }
  }
  buildGameMenu();
  renderShotPage();
}

function clearGameFilters() {
  _incGames.clear();
  _excGames.clear();
  buildGameMenu();
  renderShotPage();
}

function resetAllFilters() {
  _incGames.clear();
  _excGames.clear();
  ['scSegment','scLocation','scOutcome','scLastN','scPeriod','scShotType'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 'ALL';
  });
  buildGameMenu();
  renderShotPage();
}

function buildGameMenu() {
  const menu = document.getElementById('scGameMenu');
  const btn = document.getElementById('scGameBtn');
  if (!menu || !_shotData) return;
  const games = _shotData.games || [];

  if (btn) {
    if (_incGames.size > 0) btn.textContent = `Games: ${_incGames.size} selected ▾`;
    else if (_excGames.size > 0) btn.textContent = `Games: ${_excGames.size} excluded ▾`;
    else btn.textContent = `All Games (${games.length}) ▾`;
  }

  const head = `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-bottom:1px solid var(--border);background:var(--surface);font-family:'Oswald',sans-serif;font-size:9.5px;position:sticky;top:0;">
    <span style="color:var(--muted);">✓ INCLUDE &nbsp;|&nbsp; ✕ EXCLUDE</span>
    <button type="button" onclick="clearGameFilters()" style="font-family:'Oswald',sans-serif;font-size:9px;padding:1px 6px;border:1px solid var(--border);background:var(--bg);cursor:pointer;">Clear</button>
  </div>`;

  const rows = games.map(g => {
    const isInc = _incGames.has(g.id);
    const isExc = _excGames.has(g.id);
    return `<div class="sc-game-row">
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${isExc ? 'var(--muted);text-decoration:line-through' : 'var(--text)'};" title="${g.label}">${g.label}</span>
      <div style="display:flex;gap:3px;flex-shrink:0;">
        <button type="button" class="sc-gbtn ${isInc ? 'inc-active' : ''}" onclick="toggleGameFilter('${g.id}','inc')">✓</button>
        <button type="button" class="sc-gbtn ${isExc ? 'exc-active' : ''}" onclick="toggleGameFilter('${g.id}','exc')">✕</button>
      </div>
    </div>`;
  }).join('');

  menu.innerHTML = head + rows;
}
'''

js = picker_code + "\n" + js

# 3. Ensure buildGameMenu() is called right after buildRosterStrip() in loadShotSeason()
if "buildGameMenu();" not in js:
    js = js.replace("buildRosterStrip();", "buildGameMenu();\n    buildRosterStrip();", 1)

# 4. Ensure matchBaseFilters() checks _incGames and _excGames
js = js.replace(
    "if (gameVal !== 'ALL' && item.gid !== gameVal) return false;",
    "if (_incGames.size > 0 && !_incGames.has(item.gid)) return false;\n  if (_excGames.has(item.gid)) return false;"
)
if "_incGames.has(item.gid)" not in js:
    js = js.replace(
        "function matchBaseFilters(item, gameVal, segVal, locVal, outVal, minOrder, periodVal) {",
        "function matchBaseFilters(item, gameVal, segVal, locVal, outVal, minOrder, periodVal) {\n  if (_incGames.size > 0 && !_incGames.has(item.gid)) return false;\n  if (_excGames.has(item.gid)) return false;"
    )

with open("js/shot-charts.js", "w", encoding="utf-8") as f:
    f.write(js)

with open("shotcharts.html", encoding="utf-8") as f:
    h = f.read()
h = re.sub(r'shot-charts\.js(\?v=\d+)?', 'shot-charts.js?v=55', h)
with open("shotcharts.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Fixed multi-game ✓/✕ picker and bumped cache to v=55!")
