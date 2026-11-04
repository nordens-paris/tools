# Stops a running WoW Queue Watcher, including one running without a window.
# First asks it nicely (so it can send its "stopped" push), then force-stops it if needed.
$ErrorActionPreference = "SilentlyContinue"
$watchers = { Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='WoWQueueWatcher.exe'" | Where-Object {
    ($_.Name -eq 'WoWQueueWatcher.exe' -or $_.CommandLine -like '*watch.py*') -and $_.CommandLine -notlike '* sim*' } }

if (-not (& $watchers)) { "Watcheren koerer ikke."; exit }

# The dashboard port of every config next to this script (8765 is the default).
$ports = @(8765)
Get-ChildItem -Path $PSScriptRoot -Filter 'config*.toml' | ForEach-Object {
    $m = Select-String -Path $_.FullName -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { $ports += [int]$m.Matches[0].Groups[1].Value }
}
foreach ($port in ($ports | Select-Object -Unique)) {
    try {
        Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/cmd" -Body quit -Headers @{ 'X-WQW' = '1' } -TimeoutSec 5 | Out-Null
        "Beder watcheren om at stoppe..."
    } catch { }
}

for ($i = 0; $i -lt 30 -and (& $watchers); $i++) { Start-Sleep 1 }

if ($left = & $watchers) {
    $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    "Watcheren blev tvunget til at stoppe."
} else {
    "Watcheren er stoppet."
}
