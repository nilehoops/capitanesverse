"""
One-time diagnostic run — NOT the main photo-fetch script. Checks whether
ESPN's "core" athlete-list endpoint is a viable alternative to the search
endpoint (which two real runs confirmed returns 0 results for a full player
name, in both prefix and default mode).

The theory: ESPN's cross-content SEARCH may simply deprioritize/exclude
lower-profile college players from its index (built for a mainstream
consumer audience). A direct LIST of all D1 college basketball athletes,
matched locally by name, would sidestep that relevance problem entirely —
if such a list endpoint exists and returns real inline data.

The real unknown this script checks: does
  https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/athletes
return actual athlete objects (name, id) inline, or just {"$ref": "..."}
reference links that would each need a separate follow-up request (a much
bigger undertaking — thousands of individual requests, not one list)?

This prints everything needed to answer that, then stops. It does NOT write
to data/players.json. Run this first; the main fetch_photos.py only gets
rewritten to use this approach if this diagnostic confirms it's workable.
"""

import json
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}
LIST_URL = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/athletes"


def main():
    print(f"Requesting: {LIST_URL}?limit=5\n")
    try:
        resp = requests.get(LIST_URL, params={"limit": 5}, headers=HEADERS, timeout=15)
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
    print(f"count: {data.get('count')}, pageIndex: {data.get('pageIndex')}, pageSize: {data.get('pageSize')}, pageCount: {data.get('pageCount')}")

    items = data.get("items", [])
    print(f"\n{len(items)} items in this page. Full raw content of each:\n")
    for i, item in enumerate(items):
        print(f"--- item {i} ---")
        print(json.dumps(item, indent=2)[:500])
        print()

    if items and isinstance(items[0], dict) and "$ref" in items[0] and len(items[0]) == 1:
        print("VERDICT: items are reference links only ($ref), not inline athlete data.")
        print("This would mean one request PER ATHLETE to resolve names — thousands of")
        print("requests, not one list. Given the D1 population size, this likely isn't")
        print("a practical improvement over the search approach already tried.")
    elif items and isinstance(items[0], dict) and ("displayName" in items[0] or "fullName" in items[0]):
        print("VERDICT: items include real inline athlete data (name field present).")
        print("This looks genuinely usable — worth building the full pagination + local-match approach.")
    else:
        print("VERDICT: unclear from this shape — see the raw item content above.")


if __name__ == "__main__":
    main()
