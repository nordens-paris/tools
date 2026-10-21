# NPRoster (addon)

**Version 1.0**

Raidlederens addon til [NP Roster-værktøjet](../../tools/raid-roster). Importér ugens roster, invitér, sortér grupper, giv bænken besked og registrer fremmøde.

Kun raidlederen behøver addon'et. Alle andre ser rosteret på Discord.

## Installation

Kopiér mappen `NPRoster` til `World of Warcraft\_forever_\Interface\AddOns\`.

`## Interface: 16001` er taget fra WoW Forever-betaen. Viser addon'et sig som "out of date" på live, så slå **Load out of date AddOns** til, eller ret tallet i `NPRoster.toc` til det, `/dump select(4, GetBuildInfo())` viser.

## Brug

Skriv `/nproster` (eller `/npr`).

1. **Import:** kopiér addon-strengen fra værktøjet (Share the roster), klik i feltet, Ctrl+V, **Import**.
   En ny import erstatter den forrige uge i addon'et.
2. **Raid:** vælg raid øverst. Overskriften viser dato, og hvor mange der står i deres planlagte gruppe. Hver spiller vises med klasse-ikon og navnet i klassefarve. Ikonet foran viser status: grønt flueben = på plads, gult spørgsmålstegn = forkert gruppe, grøn prik = online men ikke i raid, grå prik = offline, orange ? = ikke fundet i guilden. En bænkspiller, der har taget en no-shows plads, står med "for <navn>". Under grupperne står bænken og dem, der er i raidet uden at være på rosteret.
   - **Invite:** inviterer alle på rosteret, der er online: først fire, så gruppen kan laves om til raid, når den første siger ja, og derefter resten. Dem, der er offline, skrives i chatten.
   - **Sort groups:** flytter folk til deres planlagte grupper, én flytning ad gangen. Kræver leader eller assist og venter, hvis I er i kamp. Folk, der ikke er på rosteret, flyttes til de bagerste grupper. Afviser spillet en flytning, stopper sorteringen og siger til.
   - **Replace no-show:** inviterer den næste bænkspiller, der er online i spillet (i værktøjets rækkefølge: den der har siddet mest over først), ind på pladsen og i gruppen hos den første spiller fra rosteret, der mangler. Den manglende tæller som no-show i fremmødet.
   - **Whisper bench:** hvisker til de bænkspillere, der er online i spillet, at de skal være tilgængelige på Discord. Resten ser bænken på Discord.
   - **Start raid / End raid:** registrerer, hvem der var i raidet, og hvem der kom for sent (over 15 min). Alle på den planlagte bænk tæller som bænk, de skal ikke være online. Var en bænkspiller ikke til at få fat i på Discord, markeres det i værktøjet.
3. **Attendance:** viser, om der registreres lige nu, og de seneste raids (de 12 nyeste gemmes, de 6 nyeste vises). Vælg raidet, klik i feltet, Ctrl+A, Ctrl+C, og indsæt det under Attendance i værktøjet.

Genveje: `/npr invite`, `/npr sort`, `/npr bench`, `/npr replace`.

Navne er `Fornavn-Efternavn`. Addon'et fjerner kun et realm-navn bagerst, hvis det er jeres eget realm, og sammenligner uden store/små bogstaver. **Skal testes i spillet:** at invitation med `Fornavn-Efternavn` virker, da WoW normalt bruger bindestreg foran realm-navnet.

## Hvad addon'et gør i spillet

Alt sker kun, når du selv trykker på en knap: invitationer, gruppeflytninger og whispers til bænken. Intet kører af sig selv, og der sendes intet over nettet. Fremmøde og rosteret gemmes i `SavedVariables\NPRoster.lua` på din egen PC.

## Vedligeholdes af

Darkfade
