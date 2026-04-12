'use strict';

const axios = require('axios');

const NEW_API_PATHS = [
    '/api/v1/status',
    '/api/v1/system',
    '/api/v1/info',
    '/api/v1/zones',
    '/api/v1/rooms',
    '/api/v1/devices',
    '/api/v1/controllers',
    '/api/v1/sensors',
    '/api/v1/thermostats',
    '/api/v1/heatingcircuits',
];

const OLD_API_PATHS = [
    '/status',
    '/system',
    '/info',
    '/zones',
    '/rooms',
    '/devices',
    '/controllers',
    '/sensors',
    '/thermostats',
    '/json/status',
    '/json/system',
    '/json/info',
    '/api/status',
    '/api/system',
];

class TouchlineClient {
    constructor(options) {
        this.host = options.host;
        this.username = options.username;
        this.password = options.password;
        this.token = options.token;
        this.protocol = options.protocol === 'https' ? 'https' : 'http';

        this.http = axios.create({
            timeout: 10000,
            validateStatus: code => code >= 200 && code < 500,
        });
    }

    buildHeaders() {
        const headers = {
            Accept: 'application/json',
        };

        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }

        return headers;
    }

    buildAuth() {
        if (this.username && this.password) {
            return {
                username: this.username,
                password: this.password,
            };
        }

        return undefined;
    }

    async request(path) {
        const url = `${this.protocol}://${this.host}${path}`;
        const response = await this.http.get(url, {
            headers: this.buildHeaders(),
            auth: this.buildAuth(),
        });

        if (response.status >= 400) {
            throw new Error(`HTTP ${response.status} for ${path}`);
        }

        return response.data;
    }

    async canRequest(path) {
        try {
            await this.request(path);
            return true;
        } catch {
            return false;
        }
    }

    async detectApiType() {
        if (await this.canRequest('/api/v1/status')) {
            return 'new';
        }

        if (await this.canRequest('/status')) {
            return 'old';
        }

        return 'old';
    }

    normalizePaths(paths) {
        return [...new Set(paths
            .filter(Boolean)
            .map(path => String(path).trim())
            .filter(path => path.startsWith('/')))];
    }

    async fetchSnapshot(apiType, customPaths = []) {
        const actualType = apiType === 'auto' ? await this.detectApiType() : apiType;
        const basePaths = actualType === 'new' ? NEW_API_PATHS : OLD_API_PATHS;
        const paths = this.normalizePaths([...basePaths, ...customPaths]);

        const snapshot = {
            apiType: actualType,
            fetchedAt: new Date().toISOString(),
            endpoints: {},
        };

        for (const path of paths) {
            try {
                snapshot.endpoints[path] = {
                    ok: true,
                    data: await this.request(path),
                };
            } catch (error) {
                snapshot.endpoints[path] = {
                    ok: false,
                    error: error.message,
                };
            }
        }

        return snapshot;
    }
}

module.exports = {
    TouchlineClient,
};
