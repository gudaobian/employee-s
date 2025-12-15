/**
 * Tamper Detection Service
 * Monitors system permissions and detects when users attempt to bypass monitoring
 *
 * Key Features:
 * - Detects macOS accessibility permission revocation
 * - Detects Windows UI Automation service stoppage
 * - Event-driven architecture with tamper event emission
 * - Dedicated tamper.log file for audit trail
 * - Configurable check interval (default 30s)
 */

import { BaseService } from '../utils/base-service';
import { logger } from '../utils';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Tamper event types
 */
export interface TamperEvent {
  type: 'permission_revoked' | 'extension_removed' | 'service_stopped';
  platform: 'macos' | 'windows';
  timestamp: number;
  details: string;
}

/**
 * Tamper Detection Service Configuration
 */
export interface TamperDetectionConfig {
  /** Check interval in milliseconds (default: 30000ms = 30s) */
  intervalMs?: number;
  /** Enable/disable the service */
  enabled?: boolean;
  /** Log file directory (default: auto-detected) */
  logDir?: string;
}

/**
 * Permission status tracking
 */
interface PermissionStatus {
  macos: boolean;
  windows: boolean;
}

/**
 * Tamper Detection Service
 *
 * Monitors system permissions and detects tampering attempts.
 * Emits 'tamper' events when permission changes are detected.
 *
 * @example
 * ```typescript
 * const service = new TamperDetectionService();
 *
 * service.on('tamper', (event: TamperEvent) => {
 *   console.error('Tamper detected!', event);
 * });
 *
 * service.start(30000); // Check every 30s
 * ```
 */
export class TamperDetectionService extends BaseService {
  private monitorInterval: NodeJS.Timeout | null = null;
  private lastPermissionStatus: PermissionStatus;
  private config: Required<TamperDetectionConfig>;
  private logDir: string;
  private isFirstCheck: boolean = true;

  constructor(config: TamperDetectionConfig = {}) {
    super();

    // Default configuration
    this.config = {
      intervalMs: config.intervalMs ?? 30000,
      enabled: config.enabled ?? true,
      logDir: config.logDir ?? this.getDefaultLogDir()
    };

    this.logDir = this.config.logDir;
    this.ensureLogDirectory();

    // Initialize permission status (assume granted initially)
    this.lastPermissionStatus = {
      macos: true,
      windows: true
    };

    logger.info('[TamperDetection] Service created', {
      intervalMs: this.config.intervalMs,
      enabled: this.config.enabled,
      logDir: this.logDir
    });
  }

  /**
   * Start monitoring for tamper events
   *
   * @param intervalMs - Check interval in milliseconds (overrides config)
   */
  start(intervalMs?: number): void {
    if (this.monitorInterval) {
      logger.warn('[TamperDetection] Already running');
      return;
    }

    if (!this.config.enabled) {
      logger.warn('[TamperDetection] Service disabled, not starting');
      return;
    }

    const interval = intervalMs ?? this.config.intervalMs;
    logger.info(`[TamperDetection] Starting (interval: ${interval}ms)`);

    // Immediate first check (but don't alert on first check)
    this.checkPermissionStatus().catch(error => {
      logger.error('[TamperDetection] Initial check failed:', error);
    });

    // Schedule periodic checks
    this.monitorInterval = setInterval(async () => {
      try {
        await this.checkPermissionStatus();
      } catch (error) {
        logger.error('[TamperDetection] Periodic check failed:', error);
      }
    }, interval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      logger.info('[TamperDetection] Stopped');
    }
  }

  /**
   * Check if the service is running
   */
  isRunning(): boolean {
    return this.monitorInterval !== null;
  }

  /**
   * Get current permission status
   */
  getPermissionStatus(): PermissionStatus {
    return { ...this.lastPermissionStatus };
  }

  /**
   * Check permission status across platforms
   */
  private async checkPermissionStatus(): Promise<void> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        await this.checkMacOSPermissions();
      } else if (platform === 'win32') {
        await this.checkWindowsPermissions();
      } else {
        // Linux or other platforms - not supported yet
        logger.debug('[TamperDetection] Platform not supported:', platform);
      }
    } catch (error) {
      logger.error('[TamperDetection] Check failed:', error);
    }
  }

  /**
   * Check macOS accessibility permissions
   */
  private async checkMacOSPermissions(): Promise<void> {
    try {
      // Dynamic import to avoid loading platform-specific code on other platforms
      const { MacOSPermissionChecker } = await import('../../platforms/macos/permission-checker');
      const checker = new MacOSPermissionChecker();
      const status = await checker.checkAccessibilityPermission();

      // Detect transition: granted → revoked
      // Only alert if:
      // 1. Not the first check (avoid false positives on startup)
      // 2. Permission was previously granted
      // 3. Permission is now revoked
      if (!this.isFirstCheck && this.lastPermissionStatus.macos && !status.granted) {
        this.handleTamperEvent({
          type: 'permission_revoked',
          platform: 'macos',
          timestamp: Date.now(),
          details: 'Accessibility permission was revoked'
        });
      }

      // Update last status
      this.lastPermissionStatus.macos = status.granted;

      logger.debug('[TamperDetection] macOS permission check:', {
        granted: status.granted,
        isFirstCheck: this.isFirstCheck
      });
    } catch (error) {
      logger.error('[TamperDetection] macOS permission check failed:', error);
      // Don't update status on error - preserve last known state
    } finally {
      if (this.isFirstCheck) {
        this.isFirstCheck = false;
      }
    }
  }

  /**
   * Check Windows UI Automation service availability
   */
  private async checkWindowsPermissions(): Promise<void> {
    try {
      // Dynamic import to avoid loading platform-specific code on other platforms
      const { WindowsPermissionChecker } = await import('../../platforms/windows/permission-checker');
      const checker = new WindowsPermissionChecker();
      const status = await checker.checkUIAutomationAvailability();

      // Detect transition: available → unavailable
      // Only alert if:
      // 1. Not the first check
      // 2. Service was previously available
      // 3. Service is now unavailable
      if (!this.isFirstCheck && this.lastPermissionStatus.windows && !status.available) {
        this.handleTamperEvent({
          type: 'service_stopped',
          platform: 'windows',
          timestamp: Date.now(),
          details: 'UI Automation service became unavailable'
        });
      }

      // Update last status
      this.lastPermissionStatus.windows = status.available;

      logger.debug('[TamperDetection] Windows permission check:', {
        available: status.available,
        isFirstCheck: this.isFirstCheck
      });
    } catch (error) {
      logger.error('[TamperDetection] Windows permission check failed:', error);
      // Don't update status on error - preserve last known state
    } finally {
      if (this.isFirstCheck) {
        this.isFirstCheck = false;
      }
    }
  }

  /**
   * Handle tamper event detection
   *
   * @param event - Tamper event details
   */
  private handleTamperEvent(event: TamperEvent): void {
    logger.warn('[TamperDetection] Event detected:', event);

    // 1. Emit event for listeners
    this.emit('tamper', event);

    // 2. Log to tamper log file
    this.logTamperEvent(event);

    // 3. Optional: Send to server (future enhancement)
    // this.reportToServer(event).catch(() => {});
  }

  /**
   * Log tamper event to dedicated log file
   *
   * @param event - Tamper event to log
   */
  private logTamperEvent(event: TamperEvent): void {
    const logEntry = {
      timestamp: new Date(event.timestamp).toISOString(),
      type: event.type,
      platform: event.platform,
      details: event.details
    };

    // Write to dedicated tamper log file
    const logPath = path.join(this.logDir, 'tamper.log');
    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      // Ensure logs directory exists
      this.ensureLogDirectory();

      // Append to log file (synchronous to prevent race conditions)
      fs.appendFileSync(logPath, logLine, 'utf8');

      logger.info('[TamperDetection] Tamper event logged to file:', logPath);
    } catch (error) {
      logger.error('[TamperDetection] Failed to write log:', error);
    }
  }

  /**
   * Get default log directory based on platform
   */
  private getDefaultLogDir(): string {
    try {
      // Use same logic as main logger
      const os = require('os');
      const appDataDir = process.env.APPDATA ||
        path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Logs' : '.local/share');
      return path.join(appDataDir, 'employee-monitor', 'logs');
    } catch {
      // Fallback to current directory
      return path.join(process.cwd(), 'logs');
    }
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
        logger.debug('[TamperDetection] Created log directory:', this.logDir);
      }
    } catch (error) {
      logger.error('[TamperDetection] Failed to create log directory:', error);
    }
  }

  /**
   * Get tamper log file path
   */
  getTamperLogPath(): string {
    return path.join(this.logDir, 'tamper.log');
  }

  /**
   * Read tamper log entries (for debugging/reporting)
   *
   * @param limit - Maximum number of entries to return (default: all)
   * @returns Array of tamper log entries
   */
  async readTamperLog(limit?: number): Promise<any[]> {
    const logPath = this.getTamperLogPath();

    try {
      if (!fs.existsSync(logPath)) {
        return [];
      }

      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Parse JSON entries
      const entries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(entry => entry !== null);

      // Apply limit if specified
      if (limit && limit > 0) {
        return entries.slice(-limit); // Return last N entries
      }

      return entries;
    } catch (error) {
      logger.error('[TamperDetection] Failed to read tamper log:', error);
      return [];
    }
  }

  /**
   * Clear tamper log file
   */
  async clearTamperLog(): Promise<void> {
    const logPath = this.getTamperLogPath();

    try {
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
        logger.info('[TamperDetection] Tamper log cleared:', logPath);
      }
    } catch (error) {
      logger.error('[TamperDetection] Failed to clear tamper log:', error);
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    this.removeAllListeners();
    logger.info('[TamperDetection] Service destroyed');
  }
}

export default TamperDetectionService;
