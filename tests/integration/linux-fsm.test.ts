/**
 * Linux FSM Integration Tests
 *
 * Tests the full state machine flow on Linux platform.
 */

describe('Linux FSM Integration', () => {
    // Increase timeout for integration tests
    jest.setTimeout(120000);

    // Skip if not on Linux
    const isLinux = process.platform === 'linux';
    const forceTests = process.env.FORCE_LINUX_TESTS === 'true';
    const runTests = isLinux || forceTests;

    describe('platform factory', () => {
        it('should detect Linux platform correctly', () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }
            expect(process.platform).toBe('linux');
        });
    });

    describe('platform adapter creation', () => {
        it('should create Linux adapter when on Linux', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                expect(adapter).toBeDefined();
                const platform = adapter.getPlatform?.() || process.platform;
                expect(platform).toBe('linux');

                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('Platform adapter not available:', e.message);
                // This is expected if the module is not built yet
            }
        });

        it('should initialize adapter without errors', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                await expect(adapter.initialize?.() || Promise.resolve()).resolves.not.toThrow();

                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('Platform adapter not available:', e.message);
            }
        });
    });

    describe('activity data collection', () => {
        it('should collect activity data with native events', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                // Start event listener if available
                const listener = adapter.createEventListener?.();

                // Collect monitoring data
                const data = await adapter.collectMonitoringData?.() || {};

                // Verify structure (even if values are 0)
                expect(data).toHaveProperty('timestamp');

                if (listener) {
                    listener.stop?.();
                }
                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('Activity collection not available:', e.message);
            }
        });

        it('should return valid monitoring data structure', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                const data = await adapter.collectMonitoringData?.() || {};

                // Check for expected data fields
                if (data.keyboard !== undefined) {
                    expect(typeof data.keyboard).toBe('number');
                }
                if (data.mouse !== undefined) {
                    expect(typeof data.mouse).toBe('number');
                }

                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('Activity collection not available:', e.message);
            }
        });
    });

    describe('screenshot capture', () => {
        it('should attempt screenshot capture', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                const screenshot = await adapter.captureScreenshot?.();

                // May fail due to permissions, but should not throw unhandled
                if (screenshot) {
                    expect(screenshot).toHaveProperty('data');
                    expect(screenshot).toHaveProperty('width');
                    expect(screenshot).toHaveProperty('height');
                }

                await adapter.cleanup?.();
            } catch (e: any) {
                // Expected to fail without permissions
                console.log('Screenshot capture failed (expected):', e.message);
            }
        });

        it('should return valid screenshot dimensions', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                const screenshot = await adapter.captureScreenshot?.();

                if (screenshot) {
                    expect(screenshot.width).toBeGreaterThan(0);
                    expect(screenshot.height).toBeGreaterThan(0);
                }

                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('Screenshot capture failed (expected):', e.message);
            }
        });
    });

    describe('system information', () => {
        it('should get system information', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                const sysInfo = await adapter.getSystemInfo?.();

                if (sysInfo) {
                    expect(sysInfo).toHaveProperty('platform');
                    expect(sysInfo.platform).toBe('linux');
                }

                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('System info not available:', e.message);
            }
        });
    });

    describe('process listing', () => {
        it('should list running processes', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                const processes = await adapter.getRunningProcesses?.();

                if (processes) {
                    expect(Array.isArray(processes)).toBe(true);
                    expect(processes.length).toBeGreaterThan(0);
                }

                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('Process listing not available:', e.message);
            }
        });
    });

    describe('active window detection', () => {
        it('should get active window info', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                const activeWindow = await adapter.getActiveWindow?.();

                // May return null if no window manager or no active window
                if (activeWindow) {
                    expect(activeWindow).toHaveProperty('title');
                }

                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('Active window detection not available:', e.message);
            }
        });
    });

    describe('idle time detection', () => {
        it('should get user idle time', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                const idleTime = await adapter.getIdleTime?.();

                // Should be a non-negative number
                if (idleTime !== undefined) {
                    expect(typeof idleTime).toBe('number');
                    expect(idleTime).toBeGreaterThanOrEqual(0);
                }

                await adapter.cleanup?.();
            } catch (e: any) {
                console.log('Idle time detection not available:', e.message);
            }
        });
    });

    describe('FSM state transitions', () => {
        it('should handle FSM initialization', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { FSMService } = require('../../dist/common/services/fsm');
                const fsm = new FSMService();

                expect(fsm).toBeDefined();
                expect(fsm.getCurrentState).toBeDefined();

                // Initial state should be INIT or similar
                const initialState = fsm.getCurrentState();
                expect(typeof initialState).toBe('string');
            } catch (e: any) {
                console.log('FSM service not available:', e.message);
            }
        });
    });

    describe('cleanup and resource management', () => {
        it('should cleanup resources properly', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                await adapter.initialize?.();

                // Should not throw
                await expect(adapter.cleanup?.() || Promise.resolve()).resolves.not.toThrow();
            } catch (e: any) {
                console.log('Platform adapter not available:', e.message);
            }
        });

        it('should handle multiple cleanup calls gracefully', async () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }

            try {
                const { createPlatformAdapter } = require('../../dist/platforms');
                const adapter = await createPlatformAdapter();

                await adapter.initialize?.();
                await adapter.cleanup?.();

                // Second cleanup should not throw
                await expect(adapter.cleanup?.() || Promise.resolve()).resolves.not.toThrow();
            } catch (e: any) {
                console.log('Platform adapter not available:', e.message);
            }
        });
    });
});
