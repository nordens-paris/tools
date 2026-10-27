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
melee), og tilføj den i `server/specs/index.ts` og `SUPPORTED` i `web/src/brand.ts`.

| Felt | Betydning |
|---|---|
| `wcl.classId` / `wcl.specId` | Warcraft Logs' ID'er til rankings (Mage 4, Priest 7, Warlock 10, Warrior 11; spec 1–3 i træ-rækkefølge) |
| `caster` | Cast-tid tæller som aktiv tid; huller mellem casts er vigtige; spell-hit og partial resists |
| `trackedCasts` | Abilities hvis casts pr. minut sammenlignes (`higherIsBetter`: `true`, `false` eller `null`) |
| `efficiency` | Kerne-abilities med cooldown: casts mod max mulige (`delaySec` hvis skaden først lander senere, som Curse of Doom) |
| `hit` | Combatant-stat, rating pr. 1 %, cap mod en raid-boss, talenter der giver hit |
| `gcdAbilities` / `channels` | Instants på GCD'en og channels (længde i sekunder) til aktiv tid |
| `cooldowns` / `finishers` | Cooldowns hvis timing sammenlignes; finishers (Shadowburn) bedømmes ikke på timing |
| `castLabels` | Pænere navne ("Restore Mana" → "Super Mana Potion") |
| `uptimes` / `debuffUptimes` | Buffs på spilleren og egne debuffs på bossen, hvis uptime sammenlignes |
| `totems` | `'party'` eller `'raid'`, se [arkitektur.md](arkitektur.md#party-og-totems) |
| `talentPresets` | WoWSims-talenter, når armory ikke har spilleren (vælges på nærmeste træfordeling) |
| `sim.specField` / `sim.specOptions` | WoWSims-spec-feltet og dets options (armor, pet osv.) |
| `sim.aplFile` | Rotationen i `data/wowsims/` (kan afhænge af hvad spilleren castede) |
| `sim.timedCooldowns` | Cooldowns simmen skal bruge, når spilleren gjorde (`keepCondition` beholder APL'ens egne tjek) |
| `sim.unmodeledDamage` | Skade simmen ikke kan lave (Infernal, Shadowguard); trækkes fra i execution |
| `sim.knockOn` | Hvad crits giver videre, til held-panelets tekst |
| `sim.notes` | Antagelser, der vises under "How the sim was set up" |

## 4. Tjek mod top 10

```bash
npx tsx --env-file=.env scripts/full-run.ts <rapport> <fight> <source>
npx tsx --env-file=.env scripts/exec-breakdown.ts <rapport> <fight> <source> 1000
```

`full-run` viser fund, what-ifs og execution for top 10. `exec-breakdown` viser pr. ability, hvor
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
