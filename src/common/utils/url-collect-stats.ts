/**
 * URL Collection Statistics Tracker
 *
 * Tracks success rates, latency, and browser-specific metrics
 * for URL collection operations across all platforms.
 *
 * Features:
 * - Real-time success rate tracking
 * - Browser-specific metrics (success, failure, latency)
 * - Collection method statistics
 * - Comprehensive reporting
 * - Session persistence
 */

import { logger } from './logger';

/**
 * Collection metrics data structure
 */
export interface CollectionMetrics {
  total: number;
  success: number;
  failed: number;
  byBrowser: Map<string, BrowserStats>;
  byMethod: Map<string, number>;
  startTime: number;
}

/**
 * Browser-specific statistics
 */
export interface BrowserStats {
  success: number;
  failed: number;
  totalLatency: number;
  count: number;
  lastSuccess?: number;
  lastFailure?: number;
}

/**
 * URL Collection Statistics Tracker
 *
 * Singleton class for tracking URL collection performance metrics.
 * Provides real-time statistics, success rates, and comprehensive reporting.
 */
export class URLCollectStats {
  private static readonly MAX_RECORDS = 10000; // Prevent unbounded growth

  private metrics: CollectionMetrics = {
    total: 0,
    success: 0,
    failed: 0,
    byBrowser: new Map(),
    byMethod: new Map(),
    startTime: Date.now()
  };

  /**
   * Record a successful URL collection
   *
   * @param browser - Browser name (Safari, Chrome, Firefox, etc.)
   * @param method - Collection method used (applescript, window-title, etc.)
   * @param latency - Time taken in milliseconds
   */
  recordSuccess(browser: string, method: string, latency: number): void {
    // Check if we need to reset to prevent memory buildup
    if (this.metrics.total >= URLCollectStats.MAX_RECORDS) {
      logger.warn(`[URLCollectStats] Max records (${URLCollectStats.MAX_RECORDS}) reached, resetting stats`);
      this.reset();
    }

    this.metrics.total++;
    this.metrics.success++;

    // Browser-specific stats
    if (!this.metrics.byBrowser.has(browser)) {
      this.metrics.byBrowser.set(browser, {
        success: 0,
        failed: 0,
        totalLatency: 0,
        count: 0
      });
    }
    const browserStats = this.metrics.byBrowser.get(browser)!;
    browserStats.success++;
    browserStats.totalLatency += latency;
    browserStats.count++;
    browserStats.lastSuccess = Date.now();

    // Method-specific stats
    const currentCount = this.metrics.byMethod.get(method) || 0;
    this.metrics.byMethod.set(method, currentCount + 1);

    logger.debug(`[URLCollectStats] Success: ${browser} via ${method} (${latency}ms)`);
  }

  /**
   * Record a failed URL collection
   *
   * @param browser - Browser name
   * @param reason - Optional failure reason
   */
  recordFailure(browser: string, reason?: string): void {
    // Check if we need to reset to prevent memory buildup
    if (this.metrics.total >= URLCollectStats.MAX_RECORDS) {
      logger.warn(`[URLCollectStats] Max records (${URLCollectStats.MAX_RECORDS}) reached, resetting stats`);
      this.reset();
    }

    this.metrics.total++;
    this.metrics.failed++;

    // Browser-specific stats
    if (!this.metrics.byBrowser.has(browser)) {
      this.metrics.byBrowser.set(browser, {
        success: 0,
        failed: 0,
        totalLatency: 0,
        count: 0
      });
    }
    const browserStats = this.metrics.byBrowser.get(browser)!;
    browserStats.failed++;
    browserStats.count++;
    browserStats.lastFailure = Date.now();

    if (reason) {
      logger.debug(`[URLCollectStats] Failure: ${browser} - ${reason}`);
    }
  }

  /**
   * Get current overall success rate (0-100)
   *
   * @returns Success rate as percentage
   */
  getSuccessRate(): number {
    if (this.metrics.total === 0) return 0;
    return (this.metrics.success / this.metrics.total) * 100;
  }

  /**
   * Get success rate for a specific browser
   *
   * @param browser - Browser name
   * @returns Browser-specific success rate as percentage
   */
  getBrowserSuccessRate(browser: string): number {
    const stats = this.metrics.byBrowser.get(browser);
    if (!stats || stats.count === 0) return 0;
    return (stats.success / stats.count) * 100;
  }

  /**
   * Get average latency for a specific browser
   *
   * @param browser - Browser name
   * @returns Average latency in milliseconds
   */
  getBrowserAvgLatency(browser: string): number {
    const stats = this.metrics.byBrowser.get(browser);
    if (!stats || stats.success === 0) return 0;
    return Math.round(stats.totalLatency / stats.success);
  }

  /**
   * Generate a comprehensive statistics report
   *
   * @returns Formatted statistics report string
   */
  getReport(): string {
    const uptime = Math.round((Date.now() - this.metrics.startTime) / 1000 / 60); // minutes
    const successRate = this.getSuccessRate();

    let report = '\n';
    report += '====================================\n';
    report += 'URL Collection Statistics Report\n';
    report += '====================================\n';
    report += `Uptime: ${uptime} minutes\n`;
    report += `Total Attempts: ${this.metrics.total}\n`;
    report += `Success: ${this.metrics.success}\n`;
    report += `Failed: ${this.metrics.failed}\n`;
    report += `Success Rate: ${successRate.toFixed(1)}%\n`;
    report += '\n';

    // Browser-specific stats
    if (this.metrics.byBrowser.size > 0) {
      report += 'Browser Statistics:\n';
      report += '------------------------------------\n';

      const browsers = Array.from(this.metrics.byBrowser.entries())
        .sort((a, b) => b[1].count - a[1].count);

      for (const [browser, stats] of browsers) {
        const browserRate = (stats.success / stats.count) * 100;
        const avgLatency = stats.success > 0 ? Math.round(stats.totalLatency / stats.success) : 0;

        report += `  ${browser}:\n`;
        report += `    Attempts: ${stats.count}\n`;
        report += `    Success: ${stats.success} (${browserRate.toFixed(1)}%)\n`;
        report += `    Failed: ${stats.failed}\n`;
        report += `    Avg Latency: ${avgLatency}ms\n`;
      }
      report += '\n';
    }

    // Method-specific stats
    if (this.metrics.byMethod.size > 0) {
      report += 'Collection Methods:\n';
      report += '------------------------------------\n';

      const methods = Array.from(this.metrics.byMethod.entries())
        .sort((a, b) => b[1] - a[1]);

      for (const [method, count] of methods) {
        const percentage = (count / this.metrics.success) * 100;
        report += `  ${method}: ${count} (${percentage.toFixed(1)}%)\n`;
      }
      report += '\n';
    }

    report += '====================================\n';

    return report;
  }

  /**
   * Get compact summary for logging
   *
   * @returns Single-line summary string
   */
  getSummary(): string {
    const successRate = this.getSuccessRate();
    const uptime = Math.round((Date.now() - this.metrics.startTime) / 1000 / 60);
    return `URLCollectStats: ${this.metrics.success}/${this.metrics.total} (${successRate.toFixed(1)}%) | Uptime: ${uptime}min`;
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.metrics = {
      total: 0,
      success: 0,
      failed: 0,
      byBrowser: new Map(),
      byMethod: new Map(),
      startTime: Date.now()
    };
    logger.info('[URLCollectStats] Statistics reset');
  }

  /**
   * Get current metrics (for programmatic access)
   *
   * @returns Read-only copy of current metrics
   */
  getMetrics(): Readonly<CollectionMetrics> {
    return {
      ...this.metrics,
      byBrowser: new Map(this.metrics.byBrowser),
      byMethod: new Map(this.metrics.byMethod)
    };
  }

  /**
   * Get browser health status
   *
   * @param browser - Browser name
   * @returns Health status ('healthy', 'degraded', 'failing', 'unknown')
   */
  getBrowserHealth(browser: string): 'healthy' | 'degraded' | 'failing' | 'unknown' {
    const successRate = this.getBrowserSuccessRate(browser);
    const stats = this.metrics.byBrowser.get(browser);

    if (!stats || stats.count < 5) return 'unknown'; // Not enough data

    if (successRate >= 80) return 'healthy';
    if (successRate >= 50) return 'degraded';
    return 'failing';
  }

  /**
   * Export metrics to JSON
   *
   * @returns JSON-serializable metrics object
   */
  exportJSON(): any {
    return {
      total: this.metrics.total,
      success: this.metrics.success,
      failed: this.metrics.failed,
      successRate: this.getSuccessRate(),
      startTime: this.metrics.startTime,
      uptime: Math.round((Date.now() - this.metrics.startTime) / 1000),
      browsers: Array.from(this.metrics.byBrowser.entries()).map(([name, stats]) => ({
        name,
        ...stats,
        successRate: (stats.success / stats.count) * 100,
        avgLatency: stats.success > 0 ? Math.round(stats.totalLatency / stats.success) : 0
      })),
      methods: Array.from(this.metrics.byMethod.entries()).map(([name, count]) => ({
        name,
        count,
        percentage: (count / this.metrics.success) * 100
      }))
    };
  }
}

// Singleton instance
export const urlCollectStats = new URLCollectStats();

export default urlCollectStats;
