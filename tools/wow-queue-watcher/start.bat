@echo off
rem Starter watcheren fra kildekoden. Luk vinduet (eller Ctrl+C) for at stoppe den.
rem Kraever Python 3.11+ og: py -3 -m pip install -r requirements.txt
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 watch.py %*) else (python watch.py %*)
pause
