with open("inseason.html", encoding="utf-8") as f:
    h = f.read()

old_block = '''  const inp = document.getElementById('mainSearch');
  const res = document.getElementById('mainSearchRes');
  if (!inp || !res) return;'''

new_block = '''  const inp = document.getElementById('mainSearch');
  const res = document.getElementById('mainSearchRes');
  if (!inp || !res) return;
  document.body.appendChild(res);
  res.style.position = 'fixed';
  res.style.width = '280px';
  const positionDropdown = () => {
    const r = inp.getBoundingClientRect();
    res.style.top = (r.bottom + 2) + 'px';
    res.style.left = Math.min(r.left, window.innerWidth - 290) + 'px';
  };'''

h = h.replace(old_block, new_block)
h = h.replace("res.style.display = 'block';", "positionDropdown();\n    res.style.display = 'block';")

with open("inseason.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Fixed #mainSearchRes floating position on inseason.html!")
