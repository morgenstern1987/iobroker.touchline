# iobroker.touchline

Fertiger ioBroker-Adapter für **Roth Touchline**, mit Unterstützung für **neue API** und **Legacy API**.

Der Adapter pollt den Touchline-Controller, legt daraus möglichst viele Datenpunkte in ioBroker an und bietet optional einen lokalen Bridge-Webserver.

## Features

- Unterstützung für Touchline **neue API** und **Legacy API**
- **Auto-Detection** der API-Generation
- Konfigurierbare **lokale IP / Hostname** in der Admin-UI
- Protokollauswahl (**HTTP/HTTPS**)
- Polling in einstellbarem Intervall
- Rekursives Mapping in möglichst viele ioBroker-Datenpunkte
- Stabilere IDs bei Arrays (z. B. nach `id`, `uuid`, `name`)
- Zusätzliche API-Pfade frei konfigurierbar (Komma, Semikolon oder Zeilenumbruch)
- Optionaler Bridge-Webserver
  - `GET /health`
  - `GET /api/states`
  - `POST /api/refresh`

## Konfiguration (Admin-UI)

- `Local IP / Hostname of Touchline controller`
- `Protocol` (`HTTP`, `HTTPS`)
- `Touchline API port` (Standard: `80`, z. B. `8899`)
- `HTTP timeout (ms)`
- `Touchline API generation` (`Auto`, `New`, `Legacy`)
- `Polling interval (seconds)`
- optional `Username` / `Password` oder `Bearer token`
- `Additional API paths` (getrennt durch Komma, Semikolon oder Zeilenumbruch)
- `Enable local bridge webserver`
- `Webserver port`

## Datenpunkt-Struktur

- API-Daten unter `touchline.X.api.<apiType>...`
- Endpoint-Status unter `touchline.X.endpoints.<endpoint>.ok` und `...error`
- Adapter-Info unter `touchline.X.info.*`

## Entwicklung

```bash
npm install
npm run lint
npm run check
npm test
```

## CI

GitHub Actions führt bei Push/PR automatisch aus:

- `npm install`
- `npm run lint`
- `npm run check`

## ZIP-Paket erzeugen

```bash
npm run zip
```

Danach liegt `iobroker.touchline.zip` im Projektverzeichnis.

## Troubleshooting

Wenn `info.connection = false` und keine API-Daten unter `api.*` erscheinen:

- prüfe `info.lastError`
- setze ggf. `Touchline API generation` explizit auf `New` oder `Legacy`
- ergänze unter `Additional API paths` bekannte Endpunkte deiner Firmware (z. B. `/api/v1/weather,/api/v1/home`)
- bei `ETIMEDOUT` prüfe IP/Port (z. B. 80 vs. 8899) und Firewall im lokalen Netz

Der Adapter markiert nur dann `info.connection = true`, wenn mindestens ein Endpoint erfolgreich gelesen wurde.
