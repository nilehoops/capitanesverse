@echo off
cd /d "%~dp0"

echo 1/5 Pulling 2026-27 Capitanes (MXC) Play-by-Play Shot Charts...
py pipeline\build_shot_charts.py 2026-27
if errorlevel 1 goto :fail

echo 2/5 Pulling All 31 G League Teams Shot Charts, Defense ^& Last-5 Rotations...
py pipeline\build_league_lite_shots.py 2026-27
if errorlevel 1 goto :fail

timeout /t 3 /nobreak >nul
echo 3/5 Pulling 2026-27 League ^& Capitanes Lineups, Team Splits ^& Game Log...
py fetch_lineup_data.py 2026-27
if errorlevel 1 goto :fail

echo 4/5 Enriching All 31 Teams Lineups, Percentiles, Per-75 ^& Physicals...
py pipeline\enrich_team_profiles.py 2026-27
if errorlevel 1 goto :fail

echo 5/5 Syncing Live 31-Team Rosters ^& Released NBA Players...
py pipeline\fetch_transactions.py
if errorlevel 1 goto :fail

echo All 5 steps succeeded! Opening GitHub Desktop to commit and push...
start "" "%LOCALAPPDATA%\GitHubDesktop\GitHubDesktop.exe"
pause
exit /b 0

:fail
echo.
echo [ABORTED] One or more pipeline steps failed. Nothing will be pushed.
pause
exit /b 1
