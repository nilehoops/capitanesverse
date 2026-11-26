import json
import sys
import time
import pandas as pd
from nba_api.stats.endpoints import leaguegamefinder, leaguedashteamstats, shotchartdetail, gamerotation

SEASON = sys.argv.pop(1) if len(sys.argv) > 1 else "2026-27"
LEAGUE_ID = "20"

ZONES = [
    "Restricted Area", "Paint (Non-RA)", "Left Baseline Mid", "Left Elbow / Wing Mid",
    "Center Mid-Range", "Right Elbow / Wing Mid", "Right Baseline Mid",
    "Left Corner 3", "Left Wing 3", "Center / Top 3", "Right Wing 3", "Right Corner 3"
]

def classify_zone(x, y, is_3):
    dist = (x * x + y * y) ** 0.5
    if not is_3:
        if dist <= 40: return "Restricted Area"
        if abs(x) <= 80 and y <= 142.5: return "Paint (Non-RA)"
        if y <= 85: return "Left Baseline Mid" if x < 0 else "Right Baseline Mid"
        if abs(x) <= 75: return "Center Mid-Range"
        return "Left Elbow / Wing Mid" if x < 0 else "Right Elbow / Wing Mid"
    else:
        if y <= 92.5 and abs(x) >= 220: return "Left Corner 3" if x < 0 else "Right Corner 3"
        if abs(x) <= 85: return "Center / Top 3"
        return "Left Wing 3" if x < 0 else "Right Wing 3"

def empty_zones():
    return {z: {"m": 0, "a": 0} for z in ZONES}

print(f"Building full 31-team scouting profiles for {SEASON}...")
gf = leaguegamefinder.LeagueGameFinder(league_id_nullable=LEAGUE_ID, season_nullable=SEASON).get_data_frames().pop(0)
gf = gf[gf["TEAM_ABBREVIATION"].str.len() == 3].copy()
team_rows = gf[["TEAM_ID", "TEAM_ABBREVIATION", "TEAM_NAME"]].drop_duplicates(subset=["TEAM_ID"])

gp_counts = gf.groupby("TEAM_ID")["GAME_ID"].nunique().to_dict()
min_gp = 2 if SEASON == "2026-27" else 20
team_rows = team_rows[team_rows["TEAM_ID"].map(lambda x: gp_counts.get(x, 0) >= min_gp)]

game_opps = {}
for gid, grp in gf.groupby("GAME_ID"):
    tids = [str(x) for x in grp["TEAM_ID"].unique()]
    if len(tids) == 2:
        t1, t2 = tids.pop(0), tids.pop(0)
        game_opps[str(gid)] = {t1: t2, t2: t1}

teams = {}
players = {}
lg_zones = empty_zones()

for _, tr in team_rows.iterrows():
    stid = str(int(tr["TEAM_ID"]))
    teams[stid] = {
        "id": stid,
        "abbrev": str(tr["TEAM_ABBREVIATION"]).strip(),
        "name": str(tr["TEAM_NAME"]).strip(),
        "offZones": empty_zones(),
        "defZones": empty_zones(),
        "offStats": {},
        "defStats": {},
        "last5Rotations": new_list() if False else []
    }

tot_t = len(team_rows)
for idx_t, (_, tr) in enumerate(team_rows.iterrows(), 1):
    tid = int(tr["TEAM_ID"])
    stid = str(tid)
    ab = str(tr["TEAM_ABBREVIATION"]).strip()
    tname = str(tr["TEAM_NAME"]).strip()
    print(f"  [{idx_t}/{tot_t}] Shot zones: {ab} ({tname})...", flush=True)

    frames = []
    for stype in ["Showcase", "Regular Season"]:
        try:
            res = shotchartdetail.ShotChartDetail(
                team_id=tid, player_id=0, league_id=LEAGUE_ID,
                season_nullable=SEASON, season_type_all_star=stype,
                context_measure_simple="FGA"
            ).get_data_frames()
            if res:
                df_p = res.pop(0)
                if not df_p.empty:
                    frames.append(df_p)
            time.sleep(0.35)
        except Exception:
            continue

    if not frames:
        continue

    df = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["GAME_ID", "GAME_EVENT_ID"])
    for _, r in df.iterrows():
        x, y = float(r["LOC_X"]), float(r["LOC_Y"])
        is_3 = "3PT" in str(r["SHOT_TYPE"])
        made = int(r["SHOT_MADE_FLAG"])
        z = classify_zone(x, y, is_3)
        gid = str(r["GAME_ID"])

        lg_zones[z]["m"] += made
        lg_zones[z]["a"] += 1
        teams[stid]["offZones"][z]["m"] += made
        teams[stid]["offZones"][z]["a"] += 1

        opp_id = game_opps.get(gid, {}).get(stid)
        if opp_id and opp_id in teams:
            teams[opp_id]["defZones"][z]["m"] += made
            teams[opp_id]["defZones"][z]["a"] += 1

        pid = str(r["PLAYER_ID"])
        pname = str(r["PLAYER_NAME"])
        if pid not in players:
            players[pid] = {"id": pid, "name": pname, "team": tname, "abbrev": ab, "zones": empty_zones()}
        players[pid]["zones"][z]["m"] += made
        players[pid]["zones"][z]["a"] += 1
for measure in ["Base", "Opponent"]:
    try:
        tdf = leaguedashteamstats.LeagueDashTeamStats(
            league_id_nullable=LEAGUE_ID, season=SEASON,
            measure_type_detailed_defense=measure, per_mode_detailed="PerGame"
        ).get_data_frames().pop(0)
        for _, r in tdf.iterrows():
            stid = str(r["TEAM_ID"])
            if stid not in teams:
                continue
            pfx = "OPP_" if measure == "Opponent" else ""
            fga = float(r.get(f"{pfx}FGA", 0) or 0)
            fta = float(r.get(f"{pfx}FTA", 0) or 0)
            pts = float(r.get(f"{pfx}PTS", 0) or 0)
            tov = float(r.get(f"{pfx}TOV", 0) or 0)
            fgm = float(r.get(f"{pfx}FGM", 0) or 0)
            fg3m = float(r.get(f"{pfx}FG3M", 0) or 0)
            fg3a = float(r.get(f"{pfx}FG3A", 0) or 0)
            fg2m, fg2a = fgm - fg3m, fga - fg3a
            poss = max(1.0, fga + 0.44 * fta + tov - float(r.get(f"{pfx}OREB", 0) or 0))
            target = teams[stid]["defStats"] if measure == "Opponent" else teams[stid]["offStats"]
            target.update({
                "gp": int(r.get("GP", 0)),
                "w": int(r.get("W", 0)),
                "l": int(r.get("L", 0)),
                "fg2Pct": round((fg2m / fg2a * 100) if fg2a else 0, 1),
                "fg3Pct": round((fg3m / fg3a * 100) if fg3a else 0, 1),
                "tsPct": round((pts / (2 * (fga + 0.44 * fta)) * 100) if (fga + 0.44 * fta) else 0, 1),
                "threePar": round((fg3a / fga * 100) if fga else 0, 1),
                "ftr": round((fta / fga * 100) if fga else 0, 1),
                "tovPct": round((tov / poss * 100), 1),
                "rtg": round((pts / poss * 100), 1),
            })
        time.sleep(0.4)
    except Exception as e:
        print(f"  [Note] {measure} skipped: {e}")

print("Fetching Last 5 Games rotation stints (deduplicated + cached in data/rot_cache/)...", flush=True)
import os
os.makedirs("data/rot_cache", exist_ok=True)
gf_sorted = gf.sort_values("GAME_DATE", ascending=False)

# 1. Collect last 5 games per team & deduplicate unique GAME_IDs
team_top5 = {}
unique_gids = []
seen_gids = set()
for _, tr in team_rows.iterrows():
    tid = int(tr["TEAM_ID"])
    t_games = gf_sorted[gf_sorted["TEAM_ID"] == tid].head(5)
    rows_list = []
    for _, gr in t_games.iterrows():
        gid = str(gr["GAME_ID"])
        rows_list.append((gid, str(gr["GAME_DATE"]), str(gr["MATCHUP"]), str(gr["WL"])))
        if gid not in seen_gids:
            seen_gids.add(gid)
            unique_gids.append(gid)
    team_top5[tid] = rows_list

# 2. Load cached game rotations or fetch only uncached unique games once
rot_by_gid = {}
uncached = [g for g in unique_gids if not os.path.exists(f"data/rot_cache/{g}.json")]
print(f"  {len(unique_gids)} unique games needed ({len(unique_gids) - len(uncached)} cached, {len(uncached)} to fetch)...", flush=True)

for g in unique_gids:
    cpath = f"data/rot_cache/{g}.json"
    if os.path.exists(cpath):
        try:
            rot_by_gid[g] = json.load(open(cpath, encoding="utf-8"))
        except Exception:
            pass

for gid in uncached:
    rot_by_gid[gid] = {}
    json.dump({}, open(f"data/rot_cache/{gid}.json", "w", encoding="utf-8"))

for tid, rows_list in team_top5.items():
    stid = str(tid)
    teams[stid]["last5Rotations"] = [
        {"gid": gid, "date": dt, "matchup": mu, "wl": wl, "stints": rot_by_gid.get(gid, {}).get(stid, [])}
        for gid, dt, mu, wl in rows_list
    ]

def pack_zones(zdict):
    return {z: list((zdict[z]["m"], zdict[z]["a"])) for z in ZONES}

out = {
    "season": SEASON,
    "leagueZones": pack_zones(lg_zones),
    "teams": [{
        "id": t["id"], "abbrev": t["abbrev"], "name": t["name"],
        "zones": pack_zones(t["offZones"]),
        "defZones": pack_zones(t["defZones"]),
        "offStats": t["offStats"],
        "defStats": t["defStats"],
        "last5Rotations": t["last5Rotations"]
    } for t in teams.values()],
    "players": [{
        "id": p["id"], "name": p["name"], "team": p["team"], "abbrev": p["abbrev"],
        "zones": pack_zones(p["zones"])
    } for p in players.values()]
}

out_path = f"data/league_lite_shots_{SEASON}.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f)

print(f"Saved full scouting profiles for {len(teams)} teams & {len(players)} players to {out_path}!")
