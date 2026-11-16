import re

# 1. Clean any previous search patches out of inseason.html and js/app.js
with open("inseason.html", encoding="utf-8") as f:
    ih = f.read()

ih = re.sub(r'<div style="position:relative;display:inline-block;">\s*<input id="mainSearch".*?</div>\s*</div>',
            '<input id="mainSearch" type="text" placeholder="(players or teams)" autocomplete="off">', ih, flags=re.S)
ih = re.sub(r'<script>\s*\(async function wireMainSearch\(\).*?</script>\s*', '', ih, flags=re.S)
ih = re.sub(r'<script src=["\']js/inseason-search\.js(\?v=\d+)?["\']></script>\s*', '', ih)
ih = ih.replace('</body>', '<script src="js/inseason-search.js?v=1"></script>\n</body>')

with open("inseason.html", "w", encoding="utf-8") as f:
    f.write(ih)

with open("js/app.js", encoding="utf-8") as f:
    aj = f.read()

aj = re.sub(r'// ── Global Top-Bar Search.*?$', '', aj, flags=re.S)
with open("js/app.js", "w", encoding="utf-8") as f:
    f.write(aj.rstrip() + "\n")

print("Cleaned inseason.html and js/app.js for dedicated js/inseason-search.js!")
