/**
 * URL采集专用日志记录器
 * 输出格式化的URL采集日志到 url-collect.log 文件
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface URLCollectLogEntry {
  timestamp: string;          // ISO 8601格式时间戳
  browserName: string;        // 浏览器名称
  url: string;                // 采集到的URL（已脱敏）
  collectionMethod?: string;  // 采集方法（applescript, window_title等）
  quality?: string;           // URL质量（full_url, domain_only, redacted）
  privacyLevel?: string;      // 隐私等级（full, domain_only, redacted）
  success: boolean;           // 是否采集成功
  errorMessage?: string;      // 错误信息（如果失败）
}

export class URLCollectLogger {
  private logFilePath: string;
  private logBuffer: URLCollectLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private maxBufferSize = 50;
  private flushIntervalMs = 5000; // 5秒flush一次

  constructor() {
    this.logFilePath = this.getLogFilePath();
    this.ensureLogDirectory();
    this.startAutoFlush();
  }

  /**
   * 记录URL采集成功
   */
  logSuccess(entry: Omit<URLCollectLogEntry, 'timestamp' | 'success'>): void {
    const logEntry: URLCollectLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      success: true
    };

    this.logBuffer.push(logEntry);

    // 输出到控制台（便于调试）
    console.log(`[URL-COLLECT] ✅ ${entry.browserName}: ${entry.url}`);

    // 如果缓冲区满了，立即flush
    if (this.logBuffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  /**
   * 记录URL采集失败
   */
  logFailure(browserName: string, errorMessage: string): void {
    const logEntry: URLCollectLogEntry = {
      timestamp: new Date().toISOString(),
      browserName,
      url: '',
      success: false,
      errorMessage
    };

    this.logBuffer.push(logEntry);

    // 输出到控制台
    console.log(`[URL-COLLECT] ❌ ${browserName}: ${errorMessage}`);

    // 如果缓冲区满了，立即flush
    if (this.logBuffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  /**
   * 立即flush所有缓冲的日志到文件
   */
  flush(): void {
    if (this.logBuffer.length === 0) {
      return;
    }

    const entries = [...this.logBuffer];
    this.logBuffer = [];

    try {
      // 格式化日志行
      const logLines = entries.map(entry => this.formatLogEntry(entry)).join('\n') + '\n';

      // 追加写入文件
      fs.appendFileSync(this.logFilePath, logLines, 'utf8');

      // 检查文件大小并轮转
      this.checkAndRotateLog();

    } catch (error) {
      console.error('[URLCollectLogger] Failed to flush logs:', error);
      // 失败时保留缓冲区数据
      this.logBuffer.unshift(...entries);
    }
  }

  /**
   * 格式化单条日志
   */
  private formatLogEntry(entry: URLCollectLogEntry): string {
    const parts = [
      entry.timestamp,
      entry.success ? 'SUCCESS' : 'FAILURE',
      entry.browserName,
      entry.url || 'N/A'
    ];

    // 添加可选字段
    if (entry.collectionMethod) {
      parts.push(`method:${entry.collectionMethod}`);
    }
    if (entry.quality) {
      parts.push(`quality:${entry.quality}`);
    }
    if (entry.privacyLevel) {
      parts.push(`privacy:${entry.privacyLevel}`);
    }
    if (entry.errorMessage) {
      parts.push(`error:${entry.errorMessage}`);
    }

    return parts.join(' | ');
  }

  /**
   * 检查日志文件大小并轮转
   */
  private checkAndRotateLog(): void {
    try {
      const stats = fs.statSync(this.logFilePath);
      const maxSize = 10 * 1024 * 1024; // 10MB

      if (stats.size > maxSize) {
        // 轮转日志文件
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = this.logFilePath.replace('.log', `.${timestamp}.log`);

        fs.renameSync(this.logFilePath, rotatedPath);
        console.log(`[URLCollectLogger] Log rotated to: ${rotatedPath}`);

        // 清理旧的轮转文件（保留最近5个）
        this.cleanupOldRotatedLogs();
      }
    } catch (error) {
      // 文件不存在时会失败，忽略
    }
  }

  /**
   * 清理旧的轮转日志文件
   */
  private cleanupOldRotatedLogs(): void {
    try {
      const logDir = path.dirname(this.logFilePath);
      const files = fs.readdirSync(logDir);

      // 找出所有轮转的url-collect日志
      const rotatedLogs = files
        .filter(f => f.startsWith('url-collect.') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(logDir, f),
          mtime: fs.statSync(path.join(logDir, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime); // 按时间降序

      // 保留最近5个，删除其余的
      const maxRotatedFiles = 5;
      if (rotatedLogs.length > maxRotatedFiles) {
        for (let i = maxRotatedFiles; i < rotatedLogs.length; i++) {
          fs.unlinkSync(rotatedLogs[i].path);
          console.log(`[URLCollectLogger] Deleted old log: ${rotatedLogs[i].name}`);
        }
      }
    } catch (error) {
      console.error('[URLCollectLogger] Failed to cleanup old logs:', error);
    }
  }

  /**
   * 启动自动flush定时器
   */
  private startAutoFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);

    // 确保进程退出时flush
    process.on('exit', () => {
      this.flush();
    });

    process.on('SIGINT', () => {
      this.flush();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.flush();
      process.exit(0);
    });
  }

  /**
   * 停止logger并flush所有数据
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }

  /**
   * 获取日志文件路径
   */
  private getLogFilePath(): string {
    const logDir = this.getLogDirectory();
    return path.join(logDir, 'url-collect.log');
  }

  /**
   * 获取日志目录（与主logger保持一致）
   */
  private getLogDirectory(): string {
    try {
      // 与主logger使用相同的目录结构
      const appDataDir = process.env.APPDATA ||
                        path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Logs' : '.local/share');
      return path.join(appDataDir, 'employee-monitor', 'logs');
    } catch {
      // 后备选项：当前目录的logs文件夹
      return path.join(process.cwd(), 'logs');
    }
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDirectory(): void {
    try {
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
        console.log(`[URLCollectLogger] Created log directory: ${logDir}`);
      }
    } catch (error) {
      console.error('[URLCollectLogger] Failed to create log directory:', error);
    }
  }

  /**
   * 获取日志文件路径（公共方法）
   */
  getLogPath(): string {
    return this.logFilePath;
  }

  /**
   * 读取最近的N条日志
   */
  readRecentLogs(count: number = 100): URLCollectLogEntry[] {
    try {
      if (!fs.existsSync(this.logFilePath)) {
        return [];
      }

      const content = fs.readFileSync(this.logFilePath, 'utf8');
      const lines = content.trim().split('\n');

      // 取最后N行
      const recentLines = lines.slice(-count);

      // 解析日志行
      return recentLines.map(line => this.parseLogLine(line)).filter(Boolean) as URLCollectLogEntry[];
    } catch (error) {
      console.error('[URLCollectLogger] Failed to read logs:', error);
      return [];
    }
  }

  /**
   * 解析日志行
   */
  private parseLogLine(line: string): URLCollectLogEntry | null {
    try {
      const parts = line.split(' | ');
      if (parts.length < 4) return null;

      const entry: URLCollectLogEntry = {
        timestamp: parts[0],
        success: parts[1] === 'SUCCESS',
        browserName: parts[2],
        url: parts[3]
      };

      // 解析可选字段
      for (let i = 4; i < parts.length; i++) {
        const [key, value] = parts[i].split(':');
        if (key === 'method') entry.collectionMethod = value;
        if (key === 'quality') entry.quality = value;
        if (key === 'privacy') entry.privacyLevel = value;
        if (key === 'error') entry.errorMessage = value;
      }

      return entry;
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    logPath: string;
    bufferSize: number;
    fileSize: number;
    recentSuccessRate: number;
  } {
    let fileSize = 0;
    try {
      fileSize = fs.statSync(this.logFilePath).size;
    } catch {
      // 文件不存在
    }

    // 计算最近100条的成功率
    const recentLogs = this.readRecentLogs(100);
    const successCount = recentLogs.filter(log => log.success).length;
    const recentSuccessRate = recentLogs.length > 0 ? successCount / recentLogs.length : 0;

    return {
      logPath: this.logFilePath,
      bufferSize: this.logBuffer.length,
      fileSize,
      recentSuccessRate
    };
  }
}

// 单例实例
let urlCollectLoggerInstance: URLCollectLogger | null = null;

/**
 * 获取URL采集logger单例
 */
export function getURLCollectLogger(): URLCollectLogger {
  if (!urlCollectLoggerInstance) {
    urlCollectLoggerInstance = new URLCollectLogger();
  }
  return urlCollectLoggerInstance;
}

/**
 * 便捷方法：记录成功的URL采集
 */
export function logURLCollected(
  browserName: string,
  url: string,
  options?: {
    collectionMethod?: string;
    quality?: string;
    privacyLevel?: string;
  }
): void {
  const logger = getURLCollectLogger();
  logger.logSuccess({
    browserName,
    url,
    ...options
  });
}

/**
 * 便捷方法：记录失败的URL采集
 */
export function logURLCollectFailed(browserName: string, errorMessage: string): void {
  const logger = getURLCollectLogger();
  logger.logFailure(browserName, errorMessage);
}
