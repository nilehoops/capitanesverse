"""
Fetches 2 YouTube video results per player (id, title, thumbnail) and writes
them into each player's `videos` field in data/players.json — using yt-dlp's
built-in search instead of the YouTube Data API, so no API key is needed.

RATE-LIMIT NOTE: there's no official quota like the Data API had, but
hammering YouTube with hundreds of rapid-fire requests from the same IP
(GitHub's shared runners) can still get you temporarily rate-limited. This
script self-limits to MAX_PLAYERS_PER_RUN per run, waits between requests,
and only queries players that don't already have videos cached — so the
weekly schedule backfills everyone over a few runs, then just tops up new
players after that. Raise MAX_PLAYERS_PER_RUN if it proves reliable for you,
lower it if you start seeing failures.
"""

import json
import time
import yt_dlp

DATA_PATH = "data/players_detail.json"  # videos lives here — was still pointing at the
                                          # old pre-split single file, completely disconnected
                                          # from the real data every other part of the site uses
MAX_PLAYERS_PER_RUN = 24  # each player can now make up to 3 queries (fallback tiers),
                           # so this is recalibrated from the old single-query cap —
                           # verified worst case (every tier of every player timing out)
                           # finishes at ~25 min, safely under the job's 30-min ceiling
RESULTS_PER_PLAYER = 2
SLEEP_BETWEEN_QUERIES = 1.5  # seconds — politeness delay, not an API requirement

YDL_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": "in_playlist",  # don't visit each video's page, just parse the search results list
    "skip_download": True,
    "noplaylist": True,
    "socket_timeout": 20,  # hard cap per network call — without this, a single stalled
                            # connection blocks the whole run indefinitely (confirmed:
                            # this happened for real, stuck on one player, every re-run
                            # since, since nothing forced that call to give up and move on)
}


def build_queries(player):
    # Most specific first (best disambiguation for common names), falling back
    # to broader queries only if that returns nothing. Adding words to a search
    # only narrows results — a team name that happens to be a common/generic
    # word (e.g. "Pacific") can make the specific query return zero results
    # even when a simpler one would find plenty. Confirmed real: this happened
    # for Alexis Marmolejos, team="Pacific" — a generic word polluting/over-
    # narrowing the query, not an absence of videos.
    name = player["name"]
    team = player.get("team") or ""
    queries = []
    if team:
        queries.append(f"{name} {team} basketball highlights")
    queries.append(f"{name} highlights")
    queries.append(name)
    return queries


def search_videos_with_fallback(queries):
    for i, query in enumerate(queries):
        if i > 0:
            time.sleep(0.5)  # small gap between fallback attempts for the same player
        videos = search_videos(query)
        if videos:
            return videos, query, i
    return [], queries[-1], len(queries) - 1


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


INDEX_PATH = "data/players_index.json"  # name/team live here — needed to build search
                                         # queries, but videos itself is never written back here


def main():
    with open(INDEX_PATH) as f:
        index_players = json.load(f)
    with open(DATA_PATH) as f:
        detail_players = json.load(f)
    detail_by_id = {p["id"]: p for p in detail_players}

    players_processed = 0
    updated = 0
    new_videos_by_id = {}  # collected in memory; only written to disk at the very end

    for idx_player in index_players:
        detail = detail_by_id.get(idx_player["id"])
        if detail is None:
            continue  # in index but missing from detail entirely — a different bug, not this script's job
        if detail.get("videos"):  # already enriched — skip
            continue
        if players_processed >= MAX_PLAYERS_PER_RUN:
            print(f"Reached MAX_PLAYERS_PER_RUN ({MAX_PLAYERS_PER_RUN}); stopping for this run.")
            break

        # name/team come from the index entry; videos gets written against this same id in detail.
        player = {"id": idx_player["id"], "name": idx_player["name"], "team": idx_player.get("team")}
        queries = build_queries(player)
        try:
            videos, used_query, tier = search_videos_with_fallback(queries)
        except Exception as e:
            print(f"  {player['name']}: search failed ({e}); will retry next run.")
            players_processed += 1
            time.sleep(SLEEP_BETWEEN_QUERIES)
            continue

        players_processed += 1
        new_videos_by_id[player["id"]] = videos  # [] counts as "checked, nothing found"
        if videos:
            updated += 1
            tier_note = f" (tier {tier + 1}/{len(queries)}: {used_query!r})" if tier > 0 else ""
            print(f"  {player['name']}: {len(videos)} video(s) found{tier_note}.")
        else:
            print(f"  {player['name']}: no results across all {len(queries)} query tiers.")

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
        json.dump(fresh_players, f, separators=(",", ":"))

    print(f"Done. Processed {players_processed} players, updated {updated}.")


if __name__ == "__main__":
    main()
