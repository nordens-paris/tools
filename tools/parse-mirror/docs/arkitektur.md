# Arkitektur

Parse Mirror er én TypeScript-kodebase: en Node/Express-server, der henter og analyserer logs, og
et React-UI bygget med Vite. WoWSims kører som WebAssembly i den besøgendes browser (eller, med
`SIM_MODE=cli`, som kommandolinjeværktøj på serveren). Typer, der deles mellem de to, ligger i
`shared/types.ts`.

```
web (React)  ──/api──▶  server (Express)  ──▶  Warcraft Logs v1 API (cache i .cache/wcl)
   │  ▲                       │            ──▶  classic-armory.org (talenter)
   │  └── sim-jobs ───────────┘
   └──▶ Web Workers med WoWSims (WebAssembly, web/public/sim/)
```

## Mapper

| Mappe | Indhold |
|---|---|
| `server/wcl/` | Warcraft Logs v1-klient med disk-cache og rate limit-styring |
| `server/armory/` | Rigtige talenter fra classic-armory.org (loggene gemmer kun point pr. træ) |
| `server/analysis/` | Henter én spillers kamp, finder sammenligningsgruppen, bygger metrics og fund |
| `server/analysis/healer/` | Healer-analysen: raid-wide data, metrics, peers fra velspillede raids, sammenligning |
| `server/sim/` | Bygger WoWSims-forespørgsler ud fra loggen, kører what-ifs, held og "hvor kommer forskellen fra" |
| `server/specs/` | Alt spec-specifikt; én fil pr. spec (se [ny-spec.md](ny-spec.md)); healer-specs i `healers.ts` |
| `server/data/` | Opslag i WoWSims-data: items, enchants, gems, staveformer, talenter, consumables |
| `server/game.ts` | Alt der afhænger af spilversionen (se [forever.md](forever.md)) |
| `web/src/` | UI'et. Produktnavnet står i `web/src/brand.ts`, URL-skemaet i `web/src/route.ts` |
| `data/wowsims/` | Udtræk fra WoWSims (`npm run extract-wowsims`): navne, ikoner, talenttræer, rotationer (APL'er), procs |
| `wowsims-patches/` | Vores rettelser til WoWSims, lagt ind af `scripts/build-wowsims.mjs` |
| `scripts/` | Dev-værktøjer (se [udviklerværktøjer.md](udviklerværktøjer.md)) |

## Warcraft Logs-klienten (`server/wcl/client.ts`)

- **Cache.** Rapportdata ændrer sig ikke, så de caches for altid i `.cache/wcl`, gzippet (event-data
  fylder cirka en tiendedel; ældre ukomprimerede filer læses stadig). `events(..., fields)` gemmer
  kun de felter, der bruges: raid-wide events har position, stats og meget mere på hver linje. Undtagelse: fight-listen
  for en rapport, der sluttede for under 12 timer siden, opdateres hvert 5. minut (den kan stadig
  blive logget). Rankings og en spillers parses caches i 6 timer. Ens forespørgsler, der er i gang
  samtidig, deler ét kald.
- **Rate limits.** Hvert svar har `x-ratelimit-limit`/`x-ratelimit-remaining` for et vindue på
  cirka et minut (800 på den nuværende plan). Klienten kører højst 8 kald ad gangen (`WCL_CONCURRENCY`) og holder pause,
  når der er under 25 tilbage. Ved 429 venter den som serveren beder om (ellers 15–120 s), og ved
  netværksfejl eller 5xx prøver den igen to gange.
- **Timebudgettet** (3.600 point i timen pr. nøgle) kan ikke ses gennem v1, så kald i den seneste
  time tælles som et skøn. Klik **ikke** "Use New Limits" på Warcraft Logs: det sænker budgettet
  til 1.000.
- **Sprog.** Logs på andre sprog hentes med `translate=true`, som giver moderne engelske navne;
  navne rettes derefter til TBC-navne efter stave-ID (`spellName()` i `server/data/db.ts`).
- **Forbrug.** En frisk analyse koster omkring 30 kald (én combatant info for hele raidet,
  tabeller, cast-events, plus events for casters). Top-spillere deler ofte raid, så kampdata hentes
  én gang. Gentagne visninger kommer fra cachen.

## Analysen (`server/analysis/`)

1. **`analyze.ts`** finder spec ud fra spillerens ikon (`Warrior-Fury` osv.), vælger
   sammenligningsgruppen og samler alle spillere parallelt:
   - *Top 10:* side 1 af rankings for boss/klasse/spec.
   - *Same gear, a step ahead:* spillerens egen parse (`characters.ts`) giver percentil, item level
     og antal parses; derfra findes et rank-bånd 5–25 percentilpoint over, op til tre rankings-sider,
     filtreret på item level ±4 (±8) og højere DPS end dig.
   Private eller ødelagte rapporter springes over og erstattes af den næste.
2. **`collect.ts`** henter én spillers kamp: gear og stats (combatant info), buffs, debuffs på
   bossen, casts, skade (også kun mod bossen, så skade på adds ikke tæller mod simmen), consumables,
   cooldowns, aktiv tid og huller mellem casts (channels som Mind Flay tæller med), hit chance,
   Power Infusion, Improved Shadow Bolt-andel af egne hits, party og totems.
3. **`findings.ts`** laver den rangerede liste af fund (rotation, cooldowns, consumables, gear,
   hit, talenter, raid buffs, kill-tid). Teksterne følger gruppen ("top players" / "players a step
   ahead").
4. `raid.ts`, `guild.ts` og `progress.ts` laver de billige oversigter. `raid.ts` (én spillers raid)
   og `guild.ts` (hele raidet) bruger de samme kald pr. boss (skadetabel, combatant info,
   debuff-tabel og én event-forespørgsel), så de deles gennem cachen, plus cachede rankings og
   parses. Consumables, gear, parties og debuffs kommer fra fælles funktioner i `raidAudit.ts`. Parses matches til kills på boss og pull-tid, fordi Warcraft Logs
   kun ranker én rapport, når flere logger samme raid.
5. `raidAudit.ts` laver officer-tjekkene på hele-raidet-siden ud fra fire kald pr. boss-kill
   (skadetabel, combatant info, debuff-tabel og én event-forespørgsel for drums, Vampiric
   Touch-mana og potions):
   - *Parties:* spillere samles (union-find) når de fik samme drum-brug, mana fra samme shadow
     priest, eller samme party-aura fra samme caster. Der er højst én gruppe pr. fem spillere:
     overskydende brudstykker lægges sammen (mindste først), og spillere uden spor sættes på et
     gæt i en gruppe med plads og flest af samme rolle (`guessed`). Noter regner kun med sikre
     medlemmer, og noter om noget manglende kræver, at gruppen er fuld, eller at ingen (shaman)
     er gættet.
   - *Debuffs:* uptime pr. kill fra debuff-tabellen; Improved Shadow Bolt og Shadow Weaving hedder
     begge "Shadow Vulnerability" og matches derfor på spell-ID. Sunder og Expose Armor er én række.
   - *Gear:* enchants på de slots alle kan enchante, tomme sockets (antal sockets kommer fra
     WoWSims' database, `s` i `items.json`), grønne gems, og hit for de understøttede specs med
     standard-talenter, Draenei-aura og Totem of Wrath.
   - *Flask:* "full" (flask eller battle + guardian elixir), "half" (én elixir) eller "none".

### Party og totems

Totem-buffs logges ikke på Anniversary, og Bloodlust er raid-wide, så party skal udledes:

- **Drums:** én brug rammer hele trommeslagerens party på samme øjeblik.
- **Vampiric Touch-mana:** alle i shadow priestens party får mana-ticks fra samme præst.
- **Party-auras med kilde:** Moonkin Aura, Battle Shout, paladin-auras m.fl. i combatant info.

Drums og Vampiric Touch hentes i ét kald. Casts før pull logges sjældent, så en shaman i partyet
antages at holde de sædvanlige totems oppe hele kampen (melee: Strength of Earth; caster: Wrath
of Air og Mana Spring, plus Totem of Wrath fra en Elemental). Windfury findes fra dens procs.
`totems` i spec-filen bestemmer, hvor strengt det er:

| Spec | Regel |
|---|---|
| Arcane Mage, Shadow Priest | Kun shamans bevist i partyet (de står næsten altid sammen og sjældent med en Elemental) |
| Destruction Warlock | Totem of Wrath, hvis der er en Elemental et sted i raidet |
| Øvrige | Partyets shamans, eller raidets hvis partyet ikke kan findes |

En shadow priest i partyet giver desuden præstens DPS videre til simmen som Vampiric Touch-mana.

## Healere (`server/analysis/healer/`)

Healere simmes ikke (WoWSims' healer-specs har ingen rotation eller indkommende skade), så alt
kommer fra loggen og en sammenligning med andre healere.

1. **`data.ts`** henter et kill raid-wide i cirka 10 kald: healing, damage taken, casts, buffs,
   deaths, mana-ændringer (`resourcechange`), combatant info, healing-tabellen (spec-ikoner) og
   bossens melee pr. spiller (finder tanks). Ét hent dækker alle healere i raidet.
2. **`model.ts`** (`FightModel`) bygger det fælles billede: HP over tid for alle (HP står i *procent*
   på events, for den aktør `resourceActor` peger på), maksimalt liv (store hits delt med det
   procenttal, de tog, ellers `10 × stamina + 4000`), dødsfald (Feign Death logges som død ved fuldt
   liv og springes over), tanks (tank-spec med en reel del af bossens melee, eller over 20 % af den,
   f.eks. Bloodboils Fel Rage-mål) og healere (healer-spec og mindst 5 % af raidets healing).
   Mana læses i to layouts: `amount/max/type 0/cost`, eller forskudt ét felt (`amount` = max,
   `max` = pris, `type` = nuværende), som nogle loggere skriver, også guildens.
3. **`metrics.ts`** regner pr. healer: opgave (andel på tanks), mana og cooldowns, spells med ranks,
   overheal fordelt på årsag (bedømt ud fra hullet, da healeren lagde sig fast: cast-start, eller
   lige før en instant lander), afbrudte casts, reaktion, saves, præ-heals på tanks, aktivitet og
   tomgang i 100 ms-trin, upkeep (Earth Shield, Lifebloom-stacks) og dispels, samt dødsfald (burst,
   fast eller med tid til at redde, og om evnen rammer på en timer).
4. **`peers.ts`** finder fem healere at sammenligne med: bossens `execution`- og `speed`-rangeringer
   (hele raids; rækkerne har antal healere, damage taken og dødsfald, så miljøet matches uden ekstra
   kald). Rankings' `damageTaken` er præcis summen af skade på spillere uden absorbs, samme tal som
   vores. Pr. kandidat-raid ét kald: healing-tabellen `by=target` (rækkens `startTime - reportStart`
   er kampens start i rapporten, så fight-listen er unødvendig), der giver hver healers andel på
   tanks og spec-ikon. Raids tjekkes 8 ad gangen og kun, til der er nok healere at vælge imellem.
   Tre trin: samme antal healere og ±25 % skade pr. healer;
   ±1 healer og ±40 %; ellers nærmeste opgave. Op til 12 kandidater pr. trin får tjekket deres
   parses på én gang (fight-liste for serveren og 1 opslag hver): median ≥ 50 over mindst 3 kills, og de mest stabile vælges. (HPS-parses er
   lave for alle i raids med mange healere, så en højere grænse smider netop dem ud.)
5. **`compare.ts`** henter peers' kills, deler tallene i *bedømt* (rimeligt uanset raidet) og
   *kontekst* (HPS, andel af raidets healing, samlet overheal, mana tilbage) og laver fund.
6. **`raid.ts`** laver healer-rækkerne til raid-siderne, uden peers.

En healer-analyse koster cirka 10 kald for eget kill, 10–60 for at finde peers og cirka 50 for
deres kills første gang (omkring 10 sekunder kold, mod 47 før kaldene kørte parallelt); peers deles
af alle healere med samme spec på samme boss.

## Simmen (`server/sim/`)

- **`request.ts`** oversætter en spillers kamp til en WoWSims `RaidSimRequest`: gear, talenter,
  race, consumables, rotation (APL fra `data/wowsims/`) og boss (level, armor, type fra
  `game.ts`). Bloodlust og spec'ens `timedCooldowns` (f.eks. Recklessness, Arcane Power) bruges på
  det tidspunkt, spilleren brugte dem.
- **`environment.ts`** oversætter buffs og debuffs fra loggen til WoWSims' raid/party/individual
  buffs og debuffs, plus mana fra andre (Innervate, Mana Tide, Vampiric Touch). Buffs WoWSims ikke
  kender (Dark Iron Pipeweed, Rallying Cry...) lægges til som stats vægtet med uptime.
- **`scenarios.ts`** kører what-ifs og execution:
  - *Your setup* (dit eget), *consumes* (gruppens mest brugte, byttet ind pr. kategori; flask og
    battle/guardian elixirs udelukker hinanden), *raid buffs* (det flertallet af gruppen havde; der
    fjernes aldrig noget, du havde), *gear* (rank 1's gear) og *alt det ovenstående*.
  - *Execution:* rigtig DPS ÷ simmen af spillerens eget setup på deres egen kill-tid, skaleret så
    gruppens median er 100 %. Hver spiller simmes også på din kill-tid, så forskellen kan deles i
    gear & buffs, kill-tid, spil og held.
  - **Rækkefølge:** alle sims deler én grænse for, hvor mange der kører på én gang, og sættes i kø,
    så snart de kan: scenarierne og hver spillers egen sim med det samme, held- og kill-tid-sims
    når spillerens egen sim er tilbage. Hver sim har en fast startværdi, så rækkefølgen ændrer
    ikke resultaterne.
  - **Hvor sims kører** (`server/sim/browser.ts`, `web/src/browserSims.ts`): serveren laver hver
    sim som et job og giver browseren op til 24 ad gangen. Browseren henter jobs
    (`GET /api/sim/:id/jobs`, long poll), giver hvert job til en ledig Web Worker (én pr. kerne,
    højst 6, eller 10 med mindst 8 GB hukommelse; modulet kompileres én gang og deles) og sender
    resultaterne tilbage (`POST /api/sim/:id/results`). Workers lukkes et minut efter sidste sim.
    Jobs, der ikke bliver besvaret inden for 90 s, sendes ud igen. Med `SIM_MODE=cli` kører op til
    otte `wowsimcli`-processer på serveren (`SIM_PARALLEL`), én analyse ad gangen; hver proces
    bruger selv alle kerner.
- **`luck.ts`** og **`procs.ts`**: held i tre dele, se [sim-noejagtighed.md](sim-noejagtighed.md).

## Web-UI'et (`web/src/`)

- `App.tsx` styrer visninger og URL'er (`route.ts`). Åbnede kampe huskes i fanen, så tilbage/frem
  ikke kører analysen igen. Hvis serveren har glemt en analyse (genstart), køres den automatisk
  igen.
- `group.ts` giver alle paneler de samme ord for sammenligningsgruppen.
- Komponenterne i `components/` svarer til fanerne: Overview (Fix first, fund), Rotation,
  Cooldowns, Consumes, Gear (inkl. hit), Sim (held, what-ifs, hvor forskellen kommer fra), Players.
- `components/healer/` er healer-siden (Overview, Mana, Spells, Overheal, Response, Deaths, Peers)
  og healer-delene af raid-siderne. `/api/analyze` svarer med `kind: 'healer'` for healere.

## API'et

| Endpoint | Svar |
|---|---|
| `GET /api/config` | Spilprofilens offentlige del (Warcraft Logs-side, Wowhead-sti) |
| `GET /api/quota` | Forbrug for den nøgle, der bruges |
| `GET /api/report/:code` | Rapportens bosses og spillere |
| `GET /api/raid/:code/:source` | En spillers raid |
| `GET /api/guild/:code` | Alle på alle bosses |
| `GET /api/guild/:code/healers` | Alle healere på alle bosses (uden peers) |
| `GET /api/progress/:code/:source` | En spillers parses over tid |
| `POST /api/analyze` `{report, fight, source, mode}` | Analysen (`mode`: `top` eller `peers`); for en healer healer-analysen (`kind: 'healer'`) |
| `POST /api/sim` `{analysisId}` | Starter sims for en analyse (med `SIM_MODE=cli`: venter og returnerer resultatet) |
| `GET /api/sim/:id/jobs` | Browser-sims: ventende jobs, eller det færdige resultat |
| `POST /api/sim/:id/results` | Browser-sims: resultater af kørte jobs |

Analyser holdes i hukommelsen (de seneste 50, `MAX_ANALYSES`), så sim-trinnet kan genbruge de
hentede data. Opslag på serverens Warcraft Logs-nøgle er begrænset pr. besøgende
(`VISITOR_LOOKUPS_PER_HOUR`); en healer-analyse tæller som tre opslag og healer-panelet som to. Med
egen nøgle er der ingen grænse.
