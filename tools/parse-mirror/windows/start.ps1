# Starter Parse Mirror på denne pc (kaldes af "Start Parse Mirror.bat" i pakken fra
# scripts/package-windows.mjs). Første gang: installerer Node.js hvis det mangler, spørger efter
# Warcraft Logs-nøglen, installerer og bygger. Derefter starter den bare serveren og åbner siden.
# Nøglen gemmes også i %APPDATA%\ParseMirror, så den overlever en opdatering.
$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
Set-Location $app
$saved = Join-Path $env:APPDATA 'ParseMirror\.env'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail($text) {
  Say ''
  Say $text 'Red'
  Say ''
  Read-Host 'Tryk Enter for at lukke'
  exit 1
}
function NodeVersion {
  try { return [version]((& node -v) -replace '^v', '') } catch { return $null }
}
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

Say 'Parse Mirror' 'Cyan'
Say ''

# 1. Node.js 22.9 eller nyere.
$need = [version]'22.9.0'
$node = NodeVersion
if (-not $node -or $node -lt $need) {
  Say "Parse Mirror skal bruge Node.js (gratis). $(if ($node) { "Du har version $node, som er for gammel." } else { 'Det er ikke installeret.' })" 'Yellow'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $ok = Read-Host 'Skal det installeres nu? Windows spørger måske om lov. (J/n)'
    if ($ok -match '^[nN]') { Fail 'Installer Node.js (LTS) fra https://nodejs.org og start igen.' }
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    RefreshPath
    $node = NodeVersion
  }
  if (-not $node -or $node -lt $need) {
    Start-Process 'https://nodejs.org'
    Fail 'Installer Node.js (knappen "LTS") fra siden, der lige blev åbnet, og start Parse Mirror igen.'
  }
  Say "Node.js $node er installeret." 'Green'
}

# 2. Warcraft Logs-nøglen: fra en tidligere installation, eller spørg.
if (-not (Test-Path '.env') -and (Test-Path $saved)) { Copy-Item $saved '.env' }
if (-not (Test-Path '.env')) {
  Say ''
  Say 'Parse Mirror henter logs med din egen Warcraft Logs-nøgle.' 'Yellow'
  Say 'Siden åbnes nu: rul ned til "Web API", skriv et navn (f.eks. Parse Mirror) under'
  Say '"V1 Client Name", tryk Save, og kopier "V1 Client Key".'
  Start-Process 'https://fresh.warcraftlogs.com/profile'
  do {
    $key = (Read-Host 'Indsæt nøglen her (højreklik indsætter) og tryk Enter').Trim()
    $valid = $key -match '^[A-Za-z0-9]{32}$'
    if (-not $valid) { Say 'Det ligner ikke en nøgle (32 bogstaver og tal). Prøv igen.' 'Red' }
  } until ($valid)
  $sims = if (Test-Path 'bin\wowsimcli.exe') { "SIM_MODE=cli`nWOWSIMS_CLI=bin/wowsimcli.exe" } else { 'SIM_MODE=browser' }
  $envText = "WCL_API_KEY=$key`nGAME=tbc-anniversary`n$sims`nAPI_PORT=5174`n"
  Set-Content '.env' $envText -NoNewline -Encoding ascii
  New-Item -ItemType Directory -Force (Split-Path $saved) | Out-Null
  Set-Content $saved $envText -NoNewline -Encoding ascii
  Say 'Nøglen er gemt på denne pc.' 'Green'
}

$port = if ((Get-Content '.env' -Raw) -match '(?m)^API_PORT=(\d+)') { [int]$Matches[1] } else { 5174 }

# 3. Pakker: første gang, og når en opdatering har ændret dem.
$lock = 'node_modules\.package-lock.json'
if (-not (Test-Path $lock) -or (Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item $lock).LastWriteTime) {
  Say ''
  Say 'Installerer (første gang tager det et par minutter)...' 'Yellow'
  & npm ci --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { Fail 'Installationen fejlede. Tjek internetforbindelsen og prøv igen.' }
}

# 4. Hjemmesiden: bygges første gang og efter en opdatering.
$built = 'dist\index.html'
$newest = Get-ChildItem 'web', 'shared' -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $built) -or $newest.LastWriteTime -gt (Get-Item $built).LastWriteTime) {
  Say ''
  Say 'Bygger siden...' 'Yellow'
  & npx vite build --logLevel error
  if ($LASTEXITCODE -ne 0) { Fail 'Siden kunne ikke bygges.' }
}

# 5. Start, og åbn siden, når serveren svarer.
$url = "http://localhost:$port"
Say ''
Say "Parse Mirror kører på $url" 'Green'
Say 'Lad dette vindue være åbent, mens du bruger det. Luk vinduet for at stoppe.' 'Green'
Say ''
if (-not $env:PM_NO_BROWSER) { Start-Job -ArgumentList $url {
  param($url)
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest "$url/api/config" -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $url; return } catch { Start-Sleep -Seconds 1 }
  }
} | Out-Null }
& npm start --silent
if ($LASTEXITCODE -ne 0) { Fail "Parse Mirror stoppede. Kører den allerede i et andet vindue? Så åbn bare $url." }
