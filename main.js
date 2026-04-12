'use strict';

const utils = require('@iobroker/adapter-core');
const express = require('express');
const { TouchlineClient } = require('./lib/touchline-client');

const NAMED_ID_CANDIDATES = ['id', 'ID', '_id', 'uuid', 'name', 'roomName', 'zoneName', 'deviceName'];

class TouchlineAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'touchline',
        });

        this.pollTimer = null;
        this.bridgeServer = null;
        this.lastSnapshot = null;
        this.objectCache = new Set();

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync('info.connection', false, true);
        await this.setStateAsync('info.lastError', '', true);

        if (!this.config.localIp || !String(this.config.localIp).trim()) {
            this.log.error('Please configure a local IP / hostname of the Touchline controller.');
            return;
        }

        this.client = new TouchlineClient({
            host: this.config.localIp.trim(),
            username: this.config.username,
            password: this.config.password,
            token: this.config.token,
            protocol: this.config.protocol || 'http',
            port: this.config.apiPort || 80,
            requestTimeout: this.config.requestTimeout || 5000,
        });

        this.log.info(`Touchline target: ${this.config.protocol || 'http'}://${this.config.localIp.trim()}:${this.config.apiPort || 80}`);

        if (this.config.enableWebServer) {
            this.startBridgeServer();
        }

        await this.refresh();
        this.schedulePolling();
    }

    schedulePolling() {
        const intervalSeconds = Math.max(10, Number(this.config.pollInterval) || 60);
        this.pollTimer = setInterval(() => {
            this.refresh().catch(error => {
                this.log.warn(`Refresh failed: ${error.message}`);
            });
        }, intervalSeconds * 1000);
    }

    startBridgeServer() {
        const app = express();
        app.use(express.json());

        app.get('/health', (_req, res) => {
            res.json({
                ok: true,
                connected: this.lastSnapshot !== null,
                fetchedAt: this.lastSnapshot?.fetchedAt || null,
            });
        });

        app.get('/api/states', async (_req, res) => {
            if (!this.lastSnapshot) {
                return res.status(503).json({ message: 'No snapshot available yet' });
            }

            return res.json(this.lastSnapshot);
        });

        app.post('/api/refresh', async (_req, res) => {
            try {
                await this.refresh();
                return res.json({ ok: true, fetchedAt: this.lastSnapshot?.fetchedAt || null });
            } catch (error) {
                return res.status(500).json({ ok: false, error: error.message });
            }
        });

        const port = Math.max(1024, Number(this.config.webPort) || 8099);
        this.bridgeServer = app.listen(port, () => {
            this.log.info(`Bridge webserver listening on port ${port}`);
        });
    }

    sanitizePart(part) {
        return String(part)
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase();
    }

    inferStateCommon(value, path) {
        if (typeof value === 'number') {
            const lower = path.toLowerCase();
            let unit;
            let role = 'value';

            if (lower.includes('temp')) {
                unit = '°C';
                role = 'value.temperature';
            } else if (lower.includes('humidity')) {
                unit = '%';
                role = 'value.humidity';
            } else if (lower.includes('setpoint') || lower.includes('target')) {
                unit = '°C';
                role = 'level.temperature';
            } else if (lower.includes('valve')) {
                unit = '%';
                role = 'value';
            } else if (lower.includes('battery')) {
                unit = '%';
                role = 'value.battery';
            }

            return {
                type: 'number',
                role,
                unit,
                read: true,
                write: false,
            };
        }

        if (typeof value === 'boolean') {
            return {
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false,
            };
        }

        return {
            type: 'string',
            role: 'text',
            read: true,
            write: false,
        };
    }

    normalizeValue(value) {
        if (typeof value !== 'string') {
            return value;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return '';
        }

        if (trimmed.toLowerCase() === 'true') {
            return true;
        }

        if (trimmed.toLowerCase() === 'false') {
            return false;
        }

        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            return Number(trimmed);
        }

        return value;
    }

    findNamedArrayId(item, fallbackIndex) {
        if (!item || typeof item !== 'object') {
            return String(fallbackIndex);
        }

        for (const key of NAMED_ID_CANDIDATES) {
            if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) {
                return String(item[key]);
            }
        }

        return String(fallbackIndex);
    }

    async ensureChannel(channelId, name) {
        if (!channelId || this.objectCache.has(channelId)) {
            return;
        }

        await this.setObjectNotExistsAsync(channelId, {
            type: 'channel',
            common: { name: name || channelId.split('.').pop() },
            native: {},
        });
        this.objectCache.add(channelId);
    }

    async writeLeafState(pathParts, value) {
        const cleanedParts = pathParts.map(p => this.sanitizePart(p)).filter(Boolean);
        if (!cleanedParts.length) {
            return;
        }

        let running = '';
        for (let i = 0; i < cleanedParts.length - 1; i++) {
            running = running ? `${running}.${cleanedParts[i]}` : cleanedParts[i];
            await this.ensureChannel(running, cleanedParts[i]);
        }

        const stateId = cleanedParts.join('.');
        const normalized = this.normalizeValue(value);
        const stateValue = normalized === null || normalized === undefined
            ? ''
            : typeof normalized === 'object'
                ? JSON.stringify(normalized)
                : normalized;

        await this.setObjectNotExistsAsync(stateId, {
            type: 'state',
            common: {
                name: cleanedParts[cleanedParts.length - 1],
                ...this.inferStateCommon(normalized, stateId),
            },
            native: {},
        });

        await this.setStateAsync(stateId, { val: stateValue, ack: true });
    }

    async flattenToStates(prefix, value) {
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const row = value[i];
                const stablePart = this.findNamedArrayId(row, i);
                await this.flattenToStates([...prefix, stablePart], row);
            }
            return;
        }

        if (value !== null && typeof value === 'object') {
            for (const [key, nestedValue] of Object.entries(value)) {
                await this.flattenToStates([...prefix, key], nestedValue);
            }
            return;
        }

        await this.writeLeafState(prefix, value);
    }

    parseCustomEndpoints() {
        if (!this.config.customEndpoints) {
            return [];
        }

        return String(this.config.customEndpoints)
            .split(/[\r\n,;]+/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => line.startsWith('/') ? line : `/${line}`);
    }

    async refresh() {
        const snapshot = await this.client.fetchSnapshot(
            this.config.apiType || 'auto',
            this.parseCustomEndpoints(),
        );
        this.lastSnapshot = snapshot;

        await this.setStateAsync('bridge.lastRefresh', snapshot.fetchedAt, true);
        await this.setStateAsync('info.apiType', snapshot.apiType, true);

        for (const [endpoint, payload] of Object.entries(snapshot.endpoints)) {
            const endpointKey = endpoint
                .replace(/^\//, '')
                .split('/')
                .map(part => this.sanitizePart(part))
                .filter(Boolean);

            await this.writeLeafState(['endpoints', ...endpointKey, 'ok'], payload.ok);
            if (!payload.ok) {
                await this.writeLeafState(['endpoints', ...endpointKey, 'error'], payload.error || 'Unknown error');
                continue;
            }

            await this.writeLeafState(['endpoints', ...endpointKey, 'error'], '');
            await this.flattenToStates(['api', snapshot.apiType, ...endpointKey], payload.data);
        }

        if (snapshot.successfulEndpoints > 0) {
            await this.setStateAsync('info.lastError', '', true);
            await this.setStateAsync('info.connection', true, true);
            return;
        }

        const failed = Object.values(snapshot.endpoints).filter(p => !p.ok && p.error).map(p => p.error);
        const msg = failed.length ? `No compatible endpoint found: ${failed[0]}` : 'No compatible endpoint found (all configured/default endpoints failed)';

        await this.setStateAsync('info.connection', false, true);
        await this.setStateAsync('info.lastError', msg, true);
    }

    async onUnload(callback) {
        try {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }

            if (this.bridgeServer) {
                this.bridgeServer.close();
                this.bridgeServer = null;
            }

            await this.setStateAsync('info.connection', false, true);
        await this.setStateAsync('info.lastError', '', true);
            callback();
        } catch (error) {
            callback(error);
        }
    }
}

if (require.main !== module) {
    module.exports = options => new TouchlineAdapter(options);
} else {
    (() => new TouchlineAdapter())();
}
