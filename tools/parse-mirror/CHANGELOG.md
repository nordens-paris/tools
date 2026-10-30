# Ændringer i Parse Mirror

Alt, hvad der er ændret i værktøjet, nyeste først. Hver ændring, der kommer på `main`, får sit eget
versionsnummer her og i `package.json`, så nummeret i bunden af siden viser, hvad du kører. Tredje
tal er en lille opdatering, andet tal en større med nyt indhold.

Hjemmesiden følger `main` og har altid den nyeste version. Windows-pakken opdateres kun, når en
version udgives under
[Releases](https://github.com/nordens-paris/tools/releases?q=parse-mirror&expanded=true); de er
markeret med **Windows-pakke** her.

## v0.3.2 (30. oktober 2026) · Windows-pakke

### Forbedret

- **Færre kald til Warcraft Logs**, så nye nøgler med 1.000 kald i timen rækker længere. Flere
  ting hentes nu i ét kald: en DPS-analyse koster cirka 78 kald mod 122 før, og en spillers hele raid
  46 mod 57. Healer- og tank-sider sparer lidt mindre. Resultaterne er uændrede.
- **Healer- og tank-data gemmes i browseren** med din egen nøgle, så det ikke koster kald at åbne
  et kill igen.
- Nøgle-panelet nævner nu grænsen på 1.000 kald for nye nøgler.
- **Versionsnummer** i bunden af siden, så du kan se, hvad du kører.

## v0.3.1 (30. oktober 2026)

### Nyt

- **Raidets dato** står i toppen af alle sider: DPS, healer, tank, en spillers raid og hele raidet.
- **Scrolls på hunter-pets** vises under consumables som "Pet: Scroll of Agility V" og "Pet: Scroll
  of Strength V" og simmes med. Pets har ingen data ved pullet, så en scroll ses kun, når den bruges,
  eller petten dør eller sendes væk, mens loggen kører. Derfor antages de brugt: en scroll set på
  din pet i loggen gælder alle dine kampe ("not seen here" på en boss, hvor den ikke sås), og alle
  de hunters, du sammenlignes med, regnes for at bruge begge ("9 seen" viser, hvor mange der faktisk
  sås på bossen). Uden en scroll i din log står der None, men det markeres ikke som manglende.
- **Healere der holder igen:** ud over ujævne kills tjekkes den enkelte healer nu på kills og wipes
  på mindst et minut. Se [healer-score.md](docs/healer-score.md#healere-der-holder-igen). Kampen vises
  under **Show healers** og på healer-siden og tæller ikke med i nogens fire-ugers-score. Tjekket
  bruges kun på de healere, der kigges på, ikke på referencepuljen.
- **Show healers** viser wipes på mindst et minut.
- **Changelog:** denne fil.

### Rettet

- **Elixir of Major Mageblood** blev ikke fundet, fordi buffen hedder "Greater Versatility" i loggen,
  så hunters med den stod som manglende guardian elixir. Den findes nu for alle klasser og simmes med.
- **Healere under 5 % af raidets healing** gav en fejl på healer-siden. Siden åbner nu med en
  note, og de vises under **Show healers**, men tæller stadig ikke som raidets healere.

## v0.3 (29. oktober 2026) · Windows-pakke

### Nyt

- **Healer score:** fire vaner (healing pr. mana, overheal efter eget valg, idle mens nogen er lav,
  reaktionstid) og HPS for situationen, hver som percentil blandt healere af samme spec efter at
  have taget raidets kontekst ud og rettet for bossen. For det enkelte kill og de sidste fire uger.
  Referencepuljen har alle 14 bosser i Hyjal og Black Temple.
- **Ujævn healing-fordeling:** kills, der er skævere end 95 % af puljens på bossen, markeres og
  tæller ikke med i scoren. Visningen **Healing split** under **Show healers**.
- **Windows-pakke:** to filer, Start og Opdater, der klarer Node.js, nøgle, installation og
  opdatering.

### Forbedret

- **Healer- og tank-sider kører i browseren** med din egen nøgle, så de er meget hurtigere på
  hjemmesiden. DPS-siderne bliver på serveren.
- Kills til fire-ugers-scoren hentes i browseren, og fight-lister holdes i hukommelsen på serveren.
- Simmen bruger WoWSims' standard-reaktionstid: 5 gange hurtigere for rogues og 2,7 for hunters.
- Sunder Armor regnes med, indtil raidets Expose Armor kommer på efter 10 s.

### Rettet

- "Everyone in this raid" hænger ikke længere ved lange rate limits fra Warcraft Logs.
- Analyze virker på kills, hvor spilleren tankede eller healede.
- Tank-EHP læste forkert under Fel Rage på Gurtogg.
- Curse of Doom-uptime nævnes ikke, når cast-effektiviteten er fuld.
- Enhancement får ikke længere en Fire Elemental i simmen, hvis spilleren ikke brugte en.

## v0.2 (28. oktober 2026)

### Nyt

- **Nye specs:** Arms Warrior, Affliction Warlock, Elemental og Enhancement Shaman, Balance og Feral
  Druid, Retribution Paladin, Combat Rogue samt Beast Mastery, Marksmanship og Survival Hunter.
- **Healere:** egen analyse mod healere fra velspillede raids.
- **Tanks:** egen analyse med tank-sims og analyse af opener.
- **Pets** tæller med: hunterens pet (familie og uptime), warlockens dæmon, Fire Elemental,
  Shadowfiend og treants, også i "var det held?".
- **Kun klassen i loggen** ("Shaman", "Druid"): talenterne afgør spec'en.

### Forbedret

- Simmen spiller som top-spillerne: seal-twisting, totem-twisting, powershifting, Arms med to sværd
  eller tohånds-våben, Affliction med Shadow Bolt. Evner og cooldowns, du ikke brugte, simmes ikke.
- Windfury Totem procer 32 % i Anniversary, ikke 20 % som i WoWSims.

### Rettet

- Dark Iron Smoking Pipe og Direbrew Hops talte både som trinket og consumable, så de gav dobbelt
  spell damage i simmen.
- The Battlemaster's trinkets har andre item-ID'er i Anniversary end i WoWSims.

## v0.1 (25. oktober 2026)

Første preview, med Fury Warrior, Destruction Warlock, Arcane Mage og Shadow Priest.

- Ét kill mod top 10: rotation, cooldowns, consumables, gear og hit, og hvad du skal rette først.
- Sim-fanen deler forskellen op i gear og buffs, kill-tid, spil og held.
- "Same gear, a step ahead": spillere med dit gear, der gjorde det lidt bedre.
- En spillers hele raid og hele raidet: parses, consumables, debuff-uptime, parties og gear check.
