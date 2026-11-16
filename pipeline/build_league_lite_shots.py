import json
import sys
import time
import pandas as pd
from nba_api.stats.endpoints import leaguegamefinder, shotchartdetail

SEASON = sys.argv.pop(1) if len(sys.argv) > 1 else "2026-27"
LEAGUE_ID = "20"

ZONES = [
    "Restricted Area", "Paint (Non-RA)", "Left Baseline Mid", "Left Elbow / Wing Mid",
    "Center Mid-Range", "Right Elbow / Wing Mid", "Right Baseline Mid",
    "Left Corner 3", "Left Wing 3", "Center / Top 3", "Right Wing 3", "Right Corner 3"
]

def classify_zone(x, y, is_3):
    dist = (x * x + y * y) ** 0.5
    if not is_3:
        if dist <= 40:
            return "Restricted Area"
        if abs(x) <= 80 and y <= 142.5:
            return "Paint (Non-RA)"
        if y <= 85:
            return "Left Baseline Mid" if x < 0 else "Right Baseline Mid"
        if abs(x) <= 75:
            return "Center Mid-Range"
        return "Left Elbow / Wing Mid" if x < 0 else "Right Elbow / Wing Mid"
    else:
        if y <= 92.5 and abs(x) >= 220:
            return "Left Corner 3" if x < 0 else "Right Corner 3"
        if abs(x) <= 85:
            return "Center / Top 3"
        return "Left Wing 3" if x < 0 else "Right Wing 3"

print(f"Fetching 31-team G League Lite Shot Charts for {SEASON}...")
gf = leaguegamefinder.LeagueGameFinder(league_id_nullable=LEAGUE_ID, season_nullable=SEASON).get_data_frames().pop(0)
team_rows = gf[gf["TEAM_ABBREVIATION"].str.len() == 3][["TEAM_ID", "TEAM_ABBREVIATION", "TEAM_NAME"]].drop_duplicates(subset=["TEAM_ID"])

def empty_zones():
    return {z: {"m": 0, "a": 0} for z in ZONES}

teams = {}
players = {}
lg_zones = empty_zones()
tot_shots = 0

for _, tr in team_rows.iterrows():
    tid = int(tr["TEAM_ID"])
    ab = str(tr["TEAM_ABBREVIATION"]).strip()
    tname = str(tr["TEAM_NAME"]).strip()
    teams[str(tid)] = {"id": str(tid), "abbrev": ab, "name": tname, "zones": empty_zones()}

    frames = []
    for stype in ["Showcase", "Regular Season"]:
        try:
            res = shotchartdetail.ShotChartDetail(
                team_id=tid,
                player_id=0,
                league_id=LEAGUE_ID,
                season_nullable=SEASON,
                season_type_all_star=stype,
                context_measure_simple="FGA",
            ).get_data_frames()
            if res:
                df_part = res.pop(0)
                if not df_part.empty:
                    frames.append(df_part)
            time.sleep(0.4)
        except Exception:
            continue

    if not frames:
        continue

    df = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["GAME_ID", "GAME_EVENT_ID"])
    tot_shots += len(df)
    for _, r in df.iterrows():
        x = float(r["LOC_X"])
        y = float(r["LOC_Y"])
        is_3 = "3PT" in str(r["SHOT_TYPE"])
        made = int(r["SHOT_MADE_FLAG"])
        z = classify_zone(x, y, is_3)

        lg_zones[z]["m"] += made
        lg_zones[z]["a"] += 1
        teams[str(tid)]["zones"][z]["m"] += made
        teams[str(tid)]["zones"][z]["a"] += 1

        pid = str(r["PLAYER_ID"])
        pname = str(r["PLAYER_NAME"])
        if pid not in players:
            players[pid] = {"id": pid, "name": pname, "team": tname, "abbrev": ab, "zones": empty_zones()}
        players[pid]["zones"][z]["m"] += made
        players[pid]["zones"][z]["a"] += 1

# Convert {"m": m, "a": a} to [m, a] lists for compact JSON
def pack_zones(zdict):
    return {z: list((zdict[z]["m"], zdict[z]["a"])) for z in ZONES}

out = {
    "season": SEASON,
    "leagueZones": pack_zones(lg_zones),
    "teams": [{"id": t["id"], "abbrev": t["abbrev"], "name": t["name"], "zones": pack_zones(t["zones"])} for t in teams.values()],
    "players": [{"id": p["id"], "name": p["name"], "team": p["team"], "abbrev": p["abbrev"], "zones": pack_zones(p["zones"])} for p in players.values()],
}

out_path = f"data/league_lite_shots_{SEASON}.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f)

print(f"Saved {len(teams)} teams & {len(players)} players ({tot_shots} total shots) to {out_path}!")
