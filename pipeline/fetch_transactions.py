import re, unicodedata

def norm_name(s):
    if not s: return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[.,'’\-]", " ", s.lower())
    parts = [w for w in s.split() if w not in {"jr", "sr", "ii", "iii", "iv", "v"}]
    return " ".join(parts)

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

def _tok_match(short_nm, roster_map):
    import unicodedata, re
    def _t(x):
        x = unicodedata.normalize('NFD', str(x or '')).encode('ascii', 'ignore').decode('ascii').lower()
        return [w for w in re.sub(r'[^a-z0-9\s]', ' ', x).split() if w and w not in ('jr','sr','ii','iii','iv','v')]
    qt = _t(short_nm)
    if not qt: return None
    qf = ''.join(qt)
    for rk, ab in roster_map.items():
        rt = _t(rk)
        if ''.join(rt) == qf or (len(qt) >= 2 and all(w in rt for w in qt)) or (len(rt) >= 2 and all(w in qt for w in rt)):
            return ab
    return None


# 3. Pull official 31-team G League transactions backlog (2025-26 + 2026-27) from ://nba.com
all_tx = []
gl_waived_pool = []
try:
    _gl_base = "https://" + ".".join(["gleague", "nba", "com"])
    _r_gl = requests.get(_gl_base + "/api/transactions/fetchTransactions", headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": _gl_base + "/transactions",
        "Accept": "application/json"
    }, timeout=25)
    if _r_gl.ok:
        _raw_rows = _r_gl.json()
        # Build PLAYER_ID -> exact display name map from league_lite_shots + fa_pdf_pool
        _pid_to_name = {}
        for _fn in ("data/league_lite_shots_2026-27.json", "data/league_lite_shots_2025-26.json"):
            try:
                _d = json.load(open(_fn, encoding="utf-8"))
                for _tm in _d.get("teams", []):
                    for _rp in _tm.get("rosterStats", []):
                        if _rp.get("id") and _rp.get("name"):
                            _pid_to_name[int(_rp["id"])] = _rp["name"]
            except Exception:
                pass
        try:
            for _fp in json.load(open("data/fa_pdf_pool.json", encoding="utf-8")):
                if _fp.get("id") and _fp.get("name"):
                    _pid_to_name[int(_fp["id"])] = _fp["name"]
        except Exception:
            pass

        _slug_to_ab = {
            "spurs": "AUS", "charge": "CCG", "celtics": "MNE", "blue": "OKL", "bluecoats": "DEL",
            "skyhawks": "CPS", "knicks": "WES", "gold": "GRG", "905": "RAP", "magic": "OSC",
            "hustle": "MHU", "legends": "TEX", "bulls": "WCB", "skyforce": "SXF", "cruise": "MCC",
            "wolves": "IWA", "kings": "STO", "suns": "VAL", "capitanes": "MXC", "nets": "LIN",
            "swarm": "GBO", "stars": "SLC", "herd": "WIS", "vipers": "RGV", "remix": "RCR",
            "boom": "NOB", "madants": "IMA", "warriors": "SCW", "clippers": "SDC", "lakers": "SBL",
            "squadron": "BHM", "gogo": "CCG", "go-go": "CCG", "capitalcity": "CCG", "skyhawks": "CPS", "collegepark": "CPS", "captain": "MXC", "southbay": "SBL", "santacruz": "SCW", "sandiego": "SDC"
        }

        _recent = [r for r in _raw_rows if str(r.get("TRANSACTION_DATE", "")) >= "2025-10-01"]
        _recent.sort(key=lambda r: (str(r.get("TRANSACTION_DATE", "")), int(r.get("ADDITIONAL_SORT") or 0)), reverse=True)

        # First pass: map each player's last known non-empty team across all transactions
        _player_team_hist = {}
        for r in _recent:
            _p = r.get("PLAYER_ID")
            _ts = str(r.get("TEAM_SLUG") or "").lower().replace("-", "")
            _ab = _slug_to_ab.get(_ts) or (resolve_abbrev(_ts) if len(_ts) == 3 else "")
            if _p and _ab and int(_p) not in _player_team_hist:
                _player_team_hist[int(_p)] = _ab

        _latest_by_player = {}
        _seen_tx = set()
        for r in _recent:
            pid = r.get("PLAYER_ID")
            slug = str(r.get("PLAYER_SLUG") or "").strip()
            p_name = _pid_to_name.get(int(pid)) if pid else None
            if not p_name and slug:
                p_name = " ".join(w.capitalize() for w in slug.replace("-", " ").split())
            if not p_name:
                continue
            tslug = str(r.get("TEAM_SLUG") or "").lower().replace("-", "")
            ab = _slug_to_ab.get(tslug) or resolve_abbrev(tslug)
            dt = str(r.get("TRANSACTION_DATE") or "")[:10]
            ttype = str(r.get("TRANSACTION_TYPE") or "").strip()
            desc = str(r.get("TRANSACTION_DESCRIPTION") or "").strip()
            if not ab and pid and int(pid) in _player_team_hist:
                ab = _player_team_hist[int(pid)]
            if len(ab) != 3 or ab == "GOG":
                ab = "CCG" if ab == "GOG" else ""
            disp_type = desc if desc else ttype
            tx_obj = {"date": dt, "team": ab, "player": p_name, "pid": pid, "type": disp_type, "desc": desc}
            if any(w in f"{ttype} {desc}".lower() for w in ("call-up", "callup", "recall", "assign")):
                continue
            dedup_key = (dt, ab, p_name.lower(), ttype.lower())
            if dedup_key in _seen_tx:
                continue
            _seen_tx.add(dedup_key)
            all_tx.append(tx_obj)
            lk = p_name.lower()
            if lk not in _latest_by_player:
                _latest_by_player[lk] = tx_obj
            elif not _latest_by_player[lk].get("team") and ab:
                _latest_by_player[lk]["team"] = ab

        # Identify players whose latest 2025-26 / 2026-27 G League transaction was a waiver/release and who are NOT on a current roster
        for lk, ltx in _latest_by_player.items():
            comb = f"{ltx['type']} {ltx['desc']}".lower()
            if any(k in comb for k in ("waiv", "releas", "buyout")):
                if lk not in name_to_team and not _tok_match(lk, name_to_team):
                    gl_waived_pool.append(ltx)

        print(f"  Synced {len(all_tx)} G League transactions (2025-26 + 2026-27) & {len(gl_waived_pool)} unsigned waived G Leaguers.")
except Exception as e:
    print(f"  [Note] G League transactions fetch error: {e}")

roster_data["transactions"] = all_tx
roster_data["glWaivedPool"] = gl_waived_pool


# 3c. Build G League player index from ://nba.com + local cached datasets (zero stats.nba.com timeouts)
gl_pindex = {}
try:
    if os.path.exists("data/gleague_player_index.json"):
        gl_pindex = json.load(open("data/gleague_player_index.json", encoding="utf-8"))
except Exception:
    gl_pindex = {}

# Seed/merge all profiles & box-score stats from league_lite_shots_2026-27 & 2025-26 + fa_pdf_pool
for _fn, _ssn in (("data/league_lite_shots_2026-27.json", "2026-27"), ("data/league_lite_shots_2025-26.json", "2025-26")):
    try:
        _d = json.load(open(_fn, encoding="utf-8"))
        for _tm in _d.get("teams", []):
            for _rp in _tm.get("rosterStats", []):
                _pid = str(_rp.get("id") or "")
                if not _pid:
                    continue
                _ent = gl_pindex.setdefault(_pid, {"id": int(_pid)})
                _ent["name"] = _rp.get("name") or _ent.get("name", "")
                if _rp.get("position"): _ent["position"] = _rp["position"]
                if _rp.get("height"): _ent["height"] = _rp["height"]
                if _rp.get("weight"): _ent["weight"] = _rp["weight"]
                if _rp.get("school"): _ent["college"] = _rp["school"]
                if _rp.get("exp") is not None: _ent["yos"] = _rp["exp"]
                if _rp.get("pts") is not None and (_rp.get("min") or 0) > 0:
                    _ent["stats"] = {
                        "season": _ssn,
                        "gp": int(_rp.get("gp") or 0),
                        "min": float(_rp.get("min") or 0),
                        "poss": float(_rp.get("poss") or 0),
                        "pts": float(_rp.get("pts") or 0),
                        "reb": float(_rp.get("reb") or 0),
                        "ast": float(_rp.get("ast") or 0),
                        "stl": float(_rp.get("stl") or 0),
                        "blk": float(_rp.get("blk") or 0),
                        "tov": float(_rp.get("tov") or 0),
                        "fga": float(_rp.get("fga") or 0),
                        "fta": float(_rp.get("fta") or 0),
                        "tsPct": _rp.get("tsPct"),
                        "age": _rp.get("age"),
                    }
    except Exception:
        pass

try:
    for _fp in json.load(open("data/fa_pdf_pool.json", encoding="utf-8")):
        _pid = str(_fp.get("id") or "")
        if not _pid:
            continue
        _ent = gl_pindex.setdefault(_pid, {"id": int(_pid)})
        _ent["name"] = _fp.get("name") or _ent.get("name", "")
        if _fp.get("position"): _ent["position"] = _fp["position"]
        if _fp.get("height"): _ent["height"] = _fp["height"]
        if _fp.get("weight"): _ent["weight"] = _fp["weight"]
        if _fp.get("school"): _ent["college"] = _fp["school"]
        if _fp.get("yos") is not None: _ent["yos"] = _fp["yos"]
except Exception:
    pass

# Also pull live G League player directory from ://nba.com __NEXT_DATA__ (fast CDN, no stats.nba.com block)
try:
    import re as _re
    _gl_pl_url = "https://" + ".".join(["gleague", "nba", "com"]) + "/players"
    _r_pl = requests.get(_gl_pl_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}, timeout=15)
    if _r_pl.ok:
        _m = _re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', _r_pl.text, _re.S)
        if _m:
            _nd = json.loads(_m.group(1))
            _plist = _nd.get("props", {}).get("pageProps", {}).get("players") or []
            for _p in _plist:
                _pid = str(_p.get("PERSON_ID") or _p.get("id") or "")
                if not _pid:
                    continue
                _ent = gl_pindex.setdefault(_pid, {"id": int(_pid)})
                _fn = f"{_p.get('PLAYER_FIRST_NAME', '')} {_p.get('PLAYER_LAST_NAME', '')}".strip() or _p.get("name", "")
                if _fn: _ent["name"] = _fn
                if _p.get("POSITION"): _ent["position"] = _p["POSITION"]
                if _p.get("HEIGHT"): _ent["height"] = _p["HEIGHT"]
                if _p.get("WEIGHT"): _ent["weight"] = _p["WEIGHT"]
                if _p.get("COLLEGE") or _p.get("COUNTRY"): _ent["college"] = _p.get("COLLEGE") or _p.get("COUNTRY")
                _fy, _ty = _p.get("FROM_YEAR"), _p.get("TO_YEAR")
                if _fy and _ty and str(_fy).isdigit() and str(_ty).isdigit():
                    _ent["yos"] = int(_ty) - int(_fy)
except Exception:
    pass


# Merge height/weight/age/college from data/players.json by normalized name
try:
    _pf = json.load(open("data/players.json", encoding="utf-8"))
    _plist_pf = _pf if isinstance(_pf, list) else list(_pf.values())
    _by_low = {str(v.get("name", "")).strip().lower(): v for v in gl_pindex.values() if v.get("name")}
    for _xp in _plist_pf:
        _xnm = str(_xp.get("name", "")).strip().lower()
        if _xnm in _by_low:
            _ent = _by_low[_xnm]
            if not _ent.get("height") and (_xp.get("heightDisplay") or _xp.get("heightIn")):
                _ent["height"] = _xp.get("heightDisplay") or _xp.get("heightIn")
            _bio = _xp.get("biography") or {}
            if not _ent.get("weight") and _bio.get("weight"):
                _ent["weight"] = _bio["weight"]
            if not _ent.get("age") and _bio.get("age"):
                _ent["age"] = _bio["age"]
            if not _ent.get("college") and _xp.get("team") and _xp.get("team") != "N/A":
                _ent["college"] = _xp["team"]
except Exception:
    pass

# Also query ://nba.com JSON endpoint for full G League physicals (Height, Weight, Age/Birthdate, School)
try:
    _api_pl = "https://" + ".".join(["gleague", "nba", "com"]) + "/api/1/players"
    _r_ap = requests.get(_api_pl, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://nba.com"}, timeout=15)
    if _r_ap.ok:
        _ap_data = _r_ap.json()
        _ap_rows = _ap_data if isinstance(_ap_data, list) else (_ap_data.get("players") or _ap_data.get("data") or [])
        for _p in _ap_rows:
            _pid = str(_p.get("personId") or _p.get("PERSON_ID") or _p.get("id") or "")
            if not _pid:
                continue
            _ent = gl_pindex.setdefault(_pid, {"id": int(_pid)})
            _fn = f"{_p.get('firstName', '')} {_p.get('lastName', '')}".strip() or _p.get("fullName") or _p.get("name") or ""
            if _fn: _ent["name"] = _fn
            if _p.get("height"): _ent["height"] = _p["height"]
            if _p.get("weight"): _ent["weight"] = _p["weight"]
            if _p.get("age"): _ent["age"] = _p["age"]
            if _p.get("school") or _p.get("college") or _p.get("country"):
                _ent["college"] = _p.get("school") or _p.get("college") or _p.get("country")
            if _p.get("proYears") is not None or _p.get("yos") is not None:
                _ent["yos"] = _p.get("proYears") if _p.get("proYears") is not None else _p.get("yos")
except Exception:
    pass


# Concurrently fetch missing physicals (CommonPlayerInfo) & G League / NCAA career stats from ://nba.com{pid}/{slug}
from concurrent.futures import ThreadPoolExecutor as _TPE
import re as _re2

def _bad_val(v):
    return v is None or str(v).strip() in ("", "?", "-", "N/A", "None", "null")

_to_fetch = []
for _w in gl_waived_pool:
    _pid = str(_w.get("pid") or "")
    if not _pid:
        continue
    _ent = gl_pindex.get(_pid, {})
    if _bad_val(_ent.get("height")) or _bad_val(_ent.get("weight")) or _bad_val(_ent.get("age")) or _bad_val(_ent.get("college")):
        _slug = _re2.sub(r"[^a-z0-9]+", "-", str(_w.get("player") or "").lower()).strip("-") or "player"
        _to_fetch.append((_pid, _slug, _w.get("player", "")))

def _fetch_gl_bio(item):
    _pid, _slug, _nm = item
    try:
        _u = "https://" + ".".join(["gleague", "nba", "com"]) + f"/player/{_pid}/{_slug}"
        _r = requests.get(_u, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}, timeout=10)
        if not _r.ok:
            return None
        _m = _re2.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', _r.text, _re2.S)
        if not _m:
            return None
        _pp = json.loads(_m.group(1)).get("props", {}).get("pageProps", {})
        _st_rs = (_pp.get("stats") or {}).get("resultSets") or []
        _info = {}
        _first_rs = next((x for x in _st_rs if isinstance(x, dict) and x.get("rowSet")), None)
        if _first_rs:
            _first_row = next(iter(_first_rs.get("rowSet") or []), None)
            if _first_row:
                _info = dict(zip(_first_rs.get("headers", []), _first_row))
        _cs_rs = (_pp.get("careerStats") or {}).get("resultSets") or []
        return (_pid, _nm, _info, _cs_rs)
    except Exception:
        return None

if _to_fetch:
    _existing_gl_idx = {int(x["id"]): x for x in (json.load(open("data/gleague_player_index.json", encoding="utf-8")) if __import__("os").path.exists("data/gleague_player_index.json") else []) if isinstance(x, dict) and x.get("id")}
    _to_fetch = [x for x in _to_fetch if int(next(iter(x)) if isinstance(x, (list, tuple)) else x) not in _existing_gl_idx]
if _to_fetch:
    print(f"  Fetching official CommonPlayerInfo & career stats for {len(_to_fetch)} new waived G Leaguers...")
    with _TPE(max_workers=16) as _ex:
        for _res in _ex.map(_fetch_gl_bio, _to_fetch):
            if not _res:
                continue
            _pid, _nm, _info, _cs_rs = _res
            _ent = gl_pindex.setdefault(_pid, {"id": int(_pid), "name": _nm})
            if _info.get("DISPLAY_FIRST_LAST"):
                _ent["name"] = _info["DISPLAY_FIRST_LAST"]
            if not _bad_val(_info.get("HEIGHT")):
                _ent["height"] = str(_info["HEIGHT"]).strip()
            elif _bad_val(_ent.get("height")):
                _ent.pop("height", None)
            if not _bad_val(_info.get("WEIGHT")) and str(_info["WEIGHT"]).strip().isdigit():
                _ent["weight"] = int(str(_info["WEIGHT"]).strip())
            if not _bad_val(_info.get("BIRTHDATE")):
                _bd = str(_info["BIRTHDATE"])[:10]
                if len(_bd) >= 4 and _bd[:4].isdigit():
                    _mo = int(_bd[5:7]) if len(_bd) >= 7 and _bd[5:7].isdigit() else 6
                    _ent["age"] = round(2026.90 - int(_bd[:4]) - (_mo / 12.0), 1)
            if not _bad_val(_info.get("SCHOOL")):
                _ent["college"] = str(_info["SCHOOL"]).strip()
            elif not _bad_val(_info.get("COUNTRY")):
                _ent["college"] = str(_info["COUNTRY"]).strip()
            if _info.get("SEASON_EXP") is not None and str(_info["SEASON_EXP"]).strip().isdigit():
                _ent["yos"] = int(str(_info["SEASON_EXP"]).strip())
            if _info.get("POSITION"):
                _ent["position"] = str(_info["POSITION"]).strip()
            if isinstance(_cs_rs, list):
                for _rs in _cs_rs:
                    if not isinstance(_rs, dict):
                        continue
                    _rname = str(_rs.get("name") or "")
                    _rows = _rs.get("rowSet") or []
                    if not _rows:
                        continue
                    if ("RegularSeason" in _rname or "Showcase" in _rname) and "stats" not in _ent:
                        _last = dict(zip(_rs.get("headers", []), _rows[-1]))
                        if float(_last.get("MIN") or 0) > 0:
                            _ent["stats"] = {
                                "season": str(_last.get("SEASON_ID") or "GL"),
                                "gp": int(_last.get("GP") or 0),
                                "min": float(_last.get("MIN") or 0),
                                "pts": float(_last.get("PTS") or 0),
                                "reb": float(_last.get("REB") or 0),
                                "ast": float(_last.get("AST") or 0),
                                "stl": float(_last.get("STL") or 0),
                                "blk": float(_last.get("BLK") or 0),
                                "tov": float(_last.get("TOV") or 0),
                                "fga": float(_last.get("FGA") or 0),
                                "fta": float(_last.get("FTA") or 0),
                            }
                    elif "CollegeSeason" in _rname and "ncaaCareer" not in _ent:
                        # Sum career NCAA totals (GP, MIN, PTS, REB, AST, FGA, FTA)
                        _hdrs = _rs.get("headers", [])
                        _c_gp = _c_min = _c_pts = _c_reb = _c_ast = _c_fga = _c_fta = 0.0
                        for _rw in _rows:
                            _cd = dict(zip(_hdrs, _rw))
                            _c_gp += float(_cd.get("GP") or 0)
                            _c_min += float(_cd.get("MIN") or 0)
                            _c_pts += float(_cd.get("PTS") or 0)
                            _c_reb += float(_cd.get("REB") or 0)
                            _c_ast += float(_cd.get("AST") or 0)
                            _c_fga += float(_cd.get("FGA") or 0)
                            _c_fta += float(_cd.get("FTA") or 0)
                        if _c_gp > 0 and _c_min > 0:
                            _ent["ncaaCareer"] = {
                                "gp": int(_c_gp), "min": _c_min, "pts": _c_pts,
                                "reb": _c_reb, "ast": _c_ast, "fga": _c_fga, "fta": _c_fta
                            }

_with_st = sum(1 for v in gl_pindex.values() if v.get("stats"))
print(f"  Synced {len(gl_pindex)} G League registry profiles ({_with_st} with pro G League stats) to data/gleague_player_index.json.")
json.dump(gl_pindex, open("data/gleague_player_index.json", "w", encoding="utf-8"), indent=2)

roster_data["nbaReleased"] = []

# 3d. Automated Overseas / Unindexed Player Bio, Signing & Stat Sync (ESPN + Wikipedia JSON APIs, zero browser memory)
def sync_realgm_overseas_players(target_names, gl_pindex, max_live_lookups=60):
    import os as _os_ov, re as _re_ov
    from concurrent.futures import ThreadPoolExecutor as _TPE_OV
    _cache_fn = "data/realgm_cache.json"
    _cache = json.load(open(_cache_fn, encoding="utf-8")) if _os_ov.path.exists(_cache_fn) else {}
    _espn_search = "https://" + ".".join(["site", "web", "api", "espn", "com"]) + "/apis/common/v3/search"
    _wiki_api = "https://" + ".".join(["en", "wikipedia", "org"]) + "/w/api.php"

    def _lookup_one(nm):
        _lk = nm.strip().lower()
        if _lk in _cache:
            return (_lk, _cache[_lk])
        _bio = {}
        # 1. ESPN Player Search JSON API (NBA + NCAAM) for Ht, Wt, Age, College, Experience & Current Team
        try:
            _r = requests.get(_espn_search, params={"query": nm, "type": "player", "sport": "basketball", "limit": 3}, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            if _r.ok:
                _items = _r.json().get("items") or []
                _hit = next((it for it in _items if str(it.get("displayName", "")).strip().lower() == _lk), _items if _items else None)
                if isinstance(_hit, dict):
                    _aid = str(_hit.get("id") or "")
                    _lg = str(_hit.get("league") or "nba").lower()
                    _sport_path = "mens-college-basketball" if "college" in _lg or "ncaam" in _lg else "nba"
                    if _aid:
                        _au = "https://" + ".".join(["site", "web", "api", "espn", "com"]) + f"/apis/common/v3/sports/basketball/{_sport_path}/athletes/{_aid}"
                        _ra = requests.get(_au, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
                        if _ra.ok:
                            _ath = _ra.json().get("athlete") or {}
                            if _ath.get("displayHeight"): _bio["height"] = str(_ath["displayHeight"]).replace("'", "-").replace('"', "").strip()
                            if _ath.get("displayWeight"):
                                _wm = _re_ov.search(r'(\d{2,3})', str(_ath["displayWeight"]))
                                if _wm: _bio["weight"] = int(_wm.group(1))
                            if _ath.get("age"): _bio["age"] = float(_ath["age"])
                            _col = _ath.get("college") or {}
                            if isinstance(_col, dict) and _col.get("name"): _bio["college"] = _col["name"]
                            _exp = _ath.get("experience") or {}
                            if isinstance(_exp, dict) and _exp.get("years") is not None: _bio["yos"] = int(_exp["years"])
                            _links = _ath.get("links") or []
                            _web_lnk = next((l.get("href") for l in _links if isinstance(l, dict) and l.get("href")), "")
                            if _web_lnk: _bio["realgmUrl"] = _web_lnk
        except Exception:
            pass

        # 2. Wikipedia Open API for current overseas club team & bio if still missing
        try:
            _rw = requests.get(_wiki_api, params={"action": "query", "list": "search", "srsearch": f'"{nm}" basketball', "format": "json", "srlimit": 2}, headers={"User-Agent": "CapitanesVerse/1.0"}, timeout=10)
            if _rw.ok:
                _hits = _rw.json().get("query", {}).get("search") or []
                if _hits and isinstance(_hits, dict):
                    _title = _hits.get("title", "")
                    _snip = " ".join(_re_ov.sub(r'<[^>]+>', ' ', _hits.get("snippet", "")).split())
                    _m_club = _re_ov.search(r'(?:plays for|signed with|currently with|member of)\s+(?:the\s+)?([A-Z][A-Za-z0-9 .\'-]{2,35}?)(?:\s+of\s+the|\.|,|;|$)', _snip)
                    if _m_club and "nba" not in _m_club.group(1).lower():
                        _bio["latestMove"] = f"Overseas: {_m_club.group(1).strip()}"
                    if not _bio.get("realgmUrl") and _title:
                        _bio["realgmUrl"] = "https://" + ".".join(["en", "wikipedia", "org"]) + "/wiki/" + _title.replace(" ", "_")
        except Exception:
            pass

        return (_lk, _bio if _bio else {"status": "not_found"})

    _uncached = [n for n in target_names if n.strip().lower() not in _cache][:max_live_lookups]
    if _uncached:
        with _TPE_OV(max_workers=8) as _ex:
            for _res in _ex.map(_lookup_one, _uncached):
                if _res:
                    _k_res, _v_res = _res
                    _cache[_k_res] = _v_res

    json.dump(_cache, open(_cache_fn, "w", encoding="utf-8"), indent=2)

    _by_name = {str(v.get("name", "")).strip().lower(): v for v in gl_pindex.values() if v.get("name")}
    _merged = 0
    for _nm in target_names:
        _info = _cache.get(_nm.strip().lower())
        if not _info or _info.get("status") == "not_found":
            continue
        _ent = _by_name.get(_nm.strip().lower())
        if not _ent:
            _synth_id = str(abs(hash(_nm.strip().lower())) % 8999999 + 1000000)
            _ent = gl_pindex.setdefault(_synth_id, {"id": int(_synth_id), "name": _nm})
        for _k in ("height", "weight", "age", "college", "yos", "realgmUrl", "latestMove", "overseasStats"):
            if _info.get(_k) is not None and not _ent.get(_k):
                _ent[_k] = _info[_k]
        _merged += 1
    print(f"  Overseas/Bio JSON sync: {_merged} profiles enriched ({len(_cache)} cached in data/realgm_cache.json).")

_rgm_targets = [w["player"] for w in gl_waived_pool if w.get("player")]
sync_realgm_overseas_players(list(dict.fromkeys(_rgm_targets)), gl_pindex, max_live_lookups=60)
json.dump(gl_pindex, open("data/gleague_player_index.json", "w", encoding="utf-8"), indent=2)

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
            low = norm_name(obj["name"])
            mxc_norm_set = {norm_name(k) for k, v in name_to_team.items() if v == 'MXC'}
            in_gl = norm_name(obj['name']) in mxc_norm_set
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