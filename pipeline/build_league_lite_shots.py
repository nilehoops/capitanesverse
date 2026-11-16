import json
import sys
import time
import pandas as pd
from nba_api.stats.endpoints import shotchartdetail

SEASON = sys.argv[1] if len(sys.argv) > 1 else "2026-27"
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
frames = []
for stype in ["Showcase", "Regular Season"]:
    try:
        res = shotchartdetail.ShotChartDetail(
            team_id=0,
            player_id=0,
            league_id=LEAGUE_ID,
            season_nullable=SEASON,
            season_type_all_star=stype,
            context_measure_simple="FGA",
        ).get_data_frames()
        if len(res) > 0 and not res[0].empty:
            frames.append(res[0])
        time.sleep(0.8)
    except Exception as e:
        print(f"  [Note] {stype} skipped: {e}")

if not frames:
    print(f"No shots found yet for {SEASON}.")
    sys.exit(0)

df = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["GAME_ID", "GAME_EVENT_ID"])

def empty_zones():
    return {z: [0, 0] for z in ZONES}

teams = {}
players = {}
lg_zones = empty_zones()

for _, r in df.iterrows():
    x = float(r["LOC_X"])
    y = float(r["LOC_Y"])
    is_3 = "3PT" in str(r["SHOT_TYPE"])
    made = int(r["SHOT_MADE_FLAG"])
    z = classify_zone(x, y, is_3)

    lg_zones[z][0] += made
    lg_zones[z][1] += 1

    tm_id = str(r["TEAM_ID"])
    tm_name = str(r["TEAM_NAME"])
    if tm_id not in teams:
        teams[tm_id] = {"id": tm_id, "name": tm_name, "zones": empty_zones()}
    teams[tm_id]["zones"][z][0] += made
    teams[tm_id]["zones"][z][1] += 1

    pid = str(r["PLAYER_ID"])
    pname = str(r["PLAYER_NAME"])
    if pid not in players:
        players[pid] = {"id": pid, "name": pname, "team": tm_name, "zones": empty_zones()}
    players[pid]["zones"][z][0] += made
    players[pid]["zones"][z][1] += 1

try:
    ros = json.load(open(f"data/gleague_roster_{SEASON}.json", encoding="utf-8"))
    n2t = ros.get("nameToTeam", {})
    for p in players.values():
        ab = n2t.get(p["name"].lower())
        if ab:
            p["abbrev"] = ab
            for t in teams.values():
                if t["name"] == p["team"]:
                    t["abbrev"] = ab
except Exception:
    pass

out = {
    "season": SEASON,
    "leagueZones": lg_zones,
    "teams": list(teams.values()),
    "players": list(players.values()),
}

out_path = f"data/league_lite_shots_{SEASON}.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f)

print(f"Saved {len(teams)} teams & {len(players)} players ({len(df)} total G League shots) to {out_path}!")

