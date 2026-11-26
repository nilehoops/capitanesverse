import json, re, unicodedata

def tokens(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9\s]", " ", s.lower())
    return [w for w in s.split() if w and w not in {"jr", "sr", "ii", "iii", "iv", "v", "de", "del", "dos", "da"}]

def is_same_player(r_name, db_name):
    rt, dt = tokens(r_name), tokens(db_name)
    if not rt or not dt:
        return False
    if rt == dt:
        return True
    # Subset match when both have >=2 tokens (e.g. ['agapy','santos'] <= ['agapy','melo','santos'] or ['esteban','roacho'] <= ['esteban','ezequiel','roacho','amador'])
    if len(dt) >= 2 and set(dt).issubset(set(rt)) and dt[0] == rt[0]:
        return True
    if len(rt) >= 2 and set(rt).issubset(set(dt)) and dt[0] == rt[0]:
        return True
    return False

ros = json.load(open("data/gleague_roster_2026-27.json", encoding="utf-8"))
mxc_players = [p for p in (ros.get("players") or []) if p.get("team") == "MXC" and p.get("name")]
mxc_names = [p["name"] for p in mxc_players]

matched_mxc = set()
for p_file in ["data/players_index.json", "data/players.json"]:
    try:
        pdata = json.load(open(p_file, encoding="utf-8"))
        items = pdata if isinstance(pdata, list) else list(pdata.values())
        for obj in items:
            if not isinstance(obj, dict) or not obj.get("name"):
                continue
            hit = next((mn for mn in mxc_names if is_same_player(mn, obj["name"])), None)
            if hit:
                matched_mxc.add(hit)
                obj["onRoster"] = True
            elif "onRoster" in obj:
                obj["onRoster"] = False
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(pdata, f, indent=2)
    except Exception:
        pass


TEMP_MXC_IDS = {"juan-reyna-iii"}
for p_file in ["data/players_index.json", "data/players.json"]:
    try:
        pdata = json.load(open(p_file, encoding="utf-8"))
        items = pdata if isinstance(pdata, list) else list(pdata.values())
        for obj in items:
            if isinstance(obj, dict) and obj.get("id") in TEMP_MXC_IDS:
                obj["onRoster"] = True
        with open(p_file, "w", encoding="utf-8") as f:
            json.dump(pdata, f, indent=2)
    except Exception:
        pass

missing_from_db = [p for p in mxc_players if p["name"] not in matched_mxc]
audit = {
    "season": "2026-27",
    "activeCount": len(mxc_players),
    "matchedCount": len(matched_mxc),
    "missingFromDb": [{"name": p["name"], "id": p.get("id"), "pos": p.get("position", "")} for p in missing_from_db]
}
json.dump(audit, open("data/roster_audit.json", "w", encoding="utf-8"), indent=2)

print(f"Restored onRoster (yellow outline) to {len(matched_mxc)}/{len(mxc_players)} active Capitanes (MXC) players!", flush=True)
if missing_from_db:
    print("  [ACTION NEEDED ? Missing from Offseason DB]: " + ", ".join(p["name"] for p in missing_from_db), flush=True)
else:
    print("  [OK] All active MXC roster players are present in players_index.json!", flush=True)
