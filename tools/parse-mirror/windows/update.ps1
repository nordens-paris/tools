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
  # Ved siden af app-mappen: mapper kan kun flyttes inden for samme drev.
  $tmp = Join-Path $root "parse-mirror-update-$([guid]::NewGuid())"
  New-Item -ItemType Directory $tmp | Out-Null
  $zip = Join-Path $tmp $asset
  $url = ($release.assets | Where-Object name -eq $asset).browser_download_url
  Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
  Expand-Archive $zip (Join-Path $tmp 'x')
  $new = Get-ChildItem (Join-Path $tmp 'x') -Recurse -Directory -Filter app | Select-Object -First 1
  if (-not $new) { throw 'Pakken havde ingen app-mappe.' }

  # Kører Parse Mirror, er mappen låst: så stopper vi her, før noget er ændret.
  $old = "$app.old"
  if (Test-Path $old) { Remove-Item $old -Recurse -Force }
  try { Rename-Item $app $old } catch { throw 'Luk Parse Mirror-vinduet, og prøv igen.' }
  # Nøglen, pakkerne og de hentede logs flyttes med; start-filen installerer pakkerne igen, hvis de er ændret.
  $keeps = '.env', 'node_modules', '.cache'
  try {
    foreach ($keep in $keeps) {
      if (Test-Path (Join-Path $old $keep)) { Move-Item (Join-Path $old $keep) (Join-Path $new.FullName $keep) }
    }
    Move-Item $new.FullName $app
  } catch {
    # Tilbage til den gamle udgave.
    foreach ($keep in $keeps) {
      if (Test-Path (Join-Path $new.FullName $keep)) { Move-Item (Join-Path $new.FullName $keep) (Join-Path $old $keep) }
    }
    Rename-Item $old $app
    throw
  }
  Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
  # De to start-filer øverst kan også være ændret.
  Get-ChildItem $new.Parent.FullName -File -Filter *.bat | Copy-Item -Destination $root -Force
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Done "Opdateret til $($release.tag_name). Start Parse Mirror igen." 'Green'
} catch {
  if ($tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  Done "Opdateringen fejlede: $($_.Exception.Message)" 'Red'
  exit 1
}
