import difflib
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor

CACHE_FILE = "data/realgm_cache.json"
INDEX_FILE = "data/gleague_player_index.json"
ROSTER_FILE = "data/gleague_roster_2026-27.json"
PDF_POOL_FILE = "data/fa_pdf_pool.json"
PLAYERS_INDEX_FILE = "data/players_index.json"
PLAYERS_FULL_FILE = "data/players.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())

def clean_name(s):
    s = re.sub(r"^(?:G-Fs?|F-Gs?|F-Cs?|C-Fs?|PGs?|SGs?|SFs?|PFs?|Gs?|Fs?|Cs?)\s+", "", str(s or "").strip())
    return re.sub(r"\s+", " ", s).strip()

def load_json(path, default):
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8"))
        except Exception:
            pass
    return default

def collect_all_candidates():
    names = {}
    roster = load_json(ROSTER_FILE, {})
    for w in roster.get("glWaivedPool", []):
        nm = clean_name(w.get("player"))
        if nm: names[norm(nm)] = nm
    for fp in load_json(PDF_POOL_FILE, []):
        nm = clean_name(fp.get("name"))
        if nm: names[norm(nm)] = nm
    pidx = load_json(PLAYERS_INDEX_FILE, [])
    for p in (pidx if isinstance(pidx, list) else pidx.values()):
        if str(p.get("availabilitySimple", "")).strip().lower() == "yes":
            nm = clean_name(p.get("name"))
            if nm: names[norm(nm)] = nm
    return names

def fetch_espn_bio(nm):
    import requests
    bio = {}
    search_url = "https://" + ".".join(["site", "web", "api", "espn", "com"]) + "/apis/common/v3/search"
    try:
        r = requests.get(search_url, params={"query": nm, "type": "player", "sport": "basketball", "limit": 5}, headers=HEADERS, timeout=10)
        if not r.ok: return bio
        items = r.json().get("items") or []
        lk = norm(nm)
        hit = next((it for it in items if norm(it.get("displayName")) == lk), items if items else None)
        if not isinstance(hit, dict): return bio
        aid = str(hit.get("id") or "")
        lg = str(hit.get("league") or "").lower()
        paths = ["mens-college-basketball", "nba"] if ("college" in lg or "ncaam" in lg) else ["nba", "mens-college-basketball"]
        for sp in paths:
            if not aid: break
            au = "https://" + ".".join(["site", "web", "api", "espn", "com"]) + f"/apis/common/v3/sports/basketball/{sp}/athletes/{aid}"
            ra = requests.get(au, headers=HEADERS, timeout=10)
            if not ra.ok: continue
            ath = ra.json().get("athlete") or {}
            if ath.get("displayHeight") and not bio.get("height"):
                bio["height"] = re.sub(r"\s+", "", str(ath["displayHeight"]).replace("'", "-").replace('"', ""))
            if ath.get("displayWeight") and not bio.get("weight"):
                wm = re.search(r"(\d{2,3})", str(ath["displayWeight"]))
                if wm: bio["weight"] = int(wm.group(1))
            if ath.get("age") and not bio.get("age"):
                bio["age"] = float(ath["age"])
            elif ath.get("dateOfBirth") and not bio.get("age"):
                bd = str(ath["dateOfBirth"])[:10]
                if len(bd) >= 4 and bd[:4].isdigit():
                    mo = int(bd[5:7]) if len(bd) >= 7 and bd[5:7].isdigit() else 6
                    bio["age"] = round(2026.90 - int(bd[:4]) - (mo / 12.0), 1)
            col = ath.get("college") or {}
            if isinstance(col, dict) and col.get("name") and not bio.get("college"):
                bio["college"] = col["name"].strip()
            bp = ath.get("birthPlace") or {}
            if isinstance(bp, dict) and bp.get("country") and not bio.get("country"):
                bio["country"] = bp["country"].strip()
            exp = ath.get("experience") or {}
            if isinstance(exp, dict) and exp.get("years") is not None and bio.get("yos") is None:
                bio["yos"] = int(exp["years"])
            if sp == "nba":
                tm = ath.get("team") or {}
                if isinstance(tm, dict) and tm.get("displayName") and "free agent" not in tm["displayName"].lower():
                    bio["unavailable"] = True
                    bio["currentTeam"] = tm["displayName"].strip()
    except Exception:
        pass
    if not bio.get("college") and bio.get("country") and bio["country"] not in ("USA", "United States"):
        bio["college"] = bio["country"]
    return bio

def fetch_sportsref_bio(nm):
    import requests
    bio = {}
    search_url = "https://" + ".".join(["site", "web", "api", "espn", "com"]) + "/apis/common/v3/search"
    try:
        r = requests.get(search_url, params={"query": nm, "limit": 8}, headers=HEADERS, timeout=10)
        if not r.ok: return bio
        data = r.json()
        pool = list(data.get("items") or [])
        for grp in (data.get("results") or []):
            if isinstance(grp, dict):
                pool.extend(grp.get("contents") or [])
        lk = norm(nm)
        for it in pool:
            if not isinstance(it, dict): continue
            if norm(it.get("displayName") or it.get("title")) != lk: continue
            aid = str(it.get("id") or "")
            if not aid.isdigit(): continue
            for sp in ("mens-college-basketball", "nba"):
                au = "https://" + ".".join(["site", "web", "api", "espn", "com"]) + f"/apis/common/v3/sports/basketball/{sp}/athletes/{aid}"
                ra = requests.get(au, headers=HEADERS, timeout=10)
                if not ra.ok: continue
                ath = ra.json().get("athlete") or {}
                if ath.get("displayHeight") and not bio.get("height"):
                    bio["height"] = re.sub(r"\s+", "", str(ath["displayHeight"]).replace("'", "-").replace('"', ""))
                if ath.get("displayWeight") and not bio.get("weight"):
                    wm = re.search(r"(\d{2,3})", str(ath["displayWeight"]))
                    if wm: bio["weight"] = int(wm.group(1))
                if ath.get("age") and not bio.get("age"):
                    bio["age"] = float(ath["age"])
                elif ath.get("dateOfBirth") and not bio.get("age"):
                    bd = str(ath["dateOfBirth"])[:10]
                    if len(bd) >= 4 and bd[:4].isdigit():
                        mo = int(bd[5:7]) if len(bd) >= 7 and bd[5:7].isdigit() else 6
                        bio["age"] = round(2026.90 - int(bd[:4]) - (mo / 12.0), 1)
                col = ath.get("college") or {}
                if isinstance(col, dict) and col.get("name") and not bio.get("college"):
                    bio["college"] = col["name"].strip()
                bp = ath.get("birthPlace") or {}
                if isinstance(bp, dict) and bp.get("country") and bp["country"] not in ("USA", "United States") and not bio.get("college"):
                    bio["college"] = bp["country"].strip()
    except Exception:
        pass
    if not (bio.get("height") and bio.get("weight") and bio.get("age") and bio.get("college")):
        try:
            ddg_u = "https://" + ".".join(["html", "duckduckgo", "com"]) + "/html/"
            rd = requests.post(ddg_u, data={"q": f"site:espn.com {nm} basketball"}, headers=HEADERS, timeout=10)
            if rd.ok:
                m_id = re.search(r"espn\.com/(?:mens-college-basketball|nba)/player/_/id/(\d+)", rd.text)
                if m_id:
                    aid = m_id.group(1)
                    for sp in ("mens-college-basketball", "nba"):
                        au = "https://" + ".".join(["site", "web", "api", "espn", "com"]) + f"/apis/common/v3/sports/basketball/{sp}/athletes/{aid}"
                        ra = requests.get(au, headers=HEADERS, timeout=10)
                        if not ra.ok: continue
                        ath = ra.json().get("athlete") or {}
                        if ath.get("displayHeight") and not bio.get("height"):
                            bio["height"] = re.sub(r"\s+", "", str(ath["displayHeight"]).replace("'", "-").replace('"', ""))
                        if ath.get("displayWeight") and not bio.get("weight"):
                            wm = re.search(r"(\d{2,3})", str(ath["displayWeight"]))
                            if wm: bio["weight"] = int(wm.group(1))
                        if ath.get("age") and not bio.get("age"):
                            bio["age"] = float(ath["age"])
                        elif ath.get("dateOfBirth") and not bio.get("age"):
                            bd = str(ath["dateOfBirth"])[:10]
                            if len(bd) >= 4 and bd[:4].isdigit():
                                mo = int(bd[5:7]) if len(bd) >= 7 and bd[5:7].isdigit() else 6
                                bio["age"] = round(2026.90 - int(bd[:4]) - (mo / 12.0), 1)
                        col = ath.get("college") or {}
                        if isinstance(col, dict) and col.get("name") and not bio.get("college"):
                            bio["college"] = col["name"].strip()
                        bp = ath.get("birthPlace") or {}
                        if isinstance(bp, dict) and bp.get("country") and bp["country"] not in ("USA", "United States") and not bio.get("college"):
                            bio["college"] = bp["country"].strip()
                # Also parse height/weight directly from DuckDuckGo snippet if ESPN ID wasn't in top hit
                if not bio.get("height"):
                    hm_d = re.search(r"\b([567]-\d{1,2})\b", rd.text)
                    if hm_d: bio["height"] = hm_d.group(1)
                if not bio.get("weight"):
                    wm_d = re.search(r"\b([123]\d{2})\s*(?:lbs?|pounds)\b", rd.text, flags=re.I)
                    if wm_d: bio["weight"] = int(wm_d.group(1))
        except Exception:
            pass
    return bio

def fetch_wikidata_bio(nm):
    import requests
    bio = {}
    wiki_api = "https://" + ".".join(["en", "wikipedia", "org"]) + "/w/api.php"
    wd_api = "https://" + ".".join(["www", "wikidata", "org"]) + "/w/api.php"
    try:
        rw = requests.get(wiki_api, params={"action": "query", "list": "search", "srsearch": f'"{nm}" basketball', "format": "json", "srlimit": 2}, headers={"User-Agent": "CapitanesVerse/1.0"}, timeout=10)
        if not rw.ok: return bio
        hits = rw.json().get("query", {}).get("search") or []
        if not hits or not isinstance(hits, dict): return bio
        title = hits.get("title", "")
        if not title: return bio
        try:
            r_html = requests.get("https://" + ".".join(["en", "wikipedia", "org"]) + "/wiki/" + title.replace(" ", "_"), headers=HEADERS, timeout=10)
            if r_html.ok:
                whtml = r_html.text
                hm_ib = re.search(r"Listed height.*?(\d)\s*(?:ft|&nbsp;ft)\s*(\d{1,2})\s*(?:in|&nbsp;in)", whtml, flags=re.S | re.I)
                if hm_ib and not bio.get("height"):
                    bio["height"] = f"{hm_ib.group(1)}-{hm_ib.group(2)}"
                wm_ib = re.search(r'Listed weight.*?(\d{2,3})\s*(?:lb|&nbsp;lb)', whtml, flags=re.S | re.I)
                if wm_ib and not bio.get("weight"):
                    bio["weight"] = int(wm_ib.group(1))
                bm_ib = re.search(r'class="bday">(\d{4})-(\d{2})-(\d{2})<', whtml)
                if bm_ib and not bio.get("age"):
                    bio["age"] = round(2026.90 - int(bm_ib.group(1)) - (int(bm_ib.group(2)) / 12.0), 1)
                cm_ib = re.search(r'>College</th>.*?<a[^>]*>([^<]+)</a>', whtml, flags=re.S | re.I)
                if cm_ib and not bio.get("college"):
                    bio["college"] = re.sub(r'\s*\([^)]*\)', '', cm_ib.group(1)).strip()
        except Exception:
            pass
        rp = requests.get(wiki_api, params={"action": "query", "titles": title, "prop": "pageprops|extracts", "explaintext": 1, "format": "json"}, headers={"User-Agent": "CapitanesVerse/1.0"}, timeout=10)
        if not rp.ok: return bio
        pobj = next(iter((rp.json().get("query", {}).get("pages") or {}).values()), {})
        extract = str(pobj.get("extract") or "")
        qid = (pobj.get("pageprops") or {}).get("wikibase_item")
        cm = re.search(r"played college basketball for (?:the )?([A-Z][A-Za-z0-9 &.'-]+?)(?:\.|,| before| under| from| in\b)", extract)
        if cm: bio["college"] = cm.group(1).strip()
        m_act = re.search(r"\b(?:is an? [^\.]*?basketball player (?:who plays |currently )?for|currently plays for|plays for)\s+(?:the\s+)?([A-Z][A-Za-z0-9 &.'-]{2,42}?)(?:\s+of\s+the|\.|,|\(|$)", extract)
        if m_act:
            club = m_act.group(1).strip()
            if "free agent" not in club.lower() and "college" not in club.lower():
                bio["unavailable"] = True
                bio["currentTeam"] = club
        if qid:
            rwd = requests.get(wd_api, params={"action": "wbgetentities", "ids": qid, "props": "claims", "format": "json"}, headers={"User-Agent": "CapitanesVerse/1.0"}, timeout=10)
            if rwd.ok:
                claims = (rwd.json().get("entities", {}).get(qid, {}) or {}).get("claims") or {}
                if "P2048" in claims and isinstance(claims["P2048"], list) and claims["P2048"]:
                    dv = claims["P2048"].get("mainsnak", {}).get("datavalue", {}).get("value", {})
                    amt, unit = float(dv.get("amount", 0)), str(dv.get("unit", ""))
                    inches = amt * 39.3701 if "Q11573" in unit else (amt * 0.393701 if "Q174728" in unit else (amt * 12 if "Q3710" in unit else amt))
                    if 65 <= inches <= 92:
                        bio["height"] = f"{int(round(inches)) // 12}-{int(round(inches)) % 12}"
                if "P2067" in claims and isinstance(claims["P2067"], list) and claims["P2067"]:
                    dv = claims["P2067"].get("mainsnak", {}).get("datavalue", {}).get("value", {})
                    amt, unit = float(dv.get("amount", 0)), str(dv.get("unit", ""))
                    lbs = amt * 2.20462 if "Q11570" in unit else amt
                    if 130 <= lbs <= 360: bio["weight"] = round(lbs)
                if "P569" in claims and isinstance(claims["P569"], list) and claims["P569"]:
                    tm = claims["P569"].get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("time", "")
                    bm = re.search(r"(\d{4})-(\d{2})", tm)
                    if bm: bio["age"] = round(2026.90 - int(bm.group(1)) - (int(bm.group(2)) / 12.0), 1)
                if "P54" in claims and isinstance(claims["P54"], list):
                    for cl in claims["P54"]:
                        if "P582" not in (cl.get("qualifiers") or {}):
                            if (cl.get("mainsnak", {}).get("datavalue", {}).get("value", {}) or {}).get("id"):
                                bio["unavailable"] = True
    except Exception:
        pass
    return bio

def enrich_player(nm, existing):
    merged = dict(existing or {})
    if merged.get("height"):
        merged["height"] = re.sub(r"\s+", "", str(merged["height"]))
    for fetcher in (fetch_espn_bio, fetch_sportsref_bio, fetch_wikidata_bio):
        if merged.get("height") and merged.get("weight") and merged.get("age") and merged.get("college") and merged.get("unavailable"):
            break
        for k, v in fetcher(nm).items():
            if v is not None and not merged.get(k):
                merged[k] = v
    return merged

def main():
    gl_pindex = load_json(INDEX_FILE, {})
    cache = load_json(CACHE_FILE, {})
    all_names = collect_all_candidates()
    by_norm = {norm(ent["name"]): ent for ent in gl_pindex.values() if ent.get("name")}

    pfull = load_json(PLAYERS_FULL_FILE, [])
    for p in (pfull if isinstance(pfull, list) else pfull.values()):
        k = norm(p.get("name"))
        if k in by_norm:
            ent = by_norm[k]
            if not ent.get("height") and (p.get("heightDisplay") or p.get("heightIn")):
                ent["height"] = p.get("heightDisplay") or p.get("heightIn")
            bio = p.get("biography") or {}
            if not ent.get("weight") and bio.get("weight"): ent["weight"] = bio["weight"]
            if not ent.get("age") and bio.get("age"): ent["age"] = bio["age"]
            if not ent.get("college") and p.get("team") and p.get("team") != "N/A": ent["college"] = p["team"]

    known_keys = list(by_norm.keys())
    for k, nm in all_names.items():
        if k not in by_norm:
            close = difflib.get_close_matches(k, known_keys, n=1, cutoff=0.88)
            if close:
                src_ent = by_norm[close]
                synth_id = str(abs(hash(k)) % 8999999 + 1000000)
                clone = dict(src_ent)
                clone["id"] = int(synth_id)
                clone["name"] = nm
                gl_pindex[synth_id] = clone
                by_norm[k] = clone

    missing_targets = [(k, nm, by_norm.get(k) or {}) for k, nm in all_names.items()
                       if not ((by_norm.get(k) or {}).get("height") and (by_norm.get(k) or {}).get("weight")
                               and (by_norm.get(k) or {}).get("age") and (by_norm.get(k) or {}).get("college"))
                       ]
    print(f"Total unique candidates: {len(all_names)} | Sweeping {len(missing_targets)} candidates for bios & overseas contracts...")

    updated_count = 0
    unavail_count = 0
    def _work(it):
        k, nm, ent = it
        return (k, nm, enrich_player(nm, ent))
    with ThreadPoolExecutor(max_workers=8) as ex:
        for k, nm, res in ex.map(_work, missing_targets):
            res.setdefault("unavailable", False)
            cache[nm.strip().lower()] = res
            ent = by_norm.get(k)
            if not ent:
                synth_id = str(abs(hash(k)) % 8999999 + 1000000)
                ent = gl_pindex.setdefault(synth_id, {"id": int(synth_id), "name": nm})
                by_norm[k] = ent
            changed = False
            for fld in ("height", "weight", "age", "college", "unavailable", "currentTeam"):
                if res.get(fld) is not None and not ent.get(fld):
                    ent[fld] = res[fld]
                    changed = True
            if ent.get("unavailable"):
                unavail_count += 1
            if changed:
                updated_count += 1

    json.dump(cache, open(CACHE_FILE, "w", encoding="utf-8"), indent=2)
    best_by_k = {}
    for ent in gl_pindex.values():
        k = norm(ent.get("name"))
        if not k: continue
        cur = best_by_k.setdefault(k, {})
        for fld in ("height", "weight", "age", "college", "unavailable", "currentTeam"):
            if ent.get(fld) is not None and not cur.get(fld):
                cur[fld] = ent[fld]
    for ent in gl_pindex.values():
        k = norm(ent.get("name"))
        if k in best_by_k:
            for fld, val in best_by_k[k].items():
                if val is not None and not ent.get(fld):
                    ent[fld] = val
    json.dump(gl_pindex, open(INDEX_FILE, "w", encoding="utf-8"), indent=2)
    print(f"Sweep complete! Enriched {updated_count} players | Flagged {unavail_count} signed overseas / active NBA players.")

if __name__ == "__main__":
    main()
