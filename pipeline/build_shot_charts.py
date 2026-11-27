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
all_box_players = []
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
    def _parse_min(m_str):
        s = str(m_str or "").strip()
        if ":" in s:
            m_p, s_p = s.split(":", 1)
            return round(float(m_p) + float(s_p) / 60.0, 1)
        try:
            return round(float(s), 1)
        except Exception:
            return 0.0
    for _, r in box.iterrows():
        pid_i = int(r["personId"])
        nm_s = f"{r['firstName']} {r['familyName']}".strip()
        player_names[pid_i] = nm_s
        mins_f = _parse_min(r.get("minutes", ""))
        if mins_f <= 0 and int(r.get("points", 0) or 0) == 0 and int(r.get("fieldGoalsAttempted", 0) or 0) == 0:
            continue
        all_box_players.append({
            "gid": gid,
            "side": "off" if str(r.get("teamTricode", "")) == TEAM else "def",
            "pid": pid_i,
            "name": nm_s,
            "min": round(mins_f),
            "pts": int(r.get("points", 0) or 0),
            "fgm": int(r.get("fieldGoalsMade", 0) or 0),
            "fga": int(r.get("fieldGoalsAttempted", 0) or 0),
            "fg3m": int(r.get("threePointersMade", 0) or 0),
            "fg3a": int(r.get("threePointersAttempted", 0) or 0),
            "ftm": int(r.get("freeThrowsMade", 0) or 0),
            "fta": int(r.get("freeThrowsAttempted", 0) or 0),
            "orb": int(r.get("reboundsOffensive", 0) or 0),
            "drb": int(r.get("reboundsDefensive", 0) or 0),
            "ast": int(r.get("assists", 0) or 0),
            "stl": int(r.get("steals", 0) or 0),
            "blk": int(r.get("blocks", 0) or 0),
            "tov": int(r.get("turnovers", 0) or 0),
            "pf": int(r.get("foulsPersonal", 0) or 0),
            "pm": int(r.get("plusMinusPoints", 0) or 0),
        })

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
    def _parse_clk(c_str):
        s = str(c_str or "").replace("PT", "").replace("S", "")
        if "M" in s:
            m_s, sec_s = s.split("M", 1)
            try:
                return float(m_s) * 60.0 + float(sec_s)
            except Exception:
                return 0.0
        return 0.0
    opp_ids = set(box[box["teamTricode"] != TEAM]["personId"].astype(int))
    last_poss_end_clk = 720.0
    poss_oreb = 0
    prev_closed_by_tov = False
    last_missed_tm = ""

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
        cur_clk = _parse_clk(row.get("clock"))

        if p != cur_p:
            if cur_p > 0:
                close_poss(cur_p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
            cur_p = p
            poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0
            prev_closed_by_tov = False
            last_missed_tm = ""
            last_poss_end_clk = 720.0 if p <= 4 else 300.0
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

        if act == "Rebound":
            reb_pid = int(row.get("personId", 0) or 0)
            reb_tm = tm or (TEAM if reb_pid in mxc_ids else (str(box[box["teamTricode"] != TEAM]["teamTricode"].iloc[0]) if reb_pid in opp_ids and not box[box["teamTricode"] != TEAM].empty else ""))
            if reb_tm != "" and last_missed_tm != "":
                if reb_tm == last_missed_tm:
                    poss_oreb += 1
                else:
                    if poss_tm != "":
                        close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 1)
                        poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0
                        prev_closed_by_tov = False
                    last_poss_end_clk = cur_clk
                last_missed_tm = ""
            continue

        if act in ["Made Shot", "Missed Shot", "Turnover", "Free Throw"] and tm != "":
            if poss_tm != "" and poss_tm != tm:
                close_poss(p, poss_tm, on, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb, 0)
                poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = 0, 0, 0, 0, 0
                prev_closed_by_tov = False
                last_poss_end_clk = cur_clk
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
            poss_fga += 1
            if act == "Missed Shot":
                last_missed_tm = tm
            else:
                last_missed_tm = ""
            elapsed = max(0.0, last_poss_end_clk - cur_clk)
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
                    "clk": ("early" if elapsed <= 8.0 else ("late" if elapsed >= 18.0 else "mid")),
                    "oreb": 1 if poss_oreb > 0 else 0,
                    "offTov": 1 if prev_closed_by_tov else 0,
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
                poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0
            prev_closed_by_tov = False
            last_poss_end_clk = 720.0 if p <= 4 else 300.0

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
            poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0
            prev_closed_by_tov = False
            last_poss_end_clk = 720.0 if p <= 4 else 300.0

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
                poss_tm, poss_fga, poss_fta, poss_tov, poss_pts, poss_oreb = "", 0, 0, 0, 0, 0
            prev_closed_by_tov = False
            last_poss_end_clk = 720.0 if p <= 4 else 300.0

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
        "boxPlayers": all_box_players,
}

with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(payload, f)

print(f"Done! Saved {len(all_poss)} exact possessions, {len(all_shots)} shots, {len(all_fts)} FTs & {len(all_tovs)} TOVs to {OUT_FILE}")


# ── Compute exact 1-player & multi-player WOWY directly from shot_charts arrays ──
def _build_wowy_from_sc(sc_path, mex_path):
    sc = json.load(open(sc_path, encoding="utf-8"))
    try:
        mex = json.load(open(mex_path, encoding="utf-8"))
    except Exception:
        return

    # Map pid -> canonical player name & abbrev used in mex_data
    id_to_ab = {}
    id_to_full = {}
    name_to_ab = {}
    for w in mex.get("wowy", []):
        ab = w.get("abbrev") or w.get("player")
        pl = w.get("player") or ab
        if ab:
            name_to_ab[pl.lower()] = ab
            name_to_ab[ab.lower()] = ab
            pts = pl.split()
            if len(pts) >= 2:
                name_to_ab[f"{pts.pop(0)}. {pts.pop()}".lower()] = ab

    sc_players = sc.get("players", {})
    if isinstance(sc_players, dict):
        p_items = [(int(k), v.get("name") if isinstance(v, dict) else str(v)) for k, v in sc_players.items()]
    else:
        p_items = [(int(p["id"]), p["name"]) for p in sc_players if "id" in p]

    for pid, nm in p_items:
        id_to_full[pid] = nm
        ab = name_to_ab.get(nm.lower())
        if not ab:
            pts = nm.split()
            ab = f"{pts.pop(0)}. {pts.pop()}" if len(pts) >= 2 else nm
        id_to_ab[pid] = ab

    # Pre-index events by tuple(sorted(on))
    buckets = {}
    def get_b(on_list):
        k = tuple(sorted(int(x) for x in (on_list or [])))
        if k not in buckets:
            buckets[k] = {
                "off_poss": 0, "def_poss": 0, "off_pts": 0, "def_pts": 0,
                "off_fgm": 0, "off_fg3m": 0, "off_fga": 0, "off_miss": 0,
                "def_fgm": 0, "def_fg3m": 0, "def_fga": 0, "def_miss": 0,
                "off_tov": 0, "def_tov": 0, "off_oreb": 0, "def_opp_oreb": 0
            }
        return buckets[k]

    for p in sc.get("poss", []):
        b = get_b(p.get("on"))
        if p.get("side") == "off":
            b["off_poss"] += 1
            b["off_pts"] += int(p.get("pts", 0) or 0)
            b["off_oreb"] += int(p.get("oreb", 0) or 0)
        else:
            b["def_poss"] += 1
            b["def_pts"] += int(p.get("pts", 0) or 0)
            b["def_opp_oreb"] += int(p.get("oreb", 0) or 0)

    for s in sc.get("shots", []):
        b = get_b(s.get("on"))
        made = int(s.get("made", 0) or 0)
        is3 = 1 if int(s.get("val", 2) or 2) == 3 else 0
        if s.get("side") == "off":
            b["off_fga"] += 1
            b["off_fgm"] += made
            b["off_fg3m"] += (made * is3)
            if not made: b["off_miss"] += 1
        else:
            b["def_fga"] += 1
            b["def_fgm"] += made
            b["def_fg3m"] += (made * is3)
            if not made: b["def_miss"] += 1

    for ft in sc.get("fts", []):
        if int(ft.get("made", 0) or 0) == 0:
            sub = str(ft.get("sub", ""))
            if any(tag in sub for tag in ["1 of 1", "2 of 2", "3 of 3"]):
                b = get_b(ft.get("on"))
                if ft.get("side") == "off": b["off_miss"] += 1
                else: b["def_miss"] += 1

    for t in sc.get("turnovers", []):
        b = get_b(t.get("on"))
        if t.get("side") == "off": b["off_tov"] += 1
        else: b["def_tov"] += 1

    def calc(b_list):
        tot = {k: sum(x[k] for x in b_list) for k in [
            "off_poss", "def_poss", "off_pts", "def_pts",
            "off_fgm", "off_fg3m", "off_fga", "off_miss",
            "def_fgm", "def_fg3m", "def_fga", "def_miss",
            "off_tov", "def_tov", "off_oreb", "def_opp_oreb"
        ]}
        poss = round((tot["off_poss"] + tot["def_poss"]) / 2.0)
        if poss < 1: return None
        off_rtg = round(tot["off_pts"] / max(1, tot["off_poss"]) * 100, 1)
        def_rtg = round(tot["def_pts"] / max(1, tot["def_poss"]) * 100, 1)
        off_orb = round(tot["off_oreb"] / max(1, tot["off_miss"]), 4) if tot["off_miss"] else 0.0
        def_orb = round(1.0 - (tot["def_opp_oreb"] / max(1, tot["def_miss"])), 4) if tot["def_miss"] else 0.0
        return {
            "POSS": int(poss),
            "OffRtg": off_rtg,
            "DefRtg": def_rtg,
            "NetRtg": round(off_rtg - def_rtg, 1),
            "OFF_EFG_PCT": round((tot["off_fgm"] + 0.5 * tot["off_fg3m"]) / max(1, tot["off_fga"]), 4),
            "DEF_EFG_PCT": round((tot["def_fgm"] + 0.5 * tot["def_fg3m"]) / max(1, tot["def_fga"]), 4),
            "OFF_TOV_PCT": round(tot["off_tov"] / max(1, tot["off_poss"]), 4),
            "DEF_TOV_PCT": round(tot["def_tov"] / max(1, tot["def_poss"]), 4),
            "OFF_ORB_PCT": min(1.0, max(0.0, off_orb)),
            "DEF_ORB_PCT": min(1.0, max(0.0, def_orb)),
        }

    all_pids = sorted({pid for k in buckets for pid in k if pid in id_to_ab})
    new_wowy = []
    for pid in all_pids:
        on_b = [b for k, b in buckets.items() if pid in k]
        off_b = [b for k, b in buckets.items() if pid not in k]
        wm, wom = calc(on_b), calc(off_b)
        if wm:
            new_wowy.append({
                "player": id_to_full.get(pid, id_to_ab[pid]),
                "abbrev": id_to_ab[pid],
                "rating_source": "shot_chart_pbp",
                "with": wm,
                "without": wom or wm
            })

    from itertools import combinations
    combo_list = []
    for r_sz in range(1, 6):
        for grp in combinations(all_pids, r_sz):
            if not any(all(p in k for p in grp) for k in buckets):
                continue
            ab_grp = [id_to_ab[p] for p in grp]
            states = {}
            for mask in range(1 << r_sz):
                matching = [b for k, b in buckets.items() if all(((p in k) == bool((mask >> i) & 1)) for i, p in enumerate(grp))]
                res = calc(matching)
                if res:
                    states[str(mask)] = res
            combo_list.append({"players": ab_grp, "states": states})

    mex["wowy"] = new_wowy
    mex["combo_wowy"] = combo_list
    with open(mex_path, "w", encoding="utf-8") as f:
        json.dump(mex, f)
    print(f"Updated {mex_path} with exact shot-chart WOWY ({len(new_wowy)} players, {len(combo_list)} combos)!")

_build_wowy_from_sc(f"data/shot_charts_{SEASON}.json", f"data/mex_data_{SEASON}.json")
