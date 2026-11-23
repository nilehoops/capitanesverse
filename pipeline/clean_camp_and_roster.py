import json
import re

# 1. Clean trainingCampInvite & restore onRoster strictly to MXC players
ros = json.load(open("data/gleague_roster_2026-27.json", encoding="utf-8"))
mxc_names = {k for k, v in ros.get("nameToTeam", {}).items() if v == "MXC"}

for p_file in ["data/players_index.json", "data/players.json", "data/players_detail.json"]:
    try:
        pdata = json.load(open(p_file, encoding="utf-8"))
        items = pdata if isinstance(pdata, list) else list(pdata.values())
        for obj in items:
            if not isinstance(obj, dict) or not obj.get("name"):
                continue
            low = obj["name"].strip().lower()
            if "onRoster" in obj:
                obj["onRoster"] = (low in mxc_names)
            if "trainingCampInvite" in obj:
                obj["trainingCampInvite"] = False
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(pdata, f, indent=2)
    except Exception:
        pass

# 2. Remove the 3 blue training camp slots & checkbox from index.html
with open("index.html", encoding="utf-8") as f:
    h = f.read()

h = re.sub(r'// Training camp invites: 3 extra slots.*?(?=\n\s*document\.getElementById|\n\s*const |\n\})', '', h, flags=re.S)
h = h.replace('<label class="addplayer-onroster"><input id="ap_trainingCampInvite" type="checkbox"> Training Camp Invite</label>', '')

with open("index.html", "w", encoding="utf-8") as f:
    f.write(h)

# 3. Ensure fetch_transactions.py only marks MXC players as onRoster
try:
    ft = open("pipeline/fetch_transactions.py", encoding="utf-8").read()
    ft = ft.replace("in_gl = low in name_to_team", "in_gl = (name_to_team.get(low) == 'MXC')")
    open("pipeline/fetch_transactions.py", "w", encoding="utf-8").write(ft)
except Exception:
    pass

print(f"Removed blue training camp slots & restored yellow roster tag strictly to {len(mxc_names)} Capitanes (MXC) players!")
