'use strict';

const utils = require('@iobroker/adapter-core');
const TouchlineLegacyAPI = require('./lib/api-legacy');
const TouchlineSLAPI = require('./lib/api-sl');
const discoverTouchline = require('./lib/discovery');

class TouchlineAdapter extends utils.Adapter {

    constructor(options = {}) {

        super({
            ...options,
            name: 'touchline'
        });

        this.api = null;
        this.apiType = null;
        this.pollTimer = null;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {

        await this.createInfoObjects();

        let host = (this.config.host || '').trim();

        if (!host) {

            this.log.info('Keine IP konfiguriert → automatische Suche');

            const devices = await discoverTouchline(this);

            if (devices.length === 0) {

                this.log.error('Kein Touchline Controller gefunden');

                return;
            }

            host = devices[0].ip;

            this.log.info(`Controller automatisch gefunden: ${host}`);
        }

        await this.connectController(host);
    }

    async createInfoObjects() {

        await this.setObjectNotExistsAsync('info', {
            type: 'channel',
            common: { name: 'Information' },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'Connected',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setStateAsync('info.connection', false, true);
    }

    async connectController(host) {

        try {

            const api = new TouchlineSLAPI(host);

            await api.getModuleInfo();

            this.api = api;
            this.apiType = 'sl';

            this.log.info('Touchline SL erkannt');

            await this.initializeZones();

            this.startPolling();

            return;

        } catch {}

        try {

            const api = new TouchlineLegacyAPI(host);

            await api.getZoneCount();

            this.api = api;
            this.apiType = 'legacy';

            this.log.info('Touchline Legacy erkannt');

            await this.initializeZones();

            this.startPolling();

        } catch (e) {

            this.log.error(`Controller nicht erreichbar: ${e.message}`);
        }
    }

    async initializeZones() {

        let zones;

        if (this.apiType === 'sl') {

            zones = await this.api.getAllZones();

        } else {

            const count = await this.api.getZoneCount();

            zones = await this.api.getAllZones(count);
        }

        for (const zone of zones) {

            const zoneName = zone.name || `Zone ${zone.id}`;

            const safeName = zoneName
                .toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]/g, '');

            const base = `zones.${safeName}`;

            await this.setObjectNotExistsAsync(base, {
                type: 'channel',
                common: { name: zoneName },
                native: { id: zone.id }
            });

            await this.createState(`${base}.currentTemperature`, 'Ist Temperatur', false);
            await this.createState(`${base}.targetTemperature`, 'Soll Temperatur', true);
            await this.createState(`${base}.humidity`, 'Luftfeuchte', false);
            await this.createState(`${base}.modeRaw`, 'Modus', true);
        }
    }

    async createState(id, name, write) {

        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common: {
                name,
                type: 'number',
                role: 'value',
                read: true,
                write
            },
            native: {}
        });
    }

    startPolling() {

        const interval = (this.config.pollInterval || 30) * 1000;

        this.poll();

        this.pollTimer = setInterval(() => this.poll(), interval);

        this.log.info(`Polling gestartet (${interval / 1000}s)`);
    }

    async poll() {

        try {

            let zones;

            if (this.apiType === 'sl') {

                zones = await this.api.getAllZones();

            } else {

                const count = await this.api.getZoneCount();

                zones = await this.api.getAllZones(count);
            }

            for (const zone of zones) {

                const zoneName = zone.name || `zone_${zone.id}`;

                const safeName = zoneName
                    .toLowerCase()
                    .replace(/\s+/g, '_')
                    .replace(/[^a-z0-9_]/g, '');

                const base = `zones.${safeName}`;

                await this.setStateAsync(`${base}.currentTemperature`, zone.currentTemperature, true);
                await this.setStateAsync(`${base}.targetTemperature`, zone.targetTemperature, true);

                if (zone.humidity !== undefined)
                    await this.setStateAsync(`${base}.humidity`, zone.humidity, true);

                if (zone.modeRaw !== undefined)
                    await this.setStateAsync(`${base}.modeRaw`, zone.modeRaw, true);
            }

            await this.setStateAsync('info.connection', true, true);

        } catch (e) {

            this.log.warn(`Polling Fehler: ${e.message}`);

            await this.setStateAsync('info.connection', false, true);
        }
    }

    async onStateChange(id, state) {

        if (!state || state.ack) return;

        const parts = id.split('.');

        if (parts[2] !== 'zones') return;

        const zoneKey = parts[3];
        const stateName = parts[4];

        const obj = await this.getObjectAsync(`zones.${zoneKey}`);

        const zoneId = obj.native.id;

        if (stateName === 'targetTemperature') {

            await this.api.setTargetTemperature(zoneId, state.val);
        }

        if (stateName === 'modeRaw') {

            await this.api.setMode(zoneId, state.val);
        }
    }

    async onMessage(obj) {

        if (!obj || !obj.command) return;

        if (obj.command === 'discover') {

            const devices = await discoverTouchline(this);

            this.sendTo(obj.from, obj.command, devices, obj.callback);
        }
    }

    async onUnload(callback) {

        try {

            if (this.pollTimer) clearInterval(this.pollTimer);

            await this.setStateAsync('info.connection', false, true);

            callback();

        } catch {

            callback();
        }
    }
}

if (require.main !== module) {

    module.exports = options => new TouchlineAdapter(options);

} else {

    new TouchlineAdapter();
}
