# Sådan bidrager du

Alle i Nordens Paris er velkomne til at lægge værktøjer og addons her, også hvis du har vibecodet dem med AI. Andre i guilden kommer til at køre din kode på deres egen PC, så følg reglerne herunder.

## Nyt projekt

1. Lav en mappe: `tools/<navn>` for programmer og scripts, `addons/<navn>` for WoW-addons. Brug små bogstaver og bindestreger, fx `tools/raid-roster-export`.
2. Læg en `README.md` i mappen med:
   - hvad det gør (et par linjer)
   - hvordan man installerer og bruger det
   - om det klikker, skriver filer eller sender noget over nettet
   - hvem der vedligeholder det (dit Discord- eller karakternavn)
3. Åbn en pull request.

## Regler

**Ingen personlige data eller hemmeligheder.** Tjek før du committer:
- API-nøgler, tokens, adgangskoder, webhook-URL'er, ntfy-emner
- kontonavne, e-mails, Battle.net-tags
- stier med dit brugernavn, fx `C:\Users\<navn>\...`
- `WTF`-mapper, `SavedVariables`, logfiler og skærmbilleder

Ligger noget af det i en config-fil, så commit en `config.example.toml` med tomme værdier, og læg den rigtige fil i `.gitignore`. Har du ved et uheld pushet en hemmelighed, så skift den med det samme. At slette den fra GitHub er ikke nok.

**Ingen færdigbyggede programmer i repoet.** `.exe`, `.zip` og lignende lægges på en [GitHub Release](../../releases), ikke i selve koden.

**Automatisering skal være slået fra som standard.** Blizzards regler tillader ikke automatisering. Alt, der klikker eller trykker på taster i spillet eller i Battle.net, skal være slået fra, indtil brugeren selv slår det til, og README'en skal sige det tydeligt. Ingen bots, og intet der kører under gameplay.

**Review før merge.** Alle ændringer går gennem en pull request, og mindst én anden fra guilden skal godkende den. Læs koden, før du godkender, især `.bat`- og `.ps1`-filer og alt der henter noget fra nettet. Forstår du ikke, hvad noget gør, så spørg.

## Licens

Når du bidrager, accepterer du, at dit bidrag udgives under repoets [MIT-licens](LICENSE).
