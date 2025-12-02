/**
 * Linux Event Monitor - TypeScript Wrapper
 *
 * Provides a type-safe interface for the native Linux event monitoring module.
 * Supports libinput (preferred) and X11 XRecord (fallback) backends.
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Event counts returned by the monitor
 */
export interface EventCounts {
    /** Number of keyboard key press events */
    keyboard: number;
    /** Number of mouse button click events */
    mouse: number;
    /** Number of scroll wheel events */
    scrolls: number;
    /** Whether the monitor is currently active */
    isMonitoring: boolean;
}

/**
 * Permission status for event monitoring
 */
export interface PermissionStatus {
    /** Whether the user has access to /dev/input devices */
    hasInputAccess: boolean;
    /** Whether X11 display is available */
    hasX11Access: boolean;
    /** Currently active backend type */
    currentBackend: BackendType;
    /** List of missing permissions */
    missingPermissions: string[];
}

/**
 * Backend types available for event monitoring
 */
export type BackendType = 'libinput' | 'x11' | 'none';

/**
 * Native module interface
 */
interface NativeMonitor {
    start(): boolean;
    stop(): boolean;
    getCounts(): EventCounts;
    resetCounts(): boolean;
    isMonitoring(): boolean;
    getBackendType(): string;
    checkPermissions(): PermissionStatus;
}

/**
 * Native module exports
 */
interface NativeModule {
    LinuxEventMonitor: new () => NativeMonitor;
    createMonitor(): NativeMonitor;
}

/**
 * Load the native addon with fallback strategies
 */
function loadNativeModule(): NativeModule | null {
    const moduleDir = path.dirname(__dirname);

    // Strategy 1: Try prebuilt binary based on Electron ABI
    const electronABI = process.versions.modules;
    const arch = process.arch;
    const prebuiltPath = path.join(
        moduleDir, 'bin', `linux-${arch}-${electronABI}`, 'linux_event_monitor.node'
    );

    if (fs.existsSync(prebuiltPath)) {
        try {
            console.log(`[LINUX_EVENT] Loading prebuilt binary: ${prebuiltPath}`);
            return require(prebuiltPath);
        } catch (e) {
            console.warn(`[LINUX_EVENT] Failed to load prebuilt: ${e}`);
        }
    }

    // Strategy 2: Try local build
    const buildPath = path.join(moduleDir, 'build', 'Release', 'linux_event_monitor.node');
    if (fs.existsSync(buildPath)) {
        try {
            console.log(`[LINUX_EVENT] Loading local build: ${buildPath}`);
            return require(buildPath);
        } catch (e) {
            console.warn(`[LINUX_EVENT] Failed to load local build: ${e}`);
        }
    }

    // Strategy 3: Try debug build
    const debugPath = path.join(moduleDir, 'build', 'Debug', 'linux_event_monitor.node');
    if (fs.existsSync(debugPath)) {
        try {
            console.log(`[LINUX_EVENT] Loading debug build: ${debugPath}`);
            return require(debugPath);
        } catch (e) {
            console.warn(`[LINUX_EVENT] Failed to load debug build: ${e}`);
        }
    }

    console.error('[LINUX_EVENT] No native module found');
    console.error('Searched paths:');
    console.error(`  1. Prebuilt: ${prebuiltPath}`);
    console.error(`  2. Release:  ${buildPath}`);
    console.error(`  3. Debug:    ${debugPath}`);
    console.error('\nSolution: Run "npm run build:native" in native-event-monitor-linux directory');

    return null;
}

/**
 * Linux Event Monitor class
 *
 * Provides keyboard, mouse, and scroll event monitoring on Linux systems.
 * Automatically selects the best available backend (libinput or X11).
 *
 * @example
 * ```typescript
 * const monitor = new LinuxEventMonitor();
 *
 * // Check permissions first
 * const perms = monitor.checkPermissions();
 * if (!perms.hasInputAccess && !perms.hasX11Access) {
 *     console.log('No event monitoring available');
 *     console.log('Add user to input group: sudo usermod -aG input $USER');
 * }
 *
 * // Start monitoring
 * if (monitor.start()) {
 *     console.log(`Using backend: ${monitor.getBackendType()}`);
 *
 *     // Get counts periodically
 *     setInterval(() => {
 *         const counts = monitor.getCounts();
 *         console.log(`Keyboard: ${counts.keyboard}, Mouse: ${counts.mouse}`);
 *     }, 1000);
 * }
 *
 * // Stop when done
 * monitor.stop();
 * ```
 */
export class LinuxEventMonitor extends EventEmitter {
    private nativeMonitor: NativeMonitor | null = null;
    private isRunning: boolean = false;
    private pollInterval: NodeJS.Timeout | null = null;

    /**
     * Create a new LinuxEventMonitor instance
     */
    constructor() {
        super();

        const nativeModule = loadNativeModule();
        if (nativeModule) {
            try {
                this.nativeMonitor = nativeModule.createMonitor();
            } catch (e) {
                console.error('[LINUX_EVENT] Failed to create monitor:', e);
            }
        }
    }

    /**
     * Start event monitoring
     * @returns true if monitoring started successfully
     */
    start(): boolean {
        if (!this.nativeMonitor) {
            console.error('[LINUX_EVENT] Native module not loaded');
            return false;
        }

        try {
            const result = this.nativeMonitor.start();
            this.isRunning = result;

            if (result) {
                this.emit('started', this.getBackendType());
            }

            return result;
        } catch (error) {
            console.error('[LINUX_EVENT] Failed to start monitoring:', error);
            return false;
        }
    }

    /**
     * Stop event monitoring
     * @returns true if monitoring stopped successfully
     */
    stop(): boolean {
        if (!this.nativeMonitor) {
            return true;
        }

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        try {
            const result = this.nativeMonitor.stop();
            this.isRunning = false;

            if (result) {
                this.emit('stopped');
            }

            return result;
        } catch (error) {
            console.error('[LINUX_EVENT] Failed to stop monitoring:', error);
            return false;
        }
    }

    /**
     * Get current event counts
     * @returns Object containing keyboard, mouse, scroll counts and monitoring status
     */
    getCounts(): EventCounts {
        if (!this.nativeMonitor) {
            return {
                keyboard: 0,
                mouse: 0,
                scrolls: 0,
                isMonitoring: false
            };
        }

        try {
            return this.nativeMonitor.getCounts();
        } catch (error) {
            console.error('[LINUX_EVENT] Failed to get counts:', error);
            return {
                keyboard: 0,
                mouse: 0,
                scrolls: 0,
                isMonitoring: false
            };
        }
    }

    /**
     * Reset all event counts to zero
     * @returns true if reset was successful
     */
    resetCounts(): boolean {
        if (!this.nativeMonitor) {
            return false;
        }

        try {
            return this.nativeMonitor.resetCounts();
        } catch (error) {
            console.error('[LINUX_EVENT] Failed to reset counts:', error);
            return false;
        }
    }

    /**
     * Check if monitoring is currently active
     * @returns true if monitoring is active
     */
    isMonitoring(): boolean {
        if (!this.nativeMonitor) {
            return false;
        }

        try {
            return this.nativeMonitor.isMonitoring();
        } catch (error) {
            return false;
        }
    }

    /**
     * Get the current backend type
     * @returns 'libinput', 'x11', or 'none'
     */
    getBackendType(): BackendType {
        if (!this.nativeMonitor) {
            return 'none';
        }

        try {
            const type = this.nativeMonitor.getBackendType();
            return type as BackendType;
        } catch (error) {
            return 'none';
        }
    }

    /**
     * Check permission status for event monitoring
     * @returns Permission status object with details about access and missing permissions
     */
    checkPermissions(): PermissionStatus {
        if (!this.nativeMonitor) {
            return {
                hasInputAccess: false,
                hasX11Access: false,
                currentBackend: 'none',
                missingPermissions: ['native_module_not_loaded']
            };
        }

        try {
            return this.nativeMonitor.checkPermissions();
        } catch (error) {
            console.error('[LINUX_EVENT] Failed to check permissions:', error);
            return {
                hasInputAccess: false,
                hasX11Access: false,
                currentBackend: 'none',
                missingPermissions: ['permission_check_failed']
            };
        }
    }

    /**
     * Start polling for events and emit 'counts' events
     * @param intervalMs Polling interval in milliseconds (default: 1000)
     */
    startPolling(intervalMs: number = 1000): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }

        this.pollInterval = setInterval(() => {
            const counts = this.getCounts();
            this.emit('counts', counts);
        }, intervalMs);
    }

    /**
     * Stop polling for events
     */
    stopPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /**
     * Check if the native module is loaded and available
     * @returns true if native module is available
     */
    isAvailable(): boolean {
        return this.nativeMonitor !== null;
    }
}

// Export default instance factory
export default LinuxEventMonitor;

// Also export as module.exports for CommonJS compatibility
module.exports = LinuxEventMonitor;
module.exports.LinuxEventMonitor = LinuxEventMonitor;
module.exports.default = LinuxEventMonitor;
