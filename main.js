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
        this.on('unload', this.onUnload.bind(this));
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
            await this.createState(`${base}.mode`, "Betriebsmodus", false);
            await this.createState(`${base}.weekProgram`, "Wochenprogramm", false);
            await this.createState(`${base}.minTemp`, "Min Temperatur", false);
            await this.createState(`${base}.maxTemp`, "Max Temperatur", false);
            await this.createState(`${base}.step`, "Temp Schritt", false);

            await this.setObjectNotExistsAsync(`${base}.available`, {
                type: "state",
                common: {
                    name: "Verfügbar",
                    type: "boolean",
                    role: "indicator.reachable",
                    read: true,
                    write: false
                },
                native: {}
            });
        }

        this.subscribeStates("zones.*.targetTemperature");

        this.poll();

        this.pollTimer = setInterval(() => this.poll(), (this.config.pollInterval || 30) * 1000);
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

                const data = await this.api.getZoneDetails(i);

                const current = parseInt(data[`G${i}.RaumTemp`] || 0) / 100;
                const target = parseInt(data[`G${i}.SollTemp`] || 0) / 100;

                await this.setStateAsync(`zones.zone${i}.currentTemperature`, current, true);
                await this.setStateAsync(`zones.zone${i}.targetTemperature`, target, true);

                await this.setStateAsync(
                    `zones.zone${i}.mode`,
                    parseInt(data[`G${i}.OPMode`] || 0),
                    true
                );

                await this.setStateAsync(
                    `zones.zone${i}.weekProgram`,
                    parseInt(data[`G${i}.WeekProg`] || 0),
                    true
                );

                await this.setStateAsync(
                    `zones.zone${i}.minTemp`,
                    parseInt(data[`G${i}.SollTempMinVal`] || 0) / 100,
                    true
                );

                await this.setStateAsync(
                    `zones.zone${i}.maxTemp`,
                    parseInt(data[`G${i}.SollTempMaxVal`] || 0) / 100,
                    true
                );

                await this.setStateAsync(
                    `zones.zone${i}.step`,
                    parseInt(data[`G${i}.SollTempStepVal`] || 0) / 100,
                    true
                );

                await this.setStateAsync(
                    `zones.zone${i}.available`,
                    data[`G${i}.available`] === "online",
                    true
                );
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

            try {

                await this.api.setTargetTemperature(zone, state.val);

            } catch (e) {

                this.log.error("Solltemperatur setzen fehlgeschlagen");
            }
        }
    }

    onUnload(callback) {

        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }

        callback();
    }
}

if (require.main !== module) {

    module.exports = options => new TouchlineAdapter(options);

} else {

    new TouchlineAdapter();
}
