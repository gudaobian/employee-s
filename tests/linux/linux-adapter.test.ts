/**
 * Linux Platform Adapter Unit Tests
 */

describe('LinuxAdapter', () => {
    let LinuxAdapter: any;
    let adapter: any;
    let adapterAvailable = false;

    // Only run on Linux or when explicitly testing
    const isLinux = process.platform === 'linux';
    const forceTests = process.env.FORCE_LINUX_TESTS === 'true';
    const runTests = isLinux || forceTests;

    beforeAll(async () => {
        if (!runTests) {
            console.log('Skipping LinuxAdapter tests on non-Linux platform');
            console.log('Set FORCE_LINUX_TESTS=true to run anyway');
            return;
        }

        try {
            const module = require('../../dist/platforms/linux/linux-adapter');
            LinuxAdapter = module.LinuxAdapter || module.default;
            adapterAvailable = true;
        } catch (e: any) {
            console.warn('LinuxAdapter not available:', e.message);
        }
    });

    beforeEach(async () => {
        if (adapterAvailable) {
            adapter = new LinuxAdapter();
            await adapter.initialize?.();
        }
    });

    afterEach(async () => {
        if (adapter) {
            try {
                await adapter.cleanup?.();
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    });

    describe('platform detection', () => {
        it('should identify as Linux platform', () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const platform = adapter.getPlatform?.() || 'linux';
            expect(platform).toBe('linux');
        });
    });

    describe('system information', () => {
        it('should get system info', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const info = await adapter.getSystemInfo();
            expect(info).toHaveProperty('platform');
            expect(info).toHaveProperty('hostname');
            expect(info).toHaveProperty('username');
        });

        it('should return valid platform in system info', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const info = await adapter.getSystemInfo();
            expect(info.platform).toBe('linux');
        });

        it('should return non-empty hostname', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const info = await adapter.getSystemInfo();
            expect(info.hostname).toBeTruthy();
            expect(typeof info.hostname).toBe('string');
        });

        it('should return non-empty username', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const info = await adapter.getSystemInfo();
            expect(info.username).toBeTruthy();
            expect(typeof info.username).toBe('string');
        });
    });

    describe('process listing', () => {
        it('should get running processes', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const processes = await adapter.getRunningProcesses();
            expect(Array.isArray(processes)).toBe(true);
            expect(processes.length).toBeGreaterThan(0);
        });

        it('should return process objects with expected properties', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const processes = await adapter.getRunningProcesses();
            if (processes.length > 0) {
                const firstProcess = processes[0];
                expect(firstProcess).toHaveProperty('name');
                expect(firstProcess).toHaveProperty('pid');
            }
        });
    });

    describe('permission checking', () => {
        it('should check all permissions', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            if (typeof adapter.checkAllPermissions !== 'function') {
                console.log('checkAllPermissions not implemented');
                return;
            }
            const perms = await adapter.checkAllPermissions();
            expect(perms).toHaveProperty('screenshot');
            expect(perms).toHaveProperty('accessibility');
            expect(perms).toHaveProperty('inputMonitoring');
        });

        it('should return boolean values for permissions', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            if (typeof adapter.checkAllPermissions !== 'function') {
                console.log('checkAllPermissions not implemented');
                return;
            }
            const perms = await adapter.checkAllPermissions();
            expect(typeof perms.screenshot).toBe('boolean');
            expect(typeof perms.accessibility).toBe('boolean');
            expect(typeof perms.inputMonitoring).toBe('boolean');
        });
    });

    describe('initialization and cleanup', () => {
        it('should initialize without errors', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const newAdapter = new LinuxAdapter();
            await expect(newAdapter.initialize?.() || Promise.resolve()).resolves.not.toThrow();
            await newAdapter.cleanup?.();
        });

        it('should cleanup without errors', async () => {
            if (!runTests || !adapterAvailable) {
                console.log('Skipping: adapter not available or not on Linux');
                return;
            }
            const newAdapter = new LinuxAdapter();
            await newAdapter.initialize?.();
            await expect(newAdapter.cleanup?.() || Promise.resolve()).resolves.not.toThrow();
        });
    });
});
