import json, os, sys, time
from nba_api.stats.endpoints import leaguedashlineups

CACHE_PATH = "data/league_qtr_baselines.json"
out = json.load(open(CACHE_PATH, encoding="utf-8")) if os.path.exists(CACHE_PATH) else {}
force = "--full" in sys.argv

CUTS = {5: 1.5, 4: 3.5, 3: 6.5, 2: 7.5}

def has_nonzero(szn_obj):
    if not isinstance(szn_obj, dict) or not szn_obj: return False
    for arr in szn_obj.values():
        if any(float(x.get("lgShare", 0) or 0) > 0 for x in (arr or [])):
            return True
    return False

for szn in ("2025-26", "2026-27"):
    if szn == "2025-26" and not force and has_nonzero(out.get("2025-26")):
        print("Using cached 2025-26 Q1-Q4 baselines (already complete).")
        continue
    print(f"Fetching league-wide G League Q1-Q4 baselines for {szn}...")
    szn_res = {}
    any_data = False
    for gq, cut_pg in CUTS.items():
        q_res = []
        for q in (1, 2, 3, 4):
            low_p, tot_p, low_diff = 0.0, 0.0, 0.0
            for stype in ("Showcase", "Regular Season"):
                for attempt in range(3):
                    try:
                        dfs = leaguedashlineups.LeagueDashLineups(
                            league_id_nullable="20",
                            season=szn,
                            season_type_all_star=stype,
                            period=q,
                            group_quantity=gq,
                            measure_type_detailed_defense="Advanced",
                            timeout=20
                        ).get_data_frames()
                        df = next(iter(dfs))
                        time.sleep(0.6)
                        if not df.empty:
                            tm_gp_map = df.groupby("TEAM_ABBREVIATION")["GP"].max().to_dict() if "TEAM_ABBREVIATION" in df.columns else {}
                            for _, r in df.iterrows():
                                poss = float(r.get("POSS") or 0)
                                if poss <= 0: continue
                                net = float(r.get("NET_RATING") or 0)
                                tm_gp = max(1.0, float(tm_gp_map.get(r.get("TEAM_ABBREVIATION"), r.get("GP") or 1)))
                                tot_p += poss
                                if (poss / tm_gp) < cut_pg:
                                    low_p += poss
                                    low_diff += (net / 100.0) * poss
                        break
                    except Exception:
                        time.sleep(1.5 * (attempt + 1))
            if tot_p > 0: any_data = True
            lg_share = (low_p / tot_p * 100.0) if tot_p > 0 else 0.0
            lg_net = (low_diff / low_p * 100.0) if low_p > 0 else 0.0
            q_res.append({"q": q, "lgShare": round(lg_share, 1), "lgNet": round(lg_net, 1)})
        szn_res[str(gq)] = q_res
        print(f"  {szn} seg={gq}: " + ", ".join(f"Q{x['q']}={x['lgShare']}% ({x['lgNet']:+.1f})" for x in q_res))
    if not any_data and szn == "2026-27" and has_nonzero(out.get("2025-26")):
        out["2026-27"] = out["2025-26"]
        print("  2026-27 Regular Season has 0 games yet ? carried forward 2025-26 Q1-Q4 baselines (no 0.0% zeros).")
    else:
        out[szn] = szn_res

json.dump(out, open(CACHE_PATH, "w", encoding="utf-8"), indent=2)
print("Saved data/league_qtr_baselines.json!")
