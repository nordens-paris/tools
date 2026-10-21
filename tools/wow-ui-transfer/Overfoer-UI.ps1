<#
  Overfoer-UI.ps1  -  WoW Forever UI-overførsel

  Flytter dit UI (addons, addon-profiler, keybinds, macros, Edit Mode, indstillinger, chat) fra
  Beta/Stresstest til din nye character på launch. Det sker i to faser:

  Fase 1  -  før launch, med spillet LUKKET
    Addons (Interface), grafik og lyd (Config.wtf) og alt på kontoniveau: Edit Mode-layouts,
    keybinds, macros, interface-indstillinger og addon-indstillinger. Spillet indlæser de filer,
    allerede når du logger ind, så de skal ligge klar, før du starter spillet.
    Du skriver dit kontonavn (fx C00LPET), så scriptet ved, hvor filerne skal hen.

  Fase 2  -  på launch, på character select (spillet må gerne køre, du mister ikke din plads)
    1. Opret din character. Tryk IKKE "Enter World".
    2. Dobbeltklik på Overfoer-UI.bat og vælg Fase 2.
    3. Vælg din gamle og din nye character, og tryk "Overfør UI".
    4. Tryk Enter World.
    Titan Panel, X-Perl og AtlasLoot gemmer under realm-navnet, som først står i filerne efter første
    Enter World. Skriv det fra character select, eller: skriv /logout i spillet (ingen kø), kør
    fase 2 igen (realmen findes nu automatisk), og tryk Enter World.

  Spillet synkroniserer konto-indstillinger med serveren. I Logs\AccountData.log kan man se, at det
  bruger filen på disken, når tidspunktet i cache.md5 er det samme som serverens, og ellers henter
  serverens version. Derfor får de kopierede filer serverens tidspunkt (se Update-CacheTimes).

  Sikkerhed:
    - Scriptet sletter og flytter aldrig noget. Det kopierer kun.
    - Hver fil der bliver overskrevet, kopieres først til <WoW-mappe>\UI-backup-<dato-tid>\
    - Kildemappen (fx _classic_beta_) bliver kun læst.
    - En log over alt der blev gjort, gemmes i backup-mappen.

  Uden vindue (konsol):  Overfoer-UI.bat -NoGui
#>
[CmdletBinding()]
param(
    [string]$WowRoot,
    [ValidateSet('', '1', '2')][string]$Phase = '',
    [string]$SourceFlavor,
    [string]$TargetFlavor,
    [string]$SourceChar,
    [string]$TargetChar,
    [string]$TargetAccount,
    [string]$SourceRealm,
    [string]$TargetRealm,
    [ValidateSet('ask', 'yes', 'no')][string]$CopyInterface = 'ask',
    [switch]$DisableSync,
    [switch]$NoGui,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$AppTitle = 'WoW Forever - UI-overførsel'

# =====================================================================================
#  KERNE: finder mapper og udfører overførslen. Bruges af både vinduet og konsollen.
# =====================================================================================

$FlavorNames = @{
    '_forever_'         = 'WoW Forever'
    '_forever_ptr_'     = 'WoW Forever PTR'
    '_classic_beta_'    = 'Beta'
    '_classic_ptr_'     = 'Classic PTR'
    '_classic_'         = 'Classic'
    '_classic_era_'     = 'Classic Era'
    '_classic_era_ptr_' = 'Classic Era PTR'
    '_anniversary_'     = 'Anniversary'
    '_retail_'          = 'Retail'
    '_ptr_'             = 'Retail PTR'
    '_beta_'            = 'Retail Beta'
}

function Get-FlavorLabel([string]$Flavor) {
    if ($FlavorNames.ContainsKey($Flavor)) { return "$($FlavorNames[$Flavor])  ($Flavor)" }
    return $Flavor
}

function Find-WowRoot {
    $keys = @(
        'HKLM:\SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft',
        'HKLM:\SOFTWARE\Blizzard Entertainment\World of Warcraft'
    )
    foreach ($k in $keys) {
        try {
            $p = (Get-ItemProperty -Path $k -ErrorAction Stop).InstallPath
            if ($p) {
                $p = $p.TrimEnd('\', '/')
                if ((Split-Path $p -Leaf) -like '_*_') { $p = Split-Path $p -Parent }
                if (Test-Path -LiteralPath $p) { return $p }
            }
        } catch { }
    }
    foreach ($p in @('C:\Program Files (x86)\World of Warcraft', 'C:\Program Files\World of Warcraft',
                     'D:\World of Warcraft', 'D:\Games\World of Warcraft', 'E:\World of Warcraft')) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

function Test-WowRunning {
    return (@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^Wow' }).Count -gt 0)
}

# Addons bliver kun fundet, når spillet starter.
function Test-HasAddons([string]$Root, [string]$Flavor) {
    if (-not $Root -or -not $Flavor) { return $false }
    $addonDir = Join-Path $Root "$Flavor\Interface\AddOns"
    return ((Test-Path -LiteralPath $addonDir) -and (@(Get-ChildItem -LiteralPath $addonDir -Directory).Count -gt 0))
}

# Alle spilmapper (_forever_, _classic_beta_ ...). -WithAccounts: kun dem der har et WTF\Account.
function Get-Flavors([string]$Root, [switch]$WithAccounts) {
    if (-not $Root -or -not (Test-Path -LiteralPath $Root)) { return @() }
    $all = @(Get-ChildItem -LiteralPath $Root -Directory | Where-Object { $_.Name -like '_*_' } | ForEach-Object { $_.Name })
    if ($WithAccounts) {
        $all = @($all | Where-Object { Test-Path -LiteralPath (Join-Path $Root "$_\WTF\Account") })
    }
    return $all
}

# Kontomapper i en spilmappe, senest brugt først.
function Get-Accounts([string]$Root, [string]$Flavor) {
    $accRoot = Join-Path $Root "$Flavor\WTF\Account"
    if (-not (Test-Path -LiteralPath $accRoot)) { return @() }
    return @(Get-ChildItem -LiteralPath $accRoot -Directory | Where-Object { $_.Name -ne 'SavedVariables' } |
        Sort-Object LastWriteTime -Descending | ForEach-Object { $_.Name })
}

# Mål for fase 1: en kontomappe, som måske ikke findes endnu.
function Get-TargetAccount([string]$Root, [string]$Flavor, [string]$Name) {
    $Name = $Name.Trim().ToUpperInvariant()
    $path = Join-Path $Root "$Flavor\WTF\Account\$Name"
    # HasCache: uden cache.md5 kendes serverens tidspunkter ikke (se Update-CacheTimes)
    return [pscustomobject]@{
        Flavor = $Flavor; Account = $Name; AccPath = $path; Exists = (Test-Path -LiteralPath $path)
        HasCache = (Test-Path -LiteralPath (Join-Path $path 'cache.md5'))
    }
}

# Alle characters i en spilmappe: WTF\Account\<konto>\<realm>\<Fornavn-Efternavn>
function Get-Characters([string]$Root, [string]$Flavor) {
    $accRoot = Join-Path $Root "$Flavor\WTF\Account"
    $list = @()
    if (-not (Test-Path -LiteralPath $accRoot)) { return $list }
    $accounts = @(Get-ChildItem -LiteralPath $accRoot -Directory | Where-Object { $_.Name -ne 'SavedVariables' })
    foreach ($a in $accounts) {
        foreach ($r in Get-ChildItem -LiteralPath $a.FullName -Directory | Where-Object { $_.Name -ne 'SavedVariables' }) {
            foreach ($c in Get-ChildItem -LiteralPath $r.FullName -Directory) {
                $label = "$($c.Name)   ·   realm $($r.Name)"
                if ($accounts.Count -gt 1) { $label += "   ·   konto $($a.Name)" }
                $list += [pscustomobject]@{
                    Flavor   = $Flavor
                    Account  = $a.Name
                    Realm    = $r.Name
                    Char     = $c.Name
                    Path     = $c.FullName
                    AccPath  = $a.FullName
                    Created  = $c.CreationTime
                    Modified = $c.LastWriteTime
                    Label    = $label
                }
            }
        }
    }
    return $list
}

# "Darkfade-Speedy" -> Full "Darkfade Speedy", First "Darkfade" (det navn spillet selv bruger i mange addons)
function Get-CharNames([string]$Char) {
    return @{ Full = ($Char -replace '-', ' '); First = ($Char -split '-')[0] }
}

# WTF-mapperne bruger realm-numre (fx 70), men addons gemmer under realm-navnet.
# Find navnet i addon-filerne: Titan bruger "Fornavn Efternavn@Realm", ellers "Fornavn - Realm".
$RealmCache = @{}
#   -ExactOnly: kun det sikre "Fornavn Efternavn@Realm". Fornavnet alene kan deles af flere characters
#   (fx Darkfade Speedy og Darkfade Wastaken på hver sin realm), så det bruges ikke til den nye character.
function Find-RealmName([string]$AccPath, [string]$Char, [switch]$ExactOnly) {
    $svDir = Join-Path $AccPath 'SavedVariables'
    if (-not $Char -or -not (Test-Path -LiteralPath $svDir)) { return '' }
    $cacheKey = "$AccPath|$Char|$ExactOnly"
    if (-not $RealmCache.ContainsKey($cacheKey)) { $RealmCache[$cacheKey] = Find-RealmNameUncached $svDir $Char $ExactOnly.IsPresent }
    return $RealmCache[$cacheKey]
}
function Find-RealmNameUncached([string]$svDir, [string]$Char, [bool]$ExactOnly) {
    $n = Get-CharNames $Char
    $counts = @{}
    foreach ($file in Get-ChildItem -LiteralPath $svDir -Filter '*.lua' -File) {
        $text = [IO.File]::ReadAllText($file.FullName, $Utf8NoBom)
        $m = [regex]::Match($text, '\["' + [regex]::Escape($n.Full) + '@([^"\\]+)"\]')
        if ($m.Success) { return $m.Groups[1].Value }
        if ($ExactOnly) { continue }
        foreach ($m in [regex]::Matches($text, '\["' + [regex]::Escape($n.First) + ' - ([^"\\]+)"\]')) {
            $counts[$m.Groups[1].Value] = 1 + [int]$counts[$m.Groups[1].Value]
        }
    }
    if ($counts.Count -gt 0) { return ($counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key }
    return ''
}

# Alle realm-navne der optræder i addon-filerne som "Navn - Realm" eller "Navn@Realm".
function Get-RealmSet([string]$AccPath) {
    $cacheKey = "set|$AccPath"
    if ($RealmCache.ContainsKey($cacheKey)) { return $RealmCache[$cacheKey] }
    $set = @{}
    $svDir = Join-Path $AccPath 'SavedVariables'
    if (Test-Path -LiteralPath $svDir) {
        foreach ($file in Get-ChildItem -LiteralPath $svDir -Filter '*.lua' -File) {
            $text = [IO.File]::ReadAllText($file.FullName, $Utf8NoBom)
            foreach ($m in [regex]::Matches($text, '\["[^"\\\r\n]+(?: - |@)([^"\\\r\n]+)"\]')) { $set[$m.Groups[1].Value] = $true }
        }
    }
    $RealmCache[$cacheKey] = $set
    return $set
}

# Den nye characters realm. Først efter første Enter World står den i addon-filerne, så det virker,
# når man har logget ud til character select og kører fase 2 igen.
#   1. Titan Panel: "Fornavn Efternavn@Realm" (sikkert)
#   2. "Fornavn - Realm" (AtlasLoot m.fl.), men kun realms der ikke også findes i kildens filer,
#      for fornavnet kan deles med gamle characters (fx Darkfade Speedy og Darkfade Testfive).
function Find-TargetRealm($Tgt, $Src) {
    $r = Find-RealmName $Tgt.AccPath $Tgt.Char -ExactOnly
    if ($r) { return $r }
    $svDir = Join-Path $Tgt.AccPath 'SavedVariables'
    if (-not (Test-Path -LiteralPath $svDir)) { return '' }
    $srcSet = @{}
    if ($Src) { $srcSet = Get-RealmSet $Src.AccPath }
    $first = [regex]::Escape((Get-CharNames $Tgt.Char).First)
    $counts = @{}
    foreach ($file in Get-ChildItem -LiteralPath $svDir -Filter '*.lua' -File) {
        $text = [IO.File]::ReadAllText($file.FullName, $Utf8NoBom)
        foreach ($m in [regex]::Matches($text, '\["' + $first + ' - ([^"\\\r\n]+)"\]')) {
            $realm = $m.Groups[1].Value
            if (-not $srcSet.ContainsKey($realm)) { $counts[$realm] = 1 + [int]$counts[$realm] }
        }
    }
    if ($counts.Count -gt 0) { return ($counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key }
    return ''
}

# Realm-navnet for den realm spillet står på. Når man er på character select, skriver spillet
# realm-oplysningerne i Logs\Connection.log, fx ..."name":"CAMWOW EU5 Realm 10 PvP"...
function Find-RealmFromLog([string]$Root, [string]$Flavor) {
    $logPath = Join-Path $Root "$Flavor\Logs\Connection.log"
    if (-not $Root -or -not (Test-Path -LiteralPath $logPath)) { return '' }
    try {
        $text = [IO.File]::ReadAllText($logPath, $Utf8NoBom)
        $all = [regex]::Matches($text, '"name":"([^"\\]+)"')
        if ($all.Count -gt 0) { return $all[$all.Count - 1].Groups[1].Value }
    } catch { }
    return ''
}

# cache.md5 holder styr på, hvornår hver fil (keybinds, macros, Edit Mode, indstillinger ...) sidst
# blev gemt: 24 bytes pr. fil = MD5 af filen (16) + tidspunkt (4, unix-tid) + 4 ekstra bytes.
# Ved login sammenligner spillet tidspunktet med serverens kopi (se Logs\AccountData.log):
# er de ens, bruger det filen på disken. Er de forskellige, henter det serverens version.
# Målets cache.md5 indeholder serverens tidspunkter fra sidste gang, spillet var åbent. Her får de
# kopierede filer de tidspunkter (og deres egen MD5), så spillet tror, filerne er serverens version.
#   $OldBytes: målets cache.md5 fra før kopieringen. Poster for filer der ikke blev kopieret, tages derfra.
#   $Copied: stierne på de filer der lige er kopieret. Kun de tæller (en .old-fil kan have samme indhold).
function Update-CacheTimes([string]$Dir, [byte[]]$OldBytes, [hashtable]$Copied) {
    $path = Join-Path $Dir 'cache.md5'
    if (-not (Test-Path -LiteralPath $path)) { return 0 }
    $b = [IO.File]::ReadAllBytes($path)
    if ($b.Length -eq 0 -or $b.Length % 24 -ne 0) { return 0 }
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hashes = @{}
    foreach ($f in Get-ChildItem -LiteralPath $Dir -File) {
        if ($f.Name -eq 'cache.md5' -or -not $Copied.ContainsKey($f.FullName)) { continue }
        $hashes[[BitConverter]::ToString($md5.ComputeHash([IO.File]::ReadAllBytes($f.FullName)))] = $true
    }
    $sameSize = ($OldBytes -and $OldBytes.Length -eq $b.Length)
    $zero = [BitConverter]::ToString((New-Object byte[] 16))
    $bumped = 0
    for ($off = 0; $off -lt $b.Length; $off += 24) {
        $h = [BitConverter]::ToString($b, $off, 16)
        if ($h -ne $zero -and $hashes.ContainsKey($h)) {
            # Serveren har ingen kopi (tidspunkt 0)? Så bruger spillet filen alligevel.
            if ($sameSize -and [BitConverter]::ToUInt32($OldBytes, $off + 16) -ne 0) {
                [Array]::Copy($OldBytes, $off + 16, $b, $off + 16, 4)
                $bumped++
            }
        } elseif ($sameSize) {
            [Array]::Copy($OldBytes, $off, $b, $off, 24)
        }
    }
    [IO.File]::WriteAllBytes($path, $b)
    return $bumped
}

# Har fase 1 kørt? Så ligger kildens addon-filer allerede i målkontoen.
function Test-Phase1Done($Src, $Tgt) {
    if ($Src.AccPath -eq $Tgt.AccPath) { return $true }
    $srcSv = Join-Path $Src.AccPath 'SavedVariables'
    $tgtSv = Join-Path $Tgt.AccPath 'SavedVariables'
    if (-not (Test-Path -LiteralPath $srcSv)) { return $true }
    $names = @(Get-ChildItem -LiteralPath $srcSv -Filter '*.lua' -File | ForEach-Object { $_.Name })
    if ($names.Count -eq 0) { return $true }
    $found = @($names | Where-Object { Test-Path -LiteralPath (Join-Path $tgtSv $_) }).Count
    return ($found * 2 -ge $names.Count)
}

# Beskriver hvad der kommer til at ske (bruges til opsummering i både vindue og konsol).
function Get-PlanSummary([string]$Phase, $Src, $Tgt, [bool]$CopyAddons, [bool]$NoSync, [string]$SrcRealm, [string]$TgtRealm) {
    $sameFlavor = ($Src.Flavor -eq $Tgt.Flavor)
    $lines = @()
    if ($Phase -eq '1') {
        if (-not $sameFlavor -and $CopyAddons) { $lines += "Addons kopieres fra $($Src.Flavor) til $($Tgt.Flavor)" }
        if (-not $sameFlavor) { $lines += "Grafik- og lydindstillinger kopieres (uden beta-loginlinjer)" }
        if ($Src.AccPath -ne $Tgt.AccPath) {
            $lines += "Konto-indstillinger kopieres til kontoen $($Tgt.Account): Edit Mode, keybinds, macros, interface- og addon-indstillinger"
            if (-not $Tgt.Exists) { $lines += "Kontomappen $($Tgt.Account) findes ikke endnu og bliver oprettet. Tjek at navnet er stavet rigtigt" }
            if (-not $Tgt.HasCache) { $lines += "OBS: Spillet har ikke været startet på denne konto på pc'en. Mangler Edit Mode eller keybinds efter Enter World: skriv /logout og kør fase 2 igen" }
        }
        if ($NoSync) { $lines += "Server-synkronisering slås fra (nødløsning)" }
    } else {
        if (-not (Test-Phase1Done $Src $Tgt)) { $lines += "OBS: Fase 1 ser ikke ud til at være kørt. Edit Mode, keybinds og indstillinger kommer ikke med" }
        $lines += "Character-indstillinger kopieres: $($Src.Char)  ->  $($Tgt.Char)"
        if ($Src.AccPath -ne $Tgt.AccPath) { $lines += "Edit Mode, keybinds og macros på kontoen kopieres igen med serverens tidspunkter" }
        $lines += "Addon-profiler for $($Src.Char) bliver valgt på $($Tgt.Char)"
        if ($SrcRealm -and $TgtRealm) { $lines += "Realm-indstillinger (Titan Panel, X-Perl, AtlasLoot) flyttes: $SrcRealm  ->  $TgtRealm" }
        else { $lines += "Intet realm-navn: Titan Panel, X-Perl og AtlasLoot venter. Tryk Enter World, skriv /logout, og kør fase 2 igen" }
    }
    $lines += "Intet slettes. Overskrevne filer gemmes i en backup-mappe."
    return $lines
}

# ---- Små hjælpere til WoW's SavedVariables (Lua-tabeller) ----

# Index på den '}' der lukker den '{' der står på $Open. Springer tekst i "..." over.
function Find-LuaBlockEnd([string]$Text, [int]$Open) {
    $depth = 0
    $i = $Open
    $special = [char[]]'{}"'
    $inString = [char[]]'"\'
    while ($true) {
        $i = $Text.IndexOfAny($special, $i)
        if ($i -lt 0) { return -1 }
        if ($Text[$i] -eq '"') {
            $i++
            while ($true) {
                $j = $Text.IndexOfAny($inString, $i)
                if ($j -lt 0) { return -1 }
                if ($Text[$j] -eq '\') { $i = $j + 2; continue }
                $i = $j + 1
                break
            }
            continue
        }
        if ($Text[$i] -eq '{') { $depth++ } else { $depth--; if ($depth -eq 0) { return $i } }
        $i++
    }
}

# Finder ["Key"] = { direkte i blokken der starter ved $Open (ikke i underblokke). Returnerer index på '{' eller -1.
function Find-LuaChildBlock([string]$Text, [int]$Open, [int]$Close, [string]$Key) {
    $needle = '["' + $Key + '"] = {'
    $pos = $Text.IndexOf($needle, $Open, [StringComparison]::Ordinal)
    while ($pos -ge 0 -and $pos -lt $Close) {
        # dybden ved $pos: tæl blokke der åbner og lukker igen mellem $Open og $pos
        $depth = 1
        $i = $Open + 1
        while ($i -lt $pos) {
            $c = $Text[$i]
            if ($c -eq '{') {
                $end = Find-LuaBlockEnd $Text $i
                if ($end -gt $pos) { $depth = 2; break }
                $i = $end + 1
                continue
            }
            if ($c -eq '"') {
                $i++
                while ($i -lt $pos -and $Text[$i] -ne '"') { if ($Text[$i] -eq '\') { $i++ }; $i++ }
            }
            $i++
        }
        if ($depth -eq 1) { return $pos + $needle.Length - 1 }
        $pos = $Text.IndexOf($needle, $pos + 1, [StringComparison]::Ordinal)
    }
    return -1
}

# Erstatter blokken der starter ved $Open med $Value. $null hvis den allerede er ens.
function Set-LuaBlock([string]$Text, [int]$Open, [string]$Value) {
    $close = Find-LuaBlockEnd $Text $Open
    if ($close -lt 0) { return $null }
    if ($Text.Substring($Open, $close - $Open + 1) -eq $Value) { return $null }
    return $Text.Substring(0, $Open) + $Value + $Text.Substring($close + 1)
}

# Titan Panel: TitanSettings.Players["Fornavn Efternavn@Realm"] = {...}  ->  kopi under den nye nøgle.
# Findes den nye nøgle allerede (addonnet har lavet standardindstillinger ved første login), erstattes den.
function Copy-LuaKeyedBlock([string]$Text, [string]$FromKey, [string]$ToKey) {
    $from = '["' + $FromKey + '"] = {'
    $pos = $Text.IndexOf($from, [StringComparison]::Ordinal)
    if ($pos -lt 0) { return $null }
    $open = $pos + $from.Length - 1
    $close = Find-LuaBlockEnd $Text $open
    if ($close -lt 0 -or $Text[$close + 1] -ne ',') { return $null }
    $value = $Text.Substring($open, $close - $open + 1)
    $to = '["' + $ToKey + '"] = {'
    $toPos = $Text.IndexOf($to, [StringComparison]::Ordinal)
    if ($toPos -ge 0) { return (Set-LuaBlock $Text ($toPos + $to.Length - 1) $value) }
    return $Text.Insert($close + 2, "`n" + '["' + $ToKey + '"] = ' + $value + ',')
}

# X-Perl: ZPerlConfigNew["Realm"]["Fornavn"] = {...}  ->  kopi under ["Ny realm"]["Nyt fornavn"].
function Copy-LuaRealmCharBlock([string]$Text, [string]$SrcRealm, [string]$SrcFirst, [string]$TgtRealm, [string]$TgtFirst) {
    $rNeedle = '["' + $SrcRealm + '"] = {'
    $rPos = $Text.IndexOf($rNeedle, [StringComparison]::Ordinal)
    if ($rPos -lt 0) { return $null }
    $rOpen = $rPos + $rNeedle.Length - 1
    $rClose = Find-LuaBlockEnd $Text $rOpen
    if ($rClose -lt 0) { return $null }
    $cOpen = Find-LuaChildBlock $Text $rOpen $rClose $SrcFirst
    if ($cOpen -lt 0) { return $null }
    $value = $Text.Substring($cOpen, (Find-LuaBlockEnd $Text $cOpen) - $cOpen + 1)
    $entry = '["' + $TgtFirst + '"] = ' + $value + ','

    $tNeedle = '["' + $TgtRealm + '"] = {'
    $tPos = $Text.IndexOf($tNeedle, [StringComparison]::Ordinal)
    if ($tPos -ge 0) {
        $tOpen = $tPos + $tNeedle.Length - 1
        $tClose = Find-LuaBlockEnd $Text $tOpen
        $existing = Find-LuaChildBlock $Text $tOpen $tClose $TgtFirst
        if ($existing -ge 0) { return (Set-LuaBlock $Text $existing $value) }
        return $Text.Insert($tOpen + 1, "`n" + $entry)
    }
    if ($Text[$rClose + 1] -ne ',') { return $null }
    return $Text.Insert($rClose + 2, "`n" + $tNeedle + "`n" + $entry + "`n},")
}

# Udfører en fase. $Log og $Progress er scriptblocks, så vinduet og konsollen kan vise fremdrift.
#   Fase 1: $Tgt er en konto (Get-TargetAccount).  Fase 2: $Tgt er en character (Get-Characters).
function Invoke-Transfer {
    param(
        [string]$Phase, [string]$Root, $Src, $Tgt,
        [bool]$CopyAddons, [bool]$NoSync, [string]$SrcRealm, [string]$TgtRealm,
        [scriptblock]$Log, [scriptblock]$Progress
    )
    if ($Phase -eq '1' -and (Test-WowRunning)) { throw "Spillet kører. Luk WoW helt (også Battle.net-spillet), før du kører fase 1." }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupRoot = Join-Path $Root "UI-backup-$stamp"
    $state = @{ Backups = 0; Files = 0; Profiles = 0; LogLines = New-Object System.Collections.Generic.List[string] }

    $say = {
        param([string]$Text)
        $state.LogLines.Add("[$(Get-Date -Format 'HH:mm:ss')] $Text")
        if ($Log) { & $Log $Text }
    }

    $backupFile = {
        param([string]$Path)
        if (-not (Test-Path -LiteralPath $Path)) { return }
        $rel = $Path.Substring($Root.Length).TrimStart('\', '/')
        $bak = Join-Path $backupRoot $rel
        if (Test-Path -LiteralPath $bak) { return }   # behold den oprindelige version
        New-Item -ItemType Directory -Path (Split-Path $bak -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $Path -Destination $bak -Force
        $state.Backups++
    }

    $srcBase = Join-Path $Root $Src.Flavor
    $tgtBase = Join-Path $Root $Tgt.Flavor
    $sameFlavor = ($Src.Flavor -eq $Tgt.Flavor)

    & $say "Fase $Phase"
    & $say "Fra: $($Src.Flavor)\$($Src.Account)\$($Src.Realm)\$($Src.Char)"
    if ($Phase -eq '1') { & $say "Til: $($Tgt.Flavor)\$($Tgt.Account)" }
    else {
        if ($Src.Path -eq $Tgt.Path) { throw "Kilde og mål er den samme character." }
        & $say "Til: $($Tgt.Flavor)\$($Tgt.Account)\$($Tgt.Realm)\$($Tgt.Char)"
    }

    # ---- Saml alle fil-kopieringer først, så fremdriften kan vises korrekt ----
    $ops = New-Object System.Collections.Generic.List[object]
    $addTree = {
        param([string]$From, [string]$To)
        foreach ($f in Get-ChildItem -LiteralPath $From -Recurse -File -Force) {
            $rel = $f.FullName.Substring($From.Length).TrimStart('\', '/')
            $ops.Add(@($f.FullName, (Join-Path $To $rel)))
        }
    }

    if ($Phase -eq '1') {
        if (-not $sameFlavor -and $CopyAddons) {
            $srcInterface = Join-Path $srcBase 'Interface'
            if (Test-Path -LiteralPath $srcInterface) { & $addTree $srcInterface (Join-Path $tgtBase 'Interface') }
        }
        if ($Src.AccPath -ne $Tgt.AccPath) {
            # Filerne direkte i kontomappen (Edit Mode, keybinds, macros, indstillinger) + kontoens addon-indstillinger.
            # Rækkefølgen af characters på character select hører til den gamle konto og bliver ikke kopieret.
            foreach ($f in Get-ChildItem -LiteralPath $Src.AccPath -File -Force) {
                if ($f.Name -like 'character-list-order*') { continue }
                $ops.Add(@($f.FullName, (Join-Path $Tgt.AccPath $f.Name)))
            }
            $srcSv = Join-Path $Src.AccPath 'SavedVariables'
            if (Test-Path -LiteralPath $srcSv) { & $addTree $srcSv (Join-Path $Tgt.AccPath 'SavedVariables') }
        }
    } else {
        & $addTree $Src.Path $Tgt.Path
        if ($Src.AccPath -ne $Tgt.AccPath) {
            # Edit Mode, keybinds og macros på kontoniveau hentes først fra serveren ved Enter World.
            # Kendte fase 1 ikke serverens tidspunkter (fx ingen cache.md5 i målet), har spillet hentet
            # serverens version ved første Enter World. Efter /logout står tidspunkterne i cache.md5,
            # så filerne kopieres igen her. Interface-indstillingerne (config-cache) læses kun ved login.
            foreach ($f in Get-ChildItem -LiteralPath $Src.AccPath -File -Force) {
                if ($f.Name -like 'character-list-order*' -or $f.Name -like 'config-cache*') { continue }
                $ops.Add(@($f.FullName, (Join-Path $Tgt.AccPath $f.Name)))
            }
        }
    }

    # Målets cache.md5 gemmes inden kopieringen (se Update-CacheTimes)
    $cacheDirs = @()
    if ($Phase -eq '2') { $cacheDirs += $Tgt.Path }
    if ($Src.AccPath -ne $Tgt.AccPath) { $cacheDirs += $Tgt.AccPath }
    $oldCaches = @{}
    foreach ($dir in $cacheDirs) {
        $p = Join-Path $dir 'cache.md5'
        if (Test-Path -LiteralPath $p) { $oldCaches[$dir] = [IO.File]::ReadAllBytes($p) } else { $oldCaches[$dir] = $null }
    }

    # ---- Kopiér ----
    & $say "Kopierer $($ops.Count) filer..."
    $i = 0
    $lastPct = -1
    foreach ($op in $ops) {
        & $backupFile $op[1]
        New-Item -ItemType Directory -Path (Split-Path $op[1] -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $op[0] -Destination $op[1] -Force
        $i++
        $pct = [int](80 * $i / [Math]::Max(1, $ops.Count))
        if ($Progress -and $pct -ne $lastPct) { & $Progress $pct; $lastPct = $pct }
    }
    $state.Files = $ops.Count
    & $say "Filer kopieret."

    $n = 0
    $copied = @{}
    foreach ($op in $ops) { $copied[(Get-Item -LiteralPath $op[1]).FullName] = $true }
    foreach ($dir in $cacheDirs) { $n += Update-CacheTimes $dir $oldCaches[$dir] $copied }
    if ($n -gt 0) { & $say "$n filer fik serverens tidspunkt, så spillet bruger dem frem for at hente serverens kopi." }
    if ($Src.AccPath -ne $Tgt.AccPath -and -not $oldCaches[$Tgt.AccPath]) {
        & $say "Målkontoen havde ingen cache.md5, så serverens tidspunkter kendes ikke endnu. Mangler Edit Mode eller keybinds efter Enter World: skriv /logout og kør fase 2 igen."
    }

    if ($Phase -eq '1') {
        # ---- Config.wtf (grafik/lyd) uden beta-loginlinjer ----
        $loginLines = '^\s*SET\s+(portal|realmList|realmListbn|realmName|lastCharacterIndex|lastSelectedRealm|accountName|accountList|gxApi)\s'
        if (-not $sameFlavor) {
            $srcConfig = Join-Path $srcBase 'WTF\Config.wtf'
            if (Test-Path -LiteralPath $srcConfig) {
                $tgtConfig = Join-Path $tgtBase 'WTF\Config.wtf'
                $keep = @()
                if (Test-Path -LiteralPath $tgtConfig) {
                    # behold målets egne login-linjer, så launch-klienten stadig logger rigtigt ind
                    $keep = @([IO.File]::ReadAllLines($tgtConfig) | Where-Object { $_ -match $loginLines })
                    & $backupFile $tgtConfig
                }
                $lines = @([IO.File]::ReadAllLines($srcConfig) | Where-Object { $_ -notmatch $loginLines }) + $keep
                New-Item -ItemType Directory -Path (Split-Path $tgtConfig -Parent) -Force | Out-Null
                [IO.File]::WriteAllLines($tgtConfig, [string[]]$lines, $Utf8NoBom)
                & $say "Grafik- og lydindstillinger kopieret (Config.wtf, uden beta-loginlinjer)."
            }
        }
        if ($Progress) { & $Progress 90 }

        # ---- (Valgfrit) Slå server-synkronisering fra ----
        if ($NoSync) {
            $tgtConfig = Join-Path $tgtBase 'WTF\Config.wtf'
            $lines = @()
            if (Test-Path -LiteralPath $tgtConfig) {
                & $backupFile $tgtConfig
                $lines = @([IO.File]::ReadAllLines($tgtConfig) | Where-Object { $_ -notmatch '^\s*SET\s+synchronize(Config|Settings|Bindings|Macros)\s' })
            }
            $lines += 'SET synchronizeConfig "0"', 'SET synchronizeSettings "0"', 'SET synchronizeBindings "0"', 'SET synchronizeMacros "0"'
            New-Item -ItemType Directory -Path (Split-Path $tgtConfig -Parent) -Force | Out-Null
            [IO.File]::WriteAllLines($tgtConfig, [string[]]$lines, $Utf8NoBom)
            & $say "Server-synkronisering af keybinds, macros og indstillinger er slået fra."
        }
    } else {
        # ---- Addon-profiler (AceDB profileKeys) og indstillinger gemt under realm-navn ----
        # I WoW Forever ser profileKeys ud som ["Fornavn Efternavn"] = "Profil", og i nogle addons
        # ["Fornavn - Realm"], hvor fornavnet er det spillet selv kalder characteren.
        $s = Get-CharNames $Src.Char
        $t = Get-CharNames $Tgt.Char
        $keyMap = @{}
        $keyMap[$s.Full] = $t.Full
        $keyMap[$Src.Char] = $Tgt.Char
        $useRealm = [bool]($SrcRealm -and $TgtRealm)
        if ($useRealm) {
            $keyMap["$($s.First) - $SrcRealm"] = "$($t.First) - $TgtRealm"
            $keyMap["$($s.Full) - $SrcRealm"] = "$($t.Full) - $TgtRealm"
        }
        $svDir = Join-Path $Tgt.AccPath 'SavedVariables'
        if (Test-Path -LiteralPath $svDir) {
            $blockPattern = '(?s)\["profileKeys"\] = \{.*?\n[ \t]*\}'
            $linePattern = '(?m)^([ \t]*)\["((?:[^"\\\r\n]|\\.)*)"\] = ("(?:[^"\\\r\n]|\\.)*"),(\r?)$'
            $names = @()
            foreach ($file in Get-ChildItem -LiteralPath $svDir -Filter '*.lua' -File) {
                $text = [IO.File]::ReadAllText($file.FullName, $Utf8NoBom)
                $new = $text
                if ($text.Contains('["profileKeys"]')) {
                    $new = [regex]::Replace($new, $blockPattern, {
                        param($block)
                        $b = $block.Value
                        # Hvilken profil skal den nye character have? (samme som den gamle)
                        $want = @{}
                        foreach ($m in [regex]::Matches($b, $linePattern)) {
                            $old = $m.Groups[2].Value
                            if ($keyMap.ContainsKey($old) -and $keyMap[$old] -ne $old -and -not $want.ContainsKey($keyMap[$old])) {
                                $want[$keyMap[$old]] = $m.Groups[3].Value
                            }
                        }
                        # Findes den nye character allerede (fx efter første login), rettes profilen
                        $b = [regex]::Replace($b, $linePattern, {
                            param($m)
                            $k = $m.Groups[2].Value
                            if (-not $want.ContainsKey($k) -or $m.Groups[3].Value -eq $want[$k]) { return $m.Value }
                            return $m.Groups[1].Value + '["' + $k + '"] = ' + $want[$k] + ',' + $m.Groups[4].Value
                        })
                        # Ellers indsættes en ny linje lige under den gamle characters linje
                        $added = @{}
                        $bb = $b
                        [regex]::Replace($bb, $linePattern, {
                            param($m)
                            $old = $m.Groups[2].Value
                            if (-not $keyMap.ContainsKey($old)) { return $m.Value }
                            $nk = $keyMap[$old]
                            if ($nk -eq $old -or $added.ContainsKey($nk) -or $bb.Contains('["' + $nk + '"] = ')) { return $m.Value }
                            $added[$nk] = $true
                            return $m.Value + "`n" + $m.Groups[1].Value + '["' + $nk + '"] = ' + $m.Groups[3].Value + ',' + $m.Groups[4].Value
                        })
                    })
                }
                if ($useRealm -and $file.Name -eq 'Titan.lua') {
                    $r = Copy-LuaKeyedBlock $new "$($s.Full)@$SrcRealm" "$($t.Full)@$TgtRealm"
                    if ($r) { $new = $r }
                }
                if ($useRealm -and $file.Name -eq 'ZPerl.lua') {
                    $r = Copy-LuaRealmCharBlock $new $SrcRealm $s.First $TgtRealm $t.First
                    if ($r) { $new = $r }
                }
                if ($new -ne $text) {
                    if ($text.Contains("`r`n")) { $new = $new -replace '(?<!\r)\n', "`r`n" }
                    & $backupFile $file.FullName
                    [IO.File]::WriteAllText($file.FullName, $new, $Utf8NoBom)
                    $state.Profiles++
                    $names += $file.BaseName
                }
            }
            if ($names.Count -gt 0) { & $say "Addon-profiler sat op i $($names.Count) addons: $($names -join ', ')" }
            else { & $say "Ingen addon-profiler at sætte op (de er allerede sat, eller ingen addons bruger profiler)." }
        }
    }
    if ($Progress) { & $Progress 95 }

    & $say "Færdig. $($state.Files) filer kopieret, $($state.Backups) filer gemt i backup."

    # ---- Log gemmes i backup-mappen ----
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $logPath = Join-Path $backupRoot 'overfoersel-log.txt'
    [IO.File]::WriteAllLines($logPath, [string[]]$state.LogLines, $Utf8NoBom)
    if ($Progress) { & $Progress 100 }

    return [pscustomobject]@{
        Files = $state.Files; Backups = $state.Backups; Profiles = $state.Profiles
        BackupRoot = $backupRoot; LogPath = $logPath
    }
}

# =====================================================================================
#  KONSOL-VERSION  (Overfoer-UI.bat -NoGui, eller hvis vinduet ikke kan vises)
# =====================================================================================

function Select-FromList([string]$Title, [object[]]$Items, [scriptblock]$LabelOf, [int]$DefaultIndex = 0) {
    if (-not $Items -or $Items.Count -eq 0) { throw "Ingen muligheder fundet for: $Title" }
    if ($Items.Count -eq 1) { Write-Host "$Title -> $(& $LabelOf $Items[0])"; return $Items[0] }
    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    for ($i = 0; $i -lt $Items.Count; $i++) {
        $mark = ''; if ($i -eq $DefaultIndex) { $mark = '  (standard - tryk Enter)' }
        Write-Host ("  [{0}] {1}{2}" -f ($i + 1), (& $LabelOf $Items[$i]), $mark)
    }
    while ($true) {
        $a = Read-Host "Vælg nummer"
        if (-not $a) { return $Items[$DefaultIndex] }
        $n = 0
        if ([int]::TryParse($a, [ref]$n) -and $n -ge 1 -and $n -le $Items.Count) { return $Items[$n - 1] }
        Write-Host "Ugyldigt valg, prøv igen." -ForegroundColor Yellow
    }
}

function Confirm-Console([string]$Question) {
    if ($Yes) { return $true }
    return ((Read-Host "$Question (j/n)") -match '^\s*[jy]')
}

# Spørg om en tekst med et forslag, der bruges hvis man bare trykker Enter.
function Read-WithDefault([string]$Question, [string]$Default) {
    if ($Yes) { return $Default }
    $q = $Question
    if ($Default) { $q += " [$Default]" }
    $a = Read-Host $q
    if ($a) { return $a.Trim() }
    return $Default
}

function Start-Console {
    Write-Host "=== $AppTitle ===" -ForegroundColor Green
    $running = Test-WowRunning
    $ph = $Phase
    if (-not $ph) {
        $def = 0; if ($running) { $def = 1 }
        $ph = Select-FromList "Hvilken fase?" @('1', '2') { param($x) if ($x -eq '1') { 'Fase 1: før launch (spillet lukket)' } else { 'Fase 2: på launch (character select)' } } $def
    }
    if ($ph -eq '1' -and $running) {
        Write-Host "Spillet kører. Fase 1 kræver, at WoW er helt lukket. Luk spillet, og kør scriptet igen." -ForegroundColor Yellow
        return 1
    }
    if ($ph -eq '2' -and $running) {
        Write-Host "WoW kører. Det er OK, så længe du står på character select og ikke har trykket Enter World." -ForegroundColor Yellow
        if (-not (Confirm-Console "Står du på character select?")) { Write-Host "Afbrudt. Intet er ændret."; return 1 }
    }
    $root = $WowRoot
    if (-not $root) { $root = Find-WowRoot }
    if (-not $root) { $root = Read-Host "Kunne ikke finde WoW. Indsæt stien til World of Warcraft-mappen" }
    $root = $root.Trim().TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $root)) { throw "Mappen findes ikke: $root" }
    Write-Host "WoW-mappe: $root"

    $srcFlavors = @(Get-Flavors $root -WithAccounts)
    if ($SourceFlavor) { $srcFlavors = @($srcFlavors | Where-Object { $_ -eq $SourceFlavor }) }
    $def = [Math]::Max(0, [Array]::IndexOf($srcFlavors, '_classic_beta_'))
    $sf = Select-FromList "Hvor har du lavet dit UI? (FRA)" $srcFlavors { param($x) Get-FlavorLabel $x } $def

    $srcChars = @(Get-Characters $root $sf | Sort-Object Modified -Descending)
    if ($SourceChar) { $srcChars = @($srcChars | Where-Object { $_.Char -eq $SourceChar }) }
    $src = Select-FromList "Vælg din gamle character (senest brugt øverst)" $srcChars { param($x) $x.Label } 0

    $tgtFlavors = @(Get-Flavors $root)
    if ($TargetFlavor) { $tgtFlavors = @($tgtFlavors | Where-Object { $_ -eq $TargetFlavor }) }
    $def = [Math]::Max(0, [Array]::IndexOf($tgtFlavors, '_forever_'))
    $tf = Select-FromList "Hvor spiller du nu? (TIL)" $tgtFlavors { param($x) Get-FlavorLabel $x } $def

    $copyAddons = $false
    $srcRealm = ''
    $tgtRealm = ''
    if ($ph -eq '1') {
        $acc = $TargetAccount
        if (-not $acc) { $acc = Read-WithDefault "Dit kontonavn i $tf (fx C00LPET)" (@(Get-Accounts $root $tf) | Select-Object -First 1) }
        if (-not $acc) { throw "Intet kontonavn angivet." }
        $tgt = Get-TargetAccount $root $tf $acc
        if ($sf -ne $tf) {
            if ($CopyInterface -eq 'yes') { $copyAddons = $true }
            elseif ($CopyInterface -eq 'ask') { $copyAddons = Confirm-Console "Kopiér også dine addons?" }
        }
    } else {
        $tgtChars = @(Get-Characters $root $tf | Where-Object { $_.Path -ne $src.Path } | Sort-Object Created -Descending)
        if ($TargetChar) { $tgtChars = @($tgtChars | Where-Object { $_.Char -eq $TargetChar }) }
        if ($tgtChars.Count -eq 0) { throw "Fandt ingen ny character i $tf. Opret din character i spillet først (tryk ikke Enter World), og kør så scriptet igen." }
        $tgt = Select-FromList "Vælg din NYE character (nyeste øverst)" $tgtChars { param($x) $x.Label } 0
        $srcRealm = $SourceRealm
        if (-not $srcRealm) { $srcRealm = Read-WithDefault "Realm-navn for $($src.Char)" (Find-RealmName $src.AccPath $src.Char) }
        $tgtRealm = $TargetRealm
        if (-not $tgtRealm) {
            $guess = Find-TargetRealm $tgt $src
            if (-not $guess) { $guess = Find-RealmFromLog $root $tgt.Flavor }
            $tgtRealm = Read-WithDefault "Realm-navn for $($tgt.Char) (står på character select, Enter = spring over)" $guess
        }
    }

    Write-Host ""
    Write-Host "Det her sker:" -ForegroundColor Cyan
    Get-PlanSummary $ph $src $tgt $copyAddons $DisableSync.IsPresent $srcRealm $tgtRealm | ForEach-Object { Write-Host "  - $_" }
    if (-not (Confirm-Console "Fortsæt?")) { Write-Host "Afbrudt. Intet er ændret."; return 1 }

    $r = Invoke-Transfer -Phase $ph -Root $root -Src $src -Tgt $tgt -CopyAddons $copyAddons -NoSync $DisableSync.IsPresent `
        -SrcRealm $srcRealm -TgtRealm $tgtRealm -Log { param($t) Write-Host "  $t" } -Progress $null
    Write-Host ""
    if ($ph -eq '1') {
        Write-Host "Fase 1 færdig! Kør fase 2 på launch, når du har oprettet din character." -ForegroundColor Green
        if ($src.AccPath -ne $tgt.AccPath -and -not $tgt.HasCache) {
            Write-Host "  Spillet har ikke været startet på denne konto på pc'en. Mangler Edit Mode eller keybinds efter Enter World: skriv /logout, kør fase 2 igen, og tryk Enter World." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Færdig! Du kan nu trykke 'Enter World'." -ForegroundColor Green
        if (-not ($srcRealm -and $tgtRealm)) {
            Write-Host "  Realm-navnet manglede: skriv /logout når du er inde i verden, kør fase 2 igen, og tryk Enter World." -ForegroundColor Yellow
        } else {
            Write-Host "  Mangler Edit Mode eller keybinds i spillet: skriv /logout, kør fase 2 igen, og tryk Enter World."
        }
        Write-Host "  Mangler binds eller macros på barerne: /myslot -> vælg profil -> Import."
    }
    Write-Host "  Backup og log: $($r.BackupRoot)"
    return 0
}

# =====================================================================================
#  VINDUE (Windows Forms - findes i alle Windows-versioner, intet skal installeres)
# =====================================================================================

function Start-Gui {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    try {
        Add-Type -Namespace UiTransfer -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -ErrorAction Stop
        [UiTransfer.Dpi]::SetProcessDPIAware() | Out-Null
    } catch { }
    [System.Windows.Forms.Application]::EnableVisualStyles()

    # ---- Farver og skrifttyper ----
    $Clr = @{
        Bg      = [System.Drawing.Color]::FromArgb(24, 25, 28)
        Card    = [System.Drawing.Color]::FromArgb(34, 36, 41)
        Field   = [System.Drawing.Color]::FromArgb(45, 48, 54)
        Border  = [System.Drawing.Color]::FromArgb(58, 61, 68)
        Text    = [System.Drawing.Color]::FromArgb(232, 233, 236)
        Muted   = [System.Drawing.Color]::FromArgb(150, 155, 165)
        Accent  = [System.Drawing.Color]::FromArgb(212, 168, 74)
        AccentH = [System.Drawing.Color]::FromArgb(230, 188, 96)
        OnAcc   = [System.Drawing.Color]::FromArgb(28, 22, 10)
        Ok      = [System.Drawing.Color]::FromArgb(110, 196, 130)
        Warn    = [System.Drawing.Color]::FromArgb(236, 186, 92)
        Err     = [System.Drawing.Color]::FromArgb(232, 108, 100)
        Log     = [System.Drawing.Color]::FromArgb(18, 19, 21)
    }
    $Fnt = @{
        Title = New-Object System.Drawing.Font('Segoe UI Semibold', 16)
        Sub   = New-Object System.Drawing.Font('Segoe UI', 9.5)
        Head  = New-Object System.Drawing.Font('Segoe UI Semibold', 10.5)
        Body  = New-Object System.Drawing.Font('Segoe UI', 9.5)
        Small = New-Object System.Drawing.Font('Segoe UI', 8.5)
        Btn   = New-Object System.Drawing.Font('Segoe UI Semibold', 10)
        Mono  = New-Object System.Drawing.Font('Consolas', 9)
    }

    $W = 760
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $AppTitle
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedSingle'
    $form.MaximizeBox = $false
    $form.BackColor = $Clr.Bg
    $form.ForeColor = $Clr.Text
    $form.Font = $Fnt.Body
    # Layoutet er tegnet ved 96 DPI og skaleres automatisk op på skærme med højere opløsning
    $form.AutoScaleDimensions = New-Object System.Drawing.SizeF(96, 96)
    $form.AutoScaleMode = 'Dpi'
    $form.ClientSize = New-Object System.Drawing.Size($W, 880)

    function New-Label($Text, $X, $Y, $Font, $Color, $Width = 0) {
        $l = New-Object System.Windows.Forms.Label
        $l.Text = $Text; $l.Font = $Font; $l.ForeColor = $Color; $l.BackColor = [System.Drawing.Color]::Transparent
        $l.Location = New-Object System.Drawing.Point($X, $Y)
        if ($Width -gt 0) { $l.AutoSize = $false; $l.Width = $Width; $l.Height = [int]($Font.GetHeight() * 1.45) + 2 } else { $l.AutoSize = $true }
        return $l
    }
    function New-Card($Y, $H) {
        $p = New-Object System.Windows.Forms.Panel
        $p.Location = New-Object System.Drawing.Point(20, $Y); $p.Size = New-Object System.Drawing.Size(($W - 40), $H)
        $p.BackColor = $Clr.Card
        $form.Controls.Add($p)
        return $p
    }
    # Comboboks: viser tekster, mens de tilhørende værdier ligger i .Tag (samme rækkefølge)
    function New-Combo($X, $Y, $Width) {
        $cb = New-Object System.Windows.Forms.ComboBox
        $cb.DropDownStyle = 'DropDownList'; $cb.FlatStyle = 'Flat'
        $cb.BackColor = $Clr.Field; $cb.ForeColor = $Clr.Text; $cb.Font = $Fnt.Body
        $cb.Location = New-Object System.Drawing.Point($X, $Y); $cb.Width = $Width
        $cb.Tag = New-Object System.Collections.ArrayList
        return $cb
    }
    function Clear-Combo($cb) { $cb.Items.Clear(); $cb.Tag.Clear() }
    function Add-ComboItem($cb, [string]$Label, $Value) { [void]$cb.Items.Add($Label); [void]$cb.Tag.Add($Value) }
    function Get-ComboValue($cb) { if ($cb.SelectedIndex -ge 0) { return $cb.Tag[$cb.SelectedIndex] } else { return $null } }
    function New-TextBox($X, $Y, $Width) {
        $t = New-Object System.Windows.Forms.TextBox
        $t.Location = New-Object System.Drawing.Point($X, $Y); $t.Width = $Width
        $t.BackColor = $Clr.Field; $t.ForeColor = $Clr.Text; $t.BorderStyle = 'FixedSingle'; $t.Font = $Fnt.Body
        return $t
    }
    function New-Button($Text, $X, $Y, $Width, [bool]$Primary) {
        $b = New-Object System.Windows.Forms.Button
        $b.Text = $Text; $b.Font = $Fnt.Btn; $b.FlatStyle = 'Flat'; $b.Cursor = [System.Windows.Forms.Cursors]::Hand
        $b.Location = New-Object System.Drawing.Point($X, $Y); $b.Size = New-Object System.Drawing.Size($Width, 36)
        if ($Primary) {
            $b.BackColor = $Clr.Accent; $b.ForeColor = $Clr.OnAcc; $b.FlatAppearance.BorderSize = 0
            $b.FlatAppearance.MouseOverBackColor = $Clr.AccentH
        } else {
            $b.BackColor = $Clr.Field; $b.ForeColor = $Clr.Text; $b.FlatAppearance.BorderColor = $Clr.Border
            $b.FlatAppearance.MouseOverBackColor = $Clr.Border
        }
        return $b
    }
    function New-Check($Text, $X, $Y) {
        $c = New-Object System.Windows.Forms.CheckBox
        $c.Text = $Text; $c.AutoSize = $true; $c.ForeColor = $Clr.Text; $c.Font = $Fnt.Body
        $c.Location = New-Object System.Drawing.Point($X, $Y); $c.FlatStyle = 'Flat'
        return $c
    }

    # ---- Header ----
    $accentBar = New-Object System.Windows.Forms.Panel
    $accentBar.Location = New-Object System.Drawing.Point(0, 0); $accentBar.Size = New-Object System.Drawing.Size($W, 4)
    $accentBar.BackColor = $Clr.Accent
    $form.Controls.Add($accentBar)
    $form.Controls.Add((New-Label 'UI-overførsel' 20 18 $Fnt.Title $Clr.Text))
    $subtitle = New-Label '' 22 52 $Fnt.Sub $Clr.Muted 370
    $form.Controls.Add($subtitle)

    # ---- Faser: to knapper øverst til højre ----
    $btnPhase1 = New-Button "Fase 1`nFør launch" 400 18 166 $false
    $btnPhase2 = New-Button "Fase 2`nPå launch" 574 18 166 $false
    $btnPhase1.Height = 54; $btnPhase2.Height = 54
    $form.Controls.AddRange(@($btnPhase1, $btnPhase2))

    # ---- Banner (status: WoW kører / fejl / klar) ----
    $banner = New-Object System.Windows.Forms.Label
    $banner.Location = New-Object System.Drawing.Point(20, 82); $banner.Size = New-Object System.Drawing.Size(($W - 40), 38)
    $banner.Padding = New-Object System.Windows.Forms.Padding(12, 0, 12, 0)
    $banner.TextAlign = 'MiddleLeft'; $banner.Font = $Fnt.Body
    $form.Controls.Add($banner)

    # ---- Kort 0: WoW-mappe ----
    $card0 = New-Card 130 62
    $card0.Controls.Add((New-Label 'WOW-MAPPE' 16 8 $Fnt.Small $Clr.Muted))
    $rootBox = New-Object System.Windows.Forms.TextBox
    $rootBox.Location = New-Object System.Drawing.Point(16, 28); $rootBox.Width = 560
    $rootBox.BackColor = $Clr.Field; $rootBox.ForeColor = $Clr.Text; $rootBox.BorderStyle = 'FixedSingle'; $rootBox.ReadOnly = $true
    $card0.Controls.Add($rootBox)
    $btnBrowse = New-Button 'Skift…' 590 24 120 $false
    $btnBrowse.Height = 30
    $card0.Controls.Add($btnBrowse)

    # ---- Kort 1: FRA ----
    $card1 = New-Card 204 150
    $card1.Controls.Add((New-Label '1   FRA  ·  dit færdige UI' 16 12 $Fnt.Head $Clr.Accent))
    $card1.Controls.Add((New-Label 'Spil' 16 46 $Fnt.Small $Clr.Muted))
    $cbSrcFlavor = New-Combo 16 64 220
    $card1.Controls.Add($cbSrcFlavor)
    $card1.Controls.Add((New-Label 'Character' 252 46 $Fnt.Small $Clr.Muted))
    $cbSrcChar = New-Combo 252 64 458
    $card1.Controls.Add($cbSrcChar)
    $srcHint = New-Label '' 16 104 $Fnt.Small $Clr.Muted 690
    $card1.Controls.Add($srcHint)

    # ---- Kort 2: TIL (fase 1: kontonavn, fase 2: ny character) ----
    $card2 = New-Card 366 150
    $card2Head = New-Label '' 16 12 $Fnt.Head $Clr.Accent
    $card2.Controls.Add($card2Head)
    $card2.Controls.Add((New-Label 'Spil' 16 46 $Fnt.Small $Clr.Muted))
    $cbTgtFlavor = New-Combo 16 64 220
    $card2.Controls.Add($cbTgtFlavor)
    $lblTgt = New-Label 'Character' 252 46 $Fnt.Small $Clr.Muted
    $card2.Controls.Add($lblTgt)
    $cbTgtChar = New-Combo 252 64 340
    $card2.Controls.Add($cbTgtChar)
    $txtAccount = New-TextBox 252 64 458
    $txtAccount.CharacterCasing = 'Upper'
    $card2.Controls.Add($txtAccount)
    $btnRefresh = New-Button 'Opdater' 604 62 106 $false
    $btnRefresh.Height = 30
    $card2.Controls.Add($btnRefresh)
    $tgtHint = New-Label '' 16 104 $Fnt.Small $Clr.Muted 690
    $card2.Controls.Add($tgtHint)

    # ---- Kort 3: Indstillinger (fase 1) / realm-navne (fase 2) + opsummering ----
    $card3 = New-Card 528 190
    $chkAddons = New-Check 'Kopiér også addons (Interface-mappen)' 16 12
    $chkAddons.Checked = $true
    $card3.Controls.Add($chkAddons)
    $chkSync = New-Check 'Slå server-synkronisering fra (kun som nødløsning)' 16 38
    $card3.Controls.Add($chkSync)
    $lblSrcRealm = New-Label 'Realm-navn før (fundet automatisk)' 16 8 $Fnt.Small $Clr.Muted
    $txtSrcRealm = New-TextBox 16 28 330
    $lblTgtRealm = New-Label 'Realm-navn nu (fra character select, eller tomt)' 362 8 $Fnt.Small $Clr.Muted
    $txtTgtRealm = New-TextBox 362 28 330
    $card3.Controls.AddRange(@($lblSrcRealm, $txtSrcRealm, $lblTgtRealm, $txtTgtRealm))
    $summary = New-Label '' 16 68 $Fnt.Small $Clr.Muted 690
    $summary.Height = 116
    $card3.Controls.Add($summary)

    # ---- Fremdrift + log ----
    $progressBar = New-Object System.Windows.Forms.ProgressBar
    $progressBar.Location = New-Object System.Drawing.Point(20, 730); $progressBar.Size = New-Object System.Drawing.Size(($W - 40), 8)
    $progressBar.Style = 'Continuous'; $progressBar.Visible = $false
    $form.Controls.Add($progressBar)

    $logBox = New-Object System.Windows.Forms.TextBox
    $logBox.Location = New-Object System.Drawing.Point(20, 746); $logBox.Size = New-Object System.Drawing.Size(($W - 40), 72)
    $logBox.Multiline = $true; $logBox.ReadOnly = $true; $logBox.ScrollBars = 'Vertical'
    $logBox.BackColor = $Clr.Log; $logBox.ForeColor = $Clr.Muted; $logBox.Font = $Fnt.Mono; $logBox.BorderStyle = 'None'
    $form.Controls.Add($logBox)

    # ---- Knapper ----
    $btnGo = New-Button 'Overfør UI' ($W - 20 - 180) 830 180 $true
    $btnClose = New-Button 'Luk' ($W - 20 - 180 - 12 - 100) 830 100 $false
    $btnBackup = New-Button 'Åbn backup-mappe' 20 830 170 $false
    $btnBackup.Visible = $false
    $form.Controls.AddRange(@($btnGo, $btnClose, $btnBackup))
    $form.CancelButton = $btnClose

    $script:Root = $null
    $script:LastResult = $null
    $script:Busy = $false
    $script:WowRunning = Test-WowRunning
    $script:Phase = $Phase
    if (-not $script:Phase) { if ($script:WowRunning) { $script:Phase = '2' } else { $script:Phase = '1' } }

    $setBanner = {
        param([string]$Kind, [string]$Text)
        switch ($Kind) {
            'warn' { $banner.BackColor = [System.Drawing.Color]::FromArgb(58, 48, 26); $banner.ForeColor = $Clr.Warn }
            'err'  { $banner.BackColor = [System.Drawing.Color]::FromArgb(62, 32, 32); $banner.ForeColor = $Clr.Err }
            'ok'   { $banner.BackColor = [System.Drawing.Color]::FromArgb(28, 52, 36); $banner.ForeColor = $Clr.Ok }
            default { $banner.BackColor = $Clr.Card; $banner.ForeColor = $Clr.Muted }
        }
        $banner.Text = $Text
    }
    $log = {
        param([string]$Text)
        $logBox.AppendText("$Text`r`n")
        [System.Windows.Forms.Application]::DoEvents()
    }

    $selectByValue = {
        param($cb, [string[]]$Wanted)
        foreach ($want in $Wanted) {
            $idx = $cb.Tag.IndexOf($want)
            if ($idx -ge 0) { $cb.SelectedIndex = $idx; return }
        }
        if ($cb.Items.Count -gt 0) { $cb.SelectedIndex = 0 }
    }

    $fillFlavors = {
        Clear-Combo $cbSrcFlavor; Clear-Combo $cbTgtFlavor
        if (-not $script:Root) { return }
        foreach ($f in Get-Flavors $script:Root -WithAccounts) { Add-ComboItem $cbSrcFlavor (Get-FlavorLabel $f) $f }
        foreach ($f in Get-Flavors $script:Root) { Add-ComboItem $cbTgtFlavor (Get-FlavorLabel $f) $f }
        & $selectByValue $cbSrcFlavor @('_classic_beta_', '_forever_')
        & $selectByValue $cbTgtFlavor @('_forever_')
    }

    $fillSrcChars = {
        Clear-Combo $cbSrcChar
        $flavor = Get-ComboValue $cbSrcFlavor
        if ($flavor) {
            foreach ($c in Get-Characters $script:Root $flavor | Sort-Object Modified -Descending) { Add-ComboItem $cbSrcChar $c.Label $c }
        }
        if ($cbSrcChar.Items.Count -gt 0) { $cbSrcChar.SelectedIndex = 0 }
    }

    $fillTgtChars = {
        $keep = $null
        $cur = Get-ComboValue $cbTgtChar
        if ($cur) { $keep = $cur.Path }
        Clear-Combo $cbTgtChar
        $srcPath = $null
        $s = Get-ComboValue $cbSrcChar
        if ($s) { $srcPath = $s.Path }
        $flavor = Get-ComboValue $cbTgtFlavor
        if ($flavor) {
            $now = Get-Date
            foreach ($c in Get-Characters $script:Root $flavor | Where-Object { $_.Path -ne $srcPath } | Sort-Object Created -Descending) {
                $label = $c.Label
                if (($now - $c.Created).TotalHours -lt 2) { $label = "$label   ·   NY" }
                Add-ComboItem $cbTgtChar $label $c
            }
        }
        if ($cbTgtChar.Items.Count -gt 0) {
            $cbTgtChar.SelectedIndex = 0
            if ($keep) { for ($i = 0; $i -lt $cbTgtChar.Tag.Count; $i++) { if ($cbTgtChar.Tag[$i].Path -eq $keep) { $cbTgtChar.SelectedIndex = $i } } }
        }
    }

    # Kontonavn: foreslå den senest brugte kontomappe i målet
    $fillAccount = {
        $tf = Get-ComboValue $cbTgtFlavor
        $acc = ''
        if ($script:Root -and $tf) { $acc = @(Get-Accounts $script:Root $tf) | Select-Object -First 1 }
        $txtAccount.Text = [string]$acc
    }

    $fillRealms = {
        $s = Get-ComboValue $cbSrcChar
        $t = Get-ComboValue $cbTgtChar
        $txtSrcRealm.Text = ''
        $txtTgtRealm.Text = ''
        if ($s) { $txtSrcRealm.Text = Find-RealmName $s.AccPath $s.Char }
        if ($t) {
            $tr = Find-TargetRealm $t $s
            if (-not $tr) { $tr = Find-RealmFromLog $script:Root $t.Flavor }
            $txtTgtRealm.Text = $tr
        }
    }

    # Mål-objektet for den valgte fase (konto i fase 1, character i fase 2)
    $getTarget = {
        if ($script:Phase -eq '1') {
            $tf = Get-ComboValue $cbTgtFlavor
            if (-not $script:Root -or -not $tf -or -not $txtAccount.Text.Trim()) { return $null }
            return (Get-TargetAccount $script:Root $tf $txtAccount.Text)
        }
        return (Get-ComboValue $cbTgtChar)
    }

    $updateState = {
        if ($script:Busy) { return }
        $p1 = ($script:Phase -eq '1')
        $src = Get-ComboValue $cbSrcChar
        $tgt = & $getTarget
        $sf = Get-ComboValue $cbSrcFlavor
        $tf = Get-ComboValue $cbTgtFlavor
        $diffFlavor = [bool]($sf -and $tf -and $sf -ne $tf)
        $chkAddons.Enabled = $diffFlavor
        if ($diffFlavor) { $chkAddons.ForeColor = $Clr.Text } else { $chkAddons.ForeColor = $Clr.Muted }

        if ($p1) {
            if ($tgt -and -not $tgt.Exists) { $tgtHint.Text = "Mappen $($tgt.Account) findes ikke endnu og bliver oprettet. Tjek at kontonavnet er stavet rigtigt."; $tgtHint.ForeColor = $Clr.Warn }
            else { $tgtHint.Text = 'Dit kontonavn i WoW Forever (fx C00LPET). Konto-indstillinger lægges her, før du starter spillet.'; $tgtHint.ForeColor = $Clr.Muted }
        } elseif ($cbTgtChar.Items.Count -gt 0) {
            $tgtHint.Text = 'Den nyeste character står øverst. Har du lige oprettet en, er det den.'; $tgtHint.ForeColor = $Clr.Muted
        } else {
            $tgtHint.Text = 'Ingen character fundet her endnu. Opret den i spillet (tryk IKKE Enter World), og tryk så Opdater.'; $tgtHint.ForeColor = $Clr.Warn
        }

        $ready = [bool]($src -and $tgt)
        if ($p1 -and $script:WowRunning) { $ready = $false }
        if ($src -and $tgt) {
            $summary.Text = ((Get-PlanSummary $script:Phase $src $tgt ($chkAddons.Checked -and $diffFlavor) $chkSync.Checked $txtSrcRealm.Text.Trim() $txtTgtRealm.Text.Trim()) | ForEach-Object { "•  $_" }) -join "`n"
        } elseif ($p1) {
            $summary.Text = 'Vælg din gamle character, og skriv dit kontonavn.'
        } else {
            $summary.Text = 'Vælg både en gammel og en ny character.'
        }
        $btnGo.Enabled = $ready
        if ($ready) { $btnGo.BackColor = $Clr.Accent } else { $btnGo.BackColor = $Clr.Border }
    }

    # Har målet allerede addons, er standardvalget IKKE at kopiere beta-versionerne ind over dem.
    $defaultAddons = {
        $chkAddons.Checked = -not (Test-HasAddons $script:Root (Get-ComboValue $cbTgtFlavor))
    }

    $refreshBanner = {
        $script:WowRunning = Test-WowRunning
        if (-not $script:Root) {
            & $setBanner 'err' 'Kunne ikke finde World of Warcraft. Tryk "Skift…" og vælg mappen, der indeholder _forever_.'
        } elseif ($script:Phase -eq '1' -and $script:WowRunning) {
            & $setBanner 'err' 'Spillet kører. Luk WoW helt for at køre fase 1. Står du på character select på launch, så vælg Fase 2.'
        } elseif ($script:Phase -eq '1') {
            & $setBanner 'info' 'Spillet er lukket. Klar til fase 1.'
        } elseif ($script:WowRunning) {
            & $setBanner 'warn' 'WoW kører. Det er OK, så længe du står på character select og ikke har trykket Enter World.'
        } else {
            & $setBanner 'info' 'Klar. Vælg din gamle og din nye character, og tryk "Overfør UI".'
        }
    }

    $setPhase = {
        param([string]$P)
        $script:Phase = $P
        $p1 = ($P -eq '1')
        foreach ($pair in @(@($btnPhase1, $p1), @($btnPhase2, -not $p1))) {
            $b = $pair[0]
            if ($pair[1]) { $b.BackColor = $Clr.Accent; $b.ForeColor = $Clr.OnAcc; $b.FlatAppearance.BorderSize = 0 }
            else { $b.BackColor = $Clr.Field; $b.ForeColor = $Clr.Text; $b.FlatAppearance.BorderSize = 1 }
        }
        if ($p1) {
            $subtitle.Text = 'Før launch, med spillet helt lukket.'
            $card2Head.Text = '2   TIL  ·  din konto i WoW Forever'
            $lblTgt.Text = 'Kontonavn'
            $srcHint.Text = 'Alle characters på samme konto deler Edit Mode, keybinds og indstillinger. Vælg den du brugte mest.'
        } else {
            $subtitle.Text = 'På launch, mens du står på character select.'
            $card2Head.Text = '2   TIL  ·  din nye character'
            $lblTgt.Text = 'Character'
            $srcHint.Text = 'Den du senest har spillet på står øverst.'
        }
        $txtAccount.Visible = $p1
        $cbTgtChar.Visible = -not $p1
        $btnRefresh.Visible = -not $p1
        $chkAddons.Visible = $p1
        $chkSync.Visible = $p1
        foreach ($c in @($lblSrcRealm, $txtSrcRealm, $lblTgtRealm, $txtTgtRealm)) { $c.Visible = -not $p1 }
        $btnBackup.Visible = $false
        $script:LastResult = $null
        & $refreshBanner
        & $updateState
    }

    $setRoot = {
        param([string]$Path)
        if ($Path) { $Path = $Path.TrimEnd('\', '/') }
        if ($Path -and (Test-Path -LiteralPath $Path) -and @(Get-Flavors $Path).Count -gt 0) {
            $script:Root = $Path
            $rootBox.Text = $Path
        } else {
            $script:Root = $null
            $rootBox.Text = ''
        }
        & $fillFlavors
        & $fillSrcChars
        & $fillTgtChars
        & $fillAccount
        & $fillRealms
        & $defaultAddons
        & $updateState
    }

    # ---- Hændelser ----
    $cbSrcFlavor.Add_SelectedIndexChanged({ & $fillSrcChars; & $fillTgtChars; & $fillRealms; & $defaultAddons; & $updateState })
    $cbSrcChar.Add_SelectedIndexChanged({ & $fillTgtChars; & $fillRealms; & $updateState })
    $cbTgtFlavor.Add_SelectedIndexChanged({ & $fillTgtChars; & $fillAccount; & $fillRealms; & $defaultAddons; & $updateState })
    $cbTgtChar.Add_SelectedIndexChanged({ & $fillRealms; & $updateState })
    $txtAccount.Add_TextChanged({ & $updateState })
    $txtSrcRealm.Add_TextChanged({ & $updateState })
    $txtTgtRealm.Add_TextChanged({ & $updateState })
    $chkAddons.Add_CheckedChanged({ & $updateState })
    $chkSync.Add_CheckedChanged({ & $updateState })
    $btnPhase1.Add_Click({ if (-not $script:Busy) { & $setPhase '1' } })
    $btnPhase2.Add_Click({ if (-not $script:Busy) { & $setPhase '2' } })
    $btnRefresh.Add_Click({ $RealmCache.Clear(); & $fillTgtChars; & $fillRealms; & $refreshBanner; & $updateState })
    $btnClose.Add_Click({ $form.Close() })
    $form.Add_Activated({
        if ($script:Busy) { return }
        # Har man logget ud til character select imens, står realm-navnet nu i addon-filerne
        $RealmCache.Clear()
        $t = Get-ComboValue $cbTgtChar
        if ($t -and -not $txtTgtRealm.Text.Trim()) { $txtTgtRealm.Text = Find-TargetRealm $t (Get-ComboValue $cbSrcChar) }
        if (-not $script:LastResult) { & $refreshBanner }
        & $updateState
    })

    $btnBrowse.Add_Click({
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = 'Vælg mappen "World of Warcraft" (den der indeholder _forever_, _classic_beta_ osv.)'
        if ($script:Root) { $dlg.SelectedPath = $script:Root }
        if ($dlg.ShowDialog($form) -eq 'OK') {
            $p = $dlg.SelectedPath
            if ((Split-Path $p -Leaf) -like '_*_') { $p = Split-Path $p -Parent }
            & $setRoot $p
            & $refreshBanner
        }
    })

    $btnBackup.Add_Click({
        if ($script:LastResult -and $script:LastResult.BackupRoot -and (Test-Path -LiteralPath $script:LastResult.BackupRoot)) {
            Start-Process explorer.exe -ArgumentList "`"$($script:LastResult.BackupRoot)`""
        }
    })

    $btnGo.Add_Click({
        $ph = $script:Phase
        $src = Get-ComboValue $cbSrcChar
        $tgt = & $getTarget
        if (-not $src -or -not $tgt) { return }
        $diffFlavor = ($src.Flavor -ne $tgt.Flavor)
        $copyAddons = ($chkAddons.Checked -and $diffFlavor)
        $noSync = $chkSync.Checked
        $srcRealm = $txtSrcRealm.Text.Trim()
        $tgtRealm = $txtTgtRealm.Text.Trim()

        if ($ph -eq '1') {
            if (Test-WowRunning) { & $refreshBanner; & $updateState; return }
            $msg = "Fase 1 kopierer dit UI:`n`n   FRA   $($src.Char)   ($($src.Flavor), konto $($src.Account))`n   TIL   kontoen $($tgt.Account)   ($($tgt.Flavor))`n`n"
        } else {
            $msg = "Fase 2 kopierer dit UI:`n`n   FRA   $($src.Char)   ($($src.Flavor), realm $($src.Realm))`n   TIL   $($tgt.Char)   ($($tgt.Flavor), realm $($tgt.Realm))`n`n"
        }
        $msg += ((Get-PlanSummary $ph $src $tgt $copyAddons $noSync $srcRealm $tgtRealm) | ForEach-Object { "•  $_" }) -join "`n"
        if ($ph -eq '1') { $msg += "`n`nEr WoW helt lukket?" } else { $msg += "`n`nStår du på character select (ikke inde i verden)?" }
        $ans = [System.Windows.Forms.MessageBox]::Show($form, $msg, 'Bekræft overførsel', 'YesNo', 'Question')
        if ($ans -ne 'Yes') { return }

        $script:Busy = $true
        $controls = @($btnGo, $btnClose, $btnBrowse, $btnRefresh, $btnPhase1, $btnPhase2, $cbSrcFlavor, $cbSrcChar, $cbTgtFlavor, $cbTgtChar,
                      $txtAccount, $txtSrcRealm, $txtTgtRealm, $chkAddons, $chkSync)
        foreach ($ctl in $controls) { $ctl.Enabled = $false }
        $btnGo.BackColor = $Clr.Border
        $btnBackup.Visible = $false
        $logBox.Clear()
        $progressBar.Value = 0; $progressBar.Visible = $true
        & $setBanner 'info' 'Overfører... luk ikke vinduet.'
        $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
        [System.Windows.Forms.Application]::DoEvents()
        $before = @(Get-ChildItem -LiteralPath $script:Root -Directory -Filter 'UI-backup-*' | ForEach-Object { $_.FullName })
        try {
            $r = Invoke-Transfer -Phase $ph -Root $script:Root -Src $src -Tgt $tgt -CopyAddons $copyAddons -NoSync $noSync `
                -SrcRealm $srcRealm -TgtRealm $tgtRealm -Log $log `
                -Progress { param($p) $progressBar.Value = [Math]::Min(100, $p); [System.Windows.Forms.Application]::DoEvents() }
            $script:LastResult = $r
            $btnBackup.Visible = $true
            if ($ph -eq '1') {
                & $setBanner 'ok' 'Fase 1 er færdig. Kør fase 2 på launch, når du har oprettet din character.'
                $done = "Fase 1 er færdig.`n`n•  $($r.Files) filer kopieret`n•  $($r.Backups) overskrevne filer gemt i backup`n`nPå launch: log ind, opret din character (tryk IKKE Enter World), og kør så Overfoer-UI.bat igen og vælg Fase 2."
                if ($src.AccPath -ne $tgt.AccPath -and -not $tgt.HasCache) {
                    $done += "`n`nOBS: Spillet har ikke været startet på denne konto på pc'en, så serverens tidspunkter kendes ikke. Mangler Edit Mode eller keybinds, når du er inde i verden: skriv /logout (du kommer ikke i kø), kør fase 2 igen og tryk Enter World."
                }
            } else {
                & $setBanner 'ok' "Færdig! Du kan nu trykke Enter World på $($tgt.Char)."
                $done = "Dit UI er kopieret til $($tgt.Char).`n`n•  $($r.Files) filer kopieret`n•  $($r.Profiles) addons sat op`n•  $($r.Backups) overskrevne filer gemt i backup`n`nDu kan nu trykke Enter World."
                if (-not ($srcRealm -and $tgtRealm)) {
                    $done += "`n`nRealm-navnet manglede, så Titan Panel, X-Perl og AtlasLoot er ikke sat op endnu. Når du er inde i verden: skriv /logout (du kommer ikke i kø), kør fase 2 igen og tryk Enter World. Så findes realmen automatisk, og mangler Edit Mode eller keybinds, kommer de også med."
                }
                else {
                    $done += "`n`nMangler Edit Mode eller keybinds, når du er inde i verden: skriv /logout (du kommer ikke i kø), kør fase 2 igen og tryk Enter World."
                }
                $done += "`n`nMangler der binds eller macros på barerne, så skriv /myslot, vælg din profil og tryk Import."
            }
            [System.Windows.Forms.MessageBox]::Show($form, $done, 'Færdig', 'OK', 'Information') | Out-Null
        } catch {
            $err = $_.Exception.Message
            & $log "FEJL: $err"
            & $setBanner 'err' 'Noget gik galt. Se loggen nedenfor. Filer der nåede at blive overskrevet, ligger i backup.'
            $hint = ''
            if ($_.Exception -is [System.UnauthorizedAccessException] -or $err -match 'denied|nægtet') {
                $hint = "`n`nWindows nægtede adgang. Luk vinduet, højreklik på Overfoer-UI.bat og vælg 'Kør som administrator'."
            }
            [System.Windows.Forms.MessageBox]::Show($form, "Overførslen stoppede:`n`n$err$hint", 'Fejl', 'OK', 'Error') | Out-Null
            $newBackup = @(Get-ChildItem -LiteralPath $script:Root -Directory -Filter 'UI-backup-*' | Where-Object { $before -notcontains $_.FullName } | Select-Object -First 1)
            if ($newBackup.Count -gt 0) {
                $script:LastResult = [pscustomobject]@{ BackupRoot = $newBackup[0].FullName }
                $btnBackup.Visible = $true
            }
        } finally {
            $form.Cursor = [System.Windows.Forms.Cursors]::Default
            $script:Busy = $false
            foreach ($ctl in $controls) { $ctl.Enabled = $true }
            & $updateState
        }
    })

    # ---- Start ----
    $initial = $WowRoot
    if (-not $initial) { $initial = Find-WowRoot }
    & $setRoot $initial
    & $setPhase $script:Phase
    & $log 'Klar. Intet bliver ændret, før du trykker "Overfør UI" og bekræfter.'
    [void]$form.ShowDialog()
    $form.Dispose()
}

# =====================================================================================
#  START
# =====================================================================================

$guiPossible = $false
if (-not $NoGui -and -not $Yes -and ($IsWindows -ne $false)) {
    try { Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop; $guiPossible = $true } catch { }
}

if ($guiPossible) {
    try {
        Start-Gui
    } catch {
        try { [System.Windows.Forms.MessageBox]::Show("Der opstod en uventet fejl:`n`n$($_.Exception.Message)`n`nPrøv evt. konsol-versionen: Overfoer-UI (konsol).bat", $AppTitle, 'OK', 'Error') | Out-Null } catch { }
        exit 1
    }
} else {
    try {
        exit (Start-Console)
    } catch {
        Write-Host ""
        Write-Host "FEJL: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception -is [System.UnauthorizedAccessException] -or $_.Exception.Message -match 'denied|nægtet') {
            Write-Host "Windows nægtede adgang. Højreklik på .bat-filen og vælg 'Kør som administrator'." -ForegroundColor Yellow
        }
        exit 1
    }
}
