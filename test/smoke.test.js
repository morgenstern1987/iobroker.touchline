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
