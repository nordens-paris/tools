# Opdaterer Parse Mirror til den nyeste udgave (kaldes af "Opdater Parse Mirror.bat"): henter
# parse-mirror-windows.zip fra den nyeste parse-mirror-release i nordens-paris/tools og skifter
# app-mappen ud. Nøglen (.env) og de installerede pakker (node_modules) flyttes med over.
# .bat-filen kører en kopi af denne fil fra %TEMP%, fordi app-mappen bliver skiftet ud.
param([Parameter(Mandatory)][string]$app)
$ErrorActionPreference = 'Stop'
$app = (Resolve-Path $app).Path
$root = Split-Path -Parent $app
Set-Location $root
$repo = 'nordens-paris/tools'
$asset = 'parse-mirror-windows.zip'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Done($text, $color) {
  Say ''
  Say $text $color
  Say ''
  Read-Host 'Tryk Enter for at lukke'
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Say 'Leder efter en ny udgave af Parse Mirror...' 'Cyan'
  $releases = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=30" -UseBasicParsing
  $release = $releases | Where-Object { $_.tag_name -like 'parse-mirror-*' -and ($_.assets | Where-Object name -eq $asset) } | Select-Object -First 1
  if (-not $release) { Done 'Fandt ingen udgave at hente.' 'Red'; exit 1 }
  $current = if (Test-Path (Join-Path $app 'VERSION')) { (Get-Content (Join-Path $app 'VERSION') -Raw).Trim() } else { '' }
  if ($current -eq $release.tag_name) { Done "Du har allerede den nyeste udgave ($current)." 'Green'; exit 0 }

  Say "Henter $($release.tag_name)..."
  $tmp = Join-Path $env:TEMP "parse-mirror-update-$([guid]::NewGuid())"
  New-Item -ItemType Directory $tmp | Out-Null
  $zip = Join-Path $tmp $asset
  $url = ($release.assets | Where-Object name -eq $asset).browser_download_url
  Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
  Expand-Archive $zip (Join-Path $tmp 'x')
  $new = Get-ChildItem (Join-Path $tmp 'x') -Recurse -Directory -Filter app | Select-Object -First 1
  if (-not $new) { throw 'Pakken havde ingen app-mappe.' }

  # Nøglen og pakkerne flyttes med; start-filen installerer pakkerne igen, hvis de er ændret.
  foreach ($keep in '.env', 'node_modules') {
    if (Test-Path (Join-Path $app $keep)) { Move-Item (Join-Path $app $keep) (Join-Path $new.FullName $keep) }
  }
  Remove-Item $app -Recurse -Force
  Move-Item $new.FullName $app
  # De to start-filer øverst kan også være ændret.
  Get-ChildItem $new.Parent.FullName -File -Filter *.bat | Copy-Item -Destination $root -Force
  Remove-Item $tmp -Recurse -Force
  Done "Opdateret til $($release.tag_name). Start Parse Mirror igen." 'Green'
} catch {
  Done "Opdateringen fejlede: $($_.Exception.Message)" 'Red'
  exit 1
}
