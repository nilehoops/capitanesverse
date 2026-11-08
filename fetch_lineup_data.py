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
SEASON = "2025-26"

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


def discover_teams():
    """Return {abbrev: team_id} for all G League teams this season, and the
    Capitanes team ID specifically."""
    url = (
        "https://stats.nba.com/stats/leaguedashlineups"
        f"?LeagueID=20&Season={SEASON}&SeasonType=Regular+Season"
        "&MeasureType=Advanced&PerMode=PerMinute"
        "&GroupQuantity=2&PaceAdjust=N&Rank=N&Outcome=&Location=&Month=0"
        "&SeasonSegment=&DateFrom=&DateTo=&OpponentTeamID=0"
        "&VsConference=&VsDivision=&GameSegment=&Period=0"
        "&ShotClockRange=&LastNGames=0&GameScope=&PlayerExperience="
        "&PlayerPosition=&StarterBench=&TwoWay=0&MinutesFilter=0"
    )
    print("Discovering G League teams...")
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

    print(f"  Found {len(seen)} teams: {', '.join(sorted(seen.keys()))}")

    cap_abbrev = next((a for a in seen if a in ("MXC", "CAP", "MEX")), None)
    if not cap_abbrev:
        print("  ERROR: Could not find Capitanes (MXC). Check team list above.")
        return None, None
    print(f"  Capitanes: {cap_abbrev} (ID {seen[cap_abbrev]})")
    return seen, seen[cap_abbrev]


def _lineup_url(team_id, group_quantity, measure_type, min_minutes=0):
    return (
        "https://stats.nba.com/stats/leaguedashlineups"
        f"?LeagueID=20&Season={SEASON}&SeasonType=Regular+Season"
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

    # Opponent — prefix OPP_ fields to avoid colliding with team-side names
    try:
        time.sleep(0.3)
        opp_rows = _fetch_lineup_measure(team_id, group_quantity, "Opponent", min_minutes)
        opp_by_id = {r["GROUP_ID"]: r for r in opp_rows}
        OPP_FIELDS = ["EFG_PCT", "FG2_PCT", "FG3_PCT", "FT_PCT", "TOV_PCT",
                      "FTA_RATE", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A",
                      "FG2M", "FG2A", "FTM", "FTA"]
        for r in adv_rows:
            opp = opp_by_id.get(r.get("GROUP_ID"), {})
            for f in OPP_FIELDS:
                if f in opp:
                    r[f"OPP_{f}"] = opp[f]
    except Exception as e:
        # Opponent fetch failing is non-fatal — advanced data is still usable
        pass

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

    # Build cross-reference for MXC players only
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
    mxc_path = os.path.join("data", "lineup_data.json")
    with open(mxc_path, "w") as f:
        json.dump(mxc_output, f, separators=(",", ":"))

    # File 2: Full league — larger, loaded only on demand for comparisons
    league_path = os.path.join("data", "lineup_league.json")
    with open(league_path, "w") as f:
        json.dump({"meta": output["meta"], **output["league"]}, f, separators=(",", ":"))

    import os as _os
    mxc_kb = _os.path.getsize(mxc_path) // 1024
    league_kb = _os.path.getsize(league_path) // 1024
    print(f"\nWritten:")
    print(f"  {mxc_path} ({mxc_kb} KB) — MXC only, page loads this on startup")
    print(f"  {league_path} ({league_kb} KB) — full league, loaded on demand")
    print(f"\n  MXC: {len(output['duos'])} duos, {len(output['trios'])} trios, {len(output['quads'])} quads, {len(output['fiveman'])} 5-man")
    print(f"  League: {len(output['league']['duos'])} duos, {len(output['league']['trios'])} trios")
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

    ts_path = os.path.join("data", "team_stats.json")
    with open(ts_path, "w") as f:
        json.dump({
            "meta": {"season": SEASON, "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
            "slices": team_stats_output,
        }, f, separators=(",", ":"))
    ts_kb = os.path.getsize(ts_path) // 1024
    print(f"\n  Team stats written to {ts_path} ({ts_kb} KB)")
    # Player stats — replaces the manual Excel workflow
    print("\nFetching MXC player stats...")
    player_stats = fetch_player_stats(focus_team_id)
    if player_stats:
        mex_data = build_mex_data(player_stats, output)
        mex_path = os.path.join("data", "mex_data.json")
        with open(mex_path, "w") as f:
            json.dump(mex_data, f, separators=(",", ":"))
        mex_kb = os.path.getsize(mex_path) // 1024
        print(f"  mex_data.json written ({mex_kb} KB) — {len(player_stats)} players")
    else:
        print("  Warning: could not fetch player stats — mex_data.json not updated")

    print("\nCommit data/lineup_data.json, data/team_stats.json and data/mex_data.json to update the site.")


def fetch_team_stats(filters=None):
    """Fetch league-wide team stats for all G League teams.
    filters: dict with optional keys: Location (Home/Road), LastNGames (int),
    Period (1-4), DateFrom (YYYY-MM-DD), DateTo (YYYY-MM-DD).
    Writes data/team_stats.json."""
    filters = filters or {}
    base_params = (
        f"?LeagueID=20&Season={SEASON}&SeasonType=Regular+Season"
        "&PerMode=PerGame&PaceAdjust=N&PlusMinus=N&Rank=N"
        "&Outcome=&Location={loc}&Month=0&SeasonSegment="
        "&DateFrom={date_from}&DateTo={date_to}&OpponentTeamID=0"
        "&VsConference=&VsDivision=&GameSegment={game_segment}&Period={period}"
        "&ShotClockRange=&LastNGames={last_n}&GameScope=&PlayerExperience="
        "&PlayerPosition=&StarterBench=&TwoWay=0"
    ).format(
        loc=filters.get('Location', ''),
        date_from=filters.get('DateFrom', ''),
        date_to=filters.get('DateTo', ''),
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
        f"?LeagueID=20&Season={SEASON}&SeasonType=Regular+Season"
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


def build_mex_data(players, lineup_output):
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
        "nameLookup": name_lookup,
    }


if __name__ == "__main__":
    main()
