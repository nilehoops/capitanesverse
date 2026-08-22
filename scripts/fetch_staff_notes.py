"""
Fetches recent comments across all per-player Giscus discussions and writes
them to a static JSON file (data/staff_notes.json).

Giscus config, verified directly rather than assumed: player.html uses
data-mapping='specific' with data-term=`player-${player.id}` — a genuinely
separate discussion per player. (index.html has its own, different Giscus
embed for a "Request a Player" feature, using a single fixed shared term —
that one is excluded here since it isn't a player-specific staff note.)

Why this exists as a separate pipeline rather than a client-side fetch:
GitHub's GraphQL API requires authentication for every request, even reads
on public repos — there's no unauthenticated tier the way the REST API has.
Embedding a real token in the public site's JS would let any visitor pull
it out of "View Source" and misuse it. This script runs server-side (via
GitHub Actions, where the token stays secret) and writes a plain static
JSON file instead — the public page just fetches that file, no auth needed,
matching the same pattern already used for team_trait_profiles.json.

Requires a GITHUB_TOKEN with read access to Discussions in this repo,
passed via the GITHUB_TOKEN environment variable (GitHub Actions provides
this automatically to every workflow run).
"""

import json
import os
import urllib.request

REPO_OWNER = "nilehoops"
REPO_NAME = "capitanesverse"
CATEGORY_ID = "DIC_kwDOTmW7rs4DCXTk"  # "Player Comments" — same ID index.html's Giscus embed uses
EXCLUDED_TITLES = {"request-a-player"}  # a different, non-player-specific feature's shared thread
PLAYER_TERM_PREFIX = "player-"
MAX_COMMENTS = 25

QUERY = """
query($owner: String!, $name: String!, $categoryId: ID!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 50, after: $after, categoryId: $categoryId, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        comments(last: 10) {
          nodes {
            body
            createdAt
            author { login }
          }
        }
      }
    }
  }
}
"""


def fetch_all_discussions(token):
    """Pages through every discussion in the category — 50 per request,
    since a real site could plausibly exceed that in one page."""
    discussions = []
    after = None
    while True:
        payload = json.dumps({
            "query": QUERY,
            "variables": {"owner": REPO_OWNER, "name": REPO_NAME, "categoryId": CATEGORY_ID, "after": after},
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.github.com/graphql",
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/vnd.github+json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        if "errors" in result:
            raise RuntimeError(f"GraphQL errors: {result['errors']}")

        conn = result["data"]["repository"]["discussions"]
        discussions.extend(conn["nodes"])
        if not conn["pageInfo"]["hasNextPage"]:
            break
        after = conn["pageInfo"]["endCursor"]
    return discussions


def fetch_recent_comments(token):
    discussions = fetch_all_discussions(token)

    all_comments = []
    for d in discussions:
        title = d["title"].strip()
        if title.lower() in EXCLUDED_TITLES:
            continue
        if not title.startswith(PLAYER_TERM_PREFIX):
            continue  # not a per-player discussion (e.g. some other manually-created thread)
        player_id = title[len(PLAYER_TERM_PREFIX):]

        for c in d["comments"]["nodes"]:
            body = (c["body"] or "").strip()
            if not body:
                continue
            all_comments.append({
                "playerId": player_id,
                "playerUrl": f"player.html?id={player_id}",
                "author": c["author"]["login"] if c["author"] else "(deleted user)",
                "body": body,
                "createdAt": c["createdAt"],
            })

    all_comments.sort(key=lambda c: c["createdAt"], reverse=True)
    return all_comments[:MAX_COMMENTS]


if __name__ == "__main__":
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("GITHUB_TOKEN environment variable is required.")

    print("Fetching recent per-player comment activity...")
    comments = fetch_recent_comments(token)
    print(f"Fetched {len(comments)} recent comment(s)")

    os.makedirs("data", exist_ok=True)
    with open("data/staff_notes.json", "w") as f:
        json.dump(comments, f, separators=(",", ":"))
    print("Written to data/staff_notes.json")
