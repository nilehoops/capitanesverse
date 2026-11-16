import json
import time
import requests
from nba_api.stats.endpoints import commonteamroster, leaguegamefinder

SEASON = "2026-27"
LEAGUE_ID = "20"
ROSTER_PATH = f"data/gleague_roster_{SEASON}.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://nba.com",
}

TEAM_NAME_TO_ABBREV = {
    "austin": "AUS", "birmingham": "BHM", "capital city": "CCG", "cleveland": "CLC",
    "college park": "CPS", "delaware": "DEL", "grand rapids": "GRG", "greensboro": "GBO",
    "indiana": "IMA", "noblesville": "NOB", "iowa": "IWA", "long island": "LIN",
    "maine": "MNE", "memphis": "MHU", "mexico city": "MXC", "capitanes": "MXC",
    "motor city": "MCC", "oklahoma city": "OKL", "osceola": "OSC", "raptors 905": "RAP",
    "rio grande": "RGV", "rip city": "RCR", "salt lake city": "SLC", "san diego": "SDC",
    "santa cruz": "SCW", "sioux falls": "SXF", "south bay": "SBL", "stockton": "STO",
    "texas": "TEX", "valley": "VAL", "westchester": "WES", "windy city": "WCB",
    "wisconsin": "WIS",
}

def resolve_abbrev(raw_team):
    s = str(raw_team or "").strip()
    if len(s) == 3 and s.isupper():
        return s
    low = s.lower()
    for k, v in TEAM_NAME_TO_ABBREV.items():
        if k in low:
            return v
    return s.upper()[:3] if s else ""

# 1. Load existing gleague_roster_2026-27.json
try:
    roster_data = json.load(open(ROSTER_PATH, encoding="utf-8"))
except Exception:
    roster_data = {"players": [], "nameToTeam": {}}

name_to_team = dict(roster_data.get("nameToTeam", {}))
name_case = {p["name"].lower(): p["name"] for p in roster_data.get("players", []) if p.get("name")}

# 2. Sync live 31-team rosters from CommonTeamRoster (authoritative current G League rosters)
print("Syncing live 31-team G League rosters...")
try:
    gf = leaguegamefinder.LeagueGameFinder(league_id_nullable=LEAGUE_ID, season_nullable=SEASON).get_data_frames().pop(0)
    teams_df = gf[["TEAM_ID", "TEAM_ABBREVIATION"]].drop_duplicates()
    live_map = {}
    for _, tr in teams_df.iterrows():
        tid = int(tr["TEAM_ID"])
        abbrev = str(tr["TEAM_ABBREVIATION"]).strip()
        if len(abbrev) != 3:
            continue
        try:
            r_df = commonteamroster.CommonTeamRoster(team_id=tid, season=SEASON, league_id_nullable=LEAGUE_ID).get_data_frames().pop(0)
            for _, pr in r_df.iterrows():
                full_nm = str(pr["PLAYER"]).strip()
                if full_nm:
                    low_nm = full_nm.lower()
                    live_map[low_nm] = abbrev
                    name_case[low_nm] = full_nm
            time.sleep(0.45)
        except Exception:
            continue
    if len(live_map) >= 250:
        name_to_team = live_map
        print(f"  Synced {len(name_to_team)} active G League players across {len(teams_df)} teams.")
except Exception as e:
    print(f"  [Note] Live roster sync fallback: {e}")

# 3. Pull official 31-team G League transactions feed and apply any newer moves
tx_urls = [
    "https://nba.com",
    "https://nba.comapi/1/transactions/?season=2026",
]

all_tx = []
for url in tx_urls:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            continue
        raw = resp.json()
        rows = raw if isinstance(raw, list) else (raw.get("transactions") or raw.get("data") or raw.get("results") or [])
        for item in rows:
            p_name = str(item.get("playerName") or item.get("player") or item.get("fullName") or "").strip()
            tm_raw = item.get("teamTricode") or item.get("teamAbbreviation") or item.get("teamName") or item.get("team") or ""
            tx_type = str(item.get("transactionType") or item.get("type") or "").strip()
            desc = str(item.get("description") or item.get("details") or item.get("summary") or "").strip()
            dt = str(item.get("date") or item.get("transactionDate") or item.get("formattedDate") or "").strip()
            if p_name:
                all_tx.append({
                    "date": dt,
                    "team": resolve_abbrev(tm_raw),
                    "player": p_name,
                    "type": tx_type,
                    "desc": desc,
                })
        if all_tx:
            print(f"  Fetched {len(all_tx)} league transactions from {url}")
            break
    except Exception:
        continue

# Apply chronological transactions onto name_to_team
for tx in reversed(all_tx):
    low_nm = tx["player"].lower()
    name_case.setdefault(low_nm, tx["player"])
    comb = f"{tx['type']} {tx['desc']}".lower()
    if any(k in comb for k in ["waive", "release", "buyout"]):
        name_to_team.pop(low_nm, None)
    elif any(k in comb for k in ["sign", "claim", "acquire", "transfer", "assign", "two-way"]) and tx["team"]:
        name_to_team[low_nm] = tx["team"]

# 4. Write updated players + nameToTeam + transactions back into data/gleague_roster_2026-27.json
updated_players = sorted(
    [{"name": name_case.get(k, k.title()), "team": v} for k, v in name_to_team.items()],
    key=lambda x: x["name"]
)

roster_data["players"] = updated_players
roster_data["nameToTeam"] = dict(sorted(name_to_team.items()))
if all_tx:
    roster_data["transactions"] = all_tx[:150]

with open(ROSTER_PATH, "w", encoding="utf-8") as f:
    json.dump(roster_data, f, indent=2)

# 5. Sync onRoster flag inside data/players_index.json & data/players.json (preserving all existing fields)
for p_file in ["data/players_index.json", "data/players.json"]:
    try:
        pdata = json.load(open(p_file, encoding="utf-8"))
        changed = False
        items = pdata if isinstance(pdata, list) else list(pdata.values())
        for obj in items:
            if not isinstance(obj, dict) or not obj.get("name"):
                continue
            low = obj["name"].strip().lower()
            in_gl = (name_to_team.get(low) == 'MXC')
            if "onRoster" in obj and obj["onRoster"] != in_gl:
                obj["onRoster"] = in_gl
                changed = True
            if in_gl and obj.get("league") == "G League" and obj.get("team") != name_to_team[low]:
                obj["team"] = name_to_team[low]
                changed = True
        if changed:
            with open(p_file, "w", encoding="utf-8") as f:
                json.dump(pdata, f, indent=2)
            print(f"  Updated roster status inside {p_file}")
    except Exception:
        pass

print(f"Done! {ROSTER_PATH} now holds {len(updated_players)} active G League players across 31 teams.")
