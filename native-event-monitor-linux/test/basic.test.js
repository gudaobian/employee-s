#!/usr/bin/env node

/**
 * Linux Event Monitor - Basic Test
 *
 * Tests the native event monitoring module functionality.
 * Run on a Linux system with appropriate permissions.
 */

'use strict';

// Check if running on Linux
if (process.platform !== 'linux') {
    console.log('=== Linux Event Monitor Test ===');
    console.log('');
    console.log('This test must be run on a Linux system.');
    console.log(`Current platform: ${process.platform}`);
    console.log('');
    console.log('Exiting with success (skip on non-Linux).');
    process.exit(0);
}

const path = require('path');

// Try to load the module
let LinuxEventMonitor;
try {
    // Try compiled TypeScript first
    LinuxEventMonitor = require('../lib/index').LinuxEventMonitor;
} catch (e1) {
    try {
        // Fall back to index.js
        LinuxEventMonitor = require('../index');
    } catch (e2) {
        console.error('Failed to load LinuxEventMonitor module');
        console.error('TypeScript error:', e1.message);
        console.error('JavaScript error:', e2.message);
        console.error('');
        console.error('Make sure to build the module first:');
        console.error('  npm run build');
        process.exit(1);
    }
}

console.log('=== Linux Event Monitor Test ===');
console.log('');

// Create monitor instance
const monitor = new LinuxEventMonitor();

// Check if native module is available
console.log('1. Checking native module availability...');
if (!monitor.isAvailable()) {
    console.log('   Native module NOT available');
    console.log('');
    console.log('   The native module needs to be compiled:');
    console.log('   $ npm run build:native');
    console.log('');
    console.log('   Required dependencies on Ubuntu/Debian:');
    console.log('   $ sudo apt install libinput-dev libudev-dev libx11-dev libxtst-dev');
    console.log('');
    process.exit(1);
}
console.log('   Native module is available');

// Check permissions
console.log('');
console.log('2. Checking permissions...');
const permissions = monitor.checkPermissions();
console.log(`   Input group access: ${permissions.hasInputAccess ? 'YES' : 'NO'}`);
console.log(`   X11 display access: ${permissions.hasX11Access ? 'YES' : 'NO'}`);
console.log(`   Current backend: ${permissions.currentBackend}`);

if (permissions.missingPermissions.length > 0) {
    console.log(`   Missing: ${permissions.missingPermissions.join(', ')}`);
}

if (!permissions.hasInputAccess && !permissions.hasX11Access) {
    console.log('');
    console.log('   WARNING: No event monitoring method available!');
    console.log('');
    console.log('   To enable libinput backend (recommended):');
    console.log('   $ sudo usermod -aG input $USER');
    console.log('   Then log out and back in.');
    console.log('');
    console.log('   To enable X11 backend:');
    console.log('   Make sure you are running in an X11 session.');
    console.log('');
}

// Try to start monitoring
console.log('');
console.log('3. Starting event monitoring...');
const started = monitor.start();

if (!started) {
    console.log('   Failed to start monitoring');
    console.log('');
    console.log('   Check permissions above and ensure you have proper access.');
    process.exit(1);
}

console.log(`   Monitoring started successfully!`);
console.log(`   Backend: ${monitor.getBackendType()}`);

// Monitor events for 10 seconds
console.log('');
console.log('4. Monitoring events for 10 seconds...');
console.log('   Press keyboard keys and click mouse buttons to test.');
console.log('');

let lastCounts = { keyboard: 0, mouse: 0, scrolls: 0 };

const displayInterval = setInterval(() => {
    const counts = monitor.getCounts();
    const kDiff = counts.keyboard - lastCounts.keyboard;
    const mDiff = counts.mouse - lastCounts.mouse;
    const sDiff = counts.scrolls - lastCounts.scrolls;

    if (kDiff > 0 || mDiff > 0 || sDiff > 0) {
        console.log(`   Keyboard: ${counts.keyboard} (+${kDiff}), ` +
                   `Mouse: ${counts.mouse} (+${mDiff}), ` +
                   `Scrolls: ${counts.scrolls} (+${sDiff})`);
    }

    lastCounts = { ...counts };
}, 500);

// Stop after 10 seconds
setTimeout(() => {
    clearInterval(displayInterval);

    console.log('');
    console.log('5. Final results...');

    const finalCounts = monitor.getCounts();
    console.log(`   Total keyboard events: ${finalCounts.keyboard}`);
    console.log(`   Total mouse events: ${finalCounts.mouse}`);
    console.log(`   Total scroll events: ${finalCounts.scrolls}`);
    console.log(`   Is monitoring: ${finalCounts.isMonitoring}`);

    // Test reset
    console.log('');
    console.log('6. Testing reset...');
    monitor.resetCounts();
    const afterReset = monitor.getCounts();
    console.log(`   After reset - Keyboard: ${afterReset.keyboard}, ` +
               `Mouse: ${afterReset.mouse}, Scrolls: ${afterReset.scrolls}`);

    // Stop monitoring
    console.log('');
    console.log('7. Stopping monitoring...');
    const stopped = monitor.stop();
    console.log(`   Stopped: ${stopped ? 'YES' : 'NO'}`);
    console.log(`   Is monitoring: ${monitor.isMonitoring()}`);

    // Summary
    console.log('');
    console.log('=== Test Summary ===');

    const success = finalCounts.keyboard > 0 || finalCounts.mouse > 0 || finalCounts.scrolls > 0;

    if (success) {
        console.log('SUCCESS: Event monitoring is working correctly!');
        console.log('');
        console.log(`Detected ${finalCounts.keyboard} keyboard events, ` +
                   `${finalCounts.mouse} mouse events, ` +
                   `${finalCounts.scrolls} scroll events.`);
    } else {
        console.log('WARNING: No events detected during test period.');
        console.log('');
        console.log('This could mean:');
        console.log('1. You did not press any keys or click the mouse');
        console.log('2. The monitoring backend has permission issues');
        console.log('3. Events are being captured by another application');
    }

    console.log('');
    process.exit(success ? 0 : 1);

}, 10000);

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('');
    console.log('Interrupted. Cleaning up...');
    clearInterval(displayInterval);
    monitor.stop();
    process.exit(0);
});
