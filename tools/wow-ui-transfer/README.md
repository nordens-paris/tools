## Guide: Tag dit UI med fra Beta/Stresstest til Launch

Med denne guide får du addons, addon-profiler, Edit Mode, keybinds, macros, interface-indstillinger, grafik og chat med over, så det hele er på plads første gang du trykker Enter World på launch.

Overførslen sker i to faser:
- **Fase 1, før launch, med spillet lukket:** alt det, der hører til hele din konto.
- **Fase 2, på launch, på character select:** det, der hører til din nye character. Du skal ikke lukke spillet, så du mister ikke din plads i køen.

### Del 1: Sæt dit UI op (beta eller stresstest)
1. Installer dine addons via CurseForge og sæt dem op.
2. Gå hele `Edit Mode` igennem. Gem også layoutet som tekst (Edit Mode → **Share → Copy to clipboard**) i en tekstfil, så har du en backup.
3. Sæt chat-vinduer, channels og dine interface-indstillinger op.
4. *(Valgfrit, men anbefalet)* Lav macros til dine abilities, bind dem og læg dem på barerne. Installer **Myslot**, skriv `/myslot`, tryk **New**, giv profilen et navn, tryk **Export** og **Save**.
5. Skriv `/reload` eller log helt ud, når du er færdig. Addon-indstillinger gemmes først på disken der, og ikke hvis spillet crasher eller lukkes med Alt+F4.

### Del 2: Før launch (fase 1)
1. Preinstaller spillet i Battle.net, så mappen `_forever_` findes.
2. Download `UI-overfoersel.zip` fra repoets [Releases](https://github.com/nordens-paris/tools/releases) (eller hent filerne i denne mappe). Højreklik på den → **Egenskaber** → sæt flueben i **Fjern blokering** → OK. Så spørger Windows ikke om lov hver gang.
3. Højreklik på zip-filen → **Udpak alle**, fx til skrivebordet.
4. **Luk WoW helt** (Menu → Exit Game, ikke Alt+F4), og dobbeltklik på `Overfoer-UI.bat`. Vinduet åbner i **Fase 1**.
5. Under **1 FRA** vælger du, hvor du lavede dit UI (fx *Beta*), og din gamle character.
6. Under **2 TIL** vælger du *WoW Forever* og skriver dit **kontonavn** (fx `C00LPET`). Har du spillet WoW Forever før, er det udfyldt på forhånd.
7. Tryk **Overfør UI** → **Ja**. Fase 1 kopierer:
   - addons (`Interface`), hvis de ikke allerede ligger i `_forever_`,
   - grafik og lyd (`Config.wtf`, uden beta-loginlinjerne),
   - Edit Mode-layouts, keybinds, macros, interface-indstillinger og addon-indstillinger.
8. Opdater dine addons i CurseForge.
9. **Start ikke spillet igen før launch.** Har du spillet (fx på stresstesten) efter fase 1, så luk spillet og kør fase 1 igen.

### Del 3: På launch (fase 2)
1. Log ind og **opret din character. Tryk IKKE "Enter World".**
2. Lad spillet stå på character select, og dobbeltklik på `Overfoer-UI.bat`. Vinduet åbner i **Fase 2**.
3. Under **1 FRA** vælger du din gamle character. Under **2 TIL** er din nye character valgt på forhånd og markeret **NY**. Kan du ikke se den, så tryk **Opdater**.
4. **Realm-navn nu:** skriv navnet på realmen, som det står på character select. Kan du ikke se det, så lad feltet stå tomt (se trin 7).
5. Tryk **Overfør UI** → **Ja**. Fase 2 kopierer din characters egne indstillinger (chat, character-keybinds og -macros osv.) og sætter dine addons til at bruge din gamle profil.
6. Når der står **Færdig**, trykker du **Enter World**.
7. **Var realm-feltet tomt, eller mangler Edit Mode eller keybinds?** Skriv `/logout` (du kommer ikke i kø, du ryger bare tilbage til character select), kør `Overfoer-UI.bat` igen i fase 2, og tryk Enter World.
   - Titan Panel, X-Perl og AtlasLoot gemmer under realm-navnet. Det står nu i addon-filerne, så det udfyldes automatisk.
   - Edit Mode, keybinds og macros kan mangle, hvis spillet ikke havde været startet på pc'en før fase 1 (fx ny pc, eller hvis du har slettet `WTF`-mappen). Efter første Enter World kender scriptet serverens tidspunkter, så anden gang virker det.
8. Mangler der stadig binds eller macros på barerne: `/myslot` → vælg din profil → **Import** (evt. to gange). Er Edit Mode nulstillet: Edit Mode → **Import** → indsæt teksten fra din tekstfil.

Vil vinduet ikke åbne, så brug `Overfoer-UI (konsol).bat`. Den gør præcis det samme med tekst i stedet for et vindue.

Scriptet sletter ikke noget. Alt det overskriver, gemmes først i `UI-backup-<dato>` i din WoW-mappe sammen med en log.

### Hvorfor to faser?
Spillet synkroniserer konto-indstillinger (Edit Mode, keybinds, macros, interface-indstillinger) med serveren og indlæser dem, allerede når du logger ind. Kopierer man filerne i hånden, henter spillet serverens version i stedet, fordi tidspunktet i `cache.md5` ikke passer med serverens. Scriptet giver de kopierede filer serverens tidspunkt, så spillet bruger dine filer. Derfor virker det ikke at kopiere `WTF`-mappen i hånden. Se [Script-forklaring.md](Script-forklaring.md) for detaljerne.
