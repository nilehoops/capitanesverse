import json
from nba_api.stats.endpoints import leaguedashteamstats

ff = leaguedashteamstats.LeagueDashTeamStats(
    league_id_nullable="20",
    season="2025-26",
    measure_type_detailed_defense="Four Factors",
).get_data_frames().pop(0)
lg_tov_pct = float(ff["TM_TOV_PCT"].mean()) * 100

d = json.load(open("data/shot_charts_2025-26.json", encoding="utf-8"))
tovs = d.get("turnovers", [])
mxc_t = [t for t in tovs if t["side"] == "off"]
opp_t = [t for t in tovs if t["side"] == "def"]

def breakdown(lst):
    p = sum(1 for t in lst if "bad pass" in t["sub"].lower())
    s = len(lst) - p
    return p, s, (p / len(lst) * 100 if lst else 0), (s / len(lst) * 100 if lst else 0)

mp, ms, mpp, msp = breakdown(mxc_t)
op, os_, opp_p, opp_s = breakdown(opp_t)
ap, as_, all_p, all_s = breakdown(tovs)

print(f"Official 31-Team G League TM_TOV_PCT: {lg_tov_pct:.2f}%")
print(f"MXC Turnovers ({len(mxc_t)}): Pass={mp} ({mpp:.1f}%), Scoring={ms} ({msp:.1f}%)")
print(f"OPP Turnovers ({len(opp_t)}): Pass={op} ({opp_p:.1f}%), Scoring={os_} ({opp_s:.1f}%)")
print(f"Combined PBP ({len(tovs)}):  Pass={ap} ({all_p:.1f}%), Scoring={as_} ({all_s:.1f}%)")
