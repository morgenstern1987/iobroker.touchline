'use strict';

const axios = require('axios');
const xml2js = require('xml2js');

/**
 * Legacy API für Roth Touchline (ältere Firmware)
 * Kommunikation via POST /cgi-bin/ILRReadValues.cgi mit XML-Antworten
 *
 * Register-Schema (0-basierter Zonen-Index i):
 *   10000 + i*6 + 0  = Solltemperatur * 10
 *   10000 + i*6 + 1  = Isttemperatur  * 10
 *   10000 + i*6 + 2  = Betriebsmodus  (0=auto, 1=tag, 2=nacht, 3=urlaub)
 *   10000 + i*6 + 3  = Fußbodentemp  * 10
 *   10000 + i*6 + 4  = Luftfeuchtigkeit
 *   10000 + i*6 + 5  = Fensterkontakt (0=zu, 1=offen)
 *   6               = Zonenanzahl
 *   7+i             = Zonenname (ASCII)
 */
class TouchlineLegacyAPI {
    constructor(host, timeout = 5000) {
        this.baseUrl = `[${host}](http://${host})`;
        this.timeout = timeout;
        this.parser = new xml2js.Parser({ explicitArray: false });
    }

    /**
     * Rohes POST gegen die CGI-Schnittstelle
     * @param {string} body  URL-encoded POST-Body
     * @returns {object}     Geparstes XML-Objekt
     */
    async _post(body) {
        const response = await axios.post(
            `${this.baseUrl}/cgi-bin/ILRReadValues.cgi`,
            body,
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: this.timeout,
            }
        );
        return this.parser.parseStringPromise(response.data);
    }

    /**
     * GET-Anfrage für einzelne Register
     */
    async _get(params) {
        const response = await axios.get(
            `${this.baseUrl}/cgi-bin/ILRReadValues.cgi`,
            { params, timeout: this.timeout }
        );
        return this.parser.parseStringPromise(response.data);
    }

    /**
     * Parst einen einzelnen Registerwert aus der XML-Antwort
     */
    _extractRegisterValue(parsed, register) {
        try {
            const regs = parsed.result.reg;
            // Kann Array oder Einzelobjekt sein
            const arr = Array.isArray(regs) ? regs : [regs];
            const found = arr.find(r => r.$.nr === String(register));
            return found ? found._ : null;
        } catch {
            return null;
        }
    }

    /**
     * Anzahl der konfigurierten Zonen abrufen
     * @returns {number}
     */
    async getZoneCount() {
        const parsed = await this._get({ n: 1, R: 6 });
        const raw = this._extractRegisterValue(parsed, 6);
        return raw !== null ? parseInt(raw, 10) : 0;
    }

    /**
     * Zonenname für Zone i abrufen (Register 7+i)
     */
    async getZoneName(index) {
        const register = 7 + index;
        const parsed = await this._get({ n: 1, R: register });
        const raw = this._extractRegisterValue(parsed, register);
        if (!raw) return `Zone ${index + 1}`;
        // Hex-kodierter ASCII-String dekodieren
        try {
            return Buffer.from(raw, 'hex').toString('utf8').replace(/\0/g, '').trim()
                || `Zone ${index + 1}`;
        } catch {
            return raw || `Zone ${index + 1}`;
        }
    }

    /**
     * Alle Werte aller Zonen auf einmal abrufen (effizient, 1 Request)
     * @param {number} count  Anzahl Zonen
     * @returns {Array}       Array von Zonenobjekten
     */
    async getAllZones(count) {
        if (count === 0) return [];

        // Alle benötigten Register für count Zonen zusammenstellen
        const registers = [];
        for (let i = 0; i < count; i++) {
            for (let offset = 0; offset < 6; offset++) {
                registers.push(10000 + i * 6 + offset);
            }
            registers.push(7 + i); // Zonenname
        }

        // POST-Body bauen: n=<anzahl>&R=reg1&R=reg2&...
        const bodyParts = [`n=${registers.length}`];
        registers.forEach(r => bodyParts.push(`R=${r}`));
        const body = bodyParts.join('&');

        const parsed = await this._post(body);
        const regs = parsed.result.reg;
        const arr = Array.isArray(regs) ? regs : [regs];

        // Lookup-Map für schnellen Zugriff
        const regMap = {};
        arr.forEach(r => {
            regMap[r.$.nr] = r._;
        });

        const zones = [];
        for (let i = 0; i < count; i++) {
            const base = 10000 + i * 6;
            const nameRaw = regMap[String(7 + i)] || '';
            let name;
            try {
                name = Buffer.from(nameRaw, 'hex').toString('utf8').replace(/\0/g, '').trim()
                    || `Zone ${i + 1}`;
            } catch {
                name = nameRaw || `Zone ${i + 1}`;
            }

            zones.push({
                id: i,
                name,
                targetTemperature: this._toTemp(regMap[String(base + 0)]),
                currentTemperature: this._toTemp(regMap[String(base + 1)]),
                mode: this._toMode(regMap[String(base + 2)]),
                modeRaw: parseInt(regMap[String(base + 2)] || '0', 10),
                floorTemperature: this._toTemp(regMap[String(base + 3)]),
                humidity: this._toFloat(regMap[String(base + 4)]),
                windowContact: regMap[String(base + 5)] === '1',
            });
        }
        return zones;
    }

    /**
     * Systemstatus / Controller-Info abrufen
     * Register 0-5: Firmware, Seriennummer etc.
     */
    async getSystemInfo() {
        const body = 'n=6&R=0&R=1&R=2&R=3&R=4&R=5';
        try {
            const parsed = await this._post(body);
            const regs = parsed.result.reg;
            const arr = Array.isArray(regs) ? regs : [regs];
            const regMap = {};
            arr.forEach(r => { regMap[r.$.nr] = r._; });
            return {
                firmwareVersion: regMap['0'] || 'unknown',
                serialNumber: regMap['1'] || 'unknown',
                productionDate: regMap['2'] || 'unknown',
                hardwareVersion: regMap['3'] || 'unknown',
                raw: regMap,
            };
        } catch {
            return { firmwareVersion: 'unknown', serialNumber: 'unknown' };
        }
    }

    /**
     * Solltemperatur für eine Zone setzen
     * @param {number} index      0-basierter Zonenindex
     * @param {number} tempCelsius Zieltemperatur in °C (z.B. 21.5)
     */
    async setTargetTemperature(index, tempCelsius) {
        const register = 10000 + index * 6 + 0;
        const value = Math.round(tempCelsius * 10);
        const body = `n=1&R${register}=${value}`;
        await this._post(body);
    }

    /**
     * Betriebsmodus für eine Zone setzen
     * @param {number} index   0-basierter Zonenindex
     * @param {number} mode    0=auto, 1=tag, 2=nacht, 3=urlaub
     */
    async setMode(index, mode) {
        const register = 10000 + index * 6 + 2;
        const body = `n=1&R${register}=${mode}`;
        await this._post(body);
    }

    // --- Hilfskonvertierungen ---

    _toTemp(raw) {
        if (raw === undefined || raw === null) return null;
        return parseFloat((parseInt(raw, 10) / 10).toFixed(1));
    }

    _toFloat(raw) {
        if (raw === undefined || raw === null) return null;
        return parseFloat(raw);
    }

    _toMode(raw) {
        const modes = { 0: 'auto', 1: 'day', 2: 'night', 3: 'holiday' };
        return modes[parseInt(raw, 10)] || 'auto';
    }
}

module.exports = TouchlineLegacyAPI;
