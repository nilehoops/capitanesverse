"""
Diagnostic run #4 — NOT the main photo-fetch script. Tests a genuinely new
lead found via a public GitHub discussion + the pseudo-r/Public-ESPN-API docs,
after three prior attempts at ESPN's athlete-list/search endpoints failed:

  Attempt 1 (search): wrong path (/apis/common/v3/search instead of
  /apis/search/v2), plus an invented mode=prefix param.

  Attempt 2 (season param): sports.core.api.espn.com/v2/.../athletes with no
  season param — got count:0/pageCount:0.

  Attempt 3 (corrected search + season): fixed both of the above, but never
  actually got tested against real data before the thread moved on.

This new lead is a DIFFERENT endpoint entirely: v3, not v2, and no
"/leagues/" path segment. A public developer thread confirms this one
returned the full athlete list (with IDs) for an entire CBB season as
recently as 2023-24 — though the same thread notes it later stopped working
for *past* seasons specifically. This tests whether it works for the
*current* season right now, and whether headshot URLs come back inline
(the ESPN API docs repo specifically recommends using inline URLs from
athlete/roster responses rather than constructing headshot URLs separately).

Prints full raw output. Does NOT write to any player data file.
"""

import json
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}

# A handful of real names from our own dataset, to check for actual matches
# if the endpoint returns data — not just "does it return SOMETHING."
TEST_NAMES = ["Lynn Kidd", "Chad Baker-Mazara", "Andersson Garcia"]


def test_v3_athletes_endpoint():
    print("=" * 60)
    print("TEST: ESPN v3 athletes endpoint (no /leagues/ segment)")
    print("=" * 60)
    url = "https://sports.core.api.espn.com/v3/sports/basketball/mens-college-basketball/athletes"
    # Not literally 1000000000 — a large-but-sane limit is enough to confirm
    # whether this is working at all before ever considering a full pull.
    params = {"limit": 20000}
    print(f"Requesting: {url} with params {params}\n")
    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=30)
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
    count = data.get("count")
    page_count = data.get("pageCount")
    items = data.get("items", [])
    print(f"count: {count}, pageCount: {page_count}, items returned: {len(items)}")

    if not items:
        print("\nNo items returned — endpoint confirmed not working right now.")
        return

    print(f"\nFirst item raw structure:\n{json.dumps(items[0], indent=2)[:1500]}")

    # Check specifically whether a headshot URL comes back inline, per the
    # documentation's tip, or whether we'd need a second lookup per athlete.
    first = items[0]
    if "headshot" in first:
        print(f"\nInline headshot field found: {json.dumps(first['headshot'], indent=2)}")
    else:
        print("\nNo inline 'headshot' field on this item — would need a per-athlete follow-up call.")

    # Try to find our test names in whatever got returned.
    print(f"\nSearching returned items for known player names: {TEST_NAMES}")
    names_found = {item.get("displayName", "") for item in items if item.get("displayName")}
    for name in TEST_NAMES:
        match = next((n for n in names_found if name.lower() in n.lower()), None)
        print(f"  {name}: {'FOUND as ' + repr(match) if match else 'not in this batch'}")


if __name__ == "__main__":
    test_v3_athletes_endpoint()
