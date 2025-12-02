/**
 * Linux Event Monitor - Entry Point
 *
 * Smart loader that handles prebuilt binaries and local builds.
 * Provides a unified interface matching macOS and Windows implementations.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

let nativeMonitor = null;

/**
 * Try to load the native module from various locations
 */
function loadNativeModule() {
    const moduleDir = __dirname;
    const electronABI = process.versions.modules;
    const arch = process.arch;

    // List of paths to try, in order of preference
    const paths = [
        // Prebuilt binary for this specific Electron ABI
        path.join(moduleDir, 'bin', `linux-${arch}-${electronABI}`, 'linux_event_monitor.node'),

        // Release build
        path.join(moduleDir, 'build', 'Release', 'linux_event_monitor.node'),

        // Debug build
        path.join(moduleDir, 'build', 'Debug', 'linux_event_monitor.node'),
    ];

    for (const modulePath of paths) {
        if (fs.existsSync(modulePath)) {
            try {
                console.log(`[LINUX_EVENT] Loading native module: ${modulePath}`);
                return require(modulePath);
            } catch (error) {
                console.warn(`[LINUX_EVENT] Failed to load ${modulePath}: ${error.message}`);
            }
        }
    }

    // No module found
    console.error('[LINUX_EVENT] Native module not found');
    console.error('Searched paths:');
    paths.forEach((p, i) => {
        const exists = fs.existsSync(p);
        console.error(`  ${i + 1}. ${p} [${exists ? 'exists but failed' : 'not found'}]`);
    });
    console.error('');
    console.error('Solution:');
    console.error('  1. Install dependencies: sudo apt install libinput-dev libudev-dev libx11-dev libxtst-dev');
    console.error('  2. Build module: npm run build:native');
    console.error('');

    return null;
}

// Only load native module on Linux
if (process.platform === 'linux') {
    nativeMonitor = loadNativeModule();
}

/**
 * Linux Event Monitor class
 *
 * Provides cross-backend event monitoring for Linux systems.
 * Compatible with the macOS and Windows event monitor interfaces.
 */
class LinuxEventMonitor extends EventEmitter {
    constructor() {
        super();
        this._monitor = null;
        this._isRunning = false;
        this._pollInterval = null;

        if (nativeMonitor && nativeMonitor.createMonitor) {
            try {
                this._monitor = nativeMonitor.createMonitor();
            } catch (error) {
                console.error('[LINUX_EVENT] Failed to create monitor:', error.message);
            }
        }
    }

    /**
     * Check if the native module is available
     * @returns {boolean}
     */
    isAvailable() {
        return this._monitor !== null;
    }

    /**
     * Start event monitoring
     * @returns {boolean} true if started successfully
     */
    start() {
        if (!this._monitor) {
            console.error('[LINUX_EVENT] Native module not available');
            return false;
        }

        try {
            const result = this._monitor.start();
            this._isRunning = result;

            if (result) {
                this.emit('started', this.getBackendType());
            }

            return result;
        } catch (error) {
            console.error('[LINUX_EVENT] Start failed:', error.message);
            return false;
        }
    }

    /**
     * Stop event monitoring
     * @returns {boolean} true if stopped successfully
     */
    stop() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }

        if (!this._monitor) {
            return true;
        }

        try {
            const result = this._monitor.stop();
            this._isRunning = false;

            if (result) {
                this.emit('stopped');
            }

            return result;
        } catch (error) {
            console.error('[LINUX_EVENT] Stop failed:', error.message);
            return false;
        }
    }

    /**
     * Get current event counts
     * @returns {Object} { keyboard, mouse, scrolls, isMonitoring }
     */
    getCounts() {
        if (!this._monitor) {
            return { keyboard: 0, mouse: 0, scrolls: 0, isMonitoring: false };
        }

        try {
            return this._monitor.getCounts();
        } catch (error) {
            console.error('[LINUX_EVENT] getCounts failed:', error.message);
            return { keyboard: 0, mouse: 0, scrolls: 0, isMonitoring: false };
        }
    }

    /**
     * Reset event counts to zero
     * @returns {boolean} true if reset successfully
     */
    resetCounts() {
        if (!this._monitor) {
            return false;
        }

        try {
            return this._monitor.resetCounts();
        } catch (error) {
            console.error('[LINUX_EVENT] resetCounts failed:', error.message);
            return false;
        }
    }

    /**
     * Check if monitoring is active
     * @returns {boolean}
     */
    isMonitoring() {
        if (!this._monitor) {
            return false;
        }

        try {
            return this._monitor.isMonitoring();
        } catch (error) {
            return false;
        }
    }

    /**
     * Get the current backend type
     * @returns {string} 'libinput', 'x11', or 'none'
     */
    getBackendType() {
        if (!this._monitor) {
            return 'none';
        }

        try {
            return this._monitor.getBackendType();
        } catch (error) {
            return 'none';
        }
    }

    /**
     * Check permission status
     * @returns {Object} { hasInputAccess, hasX11Access, currentBackend, missingPermissions }
     */
    checkPermissions() {
        if (!this._monitor) {
            return {
                hasInputAccess: false,
                hasX11Access: false,
                currentBackend: 'none',
                missingPermissions: ['native_module_not_loaded']
            };
        }

        try {
            return this._monitor.checkPermissions();
        } catch (error) {
            return {
                hasInputAccess: false,
                hasX11Access: false,
                currentBackend: 'none',
                missingPermissions: ['permission_check_failed']
            };
        }
    }

    /**
     * Start polling and emitting 'counts' events
     * @param {number} intervalMs - Polling interval in milliseconds
     */
    startPolling(intervalMs = 1000) {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
        }

        this._pollInterval = setInterval(() => {
            this.emit('counts', this.getCounts());
        }, intervalMs);
    }

    /**
     * Stop polling
     */
    stopPolling() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    }
}

module.exports = LinuxEventMonitor;
module.exports.LinuxEventMonitor = LinuxEventMonitor;
module.exports.default = LinuxEventMonitor;
