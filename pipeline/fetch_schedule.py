import json
import datetime
from nba_api.stats.endpoints import scheduleleaguev2, leaguegamefinder

SEASON = "2026-27"
LEAGUE_ID = "20"
MXC_ID = 1612709931

games_out = []

try:
    df = scheduleleaguev2.ScheduleLeagueV2(league_id=LEAGUE_ID, season=SEASON).get_data_frames()[0]
    mxc_df = df[(df["homeTeam_teamId"] == MXC_ID) | (df["awayTeam_teamId"] == MXC_ID)].copy()
    for _, r in mxc_df.iterrows():
        is_home = int(r["homeTeam_teamId"]) == MXC_ID
        opp = str(r["awayTeam_teamTricode"] if is_home else r["homeTeam_teamTricode"])
        gdate = str(r.get("gameDateEst") or r.get("gameDateUTC") or "")[:10]
        status = int(r.get("gameStatus") or 1)  # 1 = Scheduled, 2 = Live, 3 = Final
        gid = str(r.get("gameId") or "")
        loc = "Home" if is_home else "Away"
        sep = "vs." if is_home else "@"
        tip = str(r.get("gameStatusText") or "")
        games_out.append({
            "id": gid,
            "date": gdate,
            "opp": opp,
            "loc": loc,
            "label": f"{gdate} · MXC {sep} {opp}",
            "time": tip,
            "future": status != 3
        })
except Exception as e:
    print(f"ScheduleLeagueV2 note: {e}")

# Also cross-check LeagueGameFinder for any scheduled/played rows
try:
    gdf = leaguegamefinder.LeagueGameFinder(league_id_nullable=LEAGUE_ID, season_nullable=SEASON, team_id_nullable=MXC_ID).get_data_frames()[0]
    seen = {g["id"] for g in games_out}
    for _, r in gdf.iterrows():
        gid = str(r["GAME_ID"])
        if gid in seen:
            continue
        mu = str(r["MATCHUP"])
        is_home = "vs." in mu
        opp = mu.split()[-1]
        gdate = str(r["GAME_DATE"])[:10]
        wl = str(r["WL"] or "").strip()
        games_out.append({
            "id": gid,
            "date": gdate,
            "opp": opp,
            "loc": "Home" if is_home else "Away",
            "label": f"{gdate} · {mu}",
            "time": "",
            "future": wl == ""
        })
except Exception as e:
    print(f"LeagueGameFinder note: {e}")

games_out.sort(key=lambda x: x["date"], reverse=True)
with open(f"data/schedule_{SEASON}.json", "w", encoding="utf-8") as f:
    json.dump({"season": SEASON, "games": games_out}, f, indent=2)

fut_cnt = sum(1 for g in games_out if g["future"])
print(f"Saved data/schedule_{SEASON}.json ({len(games_out)} total games, {fut_cnt} upcoming).")
