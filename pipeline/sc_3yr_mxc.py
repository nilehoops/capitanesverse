import json
import os
import re
import time
from nba_api.stats.endpoints import leaguegamefinder, playbyplayv3

SEASONS = ["2024-25", "2025-26", "2026-27"]
LEAGUE_ID = "20"
CACHE_DIR = "data/pbp_sc_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

ORDER = ["24-18s (Very Early)", "18-15s (Early)", "15-7s (Average)", "7-4s (Late)", "4-0s (Very Late)"]

def parse_clock(iso_str):
    m = re.match(r"PT(\d+)M([\d.]+)S", str(iso_str or ""))
    return int(m.group(1)) * 60.0 + float(m.group(2)) if m else 0.0

def bucket(sc_rem):
    if sc_rem >= 18.0: return "24-18s (Very Early)"
    if sc_rem >= 15.0: return "18-15s (Early)"
    if sc_rem >= 7.0:  return "15-7s (Average)"
    if sc_rem >= 4.0:  return "7-4s (Late)"
    return "4-0s (Very Late)"

def pctile(val, pool):
    if val is None or len(pool) <= 1:
        return 100.0 if val is not None else 0.0
    below = sum(1 for x in pool if x < val)
    ties = sum(1 for x in pool if abs(x - val) < 1e-9)
    return round(((below + 0.5 * (ties - 1)) / (len(pool) - 1)) * 100, 1)

# Structure: team_season_stats[(season, team_tricode)][bucket] = {"3pm": int, "3pa": int}
team_season_stats = {}
league_all = {b: {"3pm": 0, "3pa": 0} for b in ORDER}

for season in SEASONS:
    cache_file = os.path.join(CACHE_DIR, f"{season}.json")
    if os.path.exists(cache_file):
        s_data = json.load(open(cache_file, encoding="utf-8"))
        print(f"Loaded cached {season} shot-clock data ({len(s_data)} teams).")
    else:
        print(f"Fetching {season} G League game log...")
        games_df = leaguegamefinder.LeagueGameFinder(
            league_id_nullable=LEAGUE_ID,
            season_nullable=season
        ).get_data_frames()[0]
        played = games_df[games_df["WL"].notna()]
        game_ids = sorted(played["GAME_ID"].astype(str).unique().tolist())
        print(f"  Found {len(game_ids)} completed games in {season}. Processing play-by-play...")

        s_data = {}
        for idx_g, gid in enumerate(game_ids, 1):
            try:
                pbp = playbyplayv3.PlayByPlayV3(game_id=gid).get_data_frames()[0]
                pbp = pbp.sort_values("actionNumber").reset_index(drop=True)
            except Exception as e:
                time.sleep(0.8)
                continue

            cur_period = 0
            poss_tm = ""
            poss_start_clk = 720.0
            shot_clock_max = 24.0
            non_final_ft = False

            for _, row in pbp.iterrows():
                p = int(row["period"])
                clk = parse_clock(row["clock"])
                act = str(row["actionType"] or "")
                sub = str(row.get("subType") or "")
                desc = str(row["description"] or "")
                tm = str(row["teamTricode"] or "")

                if p != cur_period:
                    cur_period = p
                    poss_tm = tm
                    poss_start_clk = clk
                    shot_clock_max = 24.0
                    non_final_ft = False

                if act in ["Made Shot", "Missed Shot", "Turnover", "Free Throw"] and tm != "":
                    if poss_tm != tm:
                        poss_tm = tm
                        poss_start_clk = clk
                        shot_clock_max = 24.0

                if act in ["Made Shot", "Missed Shot"] and tm != "":
                    if "3PT" in desc or row.get("shotValue", 0) == 3:
                        elapsed = max(0.0, poss_start_clk - clk)
                        sc_rem = max(0.0, min(shot_clock_max, shot_clock_max - elapsed))
                        b = bucket(sc_rem)
                        if tm not in s_data:
                            s_data[tm] = {k: {"3pm": 0, "3pa": 0} for k in ORDER}
                        s_data[tm][b]["3pa"] += 1
                        if act == "Made Shot":
                            s_data[tm][b]["3pm"] += 1
                    if act == "Made Shot":
                        poss_tm = ""
                        shot_clock_max = 24.0

                elif act == "Turnover" and tm != "":
                    poss_tm = ""
                    shot_clock_max = 24.0
                    non_final_ft = False

                elif act == "Free Throw" and tm != "":
                    non_final_ft = any(x in sub for x in ["1 of 2", "1 of 3", "2 of 3"])
                    if not non_final_ft and "MISS" not in desc.upper():
                        poss_tm = ""
                        shot_clock_max = 24.0

                elif act == "Rebound" and poss_tm != "" and not non_final_ft:
                    if tm == poss_tm:
                        poss_start_clk = clk
                        shot_clock_max = 14.0
                    else:
                        poss_tm = tm
                        poss_start_clk = clk
                        shot_clock_max = 24.0

            if idx_g % 25 == 0 or idx_g == len(game_ids):
                print(f"  [{season}] Processed {idx_g}/{len(game_ids)} games...")
            time.sleep(0.55)

        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(s_data, f, indent=2)

    for tm, bmap in s_data.items():
        team_season_stats[(season, tm)] = bmap
        for b in ORDER:
            league_all[b]["3pm"] += bmap[b]["3pm"]
            league_all[b]["3pa"] += bmap[b]["3pa"]

# Build leaguewide team-season pools for percentile ranking across all 3 seasons
team_metrics = {}
for (szn, tm), bmap in team_season_stats.items():
    tot_a = sum(bmap[b]["3pa"] for b in ORDER)
    if tot_a < 50:
        continue
    team_metrics[(szn, tm)] = {}
    for b in ORDER:
        m, a = bmap[b]["3pm"], bmap[b]["3pa"]
        team_metrics[(szn, tm)][b] = {
            "3pm": m,
            "3pa": a,
            "pct": (m / a) * 100 if a > 0 else 0.0,
            "freq": (a / tot_a) * 100 if tot_a > 0 else 0.0,
        }

tot_lg_3pa = sum(league_all[b]["3pa"] for b in ORDER)

print("\n=== ALL THREE SEASONS COMBINED (2024-25, 2025-26, 2026-27) — LEAGUEWIDE ===")
print(f"{'SHOT CLOCK WINDOW':<22} | {'3P% (3PM/3PA)':>24} | {'FREQ (% OF 3PA)':>15}")
print("-" * 68)
for b in ORDER:
    m, a = league_all[b]["3pm"], league_all[b]["3pa"]
    p_str = f"{(m/a*100):.1f}% ({m}/{a})" if a else "— (0/0)"
    f_str = f"{(a/tot_lg_3pa*100):.1f}%" if tot_lg_3pa else "0.0%"
    print(f"{b:<22} | {p_str:>24} | {f_str:>15}")

for target_szn in ["2025-26", "2026-27"]:
    mxc_data = team_metrics.get((target_szn, "MXC"))
    print(f"\n=== {target_szn} CAPITANES (MXC) — SHOT CLOCK 3P% & FREQUENCY (PERCENTILES VS ALL TEAM-SEASONS) ===")
    if not mxc_data:
        print(f"No MXC games found for {target_szn}.")
        continue
    print(f"{'SHOT CLOCK WINDOW':<22} | {'3P% (3PM/3PA)':>18} | {'3P% PCTILE':>10} | {'FREQ':>7} | {'FREQ PCTILE':>11}")
    print("-" * 78)
    for b in ORDER:
        pool_pct  = [v[b]["pct"]  for v in team_metrics.values()]
        pool_freq = [v[b]["freq"] for v in team_metrics.values()]
        st = mxc_data[b]
        p_str = f"{st['pct']:.1f}% ({st['3pm']}/{st['3pa']})"
        f_str = f"{st['freq']:.1f}%"
        p_rk = f"{pctile(st['pct'], pool_pct):.1f}th"
        f_rk = f"{pctile(st['freq'], pool_freq):.1f}th"
        print(f"{b:<22} | {p_str:>18} | {p_rk:>10} | {f_str:>7} | {f_rk:>11}")
