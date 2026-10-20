@echo off
rem Starter watcheren paa standby - intet starter foer du sender 'start' fra telefonen.
cd /d "%~dp0"
WoWQueueWatcher.exe --standby %*
pause

