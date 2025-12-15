/**
 * Browser URL Collection - Accuracy Metrics System
 *
 * Collects, analyzes, and reports on URL collection accuracy and reliability.
 *
 * Features:
 * - Real-time metrics collection
 * - Log parsing and analysis
 * - Daily/Weekly accuracy reports
 * - Alerting for degraded performance
 * - Historical trend analysis
 *
 * @module accuracy-metrics
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Accuracy Metrics Interface
 */
export interface AccuracyMetrics {
  date: string;
  browser: string;
  platform: string;
  totalAttempts: number;
  successfulCollections: number;
  failedCollections: number;
  redactedByPrivacy: number;
  successRate: number;
  avgResponseTime: number;
  errorBreakdown: {
    permissionDenied: number;
    browserNotRunning: number;
    uiAutomationFailed: number;
    scriptTimeout: number;
    other: number;
  };
}

/**
 * Metrics Summary Interface
 */
export interface MetricsSummary {
  period: string;
  startDate: string;
  endDate: string;
  overallSuccessRate: number;
  totalAttempts: number;
  byBrowser: Map<string, AccuracyMetrics>;
  byPlatform: Map<string, AccuracyMetrics>;
  criticalIssues: string[];
  trends: {
    successRateChange: number;
    avgResponseTimeChange: number;
  };
}

/**
 * Daily Report Interface
 */
export interface DailyReport {
  date: string;
  summary: {
    overallSuccessRate: number;
    totalAttempts: number;
    criticalIssues: string[];
  };
  byBrowser: { [browser: string]: AccuracyMetrics };
  byPlatform: { [platform: string]: AccuracyMetrics };
  recommendations: string[];
}

/**
 * Metrics Thresholds
 */
const METRICS_THRESHOLDS = {
  criticalSuccessRate: 0.5, // Alert if below 50%
  warningSuccessRate: 0.7, // Warn if below 70%
  maxResponseTime: 5000, // Alert if avg > 5 seconds
  warningResponseTime: 3000 // Warn if avg > 3 seconds
};

/**
 * Metrics Collector Class
 */
export class MetricsCollector {
  private metricsData: Map<string, AccuracyMetrics> = new Map();
  private logDir: string;

  constructor(logDir?: string) {
    this.logDir = logDir || this.getDefaultLogDir();
  }

  /**
   * Get default log directory based on platform
   */
  private getDefaultLogDir(): string {
    const platform = os.platform();
    if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library/Logs/employee-monitor');
    } else if (platform === 'win32') {
      return path.join(process.env.APPDATA || '', 'employee-monitor/logs');
    }
    return path.join(process.cwd(), 'logs');
  }

  /**
   * Record a URL collection attempt
   */
  recordAttempt(
    browser: string,
    success: boolean,
    responseTime: number,
    error?: string
  ): void {
    const key = `${new Date().toISOString().split('T')[0]}-${browser}`;
    let metrics = this.metricsData.get(key);

    if (!metrics) {
      metrics = {
        date: new Date().toISOString().split('T')[0],
        browser,
        platform: os.platform(),
        totalAttempts: 0,
        successfulCollections: 0,
        failedCollections: 0,
        redactedByPrivacy: 0,
        successRate: 0,
        avgResponseTime: 0,
        errorBreakdown: {
          permissionDenied: 0,
          browserNotRunning: 0,
          uiAutomationFailed: 0,
          scriptTimeout: 0,
          other: 0
        }
      };
    }

    metrics.totalAttempts++;

    if (success) {
      metrics.successfulCollections++;
    } else {
      metrics.failedCollections++;

      // Categorize error
      if (error) {
        if (error.includes('permission')) {
          metrics.errorBreakdown.permissionDenied++;
        } else if (error.includes('not running')) {
          metrics.errorBreakdown.browserNotRunning++;
        } else if (error.includes('ui automation')) {
          metrics.errorBreakdown.uiAutomationFailed++;
        } else if (error.includes('timeout')) {
          metrics.errorBreakdown.scriptTimeout++;
        } else {
          metrics.errorBreakdown.other++;
        }
      }
    }

    // Update averages
    metrics.successRate = metrics.successfulCollections / metrics.totalAttempts;
    metrics.avgResponseTime =
      (metrics.avgResponseTime * (metrics.totalAttempts - 1) + responseTime) /
      metrics.totalAttempts;

    this.metricsData.set(key, metrics);
  }

  /**
   * Get metrics for a specific date and browser
   */
  getMetrics(date: string, browser: string): AccuracyMetrics | undefined {
    return this.metricsData.get(`${date}-${browser}`);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): AccuracyMetrics[] {
    return Array.from(this.metricsData.values());
  }

  /**
   * Parse logs to extract metrics
   */
  async parseLogsForMetrics(logFilePath?: string): Promise<AccuracyMetrics[]> {
    const logPath = logFilePath || path.join(this.logDir, 'url-collection.log');

    try {
      const logContent = await fs.readFile(logPath, 'utf-8');
      const lines = logContent.split('\n');

      lines.forEach(line => {
        // Example log format:
        // [2025-11-03T10:30:45.123Z] [INFO] URL Collection: Chrome - Success (125ms)
        // [2025-11-03T10:30:46.456Z] [ERROR] URL Collection: Firefox - Failed: timeout

        const successMatch = line.match(/URL Collection: (\w+) - Success \((\d+)ms\)/);
        if (successMatch) {
          const [, browser, time] = successMatch;
          this.recordAttempt(browser, true, parseInt(time, 10));
        }

        const failureMatch = line.match(/URL Collection: (\w+) - Failed: (.+)/);
        if (failureMatch) {
          const [, browser, error] = failureMatch;
          this.recordAttempt(browser, false, 0, error);
        }
      });

      return this.getAllMetrics();
    } catch (error) {
      console.error('Error parsing logs:', error);
      return [];
    }
  }

  /**
   * Save metrics to file
   */
  async saveMetrics(outputPath?: string): Promise<void> {
    const output = outputPath || path.join(this.logDir, 'metrics.json');
    const data = {
      generatedAt: new Date().toISOString(),
      platform: os.platform(),
      metrics: this.getAllMetrics()
    };

    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(data, null, 2));
  }
}

/**
 * Calculate overall success rate from metrics array
 */
export function calculateOverallSuccessRate(metrics: AccuracyMetrics[]): number {
  if (metrics.length === 0) return 0;

  const totalAttempts = metrics.reduce((sum, m) => sum + m.totalAttempts, 0);
  const totalSuccesses = metrics.reduce((sum, m) => sum + m.successfulCollections, 0);

  return totalAttempts > 0 ? totalSuccesses / totalAttempts : 0;
}

/**
 * Group metrics by browser
 */
export function groupByBrowser(metrics: AccuracyMetrics[]): Map<string, AccuracyMetrics[]> {
  const grouped = new Map<string, AccuracyMetrics[]>();

  metrics.forEach(metric => {
    const existing = grouped.get(metric.browser) || [];
    existing.push(metric);
    grouped.set(metric.browser, existing);
  });

  return grouped;
}

/**
 * Group metrics by platform
 */
export function groupByPlatform(metrics: AccuracyMetrics[]): Map<string, AccuracyMetrics[]> {
  const grouped = new Map<string, AccuracyMetrics[]>();

  metrics.forEach(metric => {
    const existing = grouped.get(metric.platform) || [];
    existing.push(metric);
    grouped.set(metric.platform, existing);
  });

  return grouped;
}

/**
 * Identify critical issues from metrics
 */
export function identifyCriticalIssues(metrics: AccuracyMetrics[]): string[] {
  const issues: string[] = [];

  metrics.forEach(metric => {
    // Success rate too low
    if (metric.successRate < METRICS_THRESHOLDS.criticalSuccessRate) {
      issues.push(
        `CRITICAL: ${metric.browser} success rate ${(metric.successRate * 100).toFixed(1)}% (below ${(METRICS_THRESHOLDS.criticalSuccessRate * 100).toFixed(0)}%)`
      );
    } else if (metric.successRate < METRICS_THRESHOLDS.warningSuccessRate) {
      issues.push(
        `WARNING: ${metric.browser} success rate ${(metric.successRate * 100).toFixed(1)}% (below ${(METRICS_THRESHOLDS.warningSuccessRate * 100).toFixed(0)}%)`
      );
    }

    // Response time too high
    if (metric.avgResponseTime > METRICS_THRESHOLDS.maxResponseTime) {
      issues.push(
        `CRITICAL: ${metric.browser} avg response time ${metric.avgResponseTime.toFixed(0)}ms (above ${METRICS_THRESHOLDS.maxResponseTime}ms)`
      );
    } else if (metric.avgResponseTime > METRICS_THRESHOLDS.warningResponseTime) {
      issues.push(
        `WARNING: ${metric.browser} avg response time ${metric.avgResponseTime.toFixed(0)}ms (above ${METRICS_THRESHOLDS.warningResponseTime}ms)`
      );
    }

    // High permission denial rate
    const permissionDenialRate =
      metric.errorBreakdown.permissionDenied / metric.totalAttempts;
    if (permissionDenialRate > 0.3) {
      issues.push(
        `WARNING: ${metric.browser} has high permission denial rate ${(permissionDenialRate * 100).toFixed(1)}%`
      );
    }
  });

  return issues;
}

/**
 * Generate daily accuracy report
 */
export async function generateDailyAccuracyReport(
  logDir?: string
): Promise<DailyReport> {
  const collector = new MetricsCollector(logDir);
  const metrics = await collector.parseLogsForMetrics();

  const overallSuccessRate = calculateOverallSuccessRate(metrics);
  const criticalIssues = identifyCriticalIssues(metrics);

  const byBrowser: { [browser: string]: AccuracyMetrics } = {};
  groupByBrowser(metrics).forEach((metricsList, browser) => {
    // Aggregate metrics for same browser
    const aggregated: AccuracyMetrics = {
      date: new Date().toISOString().split('T')[0],
      browser,
      platform: metricsList[0].platform,
      totalAttempts: metricsList.reduce((sum, m) => sum + m.totalAttempts, 0),
      successfulCollections: metricsList.reduce((sum, m) => sum + m.successfulCollections, 0),
      failedCollections: metricsList.reduce((sum, m) => sum + m.failedCollections, 0),
      redactedByPrivacy: metricsList.reduce((sum, m) => sum + m.redactedByPrivacy, 0),
      successRate: 0,
      avgResponseTime: 0,
      errorBreakdown: {
        permissionDenied: metricsList.reduce((sum, m) => sum + m.errorBreakdown.permissionDenied, 0),
        browserNotRunning: metricsList.reduce((sum, m) => sum + m.errorBreakdown.browserNotRunning, 0),
        uiAutomationFailed: metricsList.reduce((sum, m) => sum + m.errorBreakdown.uiAutomationFailed, 0),
        scriptTimeout: metricsList.reduce((sum, m) => sum + m.errorBreakdown.scriptTimeout, 0),
        other: metricsList.reduce((sum, m) => sum + m.errorBreakdown.other, 0)
      }
    };

    aggregated.successRate = aggregated.totalAttempts > 0
      ? aggregated.successfulCollections / aggregated.totalAttempts
      : 0;

    aggregated.avgResponseTime = metricsList.reduce((sum, m) => sum + m.avgResponseTime, 0) / metricsList.length;

    byBrowser[browser] = aggregated;
  });

  const byPlatform: { [platform: string]: AccuracyMetrics } = {};
  groupByPlatform(metrics).forEach((metricsList, platform) => {
    // Aggregate metrics for same platform
    const aggregated: AccuracyMetrics = {
      date: new Date().toISOString().split('T')[0],
      browser: 'all',
      platform,
      totalAttempts: metricsList.reduce((sum, m) => sum + m.totalAttempts, 0),
      successfulCollections: metricsList.reduce((sum, m) => sum + m.successfulCollections, 0),
      failedCollections: metricsList.reduce((sum, m) => sum + m.failedCollections, 0),
      redactedByPrivacy: metricsList.reduce((sum, m) => sum + m.redactedByPrivacy, 0),
      successRate: 0,
      avgResponseTime: 0,
      errorBreakdown: {
        permissionDenied: metricsList.reduce((sum, m) => sum + m.errorBreakdown.permissionDenied, 0),
        browserNotRunning: metricsList.reduce((sum, m) => sum + m.errorBreakdown.browserNotRunning, 0),
        uiAutomationFailed: metricsList.reduce((sum, m) => sum + m.errorBreakdown.uiAutomationFailed, 0),
        scriptTimeout: metricsList.reduce((sum, m) => sum + m.errorBreakdown.scriptTimeout, 0),
        other: metricsList.reduce((sum, m) => sum + m.errorBreakdown.other, 0)
      }
    };

    aggregated.successRate = aggregated.totalAttempts > 0
      ? aggregated.successfulCollections / aggregated.totalAttempts
      : 0;

    aggregated.avgResponseTime = metricsList.reduce((sum, m) => sum + m.avgResponseTime, 0) / metricsList.length;

    byPlatform[platform] = aggregated;
  });

  const recommendations = generateRecommendations(metrics, criticalIssues);

  const report: DailyReport = {
    date: new Date().toISOString().split('T')[0],
    summary: {
      overallSuccessRate,
      totalAttempts: metrics.reduce((sum, m) => sum + m.totalAttempts, 0),
      criticalIssues
    },
    byBrowser,
    byPlatform,
    recommendations
  };

  // Save report
  await saveReport(report, logDir);

  // Alert if critical issues
  if (criticalIssues.some(issue => issue.startsWith('CRITICAL'))) {
    await sendAlert(
      'URL Collection Critical Issues',
      criticalIssues.filter(i => i.startsWith('CRITICAL'))
    );
  }

  return report;
}

/**
 * Generate recommendations based on metrics
 */
function generateRecommendations(
  metrics: AccuracyMetrics[],
  issues: string[]
): string[] {
  const recommendations: string[] = [];

  // Analyze issues and provide recommendations
  issues.forEach(issue => {
    if (issue.includes('permission denial')) {
      recommendations.push(
        'Check system permissions (Accessibility on macOS, UI Automation on Windows)'
      );
    }

    if (issue.includes('response time')) {
      recommendations.push(
        'Consider optimizing fallback timeouts or reducing polling frequency'
      );
    }

    if (issue.includes('success rate') && issue.includes('Firefox')) {
      recommendations.push(
        'Firefox collection is best-effort. Consider browser extension for enterprise deployments.'
      );
    }
  });

  // General recommendations based on metrics
  const overallSuccessRate = calculateOverallSuccessRate(metrics);
  if (overallSuccessRate < 0.7) {
    recommendations.push('Overall success rate low. Review logs for common error patterns.');
  }

  return [...new Set(recommendations)]; // Deduplicate
}

/**
 * Save report to file
 */
async function saveReport(report: DailyReport, logDir?: string): Promise<void> {
  const dir = logDir || path.join(process.cwd(), 'reports');
  await fs.mkdir(dir, { recursive: true });

  const filename = `accuracy-report-${report.date}.json`;
  const filepath = path.join(dir, filename);

  await fs.writeFile(filepath, JSON.stringify(report, null, 2));

  console.log(`Report saved to: ${filepath}`);
}

/**
 * Send alert (placeholder - integrate with actual alert system)
 */
async function sendAlert(subject: string, messages: string[]): Promise<void> {
  console.error('\n🚨 ALERT:', subject);
  messages.forEach(msg => console.error(`  - ${msg}`));

  // TODO: Integrate with actual alerting system (email, Slack, etc.)
}

/**
 * CLI utility to generate report
 */
if (require.main === module) {
  generateDailyAccuracyReport()
    .then(report => {
      console.log('\n📊 Daily Accuracy Report Generated');
      console.log(`Date: ${report.date}`);
      console.log(`Overall Success Rate: ${(report.summary.overallSuccessRate * 100).toFixed(1)}%`);
      console.log(`Total Attempts: ${report.summary.totalAttempts}`);

      if (report.summary.criticalIssues.length > 0) {
        console.log('\nIssues:');
        report.summary.criticalIssues.forEach(issue => console.log(`  - ${issue}`));
      }

      if (report.recommendations.length > 0) {
        console.log('\nRecommendations:');
        report.recommendations.forEach(rec => console.log(`  - ${rec}`));
      }
    })
    .catch(error => {
      console.error('Error generating report:', error);
      process.exit(1);
    });
}
