@echo off
rem Stops the WoW Queue Watcher, also one running in the background without a window.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
pause

