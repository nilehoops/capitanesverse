"""
G League Lineup Data Availability Test
=======================================
Tests whether the NBA Stats API endpoints needed for lineup combination data
(duos/trios net rating across a full season, like the Capitanes graphic) 
actually respond with G League data.

Run this BEFORE building the in-season page to confirm which data path is
available, since the leaguedashlineups endpoint isn't documented as verified
for G League in the machina-sports API reference.

Usage:
    python test_gleague_lineups.py

No API key or dependencies needed beyond requests. Run from any terminal.
"""

import json
import time
import urllib.request
import urllib.error

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.nba.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nba.com",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}

SEASON = "2025-26"  # the 2026 season in starting-year format per the API reference

def fetch(url, label):
    print(f"\n{'='*60}")
    print(f"Testing: {label}")
    print(f"URL: {url}")
    print('='*60)
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            rs = data.get("resultSets", [])
            if rs:
                for r in rs:
                    rows = r.get("rowSet", [])
                    headers = r.get("headers", [])
                    print(f"  Result set: {r.get('name')} — {len(rows)} rows")
                    if rows:
                        print(f"  Columns: {headers[:8]}...")
                        print(f"  Sample row: {rows[0][:8]}...")
                    else:
                        print("  EMPTY — endpoint responded but no data for this season/league")
            else:
                print("  Response keys:", list(data.keys())[:10])
            return data, len(rs[0].get("rowSet", [])) if rs else 0
    except urllib.error.HTTPError as e:
        print(f"  HTTP ERROR {e.code}: {e.reason}")
        return None, 0
    except urllib.error.URLError as e:
        print(f"  CONNECTION ERROR: {e.reason}")
        return None, 0
    except Exception as e:
        print(f"  ERROR: {type(e).__name__}: {e}")
        return None, 0

# --- TEST 1: leaguedashlineups (the ideal path — pre-computed lineup combos) ---
# If this returns G League rows, we can get duo/trio net ratings in one call.
# GROUP_QUANTITY 2=duos, 3=trios, 5=5-man
url1 = (
    "https://stats.nba.com/stats/leaguedashlineups"
    f"?LeagueID=20&Season={SEASON}&SeasonType=Regular+Season"
    "&MeasureType=Advanced&PerMode=PerMinute"
    "&GroupQuantity=2"  # duos first
    "&PaceAdjust=N&Rank=N&Outcome=&Location=&Month=0"
    "&SeasonSegment=&DateFrom=&DateTo=&OpponentTeamID=0"
    "&VsConference=&VsDivision=&GameSegment=&Period=0"
    "&ShotClockRange=&LastNGames=0&GameScope=&PlayerExperience="
    "&PlayerPosition=&StarterBench=&TwoWay=0&MinutesFilter=30"
)
data1, rows1 = fetch(url1, "leaguedashlineups (duos, 30+ min) — G League season 2025-26")
time.sleep(2)  # be polite to stats.nba.com

# --- TEST 2: Same endpoint, trios ---
url2 = url1.replace("GroupQuantity=2", "GroupQuantity=3")
data2, rows2 = fetch(url2, "leaguedashlineups (trios, 30+ min) — same endpoint, GroupQuantity=3")
time.sleep(2)

# --- TEST 3: leaguedashlineups for a Capitanes team specifically ---
# Team ID 1612709929 is Ciudad de Mexico Capitanes on NBA Stats
url3 = (
    "https://stats.nba.com/stats/leaguedashlineups"
    f"?LeagueID=20&Season={SEASON}&SeasonType=Regular+Season"
    "&MeasureType=Advanced&PerMode=PerMinute"
    "&GroupQuantity=2"
    "&TeamID=1612709929"  # Capitanes
    "&PaceAdjust=N&Rank=N&Outcome=&Location=&Month=0"
    "&SeasonSegment=&DateFrom=&DateTo=&OpponentTeamID=0"
    "&VsConference=&VsDivision=&GameSegment=&Period=0"
    "&ShotClockRange=&LastNGames=0&GameScope=&PlayerExperience="
    "&PlayerPosition=&StarterBench=&TwoWay=0&MinutesFilter=0"
)
data3, rows3 = fetch(url3, "leaguedashlineups (Capitanes only, all lineups)")
time.sleep(2)

# --- TEST 4: Fallback — play-by-play for one known Capitanes game ---
# If lineup endpoint fails, play-by-play is the fallback (but requires
# reconstructing lineups manually from sub events, much more complex)
url4 = (
    "https://stats.nba.com/stats/playbyplayv2"
    "?GameID=2022500001&StartPeriod=1&EndPeriod=10"
)
data4, rows4 = fetch(url4, "playbyplayv2 (fallback test with a known game ID format)")
time.sleep(2)

# --- SUMMARY ---
print(f"\n{'='*60}")
print("SUMMARY")
print('='*60)
print(f"leaguedashlineups (duos):        {'✓ ' + str(rows1) + ' rows' if rows1 > 0 else '✗ No data or error'}")
print(f"leaguedashlineups (trios):       {'✓ ' + str(rows2) + ' rows' if rows2 > 0 else '✗ No data or error'}")
print(f"leaguedashlineups (Capitanes):   {'✓ ' + str(rows3) + ' rows' if rows3 > 0 else '✗ No data or error'}")
print(f"playbyplayv2 (fallback):         {'✓ ' + str(rows4) + ' rows' if rows4 > 0 else '✗ No data or error'}")
print()
if rows1 > 0:
    print("RESULT: leaguedashlineups works for G League — the in-season page can")
    print("        pull lineup combo data directly. Build the page around this.")
elif rows4 > 0:
    print("RESULT: leaguedashlineups didn't return G League data, but play-by-play")
    print("        is available as a fallback. Lineup reconstruction from PBP is")
    print("        more complex — will need a GitHub Action to process and cache")
    print("        results rather than computing live in the browser.")
else:
    print("RESULT: Both primary paths failed. Check network/rate-limiting and retry.")
print('='*60)
