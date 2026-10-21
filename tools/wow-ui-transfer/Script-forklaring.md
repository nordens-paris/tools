# Hvad Overfoer-UI gør, trin for trin

Der er tre filer:
- **`Overfoer-UI.bat`** er starteren. Den tjekker, at zip-filen er pakket ud, og åbner vinduet via PowerShell. `-ExecutionPolicy Bypass` gælder kun for netop denne kørsel og ændrer ingen indstillinger på din pc.
- **`Overfoer-UI (konsol).bat`** gør det samme uden vindue, med spørgsmål i et sort konsolvindue. Den er en reserve, hvis vinduet ikke vil åbne.
- **`Overfoer-UI.ps1`** er selve scriptet. Det er almindelig tekst, så du kan åbne det i Notepad og læse det. Vinduet og konsollen bruger præcis den samme kopi-logik.

## To faser
| | Fase 1: før launch | Fase 2: på launch |
|---|---|---|
| Spillet | Skal være **helt lukket** | Må gerne stå på **character select** |
| Mål | Din konto (du skriver kontonavnet) | Din nye character |
| Kopierer | Addons, grafik og lyd, Edit Mode, keybinds, macros, interface- og addon-indstillinger | Character-mappen (chat, character-keybinds og -macros, valgt Edit Mode-layout ...) |
| Bagefter | | Addon-profiler og realm-indstillinger sættes op |

Opdelingen skyldes, hvornår spillet læser filerne. Konto-filerne indlæses, når du logger ind (og en del af dem ved Enter World), og grafik og lyd (`Config.wtf`) gemmes, når spillet lukker. Character-filerne og addon-indstillingerne indlæses først ved Enter World, så de kan kopieres, mens du står på character select.

## Vinduet
- **Fase 1 / Fase 2** øverst til højre. Kører WoW, åbner vinduet i fase 2, ellers i fase 1.
- **Statuslinjen** siger, om WoW kører, om WoW-mappen ikke blev fundet, og når alt er færdigt. I fase 1 er den rød og knappen låst, så længe spillet kører.
- **WoW-mappe** findes automatisk. Med **Skift…** kan du vælge en anden.
- **1 FRA**: spil og gammel character. Den senest spillede står øverst.
- **2 TIL**:
  - Fase 1: spil og **kontonavn**. Udfyldes med den senest brugte kontomappe. Findes mappen ikke, bliver den oprettet, og vinduet beder dig tjekke stavningen.
  - Fase 2: spil og ny character. Den nyest oprettede står øverst, og en character oprettet inden for de sidste 2 timer er markeret **NY**. **Opdater** genindlæser listen.
- **Indstillinger** (fase 1): "Kopiér også addons" (kun hvis målet ikke allerede har addons) og "Slå server-synkronisering fra" (fra som standard, kun en nødløsning).
- **Realm-navne** (fase 2): se afsnit 7.
- **Opsummeringen** viser altid, hvad der vil ske med de valg, der er lavet.
- **Overfør UI** viser først en bekræftelse. Under kopieringen er alle knapper låst, og der vises en fremdriftslinje og en log. Til sidst kommer en besked, og knappen **Åbn backup-mappe** dukker op.

## Grundregler
- **Intet slettes eller flyttes.** Scriptet bruger kun kopiering.
- **Backup før overskrivning.** Før en fil i målet bliver overskrevet, kopieres den til `<WoW-mappe>\UI-backup-<dato-tid>\` med samme undermapper. Hvis noget går galt, kan du kopiere filerne derfra tilbage.
- **Kilden røres ikke.** Der bliver kun læst fra fx `_classic_beta_`.
- **Kun inden for WoW-mappen.** Scriptet skriver ikke andre steder.
- **Intet sker, før du bekræfter.** I vinduet trykker du *Overfør UI* og så *Ja*. I konsollen skriver du `j`. Fortryder du, er intet ændret.
- **Ingen internetadgang og ingen installation.**

## 1. Find WoW-mappen
1. Først læses Battle.net's registreringsnøgle (`HKLM\SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft` → `InstallPath`). Den læses kun og ændres ikke.
2. Virker det ikke, prøves de almindelige stier: `C:\Program Files (x86)\World of Warcraft`, `C:\Program Files\...`, `D:\World of Warcraft`, `D:\Games\...` og `E:\...`.
3. Finder det stadig ikke mappen, viser vinduet en rød statuslinje, og du vælger mappen med **Skift…**. Konsollen beder dig indsætte stien.

Scriptet ser efter en proces, der hedder noget med `Wow` (fx `Wow.exe`), for at vide om spillet kører.

## 2. Fase 1: kopiering (spillet lukket)
Kopieringen **fletter**. Hver fil fra kilden lægges ind på samme sted i målet. Filer der kun findes i målet, får lov at blive. Overskrives en fil, tages der først backup af den.

**a) Addons** (kun mellem to forskellige spilmapper, fx beta → forever): hele `<kilde>\Interface` kopieres ind i `<mål>\Interface`. Fluebenet er kun sat som standard, hvis målet ikke allerede har addons, så opdaterede addons ikke overskrives af beta-versionerne.

**b) Grafik og lyd (`WTF\Config.wtf`)** (kun mellem forskellige spilmapper):
- Kildens linjer kopieres, **bortset fra** login-linjerne `portal`, `realmList`, `realmListbn`, `realmName`, `lastCharacterIndex`, `lastSelectedRealm`, `accountName`, `accountList` og `gxApi`.
- Målets egne login-linjer beholdes, så launch-klienten stadig logger ind på den rigtige server og ikke på beta.

**c) Konto-filer**: alle filer direkte i `<kilde-konto>\` kopieres til `<mål>\WTF\Account\<KONTONAVN>\`. Det er fx `edit-mode-cache-account.txt` (Edit Mode-layouts), `config-cache.wtf` (interface-indstillinger), `bindings-cache.wtf`, `macros-cache.txt` og `cache.md5`. Undtagelsen er `character-list-order.txt` (rækkefølgen på character select), der hører til den gamle konto. Desuden kopieres `<kilde-konto>\SavedVariables\`, altså de konto-brede addon-indstillinger.

## 3. Serverens synkronisering og `cache.md5`
Spillet gemmer konto-indstillingerne både på disken og på serveren. `cache.md5` holder styr på, hvornår hver fil sidst blev gemt: 24 bytes pr. fil = MD5 af filen, tidspunktet (unix-tid) og 4 ekstra bytes. I `_forever_\Logs\AccountData.log` kan man se, hvad spillet gør ved login og Enter World:
```
Data Type 0: Server Save Time 1792607558, Local Save Time 1792418430
Requesting Data Download: Type 0
...
Data Type 0: Server Save Time 1792607558, Local Save Time 1792607558
Loading Data From File: Type 0
```
- Er tidspunkterne **ens**, bruger spillet filen på disken.
- Er de **forskellige**, henter spillet serverens version. Det gælder også, når filen på disken er nyest.
- Har serveren ingen kopi (tidspunkt 0), bruger spillet filen på disken.

Kopierede beta-filer har betaens tidspunkter og taber derfor altid til serveren. Efter kopieringen giver scriptet derfor hver kopieret fil **serverens tidspunkt** fra målets gamle `cache.md5`, sammen med filens egen MD5. Posterne for filer, der ikke blev kopieret, tages uændret fra målets gamle `cache.md5`. Målets `cache.md5` indeholder serverens tidspunkter fra sidste gang, spillet var åbent, og derfor må spillet ikke startes mellem fase 1 og launch.

Det samme gøres for character-mappens `cache.md5` i fase 2.

## 4. Fase 2: vælg din nye character
1. Du vælger spilmappen. *WoW Forever (_forever_)* er standard.
2. Du får vist alle characters i den spilmappe, sorteret efter hvornår mappen blev oprettet. Kildens egen character er ikke med på listen.
3. Er der ingen character endnu, siger vinduet det og beder dig oprette den og trykke **Opdater**.
4. Peger kilde og mål på samme mappe, stopper scriptet.

## 5. Fase 2: kopiering
Alt indhold i den gamle character-mappe kopieres ind i den nye. Det dækker character-macros, keybinds, `chat-cache.txt`, `layout-local.txt`, valgt Edit Mode-layout og character-addon-indstillinger i `SavedVariables`. Bagefter sættes tidspunkterne i `cache.md5` som beskrevet i afsnit 3.

Vinduet advarer, hvis fase 1 ikke ser ud til at være kørt, dvs. hvis under halvdelen af kildens addon-filer findes i målkontoen.

## 6. Addon-profiler
Mange addons (dem der bruger AceDB, fx Dominos, Quartz, Prat og OmniCC) gemmer i en `["profileKeys"]`-blok, hvilken profil hver character bruger:
```lua
["profileKeys"] = {
["Darkfade Test"] = "Warrior",
["Darkfade Speedy"] = "Warrior",
},
```
For hver `.lua`-fil i målkontoens `SavedVariables`:
1. Scriptet kigger **kun inde i `["profileKeys"]`-blokke**.
2. Det finder linjen for din gamle character: `"Fornavn Efternavn"` og `"Fornavn-Efternavn"`, og når realm-navnene kendes, også `"Fornavn - Realm"` (fx AtlasLoot: `"Darkfade - Classic Beta PvE 2"`). Fornavnet er det, spillet selv kalder characteren.
3. Står den nye character allerede i blokken (fx fordi addonnet har lavet en standardprofil ved første login), får den samme profil som den gamle. Ellers indsættes en ny linje lige under den gamle.
4. Den gamle linje bliver stående. Køres scriptet igen, ændres intet.
5. Filen backes op, før den gemmes med de samme linjeskift (CRLF) og uden BOM, ligesom WoW selv skriver den.

## 7. Realm-navne (Titan Panel, X-Perl, AtlasLoot)
WTF-mapperne bruger realm-numre (fx `70` og `93`), men nogle addons gemmer under realm-**navnet**:
- **Titan Panel:** `TitanSettings.Players["Fornavn Efternavn@Realm"]`
- **X-Perl:** `ZPerlConfigNew["Realm"]["Fornavn"]` (frame-positioner)
- **AtlasLoot:** `profileKeys["Fornavn - Realm"]`

Scriptet kopierer den gamle characters blok over under den nye characters nøgle. Findes den nye nøgle allerede, erstattes den.

Kildens realm-navn findes automatisk i kildens addon-filer: først `"Fornavn Efternavn@Realm"`, ellers det hyppigste `"Fornavn - Realm"`.

Den nye characters realm-navn står **ingen steder på disken, før du har trykket Enter World**. Spillets logfiler og glue-filer bliver først skrevet ved Enter World eller når spillet lukker. Derfor:
- Skriv navnet fra character select, eller
- lad feltet stå tomt, tryk Enter World, skriv `/logout` (ingen kø) og kør fase 2 igen. Nu står navnet i addon-filerne. Det findes via Titan Panels `"Fornavn Efternavn@Realm"`, eller ellers via `"Fornavn - Realm"`-nøgler med realms, der ikke også findes i kildens filer (fornavnet kan deles med gamle characters). Vinduet prøver igen, hver gang det får fokus, hvis feltet er tomt.

`/reload` kan ikke bruges i stedet for `/logout`: ved en reload gemmer spillet først sine egne addon-indstillinger og overskriver dermed scriptets ændringer.

## 8. Valgfrit: slå server-synkronisering fra
Det sker kun, hvis du sætter flueben i fase 1 (eller starter konsollen med `-DisableSync`). Så bliver `SET synchronizeConfig/Settings/Bindings/Macros "0"` skrevet i målets `Config.wtf`, så spillet bruger de lokale filer i stedet for serverens. Det er en nødløsning og burde ikke være nødvendig efter afsnit 3.

## 9. Afslutning
En log over alt, hvad der blev gjort, gemmes som `overfoersel-log.txt` i backup-mappen.

Opstår der en fejl undervejs, stopper scriptet med det samme og viser fejlen. Siger fejlen "adgang nægtet", foreslår det at køre `.bat` som administrator. Filer der nåede at blive kopieret, er stadig kopieret, men backuppen af det de overskrev, ligger i `UI-backup-...`. Du kan bare køre scriptet igen.

## Sådan fortryder du
1. Luk WoW.
2. Kopier indholdet af `UI-backup-<dato-tid>\` tilbage til WoW-mappen og vælg "Erstat".
3. Filer der var helt nye (ikke overskrevne), kan du slette i hånden. Det er typisk dem i den nye character-mappe.

## Testet
- Begge faser er testet på WoW Forever-stresstesten 21/10-2026 (beta → stresstest): Edit Mode, interface-indstillinger, keybinds, macros og addon-profiler kom med. `AccountData.log` viste `Loading Data From File` for alle typer.
- Kørsel af fase 2 igen efter første login (overskrivning af Titan Panel, X-Perl og AtlasLoot) er testet på kopier af de rigtige filer, ikke i spillet.

## Kendte begrænsninger
- Addons med deres eget profilformat (ikke AceDB og ikke de tre ovenfor) skal stadig have valgt profil manuelt.
- Startes spillet mellem fase 1 og launch, gemmer serveren nye tidspunkter, og så skal fase 1 køres igen.
