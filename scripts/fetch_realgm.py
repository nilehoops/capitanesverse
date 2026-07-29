"""
Enriches data/players.json with fields RealGM has that our sheet doesn't:
age, weight, agent/agency, last (pre-draft) team, and current-season stats —
written into a `realgm` sub-object per player.

RealGM has no public API, so this scrapes two pages per player:
  Summary (.../player/<slug>/Summary/<id>) — weight, agent, pre-draft team,
    and season-by-season stat tables
  Bio     (.../player/<slug>/Bio/<id>)     — birthdate, used to compute age

MATCHING: RealGM's own site search is JS-driven (no simple query URL), so
this finds each player's profile via DuckDuckGo's no-JS HTML search
(site:basketball.realgm.com/player <name> <team>) instead — no API key needed.
The parsed "Pre-Draft Team" is checked against our existing `team` field as a
sanity check; if they don't overlap, the match is still saved but flagged
`verified: false` so mismatches (common names) are easy to spot and fix.

CAVEAT: field labels/markup were confirmed against one real live RealGM page,
but not exhaustively — if RealGM's HTML differs slightly for other players
(esp. international players' Bio pages), get_field()/table detection may need
a small tweak. This is deliberately written to key off label TEXT ("Weight:",
"Agent:", etc.) rather than CSS classes, which is more resilient to markup
differences than guessing exact class names would be.

Rate-limited + resumable, same pattern as fetch_videos.py: skips players
already enriched, caps requests per run, sleeps between requests.
"""

import json
import re
import time
from datetime import date
from io import StringIO

import pandas as pd
import requests
from urllib.parse import unquote

DATA_PATH = "data/players.json"
MAX_PLAYERS_PER_RUN = 50
SLEEP_BETWEEN_REQUESTS = 2.0
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CapitanesverseBot/1.0; +https://github.com/)"}


def find_realgm_url(name, team):
    query = f"site:basketball.realgm.com/player {name} {team or ''}".strip()
    resp = requests.get("https://html.duckduckgo.com/html/", params={"q": query}, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    html = resp.text

    # Direct links (rare in DDG's HTML output, but check first)
    direct = re.findall(r'href="(https://basketball\.realgm\.com/player/[^"]+/Summary/\d+)"', html)
    if direct:
        return direct[0]

    # DDG's HTML results normally wrap the real URL in a redirect: /l/?uddg=<encoded>
    wrapped = re.findall(r'uddg=([^&"]+)', html)
    for w in wrapped:
        target = unquote(w)
        if "basketball.realgm.com/player/" in target and "/Summary/" in target:
            return target.split("&")[0]
    return None


def get_field(html_text, label):
    # Looks for "<b>Label:</b> value" (or <strong>), optionally wrapped in a link,
    # keyed off the label's visible text rather than a specific CSS class.
    pattern = rf'{re.escape(label)}:?\s*</(?:b|strong)>\s*(?:<a[^>]*>)?\s*([^<]+)'
    m = re.search(pattern, html_text, re.IGNORECASE)
    return m.group(1).strip() if m else None


def latest_season_row(df):
    if df is None or "Season" not in df.columns:
        return None
    df = df[df["Season"].astype(str) != "CAREER"]
    return df.iloc[-1] if len(df) else None


def parse_summary(html_text):
    weight = get_field(html_text, "Weight")
    agent = get_field(html_text, "Agent")
    pre_draft_team = get_field(html_text, "Pre-Draft Team")

    per_game, advanced = None, None
    try:
        tables = pd.read_html(StringIO(html_text))
        for t in tables:
            cols = set(str(c) for c in t.columns)
            if {"PTS", "REB", "AST"}.issubset(cols) and per_game is None:
                per_game = latest_season_row(t)
            elif {"TS%", "ORtg", "PER"}.issubset(cols) and advanced is None:
                advanced = latest_season_row(t)
    except ValueError:
        pass  # no tables found on the page

    return {
        "weight": weight,
        "agent": agent,
        "lastTeam": pre_draft_team,
        "currentSeason": {
            "ppg": _safe(per_game, "PTS"), "rpg": _safe(per_game, "REB"), "apg": _safe(per_game, "AST"),
            "spg": _safe(per_game, "STL"), "bpg": _safe(per_game, "BLK"),
            "fgPct": _safe(per_game, "FG%"), "threePct": _safe(per_game, "3P%"), "ftPct": _safe(per_game, "FT%"),
            "ts": _safe(advanced, "TS%"), "efg": _safe(advanced, "eFG%"), "usg": _safe(advanced, "USG%"),
            "ortg": _safe(advanced, "ORtg"), "drtg": _safe(advanced, "DRtg"), "per": _safe(advanced, "PER"),
        } if (per_game is not None or advanced is not None) else None,
    }


def _safe(row, col):
    if row is None or col not in row:
        return None
    val = row[col]
    if pd.isna(val):
        return None
    return val.item() if hasattr(val, "item") else val


def parse_bio_age(html_text):
    born = get_field(html_text, "Born") or get_field(html_text, "Birthdate") or get_field(html_text, "Date of Birth")
    if not born:
        return None, None
    born_clean = re.sub(r"\(.*?\)", "", born).strip()  # strip trailing "(Age NN)" if present
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%Y-%m-%d"):
        try:
            from datetime import datetime
            bdate = datetime.strptime(born_clean, fmt).date()
            today = date.today()
            age = today.year - bdate.year - ((today.month, today.day) < (bdate.month, bdate.day))
            return born_clean, age
        except ValueError:
            continue
    return born_clean, None


def team_overlaps(parsed_team, our_team):
    if not parsed_team or not our_team:
        return False
    p = set(re.findall(r"[a-z]+", parsed_team.lower()))
    o = set(re.findall(r"[a-z]+", our_team.lower()))
    return bool(p & o)


def enrich_player(player):
    url = find_realgm_url(player["name"], player.get("team"))
    if not url:
        return {"found": False}

    summary_resp = requests.get(url, headers=HEADERS, timeout=15)
    summary_resp.raise_for_status()
    data = parse_summary(summary_resp.text)
    verified = team_overlaps(data.get("lastTeam"), player.get("team"))

    bio_url = url.replace("/Summary/", "/Bio/")
    time.sleep(SLEEP_BETWEEN_REQUESTS)
    born, age = None, None
    try:
        bio_resp = requests.get(bio_url, headers=HEADERS, timeout=15)
        bio_resp.raise_for_status()
        born, age = parse_bio_age(bio_resp.text)
    except requests.RequestException:
        pass

    return {
        "found": True,
        "verified": verified,
        "summaryUrl": url,
        "bioUrl": bio_url,
        "age": age,
        "born": born,
        **data,
    }


def main():
    with open(DATA_PATH) as f:
        players = json.load(f)

    processed = 0
    updated = 0

    for player in players:
        if player.get("realgm"):  # already enriched — skip
            continue
        if processed >= MAX_PLAYERS_PER_RUN:
            print(f"Reached MAX_PLAYERS_PER_RUN ({MAX_PLAYERS_PER_RUN}); stopping for this run.")
            break

        try:
            result = enrich_player(player)
        except requests.RequestException as e:
            print(f"  {player['name']}: request failed ({e}); will retry next run.")
            processed += 1
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            continue

        processed += 1
        player["realgm"] = result
        if result.get("found"):
            updated += 1
            flag = "" if result.get("verified") else "  [UNVERIFIED MATCH — check this one]"
            print(f"  {player['name']}: matched {result['summaryUrl']}{flag}")
        else:
            print(f"  {player['name']}: no RealGM match found.")

        time.sleep(SLEEP_BETWEEN_REQUESTS)

    with open(DATA_PATH, "w") as f:
        json.dump(players, f, indent=2)

    print(f"Done. Processed {processed} players, {updated} matched.")


if __name__ == "__main__":
    main()
