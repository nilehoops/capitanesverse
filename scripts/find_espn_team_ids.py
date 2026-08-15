"""
Diagnostic/utility script — fetches ESPN's full mens-college-basketball team
list (name + numeric ESPN team ID for each), then cross-references it against
the team names actually used in our own data/players_index.json.

This is the first building block for the team-roster approach: to fetch a
team's roster (and get real player IDs + inline headshot URLs from it, per
the ESPN API docs' own recommendation), you need that team's numeric ESPN
ID first. This script builds that id mapping and reports it — it does NOT
write to any player data file, and does NOT fetch any rosters yet.

Team name matching is fuzzy on purpose: ESPN's own names (e.g. "Vanderbilt
Commodores") often don't match our dataset's shorter/different names (e.g.
"Vanderbilt") exactly. Anything that can't be confidently matched gets
reported separately for manual resolution, rather than silently guessed at.
"""

import json
import re
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}
TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams"


def normalize(name):
    """Strips common suffixes/punctuation so 'Vanderbilt Commodores' and
    'Vanderbilt' have a fighting chance of matching, without pretending to
    solve every naming difference — deliberately conservative."""
    name = name.lower()
    name = re.sub(r"[.,'\-]", " ", name)  # hyphens too now — "Bethune-Cookman" vs "Bethune Cookman"
    name = re.sub(r"\s+(st|state)\b", " state", name)  # "Ball St." vs "Ball State"
    name = re.sub(r"\s+", " ", name).strip()
    return name


# Common-nickname cases that no generic normalization rule can solve — ESPN
# uses these names/abbreviations rather than the school's plain name, and
# there's no punctuation pattern that bridges "Mississippi" to "Ole Miss".
# Explicit and small on purpose — only added once confirmed as a real gap,
# not guessed preemptively.
KNOWN_ALIASES = {
    "connecticut": "uconn",
    "mississippi": "ole miss",
    "pittsburgh": "pitt",
}


def closest_match(target_norm, espn_names_norm, max_results=3):
    """Simple, dependency-free closest-match: ranks by shared word overlap.
    Not a real fuzzy-match library — just enough to show *why* something
    didn't match, rather than leaving a bare 'unmatched' with no clue."""
    target_words = set(target_norm.split())
    scored = []
    for espn_norm in espn_names_norm:
        espn_words = set(espn_norm.split())
        overlap = len(target_words & espn_words)
        if overlap > 0:
            scored.append((overlap, espn_norm))
    scored.sort(key=lambda x: -x[0])
    return [name for _, name in scored[:max_results]]


def fetch_espn_teams():
    """Fetches ALL D1 teams in one call via a high limit, per the documented
    approach — returns [{id, name}] or raises on failure."""
    params = {"limit": 500}
    resp = requests.get(TEAMS_URL, params=params, headers=HEADERS, timeout=30)
    print(f"HTTP status: {resp.status_code}")
    resp.raise_for_status()
    data = resp.json()

    # ESPN's teams response nests fairly deep: sports[0].leagues[0].teams[].team
    teams = []
    try:
        league = data["sports"][0]["leagues"][0]
        print(f"League: {league.get('name')}, team count in response: {len(league.get('teams', []))}")
        for entry in league.get("teams", []):
            t = entry.get("team", {})
            if t.get("id") and t.get("displayName"):
                teams.append({"id": t["id"], "name": t["displayName"], "short": t.get("shortDisplayName", "")})
    except (KeyError, IndexError) as e:
        print(f"Unexpected response shape: {e}")
        print(f"Raw top-level keys: {list(data.keys())}")
    return teams


def load_our_team_names():
    """Reads real team names directly from our own live data, so the match
    report reflects what's actually in use, not a guessed/hardcoded list."""
    with open("data/players_index.json") as f:
        players = json.load(f)
    teams = sorted(set(p["team"] for p in players if p.get("team")))
    return teams


def main():
    print("=" * 60)
    print("Fetching ESPN's full D1 mens-college-basketball team list")
    print("=" * 60)
    try:
        espn_teams = fetch_espn_teams()
    except requests.RequestException as e:
        print(f"REQUEST FAILED: {type(e).__name__}: {e}")
        return

    print(f"\nTotal ESPN teams parsed: {len(espn_teams)}")
    if not espn_teams:
        print("No teams parsed — stopping here, nothing to match against.")
        return

    espn_by_norm = {}
    for t in espn_teams:
        espn_by_norm[normalize(t["name"])] = t
        espn_by_norm[normalize(t["short"])] = t

    our_teams = load_our_team_names()
    print(f"Team names in our own dataset: {len(our_teams)}")

    matched = {}
    alias_matched = {}
    unmatched = []
    for team in our_teams:
        norm = normalize(team)
        if norm in espn_by_norm:
            matched[team] = espn_by_norm[norm]["id"]
        elif norm in KNOWN_ALIASES and KNOWN_ALIASES[norm] in espn_by_norm:
            alias_matched[team] = espn_by_norm[KNOWN_ALIASES[norm]]["id"]
        else:
            unmatched.append(team)

    total_matched = len(matched) + len(alias_matched)
    print(f"\nMatched directly: {len(matched)}/{len(our_teams)}")
    print(f"Matched via known alias (UConn/Ole Miss/Pitt-style nicknames): {len(alias_matched)}")
    print(f"Total matched: {total_matched}/{len(our_teams)}")
    print(f"Still unmatched: {len(unmatched)}")

    print("\nFirst 10 direct matches:")
    for team, espn_id in list(matched.items())[:10]:
        print(f"  {team!r} -> ESPN team id {espn_id}")
    if alias_matched:
        print("\nAlias matches:")
        for team, espn_id in alias_matched.items():
            print(f"  {team!r} -> ESPN team id {espn_id} (via known alias)")

    if unmatched:
        espn_names_norm = list(espn_by_norm.keys())
        print("\nStill unmatched — closest ESPN name(s) shown for each, to diagnose why:")
        for team in unmatched:
            norm = normalize(team)
            close = closest_match(norm, espn_names_norm)
            print(f"  {team!r} -> closest ESPN names: {close if close else '(no word overlap at all)'}")

    # Write the mapping out as a plain JSON file for inspection — this is a
    # diagnostic artifact for review, not something committed to the repo.
    all_matched = {**matched, **alias_matched}
    with open("team_id_mapping_report.json", "w") as f:
        json.dump({"matched": all_matched, "unmatched": unmatched}, f, indent=2)
    print("\nFull mapping written to team_id_mapping_report.json (workflow artifact, not committed).")


if __name__ == "__main__":
    main()
