import json
import os

SEASONS = ["2024-25", "2025-26", "2026-27"]
CACHE_DIR = "data/pbp_sc_cache"

GROUPS = [
    ("Early Clock (24-18s)", ["24-18s (Very Early)"]),
    ("Mid-Clock (15-7s)",    ["15-7s (Average)"]),
    ("Late Clock (7-0s)",    ["7-4s (Late)", "4-0s (Very Late)"]),
]

def pctile(val, pool):
    if val is None or len(pool) <= 1:
        return 100.0 if val is not None else 0.0
    below = sum(1 for x in pool if x < val)
    ties = sum(1 for x in pool if abs(x - val) < 1e-9)
    return round(((below + 0.5 * (ties - 1)) / (len(pool) - 1)) * 100, 1)

team_season_stats = {}
league_all = {g_lbl: {"3pm": 0, "3pa": 0} for g_lbl, _ in GROUPS}

for season in SEASONS:
    cache_file = os.path.join(CACHE_DIR, f"{season}.json")
    if not os.path.exists(cache_file):
        raise FileNotFoundError(f"Waiting for {cache_file} to finish caching first.")
    s_data = json.load(open(cache_file, encoding="utf-8"))

    for tm, bmap in s_data.items():
        grouped = {}
        for g_lbl, raw_keys in GROUPS:
            m = sum(bmap.get(k, {}).get("3pm", 0) for k in raw_keys)
            a = sum(bmap.get(k, {}).get("3pa", 0) for k in raw_keys)
            grouped[g_lbl] = {"3pm": m, "3pa": a}
            league_all[g_lbl]["3pm"] += m
            league_all[g_lbl]["3pa"] += a
        team_season_stats[(season, tm)] = grouped

team_metrics = {}
for (szn, tm), gmap in team_season_stats.items():
    tot_a = sum(gmap[g_lbl]["3pa"] for g_lbl, _ in GROUPS)
    if tot_a < 40:
        continue
    team_metrics[(szn, tm)] = {}
    for g_lbl, _ in GROUPS:
        m, a = gmap[g_lbl]["3pm"], gmap[g_lbl]["3pa"]
        team_metrics[(szn, tm)][g_lbl] = {
            "3pm": m,
            "3pa": a,
            "pct": (m / a) * 100 if a > 0 else 0.0,
            "freq": (a / tot_a) * 100 if tot_a > 0 else 0.0,
        }

tot_lg_3pa = sum(league_all[g_lbl]["3pa"] for g_lbl, _ in GROUPS)

print("\n=== ALL THREE SEASONS COMBINED (2024-25, 2025-26, 2026-27) — LEAGUEWIDE ===")
print(f"{'SHOT CLOCK WINDOW':<22} | {'3P% (3PM/3PA)':>24} | {'FREQ (% OF 3PA)':>15}")
print("-" * 68)
for g_lbl, _ in GROUPS:
    m, a = league_all[g_lbl]["3pm"], league_all[g_lbl]["3pa"]
    p_str = f"{(m/a*100):.1f}% ({m}/{a})" if a else "— (0/0)"
    f_str = f"{(a/tot_lg_3pa*100):.1f}%" if tot_lg_3pa else "0.0%"
    print(f"{g_lbl:<22} | {p_str:>24} | {f_str:>15}")

for target_szn in ["2025-26", "2026-27"]:
    mxc_data = team_metrics.get((target_szn, "MXC"))
    print(f"\n=== {target_szn} CAPITANES (MXC) — EARLY / MID / LATE CLOCK 3P% & FREQUENCY ===")
    if not mxc_data:
        print(f"No MXC games found for {target_szn}.")
        continue
    print(f"{'SHOT CLOCK WINDOW':<22} | {'3P% (3PM/3PA)':>18} | {'3P% PCTILE':>10} | {'FREQ':>7} | {'FREQ PCTILE':>11}")
    print("-" * 78)
    for g_lbl, _ in GROUPS:
        pool_pct  = [v[g_lbl]["pct"]  for v in team_metrics.values()]
        pool_freq = [v[g_lbl]["freq"] for v in team_metrics.values()]
        st = mxc_data[g_lbl]
        p_str = f"{st['pct']:.1f}% ({st['3pm']}/{st['3pa']})"
        f_str = f"{st['freq']:.1f}%"
        p_rk = f"{pctile(st['pct'], pool_pct):.1f}th"
        f_rk = f"{pctile(st['freq'], pool_freq):.1f}th"
        print(f"{g_lbl:<22} | {p_str:>18} | {p_rk:>10} | {f_str:>7} | {f_rk:>11}")
