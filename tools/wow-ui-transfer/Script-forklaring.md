# Hvad Overfoer-UI gør, trin for trin

Der er tre filer:
- **`Overfoer-UI.bat`** er starteren. Den tjekker, at zip-filen er pakket ud, og åbner vinduet via PowerShell. `-ExecutionPolicy Bypass` gælder kun for netop denne kørsel og ændrer ingen indstillinger på din pc.
- **`Overfoer-UI (konsol).bat`** gør det samme uden vindue, med spørgsmål i et sort konsolvindue. Den er en reserve, hvis vinduet ikke vil åbne.
- **`Overfoer-UI.ps1`** er selve scriptet. Det er almindelig tekst, så du kan åbne det i Notepad og læse det. Vinduet og konsollen bruger præcis den samme kopi-logik.

## Vinduet
- **Statuslinjen** øverst siger, om WoW kører (det er OK på character select), om WoW-mappen ikke blev fundet, og når alt er færdigt.
- **WoW-mappe** findes automatisk. Med **Skift…** kan du vælge en anden.
- **1 FRA**: spil og gammel character. Den senest spillede står øverst.
- **2 TIL**: spil og ny character. Den nyest oprettede står øverst, og en character oprettet inden for de sidste 2 timer er markeret **NY**. **Opdater** genindlæser listen, hvis du opretter din character, mens vinduet er åbent.
- **Indstillinger**: "Kopiér også addons" (kun aktiv mellem to forskellige spil) og "Slå server-synkronisering fra" (fra som standard, kun en nødløsning).
- **Opsummeringen** viser altid, hvad der vil ske med de valg, der er lavet.
- **Overfør UI** viser først en bekræftelse. Under kopieringen er alle knapper låst, og der vises en fremdriftslinje og en log. Til sidst kommer en besked med antal filer, profiler og backups, og knappen **Åbn backup-mappe** dukker op.

## Grundregler
- **Intet slettes eller flyttes.** Scriptet bruger kun kopiering.
- **Backup før overskrivning.** Før en fil i målet bliver overskrevet, kopieres den til `<WoW-mappe>\UI-backup-<dato-tid>\` med samme undermapper. Hvis noget går galt, kan du kopiere filerne derfra tilbage.
- **Kilden røres ikke.** Der bliver kun læst fra fx `_classic_beta_`.
- **Kun inden for WoW-mappen.** Scriptet skriver ikke andre steder.
- **Intet sker, før du bekræfter.** I vinduet trykker du *Overfør UI* og så *Ja*. I konsollen skriver du `j`. Fortryder du, er intet ændret.
- **Ingen internetadgang og ingen installation.**

## 0. Før første start (gøres i hånden, se guiden)
Kommer dit UI fra en anden spilmappe (fx beta), skal `Interface` og `WTF\Config.wtf` kopieres over, **før spillet startes første gang**. Addons bliver kun fundet, når spillet starter, og spillet skriver sin egen `Config.wtf`, når det lukker. Så er grafik, lyd og addons indlæst fra start, inden resten af `WTF` bliver overført.

## 1. Tjek om WoW kører
Scriptet ser efter en proces der hedder noget med `Wow` (fx `Wow.exe` eller `WowB.exe`). Kører spillet, viser vinduet en gul statuslinje, og konsollen spørger, om du står på character select. Det er tilladt, fordi spillet først læser character-filerne, når du trykker Enter World.

Kører spillet, og kopierer du mellem to forskellige spilmapper, sker der desuden to ting:
- Ligger der ingen addons i målets `Interface\AddOns`, advarer statuslinjen (og konsollen) om, at Del 2 trin 4 i guiden ikke er gjort, og beder dig lukke spillet helt først. Din character er jo allerede oprettet, så scriptet kan sagtens køre med spillet lukket.
- `Config.wtf` springes over (se 6b), fordi spillet overskriver den, når det lukker.

## 2. Find WoW-mappen
1. Først læses Battle.net's registreringsnøgle (`HKLM\SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft` → `InstallPath`). Den læses kun og ændres ikke.
2. Virker det ikke, prøves de almindelige stier: `C:\Program Files (x86)\World of Warcraft`, `C:\Program Files\...`, `D:\World of Warcraft`, `D:\Games\...` og `E:\...`.
3. Finder det stadig ikke mappen, viser vinduet en rød statuslinje, og du vælger mappen med **Skift…**. Konsollen beder dig indsætte stien.

## 3. Vælg kilden (hvor du lavede dit UI)
Du får vist de spilmapper, der har et `WTF\Account`, fx *Beta (_classic_beta_)*. Beta er valgt som standard. Bagefter vælger du character. Listen viser `navn · realm` (og konto, hvis du har flere), sorteret efter hvilken du senest har spillet på.

Kilden er så: `<spil>\WTF\Account\<konto>\<realm>\<Fornavn-Efternavn>`.

## 4. Vælg målet (din nye character)
1. Du vælger spilmappen. *WoW Forever (_forever_)* er standard.
2. Du får vist alle characters i den spilmappe, sorteret efter hvornår mappen blev oprettet. Den nyeste, altså den du lige har lavet, står øverst og er valgt. Kildens egen character er ikke med på listen.
3. Er der ingen character endnu, siger vinduet det og beder dig oprette den og trykke **Opdater**. Knappen *Overfør UI* er låst, indtil både en gammel og en ny character er valgt.
4. Peger kilde og mål på samme mappe, stopper scriptet.

## 5. Opsummering
Du får vist, hvad der kopieres hvorhen. I vinduet står opsummeringen hele tiden nederst og gentages i bekræftelsen. Intet er ændret, før du har bekræftet.

## 6. Kopiering
Kopieringen **fletter**. Hver fil fra kilden lægges ind på samme sted i målet. Filer der kun findes i målet, får lov at blive. Overskrives en fil, tages der først backup af den.

**a) Addons, kun hvis kilde og mål er forskellige spilmapper (fx beta → forever)**
- Du bliver spurgt om du vil kopiere `Interface`. Svarer du ja, kopieres hele `<kilde>\Interface` ind i `<mål>\Interface`. Addons der allerede ligger i målet, bliver liggende.
- I vinduet er fluebenet sat som standard, kun hvis målet ikke allerede har addons. Har du kopieret `Interface` før første start som anbefalet, bliver dine opdaterede addons altså ikke overskrevet af beta-versionerne.
- Kører spillet, bliver addons kopieret, men de indlæses først, når spillet startes igen.

**b) Grafik- og lydindstillinger (`WTF\Config.wtf`), kun ved forskellige spilmapper, og kun når spillet er lukket**
- Kører spillet, springes dette trin over og skrives i loggen. En kopi ville alligevel blive overskrevet, når spillet lukker.
- Backup af målets `Config.wtf`.
- Kildens linjer kopieres, **bortset fra** login-linjerne `portal`, `realmList`, `realmListbn`, `realmName`, `lastCharacterIndex`, `lastSelectedRealm`, `accountName`, `accountList` og `gxApi`.
- Målets egne login-linjer beholdes, så launch-klienten stadig logger ind på den rigtige server og ikke på beta.

**c) Konto-niveau, når kilde og mål ikke er samme konto-mappe i samme spil**
- Alle filer direkte i `<kilde-konto>\` (fx `bindings-cache.wtf`, `macros-cache.txt` og Edit Mode-cache) samt `<kilde-konto>\SavedVariables\` kopieres til målkontoen. Det er de konto-brede addon-indstillinger, fx WeakAuras, Details og Myslot-profiler.
- De gamle realm-mapper kopieres **ikke**. Kun den character du valgte, kommer med (se d).

**d) Character-niveau, altid**
- Alt indhold i den gamle character-mappe kopieres ind i den nye. Det dækker character-macros, keybinds, `chat-cache.txt`, `layout-local.txt`, Edit Mode og character-addon-indstillinger i `SavedVariables`.

## 7. Addon-profiler
Mange addons (dem der bruger AceDB, fx Dominos, Quartz, Prat og OmniCC) gemmer i en `["profileKeys"]`-blok, hvilken profil hver character bruger. I WoW Forever ser det sådan ud (fra dine egne filer):
```lua
["profileKeys"] = {
["Darkfade Test"] = "Warrior",
["Darkfade Speedy"] = "Warrior",
},
```
For hver `.lua`-fil i målkontoens `SavedVariables` gør scriptet følgende:
1. Det kigger **kun inde i `["profileKeys"]`-blokke**.
2. Det finder linjen for din gamle character. Formatet er `"Fornavn Efternavn"`, og for en sikkerheds skyld også `"Fornavn-Efternavn"` og varianter med ` - Realm`.
3. Lige under den linje indsætter det en **ny** linje for din nye character med **samme profil**, fx `["Darkfade Nytest"] = "Warrior",`.
4. Den gamle linje bliver stående. Der tilføjes intet, hvis den nye character allerede står i blokken, så det er sikkert at køre scriptet flere gange.
5. Filen backes op, før den gemmes med de samme linjeskift (CRLF) og uden BOM, ligesom WoW selv skriver den.

Andre dele af filerne bliver ikke rørt.

## 8. Valgfrit: slå server-synkronisering fra
Det sker kun, hvis du sætter flueben i vinduet (eller starter konsollen med `-DisableSync`). Det er slået fra som standard. Så bliver `SET synchronizeConfig/Settings/Bindings/Macros "0"` skrevet i målets `Config.wtf`, så spillet bruger de lokale filer i stedet for serverens. Det er tænkt som en nødløsning. Ligesom grafik og lyd virker det kun, hvis spillet er lukket, mens scriptet kører.

## 9. Afslutning
En log over alt, hvad der blev gjort, gemmes som `overfoersel-log.txt` i backup-mappen.

Du får at vide, hvor mange filer der blev kopieret, hvor mange addon-profiler der blev sat op, og hvor mange filer der ligger i backup. Opstår der en fejl undervejs, stopper scriptet med det samme og viser fejlen. Siger fejlen "adgang nægtet", foreslår det at køre `.bat` som administrator.

**Bemærk:** Stopper scriptet midt i kopieringen, er de filer der nåede at blive kopieret, stadig kopieret. Backuppen af det de overskrev, ligger dog i `UI-backup-...`. Du kan bare køre scriptet igen.

## Sådan fortryder du
1. Luk WoW.
2. Kopier indholdet af `UI-backup-<dato-tid>\` tilbage til WoW-mappen og vælg "Erstat".
3. Filer der var helt nye (ikke overskrevne), kan du slette i hånden. Det er typisk dem i den nye character-mappe.

## Kendte begrænsninger
- Kopi-logikken er testet på en kunstig mappestruktur og kopier af dine beta-filer med PowerShell 7 på Linux. Selve vinduet (Windows Forms) kan kun køre på Windows, så det er ikke testet. Prøv det selv, før du deler det.
- Addons med deres eget profilformat (ikke AceDB) skal stadig have valgt profil manuelt.
- Hvis et addon navngiver characters på en anden måde end `Fornavn Efternavn`, bliver dets profil ikke sat automatisk. Alt andet virker stadig.
