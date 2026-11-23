import time
import pandas as pd
from nba_api.stats.endpoints import leaguedashteamptshot

SEASONS = ["2024-25", "2025-26", "2026-27"]
LEAGUE_ID = "20"  # "20" = NBA G League, "00" = NBA

SHOT_CLOCK_RANGES = [
    "24-22",
    "22-18 Very Early",
    "18-15 Early",
    "15-7 Average",
    "7-4 Late",
    "4-0 Very Late",
]

rows = []

for season in SEASONS:
    for clock_range in SHOT_CLOCK_RANGES:
        resp = leaguedashteamptshot.LeagueDashTeamPtShot(
            league_id=LEAGUE_ID,
            season=season,
            season_type_all_star="Regular Season",
            shot_clock_range_nullable=clock_range,
            general_range_nullable="Catch and Shoot",
        )
        df = resp.get_data_frames()

        fg3m = df["FG3M"].sum()
        fg3a = df["FG3A"].sum()
        fg3_pct = round((fg3m / fg3a) * 100, 2) if fg3a > 0 else None

        rows.append({
            "Shot_Clock": clock_range,
            "Season": season,
            "3PM": int(fg3m),
            "3PA": int(fg3a),
            "3P%": fg3_pct,
        })
        time.sleep(0.7)

summary = pd.DataFrame(rows)
pivoted = summary.pivot(index="Shot_Clock", columns="Season", values=["3PA", "3P%"])
pivoted.columns = [f"{col}_{col}" for col in pivoted.columns]
pivoted = pivoted.reindex(SHOT_CLOCK_RANGES)

pivoted["Diff_26_vs_25"] = (pivoted["2025-26_3P%"] - pivoted["2024-25_3P%"]).round(2)
pivoted["Diff_27_vs_26"] = (pivoted["2026-27_3P%"] - pivoted["2025-26_3P%"]).round(2)
pivoted["Diff_27_vs_25"] = (pivoted["2026-27_3P%"] - pivoted["2024-25_3P%"]).round(2)

print(pivoted.to_string())
