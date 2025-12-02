/**
 * Linux Native Event Monitor Unit Tests
 *
 * Tests the LinuxEventMonitor class functionality.
 * Note: Some tests may be skipped if native module is not available.
 */

describe('LinuxEventMonitor', () => {
    let LinuxEventMonitor: any;
    let monitor: any;
    let moduleAvailable = false;

    beforeAll(() => {
        // Try to load the native module
        try {
            const module = require('../../native-event-monitor-linux');
            LinuxEventMonitor = module.LinuxEventMonitor || module.default;
            moduleAvailable = true;
        } catch (e: any) {
            console.warn('Native module not available:', e.message);
        }
    });

    beforeEach(() => {
        if (moduleAvailable) {
            monitor = new LinuxEventMonitor();
        }
    });

    afterEach(() => {
        if (monitor) {
            try {
                monitor.stop();
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    });

    describe('module loading', () => {
        it('should load native module or skip gracefully', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            expect(LinuxEventMonitor).toBeDefined();
        });
    });

    describe('initialization', () => {
        it('should create instance without errors', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            expect(monitor).toBeDefined();
            expect(monitor.isAvailable()).toBeDefined();
        });

        it('should report correct backend type', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            const backend = monitor.getBackendType();
            expect(['libinput', 'x11', 'none']).toContain(backend);
        });
    });

    describe('permission checking', () => {
        it('should return permission status object', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            const status = monitor.checkPermissions();
            expect(status).toHaveProperty('hasInputAccess');
            expect(status).toHaveProperty('hasX11Access');
            expect(status).toHaveProperty('currentBackend');
            expect(status).toHaveProperty('missingPermissions');
        });

        it('should return boolean for hasInputAccess', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            const status = monitor.checkPermissions();
            expect(typeof status.hasInputAccess).toBe('boolean');
        });

        it('should return boolean for hasX11Access', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            const status = monitor.checkPermissions();
            expect(typeof status.hasX11Access).toBe('boolean');
        });

        it('should return array for missingPermissions', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            const status = monitor.checkPermissions();
            expect(Array.isArray(status.missingPermissions)).toBe(true);
        });
    });

    describe('event monitoring', () => {
        it('should start and stop without errors when permissions available', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }

            const status = monitor.checkPermissions();
            if (status.hasInputAccess || status.hasX11Access) {
                expect(monitor.start()).toBe(true);
                expect(monitor.isMonitoring()).toBe(true);
                expect(monitor.stop()).toBe(true);
                expect(monitor.isMonitoring()).toBe(false);
            } else {
                console.log('Skipping: no monitoring permissions available');
            }
        });

        it('should return counts object', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            const counts = monitor.getCounts();
            expect(counts).toHaveProperty('keyboard');
            expect(counts).toHaveProperty('mouse');
            expect(counts).toHaveProperty('scrolls');
            expect(counts).toHaveProperty('isMonitoring');
            expect(typeof counts.keyboard).toBe('number');
            expect(typeof counts.mouse).toBe('number');
            expect(typeof counts.scrolls).toBe('number');
        });

        it('should have non-negative count values', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            const counts = monitor.getCounts();
            expect(counts.keyboard).toBeGreaterThanOrEqual(0);
            expect(counts.mouse).toBeGreaterThanOrEqual(0);
            expect(counts.scrolls).toBeGreaterThanOrEqual(0);
        });

        it('should reset counts', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            const result = monitor.resetCounts();
            expect(typeof result).toBe('boolean');

            const counts = monitor.getCounts();
            expect(counts.keyboard).toBe(0);
            expect(counts.mouse).toBe(0);
            expect(counts.scrolls).toBe(0);
        });

        it('should handle multiple start/stop cycles', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }

            const status = monitor.checkPermissions();
            if (status.hasInputAccess || status.hasX11Access) {
                // First cycle
                expect(monitor.start()).toBe(true);
                expect(monitor.stop()).toBe(true);

                // Second cycle
                expect(monitor.start()).toBe(true);
                expect(monitor.stop()).toBe(true);
            } else {
                console.log('Skipping: no monitoring permissions available');
            }
        });

        it('should handle stop when not started', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }

            // Should not throw
            const result = monitor.stop();
            expect(typeof result).toBe('boolean');
        });
    });

    describe('isMonitoring state', () => {
        it('should return false initially', () => {
            if (!moduleAvailable) {
                console.log('Skipping: native module not available');
                return;
            }
            expect(monitor.isMonitoring()).toBe(false);
        });
    });
});
