# Nordens Paris – tools & addons

Fælles samling af værktøjer og addons, som folk i guilden **Nordens Paris** har lavet (ofte vibecodet med AI). Alt her er gratis, open source og til hele guilden, på tværs af raidhold.

> Ikke tilknyttet Blizzard Entertainment. Brug alt her på eget ansvar.

## Indhold

| Projekt | Hvad det gør | Platform |
|---|---|---|
| [WoW Queue Watcher](tools/wow-queue-watcher) | Overvåger login-køen og sender alarmer til din telefon | Windows, Python |
| [UI-overførsel](tools/wow-ui-transfer) | Flytter addons, keybinds, macros, Edit Mode og chat fra Beta til din nye character på launch | Windows, PowerShell |
| [Darkfade's Forever Warrior](addons/darkfade-forever-warrior) | Komplet WeakAura-UI til Warrior: cooldowns, procs, swing og Rage, Battle Shout-påmindelser og tank-announces | WeakAura (ForeverAuras) |

## Sådan hentes et værktøj

- **Færdige versioner** (zip, exe) ligger under [Releases](https://github.com/nordens-paris/tools/releases).
- **Kildekoden** ligger i mappen for hvert projekt. Tryk **Code → Download ZIP** for at hente hele repoet.

Kør kun ting, du har hentet herfra eller fra en Release, ikke filer sendt rundt i Discord.

## Struktur

```
tools/     Programmer og scripts, der kører uden for spillet
addons/    WoW-addons (Interface\AddOns) og WeakAura-packs (import-strenge)
```

Hvert projekt har sin egen mappe med en `README.md`, der forklarer, hvad det gør, hvordan man installerer det, og hvem der vedligeholder det.

## Fejl, idéer og spørgsmål

- **Noget virker ikke, eller har du en idé?** Opret et [issue](https://github.com/nordens-paris/tools/issues/new/choose).
- **Spørgsmål og snak** hører til i [Discussions](https://github.com/nordens-paris/tools/discussions).

## Vil du bidrage?

Send dit GitHub-brugernavn til Darkfade på Discord, så bliver du inviteret. Læs derefter [CONTRIBUTING.md](CONTRIBUTING.md).

Kort sagt: én mappe pr. projekt, ingen personlige data eller hemmeligheder, og alt kommer ind via en pull request, som en code owner skal godkende. Kun owners udgiver releases.

## Licens

[MIT](LICENSE), medmindre et projekts egen mappe siger andet.
