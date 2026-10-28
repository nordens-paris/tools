# Sådan tilføjes en ny spec

En spec er én fil i `server/specs/`, der beskriver hvad der skal måles i loggen, og hvordan
WoWSims-spilleren bygges. Resten af værktøjet (analyse, fund, sims, UI) er fælles.

## 1. Find en god log

Vælg et kill med en spiller af specen, helst fra guilden, og kør:

```bash
npx tsx --env-file=.env scripts/log-probe.ts <rapport> <fight> <source>
```

Det viser spillerens ikon (f.eks. `Mage-Arcane`), pets, skade pr. ability, casts med stave-ID og
`begincast`-tal (cast-tid eller instant/channel), alle buffs med uptime, combatant-stats og
talentfordelingen.

## 2. Find WoWSims' del

I en klon af [wowsims/tbc-new](https://github.com/wowsims/tbc-new):

- `ui/specs/<klasse>/<spec>/apls/*.apl.json`: rotationen. Tilføj en `copy(...)`-linje i
  `scripts/extract-wowsims-data.mjs`, så den ender i `data/wowsims/`.
- `ui/specs/<klasse>/<spec>/presets.ts`: standardtalenter, consumables og options.
- `proto/<klasse>.proto` og `proto/api.proto` (`oneof spec`): navnet på spec-feltet
  (f.eks. `mage`, `dpsPriest`) og dets options.

## 3. Skriv spec-filen

Kopiér den spec, der ligner mest (`warlock-destruction.ts` for casters, `warrior-fury.ts` for
melee), og tilføj den i `server/specs/index.ts` og `SUPPORTED` i `web/src/brand.ts`. En anden spec
af samme klasse kan bygge på en eksisterende (`warrior-arms.ts` spreder `warriorFury` og ændrer det,
der er anderledes). `scripts/top-probe.ts <encounterId> <klasse-id> <spec-id>` viser, hvad
top-spillerne af en spec gør (våben, talentfordeling, casts pr. minut), før der findes en spec-fil.

| Felt | Betydning |
|---|---|
| `specName` | Som i Warcraft Logs' ikon (`BeastMastery`); siden viser det med mellemrum |
| `wcl.classId` / `wcl.specId` | Warcraft Logs' ID'er til rankings (Druid 2, Hunter 3, Mage 4, Paladin 6, Priest 7, Rogue 8, Shaman 9, Warlock 10, Warrior 11; spec 1–3 i træ-rækkefølge, Druid: Balance 1, Feral 2, Guardian 3, Restoration 4) |
| `caster` | Cast-tid tæller som aktiv tid; huller mellem casts er vigtige; spell-hit og partial resists |
| `trackedCasts` | Abilities hvis casts pr. minut sammenlignes (`higherIsBetter`: `true`, `false` eller `null`) |
| `efficiency` | Kerne-abilities med cooldown: casts mod max mulige (`delaySec` hvis skaden først lander senere, som Curse of Doom) |
| `hit` | Combatant-stat (`hitSpell`, `hitMelee` eller `hitRanged`), rating pr. 1 %, cap mod en raid-boss, talenter der giver hit; `whiteCapPct` for dual wield (27 %), så hit over 8 % ikke kaldes spild |
| `expertise` | Melee: talenter der giver expertise (pr. point). Rating og race-våbenfærdighed (Human sværd/køller, Orc økser) lægges til af sig selv |
| `gcdAbilities` / `channels` | Instants på GCD'en og channels (længde i sekunder) til aktiv tid |
| `cooldowns` / `finishers` | Cooldowns hvis timing sammenlignes; finishers (Shadowburn) bedømmes ikke på timing |
| `castLabels` | Pænere navne ("Restore Mana" → "Super Mana Potion") |
| `petUptime` | Mål hvor længe pet'en slog (ét kald mere pr. spiller); WoWSims tager det som pet-uptime (hunters) |
| `castIds` | Abilities hvis navn dækker mere end selve casten (Stormstrike logger en cast pr. våben, Seal of Command pr. proc): kun det spell-ID tæller |
| `outcomeAliases` | Navne i loggens skade, der skal læses som simmens i held (Seal of the Martyr → Seal of Blood, Windfury Attack → Windfury Weapon) |
| `uptimes` / `debuffUptimes` | Buffs på spilleren og egne debuffs på bossen, hvis uptime sammenlignes |
| `totems` | `'party'` eller `'raid'`, se [arkitektur.md](arkitektur.md#party-og-totems) |
| `talentPresets` | WoWSims-talenter, når armory ikke har spilleren (vælges på nærmeste træfordeling) |
| `sim.specField` / `sim.specOptions` | WoWSims-spec-feltet og dets options (armor, pet osv.) |
| `sim.aplFile` | Rotationen i `data/wowsims/` (kan afhænge af hvad spilleren castede) |
| `sim.timedCooldowns` | Cooldowns simmen skal bruge, når spilleren gjorde (`keepCondition` beholder APL'ens egne tjek; `pet` er en pet, der viser at den blev brugt før pull, så den bruges ved 0 s). WoWSims bruger cooldowns uden en APL-handling ved pull, så alt med en cooldown, spillerne bruger anderledes, hører hjemme her |
| `sim.unmodeledDamage` | Skade simmen ikke kan lave (Infernal, Shadowguard); trækkes fra i execution |
| `sim.onlyIfCast` | Rotations-spells simmen kun caster, hvis spilleren castede dem (Immolate, Siphon Life); APL'ens handlinger for dem slås ellers fra |
| `sim.aplVariables` | APL-variabler sat ud fra det simmede gear (Arms: dual-wield- eller tohånds-gren; følger gear-byt i what-ifs) eller hvad spilleren gjorde: casts, pets og egne auras (Balance: "Use Faerie Fire") |
| `sim.excludeBuffs` | Buffs simmens rotation altid selv giver spilleren (en Elementals totems); tages ud af raid-miljøet, uanset hvem der gav dem, fordi WoWSims ville stakke dem |
| `sim.selfProvided` | Buffs og boss-debuffs, som klassens egen kode eller rotation i WoWSims giver spilleren (Trueshot Aura fra talenter, Judgement of the Crusader fra rotationen). Gav spilleren dem selv i loggen, tages de ud af raid-miljøet, så de ikke tæller to gange. Tjek i WoWSims' `sim/<klasse>/`, om klassen selv sætter auraen, før den skrives her |
| `sim.knockOn` | Hvad crits giver videre, til held-panelets tekst |
| `sim.notes` | Antagelser, der vises under "How the sim was set up" |

## 4. Tjek mod top 10

```bash
npx tsx --env-file=.env scripts/validate-spec.ts <spec-key> 50620 50622 --n=10
npx tsx --env-file=.env scripts/full-run.ts <rapport> <fight> <source>
npx tsx --env-file=.env scripts/exec-breakdown.ts <rapport> <fight> <source> 1000
```

`validate-spec` er godkendelsen: top-spillerne skal ligge omkring 90–105 % af deres sim efter held,
med en lille spredning, og listen over abilities, gear og enchants simmen ikke ser, skal være tom
eller forklaret. `full-run` viser fund, what-ifs og execution for top 10. `exec-breakdown` viser pr. ability, hvor
rigtig og simmet DPS skilles (casts pr. minut, hit-størrelse, crit, miss) og hvilke auras der har
forskellig uptime. Målet er, at top 10 med held fjernet ligger inden for cirka ±5 % af hinanden.
Typiske årsager til store udsving:

- En buff eller debuff, simmen ikke får (tjek "Raid buffs detected" i sim-noterne og
  `scripts/party-check.ts` for totems).
- En selv-buff, der ikke logges (armor, form) og skal antages i `specOptions`.
- En cooldown, APL'en bruger anderledes end spillerne (brug `timedCooldowns`).
- Skade simmen ikke laver (`unmodeledDamage`).

Kør til sidst `npm run typecheck`, åbn kampen i browseren og tjek alle faner.

## Healer-specs

Healere simmes ikke, så en healer-spec er kun en post i `server/specs/healers.ts`: ikonet
(`Priest-Holy`), Warcraft Logs' klasse- og spec-id til rankings, de heals kun den spec caster
(`signature`, som afgør spec'en for et rent klasse-ikon som "Priest"), og de buffs/HoTs den holder
på andre (`upkeep`). Tjek med `scripts/healer-check.ts` på et kill, og med `scripts/healer-peers.ts`,
at der findes peers.

## Tank-specs

En tank-spec er en post i `server/specs/tanks.ts`: ikonerne, Warcraft Logs klasse- og spec-id,
tank-auraen (stance/form/Righteous Fury) med threat-multiplier, talent-multiplier, spellenes threat
(`mult`, `flat`) med WoWSims-kildefil og den tekst, `scripts/check-threat.ts` leder efter, samt
mitigation-buffs, debuffs på bossen, cooldowns, threat-drops, taunts og evnerne på og uden for
global cooldown (`gcd`, `offGcd`, til opener'en). Til tank-simmen kommer en post i
`server/specs/tank-sim.ts` (DPS-formatet: `sim.specField`, options, APL-fil og talent-preset fra
WoWSims' `ui/specs/<klasse>/<spec>/`); APL'en kopieres med `scripts/extract-wowsims-data.mjs`. Tjek
med `scripts/tank-check.ts`, `scripts/tank-analyze.ts` og `scripts/tank-sim.ts`.
