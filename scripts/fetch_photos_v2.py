"""
Production photo-fetch script — replaces the old fetch_photos.py, which was
pointed at ESPN's search/athlete-list endpoints that never worked (confirmed
broken across four separate attempts earlier in this project's history).

This uses the approach actually validated end-to-end in diagnostics:
  our team name -> matched ESPN team ID (location-field matching, ~96% hit
  rate on real data) -> that team's roster (confirmed structure: athletes is
  a flat list of player objects, not grouped) -> our player matched by name
  within it -> real ESPN player ID + inline headshot URL, if ESPN has one.

Confirmed working on a 15-team validation subset: 11/46 players (~24%)
got a real photo. That's expected to be "spotty but solid" — not every
player has an ESPN headshot on file, and not every team name resolves
cleanly — not a sign of a bug.

Only writes to data/players_index.json (photoUrl lives there). Skips any
player who already has a photoUrl, same "don't redo finished work" pattern
as fetch_videos.py. Capped per run and written compactly, same reasoning
as that script too: the job has a real time ceiling, and pretty-printed
JSON nearly re-caused the 1MB size crisis once already.
"""

"""
Production photo-fetch script — replaces the old fetch_photos.py, which was
pointed at ESPN's search/athlete-list endpoints that never worked (confirmed
broken across four separate attempts earlier in this project's history).

This uses the approach actually validated end-to-end in diagnostics:
  team name -> matched ESPN team ID (location-field matching, ~96% hit rate
  on real data) -> that team's roster (confirmed structure: athletes is a
  flat list of player objects, not grouped) -> player matched by name within
  it -> real ESPN player ID + inline headshot URL, if ESPN has one.

Two modes, since NCAA and NBA genuinely need different triggers:

  NCAA (default, MODE = "ncaa"): bulk mode. Our players' `team` field is
  always their NCAA school, so this scans every player needing a photo,
  grouped by team, and writes results straight to players_index.json.
  Confirmed working on a 15-team validation subset: 11/46 players (~24%)
  got a real photo — "spotty but solid" is the expected outcome, not a bug.

  NBA (MODE = "nba"): on-demand mode. Nothing in our data currently
  corresponds to an NBA team — there's no bulk list to iterate. Set
  NBA_TARGET_TEAM to a team name and run it to pull that one team's roster
  with headshots printed out; useful whenever a tracked player eventually
  lands on an NBA roster. Does not write to any file in this mode.

Only writes to data/players_index.json, and only in NCAA mode. Skips any
player who already has a photoUrl, same "don't redo finished work" pattern
as fetch_videos.py. Capped per run and written compactly, same reasoning
as that script too: the job has a real time ceiling, and pretty-printed
JSON nearly re-caused the 1MB size crisis once already.
"""

import json
import re
import time
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}
INDEX_PATH = "data/players_index.json"

MODE = "ncaa"  # "ncaa" (bulk, writes to file) or "nba" (on-demand lookup, prints only)
NBA_TARGET_TEAM = None  # only used in "nba" mode, e.g. "Lakers" or "Boston Celtics"

LEAGUE_CONFIG = {
    "ncaa": {
        "sport": "basketball", "league": "mens-college-basketball",
        "season_pair": (2027, 2026),
    },
    "nba": {
        "sport": "basketball", "league": "nba",
        "season_pair": (2027, 2026),
    },
}

# Conservative cap, matching the same "verified worst case fits safely under
# the job's 30-min ceiling" discipline as fetch_videos.py's MAX_PLAYERS_PER_RUN.
# Each team can need up to 2 roster requests (season fallback) at a 20s
# timeout each — safe budget here, not a guess.
MAX_TEAMS_PER_RUN = 25
SLEEP_BETWEEN_REQUESTS = 1.0


def normalize(name):
    name = name.lower()
    name = re.sub(r"[.,'\-]", " ", name)
    name = re.sub(r"\s+(st|state)\b", " state", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


KNOWN_ALIASES = {
    "connecticut": "uconn", "mississippi": "ole miss", "pittsburgh": "pitt",
    "cal baptist": "california baptist", "louisiana monroe": "ul monroe",
    "miami fl": "miami hurricanes", "seattle": "seattle u",
    "n c state": "nc state",
}


def normalize_player_name(name):
    SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}
    name = re.sub(r"[.,]", "", name).strip().lower()
    words = [w for w in name.split() if w not in SUFFIXES]
    return " ".join(words)


def fetch_espn_teams(sport, league):
    url = f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams"
    resp = requests.get(url, params={"limit": 500}, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    teams = []
    league_data = data["sports"][0]["leagues"][0]
    for entry in league_data.get("teams", []):
        t = entry.get("team", {})
        if t.get("id") and t.get("displayName"):
            teams.append({
                "id": t["id"], "name": t["displayName"],
                "short": t.get("shortDisplayName", ""), "location": t.get("location", ""),
            })
    return teams


def fetch_team_roster(sport, league, team_id, season_pair):
    """Returns (players, error). players is [] on a clean "no data" result,
    None only distinguishes an actual request failure from a 0-player roster."""
    url = f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{team_id}/roster"
    for i, season in enumerate(season_pair):
        is_last = i == len(season_pair) - 1
        try:
            resp = requests.get(url, params={"season": season}, headers=HEADERS, timeout=20)
            if resp.status_code != 200:
                if is_last:
                    return None, f"HTTP {resp.status_code}"
                continue
            data = resp.json()
        except requests.RequestException as e:
            if is_last:
                return None, f"{type(e).__name__}: {e}"
            continue

        players = []
        for p in data.get("athletes", []):
            if not isinstance(p, dict) or not p.get("id"):
                continue
            headshot = (p.get("headshot") or {}).get("href")
            players.append({
                "name": p.get("fullName") or p.get("displayName", ""),
                "espn_id": p.get("id"),
                "headshot_url": headshot,
            })

        if players or is_last:
            return players, None
    return [], None


def build_lookup(espn_teams):
    espn_by_norm = {}
    for t in espn_teams:
        espn_by_norm[normalize(t["name"])] = t
        espn_by_norm[normalize(t["short"])] = t
        if t.get("location"):
            espn_by_norm[normalize(t["location"])] = t
    return espn_by_norm


def run_ncaa_mode():
    cfg = LEAGUE_CONFIG["ncaa"]
    with open(INDEX_PATH) as f:
        our_players = json.load(f)

    print("Fetching ESPN team list (NCAA)...")
    espn_teams = fetch_espn_teams(cfg["sport"], cfg["league"])
    print(f"ESPN teams: {len(espn_teams)}")
    espn_by_norm = build_lookup(espn_teams)

    from collections import defaultdict
    needing_photo_by_team = defaultdict(list)
    for p in our_players:
        if p.get("team") and not p.get("photoUrl"):
            needing_photo_by_team[p["team"]].append(p)

    total_needing = sum(len(v) for v in needing_photo_by_team.values())
    print(f"Players needing a photo: {total_needing}, across {len(needing_photo_by_team)} teams")

    teams_to_process = list(needing_photo_by_team.items())[:MAX_TEAMS_PER_RUN]
    print(f"Processing {len(teams_to_process)} teams this run (capped at {MAX_TEAMS_PER_RUN})\n")

    found_urls = {}
    teams_matched = teams_skipped = teams_failed = 0
    players_found = 0

    for team_name, players_on_team in teams_to_process:
        norm = normalize(team_name)
        espn_team = espn_by_norm.get(norm) or espn_by_norm.get(KNOWN_ALIASES.get(norm, ""))
        if not espn_team:
            teams_skipped += 1
            print(f"  [{team_name}] no ESPN team match — skipped")
            continue

        roster, error = fetch_team_roster(cfg["sport"], cfg["league"], espn_team["id"], cfg["season_pair"])
        if error:
            teams_failed += 1
            print(f"  [{team_name}] roster fetch failed: {error}")
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            continue

        teams_matched += 1
        roster_by_norm = {normalize_player_name(p["name"]): p for p in roster}
        team_found = 0
        for our_p in players_on_team:
            key = normalize_player_name(our_p["name"])
            match = roster_by_norm.get(key)
            if match and match["headshot_url"]:
                found_urls[our_p["id"]] = match["headshot_url"]
                team_found += 1
                players_found += 1
        print(f"  [{team_name}] roster: {len(roster)} players, matched with photo: {team_found}/{len(players_on_team)}")
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    # Re-read fresh right before writing, in case anything changed on disk
    # while this run was in progress — only ever touches photoUrl, so
    # nothing else can be clobbered by this merge.
    with open(INDEX_PATH) as f:
        fresh_players = json.load(f)
    for p in fresh_players:
        if p["id"] in found_urls:
            p["photoUrl"] = found_urls[p["id"]]

    with open(INDEX_PATH, "w") as f:
        json.dump(fresh_players, f, separators=(",", ":"))

    print(f"\nDone. Teams matched: {teams_matched}, skipped (no ESPN match): {teams_skipped}, failed: {teams_failed}")
    print(f"Photos found and saved: {players_found}/{total_needing if len(teams_to_process) == len(needing_photo_by_team) else 'partial run'}")


def run_nba_mode():
    cfg = LEAGUE_CONFIG["nba"]
    print("Fetching ESPN team list (NBA)...")
    espn_teams = fetch_espn_teams(cfg["sport"], cfg["league"])
    print(f"NBA teams: {len(espn_teams)}\n")

    if not NBA_TARGET_TEAM:
        print("NBA_TARGET_TEAM not set — listing all teams (set it and re-run to fetch a roster):")
        for t in espn_teams:
            print(f"  {t['name']!r} (id={t['id']})")
        return

    espn_by_norm = build_lookup(espn_teams)
    norm_target = normalize(NBA_TARGET_TEAM)
    match = next((t for k, t in espn_by_norm.items() if norm_target in k or k == norm_target), None)
    if not match:
        print(f"No team matched {NBA_TARGET_TEAM!r}.")
        return

    print(f"Matched: {match['name']!r} (id={match['id']})\n")
    roster, error = fetch_team_roster(cfg["sport"], cfg["league"], match["id"], cfg["season_pair"])
    if error:
        print(f"Roster fetch failed: {error}")
        return

    print(f"Roster: {len(roster)} players")
    for p in roster:
        print(f"  {p['name']} (id={p['espn_id']}): {p['headshot_url'] or '(no headshot on file)'}")
    print("\n(NBA mode does not write to any file — this is a lookup only.)")


def main():
    if MODE == "nba":
        run_nba_mode()
    else:
        run_ncaa_mode()


if __name__ == "__main__":
    main()
