"""
Standalone NBA team + roster + headshot lookup utility.

Unlike the NCAA scripts, this isn't matched against our own dataset — our
players' "team" field is always their NCAA school, never an NBA team, so
there's nothing in our data to cross-reference against yet. This is a
general-purpose, reusable tool instead: given an NBA team name (or nothing,
to list all of them), find its ESPN team ID and full roster with headshot
URLs. Useful whenever a tracked player eventually lands on an NBA roster —
run this, find the team, pull the roster, get their real ESPN photo URL.

NBA is one of the sport slugs ESPN's own API docs explicitly list as
"live-verified" for the headshot CDN pattern — this should be considerably
more reliable than the NCAA version, both because there are only 30 teams
with standardized single-word-or-two names (not 350+ school-name variants),
and because the pattern itself is confirmed working for this sport.

Usage: set TARGET_TEAM below to a team name/city to look up just one team's
roster, or leave it as None to list every team + ID (no roster fetches).
"""

import json
import re
import time
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}
TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams"
ROSTER_URL_TMPL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team_id}/roster"

# Set to a team name (e.g. "Lakers", "Boston Celtics") to fetch just that
# team's roster with headshots. Leave as None to just list all 30 teams + IDs.
TARGET_TEAM = None

SLEEP_BETWEEN_REQUESTS = 1.0


def normalize(name):
    name = name.lower()
    name = re.sub(r"[.,'\-]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def fetch_nba_teams():
    resp = requests.get(TEAMS_URL, params={"limit": 50}, headers=HEADERS, timeout=30)
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
                "abbreviation": t.get("abbreviation", ""),
            })
    return teams


def fetch_roster(team_id, debug=False):
    """Same shape-uncertainty as the NCAA version — verified live before
    trusting it, not assumed. Also tries the current/upcoming season pair,
    same reasoning: rosters may not be finalized this early before a season."""
    for season in (2027, 2026):
        try:
            url = ROSTER_URL_TMPL.format(team_id=team_id)
            resp = requests.get(url, params={"season": season}, headers=HEADERS, timeout=20)
            if resp.status_code != 200:
                if season == 2026:
                    return None, f"HTTP {resp.status_code} (tried season 2027 and 2026)"
                continue
            data = resp.json()
        except requests.RequestException as e:
            if season == 2026:
                return None, f"{type(e).__name__}: {e}"
            continue

        if debug:
            print(f"  [debug] season={season}, top-level keys: {list(data.keys())}")
            athletes_val = data.get("athletes")
            print(f"  [debug] type of 'athletes': {type(athletes_val).__name__}, "
                  f"length: {len(athletes_val) if hasattr(athletes_val, '__len__') else 'n/a'}")

        players = []
        # Confirmed (via the NCAA roster script's debug output): athletes is
        # a flat list of player objects directly, no position-group wrapper —
        # that wrong assumption was silently producing zero players there,
        # fixing the same bug here before it caused the identical problem.
        for p in data.get("athletes", []):
            if not isinstance(p, dict) or not p.get("id"):
                continue
            headshot = (p.get("headshot") or {}).get("href")
            players.append({
                "name": p.get("fullName") or p.get("displayName", ""),
                "espn_id": p["id"],
                "headshot_url": headshot,
            })

        if players or season == 2026:
            return players, None
    return [], None


def main():
    print("=" * 60)
    print("NBA team + roster + headshot lookup")
    print("=" * 60)
    teams = fetch_nba_teams()
    print(f"NBA teams fetched: {len(teams)}\n")

    if not TARGET_TEAM:
        print("All 30 NBA teams (set TARGET_TEAM to fetch a specific roster):")
        for t in teams:
            print(f"  {t['name']!r} (id={t['id']}, abbrev={t['abbreviation']})")
        return

    norm_target = normalize(TARGET_TEAM)
    match = next((t for t in teams if norm_target in normalize(t["name"])
                  or norm_target == normalize(t["location"])
                  or norm_target == normalize(t["short"])), None)
    if not match:
        print(f"No team matched {TARGET_TEAM!r}. Available teams:")
        for t in teams:
            print(f"  {t['name']!r}")
        return

    print(f"Matched: {match['name']!r} (id={match['id']})\n")
    roster, error = fetch_roster(match["id"], debug=True)
    if error:
        print(f"Roster fetch failed: {error}")
        return

    print(f"\nRoster: {len(roster)} players")
    for p in roster:
        photo_status = p["headshot_url"] or "(no headshot on file)"
        print(f"  {p['name']} (id={p['espn_id']}): {photo_status}")


if __name__ == "__main__":
    main()
