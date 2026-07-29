"""
Fetches 2 YouTube video results per player (id, title, thumbnail) and writes
them into each player's `videos` field in data/players.json.

Requires one environment variable (set as a GitHub Actions secret):
  YOUTUBE_API_KEY - a YouTube Data API v3 key (console.cloud.google.com)

QUOTA NOTE: YouTube's free daily quota is 10,000 units, and search.list costs
100 units per call. That's ~100 players per day, not all 281 in one run.
This script only fetches for players that don't already have videos cached
(skips anyone already enriched) and stops once MAX_REQUESTS_PER_RUN is hit,
so the weekly schedule gradually backfills everyone over a few runs, then
just tops up new/changed players after that. Run it manually (workflow_dispatch)
a few times back-to-back if you want to backfill faster than once a week.
"""

import json
import os
import sys
import time
import requests

DATA_PATH = "data/players.json"
MAX_REQUESTS_PER_RUN = 90   # leaves headroom under the 10,000-unit daily quota
RESULTS_PER_PLAYER = 2
SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"


def build_query(player):
    # Include team to disambiguate common names (e.g. multiple "Chris Johnson"s)
    team = player.get("team") or ""
    return f'"{player["name"]}" {team} basketball highlights'.strip()


def fetch_videos(api_key, query):
    params = {
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": RESULTS_PER_PLAYER,
        "order": "relevance",
        "key": api_key,
    }
    resp = requests.get(SEARCH_URL, params=params, timeout=15)
    if resp.status_code == 403:
        print("Hit a 403 (likely quota exceeded) — stopping this run early.")
        return None  # signal to stop the whole run, not just this player
    resp.raise_for_status()
    items = resp.json().get("items", [])
    return [
        {
            "id": item["id"]["videoId"],
            "title": item["snippet"]["title"],
            "thumbnail": item["snippet"]["thumbnails"]["default"]["url"],
        }
        for item in items
        if item.get("id", {}).get("videoId")
    ]


def main():
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        sys.exit("Missing YOUTUBE_API_KEY environment variable.")

    with open(DATA_PATH) as f:
        players = json.load(f)

    requests_made = 0
    updated = 0

    for player in players:
        if player.get("videos"):  # already enriched — skip
            continue
        if requests_made >= MAX_REQUESTS_PER_RUN:
            print(f"Reached MAX_REQUESTS_PER_RUN ({MAX_REQUESTS_PER_RUN}); stopping for this run.")
            break

        query = build_query(player)
        videos = fetch_videos(api_key, query)
        requests_made += 1

        if videos is None:  # quota error — stop entirely
            break
        if videos:
            player["videos"] = videos
            updated += 1
            print(f"  {player['name']}: {len(videos)} video(s) found.")
        else:
            player["videos"] = []  # mark as checked-but-empty so we don't retry every run
            print(f"  {player['name']}: no results.")

        time.sleep(0.2)  # be polite to the API

    with open(DATA_PATH, "w") as f:
        json.dump(players, f, indent=2)

    print(f"Done. Made {requests_made} API calls, updated {updated} players.")


if __name__ == "__main__":
    main()
