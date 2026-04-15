# ioBroker.touchline

**ioBroker Adapter für Roth Touchline Fußbodenheizungssteuerungen (Legacy CGI-API)**

Der Adapter kommuniziert vollständig **lokal** über die eingebettete HTTP-Schnittstelle des Controllers – keine Cloud, kein Konto, keine Internetverbindung erforderlich.

---

## Unterstützte Hardware

| Gerät | Kompatibel |
|---|---|
| Roth Touchline (Legacy Controller) | ✅ |
| Roth Touchline+ | ✅ |
| Roth EnergyLogic Touchline/Wireless | ✅ |
| Roth Touchline SL / SL+ | ❌ (andere API) |

> Der Adapter nutzt ausschließlich die **alte CGI-API** (`ILRReadValues.cgi` / `writeVal.cgi`). Die neue Touchline SL-Generation verwendet eine vollständig andere Cloud-basierte API und wird von diesem Adapter nicht unterstützt.

---

## Features

- Automatische Raumerkennung beim Start
- Lesen der **Ist-Temperatur** pro Zone
- Lesen und **Setzen der Soll-Temperatur** pro Zone
- Anzeige von **Betriebsmodus** (Auto / Komfort / Absenken / Frostschutz)
- Anzeige des **Wochenprogramms**
- Anzeige von **Min- / Max-Temperatur** und **Schrittweite** (direkt vom Controller)
- **Online-Status** pro Zone
- Verbindungs-Indikator (`info.connection`)
- Alle Zonen in **einem einzigen HTTP-Request** pro Poll-Zyklus (schont den eingebetteten Controller-Webserver)

---

## Installation

Den Adapter über das ioBroker Admin-Interface installieren (GitHub-URL oder npm, sobald veröffentlicht).

Alternativ manuell:

```bash
cd /opt/iobroker
npm install iobroker.touchline
iobroker add touchline
```

---

## Konfiguration

Nach der Installation die Adapterinstanz öffnen. Es gibt zwei Einstellungen:

| Einstellung | Beschreibung | Standard |
|---|---|---|
| **Controller IP-Adresse** | Lokale IP des Roth Touchline Controllers, z.B. `192.168.1.100` | – |
| **Abfrageintervall (Sekunden)** | Wie oft Daten vom Controller gelesen werden | `60` |

### Hinweise zum Polling-Intervall

Der Controller läuft auf einem sehr schwachen eingebetteten Webserver (Keil EWEB/2.1). Zu kurze Intervalle können dazu führen, dass der Controller einfriert oder neu startet.

| Intervall | Bewertung |
|---|---|
| < 30 s | ⚠️ Nicht empfohlen – Risiko von Controller-Abstürzen |
| 30 – 60 s | ✅ Gut – ausreichend für Heizungssteuerung |
| 60 – 120 s | ✅ Optimal – schonend für den Controller |
| > 120 s | ✅ Unproblematisch, aber träge |

Minimum: **30 Sekunden** (im Adapter fest begrenzt).

---

## Datenpunkte

Für jede erkannte Zone wird unter `touchline.0.zones.zoneN` ein Channel angelegt:

| Datenpunkt | Typ | Schreibbar | Beschreibung |
|---|---|---|---|
| `currentTemperature` | `number` (°C) | Nein | Aktuelle Raumtemperatur |
| `targetTemperature` | `number` (°C) | **Ja** | Soll-Temperatur (setzt direkt am Controller) |
| `mode` | `number` | Nein | Betriebsmodus: 0=Auto, 1=Komfort, 2=Absenken, 3=Frostschutz |
| `weekProgram` | `number` | Nein | Aktives Wochenprogramm |
| `minTemp` | `number` (°C) | Nein | Minimale Soll-Temperatur (vom Controller) |
| `maxTemp` | `number` (°C) | Nein | Maximale Soll-Temperatur (vom Controller) |
| `step` | `number` (°C) | Nein | Temperatur-Schrittweite (vom Controller) |
| `available` | `boolean` | Nein | Zone online/erreichbar |

Außerdem:

| Datenpunkt | Beschreibung |
|---|---|
| `info.connection` | `true` wenn der letzte Poll erfolgreich war |

---

## Technische Details

### API-Kommunikation

Alle Lesevorgänge laufen über einen einzigen XML-POST-Request:

```
POST /cgi-bin/ILRReadValues.cgi
Content-Type: text/xml

<body>
  <item_list>
    <i><n>G0.RaumTemp</n></i>
    <i><n>G0.SollTemp</n></i>
    <i><n>G0.OPMode</n></i>
    ...
  </item_list>
</body>
```

Antwort:

```xml
<body>
  <item_list>
    <i><n>G0.RaumTemp</n><v>2150</v></i>
    <i><n>G0.SollTemp</n><v>2200</v></i>
    <i><n>G0.OPMode</n><v>0</v></i>
    ...
  </item_list>
</body>
```

Temperaturen werden als Integer × 100 übertragen (z.B. `2150` = 21,5 °C).

Schreiben der Soll-Temperatur:

```
GET /cgi-bin/writeVal.cgi?G0.SollTemp=2200
```

### Bekannte CGI-Variablen

| Variable | Beschreibung |
|---|---|
| `totalNumberOfDevices` | Anzahl gekoppelter Räume |
| `G{n}.name` | Raumname |
| `G{n}.RaumTemp` | Ist-Temperatur (×100) |
| `G{n}.SollTemp` | Soll-Temperatur (×100, les- und schreibbar) |
| `G{n}.OPMode` | Betriebsmodus |
| `G{n}.WeekProg` | Wochenprogramm |
| `G{n}.SollTempMinVal` | Minimale Soll-Temperatur (×100) |
| `G{n}.SollTempMaxVal` | Maximale Soll-Temperatur (×100) |
| `G{n}.SollTempStepVal` | Temperatur-Schrittweite (×100) |
| `G{n}.available` | Verfügbarkeit (`online` / leer) |

---

## Fehlerbehebung

**Der Adapter startet, findet aber keine Zonen**
- Prüfe ob die IP-Adresse erreichbar ist: `ping 192.168.1.100`
- Öffne im Browser: `http://192.168.1.100` – dort sollte die Touchline-Weboberfläche erscheinen
- Stelle sicher dass Controller und ioBroker im gleichen Netzwerk sind

**Temperaturen werden als 0 angezeigt**
- Log-Level auf `debug` stellen – der Adapter gibt dann die Rohwerte des Controllers aus
- Prüfe ob der Controller tatsächlich Daten zurückliefert

**Controller friert ein oder startet neu**
- Polling-Intervall erhöhen (mindestens 60 Sekunden)
- Firmware des Controllers prüfen und ggf. aktualisieren

---

## Changelog

### 1.1.0
- Umstieg von einzelnen GET-Requests auf einen einzigen XML-POST-Request pro Poll
- JSON-Config UI (kein HTML mehr)
- Minimum-Polling auf 30 Sekunden angehoben
- min/max/step der Soll-Temperatur werden dynamisch vom Controller gelesen
- `extendObjectAsync` statt `setObjectNotExistsAsync` für zuverlässige Objekt-Updates

### 1.0.0
- Erstveröffentlichung

---

## Lizenz

MIT – © Henrik Morgenstern
