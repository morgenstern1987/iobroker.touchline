'use strict';

const axios = require('axios');

/**
 * REST-API für Roth Touchline SL (neue Firmware)
 * Basis: http://<ip>/api/v1/
 *
 * Endpunkte:
 *   GET  /api/v1/module            – System-/Modulinfo
 *   GET  /api/v1/module/zone       – Alle Zonen
 *   GET  /api/v1/module/zone/{id}  – Einzelne Zone
 *   PUT  /api/v1/module/zone/{id}  – Zone steuern
 *   GET  /api/v1/module/schedule   – Alle Wochenprogramme
 *   GET  /api/v1/module/schedule/{id} – Einzelnes Programm
 *
 * Zonen-Modi: 0=standby, 1=auto, 2=manual, 3=holiday
 */
class TouchlineSLAPI {
    constructor(host, timeout = 5000) {
        this.baseUrl = `[${host}](http://${host}/api/v1)`;
        this.timeout = timeout;

        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: this.timeout,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    async _get(path) {
        const response = await this.client.get(path);
        return response.data;
    }

    async _put(path, data) {
        const response = await this.client.put(path, data);
        return response.data;
    }

    /**
     * Modulinfo (Firmware, Seriennummer, Netzwerkkonfiguration …)
     */
    async getModuleInfo() {
        return this._get('/module');
    }

    /**
     * Alle Zonen abrufen
     * @returns {Array} Normalisierte Zonenobjekte
     */
    async getAllZones() {
        const data = await this._get('/module/zone');
        const raw = Array.isArray(data) ? data : (data.zones || data.data || [data]);
        return raw.map(z => this._normalizeZone(z));
    }

    /**
     * Einzelne Zone abrufen
     */
    async getZone(id) {
        const data = await this._get(`/module/zone/${id}`);
        return this._normalizeZone(data);
    }

    /**
     * Alle Wochenpläne abrufen
     */
    async getSchedules() {
        try {
            return await this._get('/module/schedule');
        } catch {
            return [];
        }
    }

    /**
     * Einzelnen Wochenplan abrufen
     */
    async getSchedule(id) {
        return this._get(`/module/schedule/${id}`);
    }

    /**
     * Solltemperatur setzen
     * @param {string|number} id    Zonen-ID
     * @param {number} tempCelsius  Zieltemperatur °C
     */
    async setTargetTemperature(id, tempCelsius) {
        return this._put(`/module/zone/${id}`, {
            targetTemperature: Math.round(tempCelsius * 10) / 10,
        });
    }

    /**
     * Betriebsmodus setzen
     * @param {string|number} id  Zonen-ID
     * @param {number} mode       0=standby, 1=auto, 2=manual, 3=holiday
     */
    async setMode(id, mode) {
        return this._put(`/module/zone/${id}`, { mode });
    }

    /**
     * Wochenplan einer Zone zuweisen
     */
    async assignSchedule(zoneId, scheduleId) {
        return this._put(`/module/zone/${zoneId}`, { weekSchedule: scheduleId });
    }

    /**
     * Normalisiert ein Zonenobjekt auf ein einheitliches Format
     */
    _normalizeZone(z) {
        return {
            id: z.id,
            name: z.name || z.description || `Zone ${z.id}`,
            currentTemperature: this._toTemp(z.currentTemperature ?? z.actualTemperature),
            targetTemperature: this._toTemp(z.targetTemperature ?? z.setpointTemperature),
            floorTemperature: this._toTemp(z.floorTemperature),
            humidity: z.humidity ?? null,
            co2: z.co2 ?? null,
            mode: this._toMode(z.mode),
            modeRaw: z.mode ?? 0,
            weekSchedule: z.weekSchedule ?? null,
            windowContact: z.windowContact ?? false,
            valvePosition: z.valvePosition ?? null,
            online: z.online !== false,
        };
    }

    _toTemp(val) {
        if (val === undefined || val === null) return null;
        return parseFloat(parseFloat(val).toFixed(1));
    }

    _toMode(raw) {
        const modes = { 0: 'standby', 1: 'auto', 2: 'manual', 3: 'holiday' };
        return modes[parseInt(raw, 10)] || 'auto';
    }
}

module.exports = TouchlineSLAPI;
