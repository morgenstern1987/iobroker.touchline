'use strict';

const utils    = require('@iobroker/adapter-core');
const LegacyAPI = require('./lib/legacy-api');

class TouchlineAdapter extends utils.Adapter {

    constructor(options = {}) {
        super({ ...options, name: 'touchline' });

        this.api        = null;
        this.pollTimer  = null;
        this.zoneCount  = 0;

        this.on('ready',       this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload',      this.onUnload.bind(this));
    }

    /* ────────────────────────────────────────────────────────────
       onReady – Adapter startet
    ──────────────────────────────────────────────────────────── */
    async onReady() {

        /* Verbindungs-Indikator anlegen */
        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name:  'Connection',
                type:  'boolean',
                role:  'indicator.connected',
                read:  true,
                write: false,
                def:   false
            },
            native: {}
        });
        await this.setStateAsync('info.connection', false, true);

        /* IP-Adresse prüfen */
        const host = (this.config.host || '').trim();
        if (!host) {
            this.log.error('Keine IP-Adresse konfiguriert. Bitte in den Adaptereinstellungen eintragen.');
            return;
        }

        this.api = new LegacyAPI(host, this.log);

        /* Raumanzahl abrufen */
        try {
            this.zoneCount = await this.api.getZoneCount();
        } catch (err) {
            this.log.error(`Touchline-Controller nicht erreichbar (${host}): ${err.message}`);
            await this.setStateAsync('info.connection', false, true);
            return;
        }

        if (this.zoneCount === 0) {
            this.log.warn('Controller erreichbar, aber keine Räume gefunden.');
        } else {
            this.log.info(`Touchline verbunden – ${this.zoneCount} Räume/Zonen gefunden.`);
        }

        /* Objekte für alle Zonen anlegen */
        await this._createZoneObjects();

        /* State-Subscription & ersten Poll starten */
        this.subscribeStates('zones.*.targetTemperature');
        await this._poll();

        const interval = Math.max(5, parseInt(this.config.pollInterval) || 30);
        this.pollTimer = this.setInterval(() => this._poll(), interval * 1000);
    }

    /* ────────────────────────────────────────────────────────────
       Zonen-Objekte anlegen (bei Bedarf)
    ──────────────────────────────────────────────────────────── */
    async _createZoneObjects() {
        for (let i = 0; i < this.zoneCount; i++) {

            const name = await this.api.getZoneName(i);
            const base = `zones.zone${i}`;

            await this.setObjectNotExistsAsync(base, {
                type:   'channel',
                common: { name },
                native: {}
            });

            /* Ist-Temperatur */
            await this._ensureState(`${base}.currentTemperature`, {
                name:  'Ist-Temperatur',
                type:  'number',
                role:  'value.temperature',
                unit:  '°C',
                read:  true,
                write: false
            });

            /* Soll-Temperatur (schreibbar) */
            await this._ensureState(`${base}.targetTemperature`, {
                name:  'Soll-Temperatur',
                type:  'number',
                role:  'level.temperature',
                unit:  '°C',
                min:   5,
                max:   40,
                step:  0.5,
                read:  true,
                write: true
            });

            /* Betriebsmodus */
            await this._ensureState(`${base}.mode`, {
                name:  'Betriebsmodus',
                type:  'number',
                role:  'value',
                read:  true,
                write: false,
                states: { 0: 'Auto', 1: 'Komfort', 2: 'Absenken', 3: 'Frostschutz' }
            });

            /* Wochenprogramm */
            await this._ensureState(`${base}.weekProgram`, {
                name:  'Wochenprogramm',
                type:  'number',
                role:  'value',
                read:  true,
                write: false
            });

            /* Min/Max/Schrittweite */
            await this._ensureState(`${base}.minTemp`, {
                name: 'Min-Temperatur', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false
            });
            await this._ensureState(`${base}.maxTemp`, {
                name: 'Max-Temperatur', type: 'number', role: 'value.temperature', unit: '°C', read: true, write: false
            });
            await this._ensureState(`${base}.step`, {
                name: 'Temperatur-Schrittweite', type: 'number', role: 'value', unit: '°C', read: true, write: false
            });

            /* Online-Status */
            await this._ensureState(`${base}.available`, {
                name:  'Online',
                type:  'boolean',
                role:  'indicator.reachable',
                read:  true,
                write: false
            });
        }
    }

    /* ────────────────────────────────────────────────────────────
       Polling – alle Zonendaten auf einmal lesen
    ──────────────────────────────────────────────────────────── */
    async _poll() {
        if (this.zoneCount === 0) return;

        /* Alle benötigten Variablen sammeln */
        const vars = [];
        for (let i = 0; i < this.zoneCount; i++) {
            vars.push(
                `G${i}.RaumTemp`,
                `G${i}.SollTemp`,
                `G${i}.OPMode`,
                `G${i}.WeekProg`,
                `G${i}.SollTempMinVal`,
                `G${i}.SollTempMaxVal`,
                `G${i}.SollTempStepVal`,
                `G${i}.available`
            );
        }

        let data;
        try {
            data = await this.api.readVariables(vars);
        } catch (err) {
            this.log.error(`Polling-Fehler: ${err.message}`);
            await this.setStateAsync('info.connection', false, true);
            return;
        }

        /* States setzen */
        for (let i = 0; i < this.zoneCount; i++) {
            const base = `zones.zone${i}`;

            await this.setStateAsync(`${base}.currentTemperature`, this._temp(data[`G${i}.RaumTemp`]),     true);
            await this.setStateAsync(`${base}.targetTemperature`,  this._temp(data[`G${i}.SollTemp`]),     true);
            await this.setStateAsync(`${base}.mode`,               this._int(data[`G${i}.OPMode`]),        true);
            await this.setStateAsync(`${base}.weekProgram`,        this._int(data[`G${i}.WeekProg`]),      true);
            await this.setStateAsync(`${base}.minTemp`,            this._temp(data[`G${i}.SollTempMinVal`]), true);
            await this.setStateAsync(`${base}.maxTemp`,            this._temp(data[`G${i}.SollTempMaxVal`]), true);
            await this.setStateAsync(`${base}.step`,               this._temp(data[`G${i}.SollTempStepVal`]), true);
            await this.setStateAsync(`${base}.available`,          data[`G${i}.available`] === 'online',    true);
        }

        await this.setStateAsync('info.connection', true, true);
        this.log.debug(`Poll abgeschlossen – ${this.zoneCount} Zone(n) aktualisiert.`);
    }

    /* ────────────────────────────────────────────────────────────
       onStateChange – Soll-Temperatur schreiben
    ──────────────────────────────────────────────────────────── */
    async onStateChange(id, state) {
        if (!state || state.ack) return;

        /* ID-Format: touchline.0.zones.zoneN.targetTemperature */
        const parts = id.split('.');
        if (parts.length < 5) return;

        const zoneStr = parts[parts.length - 2]; // z.B. "zone3"
        const field   = parts[parts.length - 1];

        if (field !== 'targetTemperature') return;

        const zoneIdx = parseInt(zoneStr.replace('zone', ''), 10);
        if (isNaN(zoneIdx)) return;

        const val = parseFloat(state.val);
        if (isNaN(val)) return;

        try {
            await this.api.setTargetTemperature(zoneIdx, val);
            this.log.info(`Zone ${zoneIdx}: Soll-Temperatur auf ${val} °C gesetzt.`);

            /* Sofortiges Rücklesen für ack */
            await this.setStateAsync(
                `zones.zone${zoneIdx}.targetTemperature`,
                val,
                true
            );
        } catch (err) {
            this.log.error(`Zone ${zoneIdx}: Soll-Temperatur setzen fehlgeschlagen – ${err.message}`);
        }
    }

    /* ────────────────────────────────────────────────────────────
       onUnload
    ──────────────────────────────────────────────────────────── */
    onUnload(callback) {
        try {
            if (this.pollTimer) {
                this.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        } catch (_) { /* ignore */ }
        callback();
    }

    /* ────────────────────────────────────────────────────────────
       Hilfsmethoden
    ──────────────────────────────────────────────────────────── */

    /** Rohwert (×100) → °C */
    _temp(raw) {
        const v = parseInt(raw, 10);
        return isNaN(v) ? 0 : v / 100;
    }

    /** Rohwert → Integer */
    _int(raw) {
        const v = parseInt(raw, 10);
        return isNaN(v) ? 0 : v;
    }

    /** State-Objekt anlegen falls nicht vorhanden */
    async _ensureState(id, common) {
        await this.setObjectNotExistsAsync(id, {
            type:   'state',
            common: { ...common },
            native: {}
        });
    }
}

/* ── Adapter-Start ───────────────────────────────────────────── */
if (require.main !== module) {
    module.exports = options => new TouchlineAdapter(options);
} else {
    new TouchlineAdapter();
}
