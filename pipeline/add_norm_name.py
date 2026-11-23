import re, unicodedata

norm_py = '''
def norm_name(s):
    if not s: return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[.,'’\\-]", " ", s.lower())
    parts = [w for w in s.split() if w not in {"jr", "sr", "ii", "iii", "iv", "v"}]
    return " ".join(parts)
'''

for fn in ["pipeline/enrich_team_profiles.py", "pipeline/fetch_transactions.py"]:
    try:
        code = open(fn, encoding="utf-8").read()
        if "def norm_name" not in code:
            code = "import re, unicodedata\n" + norm_py + "\n" + code
        code = code.replace('.strip().lower()', '')
        code = code.replace('item["name"].strip().lower()', 'norm_name(item["name"])')
        code = code.replace('item["name"]', 'norm_name(item["name"])')
        code = code.replace('rec["name"].lower()', 'norm_name(rec["name"])')
        code = code.replace('str(r.get("PLAYER", ""))', 'norm_name(r.get("PLAYER", ""))')
        code = code.replace('obj["name"]', 'norm_name(obj["name"])')
        open(fn, "w", encoding="utf-8").write(code)
    except Exception:
        pass

print("Added norm_name() across Python enrichment & roster pipelines!")
