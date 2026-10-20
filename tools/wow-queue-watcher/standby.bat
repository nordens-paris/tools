@echo off
rem Starter watcheren paa standby - intet starter foer du sender 'start' fra telefonen.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 watch.py --standby %*) else (python watch.py --standby %*)
pause
