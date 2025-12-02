#!/usr/bin/env node

/**
 * Linux Event Monitor - Quick Test
 *
 * Quick sanity check that runs without waiting for events.
 * Useful for CI/CD pipelines.
 */

'use strict';

// Check if running on Linux
if (process.platform !== 'linux') {
    console.log('SKIP: Not running on Linux');
    process.exit(0);
}

let LinuxEventMonitor;
try {
    LinuxEventMonitor = require('../lib/index').LinuxEventMonitor ||
                        require('../lib/index').default ||
                        require('../index');
} catch (e) {
    console.log('SKIP: Native module not built');
    console.log('Run: npm run build');
    process.exit(0);
}

console.log('Quick Test: Linux Event Monitor');
console.log('================================');

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
    tests.push({ name, fn });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

// Define tests
test('Can create monitor instance', () => {
    const monitor = new LinuxEventMonitor();
    assert(monitor !== null, 'Monitor should not be null');
    assert(typeof monitor.start === 'function', 'Should have start method');
    assert(typeof monitor.stop === 'function', 'Should have stop method');
    assert(typeof monitor.getCounts === 'function', 'Should have getCounts method');
});

test('getCounts returns correct structure', () => {
    const monitor = new LinuxEventMonitor();
    const counts = monitor.getCounts();

    assert(typeof counts === 'object', 'Counts should be an object');
    assert(typeof counts.keyboard === 'number', 'keyboard should be a number');
    assert(typeof counts.mouse === 'number', 'mouse should be a number');
    assert(typeof counts.scrolls === 'number', 'scrolls should be a number');
    assert(typeof counts.isMonitoring === 'boolean', 'isMonitoring should be a boolean');
});

test('getBackendType returns string', () => {
    const monitor = new LinuxEventMonitor();
    const backend = monitor.getBackendType();

    assert(typeof backend === 'string', 'Backend type should be a string');
    assert(['libinput', 'x11', 'none'].includes(backend),
           `Backend should be libinput, x11, or none, got: ${backend}`);
});

test('checkPermissions returns correct structure', () => {
    const monitor = new LinuxEventMonitor();
    const perms = monitor.checkPermissions();

    assert(typeof perms === 'object', 'Permissions should be an object');
    assert(typeof perms.hasInputAccess === 'boolean', 'hasInputAccess should be boolean');
    assert(typeof perms.hasX11Access === 'boolean', 'hasX11Access should be boolean');
    assert(typeof perms.currentBackend === 'string', 'currentBackend should be string');
    assert(Array.isArray(perms.missingPermissions), 'missingPermissions should be array');
});

test('isMonitoring returns false before start', () => {
    const monitor = new LinuxEventMonitor();
    assert(monitor.isMonitoring() === false, 'Should not be monitoring initially');
});

test('resetCounts works without error', () => {
    const monitor = new LinuxEventMonitor();
    const result = monitor.resetCounts();
    // Result can be true or false depending on native module state
    assert(typeof result === 'boolean', 'resetCounts should return boolean');
});

test('stop works without error when not started', () => {
    const monitor = new LinuxEventMonitor();
    const result = monitor.stop();
    assert(result === true, 'stop should return true when not running');
});

// Run tests
console.log('');

for (const { name, fn } of tests) {
    try {
        fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL: ${name}`);
        console.log(`        ${e.message}`);
        failed++;
    }
}

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');

process.exit(failed > 0 ? 1 : 0);
