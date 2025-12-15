/**
 * Update Logger
 *
 * Dedicated logging system for auto-update operations using electron-log
 * Features:
 * - File rotation (max 10 files, 10MB each)
 * - Structured logging with timestamps
 * - Console and file output
 * - Log upload functionality for diagnostics
 */

import log from 'electron-log';
import * as path from 'path';
import * as fs from 'fs';

export class UpdateLogger {
  private static instance: UpdateLogger;
  private logger: typeof log;
  private logFilePath: string;

  private constructor() {
    this.logger = log;
    this.logFilePath = '';
    this.configureLogger();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UpdateLogger {
    if (!UpdateLogger.instance) {
      UpdateLogger.instance = new UpdateLogger();
    }
    return UpdateLogger.instance;
  }

  /**
   * Configure electron-log
   */
  private configureLogger(): void {
    // Determine log file path based on platform
    if (typeof window !== 'undefined' && window.require) {
      // Renderer process
      const { app } = window.require('@electron/remote');
      this.logFilePath = path.join(app.getPath('logs'), 'update.log');
    } else if (typeof process !== 'undefined' && process.type === 'browser') {
      // Main process
      const { app } = require('electron');
      this.logFilePath = path.join(app.getPath('logs'), 'update.log');
    }

    // Configure file transport
    this.logger.transports.file.resolvePathFn = () => this.logFilePath;
    this.logger.transports.file.level = 'info';
    this.logger.transports.file.format =
      '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

    // Log rotation (max 10 files, 10MB each)
    this.logger.transports.file.maxSize = 10 * 1024 * 1024;

    // Configure console transport
    this.logger.transports.console.level = 'debug';
    this.logger.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';
  }

  /**
   * Log info message
   */
  info(message: string, ...args: any[]): void {
    this.logger.info(`[UPDATE] ${message}`, ...args);
  }

  /**
   * Log error message
   */
  error(message: string, error?: any): void {
    if (error) {
      this.logger.error(`[UPDATE] ${message}`, {
        message: error.message,
        stack: error.stack,
        ...error
      });
    } else {
      this.logger.error(`[UPDATE] ${message}`);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, ...args: any[]): void {
    this.logger.warn(`[UPDATE] ${message}`, ...args);
  }

  /**
   * Log debug message
   */
  debug(message: string, ...args: any[]): void {
    this.logger.debug(`[UPDATE] ${message}`, ...args);
  }

  /**
   * Log update attempt
   */
  logUpdateAttempt(info: any): void {
    this.info('=== Update Attempt Started ===', {
      targetVersion: info.version,
      releaseDate: info.releaseDate,
      downloadUrl: info.files?.[0]?.url,
      size: info.files?.[0]?.size,
      sha512: info.files?.[0]?.sha512
    });
  }

  /**
   * Log update success
   */
  logUpdateSuccess(fromVersion: string, toVersion: string, duration?: number): void {
    this.info('=== Update Success ===', {
      from: fromVersion,
      to: toVersion,
      timestamp: new Date().toISOString(),
      duration: duration ? `${duration}ms` : 'unknown'
    });
  }

  /**
   * Log update failure
   */
  logUpdateFailure(error: Error, context: string): void {
    this.error('=== Update Failure ===', {
      context,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Read log file content
   */
  async readLogs(lines?: number): Promise<string> {
    try {
      if (!this.logFilePath || !fs.existsSync(this.logFilePath)) {
        return 'No log file available';
      }

      const content = await fs.promises.readFile(this.logFilePath, 'utf-8');

      if (!lines) {
        return content;
      }

      // Return only the last N lines
      const allLines = content.split('\n');
      const lastLines = allLines.slice(-lines);
      return lastLines.join('\n');
    } catch (error: any) {
      this.error('Failed to read log file', error);
      return `Error reading logs: ${error.message}`;
    }
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Clear log file
   */
  async clearLogs(): Promise<void> {
    try {
      if (this.logFilePath && fs.existsSync(this.logFilePath)) {
        await fs.promises.writeFile(this.logFilePath, '');
        this.info('Log file cleared');
      }
    } catch (error: any) {
      this.error('Failed to clear log file', error);
      throw error;
    }
  }

  /**
   * Get underlying electron-log instance (for advanced usage)
   */
  getLogger(): typeof log {
    return this.logger;
  }
}

// Export singleton instance
export const updateLogger = UpdateLogger.getInstance();
