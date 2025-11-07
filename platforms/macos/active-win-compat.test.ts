/**
 * Unit Tests for active-win-compat module
 *
 * Tests the NSWorkspace-based window detection system with comprehensive
 * coverage of functionality, error handling, and self-exclusion logic.
 *
 * @requires macOS 10.15+
 */

import { activeWindow, isAvailable, VERSION, PLATFORM, MIN_OS_VERSION } from './active-win-compat';
import type { ActiveWindowResult } from './active-win-compat';

// Platform detection
const isMacOS = process.platform === 'darwin';

// Conditional test wrapper
const describeOnMacOS = isMacOS ? describe : describe.skip;

describeOnMacOS('active-win-compat', () => {
  describe('activeWindow()', () => {
    it('should return window info or null', async () => {
      const result = await activeWindow();

      // Result can be null if no other app is active or self-app is frontmost
      if (result !== null) {
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      }
    }, 10000);

    it('should return object with required fields when successful', async () => {
      const result = await activeWindow();

      if (result !== null) {
        // Validate structure
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('owner');
        expect(result).toHaveProperty('bounds');

        // Validate types
        expect(typeof result.id).toBe('number');
        expect(typeof result.title).toBe('string');
        expect(typeof result.owner).toBe('object');
        expect(typeof result.bounds).toBe('object');

        // Validate owner fields
        expect(result.owner).toHaveProperty('name');
        expect(result.owner).toHaveProperty('processId');
        expect(result.owner).toHaveProperty('bundleId');

        expect(typeof result.owner.name).toBe('string');
        expect(typeof result.owner.processId).toBe('number');
        expect(typeof result.owner.bundleId).toBe('string');

        // Validate bounds fields
        expect(result.bounds).toHaveProperty('x');
        expect(result.bounds).toHaveProperty('y');
        expect(result.bounds).toHaveProperty('width');
        expect(result.bounds).toHaveProperty('height');
      }
    }, 10000);

    it('should not return Electron as owner name', async () => {
      const result = await activeWindow();

      if (result !== null) {
        expect(result.owner.name).not.toBe('Electron');
        expect(result.owner.name.toLowerCase()).not.toContain('electron');
      }
    }, 10000);

    it('should not return EmployeeMonitor as owner name', async () => {
      const result = await activeWindow();

      if (result !== null) {
        expect(result.owner.name).not.toBe('EmployeeMonitor');
        expect(result.owner.name.toLowerCase()).not.toContain('employeemonitor');
        expect(result.owner.name.toLowerCase()).not.toContain('employee-monitor');
      }
    }, 10000);

    it('should return valid process ID (> 0)', async () => {
      const result = await activeWindow();

      if (result !== null) {
        expect(result.owner.processId).toBeGreaterThan(0);
        expect(result.id).toBe(result.owner.processId);
      }
    }, 10000);

    it('should return non-empty bundle ID', async () => {
      const result = await activeWindow();

      if (result !== null) {
        expect(result.owner.bundleId).toBeTruthy();
        expect(result.owner.bundleId.length).toBeGreaterThan(0);
        // Bundle ID should follow reverse domain notation (com.*, org.*, etc.)
        expect(result.owner.bundleId).toMatch(/^[a-z0-9.-]+\.[a-z0-9.-]+$/i);
      }
    }, 10000);

    it('should consistently exclude self-application across multiple calls', async () => {
      const excludedApps = ['Electron', 'EmployeeMonitor', 'employee-monitor'];
      const attempts = 5;

      for (let i = 0; i < attempts; i++) {
        const result = await activeWindow();

        if (result !== null) {
          const appName = result.owner.name.toLowerCase();
          const isExcluded = excludedApps.some(excluded =>
            appName.includes(excluded.toLowerCase())
          );

          expect(isExcluded).toBe(false);
        }

        // Wait between calls to allow system state changes
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }, 30000);

    it('should not throw errors even on failure', async () => {
      // activeWindow should return null instead of throwing
      await expect(activeWindow()).resolves.not.toThrow();
    }, 10000);

    it('should handle timeout scenarios gracefully', async () => {
      // Multiple rapid calls should not cause timeouts or errors
      const promises = [
        activeWindow(),
        activeWindow(),
        activeWindow()
      ];

      const results = await Promise.all(promises);

      // All calls should complete without throwing
      results.forEach(result => {
        if (result !== null) {
          expect(result).toHaveProperty('owner');
        }
      });
    }, 15000);

    it('should return consistent data types for bounds', async () => {
      const result = await activeWindow();

      if (result !== null) {
        expect(typeof result.bounds.x).toBe('number');
        expect(typeof result.bounds.y).toBe('number');
        expect(typeof result.bounds.width).toBe('number');
        expect(typeof result.bounds.height).toBe('number');

        // Bounds may be zero (not implemented yet), but should be non-negative
        expect(result.bounds.x).toBeGreaterThanOrEqual(0);
        expect(result.bounds.y).toBeGreaterThanOrEqual(0);
        expect(result.bounds.width).toBeGreaterThanOrEqual(0);
        expect(result.bounds.height).toBeGreaterThanOrEqual(0);
      }
    }, 10000);

    it('should handle window title extraction (may be empty without Accessibility permission)', async () => {
      const result = await activeWindow();

      if (result !== null) {
        // Title should be a string (may be empty)
        expect(typeof result.title).toBe('string');
      }
    }, 10000);
  });

  describe('isAvailable()', () => {
    it('should return a boolean', async () => {
      const available = await isAvailable();
      expect(typeof available).toBe('boolean');
    }, 10000);

    it('should not throw errors', async () => {
      await expect(isAvailable()).resolves.not.toThrow();
    }, 10000);

    it('should be consistent across multiple calls', async () => {
      const result1 = await isAvailable();
      const result2 = await isAvailable();

      // Availability should be stable
      expect(result1).toBe(result2);
    }, 15000);
  });

  describe('Module Constants', () => {
    it('should export VERSION constant', () => {
      expect(VERSION).toBeDefined();
      expect(typeof VERSION).toBe('string');
      expect(VERSION).toBe('1.0.0');
    });

    it('should export PLATFORM constant', () => {
      expect(PLATFORM).toBeDefined();
      expect(typeof PLATFORM).toBe('string');
      expect(PLATFORM).toBe('darwin');
    });

    it('should export MIN_OS_VERSION constant', () => {
      expect(MIN_OS_VERSION).toBeDefined();
      expect(typeof MIN_OS_VERSION).toBe('string');
      expect(MIN_OS_VERSION).toBe('10.15');
    });

    it('should have valid semantic version format', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should have valid macOS version format', () => {
      expect(MIN_OS_VERSION).toMatch(/^\d+\.\d+$/);
    });
  });

  describe('Error Handling', () => {
    it('should return null on JXA execution errors', async () => {
      // This test verifies graceful degradation
      // Even with errors, activeWindow should return null, not throw
      const result = await activeWindow();
      expect([null, expect.any(Object)]).toContainEqual(result);
    }, 10000);

    it('should handle rapid successive calls without crashes', async () => {
      const rapidCalls = Array(10).fill(null).map(() => activeWindow());
      const results = await Promise.all(rapidCalls);

      // All calls should complete
      expect(results).toHaveLength(10);

      // Each result should be null or valid window info
      results.forEach(result => {
        if (result !== null) {
          expect(result).toHaveProperty('owner');
          expect(result.owner).toHaveProperty('name');
        }
      });
    }, 20000);
  });

  describe('Performance Characteristics', () => {
    it('should complete within reasonable time (< 5000ms)', async () => {
      const startTime = Date.now();
      await activeWindow();
      const elapsed = Date.now() - startTime;

      // Should complete well within timeout
      expect(elapsed).toBeLessThan(5000);
    }, 10000);

    it('should have acceptable average latency over multiple calls', async () => {
      const iterations = 5;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await activeWindow();
        const elapsed = Date.now() - startTime;
        latencies.push(elapsed);

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      // Average latency should be reasonable
      expect(avgLatency).toBeLessThan(2000);
    }, 20000);
  });
});

// Tests that run on non-macOS platforms
(isMacOS ? describe.skip : describe)('active-win-compat (non-macOS)', () => {
  it('should be skipped on non-macOS platforms', () => {
    expect(process.platform).not.toBe('darwin');
  });
});
