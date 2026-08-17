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

  NBA (MODE = "nba"): also bulk mode now. Nothing in our own dataset
  currently corresponds to an NBA team, so instead of matching against our
  players, this scans all 30 NBA teams unconditionally and writes a
  standalone reference file (data/nba_players.json) — name, ESPN id, and
  headshot URL for every NBA player found. The point: if a tracked player
  eventually lands on an NBA roster, their photo is already on file instead
  of needing a live lookup at that point. No team name needed, no per-team
  cap — only 30 teams total, comfortably fits in one run.

Only writes to data/players_index.json in NCAA mode, and data/nba_players.json
in NBA mode. Two fields per player in NCAA mode: photoUrl (set only when a
real headshot was found) and photoAttempted (set to true for every player
whose team got processed this run, whether a photo was found or not).
photoAttempted is the actual fix for a real bug: without it, a team that
fails to match ESPN, or whose roster has no name matches, would sit at the
front of the "needs a photo" list forever and get re-attempted every run,
permanently blocking any team further down the list from ever being reached
(confirmed happening for real — the same handful of schools kept coming up
on every run). If team matching improves later (a new alias added, etc.),
manually clearing photoAttempted for the affected players is how to force a
retry.
photoAttempted for the affected players is how to force a retry.
"""

import json
import os
import re
import time
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}
INDEX_PATH = "data/players_index.json"

# Environment variables (set by the workflow's Actions-UI inputs) take
# priority when present; these constants are the fallback for running the
# script locally without setting any env vars, e.g. `python scripts/fetch_photos_v2.py`.
MODE = os.environ.get("FETCH_MODE") or "ncaa"  # "ncaa" (bulk, writes to file) or "nba" (bulk, writes to a separate reference file)

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
    # photoAttempted (not just "no photoUrl yet") is the real fix here — a
    # team that fails to match, or whose roster has no name matches, was
    # never marked as done before, so it sat at the front of this list and
    # got re-attempted every single run, permanently blocking any team
    # further down from ever being reached (confirmed happening for real).
    needing_photo_by_team = defaultdict(list)
    for p in our_players:
        if p.get("team") and not p.get("photoUrl") and not p.get("photoAttempted"):
            needing_photo_by_team[p["team"]].append(p)

    total_needing = sum(len(v) for v in needing_photo_by_team.values())
    print(f"Players needing a photo (never attempted before): {total_needing}, across {len(needing_photo_by_team)} teams")

    teams_to_process = list(needing_photo_by_team.items())[:MAX_TEAMS_PER_RUN]
    print(f"Processing {len(teams_to_process)} teams this run (capped at {MAX_TEAMS_PER_RUN})\n")

    found_urls = {}
    attempted_player_ids = set()  # marked done regardless of outcome, once their team is processed
    teams_matched = teams_skipped = teams_failed = 0
    players_found = 0

    for team_name, players_on_team in teams_to_process:
        for p in players_on_team:
            attempted_player_ids.add(p["id"])

        norm = normalize(team_name)
        espn_team = espn_by_norm.get(norm) or espn_by_norm.get(KNOWN_ALIASES.get(norm, ""))
        if not espn_team:
            teams_skipped += 1
            print(f"  [{team_name}] no ESPN team match — skipped, marked as attempted")
            continue

        roster, error = fetch_team_roster(cfg["sport"], cfg["league"], espn_team["id"], cfg["season_pair"])
        if error:
            teams_failed += 1
            print(f"  [{team_name}] roster fetch failed: {error} — marked as attempted")
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
    # while this run was in progress — only ever touches photoUrl and
    # photoAttempted, so nothing else can be clobbered by this merge.
    with open(INDEX_PATH) as f:
        fresh_players = json.load(f)
    for p in fresh_players:
        if p["id"] in found_urls:
            p["photoUrl"] = found_urls[p["id"]]
        if p["id"] in attempted_player_ids:
            p["photoAttempted"] = True

    with open(INDEX_PATH, "w") as f:
        json.dump(fresh_players, f, separators=(",", ":"))

    print(f"\nDone. Teams matched: {teams_matched}, skipped (no ESPN match): {teams_skipped}, failed: {teams_failed}")
    print(f"Photos found and saved: {players_found}/{total_needing if len(teams_to_process) == len(needing_photo_by_team) else 'partial run'}")
    print(f"Players marked as attempted (won't be retried automatically): {len(attempted_player_ids)}")


NBA_OUTPUT_PATH = "data/nba_players.json"


def run_nba_mode():
    cfg = LEAGUE_CONFIG["nba"]
    print("Fetching ESPN team list (NBA)...")
    espn_teams = fetch_espn_teams(cfg["sport"], cfg["league"])
    print(f"NBA teams: {len(espn_teams)}\n")

    # Bulk scan, not a single-team lookup — only 30 teams total, comfortably
    # fits in one run (worst case ~30 teams x 2 season attempts x 20s
    # timeout = ~20 min, safely under the job's ceiling). Writes a standalone
    # reference file rather than matching against our own dataset, since
    # nothing in our data currently corresponds to an NBA team — this just
    # means a tracked player's photo is already on file the moment they
    # land on an NBA roster, instead of needing a lookup at that point.
    all_players = []
    teams_matched = teams_failed = 0
    for t in espn_teams:
        roster, error = fetch_team_roster(cfg["sport"], cfg["league"], t["id"], cfg["season_pair"])
        if error:
            teams_failed += 1
            print(f"  [{t['name']}] roster fetch failed: {error}")
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            continue
        teams_matched += 1
        with_photo = sum(1 for p in roster if p["headshot_url"])
        print(f"  [{t['name']}] roster: {len(roster)} players, with headshot: {with_photo}")
        for p in roster:
            all_players.append({
                "name": p["name"],
                "espn_id": p["espn_id"],
                "headshot_url": p["headshot_url"],
                "team": t["name"],
            })
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    with open(NBA_OUTPUT_PATH, "w") as f:
        json.dump(all_players, f, separators=(",", ":"))

    total_with_photo = sum(1 for p in all_players if p["headshot_url"])
    print(f"\nDone. Teams: {teams_matched} fetched, {teams_failed} failed.")
    print(f"Players written to {NBA_OUTPUT_PATH}: {len(all_players)} ({total_with_photo} with a headshot)")


def main():
    if MODE == "nba":
        run_nba_mode()
    else:
        run_ncaa_mode()


if __name__ == "__main__":
    main()
