# Bygger WoWQueueWatcher.exe og den zip-fil, der lægges på en GitHub Release.
#   py -3 -m pip install -r requirements.txt pyinstaller
#   pwsh -File build-release.ps1 -Version 1.1
# Brug PowerShell 7 (pwsh). Windows PowerShell 5 laver zip-filer med \ i stierne.
# Resultatet havner i dist\ (som git ignorerer).
param([string]$Version = "dev")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$py, $pyArgs = if (Get-Command py -ErrorAction SilentlyContinue) { "py", @("-3") } else { "python", @() }
& $py @pyArgs -m PyInstaller --noconfirm --onefile --console --name WoWQueueWatcher `
    --icon (Join-Path $PSScriptRoot "assets\icon.ico") --collect-all winocr --collect-all winrt --hidden-import winrt.windows.foundation `
    --workpath build --specpath build --distpath build\exe watch.py
if ($LASTEXITCODE) { throw "PyInstaller fejlede" }

# Pakken: exe + bat-filer + en frisk config (tomt ntfy-emne, auto-klik slået fra) + vejledning
$name = "WoW-Queue-Watcher"
$pkg = Join-Path "dist" $name
Remove-Item $pkg -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $pkg | Out-Null
Copy-Item build\exe\WoWQueueWatcher.exe, stop.ps1, docs\Vejledning.html $pkg
Copy-Item release-files\*.bat $pkg
Copy-Item config.example.toml (Join-Path $pkg "config.toml")

$zip = Join-Path "dist" "$name-v$Version.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $pkg -DestinationPath $zip
"Faerdig: $zip"
