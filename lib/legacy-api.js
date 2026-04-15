'use strict';

const axios = require('axios');

/**
 * LegacyAPI
 * Kommunikation mit dem Roth Touchline Legacy Controller über die lokale CGI-API.
 *
 * Endpunkte:
 *   GET /cgi-bin/readVal.cgi?<variable>        → Wert lesen
 *   GET /cgi-bin/writeVal.cgi?<variable>=<val> → Wert schreiben
 */
class LegacyAPI {

    /**
     * @param {string} host   - IP-Adresse des Controllers (ohne http://)
     * @param {object} [log]  - ioBroker Logger (optional)
     */
    constructor(host, log = null) {
        this.host    = host.trim().replace(/^https?:\/\//, '');
        this.baseUrl = `http://${this.host}/cgi-bin`;
        this.log     = log || { debug: () => {}, warn: () => {}, error: () => {} };

        this._client = axios.create({
            timeout:  5000,
            responseType: 'text',
            transformResponse: r => r  /* kein JSON-Parsing */
        });
    }

    /* ────────────────────────────────────────────────────────────
       Einzelwert lesen
    ──────────────────────────────────────────────────────────── */
    async read(variable) {
        const url = `${this.baseUrl}/readVal.cgi?${encodeURIComponent(variable)}`;
        this.log.debug(`CGI read: ${variable}`);

        const res = await this._client.get(url);
        return String(res.data).trim();
    }

    /* ────────────────────────────────────────────────────────────
       Mehrere Variablen parallel lesen
       Gibt ein Objekt { variable: value } zurück.
       Fehlgeschlagene Variablen werden mit null belegt.
    ──────────────────────────────────────────────────────────── */
    async readVariables(variables) {
        const results = await Promise.allSettled(
            variables.map(async variable => {
                const value = await this.read(variable);
                return { variable, value };
            })
        );

        const data = {};
        for (const r of results) {
            if (r.status === 'fulfilled') {
                data[r.value.variable] = r.value.value;
            } else {
                /* Variable-Name ist in der Reason leider nicht direkt verfügbar,
                   daher nur debug-Ausgabe */
                this.log.debug(`Lese-Fehler für eine Variable: ${r.reason?.message}`);
            }
        }
        return data;
    }

    /* ────────────────────────────────────────────────────────────
       Wert schreiben
    ──────────────────────────────────────────────────────────── */
    async write(variable, value) {
        const url = `${this.baseUrl}/writeVal.cgi?${encodeURIComponent(variable)}=${encodeURIComponent(value)}`;
        this.log.debug(`CGI write: ${variable} = ${value}`);

        await this._client.get(url);
    }

    /* ────────────────────────────────────────────────────────────
       Anzahl der gekoppelten Räume / Zonen
    ──────────────────────────────────────────────────────────── */
    async getZoneCount() {
        const raw = await this.read('R0.numberOfPairedDevices');
        const count = parseInt(raw, 10);

        if (isNaN(count)) {
            throw new Error(`Ungültige Antwort für R0.numberOfPairedDevices: "${raw}"`);
        }
        return count;
    }

    /* ────────────────────────────────────────────────────────────
       Raumname für eine Zone
    ──────────────────────────────────────────────────────────── */
    async getZoneName(index) {
        try {
            const name = await this.read(`G${index}.name`);
            return name || `Zone ${index}`;
        } catch {
            return `Zone ${index}`;
        }
    }

    /* ────────────────────────────────────────────────────────────
       Soll-Temperatur setzen
       temp: Dezimalwert in °C (z.B. 21.5)
       Der Controller erwartet den Wert ×100 als Integer (z.B. 2150)
    ──────────────────────────────────────────────────────────── */
    async setTargetTemperature(index, temp) {
        const value = Math.round(parseFloat(temp) * 100);

        if (isNaN(value)) {
            throw new Error(`Ungültiger Temperaturwert: ${temp}`);
        }
        await this.write(`G${index}.SollTemp`, value);
    }
}

module.exports = LegacyAPI;
