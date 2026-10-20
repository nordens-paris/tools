@echo off
rem Som start.bat, men til WoW Forever BETAEN (vaelg 'WoW: Forever - Beta' i Battle.net).
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 watch.py --beta %*) else (python watch.py --beta %*)
pause
