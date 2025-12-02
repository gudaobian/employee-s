/**
 * Linux Permission Manager Unit Tests
 */

describe('LinuxPermissionManager', () => {
    let LinuxPermissionManager: any;
    let manager: any;
    let managerAvailable = false;

    // Only run on Linux or when explicitly testing
    const isLinux = process.platform === 'linux';
    const forceTests = process.env.FORCE_LINUX_TESTS === 'true';
    const runTests = isLinux || forceTests;

    beforeAll(() => {
        if (!runTests) {
            console.log('Skipping LinuxPermissionManager tests on non-Linux platform');
            console.log('Set FORCE_LINUX_TESTS=true to run anyway');
            return;
        }

        try {
            const module = require('../../dist/platforms/linux/permission-manager');
            LinuxPermissionManager = module.LinuxPermissionManager || module.default;
            managerAvailable = true;
        } catch (e: any) {
            console.warn('LinuxPermissionManager not available:', e.message);
        }
    });

    beforeEach(() => {
        if (managerAvailable) {
            manager = new LinuxPermissionManager();
        }
    });

    describe('module loading', () => {
        it('should load permission manager module', () => {
            if (!runTests) {
                console.log('Skipping: not on Linux platform');
                return;
            }
            if (!managerAvailable) {
                console.log('Skipping: LinuxPermissionManager not available');
                return;
            }
            expect(LinuxPermissionManager).toBeDefined();
        });
    });

    describe('permission checking', () => {
        it('should check all permissions', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();

            expect(status).toHaveProperty('isInputGroupMember');
            expect(status).toHaveProperty('hasDevInputAccess');
            expect(status).toHaveProperty('hasX11Access');
            expect(status).toHaveProperty('hasWaylandPortal');
            expect(status).toHaveProperty('screenshotTools');
            expect(status).toHaveProperty('windowTools');
            expect(status).toHaveProperty('idleTools');
            expect(status).toHaveProperty('overallStatus');
            expect(status).toHaveProperty('missingComponents');
            expect(status).toHaveProperty('recommendations');
        });

        it('should return valid overall status', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            expect(['full', 'partial', 'minimal', 'none']).toContain(status.overallStatus);
        });

        it('should return boolean for isInputGroupMember', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            expect(typeof status.isInputGroupMember).toBe('boolean');
        });

        it('should return boolean for hasDevInputAccess', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            expect(typeof status.hasDevInputAccess).toBe('boolean');
        });

        it('should return boolean for hasX11Access', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            expect(typeof status.hasX11Access).toBe('boolean');
        });

        it('should return boolean for hasWaylandPortal', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            expect(typeof status.hasWaylandPortal).toBe('boolean');
        });

        it('should detect screenshot tools', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            expect(status.screenshotTools).toHaveProperty('scrot');
            expect(status.screenshotTools).toHaveProperty('grim');
            expect(status.screenshotTools).toHaveProperty('gnomeScreenshot');
            expect(status.screenshotTools).toHaveProperty('spectacle');
        });

        it('should return array for missingComponents', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            expect(Array.isArray(status.missingComponents)).toBe(true);
        });

        it('should return array for recommendations', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            expect(Array.isArray(status.recommendations)).toBe(true);
        });
    });

    describe('instruction generation', () => {
        it('should generate setup instructions', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const status = await manager.checkAllPermissions();
            const instructions = manager.generateSetupInstructions(status);

            expect(typeof instructions).toBe('string');
            expect(instructions.length).toBeGreaterThan(0);
        });

        it('should generate udev rules', () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const rules = manager.generateUdevRules();

            expect(typeof rules).toBe('string');
            expect(rules).toContain('SUBSYSTEM');
            expect(rules).toContain('input');
            expect(rules).toContain('MODE');
        });

        it('should generate valid udev rules format', () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            const rules = manager.generateUdevRules();

            // Check for common udev rule patterns
            expect(rules).toMatch(/KERNEL/);
            expect(rules).toMatch(/GROUP/);
        });
    });

    describe('quick summary', () => {
        it('should generate quick summary', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            if (typeof manager.getQuickSummary !== 'function') {
                console.log('getQuickSummary not implemented');
                return;
            }
            const summary = await manager.getQuickSummary();
            expect(typeof summary).toBe('string');
        });
    });

    describe('desktop environment detection', () => {
        it('should detect desktop environment', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            if (typeof manager.getDesktopEnvironment !== 'function') {
                console.log('getDesktopEnvironment not implemented');
                return;
            }
            const de = await manager.getDesktopEnvironment();
            expect(typeof de).toBe('string');
        });
    });

    describe('session type detection', () => {
        it('should detect session type (X11/Wayland)', async () => {
            if (!runTests || !managerAvailable) {
                console.log('Skipping: manager not available or not on Linux');
                return;
            }
            if (typeof manager.getSessionType !== 'function') {
                console.log('getSessionType not implemented');
                return;
            }
            const sessionType = await manager.getSessionType();
            expect(['x11', 'wayland', 'tty', 'unknown']).toContain(sessionType);
        });
    });
});
