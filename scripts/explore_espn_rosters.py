"""
Comprehensive end-to-end diagnostic — combines everything tested separately
so far (team-name matching, now working well via the location field) with
the two remaining untested steps (does the roster endpoint work, does
matching our players by name within a roster work, do headshot URLs come
back inline) into one script, so all the open questions get answered in a
single run instead of another round of back-and-forth.

Pipeline: our team name -> ESPN team ID -> that team's roster -> match our
player by name within the roster -> real ESPN player ID + inline headshot
URL, if ESPN has one on file for them.

Limited to a subset of teams on this run (not all ~198) to validate the
whole approach works before committing to a full run — same "test small,
then scale" pattern already used throughout this project. Diagnostic only:
does NOT write to any player data file.
"""

import json
import re
import time
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}
TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams"
ROSTER_URL_TMPL = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/{team_id}/roster"

TEAM_LIMIT = 15  # subset for this validation run — raise once confirmed working
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
    """Player-name matching needs the same suffix-tolerance already proven
    in the site's own resolvePlayerByName logic (LJ Figueroa vs L.J. Figueroa,
    Jr./Sr./II/III/IV suffixes) — reusing that same approach here."""
    SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}
    name = re.sub(r"[.,]", "", name).strip().lower()
    words = [w for w in name.split() if w not in SUFFIXES]
    return " ".join(words)


def fetch_espn_teams():
    resp = requests.get(TEAMS_URL, params={"limit": 500}, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    teams = []
    league = data["sports"][0]["leagues"][0]
    for entry in league.get("teams", []):
        t = entry.get("team", {})
        if t.get("id") and t.get("displayName"):
            teams.append({
                "id": t["id"], "name": t["displayName"],
                "short": t.get("shortDisplayName", ""), "location": t.get("location", ""),
            })
    return teams


def fetch_team_roster(team_id, debug=False):
    """Returns [{name, espn_id, headshot_url}] for a team, or [] on failure —
    a failed single team shouldn't stop the whole run."""
    try:
        url = ROSTER_URL_TMPL.format(team_id=team_id)
        resp = requests.get(url, headers=HEADERS, timeout=20)
        if resp.status_code != 200:
            return None, f"HTTP {resp.status_code}"
        data = resp.json()
    except requests.RequestException as e:
        return None, f"{type(e).__name__}: {e}"

    if debug:
        # Every team returned 0 players with no request error last run — that
        # means the request succeeded but the assumed response shape was
        # wrong. Printing the real structure here instead of guessing a third
        # time, same fix already applied to the team-list script's fetch.
        print(f"    [debug] top-level keys: {list(data.keys())}")
        athletes_val = data.get("athletes")
        print(f"    [debug] type of 'athletes': {type(athletes_val).__name__}, "
              f"length: {len(athletes_val) if hasattr(athletes_val, '__len__') else 'n/a'}")
        print(f"    [debug] raw 'athletes' excerpt:\n{json.dumps(athletes_val, indent=2)[:1500]}")

    players = []
    # Roster response shape can vary — try the common "athletes" grouping used
    # by ESPN's site API (often grouped by position group).
    groups = data.get("athletes", [])
    for group in groups:
        items = group.get("items", group) if isinstance(group, dict) else [group]
        for p in items if isinstance(items, list) else []:
            if not isinstance(p, dict) or not p.get("id"):
                continue
            headshot = (p.get("headshot") or {}).get("href")
            players.append({
                "name": p.get("fullName") or p.get("displayName", ""),
                "espn_id": p["id"],
                "headshot_url": headshot,
            })
    return players, None


def main():
    print("=" * 60)
    print("Comprehensive diagnostic: team match -> roster -> player -> headshot")
    print("=" * 60)

    with open("data/players_index.json") as f:
        our_players = json.load(f)

    espn_teams = fetch_espn_teams()
    print(f"ESPN teams fetched: {len(espn_teams)}")

    espn_by_norm = {}
    for t in espn_teams:
        espn_by_norm[normalize(t["name"])] = t
        espn_by_norm[normalize(t["short"])] = t
        if t.get("location"):
            espn_by_norm[normalize(t["location"])] = t

    # Group our players by team, matched teams only, limited subset for this run.
    from collections import defaultdict
    our_by_team = defaultdict(list)
    for p in our_players:
        if p.get("team"):
            our_by_team[p["team"]].append(p)

    matched_teams = []
    for team_name in our_by_team:
        norm = normalize(team_name)
        espn_team = espn_by_norm.get(norm) or espn_by_norm.get(KNOWN_ALIASES.get(norm, ""))
        if espn_team:
            matched_teams.append((team_name, espn_team))
    print(f"Our teams matched to an ESPN team ID: {len(matched_teams)}/{len(our_by_team)}")

    subset = matched_teams[:TEAM_LIMIT]
    print(f"\nRunning roster fetch for {len(subset)} teams (subset, to validate before a full run)...\n")

    total_players_checked = 0
    total_photos_found = 0
    team_failures = []

    for i, (team_name, espn_team) in enumerate(subset):
        roster, error = fetch_team_roster(espn_team["id"], debug=(i == 0))
        if error:
            team_failures.append((team_name, error))
            print(f"  [{team_name}] roster fetch FAILED: {error}")
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            continue

        roster_by_norm = {normalize_player_name(p["name"]): p for p in roster}
        print(f"  [{team_name}] roster fetched: {len(roster)} players")

        for our_p in our_by_team[team_name]:
            total_players_checked += 1
            key = normalize_player_name(our_p["name"])
            match = roster_by_norm.get(key)
            if match and match["headshot_url"]:
                total_photos_found += 1
                print(f"    MATCH: {our_p['name']!r} -> ESPN id {match['espn_id']}, headshot: {match['headshot_url']}")
            elif match:
                print(f"    Found on roster but no headshot on file: {our_p['name']!r}")
            else:
                print(f"    Not found on roster: {our_p['name']!r} (roster has: {[p['name'] for p in roster][:5]}...)")

        time.sleep(SLEEP_BETWEEN_REQUESTS)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Teams attempted: {len(subset)}, failed: {len(team_failures)}")
    print(f"Players checked: {total_players_checked}")
    print(f"Photos found: {total_photos_found}")
    if team_failures:
        print("\nTeam fetch failures:")
        for name, err in team_failures:
            print(f"  {name}: {err}")


if __name__ == "__main__":
    main()
