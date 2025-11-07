/**
 * Permission Monitor Service
 * Monitors macOS Accessibility permission status changes at runtime
 */

import { EventEmitter } from 'events';
import { logger } from '../utils';

export interface PermissionChecker {
  checkAccessibilityPermission(): Promise<{ granted: boolean; message: string }>;
}

/**
 * Service to monitor permission status changes
 * Emits events when permissions are granted or revoked
 */
export class PermissionMonitorService extends EventEmitter {
  private checkInterval?: NodeJS.Timeout;
  private lastPermissionState: boolean = false;
  private permissionChecker?: PermissionChecker;
  private isMonitoring: boolean = false;

  constructor(permissionChecker?: PermissionChecker) {
    super();
    this.permissionChecker = permissionChecker;
  }

  /**
   * Start monitoring permission status
   * @param intervalMs Check interval in milliseconds (default: 60000 = 1 minute)
   */
  async start(intervalMs: number = 60000): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('[PermissionMonitor] Already started');
      return;
    }

    // Initialize permission checker if not provided (macOS only)
    if (!this.permissionChecker && process.platform === 'darwin') {
      const { MacOSPermissionChecker } = await import('../../platforms/macos/permission-checker');
      this.permissionChecker = new MacOSPermissionChecker();
    }

    if (!this.permissionChecker) {
      logger.warn('[PermissionMonitor] No permission checker available for this platform');
      return;
    }

    // Get initial permission state
    try {
      const initialResult = await this.permissionChecker.checkAccessibilityPermission();
      this.lastPermissionState = initialResult.granted;
      logger.info(`[PermissionMonitor] Initial permission state: ${initialResult.granted ? 'granted' : 'not granted'}`);
    } catch (error) {
      logger.error('[PermissionMonitor] Failed to get initial permission state:', error);
    }

    // Start periodic checking
    this.checkInterval = setInterval(async () => {
      await this.checkPermissionChange();
    }, intervalMs);

    this.isMonitoring = true;
    logger.info(`[PermissionMonitor] Started monitoring with ${intervalMs}ms interval`);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      this.isMonitoring = false;
      logger.info('[PermissionMonitor] Stopped monitoring');
    }
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Check for permission changes
   */
  private async checkPermissionChange(): Promise<void> {
    if (!this.permissionChecker) {
      return;
    }

    try {
      const result = await this.permissionChecker.checkAccessibilityPermission();

      if (result.granted !== this.lastPermissionState) {
        const event = result.granted ? 'permission-granted' : 'permission-revoked';

        logger.info(`[PermissionMonitor] Permission status changed: ${this.lastPermissionState} → ${result.granted}`);
        this.emit(event, result);

        this.lastPermissionState = result.granted;
      }
    } catch (error) {
      logger.error('[PermissionMonitor] Permission check failed:', error);
    }
  }

  /**
   * Force an immediate permission check
   */
  async forceCheck(): Promise<void> {
    await this.checkPermissionChange();
  }

  /**
   * Get current permission state
   */
  getCurrentState(): boolean {
    return this.lastPermissionState;
  }
}

export default PermissionMonitorService;
