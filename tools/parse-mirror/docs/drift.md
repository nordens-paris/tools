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
| `npm run typecheck` | TypeScript-tjek af server, web og dev-scripts |
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

## `.env`

| Variabel | Betydning |
|---|---|
| `WCL_API_KEY` | Serverens Warcraft Logs v1-nøgle (fra profilen på fresh.warcraftlogs.com, "V1 Client Key"). Valgfri: uden den skal besøgende indtaste deres egen |
| `SIM_MODE` | `browser` (standard) eller `cli` (WoWSims på serveren; kræver `WOWSIMS_CLI`) |
| `GAME` | Spilprofil i `server/game.ts`: `tbc-anniversary` eller `forever` (pladsholder) |
| `WCL_HOST` | Overstyrer profilens Warcraft Logs-side |
| `SIM_ITERATIONS` | Iterationer pr. sim (standard 2500) |
| `SIM_PARALLEL` | Sims side om side med `cli` (standard: kerner minus én, højst 8) |
| `VISITOR_LOOKUPS_PER_HOUR` | Opslag i timen pr. besøgende på serverens nøgle (standard 60, 0 = ingen grænse). Med egen nøgle er der ingen grænse |
| `MAX_ANALYSES` | Analyser der holdes i hukommelsen (standard 50) |
| `API_PORT` / `PORT` | Serverens port. Lokalt `API_PORT` (5174, fra `.env`); hosts som Render sætter `PORT`, som bruges når `API_PORT` ikke er sat |

## Hosting gratis

### Hvor?

| Host | Fordele | Ulemper |
|---|---|---|
| **[Render](https://render.com) (anbefalet til test)** | Nemmest: forbind et GitHub-repo, så bygger og starter den selv. Gratis HTTPS-adresse (`*.onrender.com`). `render.yaml` er klar | Går i dvale efter 15 minutter uden besøg; første besøg derefter tager 30–60 s. 512 MB RAM. Cachen nulstilles ved genstart |
| [Koyeb](https://www.koyeb.com) | Ligner Render | Samme slags begrænsninger; kræver lidt mere opsætning |
| Oracle Cloud "Always Free" | En rigtig Linux-maskine, altid tændt, masser af RAM | Mest opsætning (konto med kort, firewall, tjeneste, HTTPS) |

Tjek de aktuelle vilkår hos hosten, før I opretter en konto; gratis-planer ændres.

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

Sæt [Caddy](https://caddyserver.com) foran til HTTPS (`reverse_proxy localhost:5174` i
`Caddyfile`) og åbn kun port 80/443 udadtil.

## Drift

- **Kvote:** serverens Warcraft Logs-nøgle har et timebudget (3.600 point). En analyse koster
  omkring 30 kald første gang; gentagne visninger kommer fra cachen. Grænsen pr. besøgende
  (`VISITOR_LOOKUPS_PER_HOUR`) beskytter budgettet. Klik ikke "Use New Limits" på Warcraft Logs;
  det sænker budgettet til 1.000.
- **Besøgendes egne nøgler** gemmes kun i deres browser, sendes kun med deres egne forespørgsler
  og gemmes eller logges aldrig på serveren.
- **Cache:** `.cache/wcl` indeholder kun offentlige logdata og kan slettes når som helst.
- **Hukommelse:** analyser holdes i hukommelsen, så sims kan genbruge dem (de seneste 50). Hvis
  serveren genstarter midt i en analyse, kører siden den automatisk igen.
- **Hemmeligheder:** `.env` må aldrig komme i git.

## Skærmbillederne i README

```bash
npm run dev                          # i én terminal
npx tsx scripts/screenshots.ts       # i en anden; kræver Chrome eller Edge
```
