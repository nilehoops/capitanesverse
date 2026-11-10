"""
Capitanes Lineup Data Fetch — with player cross-reference
============================
Fetches duo, trio, and 5-man lineup combination data for the
Ciudad de Mexico Capitanes from NBA Stats for the full 2025-26 season,
and writes it to data/lineup_data.json.

Run this locally (not via GitHub Actions — stats.nba.com blocks cloud IPs).
Commit the output data/lineup_data.json to the repo to update the site.

Usage:
    python fetch_lineup_data.py

No API key or external packages needed. Run from the repo root.
"""

import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://www.nba.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nba.com",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}

CAPITANES_ABBREV = "MXC"

# Accept season as a CLI argument — defaults to current season
import sys as _sys
SEASON = next((a for a in _sys.argv[1:] if re.match(r'^\d{4}-\d{2}$', a)), "2026-27")
print(f"Season: {SEASON}")

def probe_season(season, season_type="Regular Season"):
    """Check if a season string returns data from leaguedashlineups."""
    url = (
        "https://stats.nba.com/stats/leaguedashlineups"
        f"?LeagueID=20&Season={season}&SeasonType={season_type.replace(' ', '+')}"
        "&MeasureType=Advanced&PerMode=PerMinute"
        "&GroupQuantity=2&PaceAdjust=N&Rank=N&Outcome=&Location=&Month=0"
        "&SeasonSegment=&DateFrom=&DateTo=&OpponentTeamID=0"
        "&VsConference=&VsDivision=&GameSegment=&Period=0"
        "&ShotClockRange=&LastNGames=0&MinutesFilter=0"
    )
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        count = len(data.get("resultSets", [{}])[0].get("rowSet", []))
        return count
    except Exception as e:
        return 0

LINEUP_COLUMNS = [
    "GROUP_SET", "GROUP_ID", "GROUP_NAME", "TEAM_ID", "TEAM_ABBREVIATION",
    "GP", "W", "L", "W_PCT", "MIN", "E_OFF_RATING", "OFF_RATING",
    "E_DEF_RATING", "DEF_RATING", "E_NET_RATING", "NET_RATING",
    "AST_PCT", "AST_TO", "AST_RATIO", "OREB_PCT", "DREB_PCT", "REB_PCT",
    "TM_TOV_PCT", "EFG_PCT", "TS_PCT", "E_PACE", "PACE", "PACE_PER40",
    "POSS", "PIE",
]


SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'iv', 'v'}

def build_player_xref(index_path='data/players_index.json'):
    """Build a lookup from abbreviated lineup names (e.g. 'A. Garcia') to
    full player data from players_index.json. Embedded into lineup_data.json
    so the site page never needs to do fuzzy matching client-side."""
    try:
        with open(index_path) as f:
            players = json.load(f)
    except FileNotFoundError:
        print("  Warning: players_index.json not found — skipping cross-reference")
        return {}

    # Key: "F. LastName" (suffix-stripped) -> best match player dict
    by_key = {}
    for p in players:
        parts = p['name'].strip().split()
        if len(parts) < 2:
            continue
        initial = parts[0][0].upper()
        meaningful = [w for w in parts[1:] if w.lower().rstrip('.') not in SUFFIXES]
        last = meaningful[-1] if meaningful else parts[-1]
        key = f"{initial}. {last}"
        # prefer players with photos; don't overwrite if already set
        if key not in by_key or (p.get('photoUrl') and not by_key[key].get('photoUrl')):
            by_key[key] = p

    return by_key


def xref_name(abbrev_name, by_key):
    """Match an abbreviated name like 'W. Taylor IV' to a player dict."""
    parts = abbrev_name.split()
    if len(parts) < 2:
        return None
    initial = parts[0].rstrip('.')
    meaningful = [w for w in parts[1:] if w.lower().rstrip('.') not in SUFFIXES]
    last = meaningful[-1] if meaningful else parts[-1]
    return by_key.get(f"{initial}. {last}")


ACTIVE_SEASON_TYPE = "Regular+Season"  # updated by discover_teams if needed

def discover_teams():
    """Return {abbrev: team_id} for all G League teams this season.
    Falls back to Showcase Cup if Regular Season hasn't started yet."""
    global ACTIVE_SEASON_TYPE
    print("Discovering G League teams...")

    for season_type in ("Regular+Season", "Showcase"):
        url = (
            "https://stats.nba.com/stats/leaguedashlineups"
            f"?LeagueID=20&Season={SEASON}&SeasonType={season_type}"
            "&MeasureType=Advanced&PerMode=PerMinute"
            "&GroupQuantity=2&PaceAdjust=N&Rank=N&Outcome=&Location=&Month=0"
            "&SeasonSegment=&DateFrom=&DateTo=&OpponentTeamID=0"
            "&VsConference=&VsDivision=&GameSegment=&Period=0"
            "&ShotClockRange=&LastNGames=0&GameScope=&PlayerExperience="
            "&PlayerPosition=&StarterBench=&TwoWay=0&MinutesFilter=0"
        )
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        rs = data["resultSets"][0]
        hdrs = rs["headers"]
        rows = [dict(zip(hdrs, row)) for row in rs["rowSet"]]

        seen = {}
        for row in rows:
            tid = row["TEAM_ID"]
            abbrev = row.get("TEAM_ABBREVIATION", "")
            if tid not in seen:
                seen[abbrev] = tid

        if seen:
            ACTIVE_SEASON_TYPE = season_type
            label = "Showcase Cup" if season_type == "Showcase" else "Regular Season"
            print(f"  Found {len(seen)} teams ({label}): {', '.join(sorted(seen.keys()))}")
            break
        time.sleep(1)
    else:
        seen = {}
        print(f"  Found 0 teams:")

    cap_abbrev = next((a for a in seen if a in ("MXC", "CAP", "MEX")), None)
    if not cap_abbrev:
        print("  ERROR: Could not find Capitanes (MXC) — season may not have started yet.")
        print("\n  Probing available seasons...")
        for s in ["2026-27", "2025-26", "2024-25"]:
            count_reg = probe_season(s)
            count_show = probe_season(s, season_type="Showcase")
            parts = []
            if count_reg:  parts.append(f"Regular: {count_reg} rows")
            if count_show: parts.append(f"Showcase: {count_show} rows")
            status = ", ".join(parts) if parts else "no data"
            print(f"    {s}: {status}")
        print(f"\n  Run with a valid season, e.g.: python fetch_lineup_data.py 2025-26")
        return None, None
    print(f"  Capitanes: {cap_abbrev} (ID {seen[cap_abbrev]})")
    return seen, seen[cap_abbrev]


def _lineup_url(team_id, group_quantity, measure_type, min_minutes=0):
    return (
        "https://stats.nba.com/stats/leaguedashlineups"
        f"?LeagueID=20&Season={SEASON}&SeasonType={ACTIVE_SEASON_TYPE}"
        f"&MeasureType={measure_type}&PerMode=PerMinute"
        f"&GroupQuantity={group_quantity}"
        f"&TeamID={team_id}"
        "&PaceAdjust=N&Rank=N&Outcome=&Location=&Month=0"
        "&SeasonSegment=&DateFrom=&DateTo=&OpponentTeamID=0"
        "&VsConference=&VsDivision=&GameSegment=&Period=0"
        "&ShotClockRange=&LastNGames=0&GameScope=&PlayerExperience="
        f"&PlayerPosition=&StarterBench=&TwoWay=0&MinutesFilter={min_minutes}"
    )


def _fetch_lineup_measure(team_id, group_quantity, measure_type, min_minutes=0):
    url = _lineup_url(team_id, group_quantity, measure_type, min_minutes)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    rs = data.get("resultSets", [{}])[0]
    hdrs = rs.get("headers", [])
    return [dict(zip(hdrs, row)) for row in rs.get("rowSet", [])]


def fetch_team_lineups(team_id, group_quantity, min_minutes=0):
    """Fetch lineup combinations for a single team, merging Advanced +
    Opponent measures so opponent stats are available alongside team stats."""
    # Advanced — primary measure with all team-side ratings
    adv_rows = _fetch_lineup_measure(team_id, group_quantity, "Advanced", min_minutes)

    # Add MIN_ACTUAL from SUM_TIME_PLAYED — MIN in PerMinute mode is a
    # normalized rate value, not actual minutes played.
    for r in adv_rows:
        stp = r.get("SUM_TIME_PLAYED")
        r["MIN_ACTUAL"] = round(stp / 60, 1) if stp else 0.0

    # Note: MeasureType=Opponent is not supported by leaguedashlineups (returns HTTP 500).
    # Opponent stats at team level are available from leaguedashteamstats with
    # MeasureType=Four+Factors, which is already fetched in fetch_team_stats().
    return adv_rows


def fetch_lineups_all_teams(team_ids, group_quantity, min_minutes=0):
    """Fetch lineup combinations for every team individually to bypass the
    2,000-row hard cap. Each team returns at most ~300 rows so no cap is hit."""
    label = {2: "duos", 3: "trios", 4: "quads", 5: "5-man lineups"}[group_quantity]
    print(f"  Fetching {label} for all {len(team_ids)} teams...", flush=True)
    combined = []
    for i, (abbrev, team_id) in enumerate(team_ids.items(), 1):
        try:
            rows = fetch_team_lineups(team_id, group_quantity, min_minutes)
            combined.extend(rows)
            print(f"    [{i:2}/{len(team_ids)}] {abbrev}: {len(rows)}")
            time.sleep(0.8)  # polite pause between requests
        except Exception as e:
            print(f"    [{i:2}/{len(team_ids)}] {abbrev}: ERROR — {e}")
    print(f"  Total {label}: {len(combined)} combinations")
    return combined


def split_by_team(rows, focus_abbrev):
    """Split a league-wide result into focus-team rows and all-other rows."""
    focus = [r for r in rows if r.get("TEAM_ABBREVIATION") == focus_abbrev]
    league = rows  # keep all teams for context/ranking
    return focus, league


def build_output(duos_all, trios_all, fiveman_all, quads_all=None, player_xref=None,
                 focus_abbrev="MXC", focus_team_id=None):
    def net_rtg(r):
        return r.get("NET_RATING") or r.get("E_NET_RATING") or -999

    duos_focus, duos_league = split_by_team(duos_all, focus_abbrev)
    trios_focus, trios_league = split_by_team(trios_all, focus_abbrev)
    fiveman_focus, fiveman_league = split_by_team(fiveman_all, focus_abbrev)
    quads_focus, quads_league = split_by_team(quads_all or [], focus_abbrev)

    return {
        "meta": {
            "season": SEASON,
            "focusTeam": focus_abbrev,
            "focusTeamId": focus_team_id,
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "playerXref": player_xref or {},
        # MXC-only combinations (for the best/worst display)
        "duos":    sorted(duos_focus,   key=net_rtg, reverse=True),
        "trios":   sorted(trios_focus,  key=net_rtg, reverse=True),
        "quads":   sorted(quads_focus,  key=net_rtg, reverse=True),
        "fiveman": sorted(fiveman_focus, key=net_rtg, reverse=True),
        # Full league (all teams) for league-wide context and rankings
        "league": {
            "duos":    sorted(duos_league,   key=net_rtg, reverse=True),
            "trios":   sorted(trios_league,  key=net_rtg, reverse=True),
            "quads":   sorted(quads_league,  key=net_rtg, reverse=True),
            "fiveman": sorted(fiveman_league, key=net_rtg, reverse=True),
        },
    }


def main():
    print(f"Fetching full G League lineup data for {SEASON}...\n")

    team_ids, focus_team_id = discover_teams()
    if not team_ids:
        return
    print()

    lineup_path = os.path.join("data", f"lineup_data_{SEASON}.json")
    if os.path.exists(lineup_path):
        print(f"\nLineup data already exists ({os.path.getsize(lineup_path)//1024} KB) — skipping re-fetch.")
        print(f"Delete data/lineup_data_{SEASON}.json manually if you need to re-pull (e.g. new season).")
        with open(lineup_path) as f:
            existing = json.load(f)
        output = existing
    else:
        duos_all = fetch_lineups_all_teams(team_ids, group_quantity=2)
        time.sleep(2)
        trios_all = fetch_lineups_all_teams(team_ids, group_quantity=3)
        time.sleep(2)
        quads_all = fetch_lineups_all_teams(team_ids, group_quantity=4)
        time.sleep(2)
        fiveman_all = fetch_lineups_all_teams(team_ids, group_quantity=5)

        if not duos_all and not trios_all and not fiveman_all:
            print("\nNo data fetched — check your connection and retry.")
            return

    if 'duos_all' in dir():
        # Freshly fetched — build cross-reference and write output
        print("\nBuilding player cross-reference for MXC roster...")
        by_key = build_player_xref()

        mxc_names = set()
        for arr in [duos_all, trios_all, quads_all, fiveman_all]:
            for combo in arr:
                if combo.get("TEAM_ABBREVIATION") == CAPITANES_ABBREV:
                    for name in combo.get('GROUP_NAME', '').split(' - '):
                        mxc_names.add(name.strip())

        player_xref = {}
        matched = 0
        for abbrev in sorted(mxc_names):
            p = xref_name(abbrev, by_key)
            if p:
                player_xref[abbrev] = {
                    'id': p.get('id'),
                    'name': p.get('name'),
                    'photoUrl': p.get('photoUrl'),
                    'position': p.get('position'),
                    'overallRank': p.get('overallRank'),
                }
                matched += 1
            else:
                player_xref[abbrev] = None

        print(f"  Matched {matched} of {len(mxc_names)} MXC players")
        unmatched = [n for n, v in player_xref.items() if v is None]
        if unmatched:
            print(f"  Unmatched (not in players_index.json): {unmatched}")

        focus_abbrev = next(a for a, tid in team_ids.items() if tid == focus_team_id)
        output = build_output(duos_all, trios_all, fiveman_all, quads_all,
                              player_xref, focus_abbrev, focus_team_id)

    os.makedirs("data", exist_ok=True)

    # File 1: MXC-only — small, loaded by the page on every visit
    mxc_output = {
        "meta": output["meta"],
        "playerXref": output["playerXref"],
        "duos":    output["duos"],
        "trios":   output["trios"],
        "quads":   output["quads"],
        "fiveman": output["fiveman"],
    }
    mxc_path = os.path.join("data", f"lineup_data_{SEASON}.json")
    with open(mxc_path, "w") as f:
        json.dump(mxc_output, f, separators=(",", ":"))

    if "league" in output:
        league_path = os.path.join("data", f"lineup_league_{SEASON}.json")
        with open(league_path, "w") as f:
            json.dump({"meta": output["meta"], **output["league"]}, f, separators=(",", ":"))
        league_kb = os.path.getsize(league_path) // 1024
        print(f"  {league_path} ({league_kb} KB) — full league, loaded on demand")
        print(f"  League: {len(output['league']['duos'])} duos, {len(output['league']['trios'])} trios")

    mxc_kb = os.path.getsize(mxc_path) // 1024
    print(f"\nWritten:")
    print(f"  {mxc_path} ({mxc_kb} KB) — MXC only, page loads this on startup")
    print(f"  MXC: {len(output['duos'])} duos, {len(output['trios'])} trios, {len(output['quads'])} quads, {len(output['fiveman'])} 5-man")
    print(f"  Fetched at: {output['meta']['fetched_at']}")
    # Team stats — full season + filter slices for the league ranks section
    print("\nFetching team stats...")
    slices = [
        ("all",        {}),
        ("home",       {"Location": "Home"}),
        ("away",       {"Location": "Road"}),
        ("last5",      {"LastNGames": 5}),
        ("last10",     {"LastNGames": 10}),
        ("first_half", {"GameSegment": "First Half"}),
        ("second_half",{"GameSegment": "Second Half"}),
        ("q1",         {"Period": 1}),
        ("q2",         {"Period": 2}),
        ("q3",         {"Period": 3}),
        ("q4",         {"Period": 4}),
    ]
    team_stats_output = {}
    for label, filters in slices:
        print(f"\n  Slice: {label}")
        result = fetch_team_stats(filters)
        if result:
            team_stats_output[label] = result["teams"]
        time.sleep(2)

    ts_path = os.path.join("data", f"team_stats_{SEASON}.json")
    with open(ts_path, "w") as f:
        json.dump({
            "meta": {"season": SEASON, "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
            "slices": team_stats_output,
        }, f, separators=(",", ":"))
    ts_kb = os.path.getsize(ts_path) // 1024
    print(f"\n  Team stats written to {ts_path} ({ts_kb} KB)")
    # True on/off stats from play-by-play tracking
    print("\nFetching MXC player on/off stats...")
    try:
        on_off_data = fetch_player_on_off(focus_team_id)
        print(f"  {len(on_off_data)} players with on/off data")
    except Exception as e:
        print(f"  ERROR: {e}")
        on_off_data = []

    # Player stats — replaces the manual Excel workflow
    print("\nFetching MXC player stats...")
    player_stats = fetch_player_stats(focus_team_id)
    if player_stats:
        mex_data = build_mex_data(player_stats, output, on_off_data)
        mex_path = os.path.join("data", f"mex_data_{SEASON}.json")
        with open(mex_path, "w") as f:
            json.dump(mex_data, f, separators=(",", ":"))
        mex_kb = os.path.getsize(mex_path) // 1024
        print(f"  mex_data_{SEASON}.json written ({mex_kb} KB) — {len(player_stats)} players")
    else:
        print(f"  Warning: could not fetch player stats — mex_data_{SEASON}.json not updated")

    # Game log — needed for date intervals and opponent strength slices
    print("\nFetching MXC game log...")
    game_log = fetch_game_log(focus_team_id)
    if game_log:
        print(f"  {len(game_log)} games found")

        # Opponent strength: elite (top ⅓ net rtg), middle, weak (bottom ⅓)
        abbrev_to_id = build_abbrev_to_team_id(team_ids)
        opp_slices = build_opponent_strength_slices(game_log, team_stats_output.get("all", []), abbrev_to_id)
        print(f"  Opponent strength slices: " +
              ", ".join(f"{k}={len(v)} games" for k, v in opp_slices.items()))

        # Fetch team stats for each opponent strength bucket.
        # Uses OpponentTeamID so every team's stats reflect their actual
        # performance against that specific opponent — true like-for-like comparison.
        print(f"\nFetching opponent strength slices (OpponentTeamID-based)...")
        for label, opp_id_list in opp_slices.items():
            if not opp_id_list:
                print(f"  {label}: no opponents — skipping")
                continue
            # Collect all teams' rows across all opponent fetches,
            # then aggregate by summing GP-weighted stats
            all_rows_for_slice = []
            for opp_id in opp_id_list:
                result = fetch_team_stats({"OpponentTeamID": opp_id})
                if result:
                    all_rows_for_slice.extend(result["teams"])
                time.sleep(0.8)
            # Aggregate: sum GP, then weighted-average the rate stats
            if all_rows_for_slice:
                team_stats_output[label] = aggregate_opp_rows(all_rows_for_slice)
            print(f"  {label}: done ({len(opp_id_list)} opponents)")

        # Rewrite team_stats.json with expanded slices
        with open(ts_path, "w") as f:
            json.dump({
                "meta": {"season": SEASON, "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
                "slices": team_stats_output,
            }, f, separators=(",", ":"))
        ts_kb = os.path.getsize(ts_path) // 1024
        print(f"  team_stats.json updated ({ts_kb} KB)")
    else:
        print("  Warning: could not fetch game log — interval/opponent slices skipped")

    print(f"\nCommit data/lineup_data_{SEASON}.json, data/team_stats_{SEASON}.json and data/mex_data_{SEASON}.json to update the site.")


def fetch_team_stats(filters=None):
    """Fetch league-wide team stats for all G League teams.
    filters: dict with optional keys: Location (Home/Road), LastNGames (int),
    Period (1-4), DateFrom (YYYY-MM-DD), DateTo (YYYY-MM-DD).
    Writes data/team_stats.json."""
    filters = filters or {}
    base_params = (
        f"?LeagueID=20&Season={SEASON}&SeasonType={ACTIVE_SEASON_TYPE}"
        "&PerMode=PerGame&PaceAdjust=N&PlusMinus=N&Rank=N"
        "&Outcome=&Location={loc}&Month=0&SeasonSegment="
        "&DateFrom=&DateTo=&OpponentTeamID={opp_team_id}"
        "&VsConference=&VsDivision=&GameSegment={game_segment}&Period={period}"
        "&ShotClockRange=&LastNGames={last_n}&GameScope=&PlayerExperience="
        "&PlayerPosition=&StarterBench=&TwoWay=0"
    ).format(
        loc=filters.get('Location', ''),
        opp_team_id=filters.get('OpponentTeamID', 0),
        game_segment=filters.get('GameSegment', '').replace(' ', '+'),
        period=filters.get('Period', 0),
        last_n=filters.get('LastNGames', 0),
    )

    all_data = {}
    for measure in ('Base', 'Advanced', 'Four Factors'):
        url = f"https://stats.nba.com/stats/leaguedashteamstats{base_params}&MeasureType={measure.replace(' ', '+')}"
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            rs = data["resultSets"][0]
            hdrs = rs["headers"]
            rows = [dict(zip(hdrs, row)) for row in rs["rowSet"]]
            for row in rows:
                tid = row.get("TEAM_ID")
                if tid not in all_data:
                    all_data[tid] = {"TEAM_ID": tid, "TEAM_NAME": row.get("TEAM_NAME"), "TEAM_ABBREVIATION": row.get("TEAM_ABBREVIATION")}
                all_data[tid].update(row)
            print(f"  {measure}: {len(rows)} teams")
            time.sleep(1)
        except Exception as e:
            print(f"  {measure}: ERROR — {e}")

    teams = list(all_data.values())

    # Compute ranks for key stats
    def rank_col(key, lower_is_better=False):
        vals = [(t.get(key), i) for i, t in enumerate(teams) if t.get(key) is not None]
        vals.sort(key=lambda x: x[0], reverse=not lower_is_better)
        for rank, (_, i) in enumerate(vals, 1):
            teams[i][f"{key}_RANK"] = rank

    for col in ["OFF_RATING", "DEF_RATING", "NET_RATING", "EFG_PCT", "TM_TOV_PCT", "OREB_PCT", "DREB_PCT", "OPP_EFG_PCT", "OPP_TOV_PCT"]:
        lower = col in ("DEF_RATING", "TM_TOV_PCT", "OPP_EFG_PCT")
        rank_col(col, lower_is_better=lower)

    return {"teams": teams}


def fetch_player_stats(team_id):
    """Fetch per-player stats for a single team across Base + Advanced measures.
    Returns a list of merged player dicts with all available fields."""
    base_params = (
        f"?LeagueID=20&Season={SEASON}&SeasonType={ACTIVE_SEASON_TYPE}"
        f"&TeamID={team_id}&PerMode=Totals"
        "&PaceAdjust=N&PlusMinus=N&Rank=N"
        "&Outcome=&Location=&Month=0&SeasonSegment="
        "&DateFrom=&DateTo=&OpponentTeamID=0"
        "&VsConference=&VsDivision=&GameSegment=&Period=0"
        "&ShotClockRange=&LastNGames=0&GameScope=&PlayerExperience="
        "&PlayerPosition=&StarterBench=&TwoWay=0"
    )
    all_data = {}
    for measure in ("Base", "Advanced"):
        url = f"https://stats.nba.com/stats/leaguedashplayerstats{base_params}&MeasureType={measure}"
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            rs = data["resultSets"][0]
            hdrs = rs["headers"]
            rows = [dict(zip(hdrs, row)) for row in rs["rowSet"]]
            for row in rows:
                pid = row.get("PLAYER_ID")
                if pid not in all_data:
                    all_data[pid] = {
                        "PLAYER_ID": pid,
                        "Player": row.get("PLAYER_NAME"),
                        "TEAM_ABBREVIATION": row.get("TEAM_ABBREVIATION"),
                    }
                all_data[pid].update(row)
            print(f"  {measure}: {len(rows)} players")
            time.sleep(1)
        except Exception as e:
            print(f"  {measure}: ERROR — {e}")

    players = list(all_data.values())

    # Compute derived columns that the Excel template used to calculate
    for p in players:
        fgm  = p.get("FGM")  or 0
        fga  = p.get("FGA")  or 0
        fg3m = p.get("FG3M") or 0
        fg3a = p.get("FG3A") or 0
        ftm  = p.get("FTM")  or 0
        fta  = p.get("FTA")  or 0
        stl  = p.get("STL")  or 0
        blk  = p.get("BLK")  or 0
        ast  = p.get("AST")  or 0
        tov  = p.get("TOV")  or 0
        mins = p.get("MIN")  or 0

        p["2PTM"]  = fgm - fg3m
        p["2PA"]   = fga - fg3a
        p["2PT%"]  = (fgm - fg3m) / (fga - fg3a) if (fga - fg3a) > 0 else None
        p["3PAr"]  = fg3a / fga if fga > 0 else None
        p["FTR"]   = fta / fga  if fga > 0 else None
        p["AST/TO"]      = ast / tov if tov > 0 else None
        p["Stl+Blk"]     = stl + blk
        p["Stl+Blk/min"] = (stl + blk) / mins if mins > 0 else None

        # Rename API fields to match template column names
        p["3PTM"] = fg3m
        p["3PA"]  = fg3a
        p["3P%"]  = p.get("FG3_PCT")
        p["FT%"]  = p.get("FT_PCT")
        p["eFG%"] = p.get("EFG_PCT")
        p["TS%"]  = p.get("TS_PCT")
        p["ORB%"] = p.get("OREB_PCT")
        p["DRB%"] = p.get("DREB_PCT")
        p["TRB%"] = p.get("REB_PCT")
        p["AST%"] = p.get("AST_PCT")
        p["TOV%"] = p.get("TM_TOV_PCT") or p.get("TOV_PCT")
        p["STL%"] = p.get("STL_PCT")
        p["BLK%"] = p.get("BLK_PCT")
        p["USG%"] = p.get("USG_PCT")
        p["ORtg"] = p.get("OFF_RATING")
        p["DRtg"] = p.get("DEF_RATING")
        p["PER"]  = p.get("PLAYER_EFFICIENCY_RATING") or p.get("PIE")
        p["ORB"]  = p.get("OREB")
        p["DRB"]  = p.get("DREB")
        p["REB"]  = p.get("REB")

    return players


def build_mex_data(players, lineup_output, on_off_data=None):
    """Build the full mex_data.json structure from fetched player stats
    and the already-computed lineup combinations."""
    mxc_lineups = lineup_output.get("duos", [])

    # Build abbreviated name -> player for WOWY cross-reference
    SUFFIXES = {'jr','sr','ii','iii','iv','v'}
    p_by_key = {}
    for p in players:
        name = p.get("Player") or ""
        parts = name.split()
        if len(parts) >= 2:
            last = [w for w in parts[1:] if w.lower() not in SUFFIXES]
            if last:
                key = f"{parts[0][0]}. {last[-1]}"
                p_by_key[key] = name

    # Normalise lineup names (strip leading dots that some API responses add)
    def get_players_in_lineup(group_name):
        return [n.strip().lstrip('.') for n in group_name.split(' - ')]

    all_abbrevs = set()
    for combo in mxc_lineups:
        for n in get_players_in_lineup(combo.get("GROUP_NAME", "")):
            if n:
                all_abbrevs.add(n)

    def wavg(combos, key):
        total = sum(c.get("POSS") or c.get("MIN_ACTUAL") or 0 for c in combos)
        if not total:
            return None
        return sum((c.get(key) or 0) * (c.get("POSS") or c.get("MIN_ACTUAL") or 0) for c in combos) / total

    wowy = []
    for abbrev in sorted(all_abbrevs):
        with_p    = [c for c in mxc_lineups if abbrev in get_players_in_lineup(c.get("GROUP_NAME", ""))]
        without_p = [c for c in mxc_lineups if abbrev not in get_players_in_lineup(c.get("GROUP_NAME", ""))]
        full_name = p_by_key.get(abbrev, abbrev)
        wowy.append({
            "player": full_name,
            "abbrev": abbrev,
            "with": {
                "POSS":    round(sum(c.get("POSS") or 0 for c in with_p), 1),
                "NetRtg":  wavg(with_p, "NET_RATING"),
                "OffRtg":  wavg(with_p, "OFF_RATING"),
                "DefRtg":  wavg(with_p, "DEF_RATING"),
                "combos":  len(with_p),
            },
            "without": {
                "POSS":    round(sum(c.get("POSS") or 0 for c in without_p), 1),
                "NetRtg":  wavg(without_p, "NET_RATING"),
                "OffRtg":  wavg(without_p, "OFF_RATING"),
                "DefRtg":  wavg(without_p, "DEF_RATING"),
                "combos":  len(without_p),
            },
        })

    # Build nameLookup for player.html cross-reference
    name_lookup = {}
    for p in players:
        name = p.get("Player") or ""
        name_lookup[name.lower()] = name
        parts = name.split()
        if len(parts) >= 2:
            SUFFIXES_SET = {'jr','sr','ii','iii','iv','v'}
            last = [w for w in parts[1:] if w.lower() not in SUFFIXES_SET]
            if last:
                name_lookup[f"{parts[0][0].lower()}. {last[-1].lower()}"] = name

    # Normalise lineup datapoints to the same field names the site uses
    lineups_normalised = []
    for c in mxc_lineups:
        lineups_normalised.append({
            "lineup":   c.get("GROUP_NAME", ""),
            "MIN":      c.get("MIN_ACTUAL") or c.get("MIN") or 0,
            "POSS":     c.get("POSS") or 0,
            "NetRtg":   c.get("NET_RATING"),
            "OffRtg":   c.get("OFF_RATING"),
            "DefRtg":   c.get("DEF_RATING"),
            "eFG%":     (c.get("EFG_PCT") or 0) * 100 if c.get("EFG_PCT") is not None else None,
            "TOV%":     (c.get("TM_TOV_PCT") or 0) * 100 if c.get("TM_TOV_PCT") is not None else None,
            "OREB%":    (c.get("OREB_PCT") or 0) * 100 if c.get("OREB_PCT") is not None else None,
            "DREB%":    (c.get("DREB_PCT") or 0) * 100 if c.get("DREB_PCT") is not None else None,
            "AST%":     (c.get("AST_PCT") or 0) * 100 if c.get("AST_PCT") is not None else None,
            "PACE":     c.get("PACE"),
            "TS%":      (c.get("TS_PCT") or 0) * 100 if c.get("TS_PCT") is not None else None,
            "Opp eFG%": (c.get("OPP_EFG_PCT") or 0) * 100 if c.get("OPP_EFG_PCT") is not None else None,
            "Opp 2PT%": (c.get("OPP_FG2_PCT") or 0) * 100 if c.get("OPP_FG2_PCT") is not None else None,
            "Opp 3P%":  (c.get("OPP_FG3_PCT") or 0) * 100 if c.get("OPP_FG3_PCT") is not None else None,
            "Opp FT%":  (c.get("OPP_FT_PCT") or 0) * 100 if c.get("OPP_FT_PCT") is not None else None,
            "Opp TOV%": (c.get("OPP_TOV_PCT") or 0) * 100 if c.get("OPP_TOV_PCT") is not None else None,
            "Opp FTA Rate": c.get("OPP_FTA_RATE"),
        })

    return {
        "meta": {
            "season": SEASON,
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "NBA Stats API — auto-generated, no manual Excel input required",
        },
        "players": players,
        "lineups": lineups_normalised,
        "wowy": wowy,
        "onOff": on_off_data,
        "nameLookup": name_lookup,
    }


def aggregate_opp_rows(rows):
    """Aggregate team stat rows fetched across multiple OpponentTeamID calls.
    Sums GP and computes GP-weighted averages for rate stats."""
    from collections import defaultdict
    by_team = defaultdict(list)
    for r in rows:
        tid = r.get("TEAM_ID")
        if tid:
            by_team[tid].append(r)

    aggregated = []
    rate_fields = ["OFF_RATING","DEF_RATING","NET_RATING","EFG_PCT","TM_TOV_PCT",
                   "OREB_PCT","DREB_PCT","OPP_EFG_PCT","OPP_TOV_PCT","OPP_OREB_PCT",
                   "OPP_FTA_RATE","PACE","AST_PCT","TS_PCT","PIE"]
    for tid, team_rows in by_team.items():
        total_gp = sum(r.get("GP") or 0 for r in team_rows)
        if not total_gp:
            continue
        base = dict(team_rows[0])
        base["GP"] = total_gp
        for f in rate_fields:
            vals = [(r.get(f), r.get("GP") or 0) for r in team_rows if r.get(f) is not None]
            if vals:
                base[f] = sum(v * gp for v, gp in vals) / sum(gp for _, gp in vals)
        aggregated.append(base)
    return aggregated


def fetch_game_log(team_id):
    """Fetch the full season game log for one team across all season types,
    sorted oldest-first. Includes Regular Season + Tip-Off Tournament."""
    all_rows = []
    # Start with the active season type, then try the other
    season_types = ["Regular Season", "Showcase"]
    if ACTIVE_SEASON_TYPE == "Showcase":
        season_types = ["Showcase", "Regular Season"]
    for season_type in season_types:
        st_encoded = season_type.replace(" ", "+")
        url = (
            "https://stats.nba.com/stats/leaguegamelog"
            f"?LeagueID=20&Season={SEASON}&SeasonType={st_encoded}"
            "&PlayerOrTeam=T&Direction=ASC&Sorter=DATE"
            f"&TeamID={team_id}&Counter=0"
        )
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            rs = data["resultSets"][0]
            hdrs = rs["headers"]
            rows = [dict(zip(hdrs, row)) for row in rs["rowSet"]]
            team_rows = [r for r in rows if r.get("TEAM_ID") == team_id]
            all_rows.extend(team_rows)
            if team_rows:
                print(f"    {season_type.replace('+', ' ')}: {len(team_rows)} games")
            time.sleep(1)
        except Exception as e:
            print(f"    {season_type}: ERROR — {e}")
    # Sort by date, deduplicate by GAME_ID
    seen = set()
    unique = []
    for r in sorted(all_rows, key=lambda x: x.get("GAME_DATE", "")):
        if r["GAME_ID"] not in seen:
            seen.add(r["GAME_ID"])
            unique.append(r)
    return unique



def build_abbrev_to_team_id(team_ids_dict):
    """team_ids_dict is {abbrev: team_id} from discover_teams() — already verified."""
    return {abbrev.upper(): tid for abbrev, tid in team_ids_dict.items()}


def build_opponent_strength_slices(game_log, all_teams, abbrev_to_id=None):
    """Classify opponents into elite/middle/weak by net rating, then
    return date-range lists for each bucket so team stats can be filtered
    to only games against that quality of opponent.

    elite  = top third of league by NET_RATING
    middle = middle third
    weak   = bottom third
    """
    if not all_teams:
        return {}

    # Rank teams by net rating
    ranked = sorted(
        [t for t in all_teams if t.get("NET_RATING") is not None],
        key=lambda t: t["NET_RATING"],
        reverse=True,
    )
    n = len(ranked)
    third = n // 3
    elite_ids  = {t["TEAM_ID"] for t in ranked[:third]}
    weak_ids   = {t["TEAM_ID"] for t in ranked[n - third:]}
    middle_ids = {t["TEAM_ID"] for t in ranked[third:n - third]}

    buckets = {"vs_elite": [], "vs_middle": [], "vs_weak": []}
    # Use the abbrev->id map from discover_teams() which already has all
    # 31 verified abbreviations (AUS, BHM, MXC etc) — this avoids the
    # TEAM_ABBREVIATION=null problem in team_stats data.
    lookup = abbrev_to_id or {}

    # Print a sample MATCHUP to confirm the format
    if game_log:
        print(f"    Sample MATCHUP: {game_log[0].get('MATCHUP')!r}")

    # Collect unique opponent team IDs per bucket
    seen = {"vs_elite": set(), "vs_middle": set(), "vs_weak": set()}
    unmatched_games = 0
    for game in game_log:
        matchup = game.get("MATCHUP", "")
        opp_abbrev = matchup.split()[-1].upper()
        opp_id = lookup.get(opp_abbrev)
        if not opp_id:
            unmatched_games += 1
            continue
        if opp_id in elite_ids:
            seen["vs_elite"].add(opp_id)
        elif opp_id in weak_ids:
            seen["vs_weak"].add(opp_id)
        else:
            seen["vs_middle"].add(opp_id)

    if unmatched_games:
        print(f"    Warning: {unmatched_games} games couldn't be matched to opponent")

    result = {k: list(v) for k, v in seen.items()}
    print(f"    Opponent IDs — elite: {len(result['vs_elite'])}, "
          f"middle: {len(result['vs_middle'])}, weak: {len(result['vs_weak'])}")
    return result


def fetch_player_on_off(team_id):
    """Fetch true on/off stats for all players on a team using
    teamplayeronoffdetails — computed from actual play-by-play lineup
    tracking, not approximated from duo combinations."""
    results = {}
    for measure in ("Base", "Advanced", "Four Factors"):
        url = (
            "https://stats.nba.com/stats/teamplayeronoffdetails"
            f"?TeamID={team_id}&LeagueID=20&Season={SEASON}"
            f"&SeasonType={ACTIVE_SEASON_TYPE}"
            f"&MeasureType={measure.replace(' ', '+')}"
            "&PerMode=PerGame&PaceAdjust=N&PlusMinus=N&Rank=N"
            "&Outcome=&Location=&Month=0&SeasonSegment="
            "&DateFrom=&DateTo=&OpponentTeamID=0"
            "&VsConference=&VsDivision=&GameSegment=&Period=0"
            "&ShotClockRange=&LastNGames=0"
        )
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        # Endpoint returns two result sets: OverallPlayerOnOffSummary (on) and off
        for rs in data.get("resultSets", []):
            rs_name = rs.get("name", "")
            hdrs = rs.get("headers", [])
            rows = [dict(zip(hdrs, row)) for row in rs.get("rowSet", [])]
            if rs_name not in results:
                results[rs_name] = {}
            for row in rows:
                pid = row.get("PLAYER_ID")
                if pid:
                    if pid not in results[rs_name]:
                        results[rs_name][pid] = {}
                    results[rs_name][pid].update(row)
        time.sleep(1)

    # Merge into a list of {player, on: {...}, off: {...}}
    on_key  = next((k for k in results if "On"  in k), None)
    off_key = next((k for k in results if "Off" in k), None)
    if not on_key or not off_key:
        return []

    merged = []
    all_pids = set(results[on_key].keys()) | set(results[off_key].keys())
    for pid in all_pids:
        on_row  = results[on_key].get(pid, {})
        off_row = results[off_key].get(pid, {})
        merged.append({
            "PLAYER_ID":   pid,
            "PLAYER_NAME": on_row.get("PLAYER_NAME") or off_row.get("PLAYER_NAME"),
            "on":  on_row,
            "off": off_row,
        })
    return sorted(merged, key=lambda x: (x["on"].get("MIN") or 0), reverse=True)


if __name__ == "__main__":
    main()
