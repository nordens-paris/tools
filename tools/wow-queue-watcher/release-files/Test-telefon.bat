@echo off
rem Sender en test-besked og en test-alarm til din telefon.
cd /d "%~dp0"
WoWQueueWatcher.exe test-notify --alarm
pause

