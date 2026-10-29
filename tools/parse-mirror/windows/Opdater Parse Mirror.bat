@echo off
title Opdater Parse Mirror
rem Koeres som kopi fra TEMP, fordi app-mappen bliver skiftet ud.
copy /y "%~dp0app\windows\update.ps1" "%TEMP%\parse-mirror-update.ps1" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\parse-mirror-update.ps1" "%~dp0app"
