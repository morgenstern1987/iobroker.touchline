'use strict';

const utils = require('@iobroker/adapter-core');
const discoverTouchline = require('./lib/discovery');

class TouchlineAdapter extends utils.Adapter {

    constructor(options = {}) {

        super({
            ...options,
            name: 'touchline'
        });

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {

        await this.setStateAsync('info.connection', false, true);

        let host = this.config.host;

        if (!host) {

            this.log.info('Keine IP konfiguriert → starte Discovery');

            const devices = await discoverTouchline(this);

            if (devices.length > 0) {

                host = devices[0].ip;

                this.log.info(`Controller gefunden: ${host}`);

            } else {

                this.log.error('Kein Touchline Controller gefunden');
                return;
            }
        }

        this.log.info(`Verbinde mit Controller ${host}`);

        await this.setStateAsync('info.connection', true, true);
    }

    async onUnload(callback) {

        try {

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
