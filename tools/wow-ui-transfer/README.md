## Guide: Tag dit UI med fra Beta/Stresstest til Launch

Med denne guide får du addons, addon-profiler, keybinds, macros, Edit Mode og chat med over, så det hele er på plads første gang du trykker Enter World på launch.

**Onsdag d. 21/10-2026 er der åben stresstest.** Brug den til at sætte dit fulde UI op (især hvis du ikke har beta).

### Del 1: Sæt dit UI op (beta eller stresstest)
1. Installer dine addons via CurseForge og sæt dem op.
2. Gå hele `Edit Mode` igennem. Gem også layoutet som tekst (Edit Mode → **Share → Copy to clipboard**) i en tekstfil, så har du en backup.
3. Sæt chat-vinduer og channels op.
4. *(Valgfrit, men anbefalet)* Lav macros til dine abilities, bind dem og læg dem på barerne. Installer **Myslot**, skriv `/myslot`, tryk **New**, giv profilen et navn, tryk **Export** og **Save**.
5. Skriv `/reload` eller log helt ud, når du er færdig. Addon-indstillinger gemmes først på disken der, og ikke hvis spillet crasher eller lukkes med Alt+F4.

### Del 2: Før launch
1. Preinstaller spillet i Battle.net, så mappen `_forever_` findes.
2. Download `UI-overfoersel.zip` fra repoets [Releases](https://github.com/nordens-paris/tools/releases) (eller hent filerne i denne mappe). Højreklik på den → **Egenskaber** → sæt flueben i **Fjern blokering** → OK. Så spørger Windows ikke om lov hver gang.
3. Højreklik på zip-filen → **Udpak alle**, fx til skrivebordet.
4. **Hvis du lavede dit UI på beta:** gør dette, mens spillet er helt lukket, gerne før launch:
   - Kopier `_classic_beta_\Interface` til `_forever_\Interface`. Addons bliver kun fundet, når spillet starter, så de skal ligge der før første login.
   - Kopier `_classic_beta_\WTF\Config.wtf` til `_forever_\WTF\Config.wtf` (opret `WTF`-mappen). Åbn kopien i Notesblok og slet linjerne `SET portal "test"`, `SET accountName ...` og `SET accountList ...`. Spillet gemmer `Config.wtf`, når det lukker, så grafik og lyd skal på plads, før spillet startes.
   - Opdater dine addons i CurseForge.
   - Resten af `WTF` skal du ikke kopiere i hånden. Det klarer vinduet på launch.

### Del 3: På launch
1. Log ind og **opret din character. Tryk IKKE "Enter World".** Spillet laver nu en mappe til din nye character.
2. Lad spillet stå på character select, og dobbeltklik på `Overfoer-UI.bat`. Der åbner et vindue.
3. Under **1 FRA** vælger du, hvor du lavede dit UI (fx *Beta*), og din gamle character. Den du senest har spillet på, står øverst.
4. Under **2 TIL** er *WoW Forever* og din nye character valgt på forhånd. Den er markeret med **NY**. Kan du ikke se den, så tryk **Opdater**.
5. Tjek opsummeringen, og tryk **Overfør UI** → **Ja**. Vinduet:
   - kopierer indstillinger, keybinds, macros, Edit Mode og chat over (og addons, hvis de ikke allerede ligger i `_forever_`),
   - sætter dine addons til at bruge din gamle profil på den nye character,
   - sletter ikke noget. Alt det overskriver, gemmes først i `UI-backup-<dato>` i din WoW-mappe sammen med en log.
6. Når der står **Færdig**, trykker du **Enter World**.
7. Har du ikke gjort trin 4 i Del 2, så genstart spillet efter første login, så addons og grafik bliver indlæst, og opdater addons i CurseForge.
8. Mangler der binds eller macros på barerne: `/myslot` → vælg din profil → **Import** (evt. to gange). Er Edit Mode nulstillet: Edit Mode → **Import** → indsæt teksten fra din tekstfil.

Vil vinduet ikke åbne, så brug `Overfoer-UI (konsol).bat`. Den gør præcis det samme med tekst i stedet for et vindue.

**Vigtigt:** Når du først har været inde i verden på den nye character, gemmer serveren dens indstillinger, og så hjælper en kopi bagefter ikke længere for Edit Mode og chat. Kør derfor scriptet før første Enter World.

**Manuel måde (uden script):** Kopier `Interface` og `WTF` fra `_classic_beta_` til `_forever_`. Kopier så indholdet af din gamle character-mappe (`WTF\Account\<konto>\<gammel realm>\<Fornavn-Efternavn>`) ind i den nye mappe, som spillet laver når du opretter din character (`WTF\Account\<konto>\<launch-realm>\<Fornavn-Efternavn>`). Gør det før Enter World. Bagefter skal du selv vælge din gamle profil i hvert addon.
