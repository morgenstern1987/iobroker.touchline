'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TouchlineClient } = require('../lib/touchline-client');

test('normalizePaths filters and de-duplicates paths', () => {
    const client = new TouchlineClient({ host: '127.0.0.1' });
    const paths = client.normalizePaths(['/status', '/status', 'status', '   ', '/zones']);
    assert.deepEqual(paths, ['/status', '/zones']);
});

test('protocol defaults to http and supports https', () => {
    const c1 = new TouchlineClient({ host: '127.0.0.1' });
    const c2 = new TouchlineClient({ host: '127.0.0.1', protocol: 'https' });
    assert.equal(c1.protocol, 'http');
    assert.equal(c2.protocol, 'https');
});


test('buildBaseUrl uses configured port when host has no explicit port', () => {
    const client = new TouchlineClient({ host: '192.168.1.10', port: 8899 });
    assert.equal(client.buildBaseUrl(), 'http://192.168.1.10:8899');
});

test('auto mode chooses api generation with more successful endpoints', async () => {
    const client = new TouchlineClient({ host: '127.0.0.1' });
    client.request = async path => {
        if (path.startsWith('/api/v1/')) {
            return { ok: true };
        }
        throw new Error(`HTTP 404 for ${path}`);
    };

    const snapshot = await client.fetchSnapshot('auto');
    assert.equal(snapshot.apiType, 'new');
    assert.ok(snapshot.successfulEndpoints > 0);
});
