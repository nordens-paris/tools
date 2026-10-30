# Healer-score: prototype og resultater

Kan en samlet score måle healeres præstation bedre end healing parses, uden at bygge på nogens
vurdering? Undersøgt i oktober 2026 med `scripts/healer-score.ts`, `scripts/healer-outcomes.ts`,
`scripts/healer-crossval.ts` og `scripts/healer-weeks.ts`.

## Data

| Sæt | Kills | Healer-kills | Healere |
|---|---|---|---|
| Hyjal (Rage Winterchill–Azgalor), 8 raids fra toppen og 8 fra bunden af Kaz'rogals execution-ranking | 64 | 279 | 75 |
| Black Temple (Gurtogg, Reliquary, Mother Shahraz, Council), samme opdeling på Gurtogg | 63 | 296 | 78 |
| Black Temple over uger: 8 EU/US-guilds (4 fra toppen, 4 fra bunden), 4 raid-aftener hver | 123 | 590 | 104 |

Hvert mål blev regnet om til en percentil inden for specen. Med `--adjust` trækkes først det fra,
raid-situationen forudsiger (damage taken pr. healer, antal healere, kill-tid og andel healing på
tanks), så man sammenlignes med healere, der havde samme situation.

## Hvad et godt mål skal kunne

1. **Være et træk ved spilleren:** samme healer skal score nogenlunde ens fra aften til aften.
2. **Være fair:** det må ikke følge raidets damage taken eller antal healere.
3. **Hænge sammen med noget, der betyder noget.**

## Resultater

**Healing parses (HPS) er stabile, men måler raidet.** Rå HPS er 0,92 stabil fra uge til uge,
men korrelerer 0,72 med damage taken pr. healer og −0,58 med antal healere. Det er raidet, man
healer i, ikke healeren.

**Udfald er ikke et træk ved healeren.** `healer-outcomes.ts` tager hver heal ud af HP-forløbet,
lader senere overheal (fra alle) fylde hullet og ser, om målet så var faldet under 10 % (kritisk)
eller hvor langt under 50 % (sikkerhed). Det er et objektivt mål for, hvad healingen forhindrede.
Men det er ikke stabilt: 0,08 fra uge til uge og 0,14–0,15 inden for en aften, også på de tunge
BT-bosser. Kun 3 % af healingen er kritisk. I raids, der clearer, afgør situationen (hvem der
falder, hvem der står nærmest), hvis heals redder nogen, ikke hvem healeren er. Et udfaldsbaseret
mål kan derfor ikke bruges som score eller som facit.

**Vaner er et træk ved healeren og fair efter justering** (uge til uge, 8 kills mod 8):

| Mål | Uge til uge | Følger damage/healer |
|---|---|---|
| Tid tabt på afbrudte casts | 0,87 | −0,04 |
| Overheal efter eget valg | 0,54 | −0,02 |
| Healing per mana | 0,51 | −0,01 |
| HPS for situationen (justeret) | 0,46 | −0,03 |
| Idle, mens nogen du healer, er lav | 0,34 | −0,09 |
| Mana ved slutningen | 0,32 | −0,01 |
| Reaktionstid ved fald under 50 % | 0,31 | 0,01 |
| Først til at heale efter et fald | −0,37 | 0,03 |
| Saves pr. fald | 0,24 | −0,09 |
| Tank-preheals | 0,00 | −0,02 |

Reaktionstid, "først til at heale", saves og preheals hænger sammen med udfaldene på samme kill,
men er ikke stabile: de måler situationen lige så meget som spilleren.

**Den bedste kandidat:** gennemsnittet af vaner (healing per mana, overheal efter eget valg, idle
mens nogen er lav, reaktionstid, mana ved slutningen) og HPS for situationen. Den er 0,49 stabil
fra uge til uge (0,41–0,47 inden for en aften i de to andre sæt) og følger ikke raidet (−0,04 og
0,03). Afbrudte casts er udeladt: meget stabile, men at afbryde for at undgå overheal er en
teknik, så mindre er ikke bare bedre.

Ingen af målene skiller healere fra raids i toppen og bunden af execution-rankingen ad, når
situationen er trukket fra: forskellen på de raids er situationen (færre healere, mindre skade),
ikke bedre healere. Ranking-placering kan derfor ikke bruges som facit.

Krydsvalidering (`healer-crossval.ts`, vægte tilpasset på Hyjal og testet på BT og omvendt)
forudsagde udfaldet på nye raids med 0,25–0,29, men da udfaldet ikke er stabilt, siger det mest,
at målene og udfaldet regnes på de samme heals.

## Hvad det betyder

En healer-score kan bygges, men den skal sige, hvad den er: **hvordan du healer i forhold til
healere af din spec i samme situation** (effektivitet, opmærksomhed og throughput), ikke hvem der
reddede raidet. Én aften er for lidt (0,45–0,49); over fire uger (~32 kills) giver Spearman-Brown
cirka 0,8, så scoren bør vises som et rullende gennemsnit med usikkerhed. Den kræver en
referencepulje pr. spec (her ~100 healere fra BT), gemt og opdateret, så percentilerne ikke skal
hentes for hver side.

Begrænsninger: 75–104 healere pr. sæt (usikkerhed omkring ±0,1 på hver korrelation); Discipline-
priests' absorbs er ikke med i udfaldene; vinduet (6 s) og grænserne (10 % og 50 %) er valgt, ikke
tilpasset.

## I appen

Scoren er bygget som beskrevet ovenfor (`shared/healerScore.ts`), men uden mana ved slutningen:
gennemsnittet af fire vaner (healing per mana, overheal efter eget valg, idle mens nogen er lav,
reaktionstid; mindst to målt) og den justerede HPS, hver som percentil blandt healere af samme
spec. Mana ved slutningen blev taget ud, fordi den intet lagde til: scoren er lige stabil fra uge
til uge med og uden (0,62 og 0,63 for 20 healere), den hænger kun 0,13 sammen med HPS-delen på
samme kill, og efterladt mana betyder kun noget, hvis der var healing at gøre, hvilket HPS for
situationen og idle måler direkte. At straffe den belønner at brænde mana af på heals, ingen
havde brug for. Idle og reaktion kræver, at nogen falder lavt, så et roligt kill for en
tank-healer kan mangle begge; derfor er to vaner nok. Puljen er
de tre sæt samlet plus de øvrige bosser fra de samme rapporter (`healer-pool-bosses.ts`): 2.521
healer-kills, 271 healere, alle 14 bosser i Hyjal og Black Temple, minus 25 kills med ujævn
healing-fordeling (se nedenfor), så 2.403 healer-kills. Discipline Priest har kun 20 healere og 145
kills, så den er mindst sikker. Tilpasningen, percentilerne og boss-korrektionen
gemmes i `shared/healerScoreRef.json`, så siden ikke henter puljen.

Over fire uger vises gennemsnittet af healerens kills. Ud fra 0,49 mellem to ugers 8 kills giver
Spearman-Brown cirka 0,66 ved 16 kills og 0,8 ved 32; siden kalder under 8 kills "few kills",
8–23 "settling" og 24+ "steady".

### Boss-korrektion

Konteksten (skade pr. healer, antal healere, kill-tid, andel på tanks) tager ikke det ud, der er
særligt for en kamp. Målt på de samme healere (scoren på bossen minus healerens eget gennemsnit)
lå bosserne fra −9,7 (Reliquary) og −7,8 (Archimonde) til +11,9 (Council) og +5,9 (Gurtogg), også
de bosser, der var i den første pulje. Den første pulje havde kun otte af de 14 bosser, og et
tidligere tjek på en guild-raid kunne ikke se forskel på bosser i og uden for puljen, men med cirka
14 kills pr. boss var usikkerheden ±5 point, så forskydningerne var der også dér.

Nu har puljen alle 14 bosser, og hver del flyttes pr. boss med det, puljens percentiler der ligger
fra 50 (på tværs af specs, 67–242 healer-kills pr. boss, trukket mod 0 som med 20 kills mere ved
50). Delene viser kampene: idle er sværest på Azgalor (−21) og Archimonde (−17), hvor man løber fra
Rain of Fire og Doomfire, og overheal efter eget valg sværest på Reliquary (−25) og lettest på
Council (+21). Efter korrektionen ligger alle bosser inden for ±1,3 af healernes eget gennemsnit i
puljen. På guild-raidets 193 healer-kills, som ikke er i puljen, faldt spredningen mellem bosserne
fra 4,8 til 2,7 point (største forskydning fra +12,0 til −6,8), hvilket er cirka det, støjen ved 14
kills pr. boss giver.

Fire-ugers-scoren blev ikke mere stabil (0,74 og 0,73 fra uge til uge for 20 healere): de raider
hele ugens bosser, så forskydningerne udligner sig. Korrektionen betyder noget for det enkelte
kill, og for den, der kun var med på en del af bosserne. Hyjals første fire bosser har færrest kills
i puljen (67–72, kun fra Hyjal-raidene); resten har 200+.

### Ujævn healing-fordeling (sandbagging)

Healing parses rangerer den enkelte healers HPS, så healere kan skiftes til at holde igen, så én
af dem får en høj parse. Det skævvrider også scorens HPS-del: den, der bæres, får mere at hele end
en healer i det raid normalt har, og de andre mindre.

Målet: hver healers andel af healernes healing på killet, gange antal healere og delt med det,
specen plejer at få (Holy Priest 1,36, Holy Paladin 0,67, Restoration Shaman 0,98, Restoration
Druid 0,95, Discipline Priest 0,89, medianer i puljen), og så den højeste over den laveste. Et kill
er ujævnt, når det tal er over 95-percentilen for bossen i puljen (2,2 på Gurtogg til 4,7 på Teron,
hvor Shadow of Death gør en healer til ånd en del af kampen). Bosser med under 30 kills i puljen
(Hyjals første fire) bruger 95-percentilen for alle bosser (3,35) eller deres egen, hvis den er
højere (Kaz'rogal 5,3). Mindst tre healere; Zul'Aman med to bedømmes ikke.

Tid brugt på at caste og idle mens nogen er lav virker ikke alene: en healer, der holder igen, kan
blive ved at caste (lave ranks eller heals på fuldt liv), og alle caster mindre på bosser med meget
bevægelse (Azgalor). Andelen fanger begge dele, og sammenligningen pr. boss tager mekanikker med.

Tjekket på guildens egne aftener: 16. september 3 af 11 kills over puljens 95-percentil (Naj'entus,
Reliquary og Rage Winterchill med den tidligere tærskel), hvor den samme healer lå på 0,28 og 0,33 af
en jævn andel med parse 1, mens to andre parsede 95–99; de tre aftener før 2 af 25; 27. oktober 0 af
14; puljen 5 % per definition. Med de endelige tærskler er det 2 af 11 den 16. september.

Ujævne kills tages ud af puljen, før den tilpasses (25 af 533 kills), så andre guilds' arrangerede
kills ikke strækker HPS-skalaen. I appen tæller et ujævnt kill ikke med i fire-ugers-scoren for
nogen af healerne i det; det står i listen over kills, og selve killet får en advarsel. Cirka 1 af
20 almindelige kills bliver taget ud ved en fejl; en guild, der roterer, ligger på 20–30 %. Målet
kan ikke bevise hensigt, kun at killet ikke viser almindeligt spil.

### Healere der holder igen

Fordelingen fanger kun kills, hvor hele fordelingen er skæv, og kun kills. En officer gennemgik
guildens to seneste raids og fandt 16 tilfælde (kills og wipes), hvor en healer holdt igen: høj idle,
lav HPS, overheal på de forkerte mål, eller næsten ingen healing (under 5 % af raidets healing, så
healeren slet ikke talte som healer, og healer-siden gav en fejl).

Målet (`heldBack` i `shared/healerScore.ts`) ser på den enkelte healer på kampe på mindst et
minut, hvor healerens score (mod puljen, rettet for bossen) er 35 eller lavere, og et af to:

- **Andel:** healerens andel af healingen (i forhold til specens sædvanlige) er højst 0,6 af
  healerens egen sædvanlige andel den aften (medianen over aftenens øvrige kills, mindst 3), eller
  puljens laveste 3 % på bossen, hvis det er lavere (Teron 0,49, Kaz'rogal 0,43, Reliquary 0,50;
  Gurtogg, Council og Illidan omkring 0,73). Med en score på 15 eller lavere er grænsen 0,7.
- **Idle:** 25 point mere idle mens nogen var lav end kampens øvrige healere og 20 point mindre tid
  på at caste.
- **Løft:** en anden healer gjorde mindst 1,6 gange sin sædvanlige andel, mens healeren gjorde højst
  0,8 af sin og var 15 point mere idle end sin egen sædvanlige idle (medianen over aftenens øvrige
  kills). En healer, der altid er idle, eller altid ligger lavt på bossen, markeres ikke af den.

Healere under 5 % af raidets healing (`minorHealers` i `FightModel`) tages med her, men tæller
ikke som raidets healere for kontekst, peers, fordelingen eller puljen, og et kill, hvor healeren
var under 5 %, tæller ikke med i healerens sædvanlige andel. På Teron hentes Shadow of Death
(debuff 40251, én ekstra forespørgsel): en healer, der var ånd (op til 60 s efter debuffen) i
mindst en femtedel af kampen, bedømmes ikke.

| | Fundet |
|---|---|
| Officerens 16 tilfælde | 13 (mangler Kodomuf på Naj'entus-wipen, Azgalor og Supremus) |
| Andre healer-kampe i de to raids | 4 af 107: tre bekræftet af officeren (Sanctalux på en Reliquary-wipe på 5 min, Smallp på Anetheron 16. sep., Kodomuf på Akama med 0,19 af sin sædvanlige andel) og Banantyv på Supremus 16. sep. (0,75 af sin andel og 34 point mere idle end normalt, mens Sanctalux lå på 1,7), som officeren godtog |
| Puljens raids (andre guilds) | 2,9 % af healer-kills (2,3 % uden grænsen ved score 15 og lavere og løft-reglen) |

På Supremus-killet 16. sep. lå tre healere lavt, mens Sanctalux lå på 1,7 af sin sædvanlige andel.
Banantyv var 34 point mere idle end normalt og markeres. Manatides (0,60 af sin andel) var kun 7
point over sin normale idle, og han lå også lavt på Supremus ugen før (0,74 af specens andel, score
19). Kodomuf (0,75) var 23 % idle, men hans sædvanlige idle den aften var 19 %, fordi han også var
meget idle på aftenens BT-kills (84 % på Reliquary). Mod ugen før (cirka 7 %) var det 16 point mere,
men Show healers kender kun aftenens kills. På Naj'entus-wipen lå hans andel (0,90), idle (16 %) og
casting som de andres; på Azgalor var andelen 0,80 af hans sædvanlige, uden at nogen lå højt.

Prøvet og droppet: løft-reglen uden idle-kravet markerede også Manatides og hævede puljens andel til
3,9 %, og dens ekstra markeringer i puljen landede ikke oftere i aftener med andre markeringer end
tilfældigt. Sædvanlig andel som 75 %-fraktilen i stedet for medianen fangede færre (12) og gav flere
falske.

En faste score-grænse på 30 i stedet for 35 fandt 11 af 16 med de samme falske alarmer; uden
boss-grænserne var puljens andel 3,4 %. Målet bruges kun på de healere, der kigges på, ikke til
at rense puljen. På healer-siden er "sædvanlig" healerens andel på de kills, browseren har gemt
(samme raid med mindst 3, ellers de fire uger); på **Show healers** aftenens øvrige kills. Et kill,
hvor en healer holdt igen, tæller ikke med i nogen af healernes fire-ugers-score.

### Er puljen for god?

Healing parses sammenligner med alle healere på bossen, også de svage. Puljens raids er alle blandt
de cirka 1.000 reneste kills (execution-rangeringen stopper ved side 20), så den hælder mod gode
raids. Tjekket med healernes egne healing parses (percentil blandt alle af samme spec på bossen,
gennemsnit 50 for alle healere):

| | Healing parse, gennemsnit | Score, gennemsnit |
|---|---|---|
| Puljen (de første 1.150 kills), 50 healer-kills fordelt på specs | 55 (median 58) | 50 |
| Raids fra toppen af execution-rangeringen | 68 | |
| Raids fra side 20 | 44 | |
| En guild-raid, 7 healere over 193 kills | 55 | 52 |

Puljen ligger 5 parse-point over gennemsnittet. I puljen scorer healere med parse 0–24 i snit 25 og
med 75–100 i snit 60, cirka 0,5 score-point pr. parse-point, så hældningen trækker en typisk healer
cirka 2 point ned: lille mod de ±20, ét kill svinger. Guild-raidets healere parser som puljen og
scorer 52, så skalaen er ikke presset ned for en almindelig guild. Den udvidede pulje er de samme raids på flere bosser, så tjekket gælder
stadig.

