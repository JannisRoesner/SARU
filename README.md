# SARU

**S**ystem zur **A**rchivierung von **R**eihen und **U**nterrichtsmaterialien

Selbst gehostetes Archiv für Unterrichtsreihen, Stunden und Materialien – mit Volltext- und Ähnlichkeitssuche, SchulPortal-Import und optionaler KI-Unterstützung.

## Funktionen

- Materialien mit Varianten, Dateianhängen, Tags und Bewertungen
- Unterrichtsstunden und Reihen mit Phasen und Materialzuordnung
- Hybride Suche (Volltext, Trigramme, optional Vektorsuche)
- Import von SchulPortal-Kursmappen
- Mehrbenutzerbetrieb mit Rollen (Administration / Nutzung)
- Einstellungen für KI, Uploads, Darstellung und Datenschutz

## Schnellstart mit Docker

```text
ghcr.io/jannisroesner/saru:latest
```

### Starten

```bash
docker run -d --name saru -p 3000:3000 \
  -e NUXT_SESSION_SECRET="$(openssl rand -hex 32)" \
  -e NUXT_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e NUXT_INITIAL_ADMIN_EMAIL="admin@schule.local" \
  -e NUXT_INITIAL_ADMIN_PASSWORD="BitteAendern!" \
  -v saru-db:/var/lib/postgresql/data \
  -v saru-data:/data \
  ghcr.io/jannisroesner/saru:latest
```

Anschließend im Browser: [http://localhost:3000](http://localhost:3000)

Das Image enthält Anwendung und PostgreSQL (inkl. pgvector). Daten liegen in den Volumes `saru-db` und `saru-data`.


### Wichtige Umgebungsvariablen

| Variable | Pflicht | Beschreibung |
| --- | --- | --- |
| `NUXT_SESSION_SECRET` | ja | Cookie-Signatur, mind. 32 Zeichen |
| `NUXT_ENCRYPTION_KEY` | ja | Verschlüsselung hinterlegter API-Schlüssel, mind. 32 Zeichen |
| `NUXT_INITIAL_ADMIN_EMAIL` | beim Erststart | Erstes Administratorkonto |
| `NUXT_INITIAL_ADMIN_PASSWORD` | beim Erststart | Startpasswort (Wechsel beim ersten Login) |
| `POSTGRES_PASSWORD` | nein | DB-Passwort im Container (Standard: `saru`) |
| `NUXT_TRUST_PROXY` | nein | `true`, wenn hinter Reverse-Proxy |
| `PORT` | nein | HTTP-Port (Standard: `3000`) |

Vollständige Liste: [`.env.example`](.env.example)

## Technik

- **Frontend / Backend:** Nuxt 4 (Vue, Nitro)
- **Datenbank:** PostgreSQL + pgvector, Drizzle ORM
- **Auth:** Sitzungen mit signierten Cookies, scrypt-Passworthashes
- **CI:** GitHub Actions baut und veröffentlicht das Docker-Image bei Push auf `main`

## Lizenz

[GNU Affero General Public License v3.0](LICENSE)
