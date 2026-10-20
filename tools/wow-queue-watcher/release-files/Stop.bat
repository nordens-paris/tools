@echo off
rem Stopper watcheren (ogsaa hvis den koerer uden vindue).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
pause

