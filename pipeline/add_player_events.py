with open("pipeline/build_shot_charts.py", encoding="utf-8") as f:
    code = f.read()

# 1. Add all_events list for AST, OREB, DREB, STL, BLK
code = code.replace("all_poss = []", "all_poss = []\nall_events = []")

# 2. Mark whether a Made Shot was assisted ("AST)" in description) and log the assister's ID
old_shot_append = '''                all_shots.append({
                    "gid": gid,
                    "gord": gm["order"],
                    "loc": gm["loc"],
                    "wl": gm["wl"],
                    "st": gm["st"],
                    "p": p,
                    "side": "off" if tm == TEAM else "def",
                    "pid": shooter_id,
                    "shooter": player_names.get(shooter_id, ""),
                    "made": 1 if act == "Made Shot" else 0,
                    "val": 3 if is_3 else 2,
                    "dist": int(row.get("shotDistance", 0) or 0),
                    "sub": str(row.get("subType", "")),
                    "x": int(x_val),
                    "y": int(y_val),
                    "on": sorted(list(on)),
                })'''

new_shot_append = '''                is_astd = 1 if (act == "Made Shot" and "AST)" in desc) else 0
                all_shots.append({
                    "gid": gid,
                    "gord": gm["order"],
                    "loc": gm["loc"],
                    "wl": gm["wl"],
                    "st": gm["st"],
                    "p": p,
                    "side": "off" if tm == TEAM else "def",
                    "pid": shooter_id,
                    "shooter": player_names.get(shooter_id, ""),
                    "made": 1 if act == "Made Shot" else 0,
                    "astd": is_astd,
                    "val": 3 if is_3 else 2,
                    "dist": int(row.get("shotDistance", 0) or 0),
                    "sub": str(row.get("subType", "")),
                    "x": int(x_val),
                    "y": int(y_val),
                    "on": sorted(list(on)),
                })
                if is_astd and tm == TEAM:
                    for _, rr in ros.iterrows():
                        ast_pid = int(rr["personId"])
                        if ast_pid != shooter_id and f"({rr['familyName']} " in desc:
                            all_events.append({"gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"], "p": p, "pid": ast_pid, "type": "AST", "on": sorted(list(on))})
                            break'''

code = code.replace(old_shot_append, new_shot_append)

# 3. Log player OREB, DREB, STL, and BLK events
ev_hook = '''        if act in ["Steal", "Block"] and tm == TEAM:
            ev_pid = int(row.get("personId", 0) or 0)
            if ev_pid in mxc_ids:
                all_events.append({"gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"], "p": p, "pid": ev_pid, "type": "STL" if act == "Steal" else "BLK", "on": sorted(list(on))})
'''
code = code.replace('        if act in ["Made Shot", "Missed Shot"] and tm != "":', ev_hook + '\n        if act in ["Made Shot", "Missed Shot"] and tm != "":')

code = code.replace(
    '                if reb_tm == poss_tm:\n                    poss_oreb += 1',
    '                if reb_tm == poss_tm:\n                    poss_oreb += 1\n                    if r_pid in mxc_ids:\n                        all_events.append({"gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"], "p": p, "pid": r_pid, "type": "OREB", "on": sorted(list(on))})'
)
code = code.replace(
    '                elif reb_tm != "":\n                    close_poss(',
    '                elif reb_tm != "":\n                    if r_pid in mxc_ids:\n                        all_events.append({"gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"], "p": p, "pid": r_pid, "type": "DREB", "on": sorted(list(on))})\n                    close_poss('
)

code = code.replace('"turnovers": all_tovs,', '"turnovers": all_tovs,\n    "events": all_events,')

with open("pipeline/build_shot_charts.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Added AST, OREB, DREB, STL, BLK & Assisted Shot flags to build_shot_charts.py!")
