with open("pipeline/build_shot_charts.py", encoding="utf-8") as f:
    code = f.read()

# Remove any older Steal:/Block: block if present
start_idx = code.find('        if "Steal:" in desc:')
end_idx = code.find('        if act in ["Made Shot", "Missed Shot"] and tm != "":', start_idx)
if start_idx != -1 and end_idx != -1:
    code = code[:start_idx] + code[end_idx:]

exact_stl_blk = '''        if tm == TEAM and ("STEAL (" in desc or "BLOCK (" in desc):
            ev_pid = int(row.get("personId", 0) or 0)
            if ev_pid in mxc_ids:
                all_events.append({
                    "gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"],
                    "p": p, "pid": ev_pid, "type": "STL" if "STEAL (" in desc else "BLK", "on": sorted(list(on))
                })

'''

code = code.replace('        if act in ["Made Shot", "Missed Shot"] and tm != "":', exact_stl_blk + '        if act in ["Made Shot", "Missed Shot"] and tm != "":')

with open("pipeline/build_shot_charts.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Fixed STL & BLK extraction (matching STEAL ( and BLOCK ( with exact personId)!")
