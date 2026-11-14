import json
import time
import pandas as pd
from nba_api.stats.endpoints import (
    leaguegamefinder,
    playbyplayv3,
    boxscoretraditionalv3,
    shotchartdetail,
)

LEAGUE_ID = "20"
SEASON = "2025-26"
TEAM = "MXC"
TEAM_ID = 1612709931

print("1/2 Fetching 2025-26 G League Zone Benchmarks...")
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
        lg_df = frames.pop(1)
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

print("2/2 Parsing Play-by-Play Shot Coordinates & On-Court Lineups...")
games = leaguegamefinder.LeagueGameFinder(
    league_id_nullable=LEAGUE_ID, season_nullable=SEASON
).get_data_frames().pop(0)
gids = sorted(games[games["TEAM_ABBREVIATION"] == TEAM]["GAME_ID"].unique().tolist())

all_shots = []
player_names = {}

for idx, gid in enumerate(gids, 1):
    try:
        box = boxscoretraditionalv3.BoxScoreTraditionalV3(game_id=gid).get_data_frames().pop(0)
        pbp = playbyplayv3.PlayByPlayV3(game_id=gid).get_data_frames().pop(0)
        pbp = pbp.sort_values("actionNumber").reset_index(drop=True)
        time.sleep(1.0)
    except Exception as e:
        print(f"  [{idx}/{len(gids)}] Skipping {gid}: {e}")
        continue

    ros = box[box["teamTricode"] == TEAM]
    mxc_ids = set(ros["personId"].astype(int))
    for _, r in box.iterrows():
        player_names[int(r["personId"])] = f"{r['firstName']} {r['familyName']}"

    cur_p = 0
    on = set()

    for _, row in pbp.iterrows():
        p = int(row["period"])
        act = row["actionType"]
        tm = row["teamTricode"]
        desc = str(row["description"])

        if p != cur_p:
            cur_p = p
            if p == 1:
                on = set(ros[ros["position"] != ""]["personId"].astype(int))
            else:
                on, sub_in = set(), set()
                for _, pr in pbp[(pbp["period"] == p) & (pbp["teamTricode"] == TEAM)].iterrows():
                    d = str(pr["description"])
                    if pr["actionType"] == "Substitution" and "SUB:" in d:
                        pts = d.replace("SUB:", "").split(" FOR ")
                        in_n = pts.pop(0) if len(pts) > 0 else ""
                        out_n = pts.pop(-1) if len(pts) > 0 else ""
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
            in_n = pts.pop(0) if len(pts) > 0 else ""
            out_n = pts.pop(-1) if len(pts) > 0 else ""
            for _, rr in ros.iterrows():
                pid, ln = int(rr["personId"]), rr["familyName"]
                if ln in out_n:
                    on.discard(pid)
                elif ln in in_n:
                    on.add(pid)
            continue

        if act in ["Made Shot", "Missed Shot"] and tm != "":
            x_val = row.get("xLegacy")
            y_val = row.get("yLegacy")
            if pd.isna(x_val) or pd.isna(y_val):
                continue
            is_3 = ("3PT" in desc or row.get("shotValue", 0) == 3)
            shooter_id = int(row["personId"])
            all_shots.append({
                "gid": gid,
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
            })

    print(f"  [{idx}/{len(gids)}] {gid} -> Total shots logged: {len(all_shots)}")

mxc_players = [
    {"id": pid, "name": name}
    for pid, name in sorted(player_names.items(), key=lambda x: x[1])
    if any(pid in s["on"] for s in all_shots)
]

payload = {
    "meta": {"season": SEASON, "team": TEAM, "total_shots": len(all_shots)},
    "players": mxc_players,
    "leagueZones": zone_bench,
    "shots": all_shots,
}

with open("data/shot_charts_2025-26.json", "w", encoding="utf-8") as f:
    json.dump(payload, f)

print(f"Done! Saved {len(all_shots)} offensive & defensive shots to data/shot_charts_2025-26.json")
