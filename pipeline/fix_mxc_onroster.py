import json

ros = json.load(open("data/gleague_roster_2026-27.json", encoding="utf-8"))
mxc_names = {k for k, v in ros.get("nameToTeam", {}).items() if v == "MXC"}

for p_file in ["data/players_index.json", "data/players.json"]:
    try:
        pdata = json.load(open(p_file, encoding="utf-8"))
        items = pdata if isinstance(pdata, list) else list(pdata.values())
        for obj in items:
            if not isinstance(obj, dict) or not obj.get("name"):
                continue
            low = obj["name"].strip().lower()
            if "onRoster" in obj:
                obj["onRoster"] = (low in mxc_names)
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(pdata, f, indent=2)
    except Exception:
        pass

# Also fix fetch_transactions.py so future syncs only mark MXC players as onRoster
ft = open("pipeline/fetch_transactions.py", encoding="utf-8").read()
ft = ft.replace("in_gl = low in name_to_team", "in_gl = (name_to_team.get(low) == 'MXC')")
open("pipeline/fetch_transactions.py", "w", encoding="utf-8").write(ft)

print(f"Restored onRoster (yellow outline) strictly to {len(mxc_names)} Capitanes (MXC) players!")
