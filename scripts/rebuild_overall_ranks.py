"""
Rebuilds overallRank for every player from positionalRank, using the exact
algorithm confirmed in conversation:

  1. Group all players (who have a positionalRank) into tiers by that rank
     value — every position's #1s together, every position's #2s together,
     and so on.
  2. Within each tier (up to 3 players sharing the same positional rank,
     one per position), break ties by:
       a. "Goodness score" — sum of (percentile - 0.5) across every
          qualifying Strengths/Weaknesses stat, position-relative, same
          stat set and percentile logic as the individual player pages.
          Higher goodness = better.
       b. Height — taller = better.
       c. Age — OLDER = better (this is a G League fit/NOW-ready board,
          not a draft/upside board, so more experience wins ties here).
  3. Concatenate tiers in positional-rank order (tier 1, then tier 2, ...)
     and assign a fresh sequential 1..N overallRank.
  4. Players with no positionalRank at all get overallRank = null — there's
     no tier to place them in.

This intentionally does NOT anchor to existing overallRank values — an
earlier attempt at this did, and was explicitly rejected because those
values were outdated. This is a full, deterministic recompute every run,
not an incremental insert — that's also deliberate: a player's goodness
score changes as their stats/season data changes, so "only insert new
players, leave existing ranks alone" would silently drift out of date.

Only writes to data/players_index.json (overallRank lives there).
data/players_detail.json is read-only input (stats + biography.age).
"""

import json

INDEX_PATH = "data/players_index.json"
DETAIL_PATH = "data/players_detail.json"

# Same stat set as the individual player Strengths/Weaknesses bars
# (player.html / blindrank.html), including the same scale-conversion rules.
SW_STATS = [
    "prpg", "dPrpg", "bpm", "obpm", "dbpm", "ortg", "drtg",
    "usg", "efg", "ts", "orb", "drb", "ast", "tov", "astToRatio",
    "blk", "stl", "ftr", "rimPct", "nonRim2Pct", "ftPct", "twoPct",
    "threePRate", "threePct", "dunksPerGame", "bmi",
]
LOWER_IS_BETTER = {"tov", "drtg"}


def get_sw_value(player, key):
    if key == "dunksPerGame":
        dunks = (player.get("stats") or {}).get("dunks")
        gp = (player.get("stats") or {}).get("gp")
        return dunks / gp if (dunks is not None and gp) else None
    if key == "bmi":
        weight = (player.get("biography") or {}).get("weight")
        height = player.get("heightIn")
        if not weight or not height:
            return None
        import re
        m = re.match(r"^\d+", str(weight))
        return 703 * int(m.group()) / (height * height) if m else None
    return (player.get("stats") or {}).get(key)


def percentile_rank(pool, position, key, value):
    if value is None:
        return None
    peers = [get_sw_value(p, key) for p in pool if p["position"] == position]
    peers = [v for v in peers if v is not None]
    if len(peers) < 5:
        return None
    if key in LOWER_IS_BETTER:
        better = sum(1 for v in peers if v >= value)
    else:
        better = sum(1 for v in peers if v <= value)
    return better / len(peers)


def goodness_score(player, pool):
    total = 0.0
    for key in SW_STATS:
        value = get_sw_value(player, key)
        pct = percentile_rank(pool, player["position"], key, value)
        if pct is not None:
            total += pct - 0.5
    return total


def rebuild_overall_ranks(players):
    """players: merged index+detail records (dicts). Mutates overallRank in place."""
    by_pos = {"Guard": [], "Wing": [], "Big": []}
    no_pos_rank = []
    for p in players:
        if p.get("positionalRank") is not None:
            by_pos.setdefault(p["position"], []).append(p)
        else:
            no_pos_rank.append(p)

    for pos in by_pos:
        by_pos[pos].sort(key=lambda p: p["positionalRank"])

    # Precompute goodness once per player (expensive-ish — O(n) percentile
    # lookups each — not per tier-comparison).
    for p in players:
        p["_goodness"] = goodness_score(p, players)

    if not by_pos or not any(by_pos.values()):
        max_tier = 0
    else:
        max_tier = max((max((p["positionalRank"] for p in plist), default=0) for plist in by_pos.values()), default=0)

    sequence = []
    for tier in range(1, int(max_tier) + 1):
        tier_group = [p for pos in by_pos for p in by_pos[pos] if p["positionalRank"] == tier]
        if not tier_group:
            continue

        def sort_key(p):
            age = (p.get("biography") or {}).get("age") or -1  # unknown age sorts last within tiebreak
            height = p.get("heightIn") or -1
            return (-p["_goodness"], -height, -age)

        tier_group.sort(key=sort_key)
        sequence.extend(tier_group)

    for i, p in enumerate(sequence, 1):
        p["overallRank"] = i
    for p in no_pos_rank:
        p["overallRank"] = None

    for p in players:
        del p["_goodness"]

    return len(sequence)


def main():
    with open(INDEX_PATH) as f:
        index_players = json.load(f)
    with open(DETAIL_PATH) as f:
        detail_players = json.load(f)
    detail_by_id = {p["id"]: p for p in detail_players}

    merged = [{**p, **detail_by_id.get(p["id"], {})} for p in index_players]

    ranked_count = rebuild_overall_ranks(merged)

    rank_by_id = {p["id"]: p["overallRank"] for p in merged}
    for p in index_players:
        p["overallRank"] = rank_by_id.get(p["id"])

    ranks = [p["overallRank"] for p in index_players if p["overallRank"] is not None]
    assert len(ranks) == ranked_count, "count mismatch after write-back"
    assert sorted(ranks) == list(range(1, len(ranks) + 1)), "overallRank is not a clean sequential 1..N"

    with open(INDEX_PATH, "w") as f:
        json.dump(index_players, f, separators=(",", ":"))

    unranked = len(index_players) - ranked_count
    print(f"Done. Assigned overallRank to {ranked_count} players (sequential 1-{ranked_count}, verified).")
    if unranked:
        print(f"{unranked} player(s) have no positionalRank and were left with overallRank = null.")


if __name__ == "__main__":
    main()
