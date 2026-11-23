from nba_api.stats.endpoints import leaguegamefinder, playbyplayv3

df = leaguegamefinder.LeagueGameFinder(league_id_nullable="20", season_nullable="2025-26").get_data_frames().pop(0)
gids = df[df["TEAM_ABBREVIATION"] == "MXC"].drop_duplicates(subset=["GAME_ID"]).sort_values("GAME_DATE")["GAME_ID"].tolist()

sample_pbp = playbyplayv3.PlayByPlayV3(game_id=gids[-1]).get_data_frames().pop(0)
tovs = sample_pbp[sample_pbp["actionType"] == "Turnover"]
non_zero = tovs[(tovs["xLegacy"].fillna(0) != 0) | (tovs["yLegacy"].fillna(0) != 0)]
print(f"Sample game {gids[-1]}: {len(tovs)} turnovers, {len(non_zero)} with non-zero (x, y) coordinates.")
if not non_zero.empty:
    print(non_zero[["teamTricode", "subType", "xLegacy", "yLegacy", "description"]].head(8).to_string(index=False))
else:
    print("Turnover subTypes available:", tovs["subType"].value_counts().to_dict())
