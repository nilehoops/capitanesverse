with open("pipeline/build_shot_charts.py", encoding="utf-8") as f:
    code = f.read()

# Replace any existing Rebound handler with exact player-ID + team-tricode OREB/DREB detection
old_block_start = code.find('        elif act == "Rebound"')
old_block_end = code.find('    close_poss(cur_p,', old_block_start)

new_reb_block = '''        elif act == "Rebound" and poss_tm != "":
            r_pid = int(row.get("personId", 0) or 0)
            reb_tm = tm if tm != "" else (TEAM if (r_pid in mxc_ids or "CAPITANES" in desc.upper() or "MEXICO CITY" in desc.upper()) else "OPP")
            if reb_tm == poss_tm:
                poss_oreb += 1
            else:
                close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 1)
                poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0

'''

if old_block_start != -1 and old_block_end != -1:
    code = code[:old_block_start] + new_reb_block + code[old_block_end:]
    with open("pipeline/build_shot_charts.py", "w", encoding="utf-8") as f:
        f.write(code)
    print("Fixed Rebound OREB/DREB detection in build_shot_charts.py!")
else:
    print("Could not locate Rebound block.")
