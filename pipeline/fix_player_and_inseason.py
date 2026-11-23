import re

# 1. Fix player.html so ?name= renders the G League Lite Shot Chart without throwing "(no id given)"
with open("player.html", encoding="utf-8") as f:
    ph = f.read()

ph = ph.replace(
    "if (!id) throw new Error('(no id given)');",
    "if (!id && new URLSearchParams(window.location.search).get('name')) return; if (!id) throw new Error('(no id given)');"
)

with open("player.html", "w", encoding="utf-8") as f:
    f.write(ph)

# 2. Ensure inseason.html loads js/app.js?v=2028 and has a clean, error-free search handler
with open("inseason.html", encoding="utf-8") as f:
    ih = f.read()

ih = re.sub(r'js/app\.js(\?v=\d+)?', 'js/app.js?v=2028', ih)
with open("inseason.html", "w", encoding="utf-8") as f:
    f.write(ih)

print("Fixed player.html ?name= handling & bumped inseason.html to js/app.js?v=2028!")
