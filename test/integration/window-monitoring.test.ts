/**
 * Integration Tests for Window Monitoring System
 *
 * Tests the integration between active-win-compat and MacOSAdapter,
 * verifying end-to-end window monitoring functionality, stability,
 * and fallback mechanisms.
 *
 * @requires macOS 10.15+
 */

import { MacOSAdapter } from '../../platforms/macos/macos-adapter';
import { activeWindow } from '../../platforms/macos/active-win-compat';
import type { WindowInfo } from '../../common/interfaces/platform-interface';

// Platform detection
const isMacOS = process.platform === 'darwin';
const describeOnMacOS = isMacOS ? describe : describe.skip;

describeOnMacOS('Window Monitoring Integration', () => {
  let adapter: MacOSAdapter;

  beforeAll(async () => {
    // Initialize adapter
    adapter = new MacOSAdapter();
    await adapter.initialize();
  }, 30000);

  afterAll(async () => {
    // Cleanup adapter
    if (adapter) {
      await adapter.cleanup();
    }
  }, 10000);

  describe('MacOSAdapter Integration', () => {
    it('should successfully initialize adapter', () => {
      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(MacOSAdapter);
    });

    it('should get active window information via getActiveWindow()', async () => {
      const windowInfo = await adapter.getActiveWindow();

      expect(windowInfo).toBeDefined();
      expect(windowInfo).toHaveProperty('application');
      expect(windowInfo).toHaveProperty('processId');

      expect(typeof windowInfo.application).toBe('string');
      expect(typeof windowInfo.processId).toBe('number');
    }, 15000);

    it('should not return Electron as application name', async () => {
      const windowInfo = await adapter.getActiveWindow();

      expect(windowInfo.application).not.toBe('Electron');
      expect(windowInfo.application.toLowerCase()).not.toContain('electron');
    }, 15000);

    it('should not return EmployeeMonitor as application name', async () => {
      const windowInfo = await adapter.getActiveWindow();

      expect(windowInfo.application).not.toBe('EmployeeMonitor');
      expect(windowInfo.application.toLowerCase()).not.toContain('employeemonitor');
      expect(windowInfo.application.toLowerCase()).not.toContain('employee-monitor');
    }, 15000);

    it('should return valid process ID', async () => {
      const windowInfo = await adapter.getActiveWindow();

      expect(windowInfo.processId).toBeGreaterThan(0);
    }, 15000);

    it('should return WindowInfo with expected structure', async () => {
      const windowInfo = await adapter.getActiveWindow();

      // Validate WindowInfo interface compliance
      expect(windowInfo).toHaveProperty('application');
      expect(windowInfo).toHaveProperty('processId');

      expect(typeof windowInfo.application).toBe('string');
      expect(typeof windowInfo.processId).toBe('number');
    }, 15000);
  });

  describe('Continuous Operation Stability', () => {
    it('should work continuously without degradation (10 iterations)', async () => {
      const iterations = 10;
      const results: WindowInfo[] = [];

      for (let i = 0; i < iterations; i++) {
        const windowInfo = await adapter.getActiveWindow();

        // Validate each result
        expect(windowInfo).toBeDefined();
        expect(windowInfo.application).not.toBe('Electron');
        expect(windowInfo.application.toLowerCase()).not.toContain('employeemonitor');
        expect(windowInfo.processId).toBeGreaterThan(0);

        results.push(windowInfo);

        // Wait 1 second between calls
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // All iterations should complete successfully
      expect(results).toHaveLength(iterations);
      results.forEach(result => {
        expect(result).toHaveProperty('application');
      });
    }, 60000);

    it('should maintain performance across multiple calls', async () => {
      const iterations = 5;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await adapter.getActiveWindow();
        const elapsed = Date.now() - startTime;

        latencies.push(elapsed);

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Calculate average latency
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      // Average latency should be reasonable (< 2 seconds)
      expect(avgLatency).toBeLessThan(2000);

      // No single call should take too long (< 5 seconds)
      latencies.forEach(latency => {
        expect(latency).toBeLessThan(5000);
      });
    }, 30000);

    it('should not have memory leaks during continuous operation', async () => {
      const iterations = 20;
      const memorySnapshots: number[] = [];

      // Take initial memory snapshot
      if (global.gc) global.gc();
      const initialMemory = process.memoryUsage().heapUsed;
      memorySnapshots.push(initialMemory);

      // Run iterations
      for (let i = 0; i < iterations; i++) {
        await adapter.getActiveWindow();

        // Take periodic memory snapshots
        if (i % 5 === 0) {
          if (global.gc) global.gc();
          memorySnapshots.push(process.memoryUsage().heapUsed);
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Take final memory snapshot
      if (global.gc) global.gc();
      const finalMemory = process.memoryUsage().heapUsed;
      memorySnapshots.push(finalMemory);

      // Memory growth should be minimal (< 10MB)
      const memoryGrowth = finalMemory - initialMemory;
      const memoryGrowthMB = memoryGrowth / 1024 / 1024;

      expect(memoryGrowthMB).toBeLessThan(10);
    }, 60000);
  });

  describe('Direct active-win-compat Integration', () => {
    it('should use active-win-compat module correctly', async () => {
      const result = await activeWindow();

      // Result may be null if only Electron/EmployeeMonitor is running
      if (result !== null) {
        expect(result).toHaveProperty('owner');
        expect(result.owner).toHaveProperty('name');
        expect(result.owner).toHaveProperty('processId');
        expect(result.owner).toHaveProperty('bundleId');

        // Should exclude self-application
        expect(result.owner.name).not.toBe('Electron');
        expect(result.owner.name.toLowerCase()).not.toContain('employeemonitor');
      }
    }, 15000);

    it('should provide consistent data between active-win-compat and adapter', async () => {
      const directResult = await activeWindow();
      const adapterResult = await adapter.getActiveWindow();

      if (directResult !== null) {
        // Process IDs should match
        expect(adapterResult.processId).toBe(directResult.owner.processId);

        // Application names should match
        expect(adapterResult.application).toBe(directResult.owner.name);
      }
    }, 20000);
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle rapid successive calls without errors', async () => {
      const rapidCalls = Array(10).fill(null).map(() => adapter.getActiveWindow());
      const results = await Promise.all(rapidCalls);

      // All calls should complete
      expect(results).toHaveLength(10);

      // Each result should be valid
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.processId).toBeGreaterThan(0);
      });
    }, 30000);

    it('should recover from temporary failures', async () => {
      let successCount = 0;
      const iterations = 5;

      for (let i = 0; i < iterations; i++) {
        try {
          const result = await adapter.getActiveWindow();
          if (result && result.processId > 0) {
            successCount++;
          }
        } catch (error) {
          // Continue even if individual calls fail
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // At least 80% success rate
      expect(successCount).toBeGreaterThanOrEqual(iterations * 0.8);
    }, 30000);
  });

  describe('Platform Capabilities', () => {
    it('should have required adapter methods', () => {
      expect(typeof adapter.getActiveWindow).toBe('function');
      expect(typeof adapter.initialize).toBe('function');
      expect(typeof adapter.cleanup).toBe('function');
    });

    it('should identify as macOS platform', () => {
      expect(process.platform).toBe('darwin');
    });
  });
});

// Tests for non-macOS platforms
(isMacOS ? describe.skip : describe)('Window Monitoring (non-macOS)', () => {
  it('should skip on non-macOS platforms', () => {
    expect(process.platform).not.toBe('darwin');
  });
});
