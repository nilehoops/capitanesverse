"""
Enriches data/players.json with photoUrl for players who don't have one yet,
using ESPN's real (undocumented but public, no-key-needed) search API.

CONFIRMED live and working (tested manually, real JSON response):
  https://site.web.api.espn.com/apis/common/v3/search?region=us&lang=en&query=<name>&limit=5&mode=prefix
Returns {"items": [...]} where each item has "type" ("player", "team", "league",
etc.), "id", "displayName", and usually an image/link. This script filters to
type == "player" and takes the first match whose displayName loosely matches.

ASSUMPTION not directly confirmed before this Action's first real run: the
exact shape of a "player"-type result (field names for team/sport context used
to disambiguate common names). The parsing below is written defensively —
if ESPN's player-result shape differs from what's assumed here, this will
under-match (skip players) rather than mis-match (attach a wrong photo),
except where noted.

Photo URL pattern (separately confirmed working via the 19 players already
hotlinked manually on the site):
  https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/<espnId>.png

RATE LIMITING: ESPN publishes no official limit, but a production R package
(wehoop, which wraps this same API surface) documents ~1 request/second as
safe in practice, with occasional HTTP 429 or empty payloads above that. This
script sleeps between requests accordingly and is intentionally conservative.

Resumable + rate-limited, same pattern as fetch_videos.py: skips players who
already have a photoUrl, caps requests per run, re-reads the file fresh right
before writing so it only ever touches its own field (photoUrl) and can't
clobber concurrent edits to anything else.
"""

import json
import re
import time
import requests

DATA_PATH = "data/players.json"
MAX_PLAYERS_PER_RUN = 40
SLEEP_BETWEEN_REQUESTS = 1.2  # a bit under wehoop's documented ~1/sec safe pace
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}
SEARCH_URL = "https://site.web.api.espn.com/apis/common/v3/search"


def normalize(s):
    return re.sub(r"[^a-z]", "", s.lower())


def find_espn_photo(name, team):
    """Returns an ESPN athlete id if a confident match is found, else None.
    Confidence check: the returned player's displayName must match our name,
    AND (if the API exposes team/school context) it should overlap with our
    team — same safety idea as fetch_realgm.py's team_overlaps() check, so a
    common name doesn't silently attach the wrong person's photo."""
    try:
        resp = requests.get(
            SEARCH_URL,
            params={"region": "us", "lang": "en", "query": name, "limit": 10, "mode": "prefix"},
            headers=HEADERS, timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return None

    items = data.get("items", [])
    name_norm = normalize(name)

    for item in items:
        if item.get("type") != "player":
            continue
        display_norm = normalize(item.get("displayName", ""))
        if display_norm != name_norm:
            continue  # exact-normalized-name match only — no fuzzy guessing on a common name

        # Team/school context, if present on the result, gets checked as a
        # sanity cross-reference; if the field isn't present at all, this
        # falls through to accepting the name-only match rather than
        # blocking every result on an assumption about the schema.
        team_field = item.get("team", {}).get("displayName", "") if isinstance(item.get("team"), dict) else ""
        if team_field and team and not (normalize(team) in normalize(team_field) or normalize(team_field) in normalize(team)):
            continue

        espn_id = item.get("id")
        if espn_id:
            return str(espn_id)
    return None


def main():
    with open(DATA_PATH) as f:
        players = json.load(f)

    processed = 0
    new_photos = {}  # collected in memory; only merged into a FRESH read at the very end

    for player in players:
        if player.get("photoUrl"):
            continue
        if processed >= MAX_PLAYERS_PER_RUN:
            print(f"Reached MAX_PLAYERS_PER_RUN ({MAX_PLAYERS_PER_RUN}); stopping for this run.")
            break

        espn_id = find_espn_photo(player["name"], player.get("team"))
        processed += 1
        if espn_id:
            new_photos[player["id"]] = f"https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/{espn_id}.png"
            print(f"  {player['name']}: matched ESPN id {espn_id}")
        else:
            print(f"  {player['name']}: no confident match.")

        time.sleep(SLEEP_BETWEEN_REQUESTS)

    # Re-read fresh right before writing and merge only photoUrl — same
    # safety pattern as fetch_videos.py, so a manual edit made while this
    # run was in progress can't get clobbered.
    with open(DATA_PATH) as f:
        fresh_players = json.load(f)
    for p in fresh_players:
        if p["id"] in new_photos:
            p["photoUrl"] = new_photos[p["id"]]

    with open(DATA_PATH, "w") as f:
        json.dump(fresh_players, f, indent=2)

    print(f"Done. Processed {processed}, matched {len(new_photos)}.")


if __name__ == "__main__":
    main()
