import json, time
import pandas as pd
from nba_api.stats.endpoints import leaguedashteamstats, leaguedashplayerstats, commonteamroster

LEAGUE_ID = "20"

def parse_height_in(h_str):
    try:
        parts = str(h_str).strip().split("-")
        if len(parts) == 2: return int(parts.pop(0)) * 12 + int(parts.pop(0))
    except Exception: pass
    return None

def fmt_height(inches):
    if not inches: return "—"
    return f"{int(round(inches)) // 12}'{int(round(inches)) % 12}\""

# Load local players_detail.json + players_index.json for biography fallback
bio_lookup = {}
try:
    p_idx = json.load(open("data/players_index.json", encoding="utf-8"))
    p_det = json.load(open("data/players_detail.json", encoding="utf-8"))
    for item in (p_idx if isinstance(p_idx, list) else list(p_idx.values())):
        if not isinstance(item, dict) or not item.get("name"): continue
        bio = (p_det.get(str(item.get("id", "")), {}) if isinstance(p_det, dict) else {}).get("biography", {})
        bio_lookup[item["name"].strip().lower()] = {"age": bio.get("age") or item.get("age"), "height": bio.get("height") or item.get("height"), "weight": bio.get("weight") or item.get("weight")}
except Exception: pass

for szn in ["2026-27", "2025-26"]:
    path = f"data/league_lite_shots_{szn}.json"
    try: data = json.load(open(path, encoding="utf-8"))
    except Exception: continue

    print(f"Enriching 31 teams (Showcase + Regular Season) for {szn}...")

    # 1. Pull CommonTeamRoster for Age, Height, Weight across all 31 teams
    for t in data.get("teams", []):
        try:
            rdf = commonteamroster.CommonTeamRoster(team_id=int(t["id"]), season=szn, league_id_nullable=LEAGUE_ID).get_data_frames().pop(0)
            for _, r in rdf.iterrows():
                nm = str(r.get("PLAYER", "")).strip().lower()
                if not nm: continue
                b = bio_lookup.setdefault(nm, {})
                if r.get("AGE"): b["age"] = float(r["AGE"])
                if r.get("HEIGHT"): b["height"] = str(r["HEIGHT"])
                if r.get("WEIGHT"): b["weight"] = float(r["WEIGHT"])
            time.sleep(0.3)
        except Exception: continue

    # 2. Pull Team Base & Opponent Stats across Showcase + Regular Season
    for measure in ["Base", "Opponent"]:
        t_agg = {}
        for stype in ["Showcase", "Regular Season"]:
            try:
                tdf = leaguedashteamstats.LeagueDashTeamStats(
                    league_id_nullable=LEAGUE_ID, season=szn,
                    season_type_all_star=stype,
                    measure_type_detailed_defense=measure,
                    per_mode_detailed="Totals"
                ).get_data_frames().pop(0)
                pfx = "OPP_" if measure == "Opponent" else ""
                for _, r in tdf.iterrows():
                    stid = str(r["TEAM_ID"])
                    rec = t_agg.setdefault(stid, {"gp": 0, "w": 0, "l": 0, "fga": 0.0, "fta": 0.0, "pts": 0.0, "tov": 0.0, "fgm": 0.0, "fg3m": 0.0, "fg3a": 0.0, "oreb": 0.0})
                    rec["gp"] += int(r.get("GP", 0) or 0)
                    rec["w"] += int(r.get("W", 0) or 0)
                    rec["l"] += int(r.get("L", 0) or 0)
                    for k, col in [("fga", "FGA"), ("fta", "FTA"), ("pts", "PTS"), ("tov", "TOV"), ("fgm", "FGM"), ("fg3m", "FG3M"), ("fg3a", "FG3A"), ("oreb", "OREB")]:
                        rec[k] += float(r.get(f"{pfx}{col}", 0) or 0)
                time.sleep(0.35)
            except Exception: continue

        for t in data.get("teams", []):
            rec = t_agg.get(str(t["id"]))
            if not rec or rec["gp"] == 0: continue
            fg2m, fg2a = rec["fgm"] - rec["fg3m"], rec["fga"] - rec["fg3a"]
            poss = max(1.0, rec["fga"] + 0.44 * rec["fta"] + rec["tov"] - rec["oreb"])
            target = t.setdefault("defStats" if measure == "Opponent" else "offStats", {})
            target.update({
                "gp": rec["gp"], "w": rec["w"], "l": rec["l"],
                "fg2Pct": round((fg2m / fg2a * 100) if fg2a else 0, 1),
                "fg3Pct": round((rec["fg3m"] / rec["fg3a"] * 100) if rec["fg3a"] else 0, 1),
                "tsPct": round((rec["pts"] / (2 * (rec["fga"] + 0.44 * rec["fta"])) * 100) if (rec["fga"] + 0.44 * rec["fta"]) else 0, 1),
                "threePar": round((rec["fg3a"] / rec["fga"] * 100) if rec["fga"] else 0, 1),
                "ftr": round((rec["fta"] / rec["fga"] * 100) if rec["fga"] else 0, 1),
                "tovPct": round((rec["tov"] / poss * 100), 1),
                "rtg": round((rec["pts"] / poss * 100), 1),
            })

    # 3. Pull Player Base & Advanced across Showcase + Regular Season
    p_map = {}
    for stype in ["Showcase", "Regular Season"]:
        for m_type in ["Base", "Advanced"]:
            try:
                df = leaguedashplayerstats.LeagueDashPlayerStats(
                    league_id_nullable=LEAGUE_ID, season=szn,
                    season_type_all_star=stype,
                    measure_type_detailed_defense=m_type,
                    per_mode_detailed="Totals"
                ).get_data_frames().pop(0)
                for _, r in df.iterrows():
                    key = f"{r['PLAYER_ID']}_{r['TEAM_ABBREVIATION']}"
                    rec = p_map.setdefault(key, {"id": str(r["PLAYER_ID"]), "name": str(r["PLAYER_NAME"]).strip(), "team": str(r["TEAM_ABBREVIATION"]).strip(), "gp": 0, "min": 0.0, "pts": 0.0, "reb": 0.0, "ast": 0.0, "tov": 0.0, "stl": 0.0, "blk": 0.0, "fgm": 0.0, "fga": 0.0, "fg3m": 0.0, "fg3a": 0.0, "fta": 0.0, "poss": 0.0, "ortg_w": 0.0, "drtg_w": 0.0, "usg_w": 0.0})
                    if m_type == "Base":
                        rec["gp"] += int(r.get("GP", 0) or 0)
                        for k, col in [("min", "MIN"), ("pts", "PTS"), ("reb", "REB"), ("ast", "AST"), ("tov", "TOV"), ("stl", "STL"), ("blk", "BLK"), ("fgm", "FGM"), ("fga", "FGA"), ("fg3m", "FG3M"), ("fg3a", "FG3A"), ("fta", "FTA")]:
                            rec[k] += float(r.get(col, 0) or 0)
                    else:
                        ps = float(r.get("POSS", 0) or 0)
                        rec["poss"] += ps
                        rec["ortg_w"] += float(r.get("OFF_RATING", 0) or 0) * ps
                        rec["drtg_w"] += float(r.get("DEF_RATING", 0) or 0) * ps
                        rec["usg_w"] += float(r.get("USG_PCT", 0) or 0) * 100 * ps
                time.sleep(0.35)
            except Exception: continue

    by_team = {}
    for rec in p_map.values():
        gp = max(1, rec["gp"])
        poss = max(1.0, rec["poss"] or (rec["min"] * 2.1) or 1.0)
        rec["mpg"] = round(rec["min"] / gp, 1)
        rec["min"] = round(rec["min"], 1)
        for k in ["pts", "reb", "ast", "tov", "stl", "blk"]:
            rec[f"{k}75"] = round(rec[k] / poss * 75, 1)
        rec["fgPct"] = round((rec["fgm"] / rec["fga"] * 100) if rec["fga"] else 0, 1)
        rec["fg3Pct"] = round((rec["fg3m"] / rec["fg3a"] * 100) if rec["fg3a"] else 0, 1)
        rec["tsPct"] = round((rec["pts"] / (2 * (rec["fga"] + 0.44 * rec["fta"])) * 100) if (rec["fga"] + 0.44 * rec["fta"]) else 0, 1)
        rec["ortg"] = round(rec["ortg_w"] / poss, 1) if rec["poss"] else 0
        rec["drtg"] = round(rec["drtg_w"] / poss, 1) if rec["poss"] else 0
        rec["netRtg"] = round(rec["ortg"] - rec["drtg"], 1)
        rec["usg"] = round(rec["usg_w"] / poss, 1) if rec["poss"] else 0
        b = bio_lookup.get(rec["name"].lower(), {})
        rec["age"] = b.get("age"); rec["height"] = b.get("height") or "—"; rec["heightIn"] = parse_height_in(rec["height"]); rec["weight"] = b.get("weight")
        by_team.setdefault(rec["team"], []).append(rec)

    for t in data.get("teams", []):
        plist = sorted(by_team.get(t.get("abbrev", ""), []), key=lambda x: x.get("min", 0), reverse=True)
        tm_net = round(t.get("offStats", {}).get("rtg", 0) - t.get("defStats", {}).get("rtg", 0), 1)
        t["netRtg"] = tm_net
        w_age = m_age = w_ht = m_ht = w_wt = m_wt = 0.0
        for p in plist:
            m = float(p.get("min", 0) or 0); p["onOff"] = round(p.get("netRtg", 0) - tm_net, 1)
            if p.get("age"):
                try: w_age += float(p["age"]) * m; m_age += m
                except Exception: pass
            if p.get("heightIn"): w_ht += float(p["heightIn"]) * m; m_ht += m
            if p.get("weight"):
                try: w_wt += float(p["weight"]) * m; m_wt += m
                except Exception: pass
        t["avgAge"] = round(w_age / m_age, 1) if m_age > 0 else None
        t["avgHeightIn"] = round(w_ht / m_ht, 2) if m_ht > 0 else None
        t["avgHeight"] = fmt_height(t["avgHeightIn"])
        t["avgWeight"] = round(w_wt / m_wt, 1) if m_wt > 0 else None
        t["rosterStats"] = plist

    for fld, out_k in [("avgAge", "agePctile"), ("avgHeightIn", "heightPctile"), ("avgWeight", "weightPctile")]:
        vals = sorted([t[fld] for t in data["teams"] if t.get(fld) is not None])
        for t in data["teams"]:
            v = t.get(fld)
            t[out_k] = round((sum(1 for x in vals if x < v) / (len(vals) - 1)) * 100) if (v is not None and len(vals) > 1) else None

    json.dump(data, open(path, "w", encoding="utf-8"))
    print(f"Saved full Showcase + Regular Season stats & physicals to {path}!")
