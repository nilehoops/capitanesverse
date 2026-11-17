import json, re, time, unicodedata
from nba_api.stats.endpoints import leaguedashteamstats, leaguedashplayerstats, commonteamroster, leaguedashlineups, playerindex

LEAGUE_ID = "20"

def norm_name(s):
    if not s: return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[.,'’\-]", " ", s.lower())
    return " ".join([w for w in s.split() if w not in {"jr", "sr", "ii", "iii", "iv", "v"}])

def parse_height_in(h_str):
    try:
        parts = str(h_str).strip().split("-")
        if len(parts) == 2: return int(parts.pop(0)) * 12 + int(parts.pop(0))
    except Exception: pass
    return None

def fmt_height(inches):
    if not inches: return "—"
    return f"{int(round(inches)) // 12}'{int(round(inches)) % 12}\""

bio_lookup = {}
try:
    p_idx = json.load(open("data/players_index.json", encoding="utf-8"))
    p_det = json.load(open("data/players_detail.json", encoding="utf-8"))
    for item in (p_idx if isinstance(p_idx, list) else list(p_idx.values())):
        if not isinstance(item, dict) or not item.get("name"): continue
        bio = (p_det.get(str(item.get("id", "")), {}) if isinstance(p_det, dict) else {}).get("biography", {})
        bio_lookup[norm_name(item["name"])] = {"age": bio.get("age") or item.get("age"), "height": bio.get("height") or item.get("height"), "weight": bio.get("weight") or item.get("weight")}
except Exception: pass

for lid in ["00", "20"]:
    try:
        pi_df = playerindex.PlayerIndex(league_id=lid, season="2026-27").get_data_frames().pop(0)
        for _, r in pi_df.iterrows():
            nm = norm_name(f"{r.get('PLAYER_FIRST_NAME', '')} {r.get('PLAYER_LAST_NAME', '')}")
            if not nm: continue
            entry = bio_lookup.setdefault(nm, {})
            if r.get("HEIGHT") and not entry.get("height"): entry["height"] = str(r["HEIGHT"])
            wt = r.get("WEIGHT")
            if wt and not entry.get("weight") and str(wt).replace(".", "", 1).isdigit(): entry["weight"] = float(wt)
        time.sleep(0.3)
    except Exception: pass
for szn in ["2026-27", "2025-26"]:
    path = f"data/league_lite_shots_{szn}.json"
    try: data = json.load(open(path, encoding="utf-8"))
    except Exception: continue
    print(f"Enriching 31 teams (Percentiles, Lineups, 2PT%/3PAr/FTr & Physicals) for {szn}...")

    for t in data.get("teams", []):
        try:
            rdf = commonteamroster.CommonTeamRoster(team_id=int(t["id"]), season=szn, league_id_nullable=LEAGUE_ID).get_data_frames().pop(0)
            for _, r in rdf.iterrows():
                nm = norm_name(r.get("PLAYER", ""))
                if not nm: continue
                b = bio_lookup.setdefault(nm, {})
                if r.get("AGE") and not b.get("age"): b["age"] = float(r["AGE"])
                if r.get("HEIGHT") and not b.get("height"): b["height"] = str(r["HEIGHT"])
                wt = r.get("WEIGHT")
                if wt and not b.get("weight") and str(wt).replace(".", "", 1).isdigit(): b["weight"] = float(wt)
            time.sleep(0.2)
        except Exception: continue

    for measure in ["Base", "Opponent"]:
        t_agg = {}
        for stype in ["Showcase", "Regular Season"]:
            try:
                tdf = leaguedashteamstats.LeagueDashTeamStats(league_id_nullable=LEAGUE_ID, season=szn, season_type_all_star=stype, measure_type_detailed_defense=measure, per_mode_detailed="Totals").get_data_frames().pop(0)
                pfx = "OPP_" if measure == "Opponent" else ""
                for _, r in tdf.iterrows():
                    stid = str(r["TEAM_ID"])
                    rec = t_agg.setdefault(stid, {"gp": 0, "w": 0, "l": 0, "fga": 0.0, "fta": 0.0, "pts": 0.0, "tov": 0.0, "fgm": 0.0, "fg3m": 0.0, "fg3a": 0.0, "oreb": 0.0})
                    rec["gp"] += int(r.get("GP", 0) or 0); rec["w"] += int(r.get("W", 0) or 0); rec["l"] += int(r.get("L", 0) or 0)
                    for k, col in [("fga", "FGA"), ("fta", "FTA"), ("pts", "PTS"), ("tov", "TOV"), ("fgm", "FGM"), ("fg3m", "FG3M"), ("fg3a", "FG3A"), ("oreb", "OREB")]: rec[k] += float(r.get(f"{pfx}{col}", 0) or 0)
                time.sleep(0.25)
            except Exception: continue
        for t in data.get("teams", []):
            rec = t_agg.get(str(t["id"]))
            if not rec or rec["gp"] == 0: continue
            fg2m, fg2a = rec["fgm"] - rec["fg3m"], rec["fga"] - rec["fg3a"]
            poss = max(1.0, rec["fga"] + 0.44 * rec["fta"] + rec["tov"] - rec["oreb"])
            target = t.setdefault("defStats" if measure == "Opponent" else "offStats", {})
            target.update({"gp": rec["gp"], "w": rec["w"], "l": rec["l"], "fg2Pct": round((fg2m / fg2a * 100) if fg2a else 0, 1), "fg3Pct": round((rec["fg3m"] / rec["fg3a"] * 100) if rec["fg3a"] else 0, 1), "tsPct": round((rec["pts"] / (2 * (rec["fga"] + 0.44 * rec["fta"])) * 100) if (rec["fga"] + 0.44 * rec["fta"]) else 0, 1), "threePar": round((rec["fg3a"] / rec["fga"] * 100) if rec["fga"] else 0, 1), "ftr": round((rec["fta"] / rec["fga"] * 100) if rec["fga"] else 0, 1), "tovPct": round((rec["tov"] / poss * 100), 1), "rtg": round((rec["pts"] / poss * 100), 1)})

    for side, sk, ok, inv in [("offStats", "tovPct", "tovPctile", True), ("defStats", "tovPct", "forcedTovPctile", False), ("offStats", "threePar", "threeParPctile", False)]:
        vals = sorted([t.get(side, {}).get(sk) for t in data["teams"] if t.get(side, {}).get(sk) is not None])
        for t in data["teams"]:
            v = t.get(side, {}).get(sk)
            t.setdefault(side, {})[ok] = round((sum(1 for x in vals if (x > v if inv else x < v)) / (len(vals) - 1)) * 100) if (v is not None and len(vals) > 1) else None
    lineups_by_team = {}
    for gqty, lkey in [(2, "duos"), (3, "trios"), (4, "quads"), (5, "fiveman")]:
        l_agg = {}
        for stype in ["Showcase", "Regular Season"]:
            try:
                ldf = leaguedashlineups.LeagueDashLineups(league_id_nullable=LEAGUE_ID, season=szn, season_type_all_star=stype, group_quantity=gqty, measure_type_detailed_defense="Advanced").get_data_frames().pop(0)
                for _, r in ldf.iterrows():
                    ab = str(r.get("TEAM_ABBREVIATION", "")).strip(); gname = str(r.get("GROUP_NAME", "")).strip(); poss = float(r.get("POSS", 0) or 0); mins = float(r.get("MIN", 0) or 0)
                    if not ab or not gname or poss <= 0: continue
                    rec = l_agg.setdefault((ab, gname), {"players": gname, "min": 0.0, "poss": 0.0, "ortg_w": 0.0, "drtg_w": 0.0})
                    rec["min"] += mins; rec["poss"] += poss; rec["ortg_w"] += float(r.get("OFF_RATING", 0) or 0) * poss; rec["drtg_w"] += float(r.get("DEF_RATING", 0) or 0) * poss
                time.sleep(0.3)
            except Exception: continue
        for (ab, _), rec in l_agg.items():
            ps = rec["poss"]; ortg = round(rec["ortg_w"] / ps, 1); drtg = round(rec["drtg_w"] / ps, 1)
            lineups_by_team.setdefault(ab, {}).setdefault(lkey, []).append({"players": rec["players"], "min": round(rec["min"], 1), "poss": int(ps), "ortg": ortg, "drtg": drtg, "netRtg": round(ortg - drtg, 1)})

    for t in data.get("teams", []):
        t["lineups"] = {lk: sorted(lineups_by_team.get(t.get("abbrev", ""), {}).get(lk, []), key=lambda x: x["poss"], reverse=True)[:12] for lk in ["duos", "trios", "quads", "fiveman"]}

    p_map = {}
    for stype in ["Showcase", "Regular Season"]:
        for m_type in ["Base", "Advanced"]:
            try:
                df = leaguedashplayerstats.LeagueDashPlayerStats(league_id_nullable=LEAGUE_ID, season=szn, season_type_all_star=stype, measure_type_detailed_defense=m_type, per_mode_detailed="Totals").get_data_frames().pop(0)
                for _, r in df.iterrows():
                    key = f"{r['PLAYER_ID']}_{r['TEAM_ABBREVIATION']}"
                    rec = p_map.setdefault(key, {"id": str(r["PLAYER_ID"]), "name": str(r["PLAYER_NAME"]).strip(), "team": str(r["TEAM_ABBREVIATION"]).strip(), "gp": 0, "min": 0.0, "pts": 0.0, "reb": 0.0, "ast": 0.0, "tov": 0.0, "stl": 0.0, "blk": 0.0, "fgm": 0.0, "fga": 0.0, "fg3m": 0.0, "fg3a": 0.0, "fta": 0.0, "poss": 0.0, "ortg_w": 0.0, "drtg_w": 0.0, "usg_w": 0.0})
                    if m_type == "Base":
                        rec["gp"] += int(r.get("GP", 0) or 0)
                        for k, col in [("min", "MIN"), ("pts", "PTS"), ("reb", "REB"), ("ast", "AST"), ("tov", "TOV"), ("stl", "STL"), ("blk", "BLK"), ("fgm", "FGM"), ("fga", "FGA"), ("fg3m", "FG3M"), ("fg3a", "FG3A"), ("fta", "FTA")]: rec[k] += float(r.get(col, 0) or 0)
                    else:
                        ps = float(r.get("POSS", 0) or 0); rec["poss"] += ps; rec["ortg_w"] += float(r.get("OFF_RATING", 0) or 0) * ps; rec["drtg_w"] += float(r.get("DEF_RATING", 0) or 0) * ps; rec["usg_w"] += float(r.get("USG_PCT", 0) or 0) * 100 * ps
                time.sleep(0.25)
            except Exception: continue

    by_team = {}
    for rec in p_map.values():
        gp = max(1, rec["gp"]); poss = max(1.0, rec["poss"] or (rec["min"] * 2.1) or 1.0); fg2m, fg2a = rec["fgm"] - rec["fg3m"], rec["fga"] - rec["fg3a"]
        rec["mpg"] = round(rec["min"] / gp, 1); rec["min"] = round(rec["min"], 1)
        for k in ["pts", "reb", "ast", "tov", "stl", "blk"]: rec[f"{k}75"] = round(rec[k] / poss * 75, 1)
        rec["fg2Pct"] = round((fg2m / fg2a * 100) if fg2a else 0, 1); rec["fg3Pct"] = round((rec["fg3m"] / rec["fg3a"] * 100) if rec["fg3a"] else 0, 1)
        rec["tsPct"] = round((rec["pts"] / (2 * (rec["fga"] + 0.44 * rec["fta"])) * 100) if (rec["fga"] + 0.44 * rec["fta"]) else 0, 1)
        rec["threePar"] = round((rec["fg3a"] / rec["fga"] * 100) if rec["fga"] else 0, 1); rec["ftr"] = round((rec["fta"] / rec["fga"] * 100) if rec["fga"] else 0, 1)
        rec["ortg"] = round(rec["ortg_w"] / poss, 1) if rec["poss"] else 0; rec["drtg"] = round(rec["drtg_w"] / poss, 1) if rec["poss"] else 0; rec["netRtg"] = round(rec["ortg"] - rec["drtg"], 1); rec["usg"] = round(rec["usg_w"] / poss, 1) if rec["poss"] else 0
        b = bio_lookup.get(norm_name(rec["name"]), {}); rec["age"] = b.get("age"); rec["height"] = b.get("height") or "—"; rec["heightIn"] = parse_height_in(rec["height"]); rec["weight"] = b.get("weight")
        by_team.setdefault(rec["team"], []).append(rec)

    for t in data.get("teams", []):
        plist = sorted(by_team.get(t.get("abbrev", ""), []), key=lambda x: x.get("min", 0), reverse=True)
        tm_net = round(t.get("offStats", {}).get("rtg", 0) - t.get("defStats", {}).get("rtg", 0), 1); t["netRtg"] = tm_net
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
        t["avgAge"] = round(w_age / m_age, 1) if m_age > 0 else None; t["avgHeightIn"] = round(w_ht / m_ht, 2) if m_ht > 0 else None; t["avgHeight"] = fmt_height(t["avgHeightIn"]); t["avgWeight"] = round(w_wt / m_wt, 1) if m_wt > 0 else None; t["rosterStats"] = plist

    for fld, out_k in [("avgAge", "agePctile"), ("avgHeightIn", "heightPctile"), ("avgWeight", "weightPctile")]:
        vals = sorted([t[fld] for t in data["teams"] if t.get(fld) is not None])
        for t in data["teams"]:
            v = t.get(fld); t[out_k] = round((sum(1 for x in vals if x < v) / (len(vals) - 1)) * 100) if (v is not None and len(vals) > 1) else None

    json.dump(data, open(path, "w", encoding="utf-8"), allow_nan=False)
    print(f"Saved enriched 31-team profiles & lineups to {path}!")
