/**
 * 日志工具 - 重构版本
 * 统一的日志管理系统
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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
}

export class Logger {
  private config: LoggerConfig;
  private logDir: string;
  private logBuffer: LogEntry[] = [];
  private flushTimer?: NodeJS.Timeout;

  private static instance?: Logger;
  private static loggers = new Map<string, Logger>();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: true,
      maxFileSize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      ...config
    };

    this.logDir = this.config.logDir || this.getDefaultLogDir();
    this.ensureLogDirectory();
    this.startFlushTimer();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  static getLogger(context: string): Logger {
    if (!Logger.loggers.has(context)) {
      Logger.loggers.set(context, new Logger({ contextName: context }));
    }
    return Logger.loggers.get(context)!;
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
      const entries = [...this.logBuffer];
      this.logBuffer = [];

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
        // 轮转日志文件
        for (let i = this.config.maxFiles - 1; i > 0; i--) {
          const oldFile = `${logFile}.${i}`;
          const newFile = `${logFile}.${i + 1}`;
          
          try {
            await fs.promises.access(oldFile);
            if (i === this.config.maxFiles - 1) {
              await fs.promises.unlink(oldFile);
            } else {
              await fs.promises.rename(oldFile, newFile);
            }
          } catch {
            // 文件不存在，忽略
          }
        }

        // 重命名当前文件
        await fs.promises.rename(logFile, `${logFile}.1`);
      }
    } catch {
      // 文件不存在或其他错误，忽略
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

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.writeToFile().catch(() => {
        // 忽略flush错误，避免无限递归
      });
    }, 5000); // 每5秒flush一次
  }

  // 立即flush所有缓冲的日志
  async flush(): Promise<void> {
    await this.writeToFile();
  }

  // 更改日志级别
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  // 清理资源
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

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