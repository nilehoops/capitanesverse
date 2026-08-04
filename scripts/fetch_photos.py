"""
Enriches data/players.json with photoUrl for players who don't have one yet,
using ESPN's real (undocumented but public, no-key-needed) search API.

CONFIRMED from a real production run: the endpoint responds (HTTP 200, valid
JSON) with a paginated envelope — {"count", "pageIndex", "pageSize",
"pageCount", "items"} — not the flat {"items": [...]} originally assumed.
mode=prefix returned 0 items for a real full "First Last" player-name query
in that run, which is why this version tries both mode=prefix and the
default (no mode param) and logs which one, if either, actually returns
results — that answer is still open as of this version.

Once results DO come back, each item is expected to have "type" ("player",
"team", "league", etc.), "id", "displayName", and possibly a "team" field —
that part is still an assumption pending real data, same caveat as before:
written defensively so a wrong assumption means under-matching (skip),
not mis-matching (wrong photo).
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


def _do_search(name, extra_params, debug_label, debug):
    """One request attempt. Returns (items_list_or_None, diagnostic_string)."""
    params = {"region": "us", "lang": "en", "query": name, "limit": 10}
    params.update(extra_params)
    try:
        resp = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=15)
    except requests.RequestException as e:
        return None, f"[{debug_label}] REQUEST FAILED: {type(e).__name__}: {e}"

    if resp.status_code != 200:
        return None, f"[{debug_label}] HTTP {resp.status_code}: {resp.text[:200]}"

    try:
        data = resp.json()
    except ValueError:
        return None, f"[{debug_label}] BAD JSON (status 200, body: {resp.text[:200]})"

    items = data.get("items", [])
    if debug:
        print(f"    [debug:{debug_label}] top-level keys: {list(data.keys())}, count={data.get('count')}, {len(items)} items")
        if items:
            print(f"    [debug:{debug_label}] first item raw: {json.dumps(items[0])[:300]}")

    if not items:
        return None, f"[{debug_label}] 0 items (count field: {data.get('count')})"
    return items, f"[{debug_label}] {len(items)} items"


def find_espn_photo(name, team, debug=False):
    """Returns (espn_id_or_None, diagnostic_string).

    Tries the query two ways: with mode=prefix (an untested assumption from
    before this script's first real run — meant for autocomplete-as-you-type,
    which may not match a full "First Last" string the way a single indexed
    token would) and without it (default search behavior). Whichever actually
    returns items gets used; the diagnostic says which one worked, so this
    run's log settles the question instead of guessing a third time."""
    attempts = [
        ("prefix", {"mode": "prefix"}),
        ("default", {}),
    ]
    last_diag = None
    for i, (label, extra) in enumerate(attempts):
        if i > 0:
            time.sleep(0.5)  # second attempt for this same player — stay under the safe request pace
        items, diag = _do_search(name, extra, label, debug)
        last_diag = diag
        if items:
            break
    else:
        return None, f"both query modes returned 0 items — {last_diag}"

    player_items = [i for i in items if i.get("type") == "player"]
    if not player_items:
        types_seen = sorted(set(i.get("type") for i in items))
        return None, f"{last_diag}, none type=='player' (types seen: {types_seen})"

    name_norm = normalize(name)
    for item in player_items:
        display_norm = normalize(item.get("displayName", ""))
        if display_norm != name_norm:
            continue
        team_field = item.get("team", {}).get("displayName", "") if isinstance(item.get("team"), dict) else ""
        if team_field and team and not (normalize(team) in normalize(team_field) or normalize(team_field) in normalize(team)):
            return None, f"name matched but team mismatch (ours: {team!r}, ESPN's: {team_field!r})"
        espn_id = item.get("id")
        if espn_id:
            return str(espn_id), "matched"

    seen_names = [i.get("displayName") for i in player_items][:5]
    return None, f"{len(player_items)} player-type items, no displayName matched {name!r} (saw: {seen_names})"


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

        espn_id, diagnostic = find_espn_photo(player["name"], player.get("team"), debug=(processed < 3))
        processed += 1
        if espn_id:
            new_photos[player["id"]] = f"https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/{espn_id}.png"
            print(f"  {player['name']}: matched ESPN id {espn_id}")
        else:
            print(f"  {player['name']}: {diagnostic}")

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
