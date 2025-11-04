/**
 * 电源事件服务单元测试
 */

import { EventEmitter } from 'events';

// Mock electron's powerMonitor before importing the service
const mockPowerMonitor = new EventEmitter();
jest.mock('electron', () => ({
  powerMonitor: mockPowerMonitor
}));

import { PowerEventService } from '../../common/services/power-event-service';

describe('PowerEventService', () => {
  let service: PowerEventService;

  beforeEach(() => {
    // Clear all listeners before each test
    mockPowerMonitor.removeAllListeners();

    // Create service instance
    service = new PowerEventService();
  });

  afterEach(() => {
    service.removeAllListeners();
  });

  describe('Event Listening', () => {
    it('should emit system-suspend event when system suspends', (done) => {
      service.on('system-suspend', (event) => {
        expect(event).toHaveProperty('timestamp');
        expect(event.timestamp).toBeGreaterThan(0);
        expect(typeof event.timestamp).toBe('number');
        done();
      });

      // Simulate system suspend
      mockPowerMonitor.emit('suspend');
    });

    it('should emit system-resume event when system resumes', (done) => {
      // First suspend
      mockPowerMonitor.emit('suspend');

      // Wait a bit, then resume
      setTimeout(() => {
        service.on('system-resume', (event) => {
          expect(event).toHaveProperty('timestamp');
          expect(event).toHaveProperty('suspendDuration');
          expect(event.timestamp).toBeGreaterThan(0);
          expect(event.suspendDuration).toBeGreaterThanOrEqual(0);
          done();
        });

        mockPowerMonitor.emit('resume');
      }, 100);
    });
  });

  describe('State Tracking', () => {
    it('should track suspend state correctly', () => {
      expect(service.isSystemSuspendedNow()).toBe(false);

      // Suspend
      mockPowerMonitor.emit('suspend');
      expect(service.isSystemSuspendedNow()).toBe(true);

      // Resume
      mockPowerMonitor.emit('resume');
      expect(service.isSystemSuspendedNow()).toBe(false);
    });

    it('should return 0 suspend duration when never suspended', () => {
      expect(service.getLastSuspendDuration()).toBe(0);
    });

    it('should calculate suspend duration after resume', (done) => {
      // Suspend
      mockPowerMonitor.emit('suspend');

      // Wait 100ms, then resume
      setTimeout(() => {
        mockPowerMonitor.emit('resume');

        // Check duration (should be approximately 100ms, allow some margin)
        const duration = service.getLastSuspendDuration();
        expect(duration).toBeGreaterThanOrEqual(50);
        expect(duration).toBeLessThan(200);
        done();
      }, 100);
    });
  });

  describe('Screen Lock Events', () => {
    it('should handle lock-screen event without errors', () => {
      expect(() => {
        mockPowerMonitor.emit('lock-screen');
      }).not.toThrow();
    });

    it('should handle unlock-screen event without errors', () => {
      expect(() => {
        mockPowerMonitor.emit('unlock-screen');
      }).not.toThrow();
    });
  });

  describe('Multiple Suspend/Resume Cycles', () => {
    it('should handle multiple suspend/resume cycles correctly', (done) => {
      let resumeCount = 0;

      service.on('system-resume', () => {
        resumeCount++;

        if (resumeCount === 3) {
          expect(service.isSystemSuspendedNow()).toBe(false);
          done();
        }
      });

      // Cycle 1
      mockPowerMonitor.emit('suspend');
      expect(service.isSystemSuspendedNow()).toBe(true);
      mockPowerMonitor.emit('resume');

      // Cycle 2
      mockPowerMonitor.emit('suspend');
      expect(service.isSystemSuspendedNow()).toBe(true);
      mockPowerMonitor.emit('resume');

      // Cycle 3
      mockPowerMonitor.emit('suspend');
      expect(service.isSystemSuspendedNow()).toBe(true);
      mockPowerMonitor.emit('resume');
    });
  });

  describe('Edge Cases', () => {
    it('should handle resume without prior suspend', () => {
      service.on('system-resume', (event) => {
        expect(event.suspendDuration).toBe(0);
      });

      mockPowerMonitor.emit('resume');
      expect(service.isSystemSuspendedNow()).toBe(false);
    });

    it('should handle multiple consecutive suspends', () => {
      mockPowerMonitor.emit('suspend');
      const firstTime = Date.now();

      // Wait a bit
      setTimeout(() => {
        mockPowerMonitor.emit('suspend');
        expect(service.isSystemSuspendedNow()).toBe(true);
      }, 50);
    });
  });
});
