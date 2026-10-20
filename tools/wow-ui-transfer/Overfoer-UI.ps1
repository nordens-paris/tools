<#
  Overfoer-UI.ps1  -  WoW Forever UI-overførsel

  Flytter dit UI (addons, addon-profiler, keybinds, macros, Edit Mode, chat) fra Beta/Stresstest
  til din nye character på launch.

  Brug:
    1. Opret din character i spillet. Tryk IKKE "Enter World".
    2. Dobbeltklik på Overfoer-UI.bat (spillet må gerne stå åbent på character select).
    3. Vælg din gamle character og din nye character, og tryk "Overfør UI".
    4. Tryk Enter World.

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
    [string]$SourceFlavor,
    [string]$TargetFlavor,
    [string]$SourceChar,
    [string]$TargetChar,
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

# Alle spilmapper (_forever_, _classic_beta_ ...). -WithAccounts: kun dem der har et WTF\Account.
function Get-Flavors([string]$Root, [switch]$WithAccounts) {
    if (-not $Root -or -not (Test-Path -LiteralPath $Root)) { return @() }
    $all = @(Get-ChildItem -LiteralPath $Root -Directory | Where-Object { $_.Name -like '_*_' } | ForEach-Object { $_.Name })
    if ($WithAccounts) {
        $all = @($all | Where-Object { Test-Path -LiteralPath (Join-Path $Root "$_\WTF\Account") })
    }
    return $all
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

# Beskriver hvad der kommer til at ske (bruges til opsummering i både vindue og konsol).
function Get-PlanSummary($Src, $Tgt, [bool]$CopyAddons, [bool]$NoSync) {
    $sameFlavor = ($Src.Flavor -eq $Tgt.Flavor)
    $sameAccount = ($sameFlavor -and $Src.Account -eq $Tgt.Account)
    $lines = @()
    if (-not $sameFlavor -and $CopyAddons) { $lines += "Addons kopieres fra $($Src.Flavor) til $($Tgt.Flavor)" }
    if (-not $sameFlavor) { $lines += "Grafik- og lydindstillinger kopieres (uden beta-loginlinjer)" }
    if (-not $sameAccount) { $lines += "Konto-indstillinger kopieres: addons, keybinds, macros, Edit Mode" }
    $lines += "Character-indstillinger kopieres: $($Src.Char)  ->  $($Tgt.Char)"
    $lines += "Addon-profiler for $($Src.Char) bliver valgt på $($Tgt.Char)"
    if ($NoSync) { $lines += "Server-synkronisering slås fra (nødløsning)" }
    $lines += "Intet slettes. Overskrevne filer gemmes i en backup-mappe."
    return $lines
}

# Udfører overførslen. $Log og $Progress er scriptblocks, så vinduet og konsollen kan vise fremdrift.
function Invoke-Transfer {
    param(
        [string]$Root, $Src, $Tgt,
        [bool]$CopyAddons, [bool]$NoSync,
        [scriptblock]$Log, [scriptblock]$Progress
    )
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

    if ($Src.Path -eq $Tgt.Path) { throw "Kilde og mål er den samme character." }

    $srcBase = Join-Path $Root $Src.Flavor
    $tgtBase = Join-Path $Root $Tgt.Flavor
    $sameFlavor = ($Src.Flavor -eq $Tgt.Flavor)
    $sameAccount = ($sameFlavor -and $Src.Account -eq $Tgt.Account)

    & $say "Fra: $($Src.Flavor)\$($Src.Account)\$($Src.Realm)\$($Src.Char)"
    & $say "Til: $($Tgt.Flavor)\$($Tgt.Account)\$($Tgt.Realm)\$($Tgt.Char)"

    # ---- Saml alle fil-kopieringer først, så fremdriften kan vises korrekt ----
    $ops = New-Object System.Collections.Generic.List[object]
    $addTree = {
        param([string]$From, [string]$To, [string[]]$SkipTopDirs)
        foreach ($f in Get-ChildItem -LiteralPath $From -Recurse -File -Force) {
            $rel = $f.FullName.Substring($From.Length).TrimStart('\', '/')
            $top = ($rel -split '[\\/]')[0]
            if ($SkipTopDirs -and ($SkipTopDirs -contains $top) -and $rel -ne $top) { continue }
            $ops.Add(@($f.FullName, (Join-Path $To $rel)))
        }
    }

    if (-not $sameFlavor -and $CopyAddons) {
        $srcInterface = Join-Path $srcBase 'Interface'
        if (Test-Path -LiteralPath $srcInterface) { & $addTree $srcInterface (Join-Path $tgtBase 'Interface') @() }
    }
    if (-not $sameAccount) {
        $realmDirs = @(Get-ChildItem -LiteralPath $Src.AccPath -Directory | Where-Object { $_.Name -ne 'SavedVariables' } | ForEach-Object { $_.Name })
        & $addTree $Src.AccPath $Tgt.AccPath $realmDirs
    }
    & $addTree $Src.Path $Tgt.Path @()

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
    if ($Progress) { & $Progress 85 }

    # ---- Addon-profiler (AceDB profileKeys) ----
    # I WoW Forever ser nøglerne ud som ["Fornavn Efternavn"] = "Profil" (mellemrum, ingen realm).
    $srcSpace = $Src.Char -replace '-', ' '
    $tgtSpace = $Tgt.Char -replace '-', ' '
    $keyMap = @{}
    $keyMap[$srcSpace] = $tgtSpace
    $keyMap[$Src.Char] = $Tgt.Char
    $keyMap["$($Src.Char) - $($Src.Realm)"] = "$($Tgt.Char) - $($Tgt.Realm)"
    $keyMap["$srcSpace - $($Src.Realm)"] = "$tgtSpace - $($Tgt.Realm)"
    $svDir = Join-Path $Tgt.AccPath 'SavedVariables'
    if (Test-Path -LiteralPath $svDir) {
        $blockPattern = '(?s)\["profileKeys"\] = \{.*?\n[ \t]*\}'
        $linePattern = '(?m)^([ \t]*)\["((?:[^"\\\r\n]|\\.)*)"\] = ("(?:[^"\\\r\n]|\\.)*"),(\r?)$'
        $names = @()
        foreach ($file in Get-ChildItem -LiteralPath $svDir -Filter '*.lua' -File) {
            $text = [IO.File]::ReadAllText($file.FullName, $Utf8NoBom)
            if (-not $text.Contains('["profileKeys"]')) { continue }
            $new = [regex]::Replace($text, $blockPattern, {
                param($block)
                $b = $block.Value
                $added = @{}
                [regex]::Replace($b, $linePattern, {
                    param($m)
                    $old = $m.Groups[2].Value
                    if (-not $keyMap.ContainsKey($old)) { return $m.Value }
                    $nk = $keyMap[$old]
                    if ($nk -eq $old -or $added.ContainsKey($nk) -or $b.Contains('["' + $nk + '"] = ')) { return $m.Value }
                    $added[$nk] = $true
                    return $m.Value + "`n" + $m.Groups[1].Value + '["' + $nk + '"] = ' + $m.Groups[3].Value + ',' + $m.Groups[4].Value
                })
            })
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
    if ($Progress) { & $Progress 95 }

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

    & $say "Færdig. $($state.Files) filer kopieret, $($state.Backups) filer gemt i backup."

    # ---- Log gemmes i backup-mappen ----
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $logPath = Join-Path $backupRoot 'overfoersel-log.txt'
    [IO.File]::WriteAllLines($logPath, [string[]]$state.LogLines, $Utf8NoBom)
    if ($Progress) { & $Progress 100 }

    return [pscustomobject]@{
        Files = $state.Files; Backups = $state.Backups; Profiles = $state.Profiles
        BackupRoot = $backupRoot; LogPath = $logPath; TargetPath = $Tgt.Path
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

function Start-Console {
    Write-Host "=== $AppTitle ===" -ForegroundColor Green
    if (Test-WowRunning) {
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

    $tgtChars = @(Get-Characters $root $tf | Where-Object { $_.Path -ne $src.Path } | Sort-Object Created -Descending)
    if ($TargetChar) { $tgtChars = @($tgtChars | Where-Object { $_.Char -eq $TargetChar }) }
    if ($tgtChars.Count -eq 0) { throw "Fandt ingen ny character i $tf. Opret din character i spillet først (tryk ikke Enter World), og kør så scriptet igen." }
    $tgt = Select-FromList "Vælg din NYE character (nyeste øverst)" $tgtChars { param($x) $x.Label } 0

    $copyAddons = $false
    if ($sf -ne $tf) {
        if ($CopyInterface -eq 'yes') { $copyAddons = $true }
        elseif ($CopyInterface -eq 'ask') { $copyAddons = Confirm-Console "Kopiér også dine addons?" }
    }

    Write-Host ""
    Write-Host "Det her sker:" -ForegroundColor Cyan
    Get-PlanSummary $src $tgt $copyAddons $DisableSync.IsPresent | ForEach-Object { Write-Host "  - $_" }
    if (-not (Confirm-Console "Fortsæt?")) { Write-Host "Afbrudt. Intet er ændret."; return 1 }

    $r = Invoke-Transfer -Root $root -Src $src -Tgt $tgt -CopyAddons $copyAddons -NoSync $DisableSync.IsPresent `
        -Log { param($t) Write-Host "  $t" } -Progress $null
    Write-Host ""
    Write-Host "Færdig! Du kan nu trykke 'Enter World'." -ForegroundColor Green
    Write-Host "  Backup og log: $($r.BackupRoot)"
    Write-Host "  Mangler binds eller macros på barerne: /myslot -> vælg profil -> Import."
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
    $form.Controls.Add((New-Label 'Tag addons, keybinds, macros, Edit Mode og chat med til din nye character.' 22 52 $Fnt.Sub $Clr.Muted))

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
    $srcHint = New-Label 'Den du senest har spillet på står øverst.' 16 104 $Fnt.Small $Clr.Muted 690
    $card1.Controls.Add($srcHint)

    # ---- Kort 2: TIL ----
    $card2 = New-Card 366 150
    $card2.Controls.Add((New-Label '2   TIL  ·  din nye character' 16 12 $Fnt.Head $Clr.Accent))
    $card2.Controls.Add((New-Label 'Spil' 16 46 $Fnt.Small $Clr.Muted))
    $cbTgtFlavor = New-Combo 16 64 220
    $card2.Controls.Add($cbTgtFlavor)
    $card2.Controls.Add((New-Label 'Character' 252 46 $Fnt.Small $Clr.Muted))
    $cbTgtChar = New-Combo 252 64 340
    $card2.Controls.Add($cbTgtChar)
    $btnRefresh = New-Button 'Opdater' 604 62 106 $false
    $btnRefresh.Height = 30
    $card2.Controls.Add($btnRefresh)
    $tgtHint = New-Label '' 16 104 $Fnt.Small $Clr.Muted 690
    $card2.Controls.Add($tgtHint)

    # ---- Kort 3: Indstillinger + opsummering ----
    $card3 = New-Card 528 190
    $chkAddons = New-Check 'Kopiér også addons (Interface-mappen)' 16 12
    $chkAddons.Checked = $true
    $card3.Controls.Add($chkAddons)
    $chkSync = New-Check 'Slå server-synkronisering fra (kun som nødløsning)' 16 38
    $card3.Controls.Add($chkSync)
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
            $tgtHint.Text = 'Den nyeste character står øverst. Har du lige oprettet en, er det den.'
            $tgtHint.ForeColor = $Clr.Muted
        } else {
            $tgtHint.Text = 'Ingen character fundet her endnu. Opret den i spillet (tryk IKKE Enter World), og tryk så Opdater.'
            $tgtHint.ForeColor = $Clr.Warn
        }
    }

    $updateState = {
        if ($script:Busy) { return }
        $src = Get-ComboValue $cbSrcChar
        $tgt = Get-ComboValue $cbTgtChar
        $sf = Get-ComboValue $cbSrcFlavor
        $tf = Get-ComboValue $cbTgtFlavor
        $diffFlavor = [bool]($sf -and $tf -and $sf -ne $tf)
        $chkAddons.Enabled = $diffFlavor
        if ($diffFlavor) { $chkAddons.ForeColor = $Clr.Text } else { $chkAddons.ForeColor = $Clr.Muted }
        if ($src -and $tgt) {
            $summary.Text = ((Get-PlanSummary $src $tgt ($chkAddons.Checked -and $diffFlavor) $chkSync.Checked) | ForEach-Object { "•  $_" }) -join "`n"
            $btnGo.Enabled = $true
            $btnGo.BackColor = $Clr.Accent
        } else {
            $summary.Text = 'Vælg både en gammel og en ny character.'
            $btnGo.Enabled = $false
            $btnGo.BackColor = $Clr.Border
        }
    }

    # Har målet allerede addons (fx kopieret og opdateret i CurseForge før launch), så er
    # standardvalget IKKE at kopiere beta-versionerne ind over dem.
    $defaultAddons = {
        $tf = Get-ComboValue $cbTgtFlavor
        $hasAddons = $false
        if ($script:Root -and $tf) {
            $addonDir = Join-Path $script:Root "$tf\Interface\AddOns"
            $hasAddons = (Test-Path -LiteralPath $addonDir) -and (@(Get-ChildItem -LiteralPath $addonDir -Directory).Count -gt 0)
        }
        $chkAddons.Checked = -not $hasAddons
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
        & $defaultAddons
        & $updateState
    }

    $refreshBanner = {
        if (-not $script:Root) {
            & $setBanner 'err' 'Kunne ikke finde World of Warcraft. Tryk "Skift…" og vælg mappen, der indeholder _forever_.'
        } elseif (Test-WowRunning) {
            & $setBanner 'warn' 'WoW kører. Det er OK, så længe du står på character select og ikke har trykket Enter World.'
        } else {
            & $setBanner 'info' 'Klar. Vælg din gamle og din nye character, og tryk "Overfør UI".'
        }
    }

    # ---- Hændelser ----
    $cbSrcFlavor.Add_SelectedIndexChanged({ & $fillSrcChars; & $fillTgtChars; & $defaultAddons; & $updateState })
    $cbSrcChar.Add_SelectedIndexChanged({ & $fillTgtChars; & $updateState })
    $cbTgtFlavor.Add_SelectedIndexChanged({ & $fillTgtChars; & $defaultAddons; & $updateState })
    $cbTgtChar.Add_SelectedIndexChanged({ & $updateState })
    $chkAddons.Add_CheckedChanged({ & $updateState })
    $chkSync.Add_CheckedChanged({ & $updateState })
    $btnRefresh.Add_Click({ & $fillTgtChars; & $refreshBanner; & $updateState })
    $btnClose.Add_Click({ $form.Close() })
    $form.Add_Activated({ if (-not $script:Busy -and -not $script:LastResult) { & $refreshBanner } })

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
        $src = Get-ComboValue $cbSrcChar
        $tgt = Get-ComboValue $cbTgtChar
        if (-not $src -or -not $tgt) { return }
        $diffFlavor = ($src.Flavor -ne $tgt.Flavor)
        $copyAddons = ($chkAddons.Checked -and $diffFlavor)
        $noSync = $chkSync.Checked

        $msg = "Du er ved at kopiere dit UI:`n`n   FRA   $($src.Char)   ($($src.Flavor), realm $($src.Realm))`n   TIL   $($tgt.Char)   ($($tgt.Flavor), realm $($tgt.Realm))`n`n"
        $msg += ((Get-PlanSummary $src $tgt $copyAddons $noSync) | ForEach-Object { "•  $_" }) -join "`n"
        $msg += "`n`nHar du IKKE trykket Enter World på $($tgt.Char) endnu?"
        $ans = [System.Windows.Forms.MessageBox]::Show($form, $msg, 'Bekræft overførsel', 'YesNo', 'Question')
        if ($ans -ne 'Yes') { return }

        $script:Busy = $true
        $controls = @($btnGo, $btnClose, $btnBrowse, $btnRefresh, $cbSrcFlavor, $cbSrcChar, $cbTgtFlavor, $cbTgtChar, $chkAddons, $chkSync)
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
            $r = Invoke-Transfer -Root $script:Root -Src $src -Tgt $tgt -CopyAddons $copyAddons -NoSync $noSync `
                -Log $log -Progress { param($p) $progressBar.Value = [Math]::Min(100, $p); [System.Windows.Forms.Application]::DoEvents() }
            $script:LastResult = $r
            & $setBanner 'ok' "Færdig! Du kan nu trykke Enter World på $($tgt.Char)."
            $btnBackup.Visible = $true
            $done = "Dit UI er kopieret til $($tgt.Char).`n`n•  $($r.Files) filer kopieret`n•  $($r.Profiles) addon-profiler sat op`n•  $($r.Backups) overskrevne filer gemt i backup`n`nDu kan nu trykke Enter World.`n`nMangler der binds eller macros på barerne, så skriv /myslot, vælg din profil og tryk Import."
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
    & $refreshBanner
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
