# Installation og drift

Parse Mirror består af en lille Node-server, der henter og analyserer logs fra Warcraft Logs, og
en hjemmeside. **Sims kører i den besøgendes browser** (WoWSims bygget til WebAssembly), så
serveren næsten ikke bruger CPU og kan ligge på en gratis host.

## Sådan hænger det sammen

1. Browseren beder serveren analysere et kill. Serveren henter logs (med serverens
   Warcraft Logs-nøgle, eller den besøgendes egen, hvis de har indtastet én) og laver analysen.
2. Serveren bestemmer, hvilke sims der skal køres (what-ifs, held, kill-tid) og sender dem ét ad
   gangen til browseren.
3. Browseren henter simmen første gang (7 MB, derefter i cache), kører den i et par Web Workers
   (én pr. CPU-kerne, højst 6, eller 10 hvis browseren melder mindst 8 GB hukommelse) og sender
   resultaterne tilbage. En analyse tager 10–40 sekunder afhængigt af computeren. Workers lukkes
   et minut efter sidste sim, så hukommelsen (130–200 MB pr. worker) bliver givet tilbage.
4. Serveren samler resultaterne og viser dem.

Resultaterne er de samme som med WoWSims på kommandolinjen (samme kode, samme startværdi).

### Hvorfor er browseren langsommere end kommandolinjen?

Kommandolinje-simmen deler hver sims iterationer ud på alle CPU-kerner; WebAssembly i browseren
kører på én kerne pr. worker. Målt på en maskine med 16 kerner (samme kill, 2500 iterationer):
én sim tager 0,2 s native og 1,7 s i browseren, og en hel analyse cirka 4 s native mod 13 s i
browseren. Kører serveren på din egen maskine, kan du derfor sætte `SIM_MODE=cli` i `.env`, mens
den hostede udgave bruger browseren.

## Lokal udvikling

Kræver Node.js 22.9+. Go behøves kun, hvis simmen skal bygges om.

```bash
npm install
cp .env.example .env    # indsæt WCL_API_KEY
npm run dev
```

Åbn http://localhost:5173. `npm run dev` starter API-serveren (port 5174) og Vite (port 5173,
som proxyer `/api`).

| Kommando | Hvad den gør |
|---|---|
| `npm run typecheck` | TypeScript-tjek af server, web, tests og dev-scripts |
| `npm test` | Testene i `tests/`, også kørt af GitHub på hver ændring |
| `npm run check-threat -- <klon>` | Tjekker tank-threat-værdierne mod en WoWSims-klon |
| `npm run build` | Typecheck og produktionsbuild af hjemmesiden til `dist/` |
| `npm start` | Serveren alene; serverer også `dist/`, så side og API ligger på samme port |
| `node scripts/build-wowsims.mjs <klon>` | Bygger simmen om (se nedenfor) |

### Simmen

Den byggede sim ligger i `web/public/sim/` (`wowsim.wasm.gz` og Go's `wasm_exec.js`) og er
checket ind, så en host ikke behøver Go. I guildets repo (`nordens-paris/tools`) er færdigbyggede
filer ikke tilladt, så der ligger `wowsim.wasm.gz` i stedet under
[Releases](https://github.com/nordens-paris/tools/releases?q=parse-mirror&expanded=true): hent den
og læg den i `web/public/sim/`, eller byg den selv. Den skal kun bygges om, når WoWSims eller
vores rettelser ændres:

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.10
git clone https://github.com/wowsims/tbc-new ../tbc-new
node scripts/build-wowsims.mjs ../tbc-new              # WebAssembly + kommandolinje-sim i bin/
node scripts/build-wowsims.mjs ../tbc-new --wasm-only  # kun WebAssembly
```

Kommandolinje-simmen (`bin/wowsimcli`) bruges af dev-scripts og hvis serveren skal simme selv
(`SIM_MODE=cli`, det hurtigste lokalt: sæt også `WOWSIMS_CLI=bin/wowsimcli.exe`).

### Windows-pakken til guilden

Guildmates uden teknisk viden kører Parse Mirror lokalt med en færdig pakke: `parse-mirror-windows.zip`
under en `parse-mirror-v*`-release i `nordens-paris/tools`. Den har to filer øverst, **Start Parse
Mirror** og **Opdater Parse Mirror**, og selve værktøjet i `app/`, med `wowsim.wasm.gz` og
kommandolinje-simmen `bin/wowsimcli.exe` (sims på pc'ens egne kerner).

- `windows/start.ps1` installerer Node.js med winget, hvis det mangler, spørger efter Warcraft
  Logs-nøglen (gemmes i `app/.env` og `%APPDATA%\ParseMirror\.env`, så den overlever en
  opdatering), kører `npm ci` og `vite build`, når noget er ændret, starter serveren på port 5174
  og åbner siden.
- `windows/update.ps1` henter den nyeste pakke fra releases og skifter `app/` ud; `.env` og
  `node_modules` flyttes med.
- Byg pakken fra et committet træ med `node scripts/package-windows.mjs parse-mirror-vX.Y` (skriver
  `dist-windows/parse-mirror-windows.zip`, cirka 23 MB) og læg den på releasen som asset.

Hver ændring på `main` får et nyt tredje tal i `package.json` (`0.3.1`, `0.3.2`) og sit eget afsnit i
[CHANGELOG.md](../CHANGELOG.md), i samme commit. Pakken følger ikke med af sig selv: **Opdater Parse
Mirror** henter kun den nyeste release, så guildmates får ændringer, når der laves en release med
samme nummer (`parse-mirror-v0.3.2`). Marker versionen med **Windows-pakke** i changeloggen, og tag
release-noterne derfra.

Skrifterne er gemt som UTF-8 med BOM, ellers viser Windows PowerShell æ, ø og å forkert.

## `.env`

| Variabel | Betydning |
|---|---|
| `WCL_API_KEY` | Serverens Warcraft Logs v1-nøgle (fra profilen på fresh.warcraftlogs.com, "V1 Client Key"). Valgfri: uden den skal besøgende indtaste deres egen |
| `WCL_CONCURRENCY` | Kald til Warcraft Logs på én gang (standard 8). Hvert tager omkring 0,4 s, så det bestemmer hastigheden; minut-grænsen gælder stadig |
| `ROLES_NEED_OWN_KEY` | `true`: healer- og tank-analyser og deres paneler kører kun med den besøgendes egen nøgle, så de ikke bruger af serverens timebudget. Sat i `render.yaml`; lokalt er den fra. Det gamle navn `HEALERS_NEED_OWN_KEY` virker også |
| `SIM_MODE` | `browser` (standard) eller `cli` (WoWSims på serveren; kræver `WOWSIMS_CLI`) |
| `GAME` | Spilprofil i `server/game.ts`: `tbc-anniversary` eller `forever` (pladsholder) |
| `WCL_HOST` | Overstyrer profilens Warcraft Logs-side |
| `SIM_ITERATIONS` | Iterationer pr. sim (standard 2500) |
| `SIM_PARALLEL` | Sims side om side med `cli` (standard: kerner minus én, højst 8) |
| `VISITOR_LOOKUPS_PER_HOUR` | Opslag i timen pr. besøgende på serverens nøgle (standard 60, 0 = ingen grænse). Med egen nøgle er der ingen grænse |
| `MAX_ANALYSES` | Analyser der holdes i hukommelsen (standard 50) |
| `API_PORT` / `PORT` | Serverens port. Lokalt `API_PORT` (5174, fra `.env`); hosts som Render sætter `PORT`, som bruges når `API_PORT` ikke er sat |
| `HOST` | Hvor serveren lytter. Standard: `127.0.0.1` med `API_PORT` (en lokal installation har intet login), ellers alle netkort, som hosts kræver |
| `WCL_CACHE_MB` | Største størrelse på `.cache/wcl` i MB (standard 2048). De ældste svar slettes ved opstart |

## Hosting gratis

### Hvor?

| Host | Fordele | Ulemper |
|---|---|---|
| **[Render](https://render.com) (anbefalet til test)** | Nemmest: forbind et GitHub-repo, så bygger og starter den selv. Gratis HTTPS-adresse (`*.onrender.com`). `render.yaml` er klar | Går i dvale efter 15 minutter uden besøg; første besøg derefter tager 30–60 s. 512 MB RAM. Cachen nulstilles ved genstart |
| [Koyeb](https://www.koyeb.com) | Ligner Render | Samme slags begrænsninger; kræver lidt mere opsætning |
| Oracle Cloud "Always Free" | En rigtig Linux-maskine, altid tændt, masser af RAM | Mest opsætning (konto med kort, firewall, tjeneste, HTTPS) |

Tjek de aktuelle vilkår hos hosten, før I opretter en konto; gratis-planer ændres.

**Hastighed på Render free.** Planen har en tiendedel CPU-kerne. At pakke, parse og analysere ét
healer-kill tager cirka 0,1 s CPU på en almindelig pc og 2–3 s på Render, også når loggen allerede
ligger i cachen; to forespørgsler ad gangen deler den samme kerne. Derfor føles alt, der henter
mange logs (healer- og tank-sider med peers, raid-siderne), langsommere end lokalt, hvor cachen
desuden er fyldt. Derfor kører healer- og tank-siderne (healer- og tank-analysen, healer scorens
kills, **Show healers**/**Show tanks** og healer- og tank-rækkerne på en spillers raid-side) i
browseren på besøgendes egen nøgle; serveren afgør kun, hvilken analyse en spiller får, og bygger
tank-simmene. DPS-siderne regnes på serveren, ofte på dens egen nøgle, som ikke må ud i browseren.
Renders betalte Starter-plan (0,5 kerne) eller en altid-tændt maskine med flere kerner gør dem
hurtigere uden kodeændringer.

Til en test i guilden er Render det oplagte valg. Hvis siden bliver brugt meget, eller dvalen
generer, kan den flyttes til en altid-tændt maskine senere uden kodeændringer.

### Render, trin for trin

**1. Læg koden på GitHub.** Render bygger fra et GitHub-repo (privat er fint). Fra projektmappen:

```bash
git init
git add .
git commit -m "Parse Mirror proof of concept"
```

Opret et tomt repo på GitHub (f.eks. `parse-mirror`, privat), og følg GitHubs vejledning til at
pushe en eksisterende mappe (`git remote add origin ...` og `git push -u origin main`).
`.env`, `bin/`, `.cache/` og `dist/` er i `.gitignore`, så nøglen kommer ikke med.

**2. Opret tjenesten.**

1. Log ind på render.com med GitHub.
2. Vælg **New → Blueprint** og repoet. Render læser `render.yaml` og opretter en gratis
   web service med de rigtige build- og startkommandoer.
3. Render beder om værdien for `WCL_API_KEY`: indsæt din v1-nøgle. Den gemmes kun hos Render.
4. Tryk **Apply**. Første build tager et par minutter.

(Uden blueprint: **New → Web Service**, vælg repoet, sæt *Build Command* til
`npm ci --include=dev && npm run build`, *Start Command* til `npm start`, *Instance Type* til
Free, og tilføj miljøvariablerne `WCL_API_KEY` og `NODE_VERSION=22`.)

**3. Test.** Åbn adressen Render viser (`https://parse-mirror-xxxx.onrender.com`), klik på et af
eksemplerne og vent på at sims bliver færdige under fanen Sim.

**4. Del adressen** med guilden. Besøgende kan bruge serverens nøgle (60 opslag i timen hver) eller
indtaste deres egen under "API key".

**Opdateringer:** push til GitHub, så bygger og genstarter Render automatisk.

### Altid-tændt maskine (f.eks. Oracle Cloud)

```bash
# Ubuntu med Node.js 22.9+ og git
git clone <repo> parse-mirror && cd parse-mirror
npm ci
cp .env.example .env     # sæt WCL_API_KEY
npm run build
npm start                # side og API på port 5174
```

Kør det som tjeneste med systemd (`/etc/systemd/system/parse-mirror.service`):

```ini
[Unit]
Description=Parse Mirror
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/parse-mirror
ExecStart=/usr/bin/npm start
Restart=on-failure
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now parse-mirror
```

Sæt [Caddy](https://caddyserver.com) foran til HTTPS (`reverse_proxy 127.0.0.1:5174` i
`Caddyfile`) og åbn kun port 80/443 udadtil. Med `API_PORT` i `.env` lytter serveren kun på
maskinen selv, så den ikke kan nås uden om Caddy.

## Drift

- **Kvote:** serverens Warcraft Logs-nøgle har et timebudget (1.000 kald på nye nøgler, 3.600 på ældre). En analyse koster
  omkring 80 kald første gang, en healer- eller tank-analyse op til 100 (peers deles af alle med samme spec
  på samme boss), og en tank-analyses Sim-fane omkring 10 mere pr. tank; gentagne visninger kommer fra
  cachen. Grænsen pr. besøgende
  (`VISITOR_LOOKUPS_PER_HOUR`) beskytter budgettet: en hel raid-side tæller 5 opslag, en analyse 3.
  Uploads af tank-analyser til sims er begrænset til 30 i timen pr. besøgende. Klik ikke "Use New Limits" på Warcraft Logs;
  det sænker budgettet til 1.000.
- **Besøgendes egne nøgler** gemmes kun i deres browser, sendes kun med deres egne forespørgsler
  og gemmes eller logges aldrig på serveren.
- **Cache:** `.cache/wcl` indeholder kun offentlige logdata (gzippet, omkring 0,2 MB pr. kill for
  healer-data), holdes under `WCL_CACHE_MB` og kan slettes når som helst. Windows-opdateringen beholder den.
- **Hukommelse:** analyser holdes i hukommelsen, så sims kan genbruge dem (de seneste 50). Hvis
  serveren genstarter midt i en analyse, kører siden den automatisk igen.
- **Hemmeligheder:** `.env` må aldrig komme i git.

## Skærmbillederne i README

```bash
npm run dev                          # i én terminal
npx tsx scripts/screenshots.ts       # i en anden; kræver Chrome eller Edge
```
