# Hvor godt passer simmen?

Værktøjet står og falder med, at WoWSims kan regne et setup lige så godt ud, som en god spiller
spiller det. Her er hvad der er tjekket, hvad der er rettet, og hvad der stadig er kendte huller.

## Execution-spredning

"Execution med held fjernet" er rigtig DPS (held trukket fra) delt med simmen af spillerens eget
setup, skaleret så gruppens median er 100 %. Hvis simmen forklarer top 10 godt, ligger de tæt.
Målt oktober 2026:

| Spec | Kill | Spredning i top 10 |
|---|---|---|
| Shadow Priest | Rage Winterchill | 97–103 % |
| Destruction Warlock | Kaz'rogal | 92–104 % |
| Arcane Mage | Rage Winterchill | 94–107 % |
| Fury Warrior | Rage Winterchill | 92–104 % |

Det, der er tilbage, er mest ting simmen ikke kan: warriors, der står i boss-AoE for rage (to top
Rage Winterchill-warriors tog 26–35k Death & Decay-skade, cirka 250 rage/min; vises som "Rage
from damage taken" med et fund), og spillere, der slår WoWSims' standardrotation (større Executes
efter at have sparet rage op).

## Crit: ingen justering nødvendig

Rankede parses critter langt mere end simmen forudsiger (cirka +12 point for warlocks og +7 for
warriors, selv på rank 200). Det er udvælgelse: rankings viser hver spillers *bedste* kill ud af
mange, og selv rank 200 er top 1 % af ~28.000 parses. Ser man på **alle** kills fra 24 warlocks
(`scripts/crit-unbiased.ts`, 267 kills):

| Kills | Crit-forskel mod simmen (point) |
|---|---|
| Percentil 25–50 | −1,7 ± 1,1 |
| Percentil 50–75 | +0,2 ± 0,7 |
| Percentil 75–90 | +3,8 ± 0,8 |
| Percentil 90–100 | +6,1 ± 1,5 |
| Hver spillers bedste kill pr. boss | +6,6 ± 1,7 |
| Alle deres andre kills | +1,0 ± 0,5 |

Fury warriors over 261 kills: −1,0 point samlet. Almindelige kills critter som forudsagt; gode
parses er heldige. Simmens crit passer også med den papirværdi, loggens egne combatant-stats
giver. Derfor kører simmen uden crit-justering, og top-spillernes ekstra crit vises som held.
Arcane mages har det samme, bare større, fordi et kort kill har færre Arcane Blasts.

## Held (`server/sim/luck.ts`, `server/sim/procs.ts`)

Held regnes i tre dele:

1. **Direkte:** spillerens crits, miss/dodge/parry og (for spells) partial resists pr. ability mod
   det, simmen forventer for præcis det setup, omregnet til DPS og en z-score.
2. **Følgevirkninger:** simmen køres igen med crit og hit sat, så den ruller som spilleren gjorde.
   Det tæller det, rullene giver videre: rage og Flurry for warriors, egne Improved Shadow
   Bolt-procs for warlocks. I praksis lille.
3. **Procs:** trinkets, enchants og set-bonusser, der var oppe mere eller mindre end forventet,
   simmes med den forskel i uptime. Item-procs fra WoWSims-databasen, enchant- og set-procs i
   hånden. Mongoose på begge våben springes over, fordi loggen slår de to buffs sammen.

## Rettelser i WoWSims (`wowsims-patches/`)

Bygges ind af `scripts/build-wowsims.mjs`:

- **Recklessness rammer også hvide slag** i TBC; upstream gjaldt det kun special attacks (+6
  point hvid crit på et 100-sekunders kill).
- **Level-baserede partial resists:** mod en boss uden resistance sprang en kodevej 0-til-1-skaleringen
  over, så simmen resisterede 13,7 % af spells i stedet for ~18 %. Over 267 warlock-kills tog
  partial resists 5,8 % af den direkte skade i virkeligheden; den rettede sim forventer 6,0 %
  (urettet 4,5 %).

## Rettelser i hvordan loggen læses

- **Fury:** Recklessness slået til og Overpower-weaving slået fra i APL'en; alle execute-andele
  sat (ellers når simmen aldrig execute); potions og conjured items listet; Engineering sat for
  sappers. Warrior hit-cap er 8 % (WoWSims' miss mod en level 73-boss; top warriors stopper der).
- **Boss-armor** pr. boss (Hyjal/Teron/Shahraz 6200, det meste af BT 7700); Hyjals Rallying Cry
  som bonus-AP; strengere Windfury-detektion; rigtige talenter fra armory.
- **Cooldown-timing fra loggen:** Bloodlust og spec'ens `timedCooldowns` bruges, når spilleren
  brugte dem (APL'en brugte dem før ved pull). Icy Veins beholder APL'ens egne tjek, så den anden
  efter Cold Snap venter på, at den første slutter.
- **Warlock:** Fel Armor og Demonic Sacrifice logges ikke; Fel Armor antages, og Demonic Sacrifice
  er oppe hele kampen, når den er talentet (en Infernal slutter den ikke). Improved Shadow Bolt
  måles som andel af spillerens egne shadow-hits (89–93 % for top-spillere mod 80–84 % i tid),
  fordi WoWSims bruger den som chance pr. hit. Infernal-skade tælles ikke med i execution.
- **Pets** genkendes på ikon, ikke navn (en koreansk logs Infernal har et koreansk navn, hvilket
  før slog Demonic Sacrifice fra i simmen: −18 %).
- **Mage og priest:** Mage Armor, Shadowform og Inner Fire antages (selv-buffs logges ikke).
  Shadowfiend simmes, hvis spilleren castede den. Shadowguard (Troll) er ikke i simmen og tælles
  ikke med i execution.
- **Mana fra andre:** Innervate, Mana Tide og en party shadow priests Vampiric Touch (med præstens
  rigtige DPS) går ind i simmen.
- **Power Infusion** (20 % cast speed i 15 s, stakker ikke med Bloodlust) er med i simmene, så
  execution er fair. I DPS-tallene vises "DPS without Power Infusion": 1/6 af den direkte skade
  under den, minus tid hvor den overlappede Bloodlust.
- **Partial resists:** loggens `resisted` er 25/50/75 % af hittets *grundskade* (før talenter,
  debuffs og crits), så den rigtige tabte skade regnes ud fra resist-trinnet og den skade, der landede.
  Fulde miss og fulde resists er ikke markeret i fresh-logs; de tælles som casts uden hit.

## Party og totems

Se [arkitektur.md](arkitektur.md#party-og-totems). Kort: party findes fra Drums, Vampiric
Touch-mana og party-auras; totems antages kun fra shamans i partyet for mage og priest, fra hele
raidet for warlocks.

## Kendte begrænsninger

- Simmen tilkalder ikke Infernals.
- Bosser med adds eller nedetid (Council, Illidan, Reliquary, Akama) kan ikke sammenlignes rimeligt
  med en single-target-sim.
- Rigtige warriors spammer Execute under 20 %; WoWSims' APL holder Bloodthirst/Whirlwind over den.
- Selv-buffs (armor, Shadowform) og totems før pull er antaget, ikke målt.
- Nogle consumables (ukendte Well Fed-buffs, sjældne olier) er ikke koblet til simmen; de vises
  men simmes ikke.
- Rankings går kun 2.000 parses dybt, så "a step ahead" kan ikke finde grupper længere nede.
