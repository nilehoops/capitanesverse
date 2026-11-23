import json
import re
import time
from nba_api.stats.endpoints import leaguegamefinder, playbyplayv3

SEASON = "2026-27"
LEAGUE_ID = "20"  # G League

def parse_clock(iso_str):
    m = re.match(r"PT(\d+)M([\d.]+)S", str(iso_str or ""))
    return int(m.group(1)) * 60.0 + float(m.group(2)) if m else 0.0

def bucket(sc_rem):
    if sc_rem >= 18.0: return "24-18s (Very Early)"
    if sc_rem >= 15.0: return "18-15s (Early)"
    if sc_rem >= 7.0:  return "15-7s (Average)"
    if sc_rem >= 4.0:  return "7-4s (Late)"
    return "4-0s (Very Late)"

ORDER = ["24-18s (Very Early)", "18-15s (Early)", "15-7s (Average)", "7-4s (Late)", "4-0s (Very Late)"]
stats = {b: {"3pm": 0, "3pa": 0, "cs_3pm": 0, "cs_3pa": 0} for b in ORDER}

print(f"Fetching {SEASON} G League game log...")
games_df = leaguegamefinder.LeagueGameFinder(
    league_id_nullable=LEAGUE_ID,
    season_nullable=SEASON
).get_data_frames()[0]

# Filter to played games (WL not null) and deduplicate GAME_ID
played = games_df[games_df["WL"].notna()]
game_ids = sorted(played["GAME_ID"].astype(str).unique().tolist())
print(f"Found {len(game_ids)} completed games in {SEASON}. Processing play-by-play...")

for idx_g, gid in enumerate(game_ids, 1):
    try:
        pbp = playbyplayv3.PlayByPlayV3(game_id=gid).get_data_frames()[0]
        pbp = pbp.sort_values("actionNumber").reset_index(drop=True)
    except Exception as e:
        print(f"  [{idx_g}/{len(game_ids)}] Skipped {gid}: {e}")
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
            is_3 = ("3PT" in desc or row.get("shotValue", 0) == 3)
            if is_3:
                elapsed = max(0.0, poss_start_clk - clk)
                sc_rem = max(0.0, min(shot_clock_max, shot_clock_max - elapsed))
                b = bucket(sc_rem)
                made = 1 if act == "Made Shot" else 0
                sub_low = sub.lower()
                is_cs = ("pullup" not in sub_low and "step back" not in sub_low and "driving" not in sub_low and "fadeaway" not in sub_low)
                stats[b]["3pa"] += 1
                stats[b]["3pm"] += made
                if is_cs:
                    stats[b]["cs_3pa"] += 1
                    stats[b]["cs_3pm"] += made
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

    if idx_g % 10 == 0 or idx_g == len(game_ids):
        print(f"  Processed {idx_g}/{len(game_ids)} games...")
    time.sleep(0.65)

tot_3pa = sum(stats[b]["3pa"] for b in ORDER)
tot_cs_3pa = sum(stats[b]["cs_3pa"] for b in ORDER)

with open("data/sc_2026_27_3pt.json", "w", encoding="utf-8") as f:
    json.dump({"season": SEASON, "games": len(game_ids), "total_3pa": tot_3pa, "total_cs_3pa": tot_cs_3pa, "buckets": stats}, f, indent=2)

print(f"\n2026-27 G League Leaguewide ({len(game_ids)} Games) — 3P% & Attempt Share by Shot Clock:")
print(f"{'SHOT CLOCK WINDOW':<22} | {'ALL 3P% (3PM/3PA)':>21} | {'% OF 3PA':>9} | {'C&S 3P% (3PM/3PA)':>21} | {'% OF C&S':>9}")
print("-" * 94)
for b in ORDER:
    s = stats[b]
    all_str = f"{(s['3pm']/s['3pa']*100):.1f}% ({s['3pm']}/{s['3pa']})" if s["3pa"] else "— (0/0)"
    all_shr = f"{(s['3pa']/tot_3pa*100):.1f}%" if tot_3pa else "0.0%"
    cs_str  = f"{(s['cs_3pm']/s['cs_3pa']*100):.1f}% ({s['cs_3pm']}/{s['cs_3pa']})" if s["cs_3pa"] else "— (0/0)"
    cs_shr  = f"{(s['cs_3pa']/tot_cs_3pa*100):.1f}%" if tot_cs_3pa else "0.0%"
    print(f"{b:<22} | {all_str:>21} | {all_shr:>9} | {cs_str:>21} | {cs_shr:>9}")
