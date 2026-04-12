'use strict';

const utils = require('@iobroker/adapter-core');
const LegacyAPI = require('./lib/legacy-api');

class TouchlineAdapter extends utils.Adapter {

    constructor(options = {}) {

        super({ ...options, name: 'touchline' });

        this.api = null;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }

    async onReady() {

        await this.setStateAsync('info.connection', false, true);

        const host = this.config.host;

        if (!host) {

            this.log.error('Keine IP gesetzt');

            return;
        }

        this.api = new LegacyAPI(host);

        const zones = await this.api.getZoneCount();

        this.log.info(`Gefundene Räume: ${zones}`);

        for (let i = 0; i < zones; i++) {

            const id = `zones.zone${i}`;

            await this.setObjectNotExistsAsync(id, {
                type: 'channel',
                common: { name: `Zone ${i}` },
                native: {}
            });

            await this.createState(`${id}.currentTemp`, 'Ist Temperatur', false);
            await this.createState(`${id}.targetTemp`, 'Soll Temperatur', true);
        }

        this.poll();

        setInterval(() => this.poll(), (this.config.pollInterval || 30) * 1000);
    }

    async createState(id, name, write) {

        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common: {
                name,
                type: 'number',
                read: true,
                write
            },
            native: {}
        });
    }

    async poll() {

        try {

            const count = await this.api.getZoneCount();

            for (let i = 0; i < count; i++) {

                const regs = await this.api.getRegisters([
                    10000 + i * 6,
                    10000 + i * 6 + 1
                ]);

                const current = regs[10000 + i * 6 + 1] / 10;
                const target = regs[10000 + i * 6] / 10;

                await this.setStateAsync(`zones.zone${i}.currentTemp`, current, true);
                await this.setStateAsync(`zones.zone${i}.targetTemp`, target, true);
            }

            await this.setStateAsync('info.connection', true, true);

        } catch (e) {

            this.log.error(e);

            await this.setStateAsync('info.connection', false, true);
        }
    }

    async onStateChange(id, state) {

        if (!state || state.ack) return;

        const parts = id.split('.');

        if (parts[2] !== 'zones') return;

        const zone = parseInt(parts[3].replace('zone',''));

        if (parts[4] === 'targetTemp') {

            const reg = 10000 + zone * 6;

            const value = Math.round(state.val * 10);

            await this.api.getRegisters([`${reg}=${value}`]);
        }
    }
}

if (require.main !== module) {

    module.exports = options => new TouchlineAdapter(options);

} else {

    new TouchlineAdapter();
}
