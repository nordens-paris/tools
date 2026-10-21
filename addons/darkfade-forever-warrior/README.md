# Darkfade's Forever Warrior – WeakAura pack

Et komplet WeakAuras-UI til Warrior i WoW Forever, lavet til **ForeverAuras**-addonnet. Packen loader kun for Warrior og består af 78 auras fordelt på 8 grupper.

**Import-filen:** [`Darkfade-Forever-Warrior.txt`](Darkfade-Forever-Warrior.txt)

| | |
| --- | --- |
| **Type** | WeakAura-import (tekststreng). Det er ikke en addon-mappe, så intet skal lægges i `Interface\AddOns`. |
| **Kræver** | ForeverAuras installeret og slået til |
| **Klasse** | Warrior (alle specs, både DPS og tank) |
| **Sender noget?** | Kun Tank Announces, som skriver i /yell, når du selv bruger Shield Wall, Last Stand eller Challenging Shout. Packen klikker og automatiserer ikke noget. |
| **Vedligeholdes af** | Darkfade |

- [Installation](#installation)
- [Egne keybinds](#egne-keybinds-på-cooldown-ikonerne)
- [Hvad packen gør](#overblik)

---

## Installation

Brug tekstfilen her i stedet for Wago. Wago-importen kan ændre packen, så den ikke virker som den skal.

1. Sørg for, at **ForeverAuras** er installeret og slået til under AddOns på character select-skærmen.
2. Åbn [`Darkfade-Forever-Warrior.txt`](Darkfade-Forever-Warrior.txt) her på GitHub og tryk på **Copy raw file** (ikonet med to firkanter øverst til højre over teksten).
   - Alternativt: tryk **Raw**, marker alt med `Ctrl+A` og kopier med `Ctrl+C`.
   - Teksten skal starte med `!WA:2!` og være kopieret helt til sidst.
3. Log ind på din Warrior og skriv `/wa` i chatten for at åbne WeakAuras.
4. Tryk på **Import** øverst i vinduet.
5. Indsæt teksten med `Ctrl+V`. Der kommer et vindue, som viser packens indhold.
6. Tryk **Import** igen for at bekræfte.

Packen ligger nu i listen til venstre som **Darkfade's Forever Warrior**. Du kan flytte hele packen ved at markere gruppen og trække den på skærmen, mens `/wa` er åben.

**Opdatering:** Når der kommer en ny version, importerer du den på samme måde. WeakAuras spørger normalt, om den eksisterende pack skal opdateres. Har du ændret noget selv (fx keybinds), så tjek bagefter, at dine ændringer stadig er der.

---

## Overblik

WeakAuras viser ikoner, bars og tekst på skærmen, når noget bestemt sker.

**Sådan virker det i praksis**

- **Før Pull:** Battle Shout Pull Check spiller en lyd, hvis du går i Combat uden Battle Shout, eller hvis den har under 10 sekunder tilbage.
- **I Combat:** Ikoner viser, når Battle Shout mangler eller er ved at udløbe. Swing bar viser dit næste auto attack, og Heroic Strike Alert lyser, når du kan bruge din Rage.
- **Melee:** Melee Range Reminder skriver TOO FAR eller NOT ATTACKING midt på skærmen.
- **Cooldowns:** Core-rækken viser altid dine rotation-spells. Utility-rækken viser kun spells, mens de er på cooldown, og giver et guld-glow de sidste 10 sekunder, før de er klar.
- **Som tank:** Tank Announces råber i /yell, når du bruger Shield Wall, Last Stand eller Challenging Shout, og igen lige før de udløber.
- **I Group/Raid:** Healer Mana viser mana i procent for gruppens Healers.

**Ord, du får brug for**

- **Trigger:** det, en aura holder øje med (fx en buff, en cooldown eller din Rage).
- **Load:** hvornår en aura overhovedet er aktiv (fx kun som Warrior, eller kun i Defensive Stance).
- **Condition:** en regel, der ændrer udseendet, når noget er sandt (fx farve, glow eller gennemsigtighed).

Buffs og procs bruger WeakAuras' nyeste trigger, Aura (Modern), så de også virker midt i Combat, hvor Blizzard ellers skjuler aura-data.

## Enkeltauras

Fem auras ligger direkte i hovedgruppen og dækker melee-hjælp, Stance, Rage-dump og Shield-advarsel.

| Aura | Vises når | Hvad den gør |
| --- | --- | --- |
| Melee Range Reminder | Kun i Combat, når du har et levende, fjendtligt Target | Rød tekst midt på skærmen. **TOO FAR**, hvis dit Target er uden for melee range. **NOT ATTACKING**, hvis du er tæt nok på, men auto attack ikke er slået til. Teksten pulserer og er tom, hvis den er i tvivl. |
| Warrior Stances | Altid | Ikon for din aktive Stance (Battle, Defensive eller Berserker). |
| Enrage | Når du har Enrage-buffen (fra et Fury-talent), Bloodrage eller Berserker Rage | Ikon med timer og stacks. |
| Heroic Strike Alert | Kun i Combat | Ikon med glow, når du har mindst 65 % Rage, og hverken Heroic Strike eller Cleave allerede er queued (valgt til dit næste swing). Under 65 % Rage er ikonet skjult. |
| No Shield Alert | Når du står i Defensive Stance uden Shield equipped | Shield-ikon med teksten **NO SHIELD** og glow. |

## Healer Mana

En lille tekstliste med mana for hver Healer i din Group eller Raid. Den vises kun, når du er i Group eller Raid.

- Viser navn og mana i procent for hver spiller med rollen Healer.
- Teksten er hvid, bliver gul under 50 % mana og rød under 25 % mana.
- Døde og disconnectede spillere vises ikke.
- Healers skal have rollen Healer i gruppen for at komme med på listen.

## Tank Announces

Fem usynlige auras, der kun sender /yell-beskeder, når du bruger Shield Wall, Last Stand eller Challenging Shout, og igen lige før de udløber. De loader kun som Warrior i Group eller Raid på Normal eller Heroic. Blizzard begrænser automatiske /yell uden for instances, så de virker formentlig kun i Dungeons og Raids.

| Aura | Besked i /yell | Hvornår |
| --- | --- | --- |
| Shield Wall | `>> SHIELD WALL USED! REDUCED DAMAGE FOR 12 SECONDS <<` | Ved cast |
| Shield Wall Fading | `>> SHIELD WALL FADING IN 2 SECONDS <<` | 7 sek. efter cast |
| Last Stand | `>> LAST STAND USED! INCREASED HEALTH FOR 20 SECONDS <<` | Ved cast |
| Last Stand Fading | `>> LAST STAND FADING IN 5 SECONDS <<` | 15 sek. efter cast |
| Challenging Shout | `>> AOE TAUNT USED <<` og senere `>> AOE TAUNT FADING IN 1 SECOND <<` | Ved cast og 5 sek. efter cast |

## Battle Shout Reminder

Tre auras, der sørger for, at du aldrig går i Combat uden Battle Shout, og som minder dig om at forny den. Ikonerne hopper op og ned, så de er svære at overse.

| Aura | Vises når | Hvad den gør |
| --- | --- | --- |
| Battle Shout Missing 2 | Kun i Combat, når du mangler Battle Shout | Stort ikon med glow og tid. Kan spille en lyd, når buffen forsvinder. |
| Battle Shout Expiring | Kun i Combat, når Battle Shout har 10 sekunder eller mindre tilbage | Stort ikon med glow. Tiden er gul og bliver rød-orange under 5 sekunder. |
| Battle Shout Pull Check | Aldrig synlig | Holder øje uden for Combat. Når du starter et Pull, spiller den en lyd, hvis Battle Shout mangler eller har under 10 sekunder tilbage. |

Til sammen dækker ikonerne Combat, og Pull Check dækker selve Pull-øjeblikket, hvor ikonerne endnu ikke er aktive. I Combat kan WeakAuras ikke læse dine buffs på samme måde, fordi Blizzard skjuler dem.

## Warrior Buffs & Procs

Elleve ikoner, der viser en proc eller en aktiv buff, så længe den varer. Gruppen er dynamisk, så aktive ikoner automatisk spredes ud ved siden af hinanden. Hvert ikon viser cooldown-swipe, stacks i hjørnet og resterende tid i midten. Tiden bliver rød-orange under 5 sekunder.

| Aura | Vises når |
| --- | --- |
| Overpower Proc | Overpower kan bruges. Glow. |
| Victory Rush Proc | Victory Rush-proc'en er aktiv på dig. Glow. |
| Execute Proc | Execute kan bruges, og du ikke står i Defensive Stance. Glow. |
| Death Wish Active | Death Wish er aktiv |
| Recklessness Active | Recklessness er aktiv |
| Retaliation Active | Retaliation er aktiv |
| Sweeping Strikes Active | Sweeping Strikes er aktiv |
| Shield Block Active | Shield Block er aktiv |
| Shield Wall Active | Shield Wall er aktiv |
| Last Stand Active | Last Stand er aktiv |
| Rend Active | Din egen Rend er aktiv på dit Target. Ikonet vises kun, når Rend er på Target. |

## Warrior Swing & Rage

Swing bar og Rage bar ligger tæt på hinanden midt på skærmen.

| Aura | Vises når | Hvad den gør |
| --- | --- | --- |
| Swing Bar Mainhand | Altid som Warrior | Viser tiden til dit næste auto attack. Standardfarven er rosa-rød, gul når Heroic Strike er queued, og grøn når Cleave er queued. |
| Swing Tick Offhand | Når du har et offhand-våben | Viser tiden til dit offhand-swing. Ligger oven på Mainhand-baren, men selve baren er gennemsigtig, så kun tiden ses. |
| Rage Bar | Altid som Warrior (når du er i live) | Viser din Rage som en bar med tallet til venstre. Mørkerød under 30 Rage, rød op til 60 %, grøn fra 60 % (i Combat med større tal) og grøn ved 100 %. |

## Warrior Core Cooldowns

Ti rotation-spells i en række under midten af skærmen. De er altid synlige, mens spellen er aktiv for dig, og viser cooldown, om spellen kan bruges, og om du er i range. Gruppen er dynamisk og arrangerer ikonerne i to centrerede rækker.

**Fælles regler (Conditions) på alle ti:**

- På cooldown: ikonet bliver gråt.
- Spellen kan ikke bruges: grå-rosa tone.
- Ikke nok Rage: blålig tone.
- Uden for range: rødlig tone.
- Resterende tid: rød-orange under 5 sekunder og hvid fra 60 sekunder.

| Aura | Vises når | Særligt |
| --- | --- | --- |
| Shield Block CD | Kun i Defensive Stance | |
| Bloodthirst CD | Du kender spellen | Glow i Combat, når den er klar. Halvt gennemsigtig på cooldown. |
| Mortal Strike CD | Du kender spellen | Glow i Combat, når den er klar. Halvt gennemsigtig på cooldown. |
| Shield Slam CD | Du kender spellen | Glow i Combat, når den er klar. Halvt gennemsigtig på cooldown. |
| Revenge CD | Kun i Defensive Stance | Glow, når Revenge kan bruges. |
| Overpower CD | Ikke i Defensive Stance | Glow, når den kan bruges. Halvt gennemsigtig på cooldown. |
| Whirlwind CD | Ikke i Defensive Stance, eller du kender Mortal Strike eller Bloodthirst | Glow i Combat, når den er klar. |
| Thunder Clap CD | Kun i Defensive Stance | |
| Sweeping Strikes CD | Du kender spellen | |
| Victory Rush CD | Altid | Næsten usynlig, indtil den kan bruges. Så fuld synlighed og glow. |

### Egne keybinds på cooldown-ikonerne

Hvert Core- og Utility-ikon har en lille hotkey-tekst i øverste højre hjørne, men den er slået fra som standard, så hver spiller kan sætte sine egne keybinds ind. Sådan gør du:

1. Åbn WeakAuras med `/wa` og find den cooldown-aura, du vil sætte en tast på (fx Bloodthirst CD).
2. Gå til fanen **Display**.
3. Find tekstelementet i højre side under "Text 2" (det har en gammel hotkey som R, SR eller G som tekst) og slå det til igen.
4. Skriv din egen keybind i tekstfeltet, fx F1 eller SB5.
5. Gentag for de andre auras, du vil have en tast på.

## Warrior Utility Cooldowns

Tyve utility-spells (inklusive fire racials), der kun vises, mens de er på cooldown, og som forsvinder fra rækken, når de er klar igen. Gruppen er dynamisk og fylder ikonerne op i op til tre rækker. Ikonerne har samme regler (Conditions) som Core-rækken: grå på cooldown, farvet tone ved ikke brugbar, for lidt Rage eller uden for range, og resterende tid i rød-orange under 5 sekunder og hvid fra 60 sekunder. Bloodrage, Concussion Blow og Last Stand har en ekstra kontrol, så de kun vises under deres egen cooldown og ikke ved global cooldown, også midt i Combat. Keybind-tekst sættes ind som beskrevet under Core Cooldowns.

| Aura | Type | Vises når |
| --- | --- | --- |
| Charge CD | Movement | På cooldown |
| Intercept CD | Movement | På cooldown |
| Pummel CD | Interrupt | På cooldown |
| Shield Bash CD | Interrupt | På cooldown |
| Taunt CD | Taunt | På cooldown |
| Challenging Shout CD | Taunt | På cooldown |
| Intimidating Shout CD | Crowd control | På cooldown |
| Concussion Blow CD | Crowd control | På cooldown, og du kender spellen |
| Disarm CD | Crowd control | På cooldown |
| Bloodrage CD | Rage / offensive | På cooldown |
| Berserker Rage CD | Rage / offensive | På cooldown |
| Blood Fury CD | Racial | På cooldown, og du kender spellen |
| Elune's Light CD | Racial | På cooldown, og du kender spellen |
| Eureka CD | Racial | På cooldown, og du kender spellen |
| Will to Survive CD | Racial | På cooldown, og du kender spellen |
| Death Wish CD | Offensive | På cooldown |
| Recklessness CD | Offensive | På cooldown |
| Retaliation CD | Offensive | På cooldown |
| Shield Wall CD | Defensive | På cooldown |
| Last Stand CD | Defensive | På cooldown, og du kender spellen |

### Glow, før en cooldown er klar

Gruppen Warrior Utility Glows har en usynlig aura for hvert Utility-ikon, lagt oven på ikonet. Når der er under 10 sekunder tilbage af cooldown, får ikonet et guld-glow, så du kan se, hvad der snart er klar. Racial-glows vises kun, hvis du kender den racial.
