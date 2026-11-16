import json, time
from nba_api.stats.endpoints import leaguedashplayerstats, playerindex

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
    try:
        pi_df = playerindex.PlayerIndex(league_id=LEAGUE_ID, season=szn).get_data_frames().pop(0)
        for _, r in pi_df.iterrows():
            nm = f"{r.get('PLAYER_FIRST_NAME', '')} {r.get('PLAYER_LAST_NAME', '')}".strip().lower()
            if not nm: continue
            entry = bio_lookup.setdefault(nm, {})
            if r.get("HEIGHT"): entry["height"] = str(r["HEIGHT"])
            if r.get("WEIGHT"): entry["weight"] = float(r["WEIGHT"])
    except Exception: pass

for szn in ["2026-27", "2025-26"]:
    path = f"data/league_lite_shots_{szn}.json"
    try: data = json.load(open(path, encoding="utf-8"))
    except Exception: continue
    p_map = {}
    for m_type in ["Base", "Advanced"]:
        try:
            df = leaguedashplayerstats.LeagueDashPlayerStats(league_id_nullable=LEAGUE_ID, season=szn, measure_type_detailed_defense=m_type, per_mode_detailed="Totals").get_data_frames().pop(0)
            for _, r in df.iterrows():
                pid = str(r["PLAYER_ID"])
                rec = p_map.setdefault(pid, {"id": pid, "name": str(r["PLAYER_NAME"]).strip(), "team": str(r["TEAM_ABBREVIATION"]).strip()})
                if m_type == "Base":
                    gp = max(1, int(r.get("GP", 0) or 0)); mins = float(r.get("MIN", 0) or 0); fga = float(r.get("FGA", 0) or 0); fta = float(r.get("FTA", 0) or 0); pts = float(r.get("PTS", 0) or 0); fgm = float(r.get("FGM", 0) or 0); fg3m = float(r.get("FG3M", 0) or 0); fg3a = float(r.get("FG3A", 0) or 0)
                    rec.update({"gp": int(r.get("GP", 0) or 0), "min": round(mins, 1), "mpg": round(mins / gp, 1), "pts": pts, "reb": float(r.get("REB", 0) or 0), "ast": float(r.get("AST", 0) or 0), "tov": float(r.get("TOV", 0) or 0), "stl": float(r.get("STL", 0) or 0), "blk": float(r.get("BLK", 0) or 0), "fgPct": round((fgm / fga * 100) if fga else 0, 1), "fg3Pct": round((fg3m / fg3a * 100) if fg3a else 0, 1), "tsPct": round((pts / (2 * (fga + 0.44 * fta)) * 100) if (fga + 0.44 * fta) else 0, 1)})
                else:
                    rec.update({"poss": int(max(1.0, float(r.get("POSS", 0) or 0))), "ortg": round(float(r.get("OFF_RATING", 0) or 0), 1), "drtg": round(float(r.get("DEF_RATING", 0) or 0), 1), "netRtg": round(float(r.get("NET_RATING", 0) or 0), 1), "usg": round(float(r.get("USG_PCT", 0) or 0) * 100, 1)})
            time.sleep(0.35)
        except Exception: pass

    for rec in p_map.values():
        poss = max(1.0, float(rec.get("poss") or (rec.get("min", 0) * 2.1) or 1.0))
        for k in ["pts", "reb", "ast", "tov", "stl", "blk"]: rec[f"{k}75"] = round(rec.get(k, 0) / poss * 75, 1)
        b = bio_lookup.get(rec["name"].lower(), {})
        rec["age"] = b.get("age"); rec["height"] = b.get("height") or "—"; rec["heightIn"] = parse_height_in(rec["height"]); rec["weight"] = b.get("weight")

    by_team = {}
    for rec in p_map.values(): by_team.setdefault(rec["team"], []).append(rec)
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
print("Block 1 done: Enriched 31 teams & updated search labels!")
