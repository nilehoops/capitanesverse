import json
import time
from nba_api.stats.endpoints import leaguegamefinder, leaguedashteamstats, playbyplayv3

SEASON = "2025-26"
LEAGUE_ID = "20"

# 1. Official 31-Team G League Four Factors
ff_df = leaguedashteamstats.LeagueDashTeamStats(
    league_id_nullable=LEAGUE_ID,
    season=SEASON,
    measure_type_detailed_defense="Four Factors",
).get_data_frames().pop(0)

lg_tov_pct = float(ff_df["TM_TOV_PCT"].mean()) * 100
lg_efg_pct = float(ff_df["EFG_PCT"].mean()) * 100
lg_oreb_pct = float(ff_df["OREB_PCT"].mean()) * 100
lg_fta_rate = float(ff_df["FTA_RATE"].mean()) * 100

# 2. Sample 1 non-MXC game per team across all 31 G League teams (~25 unique games)
all_g = leaguegamefinder.LeagueGameFinder(league_id_nullable=LEAGUE_ID, season_nullable=SEASON).get_data_frames().pop(0)
non_mxc = all_g[all_g["TEAM_ABBREVIATION"] != "MXC"].drop_duplicates(subset=["TEAM_ABBREVIATION"])
sample_gids = non_mxc["GAME_ID"].drop_duplicates().tolist()

lg_pass, lg_score = 0, 0
for gid in sample_gids:
    try:
        pbp = playbyplayv3.PlayByPlayV3(game_id=gid).get_data_frames().pop(0)
        tovs = pbp[pbp["actionType"] == "Turnover"]
        for _, r in tovs.iterrows():
            if "bad pass" in str(r.get("subType", "")).lower():
                lg_pass += 1
            else:
                lg_score += 1
        time.sleep(0.6)
    except Exception:
        continue

tot_sample = max(1, lg_pass + lg_score)
pass_share = round((lg_pass / tot_sample) * 100, 2)
score_share = round((lg_score / tot_sample) * 100, 2)

d = json.load(open("data/shot_charts_2025-26.json", encoding="utf-8"))
d["leagueFourFactors"] = {
    "efg_pct": round(lg_efg_pct, 2),
    "tov_pct": round(lg_tov_pct, 2),
    "oreb_pct": round(lg_oreb_pct, 2),
    "fta_rate": round(lg_fta_rate, 2),
    "pass_share": pass_share,
    "score_share": score_share,
}
with open("data/shot_charts_2025-26.json", "w", encoding="utf-8") as f:
    json.dump(d, f)

print(f"31-Team Sample ({tot_sample} TOVs across {len(sample_gids)} games):")
print(f"Pass Share: {pass_share}% ({lg_tov_pct * pass_share / 100:.2f}% per play) | Score Share: {score_share}% ({lg_tov_pct * score_share / 100:.2f}% per play)")
