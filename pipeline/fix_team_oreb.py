with open("pipeline/build_shot_charts.py", encoding="utf-8") as f:
    code = f.read()

# Track non-final free throw state so dead-ball FT placeholder rebounds are excluded while live team rebounds are included
code = code.replace(
    '    poss_pts = 0\n    poss_oreb = 0',
    '    poss_pts = 0\n    poss_oreb = 0\n    non_final_ft = False'
)
code = code.replace(
    '        if act in ["Made Shot", "Missed Shot"] and tm != "":',
    '        if act in ["Made Shot", "Missed Shot"] and tm != "":\n            non_final_ft = False'
)
code = code.replace(
    '        elif act == "Turnover" and tm != "":',
    '        elif act == "Turnover" and tm != "":\n            non_final_ft = False'
)
code = code.replace(
    '        elif act == "Free Throw" and tm != "":',
    '        elif act == "Free Throw" and tm != "":\n            sub_ft_chk = str(row.get("subType", ""))\n            non_final_ft = any(x in sub_ft_chk for x in ["1 of 2", "1 of 3", "2 of 3"])'
)

start = code.find('        elif act == "Rebound"')
end = code.find('    close_poss(cur_p,', start)

true_team_reb = '''        elif act == "Rebound" and poss_tm != "":
            if not non_final_ft:
                r_pid = int(row.get("personId", 0) or 0)
                r_tid = int(row.get("teamId", 0) or 0)
                if tm == TEAM or r_tid == TEAM_ID or (r_pid > 0 and r_pid in mxc_ids):
                    reb_tm = TEAM
                elif tm != "" or r_tid > 0 or r_pid > 0:
                    reb_tm = "OPP"
                else:
                    reb_tm = ""

                if reb_tm == poss_tm:
                    poss_oreb += 1
                elif reb_tm != "":
                    close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 1)
                    poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0
            non_final_ft = False

'''

if start != -1 and end != -1:
    code = code[:start] + true_team_reb + code[end:]
    with open("pipeline/build_shot_charts.py", "w", encoding="utf-8") as f:
        f.write(code)
    print("Updated Rebound logic to true Team Rebound % (including live team rebounds, excluding dead-ball FT rebounds)!")
