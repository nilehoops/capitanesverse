import os, subprocess, sys, time
for _k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_k] = "1"


STEPS = [
    ("1. Lineups, Box Scores, Splits & WOWY (2026-27)", [sys.executable, "fetch_lineup_data.py"]),
    ("2. 31-Team Shot Charts & Zones (2026-27)", [sys.executable, "pipeline/build_league_lite_shots.py", "2026-27"]),
    ("3. 31-Team Profiles, OREB/DREB & Lineups (2026-27)", [sys.executable, "pipeline/enrich_team_profiles.py"]),
    ("4. Quarter Baselines & Shot-Clock Metrics", [sys.executable, "pipeline/build_qtr_baselines.py"]),
    ("5. Transactions & Active Roster Sync", [sys.executable, "pipeline/fetch_transactions.py"]),
    ("5b. Sync G League Career Stints Across Database", [sys.executable, "pipeline/sync_gleague_careers.py"]),
    ("6. Preserve MXC Yellow Roster Outlines", [sys.executable, "pipeline/fix_mxc_onroster.py"]),
]

t0 = time.time()
for label, cmd in STEPS:
    print(f"\n=== {label} ===")
    s_t = time.time()
    res = subprocess.run(cmd)
    status = "OK" if res.returncode == 0 else f"WARN (exit {res.returncode})"
    print(f"--- {status} in {time.time() - s_t:.1f}s ---")

print(f"\nALL PIPELINE COMPONENTS FINISHED IN {time.time() - t0:.1f}s!")
