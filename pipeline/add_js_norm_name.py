norm_js = '''function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,'’\\-]/g, ' ')
    .split(/\\s+/)
    .filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w))
    .join(' ');
}
'''

# 1. Update team.html nameToId lookup
th = open("team.html", encoding="utf-8").read()
if "function normName" not in th:
    th = th.replace("<script>", "<script>\n" + norm_js, 1)
th = th.replace("nameToId[p.name.toLowerCase()] = p.id", "nameToId[normName(p.name)] = p.id")
th = th.replace("nameToId[p.name.toLowerCase()]", "nameToId[normName(p.name)]")
open("team.html", "w", encoding="utf-8").write(th)

# 2. Update player.html Lite Shot Chart name matching
ph = open("player.html", encoding="utf-8").read()
if "function normName" not in ph:
    ph = ph.replace("(async function initPlayerLiteShotChart() {", norm_js + "\n(async function initPlayerLiteShotChart() {", 1)
ph = ph.replace("p.name.toLowerCase() === targetName.toLowerCase()", "normName(p.name) === normName(targetName)")
open("player.html", "w", encoding="utf-8").write(ph)

# 3. Update js/inseason-search.js deduplication & search matching
sj = open("js/inseason-search.js", encoding="utf-8").read()
if "function normName" not in sj:
    sj = norm_js + "\n" + sj
sj = sj.replace("p.name.trim().toLowerCase()", "normName(p.name)")
sj = sj.replace("rp.name.trim().toLowerCase()", "normName(rp.name)")
sj = sj.replace("it.name.toLowerCase().includes(q)", "(it.name.toLowerCase().includes(q) || normName(it.name).includes(normName(q)))")
open("js/inseason-search.js", "w", encoding="utf-8").write(sj)

print("Added normName() across team.html, player.html, and js/inseason-search.js!")
