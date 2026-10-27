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
| `exec-breakdown.ts <rapport> <fight> <source> [iterationer]` | Pr. ability, hvor rigtig og simmet DPS skilles, og auras med forskellig uptime |
| `party-check.ts <rapport> <fight> <source>` | Shamans, totems, Moonkin Aura og shadow priest-mana for hver sammenlignet spiller |
| `show-env.ts` / `show-detected.ts <rapport> <fight> <source>` | Buffs og debuffs, og hvad sim-miljøet får ud af dem |
| `dump-request.ts <spec> <rapport> <fight> <source> <fil.json>` | En spillers sim-forespørgsel som JSON |
| `healer-check.ts <rapport>:<fight> [...] [--json fil]` | Healer-tallene for alle healere i et eller flere kills, én linje pr. healer, plus dødsfald |
| `healer-peers.ts <rapport>:<fight> [navn ...]` | Hvilke peers hver healer får, fra hvilke raids, og hvad det kostede i kald |
| `healer-analyze.ts <rapport>:<fight> <navn>` | Hele healer-analysen som tekst: bedømte tal, kontekst, spells og fund |
| `tank-check.ts <rapport>:<fight>[:<navn>] [...]` | Tank-tallene for alle tanks (eller én) i et eller flere kills |
| `tank-analyze.ts <rapport>:<fight> <navn>` | Hele tank-analysen som tekst: peers, bedømte tal, kontekst og fund |
| `role-sweep.ts <rapport> [...]` | Healer- og tank-tallene for alle healere og tanks på alle boss-kills i rapporterne, med tjek for NaN, nedbrud og tal uden for deres grænser (fx armor over 75 %) |
| `tank-sim.ts <rapport>:<fight> <navn> [iterationer]` | Tank-simmen med kommandolinje-simmen (`WOWSIMS_CLI`): bossen, opener-dommen, threat og skade taget mod simmen for dig og peers, og gear-byt |

## Sim-nøjagtighed

| Script | Hvad det gør |
|---|---|
| `sim-vs-log.ts boss <encounterId> [antal]` | Rigtig mod simmet DPS for top-spillere, med crit på hoved-abilityen |
| `sim-vs-log.ts player <rapport> <fight> <source>` | Casts, crit og skade pr. ability, rigtig mod sim |
| `sim-vs-log.ts crit <encounterIds...>` | Hvide/gule angrebstabeller uden for Recklessness over mange spillere |
| `crit-unbiased.ts` | Crit mod sim over *alle* kills for et udsnit af spillere (udvælgelses-tjekket) |
| `audit-auras.ts <encounterIds...>` | Auras på top-spillere, der ikke er koblet til simmen |
| `cd-timing.ts <cooldown> <encounterIds...>` | Hvornår top-spillere bruger en cooldown, som andel af kampen |

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
