with open("pipeline/build_shot_charts.py", encoding="utf-8") as f:
    py_code = f.read()

py_code = py_code.replace(
    '    poss_fga = 0\n    poss_fta = 0\n    poss_tov = 0',
    '    poss_fga = 0\n    poss_fta = 0\n    poss_tov = 0\n    poss_pts = 0\n    poss_oreb = 0'
)
py_code = py_code.replace(
    '    def close_poss(p_num, side_tm, lineup_set, fga_c, fta_c, tov_c):',
    '    def close_poss(p_num, side_tm, lineup_set, fga_c, fta_c, tov_c, pts_c=0, oreb_c=0, dreb_c=0):'
)
py_code = py_code.replace(
    '                "side": "off" if side_tm == TEAM else "def",\n                "on": sorted(list(lineup_set)),',
    '                "side": "off" if side_tm == TEAM else "def",\n                "pts": pts_c,\n                "oreb": oreb_c,\n                "dreb": dreb_c,\n                "on": sorted(list(lineup_set)),'
)
py_code = py_code.replace('poss_fga, poss_fta, poss_tov = 0, 0, 0', 'poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = 0, 0, 0, 0, 0')
py_code = py_code.replace('close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov)', 'close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)')
py_code = py_code.replace('close_poss(cur_p, poss_tm, on, poss_fga, poss_fta, poss_tov)', 'close_poss(cur_p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)')

# Track points on made shots & FTs, and offensive vs defensive rebounds
py_code = py_code.replace(
    '            if act == "Made Shot" and (p, str(row["clock"])) not in ft_clocks:',
    '            if act == "Made Shot":\n                poss_pts += (3 if ("3PT" in desc or row.get("shotValue", 0) == 3) else 2)\n            if act == "Made Shot" and (p, str(row["clock"])) not in ft_clocks:'
)
py_code = py_code.replace(
    '            if is_made and any(tag in sub_ft for tag in ["1 of 1", "2 of 2", "3 of 3"]):',
    '            if is_made:\n                poss_pts += 1\n            if is_made and any(tag in sub_ft for tag in ["1 of 1", "2 of 2", "3 of 3"]):'
)
old_reb = '''        elif act == "Rebound" and tm != "" and poss_tm != "" and tm != poss_tm:
            close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
            poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0'''

new_reb = '''        elif act == "Rebound" and tm != "" and poss_tm != "":
            if tm == poss_tm:
                poss_oreb += 1
            else:
                close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 1)
                poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0'''

py_code = py_code.replace(old_reb, new_reb)

with open("pipeline/build_shot_charts.py", "w", encoding="utf-8") as f:
    f.write(py_code)

print("Patched build_shot_charts.py with exact pts, oreb & dreb!")
