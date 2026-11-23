import io, urllib.request
from curl_cffi import requests as cffi_requests
from nba_api.stats.library.http import NBAStatsHTTP

_SESSION = cffi_requests.Session(impersonate="chrome")
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}
_SESSION.headers.update(_HEADERS)

# Patch nba_api HTTP session to use Chrome TLS impersonation
NBAStatsHTTP._session = _SESSION
NBAStatsHTTP.get_session = classmethod(lambda cls: _SESSION)

# Patch urllib.request.urlopen for stats.nba.com calls in fetch_lineup_data.py
_orig_urlopen = urllib.request.urlopen
class _CffiResp:
    def __init__(self, r):
        self._buf = io.BytesIO(r.content)
        self.status = r.status_code
        self.headers = r.headers
    def read(self, n=-1): return self._buf.read(n)
    def __enter__(self): return self
    def __exit__(self, *a): pass

def _chrome_urlopen(req, data=None, timeout=20, *a, **kw):
    url = req.full_url if hasattr(req, "full_url") else str(req)
    if "stats.nba.com" in url:
        hdrs = dict(_HEADERS)
        if hasattr(req, "header_items"):
            hdrs.update({k: v for k, v in req.header_items()})
        r = _SESSION.get(url, headers=hdrs, timeout=timeout)
        r.raise_for_status()
        return _CffiResp(r)
    return _orig_urlopen(req, data=data, timeout=timeout, *a, **kw)

urllib.request.urlopen = _chrome_urlopen
