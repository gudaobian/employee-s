/**
 * 日志工具 - 重构版本
 * 统一的日志管理系统
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { execSync } from 'child_process';

const gzip = promisify(zlib.gzip);
const readdir = promisify(fs.readdir);

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: string;
  data?: any;
  error?: Error;
}

interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  logDir?: string;
  maxFileSize: number;
  maxFiles: number;
  contextName?: string;
  // 新增配置
  maxRetentionDays: number;      // 日志保留天数（默认7天）
  enableAutoCleanup: boolean;    // 启用自动清理（默认true）
  cleanupInterval: number;       // 清理间隔（默认1小时）
  enableCompression: boolean;    // 启用压缩（默认false）
  flushInterval: number;         // flush间隔（默认10秒）
  flushBatchSize: number;        // 批量大小（默认100条）
  enableSmartFlush: boolean;     // 智能flush（默认true）
}

export class Logger {
  private config: LoggerConfig;
  private logDir: string;
  private logBuffer: LogEntry[] = [];
  private lastFlushTime: Date = new Date();

  private static instance?: Logger;
  private static loggers = new Map<string, Logger>();
  private static sharedFlushTimer?: NodeJS.Timeout;
  private static sharedCleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<LoggerConfig> = {}) {
    // 检测是否在Electron环境
    const isElectron = typeof process !== 'undefined' &&
                       process.versions &&
                       process.versions.electron;

    this.config = {
      level: LogLevel.INFO,
      enableConsole: !isElectron,     // Electron环境下禁用console输出,避免双重记录
      enableFile: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB (原5MB)
      maxFiles: 3,                    // 3个轮转文件 (原5个)
      maxRetentionDays: 7,           // 保留7天
      enableAutoCleanup: true,
      cleanupInterval: 60 * 60 * 1000, // 1小时
      enableCompression: false,       // 默认关闭压缩（可选功能）
      flushInterval: 10000,           // 10秒 (原5秒)
      flushBatchSize: 100,
      enableSmartFlush: true,
      ...config
    };

    this.logDir = this.config.logDir || this.getDefaultLogDir();
    this.ensureLogDirectory();

    // 不在构造函数中启动timer，改用全局共享timer
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
      Logger.startSharedTimers(); // 启动全局共享timer
    }
    return Logger.instance;
  }

  static getLogger(context: string): Logger {
    if (!Logger.loggers.has(context)) {
      Logger.loggers.set(context, new Logger({ contextName: context }));
      Logger.startSharedTimers(); // 确保timer启动
    }
    return Logger.loggers.get(context)!;
  }

  /**
   * 清理所有历史日志文件（程序启动时调用）
   * 同步执行，确保清理完成后才继续启动
   *
   * 会清理以下可能的日志目录：
   * - Windows: %APPDATA%/employee-monitor/logs 和 %APPDATA%/employee-safety-client/logs
   * - macOS: ~/Library/Logs/employee-monitor 和 ~/Library/Logs/employee-safety-client
   * - Linux: ~/.local/share/employee-monitor/logs 和 ~/.local/share/employee-safety-client/logs
   */
  static cleanupAllLogs(): void {
    try {
      // 获取可能的日志目录列表
      const possibleLogDirs: string[] = [];

      // 标准日志目录
      const standardLogDir = new Logger().logDir;
      possibleLogDirs.push(standardLogDir);

      // 额外检查 employee-safety-client 目录（历史遗留）
      try {
        const appDataDir = process.env.APPDATA ||
                          path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Logs' : '.local/share');
        const legacyLogDir = path.join(appDataDir, 'employee-safety-client', 'logs');
        if (legacyLogDir !== standardLogDir) {
          possibleLogDirs.push(legacyLogDir);
        }
      } catch {
        // 忽略错误
      }

      let totalDeletedCount = 0;

      // 清理所有可能的日志目录
      for (const logDir of possibleLogDirs) {
        if (!fs.existsSync(logDir)) {
          continue; // 目录不存在，跳过
        }

        try {
          const files = fs.readdirSync(logDir);
          let deletedCount = 0;

          for (const file of files) {
            // 删除所有日志文件：.log, .log.*, .gz
            if (file.endsWith('.log') || file.includes('.log.') || file.endsWith('.gz')) {
              try {
                fs.unlinkSync(path.join(logDir, file));
                deletedCount++;
              } catch (error) {
                // 忽略删除失败的文件（可能被占用）
                console.warn(`[Logger] Failed to delete log file: ${file}`, error);
              }
            }
          }

          if (deletedCount > 0) {
            console.info(`[Logger] Cleaned up ${deletedCount} log file(s) in ${logDir}`);
            totalDeletedCount += deletedCount;
          }
        } catch (error) {
          console.warn(`[Logger] Failed to cleanup logs in ${logDir}:`, error);
        }
      }

      if (totalDeletedCount > 0) {
        console.info(`[Logger] Total cleaned up ${totalDeletedCount} log file(s) on startup`);
      }
    } catch (error) {
      console.warn('[Logger] Failed to cleanup logs on startup:', error);
    }
  }

  // 全局共享的定时器
  private static startSharedTimers(): void {
    // 启动flush timer
    if (!Logger.sharedFlushTimer && Logger.instance) {
      Logger.sharedFlushTimer = setInterval(() => {
        // flush所有logger实例
        Logger.instance?.smartFlush().catch(() => {});
        Logger.loggers.forEach(logger => {
          logger.smartFlush().catch(() => {});
        });
      }, Logger.instance.config.flushInterval);
    }

    // 启动cleanup timer
    if (!Logger.sharedCleanupTimer && Logger.instance && Logger.instance.config.enableAutoCleanup) {
      // 启动时立即清理一次
      Logger.instance.cleanupOldLogs().catch(() => {});

      Logger.sharedCleanupTimer = setInterval(() => {
        Logger.instance?.cleanupOldLogs().catch(() => {});
      }, Logger.instance.config.cleanupInterval);
    }
  }

  // 全局清理
  static destroyAll(): void {
    if (Logger.sharedFlushTimer) {
      clearInterval(Logger.sharedFlushTimer);
      Logger.sharedFlushTimer = undefined;
    }

    if (Logger.sharedCleanupTimer) {
      clearInterval(Logger.sharedCleanupTimer);
      Logger.sharedCleanupTimer = undefined;
    }

    Logger.instance?.destroy();
    Logger.loggers.forEach(logger => logger.destroy());
    Logger.loggers.clear();
  }

  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error | any, data?: any): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    this.log(LogLevel.ERROR, message, data, errorObj);
  }

  fatal(message: string, error?: Error | any, data?: any): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    this.log(LogLevel.FATAL, message, data, errorObj);
  }

  private log(level: LogLevel, message: string, data?: any, error?: Error): void {
    if (level < this.config.level) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context: this.config.contextName,
      data: data ? this.sanitizeData(data) : undefined,
      error
    };

    // 立即输出到控制台
    if (this.config.enableConsole) {
      this.writeToConsole(entry);
    }

    // 缓冲文件输出
    if (this.config.enableFile) {
      this.logBuffer.push(entry);
    }
  }

  private writeToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString().substring(11, 19);
    const levelName = LogLevel[entry.level].padEnd(5);
    const context = entry.context ? `[${entry.context}]` : '';
    const message = `${timestamp} ${levelName} ${context} ${entry.message}`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message, entry.data || '');
        break;
      case LogLevel.INFO:
        console.info(message, entry.data || '');
        break;
      case LogLevel.WARN:
        console.warn(message, entry.data || '');
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(message, entry.error?.stack || entry.error || entry.data || '');
        break;
    }
  }

  private async writeToFile(): Promise<void> {
    if (this.logBuffer.length === 0) {
      return;
    }

    try {
      // 写入前检查磁盘空间
      const diskSpace = await this.checkDiskSpace();
      const availableGB = diskSpace.available / (1024 ** 3);

      if (availableGB < 0.1) { // 小于100MB
        await this.emergencyCleanup();
        return;
      }

      const entries = [...this.logBuffer];
      this.logBuffer = [];
      this.lastFlushTime = new Date();

      const logFile = path.join(this.logDir, 'app.log');
      const logLines = entries.map(entry => this.formatLogEntry(entry)).join('\n') + '\n';

      // 检查文件大小并轮转
      await this.rotateLogIfNeeded(logFile);

      // 追加日志
      await fs.promises.appendFile(logFile, logLines);

    } catch (error) {
      console.error('[Logger] Failed to write log file:', error);
    }
  }

  private formatLogEntry(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level];
    const context = entry.context ? ` [${entry.context}]` : '';
    let message = `${timestamp} ${level}${context} ${entry.message}`;

    if (entry.data) {
      message += ` | Data: ${JSON.stringify(entry.data)}`;
    }

    if (entry.error) {
      message += ` | Error: ${entry.error.message}`;
      if (entry.error.stack) {
        message += `\nStack: ${entry.error.stack}`;
      }
    }

    return message;
  }

  private async rotateLogIfNeeded(logFile: string): Promise<void> {
    try {
      const stats = await fs.promises.stat(logFile);

      if (stats.size >= this.config.maxFileSize) {
        // 1. 删除最老的文件（如果存在）
        const oldestFile = `${logFile}.${this.config.maxFiles}`;
        try {
          await fs.promises.unlink(oldestFile);
        } catch {
          // 文件不存在，忽略
        }

        // 2. 倒序重命名现有轮转文件
        for (let i = this.config.maxFiles - 1; i >= 1; i--) {
          const oldFile = `${logFile}.${i}`;
          const newFile = `${logFile}.${i + 1}`;

          try {
            await fs.promises.access(oldFile);
            await fs.promises.rename(oldFile, newFile);
          } catch {
            // 文件不存在，继续
          }
        }

        // 3. 重命名当前日志文件
        await fs.promises.rename(logFile, `${logFile}.1`);

        // 4. 验证轮转后的文件数量
        await this.verifyRotatedFiles(logFile);

        // 5. 压缩旧日志（如果启用）
        if (this.config.enableCompression) {
          await this.compressOldLogs(logFile);
        }
      }
    } catch (error) {
      console.error('[Logger] Log rotation failed:', error);
    }
  }

  // 验证轮转文件数量
  private async verifyRotatedFiles(logFile: string): Promise<void> {
    try {
      const files = await readdir(this.logDir);
      const baseName = path.basename(logFile);
      const rotatedFiles = files.filter(f =>
        f.startsWith(baseName) &&
        f !== baseName &&
        !f.endsWith('.gz')
      );

      if (rotatedFiles.length > this.config.maxFiles) {
        console.warn(`[Logger] Found ${rotatedFiles.length} rotated files, expected max ${this.config.maxFiles}`);

        // 清理超出数量的文件
        const sorted = rotatedFiles.sort((a, b) => {
          const numA = parseInt(a.split('.').pop() || '0');
          const numB = parseInt(b.split('.').pop() || '0');
          return numB - numA; // 降序，最大的在前
        });

        for (let i = this.config.maxFiles; i < sorted.length; i++) {
          await fs.promises.unlink(path.join(this.logDir, sorted[i]));
          console.info(`[Logger] Cleaned up excessive rotated file: ${sorted[i]}`);
        }
      }
    } catch (error) {
      console.warn('[Logger] Failed to verify rotated files:', error);
    }
  }

  private getDefaultLogDir(): string {
    let logDir: string;

    try {
      // 尝试使用应用程序数据目录
      const appDataDir = process.env.APPDATA || 
                        path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Logs' : '.local/share');
      logDir = path.join(appDataDir, 'employee-monitor', 'logs');
    } catch {
      // 后备选项：当前目录的logs文件夹
      logDir = path.join(process.cwd(), 'logs');
    }

    return logDir;
  }

  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.warn('[Logger] Failed to create log directory:', error);
      this.config.enableFile = false;
    }
  }

  private sanitizeData(data: any): any {
    try {
      // 清理敏感数据和循环引用
      return JSON.parse(JSON.stringify(data, (key, value) => {
        // 清理密码相关字段
        if (typeof key === 'string' && /password|token|secret|key|auth/i.test(key)) {
          return '[REDACTED]';
        }
        return value;
      }));
    } catch {
      return '[UNSERIALIZABLE_DATA]';
    }
  }

  // 智能flush策略
  private async smartFlush(): Promise<void> {
    if (!this.config.enableSmartFlush) {
      return this.writeToFile();
    }

    const bufferSize = this.logBuffer.length;
    const hasErrorLogs = this.logBuffer.some(e => e.level >= LogLevel.ERROR);

    // 条件1: 缓冲区达到批量大小
    // 条件2: 有ERROR级别日志（立即写入）
    if (bufferSize >= this.config.flushBatchSize || hasErrorLogs) {
      await this.writeToFile();
    }
  }

  // 立即flush所有缓冲的日志
  async flush(): Promise<void> {
    await this.writeToFile();
  }

  // 基于时间的清理策略
  private async cleanupOldLogs(): Promise<void> {
    try {
      const files = await readdir(this.logDir);
      const now = Date.now();
      const maxAge = this.config.maxRetentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.log') && !file.includes('.log.')) {
          continue; // 跳过非日志文件
        }

        const filePath = path.join(this.logDir, file);
        try {
          const stats = await fs.promises.stat(filePath);
          const age = now - stats.mtimeMs;

          if (age > maxAge) {
            await fs.promises.unlink(filePath);
            console.info(`[Logger] Cleaned up old log file: ${file} (age: ${Math.round(age / 1000 / 60 / 60 / 24)} days)`);
          }
        } catch (error) {
          console.warn(`[Logger] Failed to cleanup ${file}:`, error);
        }
      }
    } catch (error) {
      console.error('[Logger] Cleanup task failed:', error);
    }
  }

  // 检查磁盘空间
  private async checkDiskSpace(): Promise<{ available: number; total: number }> {
    try {
      if (process.platform === 'win32') {
        // Windows: 使用wmic命令
        const drive = this.logDir.charAt(0);
        const output = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace,Size`, { timeout: 5000 }).toString();
        const lines = output.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].trim().split(/\s+/);
          if (parts.length >= 2) {
            return { available: parseInt(parts[0]), total: parseInt(parts[1]) };
          }
        }
      } else {
        // macOS/Linux: 使用df命令
        const output = execSync(`df -k "${this.logDir}"`, { timeout: 5000 }).toString();
        const lines = output.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].trim().split(/\s+/);
          return {
            available: parseInt(parts[3]) * 1024,
            total: parseInt(parts[1]) * 1024
          };
        }
      }
    } catch (error) {
      console.warn('[Logger] Failed to check disk space:', error);
    }

    return { available: 0, total: 0 };
  }

  // 紧急清理
  private async emergencyCleanup(): Promise<void> {
    console.warn('[Logger] 🚨 Emergency cleanup triggered!');

    try {
      // 1. 停止写入
      const wasEnabled = this.config.enableFile;
      this.config.enableFile = false;

      // 2. 清理所有轮转文件
      const files = await readdir(this.logDir);
      for (const file of files) {
        if (file.includes('.log.') || file.endsWith('.gz')) {
          try {
            await fs.promises.unlink(path.join(this.logDir, file));
            console.info(`[Logger] Emergency deleted: ${file}`);
          } catch {
            // 忽略删除失败
          }
        }
      }

      // 3. 压缩当前日志
      const currentLog = path.join(this.logDir, 'app.log');
      if (fs.existsSync(currentLog)) {
        const content = await fs.promises.readFile(currentLog, 'utf-8');
        const lines = content.split('\n');
        // 只保留最后1000行
        const truncated = lines.slice(-1000).join('\n');
        await fs.promises.writeFile(currentLog, truncated);
        console.info(`[Logger] Truncated current log to last 1000 lines`);
      }

      // 4. 恢复写入
      this.config.enableFile = wasEnabled;
      console.info('[Logger] ✅ Emergency cleanup completed');
    } catch (error) {
      console.error('[Logger] Emergency cleanup failed:', error);
    }
  }

  // 压缩旧日志文件
  private async compressOldLogs(logFile: string): Promise<void> {
    try {
      // 压缩从.2开始的旧日志，保留最新的.1不压缩
      for (let i = 2; i <= this.config.maxFiles; i++) {
        const oldFile = `${logFile}.${i}`;
        if (fs.existsSync(oldFile) && !oldFile.endsWith('.gz')) {
          await this.compressLogFile(oldFile);
        }
      }
    } catch (error) {
      console.warn('[Logger] Failed to compress old logs:', error);
    }
  }

  // 压缩单个日志文件
  private async compressLogFile(filePath: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(filePath);
      const compressed = await gzip(content);

      const compressedPath = `${filePath}.gz`;
      await fs.promises.writeFile(compressedPath, compressed);
      await fs.promises.unlink(filePath); // 删除原文件

      const savedPercent = Math.round((1 - compressed.length / content.length) * 100);
      console.info(`[Logger] Compressed ${path.basename(filePath)} (saved ${savedPercent}%)`);
    } catch (error) {
      console.error(`[Logger] Failed to compress ${filePath}:`, error);
    }
  }

  // 更改日志级别
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  // 清理资源
  destroy(): void {
    // 立即写入所有缓冲的日志
    this.writeToFile().catch(() => {
      // 忽略错误
    });
  }

  // 获取日志统计信息
  getStats(): {
    logDir: string;
    bufferSize: number;
    config: LoggerConfig;
  } {
    return {
      logDir: this.logDir,
      bufferSize: this.logBuffer.length,
      config: { ...this.config }
    };
  }
}

// 导出默认实例和便捷函数
export const logger = Logger.getInstance();

export const createLogger = (context: string): Logger => {
  return Logger.getLogger(context);
};

export default logger;