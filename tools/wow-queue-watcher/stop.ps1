# Stops a running WoW Queue Watcher, including one running without a window.
# First asks it nicely (so it can send its "stopped" push), then force-stops it if needed.
$ErrorActionPreference = "SilentlyContinue"
$watchers = { Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='WoWQueueWatcher.exe'" | Where-Object {
    ($_.Name -eq 'WoWQueueWatcher.exe' -or $_.CommandLine -like '*watch.py*') -and $_.CommandLine -notlike '* sim*' } }

if (-not (& $watchers)) { "Watcheren koerer ikke."; exit }

try {
    Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/api/cmd -Body quit -TimeoutSec 5 | Out-Null
    "Beder watcheren om at stoppe..."
} catch { }

for ($i = 0; $i -lt 30 -and (& $watchers); $i++) { Start-Sleep 1 }

if ($left = & $watchers) {
    $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    "Watcheren blev tvunget til at stoppe."
} else {
    "Watcheren er stoppet."
}
