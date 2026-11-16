import json
import sys
import time
import pandas as pd
from nba_api.stats.endpoints import (
    leaguegamefinder,
    playbyplayv3,
    boxscoretraditionalv3,
    shotchartdetail,
)

LEAGUE_ID = "20"
SEASON = sys.argv[1] if len(sys.argv) > 1 else "2025-26"
TEAM = "MXC"
TEAM_ID = 1612709931
OUT_FILE = f"data/shot_charts_{SEASON}.json"

print(f"1/2 Fetching {SEASON} G League Zone Benchmarks...")
lg_dfs = []
for st in ["Showcase", "Regular Season"]:
    try:
        frames = shotchartdetail.ShotChartDetail(
            league_id=LEAGUE_ID,
            season_nullable=SEASON,
            season_type_all_star=st,
            team_id=TEAM_ID,
            player_id=0,
            context_measure_simple="FGA",
        ).get_data_frames()
        lg_df = frames[1]
        if not lg_df.empty:
            lg_dfs.append(lg_df)
        time.sleep(0.7)
    except Exception as e:
        print(f"  [Note] {st} benchmarks skipped: {e}")

zone_bench = []
if lg_dfs:
    zb = (
        pd.concat(lg_dfs, ignore_index=True)
        .groupby(["SHOT_ZONE_BASIC", "SHOT_ZONE_AREA", "SHOT_ZONE_RANGE"], as_index=False)
        .agg({"FGA": "sum", "FGM": "sum"})
    )
    zb["LG_FG_PCT"] = (zb["FGM"] / zb["FGA"].replace(0, pd.NA)).fillna(0.0).round(4)
    zone_bench = zb.to_dict(orient="records")

print(f"2/2 Parsing {SEASON} Exact Possessions, Shots, FTs & Turnovers...")
df_games = leaguegamefinder.LeagueGameFinder(
    league_id_nullable=LEAGUE_ID, season_nullable=SEASON
).get_data_frames()[0]
mxc_games = df_games[df_games["TEAM_ABBREVIATION"] == TEAM].drop_duplicates(subset=["GAME_ID"]).sort_values("GAME_DATE")

if mxc_games.empty:
    print(f"No {SEASON} games found yet for {TEAM}.")
    sys.exit(0)

games_out = []
game_meta = {}
for idx_g, (_, gr) in enumerate(mxc_games.iterrows(), 1):
    gid = gr["GAME_ID"]
    sid = str(gr.get("SEASON_ID", ""))
    st = "Showcase" if str(gid).startswith("205") else "Regular Season"
    matchup = str(gr["MATCHUP"])
    wl = str(gr["WL"])
    dt = str(gr["GAME_DATE"])
    game_meta[gid] = {
        "order": idx_g,
        "date": dt,
        "loc": "Away" if "@" in matchup else "Home",
        "wl": wl,
        "st": st,
    }
    games_out.append({"id": gid, "label": f"{dt} · {matchup} ({wl})"})

gids = list(game_meta.keys())
all_shots = []
all_tovs = []
all_fts = []
all_poss = []
all_events = []
player_names = {}
for idx, gid in enumerate(gids, 1):
    try:
        box = boxscoretraditionalv3.BoxScoreTraditionalV3(game_id=gid).get_data_frames()[0]
        pbp = playbyplayv3.PlayByPlayV3(game_id=gid).get_data_frames()[0]
        pbp = pbp.sort_values("actionNumber").reset_index(drop=True)
        time.sleep(1.0)
    except Exception as e:
        print(f"  [{idx}/{len(gids)}] Skipping {gid}: {e}")
        continue

    ros = box[box["teamTricode"] == TEAM]
    mxc_ids = set(ros["personId"].astype(int))
    for _, r in box.iterrows():
        player_names[int(r["personId"])] = f"{r['firstName']} {r['familyName']}"

    steal_lookup = {}
    made_val_lookup = {}
    ft_clocks = set()
    for _, sr in pbp.iterrows():
        key = (int(sr["period"]), str(sr["clock"]))
        if sr["actionType"] == "Steal":
            spid = int(sr["personId"])
            steal_lookup[key] = {"spid": spid, "stealer": player_names.get(spid, str(sr.get("playerNameI", "")))}
        elif sr["actionType"] == "Made Shot":
            is_3 = ("3PT" in str(sr["description"]) or sr.get("shotValue", 0) == 3)
            made_val_lookup[key] = 3 if is_3 else 2
        elif sr["actionType"] == "Free Throw":
            ft_clocks.add(key)

    gm = game_meta[gid]
    cur_p = 0
    on = set()
    poss_tm = ""
    poss_fga = 0
    poss_fta = 0
    poss_tov = 0
    poss_pts = 0
    poss_oreb = 0
    non_final_ft = False
    non_final_ft = False

    def close_poss(p_num, side_tm, lineup_set, fga_c, fta_c, tov_c, pts_c=0, oreb_c=0, dreb_c=0):
        if side_tm != "" and (fga_c > 0 or fta_c > 0 or tov_c > 0):
            all_poss.append({
                "gid": gid,
                "gord": gm["order"],
                "loc": gm["loc"],
                "wl": gm["wl"],
                "st": gm["st"],
                "p": p_num,
                "side": "off" if side_tm == TEAM else "def",
                "pts": pts_c,
                "oreb": oreb_c,
                "dreb": dreb_c,
                "on": sorted(list(lineup_set)),
            })

    for _, row in pbp.iterrows():
        p = int(row["period"])
        act = row["actionType"]
        tm = str(row["teamTricode"] or "")
        desc = str(row["description"])

        if p != cur_p:
            if cur_p > 0:
                close_poss(cur_p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
            cur_p = p
            poss_tm, poss_fga, poss_fta, poss_tov = "", 0, 0, 0
            if p == 1:
                on = set(ros[ros["position"] != ""]["personId"].astype(int))
            else:
                on, sub_in = set(), set()
                for _, pr in pbp[(pbp["period"] == p) & (pbp["teamTricode"] == TEAM)].iterrows():
                    d = str(pr["description"])
                    if pr["actionType"] == "Substitution" and "SUB:" in d:
                        pts = d.replace("SUB:", "").split(" FOR ")
                        in_n = pts[0] if len(pts) > 0 else ""
                        out_n = pts[-1] if len(pts) > 1 else ""
                        for _, rr in ros.iterrows():
                            pid, ln = int(rr["personId"]), rr["familyName"]
                            if ln in out_n and pid not in sub_in:
                                on.add(pid)
                            if ln in in_n:
                                sub_in.add(pid)
                    elif int(pr["personId"]) in mxc_ids and int(pr["personId"]) not in sub_in:
                        on.add(int(pr["personId"]))

        if act == "Substitution" and tm == TEAM and "SUB:" in desc:
            pts = desc.replace("SUB:", "").split(" FOR ")
            in_n = pts[0] if len(pts) > 0 else ""
            out_n = pts[-1] if len(pts) > 1 else ""
            for _, rr in ros.iterrows():
                pid, ln = int(rr["personId"]), rr["familyName"]
                if ln in out_n:
                    on.discard(pid)
                elif ln in in_n:
                    on.add(pid)
            continue

        if act in ["Made Shot", "Missed Shot", "Turnover", "Free Throw"] and tm != "":
            if poss_tm != "" and poss_tm != tm:
                close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
                poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = 0, 0, 0, 0, 0
            poss_tm = tm

        if act in ["Steal", "Block"] and tm == TEAM:
            ev_pid = int(row.get("personId", 0) or 0)
            if ev_pid in mxc_ids:
                all_events.append({"gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"], "p": p, "pid": ev_pid, "type": "STL" if act == "Steal" else "BLK", "on": sorted(list(on))})

        if tm == TEAM and ("STEAL (" in desc or "BLOCK (" in desc):
            ev_pid = int(row.get("personId", 0) or 0)
            if ev_pid in mxc_ids:
                all_events.append({
                    "gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"],
                    "p": p, "pid": ev_pid, "type": "STL" if "STEAL (" in desc else "BLK", "on": sorted(list(on))
                })

        if act in ["Made Shot", "Missed Shot"] and tm != "":
            non_final_ft = False
            non_final_ft = False
            poss_fga += 1
            x_val = row.get("xLegacy")
            y_val = row.get("yLegacy")
            if not pd.isna(x_val) and not pd.isna(y_val):
                is_3 = ("3PT" in desc or row.get("shotValue", 0) == 3)
                shooter_id = int(row["personId"])
                is_astd = 1 if (act == "Made Shot" and "AST)" in desc) else 0
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
                            break
            if act == "Made Shot":
                poss_pts += (3 if ("3PT" in desc or row.get("shotValue", 0) == 3) else 2)
            if act == "Made Shot" and (p, str(row["clock"])) not in ft_clocks:
                close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
                poss_tm, poss_fga, poss_fta, poss_tov = "", 0, 0, 0

        elif act == "Turnover" and tm != "":
            non_final_ft = False
            non_final_ft = False
            poss_tov += 1
            t_pid = int(row["personId"])
            sub_t = str(row.get("subType", "Turnover"))
            stl = steal_lookup.get((p, str(row["clock"])))
            is_live = (sub_t in ["Lost Ball", "Bad Pass"] or stl is not None)
            all_tovs.append({
                "gid": gid,
                "gord": gm["order"],
                "loc": gm["loc"],
                "wl": gm["wl"],
                "st": gm["st"],
                "p": p,
                "side": "off" if tm == TEAM else "def",
                "pid": t_pid,
                "player": player_names.get(t_pid, "Team") if t_pid > 0 else "Team",
                "sub": sub_t,
                "live": 1 if is_live else 0,
                "spid": stl["spid"] if stl else 0,
                "stealer": stl["stealer"] if stl else "",
                "on": sorted(list(on)),
            })
            close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
            poss_tm, poss_fga, poss_fta, poss_tov = "", 0, 0, 0

        elif act == "Free Throw" and tm != "":
            sub_ft_chk = str(row.get("subType", ""))
            non_final_ft = any(x in sub_ft_chk for x in ["1 of 2", "1 of 3", "2 of 3"])
            sub_ft_chk = str(row.get("subType", ""))
            non_final_ft = any(x in sub_ft_chk for x in ["1 of 2", "1 of 3", "2 of 3"])
            poss_fta += 1
            ft_pid = int(row["personId"])
            sub_ft = str(row.get("subType", ""))
            is_made = 0 if "MISS" in desc.upper() else 1
            is_and1 = 1 if "1 of 1" in sub_ft else 0
            if is_and1:
                ft_val = made_val_lookup.get((p, str(row["clock"])), 2)
            elif "of 3" in sub_ft:
                ft_val = 3
            elif "of 2" in sub_ft:
                ft_val = 2
            else:
                ft_val = 0
            all_fts.append({
                "gid": gid,
                "gord": gm["order"],
                "loc": gm["loc"],
                "wl": gm["wl"],
                "st": gm["st"],
                "p": p,
                "side": "off" if tm == TEAM else "def",
                "pid": ft_pid,
                "made": is_made,
                "val": ft_val,
                "and1": is_and1,
                "on": sorted(list(on)),
            })
            if is_made:
                poss_pts += 1
            if is_made and any(tag in sub_ft for tag in ["1 of 1", "2 of 2", "3 of 3"]):
                close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
                poss_tm, poss_fga, poss_fta, poss_tov = "", 0, 0, 0

        elif act == "Rebound" and poss_tm != "":
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
                    if r_pid in mxc_ids:
                        all_events.append({"gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"], "p": p, "pid": r_pid, "type": "OREB", "on": sorted(list(on))})
                elif reb_tm != "":
                    if r_pid in mxc_ids:
                        all_events.append({"gid": gid, "gord": gm["order"], "loc": gm["loc"], "wl": gm["wl"], "st": gm["st"], "p": p, "pid": r_pid, "type": "DREB", "on": sorted(list(on))})
                    close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 1)
                    poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0
            non_final_ft = False

    close_poss(cur_p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
    print(f"  [{idx}/{len(gids)}] {gid} -> Poss: {len(all_poss)} | Shots: {len(all_shots)} | TOVs: {len(all_tovs)}")

mxc_players = [
    {"id": pid, "name": name}
    for pid, name in sorted(player_names.items(), key=lambda x: x[1])
    if any(pid in s["on"] for s in all_shots)
]

payload = {
    "meta": {
        "season": SEASON,
        "team": TEAM,
        "total_games": len(gids),
        "total_poss": len(all_poss),
        "total_shots": len(all_shots),
        "total_fts": len(all_fts),
        "total_turnovers": len(all_tovs),
    },
    "games": list(reversed(games_out)),
    "players": mxc_players,
    "leagueZones": zone_bench,
    "poss": all_poss,
    "shots": all_shots,
    "fts": all_fts,
    "turnovers": all_tovs,
    "events": all_events,
}

with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(payload, f)

print(f"Done! Saved {len(all_poss)} exact possessions, {len(all_shots)} shots, {len(all_fts)} FTs & {len(all_tovs)} TOVs to {OUT_FILE}")
