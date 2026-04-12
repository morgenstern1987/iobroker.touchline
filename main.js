const utils = require("@iobroker/adapter-core");

class Touchline extends utils.Adapter {

    constructor(options = {}) {
        super({
            ...options,
            name: "touchline"
        });

        this.on("ready", this.onReady.bind(this));
    }

    async onReady() {

        this.log.info("Touchline adapter started");

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

        this.setState("info.connection", true, true);

    }

}

if (require.main !== module) {
    module.exports = (options) => new Touchline(options);
} else {
    new Touchline();
}
