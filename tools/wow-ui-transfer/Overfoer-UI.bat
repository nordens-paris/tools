@echo off
if not exist "%~dp0Overfoer-UI.ps1" (
  echo.
  echo Overfoer-UI.ps1 blev ikke fundet.
  echo Pak hele zip-filen ud foerst: hojreklik paa zip-filen og vaelg "Udpak alle".
  echo.
  pause
  exit /b 1
)
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0Overfoer-UI.ps1" %*
