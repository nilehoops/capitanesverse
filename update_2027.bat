@echo off
cd /d "%~dp0"
echo Pulling latest 2026-27 Capitanes Shot Charts and Play by Play...
py pipeline\build_shot_charts.py 2026-27
echo Done! Opening GitHub Desktop to commit and push...
start "" "%LOCALAPPDATA%\GitHubDesktop\GitHubDesktop.exe"
pause
