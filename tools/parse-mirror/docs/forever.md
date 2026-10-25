# Fra TBC Anniversary til WoW Forever

Parse Mirror er bygget på TBC Anniversary, fordi det er der, der findes logs og en sim i dag.
Målet er WoW Forever. Denne side samler, hvad der skal til for at flytte det, så arbejdet kan
gøres hurtigt, når Forever er ude, og dets sim kan hentes.

## Hvad der allerede er forberedt

- **`server/game.ts`** samler alt versionsafhængigt i en profil: Warcraft Logs-side,
  encounter-ID-offset, Wowhead-sti, armory-"flavor" og boss-tabellen (level, armor, creature type
  pr. boss). `GAME=forever` i `.env` vælger profilen, som i dag er en kopi af TBC-profilen.
- **Specs er data**, ikke kode spredt rundt: alt spec-specifikt ligger i `server/specs/`.
- **WoWSims bygges fra kilde** med vores rettelser (`scripts/build-wowsims.mjs`), og dens data
  hentes med `npm run extract-wowsims`. Begge peger bare på en klon.
- **UI'et** får sine links (Warcraft Logs-side, Wowhead) fra `/api/config`.

## Tjekliste

### 1. Warcraft Logs

- [ ] Hvilken side logger Forever på, og har den stadig **v1-API'et**? Klienten (`server/wcl/`)
      bruger v1. Hvis der kun er v2 (GraphQL), skal klienten skrives om; resten af koden bruger kun
      klientens metoder.
- [ ] Sæt `wclHost` og `encounterIdOffset` i `forever`-profilen. Tjek et par encounter-ID'er og
      zone-ID'et for den første raid.
- [ ] Tjek klasse- og spec-ID'erne til rankings (`wcl.classId`/`specId` i hver spec).
- [ ] Tjek at loggene stadig ikke viser totems og selv-buffs (så antagelserne stadig gælder), og
      at Drums/Vampiric Touch stadig kan bruges til at finde party.

### 2. Sim

- [ ] Find den WoWSims-version (eller fork), der simmer Forever, og tjek at den stadig har
      `sim/wasm` med `raidSimJson`. Peg `build-wowsims.mjs` på den; den bygger både WebAssembly-
      udgaven til browseren og kommandolinjeværktøjet.
- [ ] Prøv vores to rettelser (`wowsims-patches/`) mod den; ret eller drop dem, hvis den allerede
      gør det rigtigt.
- [ ] `npm run extract-wowsims -- <klon>`: items, enchants, gems, talenttræer, procs og APL'er.
      Tjek at stierne til APL'erne i `scripts/extract-wowsims-data.mjs` stadig findes.
- [ ] Tjek proto-felterne (`specField`, options, buff-navne i `server/sim/environment.ts`).

### 3. Spil-tal, der er hårdkodet til level 70 / TBC

| Hvor | Hvad |
|---|---|
| `server/game.ts` | Boss-level, armor og creature type pr. encounter |
| `server/sim/scenarios.ts` (`ROLL_STATS`) | Rating pr. 1 % crit/hit og WoWSims' stat-indekser |
| `server/specs/*.ts` (`hit`) | Rating pr. 1 % hit og hit-cap mod en raid-boss |
| `server/analysis/collect.ts` | Rage fra modtaget skade (2,5 rage pr. 274,7 skade på level 70); totem-stave-ID'er; Drums/Vampiric Touch-ID'er |
| `server/data/consumes.ts` | Potions, drums, scrolls, olier og engineering-items efter stave-/item-ID |
| `server/sim/environment.ts` | Buffs WoWSims ikke kender (`STAT_BUFFS`) og buff-regler |
| `server/sim/procs.ts` | Enchant- og set-procs, der er skrevet i hånden |
| `server/specs/*.ts` | `timedCooldowns`-ID'er, talentpresets, cooldown-længder |

### 4. Specs

- [ ] For hver spec: kør `scripts/log-probe.ts` på et Forever-kill og ret navne, ID'er og
      cooldowns (se [ny-spec.md](ny-spec.md)).
- [ ] Kør `scripts/full-run.ts` mod top 10 og tjek execution-spredningen
      (se [sim-noejagtighed.md](sim-noejagtighed.md)).
- [ ] Gentag crit-tjekket med `scripts/crit-unbiased.ts`, når der er nok kills.

### 5. Hosting

Hosting skal være gratis. Muligheder:

- **Sims kører allerede i browseren** (WoWSims som WebAssembly), så serveren kun henter logs og
  kan ligge gratis (se [drift.md](drift.md)). For Forever skal simmen bare bygges fra den rigtige
  WoWSims-version med `scripts/build-wowsims.mjs`.
- Warcraft Logs-kald caches; besøgende kan bruge deres egen nøgle, så serverens timebudget holder.

### 6. Udgivelse i guildens repo

Ikke gjort endnu. Når det sker: værktøjet lægges i `tools/` i guildens GitHub-repo via en pull
request, der godkendes af code owner, og committes med guild-identiteten (aldrig rigtige navne
eller e-mails). `.env`, `bin/`, `.cache/` og `dist/` er i `.gitignore`.
