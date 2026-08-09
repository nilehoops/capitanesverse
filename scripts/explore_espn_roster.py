"""
Diagnostic run #3 — NOT the main photo-fetch script. Tests two corrected
endpoints based on real documentation (github.com/pseudo-r/Public-ESPN-API),
after two prior attempts failed:

  Attempt 1 (search): used /apis/common/v3/search with an invented
  mode=prefix param that was never actually confirmed real. The documented
  endpoint is different: /apis/search/v2?query={q}&limit={n}.

  Attempt 2 (athlete list): used sports.core.api.espn.com/.../athletes with
  no season parameter, got count:0/pageCount:0. Athlete rosters are
  season-specific — this tests whether an explicit season param returns
  real data instead of an empty response.

This prints full raw output for both. It does NOT write to players.json.
"""

import json
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}

TEST_NAME = "Lynn Kidd"  # a real player already confirmed in our own dataset


def test_search_v2():
    print("=" * 60)
    print("TEST 1: Corrected search endpoint (/apis/search/v2)")
    print("=" * 60)
    url = "https://site.web.api.espn.com/apis/search/v2"
    params = {"query": TEST_NAME, "limit": 10, "sport": "basketball"}
    print(f"Requesting: {url} with params {params}\n")
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
    except requests.RequestException as e:
        print(f"REQUEST FAILED: {type(e).__name__}: {e}")
        return
    print(f"HTTP status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"Body: {resp.text[:500]}")
        return
    try:
        data = resp.json()
    except ValueError:
        print(f"BAD JSON. Body: {resp.text[:500]}")
        return
    print(f"Top-level keys: {list(data.keys())}")
    print(f"Full raw response:\n{json.dumps(data, indent=2)[:2000]}")


def test_athlete_list_with_season():
    print("\n" + "=" * 60)
    print("TEST 2: Athlete list WITH season parameter")
    print("=" * 60)
    url = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/athletes"
    for season in [2026, 2025]:
        params = {"limit": 5, "season": season}
        print(f"\nRequesting: {url} with params {params}")
        try:
            resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
        except requests.RequestException as e:
            print(f"REQUEST FAILED: {type(e).__name__}: {e}")
            continue
        print(f"HTTP status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"Body: {resp.text[:300]}")
            continue
        try:
            data = resp.json()
        except ValueError:
            print(f"BAD JSON. Body: {resp.text[:300]}")
            continue
        print(f"count: {data.get('count')}, pageCount: {data.get('pageCount')}, items: {len(data.get('items', []))}")
        items = data.get("items", [])
        if items:
            print(f"First item raw:\n{json.dumps(items[0], indent=2)[:1000]}")


if __name__ == "__main__":
    test_search_v2()
    test_athlete_list_with_season()
