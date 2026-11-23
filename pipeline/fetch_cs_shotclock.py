import json
import time
import urllib.request
import urllib.parse

SEASONS = ["2024-25", "2025-26", "2026-27"]
LEAGUE_ID = "20"  # "20" = NBA G League, "00" = NBA

SHOT_CLOCK_RANGES = [
    "24-22",
    "22-18 Very Early",
    "18-15 Early",
    "15-7 Average",
    "7-4 Late",
    "4-0 Very Late",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://nba.com",
    "Origin": "https://nba.com",
    "Accept": "application/json, text/plain, */*",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}

def fetch_bucket(season, clock_range):
    params = urllib.parse.urlencode({
        "LeagueID": LEAGUE_ID,
        "Season": season,
        "SeasonType": "Regular Season",
        "PerMode": "Totals",
        "ShotClockRange": clock_range,
        "GeneralRange": "Catch and Shoot",
        "CloseDefDistRange": "",
        "College": "",
        "Conference": "",
        "Country": "",
        "DateFrom": "",
        "DateTo": "",
        "Division": "",
        "DraftPick": "",
        "DraftYear": "",
        "DribbleRange": "",
        "GameScope": "",
        "GameSegment": "",
        "Height": "",
        "LastNGames": "0",
        "Location": "",
        "Month": "0",
        "OpponentTeamID": "0",
        "Outcome": "",
        "PORound": "0",
        "PaceAdjust": "N",
        "Period": "0",
        "PlayerExperience": "",
        "PlayerPosition": "",
        "PlusMinus": "N",
        "Rank": "N",
        "StarterBench": "",
        "TeamID": "0",
        "TouchTimeRange": "",
        "VsConference": "",
        "VsDivision": "",
        "Weight": "",
    })
    url = f"https://nba.com?{params}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode("utf-8"))
    rs = data["resultSets"][0]
    hdrs = rs["headers"]
    i_3m, i_3a = hdrs.index("FG3M"), hdrs.index("FG3A")
    m = sum(row[i_3m] or 0 for row in rs["rowSet"])
    a = sum(row[i_3a] or 0 for row in rs["rowSet"])
    pct = round((m / a) * 100, 1) if a > 0 else None
    return {"3pm": int(m), "3pa": int(a), "3p_pct": pct}

results = {}
for sc in SHOT_CLOCK_RANGES:
    results[sc] = {}
    for szn in SEASONS:
        try:
            results[sc][szn] = fetch_bucket(szn, sc)
        except Exception as e:
            results[sc][szn] = {"3pm": 0, "3pa": 0, "3p_pct": None, "err": str(e)}
        time.sleep(0.65)

with open("data/cs_shotclock_3pt.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)

print(f"\n{'SHOT CLOCK':<18} | {'2024-25':>13} | {'2025-26':>13} | {'2026-27':>13} | {'26-25':>7} | {'27-26':>7} | {'27-25':>7}")
print("-" * 92)
for sc in SHOT_CLOCK_RANGES:
    d25, d26, d27 = results[sc]["2024-25"], results[sc]["2025-26"], results[sc]["2026-27"]
    s25 = f"{d25['3p_pct']:.1f}% ({d25['3pa']})" if d25["3p_pct"] is not None else "—"
    s26 = f"{d26['3p_pct']:.1f}% ({d26['3pa']})" if d26["3p_pct"] is not None else "—"
    s27 = f"{d27['3p_pct']:.1f}% ({d27['3pa']})" if d27["3p_pct"] is not None else "—"
    df26_25 = f"{d26['3p_pct'] - d25['3p_pct']:+.1f}%" if (d25["3p_pct"] is not None and d26["3p_pct"] is not None) else "—"
    df27_26 = f"{d27['3p_pct'] - d26['3p_pct']:+.1f}%" if (d26["3p_pct"] is not None and d27["3p_pct"] is not None) else "—"
    df27_25 = f"{d27['3p_pct'] - d25['3p_pct']:+.1f}%" if (d25["3p_pct"] is not None and d27["3p_pct"] is not None) else "—"
    print(f"{sc:<18} | {s25:>13} | {s26:>13} | {s27:>13} | {df26_25:>7} | {df27_26:>7} | {df27_25:>7}")
print("\nSaved to data/cs_shotclock_3pt.json")
