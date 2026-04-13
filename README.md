# ioBroker.touchline

ioBroker Adapter für **Roth Touchline Fußbodenheizungssteuerungen (Legacy API)**.

Der Adapter liest Daten direkt über die lokale HTTP-Schnittstelle des Controllers aus und ermöglicht das Setzen der Solltemperatur einzelner Räume.

Der Fokus liegt bewusst auf der **alten Touchline CGI API**, die von vielen Installationen verwendet wird.

## Features

- automatische **Raumerkennung**
- Lesen von **Ist-Temperatur**
- Lesen von **Soll-Temperatur**
- **Solltemperatur setzen**
- Anzeige von **Betriebsmodus**
- Anzeige von **Wochenprogramm**
- Anzeige von **Min / Max Solltemperatur**
- Anzeige von **Temperaturschrittweite**
- Anzeige ob Raum **online/verfügbar**
- stabile Kommunikation über lokale **Legacy CGI API**

Der Adapter verwendet ausschließlich die **alte API** und ist damit kompatibel zu vielen älteren Touchline Systemen.

---

# Unterstützte Controller

- Roth Touchline (Legacy Controller)
- Roth Touchline Floor Heating Control

Der Adapter nutzt die lokalen CGI-Endpunkte:
