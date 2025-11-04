/**
 * Integration tests for Tamper Detection Service
 * Tests service lifecycle, event emission, and logging functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { TamperDetectionService, TamperEvent } from '../../common/services/tamper-detection-service';

// Mock the permission checkers to simulate state changes
jest.mock('../../platforms/macos/permission-checker');
jest.mock('../../platforms/windows/permission-checker');

import { MacOSPermissionChecker } from '../../platforms/macos/permission-checker';
import { WindowsPermissionChecker } from '../../platforms/windows/permission-checker';

describe('Tamper Detection Service Integration Tests', () => {
  let service: TamperDetectionService;
  let testLogDir: string;

  beforeEach(() => {
    // Create temporary log directory for tests
    testLogDir = path.join(process.cwd(), 'test-logs-' + Date.now());

    // Create service with test log directory
    service = new TamperDetectionService({
      intervalMs: 1000, // 1 second for faster tests
      enabled: true,
      logDir: testLogDir
    });

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Stop service
    if (service && service.isRunning()) {
      service.stop();
    }

    // Clean up service
    if (service) {
      service.destroy();
    }

    // Clean up test log directory
    try {
      if (fs.existsSync(testLogDir)) {
        const files = fs.readdirSync(testLogDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(testLogDir, file));
        });
        fs.rmdirSync(testLogDir);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Service Lifecycle', () => {
    it('should start monitoring', () => {
      expect(service.isRunning()).toBe(false);

      service.start(1000);

      expect(service.isRunning()).toBe(true);
    });

    it('should stop monitoring', () => {
      service.start(1000);
      expect(service.isRunning()).toBe(true);

      service.stop();

      expect(service.isRunning()).toBe(false);
    });

    it('should not double-start', () => {
      service.start(1000);
      expect(service.isRunning()).toBe(true);

      // Try to start again
      service.start(1000);

      // Should still be running (not crashed)
      expect(service.isRunning()).toBe(true);
    });

    it('should handle stop when not running', () => {
      expect(service.isRunning()).toBe(false);

      // Should not throw
      expect(() => service.stop()).not.toThrow();

      expect(service.isRunning()).toBe(false);
    });
  });

  describe('Permission Detection - macOS', () => {
    beforeEach(() => {
      // Only run these tests on macOS or mock the platform
      if (process.platform !== 'darwin') {
        // Mock platform to be darwin
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }
    });

    it('should detect macOS permission revocation', async () => {
      // Mock permission checker to simulate granted → revoked
      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;

      let callCount = 0;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockImplementation(async () => {
        callCount++;
        // First call: granted (initial state)
        // Second call: revoked (tamper detected)
        return {
          granted: callCount === 1,
          message: callCount === 1 ? 'Permission granted' : 'Permission revoked'
        };
      });

      let tamperDetected = false;
      let detectedEvent: TamperEvent | null = null;

      service.on('tamper', (event: TamperEvent) => {
        tamperDetected = true;
        detectedEvent = event;
      });

      service.start(500); // Check every 500ms

      // Wait for detection (allow time for first check + second check)
      await new Promise(resolve => setTimeout(resolve, 1500));

      service.stop();

      // Verify tamper was detected
      expect(tamperDetected).toBe(true);
      expect(detectedEvent).not.toBeNull();
      expect(detectedEvent?.type).toBe('permission_revoked');
      expect(detectedEvent?.platform).toBe('macos');
    }, 3000);

    it('should NOT trigger on first check', async () => {
      // Mock permission checker to return revoked from the start
      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;

      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockResolvedValue({
        granted: false,
        message: 'Permission not granted'
      });

      let tamperDetected = false;

      service.on('tamper', () => {
        tamperDetected = true;
      });

      service.start(500);

      // Wait for initial check
      await new Promise(resolve => setTimeout(resolve, 800));

      service.stop();

      // Should NOT have triggered (first check is baseline)
      expect(tamperDetected).toBe(false);
    }, 2000);
  });

  describe('Permission Detection - Windows', () => {
    beforeEach(() => {
      // Mock platform to be Windows
      if (process.platform !== 'win32') {
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          configurable: true
        });
      }
    });

    it('should detect Windows UI Automation service stop', async () => {
      // Mock permission checker to simulate available → unavailable
      const mockChecker = WindowsPermissionChecker as jest.MockedClass<typeof WindowsPermissionChecker>;

      let callCount = 0;
      mockChecker.prototype.checkUIAutomationAvailability = jest.fn().mockImplementation(async () => {
        callCount++;
        // First call: available (initial state)
        // Second call: unavailable (tamper detected)
        return {
          available: callCount === 1,
          message: callCount === 1 ? 'Service available' : 'Service unavailable'
        };
      });

      let tamperDetected = false;
      let detectedEvent: TamperEvent | null = null;

      service.on('tamper', (event: TamperEvent) => {
        tamperDetected = true;
        detectedEvent = event;
      });

      service.start(500);

      // Wait for detection
      await new Promise(resolve => setTimeout(resolve, 1500));

      service.stop();

      // Verify tamper was detected
      expect(tamperDetected).toBe(true);
      expect(detectedEvent).not.toBeNull();
      expect(detectedEvent?.type).toBe('service_stopped');
      expect(detectedEvent?.platform).toBe('windows');
    }, 3000);
  });

  describe('Event Emission', () => {
    it('should emit tamper events with correct structure', async () => {
      // Setup mock for macOS
      if (process.platform !== 'darwin') {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }

      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;
      let callCount = 0;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockImplementation(async () => {
        callCount++;
        return {
          granted: callCount === 1,
          message: 'Test message'
        };
      });

      let receivedEvent: TamperEvent | null = null;

      service.on('tamper', (event: TamperEvent) => {
        receivedEvent = event;
      });

      service.start(500);
      await new Promise(resolve => setTimeout(resolve, 1500));
      service.stop();

      // Verify event structure
      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent).toHaveProperty('type');
      expect(receivedEvent).toHaveProperty('platform');
      expect(receivedEvent).toHaveProperty('timestamp');
      expect(receivedEvent).toHaveProperty('details');

      expect(typeof receivedEvent?.timestamp).toBe('number');
      expect(typeof receivedEvent?.details).toBe('string');
    }, 3000);

    it('should support multiple event listeners', async () => {
      // Setup mock
      if (process.platform !== 'darwin') {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }

      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;
      let callCount = 0;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockImplementation(async () => {
        callCount++;
        return { granted: callCount === 1, message: 'Test' };
      });

      let listener1Called = false;
      let listener2Called = false;

      service.on('tamper', () => { listener1Called = true; });
      service.on('tamper', () => { listener2Called = true; });

      service.start(500);
      await new Promise(resolve => setTimeout(resolve, 1500));
      service.stop();

      expect(listener1Called).toBe(true);
      expect(listener2Called).toBe(true);
    }, 3000);
  });

  describe('Log File Operations', () => {
    it('should create tamper.log file', async () => {
      // Setup mock to trigger tamper event
      if (process.platform !== 'darwin') {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }

      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;
      let callCount = 0;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockImplementation(async () => {
        callCount++;
        return { granted: callCount === 1, message: 'Test' };
      });

      service.start(500);
      await new Promise(resolve => setTimeout(resolve, 1500));
      service.stop();

      const logPath = service.getTamperLogPath();
      expect(fs.existsSync(logPath)).toBe(true);
    }, 3000);

    it('should write tamper events to log file', async () => {
      // Setup mock
      if (process.platform !== 'darwin') {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }

      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;
      let callCount = 0;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockImplementation(async () => {
        callCount++;
        return { granted: callCount === 1, message: 'Test' };
      });

      service.start(500);
      await new Promise(resolve => setTimeout(resolve, 1500));
      service.stop();

      const logs = await service.readTamperLog();
      expect(logs.length).toBeGreaterThan(0);

      const firstLog = logs[0];
      expect(firstLog).toHaveProperty('timestamp');
      expect(firstLog).toHaveProperty('type');
      expect(firstLog).toHaveProperty('platform');
      expect(firstLog).toHaveProperty('details');
    }, 3000);

    it('should clear tamper log', async () => {
      // Setup mock to create log entry
      if (process.platform !== 'darwin') {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }

      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;
      let callCount = 0;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockImplementation(async () => {
        callCount++;
        return { granted: callCount === 1, message: 'Test' };
      });

      service.start(500);
      await new Promise(resolve => setTimeout(resolve, 1500));
      service.stop();

      // Verify log exists
      const logsBeforeClear = await service.readTamperLog();
      expect(logsBeforeClear.length).toBeGreaterThan(0);

      // Clear log
      await service.clearTamperLog();

      // Verify log is empty
      const logsAfterClear = await service.readTamperLog();
      expect(logsAfterClear.length).toBe(0);
    }, 3000);
  });

  describe('Performance', () => {
    it('should complete permission check in <1 second', async () => {
      // Setup mock
      if (process.platform !== 'darwin') {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }

      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockResolvedValue({
        granted: true,
        message: 'Granted'
      });

      const startTime = Date.now();

      service.start(100);
      await new Promise(resolve => setTimeout(resolve, 200)); // Wait for first check
      service.stop();

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should complete in <1s
    }, 2000);

    it('should not block event loop', async () => {
      service.start(100);

      // Perform other operations while service is running
      let operationsCompleted = 0;

      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        operationsCompleted++;
      }

      service.stop();

      // All operations should have completed
      expect(operationsCompleted).toBe(10);
    }, 2000);
  });

  describe('Error Handling', () => {
    it('should handle permission check errors gracefully', async () => {
      // Setup mock to throw error
      if (process.platform !== 'darwin') {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }

      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockRejectedValue(
        new Error('Permission check failed')
      );

      // Should not throw
      expect(() => service.start(500)).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 800));

      // Should still be running
      expect(service.isRunning()).toBe(true);

      service.stop();
    }, 2000);
  });

  describe('Configuration', () => {
    it('should respect disabled configuration', () => {
      const disabledService = new TamperDetectionService({
        enabled: false,
        logDir: testLogDir
      });

      disabledService.start();

      // Should not start when disabled
      expect(disabledService.isRunning()).toBe(false);

      disabledService.destroy();
    });

    it('should respect custom interval', async () => {
      // Setup mock
      if (process.platform !== 'darwin') {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      }

      const mockChecker = MacOSPermissionChecker as jest.MockedClass<typeof MacOSPermissionChecker>;
      let checkCount = 0;
      mockChecker.prototype.checkAccessibilityPermission = jest.fn().mockImplementation(async () => {
        checkCount++;
        return { granted: true, message: 'Granted' };
      });

      const customInterval = 200; // 200ms
      service.start(customInterval);

      await new Promise(resolve => setTimeout(resolve, 500));

      service.stop();

      // Should have performed ~2-3 checks (500ms / 200ms)
      expect(checkCount).toBeGreaterThanOrEqual(2);
      expect(checkCount).toBeLessThanOrEqual(4);
    }, 2000);
  });
});
