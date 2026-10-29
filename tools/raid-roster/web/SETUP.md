# NP Roster på Firebase og GitHub Pages

Værktøjet ligger på **https://nordens-paris.github.io/tools/raid-roster/**. Siden bygges af GitHub Action'en `.github/workflows/raid-roster-pages.yml`, hver gang `tools/raid-roster` ændres på `main`. Dataen ligger i Firebase-projektet `np-roster`, og officererne logger ind med Google.

## Adgang

Adgang styres i [Firebase-konsollen](https://console.firebase.google.com) → projektet `np-roster` → **Firestore Database** → **Data**.

| Samling | Dokument | Indhold |
|---|---|---|
| `teams` | holdets id, fx `holdet` | `name` (string): holdets navn |
| `access` | personens Google-mail med små bogstaver | `teams` (map): holdets id → `officer` eller `viewer` |

- **Ny officer:** **Add document** i `access`. Document ID = mailen. Tilføj feltet `teams` som **map**, og inde i det fx `holdet` (string) = `officer`. De kan logge ind med det samme.
- **Viewer:** som ovenfor med `viewer`. De kan kigge, men ikke rette.
- **Flere hold:** flere felter i samme map, fx `holdet` = `officer` og `pejsen` = `viewer`.
- **Fjern adgang:** slet feltet i mappet eller hele dokumentet.
- **Nyt hold:** **Add document** i `teams` med et id i små bogstaver og bindestreger og feltet `name`. Giv derefter nogen adgang i `access`. Holdnavnet i værktøjet sættes under **Settings → Team name**.

Holdets data ligger under `teams/<id>/` (weeks, players, settings, history, historyData, members). Reglerne i `firestore.rules` lader kun holdets egne officerer rette og kun holdets medlemmer læse. Ingen kan læse `access`, undtagen personen selv.

## Opsætning fra bunden

Allerede gjort for guilden. Beskrevet her, hvis det skal laves igen.

1. **Projekt:** [console.firebase.google.com](https://console.firebase.google.com) → **Create a project** uden Google Analytics. Bliv på den gratis Spark-plan.
2. **Login:** **Authentication → Get started → Sign-in method → Google → Enable**. Under **Settings → Authorized domains**: tilføj `nordens-paris.github.io`.
3. **Database:** **Firestore Database → Create database**, location `eur3 (europe-west)`, **production mode**.
4. **Regler:** fanen **Rules** i Firestore → indsæt `firestore.rules` → **Publish**. Gentag, når filen ændres.
5. **Konfiguration:** **Project settings → General → Your apps → Web app (`</>`)**, uden Firebase Hosting. Kopiér værdierne til `firebase-config.js` (skabelon: `firebase-config.example.js`).
6. **GitHub Pages:** repoets **Settings → Pages → Source: GitHub Actions**. Actions skal være slået til under **Settings → Actions → General**.

## Lokal test

```bash
python3 tools/raid-roster/web/build.py _site --fake
```

```bash
python3 -m http.server 8000 --directory _site
```

Åbn http://localhost:8000/raid-roster/. `--fake` bruger `fake-firebase.js`, der gemmer i browseren, i stedet for det rigtige projekt. **Sign in with Google** logger ind med en falsk konto, der er officer på holdet Demo. Uden `--fake` taler siden med det rigtige Firebase; `localhost` er godkendt til login som standard.
