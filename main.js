'use strict';

const utils = require('@iobroker/adapter-core');
const TouchlineLegacyAPI = require('./lib/api-legacy');
const TouchlineSLAPI = require('./lib/api-sl');

class TouchlineAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'touchline' });

        this.api = null;
        this.apiType = null;     // 'legacy' | 'sl'
        this.pollTimer = null;
        this.connected = false;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    // ─────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────

    async onReady() {
        this.setState('info.connection', false, true);

        const host = (this.config.host || '').trim();
        if (!host) {
            this.log.error('Keine IP-Adresse konfiguriert. Bitte in den Adaptereinstellungen eintragen.');
            return;
        }

        this.log.info(`Verbinde mit Roth Touchline unter ${host}`);
        await this.detectAndConnect(host);
    }

    async onUnload(callback) {
        try {
            this.stopPolling();
            this.setConnected(false);
            callback();
        } catch {
            callback();
        }
    }

    // ─────────────────────────────────────────────
    // API-Erkennung
    // ─────────────────────────────────────────────

    async detectAndConnect(host) {
        const timeout = this.config.requestTimeout || 5000;
        const preferred = this.config.apiVersion || 'auto';

        if (preferred === 'sl') {
            if (await this.tryConnectSL(host, timeout)) return;
            this.log.warn('SL-API nicht erreichbar, versuche Legacy …');
            await this.tryConnectLegacy(host, timeout);
        } else if (preferred === 'legacy') {
            if (await this.tryConnectLegacy(host, timeout)) return;
            this.log.warn('Legacy-API nicht erreichbar, versuche SL …');
            await this.tryConnectSL(host, timeout);
        } else {
            // auto: SL zuerst, dann Legacy
            if (await this.tryConnectSL(host, timeout)) return;
            if (await this.tryConnectLegacy(host, timeout)) return;
            this.log.error('Keine API-Version erreichbar. Überprüfe IP-Adresse und Netzwerkverbindung.');
        }
    }

    async tryConnectSL(host, timeout) {
        try {
            const api = new TouchlineSLAPI(host, timeout);
            await api.getModuleInfo(); // Verbindungstest
            this.api = api;
            this.apiType = 'sl';
            this.log.info('Verbunden via Touchline SL REST-API');
            this.setConnected(true);
            await this.initObjectsSL();
            this.startPolling();
            return true;
        } catch (e) {
            this.log.debug(`SL-API nicht verfügbar: ${e.message}`);
            return false;
        }
    }

    async tryConnectLegacy(host, timeout) {
        try {
            const api = new TouchlineLegacyAPI(host, timeout);
            await api.getZoneCount(); // Verbindungstest
            this.api = api;
            this.apiType = 'legacy';
            this.log.info('Verbunden via Touchline Legacy CGI-API');
            this.setConnected(true);
            await this.initObjectsLegacy();
            this.startPolling();
            return true;
        } catch (e) {
            this.log.debug(`Legacy-API nicht verfügbar: ${e.message}`);
            return false;
        }
    }

    // ─────────────────────────────────────────────
    // Objekt-Initialisierung SL
    // ─────────────────────────────────────────────

    async initObjectsSL() {
        const info = await this.api.getModuleInfo();
        await this.setObjectNotExistsAsync('system', {
            type: 'channel',
            common: { name: 'System Information' },
            native: {},
        });
        await this.createStateIfNotExists('system.firmware',    'Firmware',      'string', 'text',            false);
        await this.createStateIfNotExists('system.serialNumber','Seriennummer',  'string', 'text',            false);
        await this.createStateIfNotExists('system.model',       'Modell',        'string', 'text',            false);
        await this.createStateIfNotExists('system.ipAddress',   'IP-Adresse',    'string', 'text',            false);
        await this.createStateIfNotExists('system.apiVersion',  'API-Version',   'string', 'text',            false);

        await this.setStateAsync('system.firmware',    String(info.firmware || info.firmwareVersion || ''), true);
        await this.setStateAsync('system.serialNumber',String(info.serialNumber || info.serial || ''),      true);
        await this.setStateAsync('system.model',       String(info.model || ''),                            true);
        await this.setStateAsync('system.ipAddress',   String(info.ipAddress || this.config.host),          true);
        await this.setStateAsync('system.apiVersion',  'SL',                                                true);

        // Zonen anlegen
        const zones = await this.api.getAllZones();
        for (const zone of zones) {
            await this.createZoneObjects(String(zone.id), zone.name);
        }

        // Zeitpläne
        const schedules = await this.api.getSchedules();
        for (const sched of (Array.isArray(schedules) ? schedules : [])) {
            await this.createScheduleObjects(sched);
        }
    }

    // ─────────────────────────────────────────────
    // Objekt-Initialisierung Legacy
    // ─────────────────────────────────────────────

    async initObjectsLegacy() {
        const info = await this.api.getSystemInfo();
        await this.setObjectNotExistsAsync('system', {
            type: 'channel',
            common: { name: 'System Information' },
            native: {},
        });
        await this.createStateIfNotExists('system.firmware',    'Firmware',     'string', 'text', false);
        await this.createStateIfNotExists('system.serialNumber','Seriennummer', 'string', 'text', false);
        await this.createStateIfNotExists('system.apiVersion',  'API-Version',  'string', 'text', false);

        await this.setStateAsync('system.firmware',    String(info.firmwareVersion || ''), true);
        await this.setStateAsync('system.serialNumber',String(info.serialNumber || ''),    true);
        await this.setStateAsync('system.apiVersion',  'Legacy',                           true);

        const count = await this.api.getZoneCount();
        this.log.info(`${count} Zone(n) gefunden`);

        const zones = await this.api.getAllZones(count);
        for (const zone of zones) {
            await this.createZoneObjects(String(zone.id), zone.name);
        }
    }

    // ─────────────────────────────────────────────
    // Gemeinsame Zonenstruktur
    // ─────────────────────────────────────────────

    async createZoneObjects(id, name) {
        const base = `zones.${id}`;
        await this.setObjectNotExistsAsync(base, {
            type: 'channel',
            common: { name },
            native: {},
        });

        const states = [
            // id,                       Name,                   Typ,     Rolle,                         Schreiben
            ['name',                     'Name',                 'string','text',                        false],
            ['currentTemperature',       'Isttemperatur',        'number','value.temperature',            false],
            ['targetTemperature',        'Solltemperatur',       'number','level.temperature',            true],
            ['floorTemperature',         'Fußbodentemperatur',   'number','value.temperature',            false],
            ['humidity',                 'Luftfeuchtigkeit',     'number','value.humidity',               false],
            ['co2',                      'CO₂',                  'number','value.co2',                    false],
            ['mode',                     'Modus (Text)',         'string','text',                         false],
            ['modeRaw',                  'Modus (Zahl)',         'number','value',                        true],
            ['windowContact',            'Fensterkontakt',       'boolean','sensor.window',               false],
            ['valvePosition',            'Ventilstellung %',     'number','value',                        false],
            ['weekSchedule',             'Wochenprogramm-ID',    'number','value',                        true],
            ['online',                   'Online',               'boolean','indicator.reachable',         false],
        ];

        for (const [sid, sname, stype, srole, swrite] of states) {
            await this.createStateIfNotExists(`${base}.${sid}`, sname, stype, srole, swrite);
        }
    }

    async createScheduleObjects(sched) {
        const base = `schedules.${sched.id}`;
        await this.setObjectNotExistsAsync(base, {
            type: 'channel',
            common: { name: sched.name || `Schedule ${sched.id}` },
            native: {},
        });
        await this.createStateIfNotExists(`${base}.name`, 'Name', 'string', 'text', false);
        await this.createStateIfNotExists(`${base}.json`, 'JSON', 'string', 'json', false);
        await this.setStateAsync(`${base}.name`, String(sched.name || ''), true);
        await this.setStateAsync(`${base}.json`, JSON.stringify(sched), true);
    }

    // ─────────────────────────────────────────────
    // Polling
    // ─────────────────────────────────────────────

    startPolling() {
        const interval = (this.config.pollInterval || 30) * 1000;
        this.log.info(`Starte Polling alle ${this.config.pollInterval || 30} Sekunden`);
        this.poll(); // Sofortiger erster Abruf
        this.pollTimer = setInterval(() => this.poll(), interval);
    }

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async poll() {
        try {
            if (this.apiType === 'sl') {
                await this.pollSL();
            } else if (this.apiType === 'legacy') {
                await this.pollLegacy();
            }
            if (!this.connected) this.setConnected(true);
        } catch (e) {
            this.log.warn(`Polling-Fehler: ${e.message}`);
            this.setConnected(false);
        }
    }

    async pollSL() {
        const zones = await this.api.getAllZones();
        for (const zone of zones) {
            await this.updateZoneStates(String(zone.id), zone);
        }
    }

    async pollLegacy() {
        const count = await this.api.getZoneCount();
        const zones = await this.api.getAllZones(count);
        for (const zone of zones) {
            await this.updateZoneStates(String(zone.id), zone);
        }
    }

    async updateZoneStates(id, zone) {
        const base = `zones.${id}`;
        const updates = {
            name:               zone.name,
            currentTemperature: zone.currentTemperature,
            targetTemperature:  zone.targetTemperature,
            floorTemperature:   zone.floorTemperature,
            humidity:           zone.humidity,
            co2:                zone.co2,
            mode:               zone.mode,
            modeRaw:            zone.modeRaw,
            windowContact:      zone.windowContact,
            valvePosition:      zone.valvePosition,
            weekSchedule:       zone.weekSchedule,
            online:             zone.online !== false,
        };

        for (const [key, val] of Object.entries(updates)) {
            if (val !== null && val !== undefined) {
                await this.setStateAsync(`${base}.${key}`, val, true);
            }
        }
    }

    // ─────────────────────────────────────────────
    // Steuerbefehle (State-Änderungen)
    // ─────────────────────────────────────────────

    async onStateChange(id, state) {
        if (!state || state.ack) return; // Nur eigene Schreibzugriffe

        const parts = id.split('.');
        // Format: touchline.0.zones.<id>.<key>
        if (parts[2] !== 'zones') return;

        const zoneId = parts[3];
        const key    = parts[4];

        try {
            if (key === 'targetTemperature') {
                this.log.info(`Zone ${zoneId}: Solltemperatur → ${state.val}°C`);
                await this.api.setTargetTemperature(
                    this.apiType === 'legacy' ? parseInt(zoneId) : zoneId,
                    state.val
                );
                await this.setStateAsync(id, state.val, true);
            } else if (key === 'modeRaw') {
                this.log.info(`Zone ${zoneId}: Modus → ${state.val}`);
                await this.api.setMode(
                    this.apiType === 'legacy' ? parseInt(zoneId) : zoneId,
                    state.val
                );
                await this.setStateAsync(id, state.val, true);
            } else if (key === 'weekSchedule' && this.apiType === 'sl') {
                this.log.info(`Zone ${zoneId}: Wochenprogramm → ${state.val}`);
                await this.api.assignSchedule(zoneId, state.val);
                await this.setStateAsync(id, state.val, true);
            }
        } catch (e) {
            this.log.error(`Steuerbefehl fehlgeschlagen (${key}): ${e.message}`);
        }
    }

    // ─────────────────────────────────────────────
    // Message-Handler (für Admin-UI Tests)
    // ─────────────────────────────────────────────

    async onMessage(obj) {
        if (!obj || !obj.command) return;

        if (obj.command === 'testConnection') {
            const host = (obj.message?.host || '').trim();
            if (!host) {
                this.sendTo(obj.from, obj.command, { error: 'Keine IP angegeben' }, obj.callback);
                return;
            }
            try {
                const sl = new TouchlineSLAPI(host, 3000);
                await sl.getModuleInfo();
                this.sendTo(obj.from, obj.command, { result: 'ok', type: 'sl' }, obj.callback);
            } catch {
                try {
                    const leg = new TouchlineLegacyAPI(host, 3000);
                    const count = await leg.getZoneCount();
                    this.sendTo(obj.from, obj.command,
                        { result: 'ok', type: 'legacy', zones: count }, obj.callback);
                } catch (e) {
                    this.sendTo(obj.from, obj.command,
                        { error: `Nicht erreichbar: ${e.message}` }, obj.callback);
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // Hilfsfunktionen
    // ─────────────────────────────────────────────

    setConnected(val) {
        this.connected = val;
        this.setState('info.connection', val, true);
    }

    async createStateIfNotExists(id, name, type, role, write, unit) {
        const common = { name, type, role, read: true, write: !!write };
        if (unit) common.unit = unit;
        await this.setObjectNotExistsAsync(id, { type: 'state', common, native: {} });
    }
}

// Adapter starten
if (require.main !== module) {
    module.exports = (options) => new TouchlineAdapter(options);
} else {
    new TouchlineAdapter();
}
