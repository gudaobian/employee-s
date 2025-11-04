/**
 * Memory Monitor Utility
 * Provides utilities for monitoring and managing memory usage
 */

export interface MemoryUsage {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
}

export type MemoryStatus = 'normal' | 'warning' | 'critical';

/**
 * Memory thresholds in MB
 */
const MEMORY_THRESHOLDS = {
  WARNING: 200,   // Warning threshold
  CRITICAL: 300   // Critical threshold
};

/**
 * ANSI color codes for console output
 */
const COLORS = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  CYAN: '\x1b[36m'
};

export class MemoryMonitor {
  /**
   * Get current memory usage in MB
   */
  static getMemoryUsage(): MemoryUsage {
    const memUsage = process.memoryUsage();

    return {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
      externalMB: Math.round(memUsage.external / 1024 / 1024)
    };
  }

  /**
   * Check memory threshold status
   * Returns 'normal', 'warning', or 'critical' based on heap usage
   */
  static checkMemoryThreshold(): MemoryStatus {
    const { heapUsedMB } = this.getMemoryUsage();

    if (heapUsedMB >= MEMORY_THRESHOLDS.CRITICAL) {
      return 'critical';
    } else if (heapUsedMB >= MEMORY_THRESHOLDS.WARNING) {
      return 'warning';
    }

    return 'normal';
  }

  /**
   * Manually trigger garbage collection if available
   * Returns true if GC was triggered, false if not available
   */
  static triggerGC(): boolean {
    if (global.gc) {
      const beforeGC = this.getMemoryUsage();
      global.gc();
      const afterGC = this.getMemoryUsage();

      console.log(`[MEMORY] GC triggered: ${beforeGC.heapUsedMB}MB → ${afterGC.heapUsedMB}MB (freed ${beforeGC.heapUsedMB - afterGC.heapUsedMB}MB)`);

      return true;
    }

    console.warn('[MEMORY] ⚠️ GC not available. Start with --expose-gc flag');
    return false;
  }

  /**
   * Log memory usage with color indicators
   * @param context Context string to identify where the log is from
   */
  static logMemoryUsage(context: string = 'MEMORY'): void {
    const memUsage = this.getMemoryUsage();
    const status = this.checkMemoryThreshold();

    // Select color based on status
    let statusColor = COLORS.GREEN;
    let statusEmoji = '✅';

    if (status === 'warning') {
      statusColor = COLORS.YELLOW;
      statusEmoji = '⚠️';
    } else if (status === 'critical') {
      statusColor = COLORS.RED;
      statusEmoji = '🚨';
    }

    const statusText = status.toUpperCase();

    console.log(
      `${COLORS.CYAN}[${context}]${COLORS.RESET} ${statusEmoji} Memory: ` +
      `Heap=${statusColor}${memUsage.heapUsedMB}MB${COLORS.RESET}/${memUsage.heapTotalMB}MB | ` +
      `RSS=${memUsage.rssMB}MB | ` +
      `External=${memUsage.externalMB}MB | ` +
      `Status=${statusColor}${statusText}${COLORS.RESET}`
    );
  }

  /**
   * Get memory thresholds configuration
   */
  static getThresholds(): typeof MEMORY_THRESHOLDS {
    return { ...MEMORY_THRESHOLDS };
  }

  /**
   * Check if memory usage is below safe threshold for operations
   * Returns true if safe to proceed with memory-intensive operations
   */
  static isSafeForOperations(): boolean {
    return this.checkMemoryThreshold() !== 'critical';
  }

  /**
   * Force memory cleanup by clearing large data structures
   * This is a placeholder for application-specific cleanup logic
   */
  static forceCleanup(): void {
    // Clear any cached data if available
    if (global.gc) {
      this.triggerGC();
    }

    // Additional cleanup can be implemented here
    console.log('[MEMORY] Cleanup completed');
  }

  /**
   * Get detailed memory report
   */
  static getDetailedReport(): string {
    const memUsage = this.getMemoryUsage();
    const status = this.checkMemoryThreshold();
    const thresholds = this.getThresholds();

    return `
=== Memory Report ===
Status: ${status.toUpperCase()}
Heap Used: ${memUsage.heapUsedMB}MB / ${memUsage.heapTotalMB}MB
RSS (Resident Set Size): ${memUsage.rssMB}MB
External Memory: ${memUsage.externalMB}MB
Thresholds:
  - Warning: ${thresholds.WARNING}MB
  - Critical: ${thresholds.CRITICAL}MB
GC Available: ${global.gc ? 'Yes' : 'No'}
===================
    `.trim();
  }
}
