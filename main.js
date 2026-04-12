const utils = require("@iobroker/adapter-core");
const Touchline = require("./lib/touchline");

class TouchlineAdapter extends utils.Adapter {

    constructor(options = {}) {
        super({
            ...options,
            name: "touchline"
        });

        this.client = null;
        this.pollTimer = null;

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
    }

    async onReady() {

        this.log.info("Touchline adapter starting...");

        this.client = new Touchline(this.config.ip, this);

        await this.setObjectNotExistsAsync("info.connection", {
            type: "state",
            common: {
                name: "Connection",
                type: "boolean",
                role: "indicator.connected",
                read: true,
                write: false
            },
            native: {}
        });

        this.startPolling();

    }

    startPolling(){

        const interval = this.config.interval || 60;

        this.poll();

        this.pollTimer = setInterval(() => {

            this.poll();

        }, interval * 1000);

    }

    async poll(){

        try{

            const zones = await this.client.getZones();

            for(const zone of zones){

                const base = "rooms." + zone.id;

                await this.setObjectNotExistsAsync(base, {
                    type: "channel",
                    common: {
                        name: zone.name
                    },
                    native: {}
                });

                await this.setObjectNotExistsAsync(base + ".temperature", {
                    type: "state",
                    common: {
                        name: "Temperature",
                        type: "number",
                        role: "value.temperature",
                        unit: "°C",
                        read: true,
                        write: false
                    },
                    native: {}
                });

                await this.setObjectNotExistsAsync(base + ".setpoint", {
                    type: "state",
                    common: {
                        name: "Setpoint",
                        type: "number",
                        role: "level.temperature",
                        unit: "°C",
                        read: true,
                        write: true
                    },
                    native: {}
                });

                await this.setObjectNotExistsAsync(base + ".valve", {
                    type: "state",
                    common: {
                        name: "Valve Position",
                        type: "number",
                        role: "value",
                        unit: "%",
                        read: true,
                        write: false
                    },
                    native: {}
                });

                await this.setStateAsync(base + ".temperature", {
                    val: zone.temperature,
                    ack: true
                });

                await this.setStateAsync(base + ".setpoint", {
                    val: zone.setpoint,
                    ack: true
                });

                await this.setStateAsync(base + ".valve", {
                    val: zone.valve,
                    ack: true
                });

            }

            await this.setStateAsync("info.connection", {
                val: true,
                ack: true
            });

        }catch(e){

            this.log.error("Touchline polling error: " + e.message);

            await this.setStateAsync("info.connection", {
                val: false,
                ack: true
            });

        }

    }

    async onStateChange(id, state){

        if (!state || state.ack) return;

        try{

            if(id.includes(".setpoint")){

                const parts = id.split(".");
                const zone = parts[3];

                await this.client.setTemp(zone, state.val);

                this.log.info("Set temperature zone " + zone + " -> " + state.val);

            }

        }catch(e){

            this.log.error("Setpoint error: " + e.message);

        }

    }

}

if (require.main !== module) {
    module.exports = (options) => new TouchlineAdapter(options);
} else {
    new TouchlineAdapter();
}
