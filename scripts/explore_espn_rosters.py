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
    a failed single team shouldn't stop the whole run.

    Tries an explicit season parameter now, not just the bare endpoint — a
    real possibility raised directly: with the 2026-27 season still ~3 months
    out, ESPN may simply not have next season's roster populated yet, the
    same "needs an explicit season or defaults to empty" pattern already
    confirmed on a different ESPN endpoint earlier in this investigation.
    Tries the upcoming season (2027, ESPN's typical ending-year convention)
    first, falls back to the just-completed season (2026) if that's empty.
    """
    for season in (2027, 2026):
        try:
            url = ROSTER_URL_TMPL.format(team_id=team_id)
            resp = requests.get(url, params={"season": season}, headers=HEADERS, timeout=20)
            if resp.status_code != 200:
                if season == 2026:  # only report failure after both attempts
                    return None, f"HTTP {resp.status_code} (tried season 2027 and 2026)"
                continue
            data = resp.json()
        except requests.RequestException as e:
            if season == 2026:
                return None, f"{type(e).__name__}: {e} (tried season 2027 and 2026)"
            continue

        if debug:
            # Every team returned 0 players with no request error last run —
            # that means the request succeeded but the assumed response shape
            # was wrong. Printing the real structure here instead of guessing
            # a third time, same fix already applied to the team-list fetch.
            print(f"    [debug] season={season}, top-level keys: {list(data.keys())}")
            athletes_val = data.get("athletes")
            print(f"    [debug] type of 'athletes': {type(athletes_val).__name__}, "
                  f"length: {len(athletes_val) if hasattr(athletes_val, '__len__') else 'n/a'}")
            if athletes_val:
                first = athletes_val[0]
                print(f"    [debug] first athlete's top-level keys: {list(first.keys()) if isinstance(first, dict) else 'not a dict'}")
                print(f"    [debug] first athlete has 'headshot' key: {'headshot' in first if isinstance(first, dict) else 'n/a'}")
                if isinstance(first, dict) and "headshot" in first:
                    print(f"    [debug] headshot value: {first['headshot']}")

        players = []
        # Confirmed via the debug output above: athletes is a flat list of
        # player objects directly — no position-group wrapper with an
        # "items" array, which was the wrong assumption causing every
        # player to silently produce nothing.
        for p in data.get("athletes", []):
            if not isinstance(p, dict) or not p.get("id"):
                continue
            headshot = (p.get("headshot") or {}).get("href")
            players.append({
                "name": p.get("fullName") or p.get("displayName", ""),
                "espn_id": p["id"],
                "headshot_url": headshot,
            })

        if players or season == 2026:  # success, or out of seasons to try — stop here either way
            return players, None
    return [], None


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
