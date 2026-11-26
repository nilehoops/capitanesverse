import json, os, re, time, unicodedata
from nba_api.stats.endpoints import leaguedashplayerstats

os.makedirs("data/gl_season_cache", exist_ok=True)

def name_key(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9\s]", " ", s.lower())
    return " ".join([w for w in s.split() if w and w not in {"jr", "sr", "ii", "iii", "iv", "v", "de", "del", "dos", "da"}])

det_path = "data/players_detail.json"
idx_path = "data/players_index.json"
ref_path = "data/gleague_players_reference.json"

details = json.load(open(det_path, encoding="utf-8"))
index_list = json.load(open(idx_path, encoding="utf-8"))
ref_list = json.load(open(ref_path, encoding="utf-8")) if os.path.exists(ref_path) else []

gl_strength = None
if os.path.exists("data/league_strength.json"):
    try:
        ls = json.load(open("data/league_strength.json", encoding="utf-8"))
        for k, v in (ls.items() if isinstance(ls, dict) else []):
            if "g league" in str(k).lower() or "gleague" in str(k).lower():
                gl_strength = v.get("pctile") if isinstance(v, dict) else v
                break
    except Exception:
        pass

# Map database players by normalized name
id_to_name = {str(x.get("id")): x.get("name") for x in (index_list if isinstance(index_list, list) else index_list.values()) if isinstance(x, dict) and x.get("name")}
db_by_name = {}
for pid_k, p in (details.items() if isinstance(details, dict) else enumerate(details)):
    if not isinstance(p, dict): continue
    pname = p.get("name") or id_to_name.get(str(p.get("id") or pid_k))
    if not pname: continue
    db_by_name.setdefault(name_key(pname), []).append((pname, p))

SEASONS = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
new_stints_added = 0
touched_names = set()

for szn in SEASONS:
    cpath = f"data/gl_season_cache/{szn}.json"
    rows = None
    if szn != "2026-27" and os.path.exists(cpath):
        try:
            rows = json.load(open(cpath, encoding="utf-8"))
        except Exception:
            rows = None
    if szn == "2026-27" and os.path.exists("data/league_lite_shots_2026-27.json"):
        lite = json.load(open("data/league_lite_shots_2026-27.json", encoding="utf-8"))
        rows = []
        for t in lite.get("teams", []):
            ab = t.get("abbrev") or ""
            for r in t.get("rosterStats", []):
                if float(r.get("min") or 0) <= 0: continue
                fgm = float(r.get("fgm") or 0); fg3m = float(r.get("fg3m") or 0); ftm = float(r.get("ftm") or 0)
                pts = float(r.get("pts") or ((fgm - fg3m) * 2 + fg3m * 3 + ftm))
                rows.append({
                    "PLAYER_NAME": r.get("name", ""), "TEAM_ABBREVIATION": ab,
                    "GP": int(r.get("gp") or 0), "MIN": float(r.get("min") or 0), "PTS": pts,
                    "FGM": fgm, "FGA": float(r.get("fga") or 0),
                    "FG3M": fg3m, "FG3A": float(r.get("fg3a") or 0),
                    "FTM": ftm, "FTA": float(r.get("fta") or 0),
                    "OREB": float(r.get("oreb") or 0), "DREB": float(r.get("dreb") or 0),
                    "AST": float(r.get("ast") or 0), "STL": float(r.get("stl") or 0),
                    "BLK": float(r.get("blk") or 0), "TOV": float(r.get("tov") or 0),
                })
        print(f"Reused {len(rows)} player rows for 2026-27 from data/league_lite_shots_2026-27.json (0 API calls).")
    if rows is None:
        print(f"Fetching G League season totals for {szn}...", flush=True)
        agg = {}
        for stype in ("Showcase", "Regular Season"):
            try:
                dfs = leaguedashplayerstats.LeagueDashPlayerStats(
                    league_id_nullable="20",
                    season=szn,
                    season_type_all_star=stype,
                    per_mode_detailed="Totals"
                ).get_data_frames()
                df = next(iter(dfs))
                if not df.empty:
                    for _, r in df.iterrows():
                        k = f"{r['PLAYER_ID']}_{r['TEAM_ABBREVIATION']}"
                        rec = agg.setdefault(k, {
                            "PLAYER_NAME": str(r["PLAYER_NAME"]).strip(),
                            "TEAM_ABBREVIATION": str(r["TEAM_ABBREVIATION"]).strip(),
                            "GP": 0, "MIN": 0.0, "PTS": 0.0, "FGM": 0.0, "FGA": 0.0,
                            "FG3M": 0.0, "FG3A": 0.0, "FTM": 0.0, "FTA": 0.0,
                            "OREB": 0.0, "DREB": 0.0, "AST": 0.0, "STL": 0.0, "BLK": 0.0, "TOV": 0.0
                        })
                        rec["GP"] += int(r.get("GP") or 0)
                        for col in ("MIN","PTS","FGM","FGA","FG3M","FG3A","FTM","FTA","OREB","DREB","AST","STL","BLK","TOV"):
                            rec[col] += float(r.get(col) or 0)
                time.sleep(0.3)
            except Exception as e:
                print(f"  [Note] {szn} {stype}: {e}", flush=True)
        rows = list(agg.values())
        if rows:
            json.dump(rows, open(cpath, "w", encoding="utf-8"))

    for r in rows:
        ab = r["TEAM_ABBREVIATION"]
        if ab == "TOT": continue
        mins = float(r["MIN"] or 0)
        gp = int(r["GP"] or 0)
        if mins <= 0 or gp <= 0: continue
        nk = name_key(r["PLAYER_NAME"])
        matches = db_by_name.get(nk)
        if not matches: continue

        pts, fgm, fga = r["PTS"], r["FGM"], r["FGA"]
        fg3m, fg3a, ftm, fta = r["FG3M"], r["FG3A"], r["FTM"], r["FTA"]
        orb, drb, ast, stl, blk, tov = r["OREB"], r["DREB"], r["AST"], r["STL"], r["BLK"], r["TOV"]
        fg2m, fg2a = fgm - fg3m, fga - fg3a

        for pname, p in matches:
            stints = p.get("proStints") or []
            p["proStints"] = stints
            # Update existing G League stint for current season or skip if already saved
            existing = next((s for s in stints if str(s.get("league","")).lower() == "g league" and str(s.get("season","")) == szn and str(s.get("team","")) == ab), None)
            stint_obj = {
                "league": "G League",
                "season": szn,
                "team": ab,
                "gp": gp,
                "leagueStrengthPctile": gl_strength,
                "pts40": round(pts / mins * 40, 2),
                "orb40": round(orb / mins * 40, 2),
                "drb40": round(drb / mins * 40, 2),
                "ast40": round(ast / mins * 40, 2),
                "tov40": round(tov / mins * 40, 2),
                "stl40": round(stl / mins * 40, 2),
                "blk40": round(blk / mins * 40, 2),
                "3p_pct": round(fg3m / fg3a, 4) if fg3a > 0 else None,
                "ft_pct": round(ftm / fta, 4) if fta > 0 else None,
                "2p_pct": round(fg2m / fg2a, 4) if fg2a > 0 else None,
                "asttov": round(ast / tov, 2) if tov > 0 else (round(ast, 2) if ast > 0 else None),
                "3par": round(fg3a / fga, 4) if fga > 0 else None,
                "fta_rate": round(fta / fga, 4) if fga > 0 else None,
                "mins": round(mins, 1),
                "per": None,
            }
            if existing is not None:
                if szn == "2026-27":
                    existing.update(stint_obj)
            else:
                stints.append(stint_obj)
                new_stints_added += 1
                touched_names.add(pname)

            if not any(name_key(x.get("name")) == nk for x in ref_list):
                try: yr = int(next(iter(szn.split("-")))) + 1
                except Exception: yr = 2027
                ref_list.append({
                    "name": pname, "norm": nk, "mostRecentYear": yr,
                    "mostRecentTeam": ab, "hasBartStats": bool(p.get("stats")),
                    "totalMinutes": int(round(mins)),
                })

json.dump(details, open(det_path, "w", encoding="utf-8"), indent=2)
json.dump(ref_list, open(ref_path, "w", encoding="utf-8"), indent=2)
print(f"Synced G League careers: added {new_stints_added} G League season stints across {len(touched_names)} players!", flush=True)
