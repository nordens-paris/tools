@echo off
rem Som Start.bat, men til WoW Forever BETAEN (vaelg 'WoW: Forever - Beta' i Battle.net).
cd /d "%~dp0"
WoWQueueWatcher.exe --beta %*
pause

