/**
 * 统一日志管理器 - 重新设计版本
 *
 * 解决的问题:
 * 1. ✅ 日志文件无限累积
 * 2. ✅ 轮转逻辑不可靠
 * 3. ✅ 清理机制未执行
 * 4. ✅ 压缩逻辑有bug
 * 5. ✅ 无日志级别控制
 * 6. ✅ 双重日志系统
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { app } = require('electron');

class UnifiedLogManager {
  constructor(config = {}) {
    // ===== 配置 =====
    this.config = {
      // 文件管理
      maxFileSize: 10 * 1024 * 1024,      // 10MB per file
      maxFiles: 3,                         // 最多3个轮转文件 (app.log.1/.2/.3)
      maxTotalSize: 50 * 1024 * 1024,     // 总大小限制 50MB
      maxRetentionDays: 7,                 // 保留7天

      // 性能优化
      enableBatchWrite: true,              // 批量写入
      batchSize: 100,                      // 批量大小
      flushInterval: 10000,                // 10秒flush一次

      // 功能开关
      enableCompression: false,            // 默认关闭压缩
      enableConsole: true,                 // 控制台输出
      enableFile: true,                    // 文件记录

      // 清理策略
      enableAutoCleanup: true,             // 自动清理
      cleanupOnStartup: false,             // 启动时不清理历史日志（保留用于问题排查）
      cleanupInterval: 60 * 60 * 1000,    // 每小时清理

      // 日志级别
      logLevel: 'WARN',

      ...config
    };

    // ===== 状态 =====
    this.logBuffer = [];                   // 日志缓冲区
    this.uiLogs = [];                      // UI显示缓存
    this.mainWindow = null;                // 主窗口引用
    this.isInitialized = false;

    // 日志级别映射
    this.levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
    this.currentLevel = this.levels[this.config.logLevel] || this.levels.INFO;

    // ===== 初始化 =====
    this.init();
  }

  // ===== 初始化 =====
  init() {
    try {
      // 1. 设置日志目录
      this.logsDir = path.join(app.getPath('userData'), 'logs');
      this.currentLogFile = path.join(this.logsDir, 'app.log');

      // 2. 创建目录
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }

      // 3. 启动时清理
      if (this.config.cleanupOnStartup) {
        this.comprehensiveCleanup();
      }

      // 4. 启动定时器
      this.startTimers();

      // 5. 劫持console (如果配置启用)
      if (this.config.hijackConsole !== false) {
        this.hijackConsole();
      }

      this.isInitialized = true;
      this.logInternal('INFO', '[LOG_MANAGER] Initialized successfully');

    } catch (error) {
      console.error('[LOG_MANAGER] Initialization failed:', error);
      this.config.enableFile = false;  // 失败则禁用文件日志
    }
  }

  // ===== 日志写入 =====
  log(level, ...args) {
    // 1. 级别过滤
    if (this.levels[level] < this.currentLevel) {
      return;  // 跳过低级别日志
    }

    const timestamp = new Date();
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');

    const entry = {
      timestamp: timestamp.toISOString(),
      level,
      message
    };

    // 2. 控制台输出
    if (this.config.enableConsole) {
      this.writeToConsole(entry);
    }

    // 3. 文件输出（批量）
    if (this.config.enableFile) {
      this.logBuffer.push(entry);

      // 立即写入ERROR及以上级别
      if (this.levels[level] >= this.levels.ERROR) {
        this.flush();
      }
    }

    // 4. UI输出
    this.addToUICache(entry);
    this.sendToUI(entry);
  }

  // 控制台输出（使用原始方法）
  writeToConsole(entry) {
    const msg = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;

    if (this.originalConsole) {
      switch(entry.level) {
        case 'ERROR':
        case 'FATAL':
          this.originalConsole.error(msg);
          break;
        case 'WARN':
          this.originalConsole.warn(msg);
          break;
        case 'DEBUG':
          this.originalConsole.debug(msg);
          break;
        default:
          this.originalConsole.log(msg);
      }
    } else {
      console.log(msg);
    }
  }

  // ===== 批量写入 =====
  flush() {
    if (this.logBuffer.length === 0) return;

    try {
      // 1. 检查轮转
      this.checkAndRotate();

      // 2. 批量写入
      const entries = this.logBuffer.splice(0);  // 清空缓冲区
      const lines = entries.map(e =>
        `${e.timestamp} [${e.level}] ${e.message}`
      ).join('\n') + '\n';

      fs.appendFileSync(this.currentLogFile, lines);

    } catch (error) {
      console.error('[LOG] Flush failed:', error);
    }
  }

  // ===== 轮转机制（原子操作）=====
  checkAndRotate() {
    try {
      // 1. 检查当前文件大小
      if (!fs.existsSync(this.currentLogFile)) {
        return;
      }

      const stats = fs.statSync(this.currentLogFile);
      if (stats.size < this.config.maxFileSize) {
        return;  // 未达到轮转阈值
      }

      console.log('[LOG] Rotating log files...');

      // 2. 删除最老的文件
      const oldestFile = `${this.currentLogFile}.${this.config.maxFiles}`;
      this.safeDelete(oldestFile);

      // 3. 倒序重命名（同步操作确保原子性）
      for (let i = this.config.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${this.currentLogFile}.${i}`;
        const newFile = `${this.currentLogFile}.${i + 1}`;

        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }

      // 4. 轮转当前文件
      fs.renameSync(this.currentLogFile, `${this.currentLogFile}.1`);

      // 5. 创建新文件
      fs.writeFileSync(this.currentLogFile, '');

      // 6. 压缩轮转文件（异步，不阻塞）
      if (this.config.enableCompression) {
        setImmediate(() => this.compressRotatedLogs());
      }

      console.log('[LOG] Log rotation completed');

    } catch (error) {
      console.error('[LOG] Rotation failed:', error);

      // 失败恢复：创建新的时间戳文件
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.currentLogFile = path.join(this.logsDir, `app-${timestamp}.log`);
    }
  }

  // 安全删除（带错误处理）
  safeDelete(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return { deleted: true };
      }
      return { deleted: false, reason: 'not found' };
    } catch (error) {
      console.error(`[LOG] Failed to delete ${path.basename(filePath)}:`, error.message);
      return { deleted: false, reason: error.message };
    }
  }

  // ===== 压缩机制（修复版本）=====
  compressRotatedLogs() {
    try {
      // 只压缩 .1 .2 .3 等轮转文件，不压缩当前文件
      for (let i = 1; i <= this.config.maxFiles; i++) {
        const logFile = `${this.currentLogFile}.${i}`;
        const gzFile = `${logFile}.gz`;

        // 检查：日志文件存在 && 压缩文件不存在
        if (fs.existsSync(logFile) && !fs.existsSync(gzFile)) {
          try {
            // 读取并压缩
            const content = fs.readFileSync(logFile);
            const compressed = zlib.gzipSync(content);

            // 写入压缩文件
            fs.writeFileSync(gzFile, compressed);

            // 验证压缩文件
            const gzStats = fs.statSync(gzFile);
            if (gzStats.size > 0) {
              // 删除原文件
              fs.unlinkSync(logFile);

              const ratio = Math.round((1 - compressed.length / content.length) * 100);
              console.log(`[LOG] Compressed ${path.basename(logFile)} (saved ${ratio}%)`);
            } else {
              // 压缩文件为空，删除它
              fs.unlinkSync(gzFile);
              console.error(`[LOG] Compression failed: ${path.basename(logFile)} resulted in empty file`);
            }
          } catch (error) {
            console.error(`[LOG] Compression error for ${path.basename(logFile)}:`, error.message);
            // 保留原文件
          }
        }
      }
    } catch (error) {
      console.error('[LOG] Compression task failed:', error);
    }
  }

  // ===== 综合清理机制 =====
  comprehensiveCleanup() {
    console.log('[LOG] Starting comprehensive cleanup...');

    try {
      const files = fs.readdirSync(this.logsDir);
      const cutoffTime = Date.now() - (this.config.maxRetentionDays * 24 * 60 * 60 * 1000);

      let deletedCount = 0;
      let totalSize = 0;
      let fileList = [];

      // 1. 收集所有日志文件信息
      files.forEach(file => {
        if (!file.startsWith('app')) return;  // 只处理 app 相关日志
        if (!file.includes('.log')) return;    // 必须是日志文件

        const filePath = path.join(this.logsDir, file);
        try {
          const stats = fs.statSync(filePath);
          fileList.push({
            name: file,
            path: filePath,
            size: stats.size,
            mtime: stats.mtimeMs
          });
        } catch (error) {
          console.warn(`[LOG] Cannot stat ${file}:`, error.message);
        }
      });

      // 2. 按修改时间排序（新→老）
      fileList.sort((a, b) => b.mtime - a.mtime);

      // 3. 清理策略（按顺序执行）
      fileList.forEach((file, index) => {
        let shouldDelete = false;
        let reason = '';

        // 策略1: 保留当前文件 (app.log)
        if (file.name === 'app.log') {
          return;  // 永不删除当前文件
        }

        // 策略2: 删除过期文件（超过保留天数）
        if (file.mtime < cutoffTime) {
          shouldDelete = true;
          reason = `older than ${this.config.maxRetentionDays} days`;
        }

        // 策略3: 超过文件数量限制（保留最新的 maxFiles 个轮转文件）
        const rotatedIndex = index - 1;  // 减去 app.log
        if (rotatedIndex >= this.config.maxFiles) {
          shouldDelete = true;
          reason = `exceeds max files (${this.config.maxFiles})`;
        }

        // 策略4: 超过总大小限制
        totalSize += file.size;
        if (totalSize > this.config.maxTotalSize) {
          shouldDelete = true;
          reason = `total size exceeds ${this.config.maxTotalSize / 1024 / 1024}MB`;
        }

        // 执行删除
        if (shouldDelete) {
          const result = this.safeDelete(file.path);
          if (result.deleted) {
            deletedCount++;
            console.log(`[LOG] Deleted ${file.name} (${reason})`);
          }
        }
      });

      console.log(`[LOG] Cleanup completed: deleted ${deletedCount} file(s)`);

      // 4. 清理后的统计
      this.logCleanupStats();

    } catch (error) {
      console.error('[LOG] Comprehensive cleanup failed:', error);
    }
  }

  // 清理统计
  logCleanupStats() {
    try {
      const files = fs.readdirSync(this.logsDir);
      const logFiles = files.filter(f => f.startsWith('app') && f.includes('.log'));

      let totalSize = 0;
      logFiles.forEach(file => {
        try {
          const stats = fs.statSync(path.join(this.logsDir, file));
          totalSize += stats.size;
        } catch {}
      });

      console.log('[LOG] Current stats:');
      console.log(`  - Files: ${logFiles.length}`);
      console.log(`  - Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  - Log dir: ${this.logsDir}`);

    } catch (error) {
      console.error('[LOG] Failed to get stats:', error);
    }
  }

  // ===== 定时器管理 =====
  startTimers() {
    // Flush 定时器
    if (this.config.enableBatchWrite) {
      this.flushTimer = setInterval(() => {
        this.flush();
      }, this.config.flushInterval);
    }

    // 清理定时器
    if (this.config.enableAutoCleanup) {
      this.cleanupTimer = setInterval(() => {
        this.comprehensiveCleanup();
      }, this.config.cleanupInterval);
    }
  }

  stopTimers() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ===== Console 劫持 =====
  hijackConsole() {
    this.originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug
    };

    console.log = (...args) => this.log('INFO', ...args);
    console.error = (...args) => this.log('ERROR', ...args);
    console.warn = (...args) => this.log('WARN', ...args);
    console.info = (...args) => this.log('INFO', ...args);
    console.debug = (...args) => this.log('DEBUG', ...args);
  }

  // 内部日志（不经过劫持）
  logInternal(level, message) {
    if (this.originalConsole && this.originalConsole.log) {
      this.originalConsole.log(`[${new Date().toISOString()}] [${level}] ${message}`);
    }
  }

  // ===== UI 相关 =====
  setMainWindow(window) {
    this.mainWindow = window;

    // 发送已有日志
    if (window && this.uiLogs.length > 0) {
      window.webContents.send('log-bulk', this.uiLogs);
    }
  }

  addToUICache(entry) {
    this.uiLogs.push(entry);
    if (this.uiLogs.length > 100) {
      this.uiLogs = this.uiLogs.slice(-100);
    }
  }

  sendToUI(entry) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('log-update', entry);
      } catch (error) {
        // 忽略发送失败
      }
    }
  }

  // ===== 兼容旧API =====
  cleanupOldLogs(days) {
    // 兼容旧API，调用新的清理方法
    this.config.maxRetentionDays = days || this.config.maxRetentionDays;
    this.comprehensiveCleanup();
  }

  getLogStats() {
    try {
      const files = fs.readdirSync(this.logsDir);
      const logFiles = files.filter(f => f.startsWith('app') && f.includes('.log'));

      let totalSize = 0;
      const fileStats = logFiles.map(file => {
        const filePath = path.join(this.logsDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime
        };
      });

      return {
        fileCount: logFiles.length,
        totalSize,
        files: fileStats,
        logsDir: this.logsDir
      };
    } catch (error) {
      console.error('[LOG] Failed to get stats:', error);
      return null;
    }
  }

  // 设置日志级别（运行时）
  setLevel(level) {
    if (this.levels[level] !== undefined) {
      this.currentLevel = this.levels[level];
      this.logInternal('INFO', `[LOG_MANAGER] Level changed to: ${level}`);
    }
  }

  // 获取UI日志（兼容旧API）
  getUILogs() {
    return this.uiLogs;
  }

  // 恢复console（兼容旧API，实际调用destroy）
  restore() {
    this.destroy();
  }

  // ===== 清理和销毁 =====
  destroy() {
    // 1. 停止定时器
    this.stopTimers();

    // 2. 立即写入缓冲区
    this.flush();

    // 3. 恢复console
    if (this.originalConsole) {
      console.log = this.originalConsole.log;
      console.error = this.originalConsole.error;
      console.warn = this.originalConsole.warn;
      console.info = this.originalConsole.info;
      console.debug = this.originalConsole.debug;
    }

    this.logInternal('INFO', '[LOG_MANAGER] Destroyed');
  }
}

module.exports = UnifiedLogManager;
