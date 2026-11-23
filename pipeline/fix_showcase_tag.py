import json

d = json.load(open("data/shot_charts_2025-26.json", encoding="utf-8"))

# G League GAME_ID prefixes: 205xx = Tip-Off / Showcase (16 games), 202xx = Regular Season (34 games)
show_gids = {g["id"] for g in d.get("games", []) if g["id"].startswith("205")}
for key in ["shots", "poss", "fts", "turnovers"]:
    for item in d.get(key, []):
        item["st"] = "Showcase" if item.get("gid") in show_gids else "Regular Season"

with open("data/shot_charts_2025-26.json", "w", encoding="utf-8") as f:
    json.dump(d, f)

with open("pipeline/build_shot_charts.py", encoding="utf-8") as f:
    py_code = f.read()

py_code = py_code.replace(
    'st = "Showcase" if str(gid).startswith("204") else "Regular Season"',
    'st = "Showcase" if str(gid).startswith("205") else "Regular Season"'
)
with open("pipeline/build_shot_charts.py", "w", encoding="utf-8") as f:
    f.write(py_code)

print(f"Tagged {len(show_gids)} Showcase games (205xx) and {len(d.get('games', [])) - len(show_gids)} Regular Season games (202xx)!")
