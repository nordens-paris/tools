# Udviklerværktøjer

Alle scripts køres fra projektmappen med `npx tsx --env-file=.env scripts/<navn>.ts ...`. Scripts,
der simmer, bruger kommandolinje-simmen (`WOWSIMS_CLI`). De
bruger samme cache som serveren, så gentagne kørsler er gratis på Warcraft Logs-budgettet.
`npm run typecheck` tjekker også scripts.

Scripts, der arbejder på tværs af mange spillere (`sim-vs-log`, `crit-unbiased`, `audit-auras`,
`cd-timing`, `show-env`), vælger spec med `SPEC=<key>` (f.eks. `SPEC=warlock-destruction`,
`mage-arcane`, `priest-shadow`; standard er `warrior-fury`). Resten finder spec'en ud fra spilleren.

## Byg og data

| Script | Hvad det gør |
|---|---|
| `build-wowsims.mjs <klon> [--wasm-only]` | Lægger `wowsims-patches/` ind i en tbc-new-klon og bygger WebAssembly-simmen til `web/public/sim/` og `bin/wowsimcli` |
| `screenshots.ts [url]` | Tager skærmbillederne til README'en med eksempel-loggene (kræver `npm run dev` og Chrome/Edge) |
| `extract-wowsims-data.mjs <klon> [--only=fil,fil]` | Henter navne, ikoner, talenttræer, procs, APL'er og tank-stats til `data/wowsims/` (`npm run extract-wowsims`); `--only` skriver kun de nævnte filer |
| `check-threat.ts <klon>` | Tjekker tank-threat-værdierne i `server/specs/tanks.ts` mod WoWSims-kilden |

## Hverdagsværktøjer

| Script | Hvad det gør |
|---|---|
| `full-run.ts <rapport> <fight> <source> [top\|peers] [iterationer]` | Hele analysen og alle sims: fund, what-ifs med ændringer og execution delt i gear, kill-tid, spil og held |
| `try-analysis.ts <rapport> <fight> <source> [--sim] [--dump fil.json]` | Analysen som tekst; `--dump` skriver sim-forespørgslen |
| `log-probe.ts <rapport> <fight> <source>` | Alt om én spiller i én kamp; startpunktet for en ny spec |
| `top-probe.ts <encounterId> <klasse-id> <spec-id> [antal]` | Hvad top-spillerne af en klasse/spec gør på en boss: våben med våbentype, temp-enchants, hit- og expertise-rating, pets, talentfordeling og casts pr. minut, plus de casts de fleste bruger. Kræver ingen spec-fil |
| `exec-breakdown.ts <rapport> <fight> <source> [iterationer]` | Pr. ability, hvor rigtig og simmet DPS skilles, og auras med forskellig uptime |
| `party-check.ts <rapport> <fight> <source>` | Shamans, totems, Moonkin Aura og shadow priest-mana for hver sammenlignet spiller |
| `show-env.ts` / `show-detected.ts <rapport> <fight> <source>` | Buffs og debuffs, og hvad sim-miljøet får ud af dem |
| `dump-request.ts <spec> <rapport> <fight> <source> <fil.json>` | En spillers sim-forespørgsel som JSON |
| `healer-check.ts <rapport>:<fight> [...] [--json fil]` | Healer-tallene for alle healere i et eller flere kills, én linje pr. healer, plus dødsfald |
| `healer-peers.ts <rapport>:<fight> [navn ...]` | Hvilke peers hver healer får, fra hvilke raids, og hvad det kostede i kald |
| `healer-analyze.ts <rapport>:<fight> <navn>` | Hele healer-analysen som tekst: bedømte tal, kontekst, spells og fund |
| `healer-score-ref.ts` | Bygger healer-scorens referencepulje (`shared/healerScoreRef.json`) fra de indsamlede kills i `.cache/healer-score-samples*.json`, uden kald: tilpasning og percentiler pr. spec og en korrektion pr. boss. Tjekker at puljen ligger omkring 50 for hver spec og boss, og scorens stabilitet fra uge til uge med og uden boss-korrektionen. Køres igen ved en ny fase, efter nye kills er samlet med `healer-score.ts`, `healer-weeks.ts` og `healer-pool-bosses.ts` |
| `tank-check.ts <rapport>:<fight>[:<navn>] [...]` | Tank-tallene for alle tanks (eller én) i et eller flere kills |
| `tank-analyze.ts <rapport>:<fight> <navn>` | Hele tank-analysen som tekst: peers, bedømte tal, kontekst og fund |
| `unknown-ids.ts` | Gear-items, gems og enchants i de cachede logs (alle spillere i alle analyser kørt på maskinen), som WoWSims eller vores data ikke kender, mest brugte først med Wowhead-link. Ukendte items udelades af sims; er et ID samme item under et andet ID, kan det skrives i `ITEM_ALIASES` i `server/data/db.ts` |
| `role-sweep.ts <rapport> [...]` | Healer- og tank-tallene for alle healere og tanks på alle boss-kills i rapporterne, med tjek for NaN, nedbrud og tal uden for deres grænser (fx armor over 75 %) |
| `tank-sim.ts <rapport>:<fight> <navn> [iterationer]` | Tank-simmen med kommandolinje-simmen (`WOWSIMS_CLI`): bossen, opener-dommen, threat og skade taget mod simmen for dig og peers, og gear-byt |

## Sim-nøjagtighed

| Script | Hvad det gør |
|---|---|
| `validate-spec.ts <spec-key> <encounterId...> [--n=10] [--iterations=500]` | Godkendelsen af en specs sim-opsætning (`--ids` viser rapport, fight og source til `exec-breakdown.ts`): simmer top-spillerne på hver boss og viser execution før og efter held (median og den midterste halvdel), plus abilities i loggen som simmen aldrig brugte, gear WoWSims ikke har, og våben-enchants eller consumes der ikke er koblet. Top-spillere skal ligge omkring 90–105 % af deres sim efter held, med den midterste halvdel inden for cirka 12 point. Anniversary-bosser er 50601–50622 |
| `sim-vs-log.ts boss <encounterId> [antal]` | Rigtig mod simmet DPS for top-spillere, med crit på hoved-abilityen |
| `sim-vs-log.ts player <rapport> <fight> <source>` | Casts, crit og skade pr. ability, rigtig mod sim |
| `sim-vs-log.ts crit <encounterIds...>` | Hvide/gule angrebstabeller uden for Recklessness over mange spillere |
| `crit-unbiased.ts` | Crit mod sim over *alle* kills for et udsnit af spillere (udvælgelses-tjekket) |
| `audit-auras.ts <encounterIds...>` | Auras på top-spillere, der ikke er koblet til simmen |
| `cd-timing.ts <cooldown> <encounterIds...>` | Hvornår top-spillere bruger en cooldown, som andel af kampen |
| `swing-table.ts <spec-key> <encounterIds...> [--n=8]` | Hvide slag over en specs top-spillere, log mod deres egne sims: crit, glancing, miss, dodge og parry |
| `white-hits.ts <rapport> <fight> <source> [kørsler]` | Én spillers hvide slag: slag pr. sekund, udfald, attack power og slagets skade før armor, log (`unmitigatedAmount`) mod simmens debug-log |
| `armor-check.ts <rapport> <fight> <source>` | Bossens armor målt fra loggen (hvert normalt fysisk slag har skade før og efter armor) pr. 10 s, mod det simmen antager. Blood Frenzy (+4 % efter armor) ses som cirka 500 armor mindre |
| `armor-timeline.ts <rapport> <fight> [sekunder]` | De første fysiske slag med bossens armor ved siden af hvornår armor-debuffs kom på: bossens egen armor og hvad hver debuff tager |
| `resist-check.ts <rapport> <fight> <source>` | Andel af en spillers spell-hits med partial resist, og skade resisteret, pr. ability |
| `seal-procs.ts <rapport> <fight> <source>...` | Hvad en Retribution-paladins seal-procs kom fra (hvidt slag, Crusader Strike, den anden seal) |

## Sim-hastighed

| Script | Hvad det gør |
|---|---|
| `sim-timing.ts <rapport> <fight> <source> [iterationer]` | Én spillers egen sim med kommandolinje-simmen: tid, hændelser pr. sekund og auras. Gemmer requesten i `.cache/sim/timing-*.in.json` |
| `sim-timing-page.ts <rapport> <fight> <source> [iterationer]` | Alle sims bag en DPS-side én ad gangen: antal, samlet tid og de langsomste |
| `wasm-timing.mjs <request.json>...` | Browserens sim (WebAssembly på én kerne, som i en Web Worker) på gemte requests |

`EXTRA_STATS="13:221,17:140"` lægger stats til alle sims i `sim-vs-log.ts` (13 spell crit rating,
17 AP, 21 melee crit rating) til eksperimenter. Fresh encounter-ID'er: Hyjal 50618–50622, BT
50601–50609.

## Undersøgelser (engangs-scripts)

Brugt til at finde konkrete fejl; beholdt som eksempler og til at gentage tjekket.

| Script | Undersøgte |
|---|---|
| `sb-gap.ts`, `sb-hits.ts`, `sb-auras.ts` | Shadow Bolt-skade i loggen mod simmen (Improved Shadow Bolt, spell power) |
| `rage-probe.ts` | Rage fra modtaget skade (Death & Decay) |
| `target-probe.ts` | Skade fordelt på mål (adds) |
| `pet-probe.ts` | Pets og lokaliserede pet-navne |
| `party-probe.ts`, `totem-probe.ts` | Party-auras og shamans' totem-casts |
| `ci-stats.ts`, `buff-list.ts`, `raw-hits.ts` | Combatant-stats, alle buffs og rå hit-detaljer |
| `parse-probe.ts`, `temp-enchants.ts` | En karakters rå parses; våben-enchants ved pull |
| `healer-score.ts`, `healer-outcomes.ts`, `healer-crossval.ts`, `healer-weeks.ts`, `healer-pool-bosses.ts` | Healer-scorens prototype og pulje (`healer-pool-bosses.ts` henter de bosser, prototypen sprang over, fra de samme rapporter): hvilke mål er et træk ved healeren og fair på tværs af raids ([healer-score.md](healer-score.md)) |
