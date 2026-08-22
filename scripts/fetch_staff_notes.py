"""
Fetches recent comments from the site's single, shared "Request a Player"
Giscus discussion and writes them to a static JSON file (data/staff_notes.json).

Note: Giscus on this site is configured with data-mapping='specific' and a
single fixed data-term='request-a-player' — one shared discussion thread
for the entire site, not a separate discussion per player page. Confirmed
before building this (the original design assumed per-player discussions,
which don't actually exist here).

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
DISCUSSION_TITLE = "request-a-player"  # the fixed data-term, which becomes the discussion title under mapping='specific'
MAX_COMMENTS = 25

QUERY = """
query($owner: String!, $name: String!, $categoryId: ID!) {
  repository(owner: $owner, name: $name) {
    discussions(first: 10, categoryId: $categoryId, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        title
        url
        comments(last: 25) {
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


def fetch_recent_comments(token):
    payload = json.dumps({
        "query": QUERY,
        "variables": {"owner": REPO_OWNER, "name": REPO_NAME, "categoryId": CATEGORY_ID},
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

    discussions = result["data"]["repository"]["discussions"]["nodes"]
    # Match by title specifically rather than trusting list order — there's
    # only supposed to be one relevant discussion, but don't assume it.
    target = next((d for d in discussions if d["title"].strip().lower() == DISCUSSION_TITLE), None)
    if target is None:
        raise RuntimeError(f"Could not find a discussion titled '{DISCUSSION_TITLE}' in the category.")

    comments = []
    for c in target["comments"]["nodes"]:
        body = (c["body"] or "").strip()
        if not body:
            continue
        comments.append({
            "author": c["author"]["login"] if c["author"] else "(deleted user)",
            "body": body,
            "createdAt": c["createdAt"],
        })

    comments.sort(key=lambda c: c["createdAt"], reverse=True)
    return {"discussionUrl": target["url"], "comments": comments[:MAX_COMMENTS]}


if __name__ == "__main__":
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("GITHUB_TOKEN environment variable is required.")

    print("Fetching recent Request a Player discussion activity...")
    result = fetch_recent_comments(token)
    print(f"Fetched {len(result['comments'])} recent comment(s)")

    os.makedirs("data", exist_ok=True)
    with open("data/staff_notes.json", "w") as f:
        json.dump(result, f, separators=(",", ":"))
    print("Written to data/staff_notes.json")
