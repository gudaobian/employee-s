/**
 * Integration tests for permission checking functionality
 * Tests both macOS and Windows permission checkers
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Import permission checkers
import { MacOSPermissionChecker } from '../../platforms/macos/permission-checker';
import { WindowsPermissionChecker } from '../../platforms/windows/permission-checker';

describe('Permission Check Integration Tests', () => {
  const platform = process.platform;

  describe('macOS Permission Checker', () => {
    // Only run macOS tests on Darwin platform
    const macOSTest = platform === 'darwin' ? it : it.skip;

    let permissionChecker: MacOSPermissionChecker;

    beforeEach(() => {
      permissionChecker = new MacOSPermissionChecker();
    });

    macOSTest('should detect accessibility permission status', async () => {
      const result = await permissionChecker.checkAccessibilityPermission();

      // Result should have the expected structure
      expect(result).toHaveProperty('granted');
      expect(result).toHaveProperty('message');
      expect(typeof result.granted).toBe('boolean');
      expect(typeof result.message).toBe('string');

      // Message should not be empty
      expect(result.message.length).toBeGreaterThan(0);
    });

    macOSTest('should return proper message structure', async () => {
      const result = await permissionChecker.checkAccessibilityPermission();

      // If permission denied, message should contain helpful info
      if (!result.granted) {
        expect(result.message).toContain('辅助功能权限');
        expect(result.message).toContain('系统偏好设置');
        expect(result.message).toContain('open');
      }
    });

    macOSTest('should handle permission denial gracefully', async () => {
      // This test ensures the checker doesn't crash on permission denial
      const result = await permissionChecker.checkAccessibilityPermission();

      // Should not throw an error, just return a result
      expect(result).toBeDefined();
    });

    macOSTest('should be able to call openAccessibilitySettings', async () => {
      // Note: This will actually try to open system preferences in CI
      // In a real test environment, you might want to mock this
      const canOpen = typeof permissionChecker.openAccessibilitySettings === 'function';
      expect(canOpen).toBe(true);
    });
  });

  describe('Windows Permission Checker', () => {
    // Only run Windows tests on win32 platform
    const windowsTest = platform === 'win32' ? it : it.skip;

    let permissionChecker: WindowsPermissionChecker;

    beforeEach(() => {
      permissionChecker = new WindowsPermissionChecker();
    });

    windowsTest('should detect UI Automation service availability', async () => {
      const result = await permissionChecker.checkUIAutomationAvailability();

      // Result should have the expected structure
      expect(result).toHaveProperty('available');
      expect(result).toHaveProperty('message');
      expect(typeof result.available).toBe('boolean');
      expect(typeof result.message).toBe('string');

      // Message should not be empty
      expect(result.message.length).toBeGreaterThan(0);
    });

    windowsTest('should return proper message structure', async () => {
      const result = await permissionChecker.checkUIAutomationAvailability();

      // If service unavailable, message should contain helpful info
      if (!result.available) {
        expect(result.message).toContain('UI Automation');
        expect(result.message).toContain('services.msc');
      }
    });

    windowsTest('should handle service unavailability gracefully', async () => {
      // This test ensures the checker doesn't crash on service unavailability
      const result = await permissionChecker.checkUIAutomationAvailability();

      // Should not throw an error, just return a result
      expect(result).toBeDefined();
    });

    windowsTest('should be able to check admin privileges', async () => {
      const isAdmin = await permissionChecker.checkAdminPrivileges();

      // Should return a boolean
      expect(typeof isAdmin).toBe('boolean');
    });

    windowsTest('should be able to call openServicesManager', async () => {
      const canOpen = typeof permissionChecker.openServicesManager === 'function';
      expect(canOpen).toBe(true);
    });
  });

  describe('Cross-platform Tests', () => {
    it('should not crash when importing permission checkers on any platform', () => {
      expect(() => new MacOSPermissionChecker()).not.toThrow();
      expect(() => new WindowsPermissionChecker()).not.toThrow();
    });

    it('should provide fallback behavior on unsupported platforms', async () => {
      // Even on wrong platform, checkers should not crash
      if (platform === 'linux') {
        const macChecker = new MacOSPermissionChecker();
        const winChecker = new WindowsPermissionChecker();

        // These might fail, but should not crash
        await expect(macChecker.checkAccessibilityPermission()).resolves.toBeDefined();
        await expect(winChecker.checkUIAutomationAvailability()).resolves.toBeDefined();
      }
    });
  });

  describe('Error Message Quality', () => {
    it('macOS error messages should be actionable', async () => {
      if (platform !== 'darwin') {
        return; // Skip if not on macOS
      }

      const checker = new MacOSPermissionChecker();
      const result = await checker.checkAccessibilityPermission();

      if (!result.granted) {
        // Check for actionable elements
        const message = result.message;

        // Should contain step-by-step instructions
        expect(message).toContain('1');
        expect(message).toContain('2');

        // Should contain quick command
        expect(message).toContain('open');
        expect(message).toContain('x-apple.systempreferences');
      }
    });

    it('Windows error messages should be actionable', async () => {
      if (platform !== 'win32') {
        return; // Skip if not on Windows
      }

      const checker = new WindowsPermissionChecker();
      const result = await checker.checkUIAutomationAvailability();

      if (!result.available) {
        // Check for actionable elements
        const message = result.message;

        // Should contain step-by-step instructions
        expect(message).toContain('1');
        expect(message).toContain('2');

        // Should mention service manager
        expect(message).toContain('services.msc');
      }
    });
  });

  describe('Performance Tests', () => {
    it('macOS permission check should complete within 2 seconds', async () => {
      if (platform !== 'darwin') {
        return;
      }

      const checker = new MacOSPermissionChecker();
      const startTime = Date.now();

      await checker.checkAccessibilityPermission();

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2000); // 2 seconds
    }, 3000); // Test timeout

    it('Windows permission check should complete within 3 seconds', async () => {
      if (platform !== 'win32') {
        return;
      }

      const checker = new WindowsPermissionChecker();
      const startTime = Date.now();

      await checker.checkUIAutomationAvailability();

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(3000); // 3 seconds
    }, 4000); // Test timeout
  });
});
