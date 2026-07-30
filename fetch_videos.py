"""
Fetches 2 YouTube video results per player (id, title, thumbnail) and writes
them into each player's `videos` field in data/players.json — using yt-dlp's
built-in search instead of the YouTube Data API, so no API key is needed.

RATE-LIMIT NOTE: there's no official quota like the Data API had, but
hammering YouTube with hundreds of rapid-fire requests from the same IP
(GitHub's shared runners) can still get you temporarily rate-limited. This
script self-limits to MAX_QUERIES_PER_RUN per run, waits between requests,
and only queries players that don't already have videos cached — so the
weekly schedule backfills everyone over a few runs, then just tops up new
players after that. Raise MAX_QUERIES_PER_RUN if it proves reliable for you,
lower it if you start seeing failures.
"""

import json
import time
import yt_dlp

DATA_PATH = "data/players.json"
MAX_QUERIES_PER_RUN = 100
RESULTS_PER_PLAYER = 2
SLEEP_BETWEEN_QUERIES = 1.5  # seconds — politeness delay, not an API requirement

YDL_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": "in_playlist",  # don't visit each video's page, just parse the search results list
    "skip_download": True,
    "noplaylist": True,
}


def build_query(player):
    # Team included to disambiguate common names.
    team = player.get("team") or ""
    return f'{player["name"]} {team} basketball highlights'.strip()


def search_videos(query):
    search_term = f"ytsearch{RESULTS_PER_PLAYER}:{query}"
    with yt_dlp.YoutubeDL(YDL_OPTS) as ydl:
        result = ydl.extract_info(search_term, download=False)

    entries = (result or {}).get("entries") or []
    videos = []
    for entry in entries:
        if not entry or not entry.get("id"):
            continue
        thumbnails = entry.get("thumbnails") or []
        thumbnail = thumbnails[0]["url"] if thumbnails else f"https://i.ytimg.com/vi/{entry['id']}/hqdefault.jpg"
        videos.append({
            "id": entry["id"],
            "title": entry.get("title") or "",
            "thumbnail": thumbnail,
        })
    return videos


def main():
    with open(DATA_PATH) as f:
        players = json.load(f)

    queries_made = 0
    updated = 0
    new_videos_by_id = {}  # collected in memory; only written to disk at the very end

    for player in players:
        if player.get("videos"):  # already enriched — skip
            continue
        if queries_made >= MAX_QUERIES_PER_RUN:
            print(f"Reached MAX_QUERIES_PER_RUN ({MAX_QUERIES_PER_RUN}); stopping for this run.")
            break

        query = build_query(player)
        try:
            videos = search_videos(query)
        except Exception as e:
            print(f"  {player['name']}: search failed ({e}); will retry next run.")
            queries_made += 1
            time.sleep(SLEEP_BETWEEN_QUERIES)
            continue

        queries_made += 1
        new_videos_by_id[player["id"]] = videos  # [] counts as "checked, nothing found"
        if videos:
            updated += 1
            print(f"  {player['name']}: {len(videos)} video(s) found.")
        else:
            print(f"  {player['name']}: no results.")

        time.sleep(SLEEP_BETWEEN_QUERIES)

    # Re-read the file fresh right before writing, in case it changed on disk while
    # this run was in progress (manual edits, another workflow, etc.) — this run only
    # ever touches the `videos` field, so nothing else can be clobbered by this merge.
    with open(DATA_PATH) as f:
        fresh_players = json.load(f)
    for p in fresh_players:
        if p["id"] in new_videos_by_id:
            p["videos"] = new_videos_by_id[p["id"]]

    with open(DATA_PATH, "w") as f:
        json.dump(fresh_players, f, indent=2)

    print(f"Done. Made {queries_made} searches, updated {updated} players.")


if __name__ == "__main__":
    main()
