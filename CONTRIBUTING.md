# Sådan bidrager du

Alle i Nordens Paris er velkomne til at lægge værktøjer og addons her, også hvis du har vibecodet dem med AI. Andre i guilden kommer til at køre din kode på deres egen PC, så følg reglerne herunder.

## Kom med

1. Opret en gratis konto på [github.com](https://github.com).
2. Send dit GitHub-brugernavn til Darkfade på Discord.
3. Accepter invitationen til organisationen `nordens-paris`, som kommer på mail og på github.com.

## Læg noget op (ingen git-erfaring nødvendig)

1. Åbn repoet og gå ind i `addons` (WoW-addons) eller `tools` (programmer og scripts).
2. Tryk **Add file → Upload files** og træk din mappe ind. Så får dine filer stien `addons/<navn>/...` eller `tools/<navn>/...`.
3. Nederst: vælg **Create a new branch for this commit and start a pull request** → **Propose changes** → **Create pull request**.
4. Vent på review. Kommer der kommentarer, så ret filerne på samme måde, og pull requesten bliver opdateret.

Bruger du git eller Claude Code lokalt, så lav en branch, push den og åbn en pull request. Processen er den samme.

## Review og godkendelse

- Alt kommer ind gennem en pull request. Ingen kan skrive direkte på `main`.
- En **code owner** (se [.github/CODEOWNERS](.github/CODEOWNERS)) skal godkende, før noget kan merges. Andre må gerne kigge med og kommentere, men deres godkendelse er ikke nok.
- Pusher du nye ændringer efter godkendelsen, skal de godkendes igen.
- Alle kommentarer i pull requesten skal være løst, før den kan merges.

Når du reviewer: læs koden, før du godkender, især `.bat`- og `.ps1`-filer og alt der henter noget fra nettet. Forstår du ikke, hvad noget gør, så spørg.

## Nyt projekt

Lav en mappe: `tools/<navn>` for programmer og scripts, `addons/<navn>` for WoW-addons. Brug små bogstaver og bindestreger, fx `tools/raid-roster-export`. Læg en `README.md` i mappen med:
- hvad det gør (et par linjer)
- hvordan man installerer og bruger det
- om det klikker, skriver filer eller sender noget over nettet
- hvem der vedligeholder det (dit Discord- eller karakternavn)

## Regler

**Ingen personlige data eller hemmeligheder.** Tjek før du uploader:
- API-nøgler, tokens, adgangskoder, webhook-URL'er, ntfy-emner
- kontonavne, e-mails, Battle.net-tags
- stier med dit brugernavn, fx `C:\Users\<navn>\...`
- `WTF`-mapper, `SavedVariables`, logfiler og skærmbilleder

Ligger noget af det i en config-fil, så upload en `config.example.toml` med tomme værdier, og læg den rigtige fil i `.gitignore`. Har du ved et uheld uploadet en hemmelighed, så skift den med det samme. At slette den fra GitHub er ikke nok.

**Ingen færdigbyggede programmer i repoet.** `.exe`, `.zip` og lignende hører ikke til i koden. Skal dit værktøj have en færdig download, så skriv det i pull requesten. En owner bygger den og udgiver den under [Releases](https://github.com/nordens-paris/tools/releases). Kun owners kan oprette releases.

**Automatisering skal være slået fra som standard.** Blizzards regler tillader ikke automatisering. Alt, der klikker eller trykker på taster i spillet eller i Battle.net, skal være slået fra, indtil brugeren selv slår det til, og README'en skal sige det tydeligt. Ingen bots, og intet der kører under gameplay.

**Alt samles her.** Opret ikke dine egne repos i organisationen. Læg dit projekt i en mappe i dette repo.

## Licens

Når du bidrager, accepterer du, at dit bidrag udgives under repoets [MIT-licens](LICENSE).
