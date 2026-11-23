import json, time
from nba_api.stats.endpoints import leaguedashlineups

d_ref = json.load(open("data/league_lite_shots_2025-26.json", encoding="utf-8-sig"))
all_teams = list((int(t["id"]), t["abbrev"]) for t in d_ref.get("teams", []) if t.get("id"))

CUTS = {5: 1.5, 4: 3.5, 3: 6.5, 2: 7.5}
out = {}

for szn in list(("2025-26", "2026-27")):
    print(f"Fetching FULL 31-team G League Q1-Q4 baselines for {szn}...")
    out[szn] = {}
    for gq, cut_pg in CUTS.items():
        q_res = []
        for q in list((1, 2, 3, 4)):
            low_p, tot_p, low_diff = 0.0, 0.0, 0.0
            for tid, ab in all_teams:
                try:
                    dfs = leaguedashlineups.LeagueDashLineups(
                        league_id_nullable="20",
                        season=szn,
                        season_type_all_star="Regular Season",
                        team_id_nullable=tid,
                        period=q,
                        group_quantity=gq,
                        measure_type_detailed_defense="Advanced"
                    ).get_data_frames()
                    df = next(iter(dfs))
                    time.sleep(0.22)
                    if df.empty:
                        continue
                    tm_gp = max(1.0, float(df["GP"].max()))
                    for _, r in df.iterrows():
                        poss = float(r["POSS"] or 0)
                        if poss <= 0:
                            continue
                        net = float(r["NET_RATING"] or 0)
                        tot_p += poss
                        if (poss / tm_gp) < cut_pg:
                            low_p += poss
                            low_diff += (net / 100.0) * poss
                except Exception:
                    time.sleep(0.5)
            lg_share = (low_p / tot_p * 100.0) if tot_p > 0 else 0.0
            lg_net = (low_diff / low_p * 100.0) if low_p > 0 else 0.0
            q_res.append({"q": q, "lgShare": round(lg_share, 1), "lgNet": round(lg_net, 1)})
        out[szn][str(gq)] = q_res
        print(f"  {szn} seg={gq}: " + ", ".join(f"Q{x['q']}={x['lgShare']}% ({x['lgNet']:+.1f})" for x in q_res))

json.dump(out, open("data/league_qtr_baselines.json", "w", encoding="utf-8"), indent=2)
print("Saved data/league_qtr_baselines.json!")
