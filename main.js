'use strict';

const utils = require('@iobroker/adapter-core');
const LegacyAPI = require('./lib/legacy-api');

class TouchlineAdapter extends utils.Adapter {

    constructor(options = {}) {

        super({
            ...options,
            name: 'touchline'
        });

        this.api = null;
        this.pollTimer = null;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }

    async onReady() {

        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'Connection',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false
            },
            native: {}
        });

        const host = this.config.host;

        if (!host) {

            this.log.error("Keine IP gesetzt");

            return;
        }

        this.api = new LegacyAPI(host);

        let zoneCount = 0;

        try {

            zoneCount = await this.api.getZoneCount();

        } catch (e) {

            this.log.error("Touchline nicht erreichbar");

            return;
        }

        this.log.info(`Gefundene Räume: ${zoneCount}`);

        for (let i = 0; i < zoneCount; i++) {

            const name = await this.api.getZoneName(i);

            const base = `zones.zone${i}`;

            await this.setObjectNotExistsAsync(base, {
                type: "channel",
                common: { name },
                native: {}
            });

            await this.createState(`${base}.currentTemperature`, "Ist Temperatur", false);
            await this.createState(`${base}.targetTemperature`, "Soll Temperatur", true);
        }

        this.subscribeStates("zones.*.targetTemperature");

        this.poll();

        this.pollTimer = setInterval(() => this.poll(), 30000);
    }

    async createState(id, name, write) {

        await this.setObjectNotExistsAsync(id, {
            type: "state",
            common: {
                name,
                type: "number",
                role: "value.temperature",
                read: true,
                write
            },
            native: {}
        });
    }

    async poll() {

        try {

            const zones = await this.api.getZoneCount();

            for (let i = 0; i < zones; i++) {

                const temps = await this.api.getZoneTemperature(i);

                await this.setStateAsync(`zones.zone${i}.currentTemperature`, temps.current, true);
                await this.setStateAsync(`zones.zone${i}.targetTemperature`, temps.target, true);
            }

            await this.setStateAsync("info.connection", true, true);

        } catch (e) {

            this.log.error("Polling Fehler: " + e.message);

            await this.setStateAsync("info.connection", false, true);
        }
    }

    async onStateChange(id, state) {

        if (!state || state.ack) return;

        const parts = id.split('.');

        if (parts[2] !== "zones") return;

        const zone = parseInt(parts[3].replace("zone",""));

        if (parts[4] === "targetTemperature") {

            await this.api.setTargetTemperature(zone, state.val);
        }
    }
}

if (require.main !== module) {

    module.exports = options => new TouchlineAdapter(options);

} else {

    new TouchlineAdapter();
}
