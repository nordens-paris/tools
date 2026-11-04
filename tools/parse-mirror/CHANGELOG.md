# Ændringer i Parse Mirror

Alt, hvad der er ændret i værktøjet, nyeste først. Hver ændring, der kommer på `main`, får sit eget
versionsnummer her og i `package.json`, så nummeret i bunden af siden viser, hvad du kører. Tredje
tal er en lille opdatering, andet tal en større med nyt indhold.

Hjemmesiden følger `main` og har altid den nyeste version. Windows-pakken opdateres kun, når en
version udgives under
[Releases](https://github.com/nordens-paris/tools/releases?q=parse-mirror&expanded=true); de er
markeret med **Windows-pakke** her.

## v0.4.0 (4. november 2026) · Windows-pakke

Samler alt siden v0.3.8: hvor sikre tallene er, Play delt op pr. ability, og huller i rotationen,
som alle havde, adskilt fra dem kun du havde. README'en har nye billeder.

### Nyt

- **Usikkerhed på sim-tallene.** What-ifs viser nu fx "+120 DPS · ±25": 95 %-intervallet fra
  simmens egen tilfældighed. Alle sims bruger samme startværdi, så to sims kan trækkes fra hinanden
  iteration for iteration, og det meste af støjen går ud. Flisene under "Where the DPS difference
  comes from" (Gear & buffs, Kill time, Play, Luck) får også et ± fra det, der er målt med støj:
  simmenes egen støj (parret iteration for iteration for hele gruppens gennemsnit) og støjen i
  held-tallene. Hvem der er i top 10, tæller ikke med: de er sammenligningen, ikke en stikprøve. På
  en warlock-kill blev Play ±17 og Gear ±10. En what-if eller flise inden for sit ± er grå.
- **"Chance alone" under held:** hvor meget crits og misses alene typisk flytter DPS på en kill som
  din (95 % af kills ligger inden for).
- **Play by ability** på Sim-fanen, under "Where the DPS difference comes from": Play delt op pr. ability. Øverst tre
  fliser: Play mod gruppen med ±, og dine casts og din skade pr. cast samlet som andel af simmen.
  For hver ability (med ikon) to små plots: dine casts og din skade pr. cast som andel af simmen af
  dit setup (100 % = som simmen, held trukket fra) som en prik, gruppens gennemsnit som en ring og
  deres laveste til højeste som et bånd, så man kan se, hvad der er normalt. Sidste kolonne er,
  hvad forskellen er værd i DPS, med samme fortegn som flisen (+ = gruppen fik mere ud af den);
  rækkerne og "Other" (de mindre abilities, nævnt ved navn) giver tilsammen Play-flisen. Rød, hvor
  gruppen fik mindst 1 % af din DPS mere, grøn, hvor du gjorde. Held er abilityens egne crits, misses og resists plus dens andel
  (efter skade) af held fra følgevirkninger og procs, fx Flameshadow. Når Play-forskellen er uden
  for støjen, og én ability koster mindst 3 % af din DPS, står den øverst og i Fix first, fx
  "Bloodthirst: 120 DPS behind the top 10".
- **Huller alle havde, og huller kun du havde.** Hvert hul mellem casts på Rotation-fanen er nu
  rødt, hvis de fleste i gruppen ikke havde et hul samme sted, og gråt, hvis mindst halvdelen havde
  (en mekanik eller bevægelse). Tooltip'en siger fx "Shared: 8 of 10 had a gap here" eller "Only
  you", med bossens liv før og efter hullet. "Samme sted" er samme bosliv (±2 %), fordi faser og de
  fleste mekanikker sker ved samme liv, ikke samme sekund, eller samme tid (±2 s) for mekanikker på
  et ur (Supremus' faseskift, Air Burst). Gruppens egne huller afgør, hvilken af de to der bruges:
  den, der lægger flest af deres huller sammen, så valget ikke læner sig mod at undskylde dine.
  Bossens liv læses fra spillerens egne hits, så der er ingen ekstra kald. Bosser matches på
  NPC-ID, ikke navn, så en kinesisk eller koreansk log lægges sammen med resten (på Reliquary blev
  overgangene mellem essences ellers "kun dig").
- **Undgåelig tomgang:** et nyt tal ved tidslinjen, tiden i huller kun du (eller få) havde. For
  casters også hvad det kostede: de sekunder ved din DPS, mens du caster. Melee og hunters slår
  videre i et hul, så der står kun sekunder.

### Ændret

- **"Time not casting"** (casters) bruger nu den undgåelige tid i stedet for al tomgang, så det
  ikke giver dig skylden for mekanikker. Det kommer, når din undgåelige tid er mindst 2 % af kampen
  over gruppens median (de har også nogle huller alene), og nævner dine længste huller, som de
  fleste ikke havde. De delte huller står i en linje for sig.
- **Fix first** viser kun consumes-what-if'en, når gevinsten er over 2 standardfejl og over
  0,5 % (før: over 1 %).

### Rettet

- **Abilities med kun DoT-ticks** (Curse of Doom, Curse of Agony) blev smidt væk fra loggens
  skade, fordi de ingen direkte hits har. I Play by ability så det ud, som om de ikke gjorde skade,
  mens simmen fik 90-220 DPS af dem. Nu tæller deres skade.
- **Destruction-warlocks' sim castede Immolate,** som top-spillere med Shadow Bolt ikke gør. Nu
  caster simmen den kun, hvis spilleren gjorde (som for Affliction). Fire-warlocks beholder den.
- **Fury-simmens execute-fase** spiller nu som top-spillerne: Execute på hvert GCD i stedet for
  Bloodthirst og Whirlwind, og Heroic Strike bliver ved. WoWSims' APL holdt Bloodthirst og
  Whirlwind først og stoppede Heroic Strike under 20 %, mens alle top 10 på Rage Winterchill
  castede Execute 22-41 gange i minuttet i execute-fasen og næsten aldrig Bloodthirst eller
  Whirlwind. Simmen giver det cirka 1 % mindre DPS end sin egen rækkefølge; til gengæld passer
  Play by ability nu (Bloodthirst 82 % og Execute 105 % af simmens casts mod 71 % og 145 % før).
- **Arcane Mage: potion og trinkets sammen med Arcane Power.** Simmen brugte Destruction Potion og
  on-use trinkets ved 10 s, mens Arcane Power kom, når spilleren brugte den (ofte 20-30 s).
  Spillerne lægger dem sammen, så deres Arcane Blasts under Arcane Power var op til 26 % større end
  simmens. Nu venter simmen med potion og trinkets til første gang spilleren brugte Arcane Power
  eller Destruction Potion. Top 10's skade pr. Arcane Blast på Rage Winterchill gik fra 104 % til
  103 % af deres sims, og spredningen mellem spillerne blev mindre.
- **Adept's Elixir i oversatte logs.** Buffen hedder "Spellpower Elixir" i logs fra ikke-engelske
  klienter og blev ikke genkendt, så simmen manglede 24 spell power. Den findes nu på buffens ID.

Gemte resultater får ± på flisene, men ikke på what-ifs, og ingen Play by ability, til simmen
køres igen.

## v0.3.8 (4. november 2026)

### Rettet

- **Held regnede med skade på adds.** Crits, misses og resists blev talt på alle mål, men Play og
  "Execution, luck removed" regner kun skade på bossen. Adds har lavere level og misser, resister
  og critter anderledes end bossen, så kampe med mange adds (fx Shade of Akama) gav et
  skævt held. Nu tæller held kun slagene på bossen.
- **Execute-fasen** var din for alle: top-spillernes egne sims brugte, hvornår din boss kom under
  20 %. Nu simmes hver spiller med sin egen kill, og kun simmen på din kill-tid bruger din.
  Påvirker warriors' execution og "Kill time".
- **Dødsfald efter lang tid under 50 %** blev regnet som hurtige, hvis spilleren var under 50 % i
  alle de 8 sekunder, der kigges på. Nu tæller de som dødsfald med tid til at redde, så tank-healere
  får fundet for en tank, der døde sådan.
- **Hit-tjekket på raid-siden** gav Elemental-shamans Totem of Wrath to gange, så nogen under
  hit-cappet ikke blev vist.
- **Sim-noten for warriors** sagde, at Recklessness ikke gør hvide slag til crits i simmen. Det gør
  den, siden vores WoWSims-rettelse.
- **Cast efficiency** brugte faste cooldowns. Nu tæller talenter, der gør dem kortere: Improved
  Whirlwind, Improved Mortal Strike, Improved Judgement og Improved Mind Blast. Før nåede en Fury med
  Improved Whirlwind let 100 %, så gode og mindre gode spillere stod ens.
- **Improved Shadow Bolt-andelen** af en warlocks hits blev opgivet, hvis alle crits (ofte få på et
  kort kill) havde den. Så brugte simmen debuffens lavere tids-uptime. Nu afgør de almindelige hits.
- **Held for crits uden normale hits i loggen** (eller omvendt) regnede alle crits som dobbelt
  skade. Nu bruges simmens crit-bonus for den spell, så spells tæller 1,5×.
- **Proc-held** talte procs, der kommer af crits, med to gange: simmen med spillerens crits gav
  allerede flere procs. Proc-uptimen sammenlignes nu med den sim.
- **Party ud fra drums** kendte ikke Drums of Speed og Drums of Restoration på DPS-siden (raid-siden
  gjorde).
- **Tank-threat** manglede threat fra rage og mana, tanken får (Bloodrage, Primal Fury, Spiritual
  Attunement...): 5 pr. rage og 0,5 pr. mana, som i WoWSims. Peers' kampe hentes én gang igen for at
  få dem med.
- **Maksimalt liv** uden store slag at gå ud fra brugte `10 × stamina + 4000` for alle; cloth-klasser
  fik cirka 800 for meget. Nu bruges klassens base-liv fra WoWSims.
- **WoWSims: Improved Mortal Strike** gav ingen kortere cooldown med 1–4 point (en afrunding til 0
  s). Rettet med en ny WoWSims-rettelse, så simmen er bygget om (`wowsim.wasm.gz`).

## v0.3.7 (3. november 2026) · Windows-pakke

### Forbedret

- **Boss-debuffs simmes med deres rigtige uptime.** Før var en debuff oppe hele kampen, hvis den var
  oppe mindst 40 % af den, og ellers slet ikke. Nu er den oppe i de tidsrum, loggen viser, så en
  Curse of the Elements oppe 70 % tæller som 70 %. Huller i raidets debuffs flytter dermed fra Play
  til Gear & buffs, hvor de hører til. "Top 10 raid buffs" løfter en debuff til top 10's median-uptime,
  hvis den er højere end din. Det kræver en ny WoWSims-rettelse, så simmen er bygget om
  (`wowsim.wasm.gz`). Gemte resultater bruger den gamle regel, til kampen hentes igen.

## v0.3.6 (3. november 2026)

### Rettet

- **Play i "Where the DPS difference comes from"** tog simmens generelle afvigelse med. Ramte
  simmen fx 3 % for højt for alle, så top-spillere med bedre gear ud til at spille dårligere.
  Simmens tal skaleres nu med medianen af, hvor meget af deres simmede DPS top-spillerne fik ud af
  det uden held, så Play og "Execution, luck removed" måler det samme. Gear & buffs og Kill time er
  skaleret med samme tal, og de fire dele lægger sig stadig præcist sammen. Gemte resultater bruger
  også den nye opdeling.

## v0.3.5 (31. oktober 2026) · Windows-pakke

### Rettet

- **Carrion Swarm på Anetheron** tager 75 % af den healing, en spiller laver, men værktøjet regnede
  det ikke med, så ramte healere kunne stå som sandbagging. HPS og healing per mana rettes nu for
  den tid, healeren var ramt, før healer score, healing-fordeling og held-back-tjek. Den viste HPS
  er stadig den rigtige. Anetheron-kills, der allerede ligger i browseren, hentes igen. Healer-siden
  skriver, at debuffen ramte, og giver ingen fund om healing per mana på den kamp.
- **Kampe manglede:** en kampliste, der blev gemt midt i et raid, kunne stå som færdig dagen efter.
- **Sims, der aldrig blev færdige:** en sim-worker, der gik ned, efterlod siden med en spinner for
  evigt. Nu får du en fejl, og en side, der forlader en kørsel, holder ikke længere de andre hen.
- **Forkert healers historik:** skiftede du hurtigt healer, kunne den forriges kills blive vist.
- **Dødsfald ved fuldt liv** blev set som Feign Death for alle. Nu gælder det kun hunters.
- **Rate limits** stod som "ingen parses fundet". Nu vises den rigtige besked, også for peers.
- **Sandbagging-tjek:** healere under 5 % af healingen pustede de andres andel op, og samme kill
  logget af to personer talte med i healerens sædvanlige andel.
- **Duplikerede kills** på Progress og i healer score, når to loggede samme kill.
- **Fejlbeskeder** fra en gammel side kunne dukke op på den nye, og private logs gav en besked om
  nøglen. En tank-analyse går ikke længere tabt, hvis uploaden til sims fejler, og sims kan startes
  igen, efter serveren har genstartet.
- **Links med `fight=last`** åbner nu sidste kamp.
- **CSV-filer** bruger semikolon og decimalkomma, så de åbner rigtigt i dansk Excel.
- **Opdatering på Windows** stopper nu, før noget ændres, hvis Parse Mirror kører, virker fra andre
  drev end C:, og beholder de hentede logs.

- **Falske healere:** en Retribution-paladin eller Enhancement-shaman med kun klasseikon blev healer
  af én enkelt heal. Nu afgør talenterne det. Samme tjek bruges for roller på raid-siden.
- **Tanks** med kun klasseikon manglede i tank-panelet, og Shield Block talte som defensiv cooldown.
- **Progress** viser nu healing-parses for healere.
- **Potions:** Fel Mana og andre potions tæller nu med, og sims får alle conjured items.
- **Sims:** ingen sammenligningsspillere ødelægger ikke længere simmen, gems og enchants, WoWSims ikke
  kender, udelades, og noterne viser hvilke items der blev udeladt.
- **API-nøgle:** gem eller glem nu slår igennem med det samme.
- **Ikke-engelske logs:** healer- og tank-analyser bruger nu TBC-navnene på spells.
- **Sims:** en Destruction-warlock får nu den demon, loggen viser, ikke altid en Imp.
- **Fund:** "over hit-cappet" bruger kun den høje grænse for dual wield, Arms viser potion-navne, og
  uden sammenligningsspillere står consumes ikke længere som "Different choice".
- **Gear:** ting holdt i off-hand står ikke længere med "No enchant".
- **Healere med kun klasseikon** tæller nu ud fra talenter, så en Discipline-priest ikke skal bruge
  Pain Suppression for at blive set som healer.
- **Tank-roller:** main og off-tank måles nu ens for dig og peers, ud fra bossens melee-skade.
- **Småt:** Progress har reserve-ikon, og Continue på forsiden åbner Progress igen.

### Forbedret

- **Hurtigere healer-analyser:** reaktion og saves slår nu heals op pr. spiller i stedet for at
  gennemgå alle heals for hvert fald i liv, og 4-ugers scoren regnes ikke om ved hver tegning.
- **Mindre hukommelse og diskplads:** siden husker de seneste 20 analyser, og cachen af hentede logs
  holdes under 2 GB (`WCL_CACHE_MB`).
- **Tests og CI:** `npm test` tjekker scoring, sandbagging-reglerne, Warcraft Logs-klienten,
  sim-køen og andre kerneregler, og GitHub kører tests, typecheck og build på hver ændring.
- **Sim-filer** får ny URL af sig selv ved en ny build, og sim-noter viser udeladte items.
- **Dev-scripts:** engangs-scripts er flyttet til `scripts/dev/`, og tank-threat kan tjekkes med
  `npm run check-threat`.
- **Dokumentation:** spillernavne er fjernet fra `docs/healer-score.md`, og nye indstillinger og
  kommandoer er beskrevet.

### Sikkerhed

- Lokale installationer kan kun nås fra pc'en selv, ikke fra resten af netværket (`HOST`).
- Tank-sims på serveren tjekker nøgle og rapportkoder og har en grænse pr. time, og hele raid-sider
  og analyser tæller nu mere i grænsen for opslag på serverens nøgle.

## v0.3.4 (30. oktober 2026)

### Rettet

- **Empty Mug of Direbrew** talte som alkohol under consumables, så de fleste stod som manglende
  noget. Dire Drunkard er trinkettens on-use. Den vises nu under cooldowns, og uden trinketten er det
  en forskel i gear. Simmen havde den allerede fra gearet.
- **Alkohol i consumables:** tabellen over alle spillere samler nu forskellige drikke i én række,
  som den øverste tabel.

## v0.3.3 (30. oktober 2026)

### Forbedret

- **Skærmbillederne i README'en** er taget igen, så de viser raidets dato, healer score over fire
  uger og wipes under **Show healers**.

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
