# Nordens Paris – tools & addons

Fælles samling af værktøjer og addons, som folk i guilden **Nordens Paris** har lavet (ofte vibecodet med AI). Alt her er gratis, open source og til hele guilden, på tværs af raidhold.

> Ikke tilknyttet Blizzard Entertainment. Brug alt her på eget ansvar.

## Indhold

| Projekt | Hvad det gør | Platform |
|---|---|---|
| [WoW Queue Watcher](tools/wow-queue-watcher) | Overvåger login-køen og sender alarmer til din telefon | Windows, Python |
| [UI-overførsel](tools/wow-ui-transfer) | Flytter addons, keybinds, macros, Edit Mode og chat fra Beta til din nye character på launch | Windows, PowerShell |

## Sådan hentes et værktøj

- **Færdige versioner** (zip, exe) ligger under [Releases](../../releases).
- **Kildekoden** ligger i mappen for hvert projekt. Tryk **Code → Download ZIP** for at hente hele repoet.

Kør kun ting, du har hentet herfra eller fra en Release, ikke filer sendt rundt i Discord.

## Struktur

```
tools/     Programmer og scripts, der kører uden for spillet
addons/    WoW-addons (Lua), der lægges i Interface\AddOns   (tom endnu)
```

Hvert projekt har sin egen mappe med en `README.md`, der forklarer, hvad det gør, hvordan man installerer det, og hvem der vedligeholder det.

## Vil du bidrage?

Læs [CONTRIBUTING.md](CONTRIBUTING.md). Kort sagt: én mappe pr. projekt, ingen personlige data eller hemmeligheder, og en anden fra guilden kigger på ændringen, før den kommer ind.

## Licens

[MIT](LICENSE), medmindre et projekts egen mappe siger andet.
