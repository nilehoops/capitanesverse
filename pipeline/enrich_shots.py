import json
from nba_api.stats.endpoints import leaguegamefinder

d = json.load(open("data/shot_charts_2025-26.json", encoding="utf-8"))
df = leaguegamefinder.LeagueGameFinder(league_id_nullable="20", season_nullable="2025-26").get_data_frames().pop(0)
mxc = df[df["TEAM_ABBREVIATION"] == "MXC"].drop_duplicates(subset=["GAME_ID"]).sort_values("GAME_DATE")

games_out = []
meta = {}
for idx, (_, r) in enumerate(mxc.iterrows(), 1):
    gid = r["GAME_ID"]
    sid = str(r.get("SEASON_ID", ""))
    st = "Showcase" if sid.startswith("1") else "Regular Season"
    matchup = str(r["MATCHUP"])
    wl = str(r["WL"])
    dt = str(r["GAME_DATE"])
    meta[gid] = {"gord": idx, "loc": "Away" if "@" in matchup else "Home", "wl": wl, "st": st}
    games_out.append({"id": gid, "label": f"{dt} · {matchup} ({wl})"})

for s in d["shots"]:
    if s["gid"] in meta:
        s.update(meta[s["gid"]])

d["meta"]["total_games"] = len(meta)
d["games"] = list(reversed(games_out))  # Most recent games first
with open("data/shot_charts_2025-26.json", "w", encoding="utf-8") as f:
    json.dump(d, f)

print(f"Saved {len(games_out)} games and enriched {len(d['shots'])} shots!")
