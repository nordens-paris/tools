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

Med `scripts/validate-spec.ts` (8 top-spillere pr. boss, execution efter held, ikke skaleret til
medianen; median og den midterste halvdel), oktober 2026:

| Spec | Kills | Median | Midterste halvdel |
|---|---|---|---|
| Fury Warrior | Kaz'rogal, Archimonde | 99,4 % | 97–103 % |
| Arms Warrior | Kaz'rogal, Archimonde | 101,0 % | 98–105 % |
| Destruction Warlock | Kaz'rogal | 98,5 % | 98–100 % |
| Affliction Warlock | Kaz'rogal, Archimonde | 97,8 % | 96–100 % |
| Arcane Mage | Kaz'rogal | 101,4 % | 101–102 % |
| Shadow Priest | Kaz'rogal | 101,1 % | 101–102 % |
| Elemental Shaman | Kaz'rogal, Archimonde | 101,6 % | 95–106 % |
| Balance Druid | Kaz'rogal, Archimonde | 94,8 % | 93–98 % |
| Combat Rogue | Kaz'rogal, Archimonde | 104,7 % | 100–105 % |
| Feral Druid | Kaz'rogal, Archimonde | 91,2 % | 90–94 % |
| Retribution Paladin | Kaz'rogal, Archimonde | 106,4 % | 103–110 % |
| Enhancement Shaman | Kaz'rogal, Archimonde | 107,5 % | 105–109 % |
| Beast Mastery Hunter | Kaz'rogal, Archimonde | 95,7 % | 93–100 % |
| Survival Hunter | Kaz'rogal, Archimonde | 87,0 % | 86–89 % |
| Marksmanship Hunter | Kaz'rogal, Archimonde | 83,2 % | 73–85 % |

Warriors lå 5–6 % over 100 %, til Windfury Totem-rettelsen nedenfor. `validate-spec` trækker kun
det direkte held fra (ikke trinket-procs), så proc-tunge melee-specs ligger en smule højt.
Retribution og Enhancement ligger 6–8 % over. Bossens armor og armor-debuffs passer (se "Armor"
nedenfor), og et hvidt slag før armor er det samme i loggen og simmen (attack power, våbenskade og
talenter). Top-paladins critter 52,3 % med hvide slag mod simmens 44,3 % (1.108 slag på fire
Hyjal-bosser, `scripts/swing-table.ts`), men det er udvælgelse som for warlocks (se "Crit"
nedenfor): over alle 276 kills fra 24 Retribution-paladins længere nede i rankings er forskellen
+1,0 ± 0,3 point, og de rankede top-kills er heldige; held-analysen trækker det fra. Det, der er
tilbage for **Retribution** efter held, er mest, at top-paladins twister oftere end WoWSims' APL
(11–14 seal-skift pr. minut mod 9–10). For **Enhancement** er udfaldene af
de hvide slag præcis som i simmen; forskellen er cirka 4 % mere attack power i loggen, når
cooldowns er nede, ikke forklaret endnu. Forskellen er ens for alle af specen, så den forsvinder
i sammenligningen med top 10. Hunterne faldt 1–4 point med reaktionstiden på 100 ms (se "Reaktionstid"
nedenfor): hunter-APL'en giver cirka 2 % mere DPS med den reaktionstid, den er skrevet til. Marksmanship er sjælden og svag i Anniversary: dens "top 10" er almindelige spillere
(2,1–3,6k DPS mod 4,3–5k for Beast Mastery), som ikke når en perfekt sim. Survival-simmen melee-weaver
mere end de rigtige (Raptor Strike 8,4 mod 5,8 pr. minut), så den ligger lidt over dem.
Elementals spreder mere, mest på held (Lightning Bolt critter op til 76 % på et kort kill) og
Fire Elemental (se nedenfor). Balance-druiders Starfire og Moonfire rammer 7–9 % hårdere i loggen
end i WoWSims for alle (ikke forklaret endnu; Curse of the Elements på arcane og Moonfury er med),
men de caster færre Starfires end simmen, så de ender lidt under 100 %.

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

Fury warriors over 261 kills: −1,0 point samlet. Retribution-paladins over 276 kills: +1,0 ± 0,3
point samlet (+4,1 for percentil 90–100, +8 for rankede top-kills). Almindelige kills critter som forudsagt; gode
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

## Armor

Warcraft Logs giver hvert fysisk slag skade før armor (`unmitigatedAmount`) og hvad armor tog
(`mitigated`), så bossens armor kan måles slag for slag (`scripts/armor-check.ts`,
`scripts/armor-timeline.ts`). På Kaz'rogal viser første slag før debuffs 6.182 (tabellen siger
6.200); Curse of Recklessness tager 800, Faerie Fire 610 og hver Sunder Armor 520, præcis som i
simmen. Blood Frenzy (+4 % fysisk skade, lagt på efter armor) ser ud som cirka 500 armor mindre i
de tal; regnes den med, passer bossens armor med Improved Expose Armor (1.715) og med fem Sunders
(2.190) inden for ~30. Spillere med armor penetration (Warp-Spring Coil, 1.000 i 15 s) ser lavere
armor, og det simmer WoWSims selv.

Det, der ikke passede, var tidspunktet: WoWSims sætter raidets Expose Armor på efter 10 s, mens
raids sunder fra pull, til den kommer. Når loggen har Expose Armor og der også blev sundret, får
simmen begge: Sunder bygger op over de første 6 s, og Expose Armor, den stærkeste, tager over ved
10 s. Det er værd 1–2 % for melee på et 70-sekunders kill.

## Reaktionstid

Requests sætter `reactionTimeMs: 100`, WoWSims-sidens standard. Uden den bruger WoWSims 10 ms, og
en rogue, der venter på energi, eller en hunter, der venter på Auto Shot, kører hele rotationen
igennem hvert 10. ms: rogue-sims tog 5 gange og hunter-sims 2,7 gange længere i browseren (14 og
11 ms pr. iteration mod 0,7 for en warlock). Casters og warriors får samme DPS; hunters cirka 2 %
mere, rogues det samme.

## Rettelser i WoWSims (`wowsims-patches/`)

Bygges ind af `scripts/build-wowsims.mjs`:

- **Recklessness rammer også hvide slag** i TBC; upstream gjaldt det kun special attacks (+6
  point hvid crit på et 100-sekunders kill).
- **Windfury Totem procer på 32 % af slagene**, ikke 20 %: over 16 top-Retribution-kills fik
  tohåndsslag et ekstra angreb (samme millisekund) på 133 af 419 slag. Med 20 % simmede top
  warriors 4–6 % og Retribution 9 % under deres rigtige DPS; med 32 % ligger Fury og Arms på 100–101 %.
  Gælder både raidets Windfury Totem og en Enhancement-shamans egen.
- **Level-baserede partial resists:** mod en boss uden resistance sprang en kodevej 0-til-1-skaleringen
  over, så simmen resisterede 13,7 % af spells i stedet for ~18 %. Over 267 warlock-kills tog
  partial resists 5,8 % af den direkte skade i virkeligheden; den rettede sim forventer 6,0 %
  (urettet 4,5 %).

## Rettelser i hvordan loggen læses

- **Fury:** Recklessness slået til og Overpower-weaving slået fra i APL'en; alle execute-andele
  sat (ellers når simmen aldrig execute); potions og conjured items listet; Engineering sat for
  sappers. Warrior hit-cap er 8 % (WoWSims' miss mod en level 73-boss; top warriors stopper der).
- **Arms:** top-spillerne i Anniversary kører dual-wield sværd med 33/28/0 ("Kebab"): Heroic
  Strike-spam, Mortal Strike, Whirlwind og Hamstring, ingen Slam eller Overpower. WoWSims' Arms-APL
  har en dual-wield- og en tohånds-gren, som den vælger efter Slams cast-tid; her vælger våbnene
  (en tohåndsspiller uden Improved Slam fik ellers dual-wield-rotationen og slog aldrig Slam).
  Recklessness og Overpower som for Fury. Blood Frenzy kommer fra spillerens egne Mortal Strikes i
  simmen, ikke fra raidet.
- **Affliction:** de fleste top-"Affliction"-warlocks kører 40/0/21 Shadow Bolt med Corruption, en
  curse og en pet ude, ofte uden Siphon Life og aldrig Immolate eller Unstable Affliction.
  WoWSims' Affliction-APL holder alle DoTs oppe, så DoTs spilleren ikke brugte, slås fra
  (`sim.onlyIfCast`). Dæmonen er den, spilleren havde ude.
- **Retribution:** WoWSims' APL twister Seal of Command og Seal of Blood som top-spillerne;
  Exorcism og Consecration simmes kun, hvis spilleren brugte dem. Seal of Command logger sine
  procs som casts, så kun selve seal'en tæller (`castIds`). Seal of the Martyr (Alliancens Seal of
  Blood) læses som Seal of Blood i held. Judgement of the Crusader bliver i raid-miljøet, som
  loggen havde den: mange holder den oppe selv, mens simmen kun dømmer den før pull. Egen Sanctity
  Aura sætter simmen selv.
- **Enhancement:** simmen twister selv Windfury og Grace of Air og sætter Strength of Earth og Mana
  Spring, så de totems holdes ude af miljøet. "Windfury Attack" er også navnet på Windfury Weapons
  procs, så den kan ikke vise en party-Windfury Totem for en Enhancement. Imbues tages fra våbnene
  (Windfury Weapon, når loggen ikke viser noget). Stormstrike logger en cast pr. våben-slag, så kun
  17364 tæller. APL'en kaster Fire Elemental fra en gruppe (totem-twist), så tidsætningen fra loggen
  lægges på gruppens reference; før simmede den en Fire Elemental for spillere, der ikke brugte en.
- **Combat:** egen Expose Armor simmes kun, hvis spilleren brugte den (APL'en gør det ellers, når
  Improved Expose Armor er talentet). Adrenaline Rush og Blade Flurry tidsættes fra loggen; APL'en
  brugte Adrenaline Rush før pull. Gifte kommer fra våbnene; med Windfury Totem på main hand er der
  ingen gift der, som i spillet.
- **Feral:** WoWSims' cat-APL powershifter og caster kun Mangle og Faerie Fire, når bossen ikke har
  dem, så spillerens egne holdes ude af miljøet. Leader of the Pack sætter simmens druid selv.
- **Hunter:** WoWSims har én hunter-spec; Warcraft Logs ranker Beast Mastery, Marksmanship og
  Survival hver for sig, så de er tre moduler med samme base. Melee-weaving, Multi-Shot og Arcane
  Shot simmes kun, hvis spilleren brugte dem; Bestial Wrath og Rapid Fire tidsættes fra loggen
  (APL'en brugte dem ved 5 s). Pettens familie kommer fra dens abilities (Gore → Ravager), og dens
  uptime fra hvor længe den slog (første til sidste slag, minus pauser på 8 s eller mere; ét kald
  mere pr. spiller). Loggen viser hverken pile eller quiver: top-hunteres Auto Shot ramte 6 %
  hårdere end med WoWSims' Warden's Arrow (Steady Shot, der ikke bruger pile, kun 2 %), så den
  bedste pil før Sunwell, Mysterious Arrow, antages, plus et 15 %-quiver. Survivals egen Expose
  Weakness tages ud af miljøet; simmen lægger den selv. WoWSims har ingen Marksmanship-build, så
  presets er top-spilleres builds fra armory. Snake Traps slanger og trinket-væsner (Netherwing
  Ally) holdes uden for sammenligningen med spillerens pet: Warcraft Logs lægger en hunters og
  slangernes Melee i én post delt pr. aktør, som nu skilles ad.
- **Dual wield og hit:** for Fury, Combat og Enhancement tæller hit over 8 % stadig for de hvide
  slag, så "over hit-cap" først vises over 27 %.
- **Elemental:** WoWSims' Elemental-APL sætter selv shamanens totems før pull (Totem of Wrath,
  Wrath of Air, Mana Spring, Strength of Earth), og dens egen Totem of Wrath stakker med en
  raid-buff-Totem of Wrath i WoWSims (+6 % crit og hit). Derfor holdes totems helt ude af
  raid-miljøet for Elementals (`sim.excludeBuffs`). Fire og Earth Elemental bruger WoWSims som
  cooldowns ved pull uanset APL'en, så de tidsættes fra loggen (ved pull, hvis elementalen allerede
  var ude), ellers aldrig; uden det fik spillere uden Fire Elemental ~500 DPS for meget i simmen.
  Simmens Fire Elemental slår hele tiden (cirka 350 mod 190 DPS melee hos top-spillere, samme
  skade pr. slag), hvilket er ens for alle, der bruger den. En shamans egen Bloodlust er en
  cooldown for sig i WoWSims, som ellers bruges ved pull; den tidsættes også fra loggen. Hit:
  Elemental Precision 2 % pr. point, Nature's Guidance 1 % og egen Totem of Wrath 3 %.
- **Balance:** Faerie Fire, Insect Swarm, Force of Nature og Innervate på sig selv simmes kun,
  hvis spilleren brugte dem; egen Faerie Fire og Innervate tages ud af raid-miljøet. Moonkin Aura
  findes kun som party-buff i WoWSims, så druidens egen bliver i miljøet. Balance of Power giver
  2 % hit pr. point; Improved Faerie Fire hjælper kun fysisk hit.
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
