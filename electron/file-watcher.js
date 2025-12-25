/**
 * 文件监听服务
 *
 * 功能：
 * 1. 监听指定目录的文件变化
 * 2. 过滤文件类型和路径
 * 3. 防抖处理（避免频繁触发）
 * 4. 触发 'change' 事件
 *
 * 使用场景：开发环境的热更新
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class FileWatcher extends EventEmitter {
  /**
   * 构造函数
   * @param {Object} options - 配置选项
   * @param {string} options.watchPath - 监听的目录路径
   * @param {number} options.debounceDelay - 防抖延迟（毫秒）
   * @param {Array<string>} options.fileTypes - 监听的文件类型（如 ['.js', '.html', '.css']）
   * @param {Array<string>} options.ignorePaths - 忽略的路径模式（如 ['node_modules', '.git']）
   */
  constructor(options = {}) {
    super();

    this.watchPath = options.watchPath || '';
    this.debounceDelay = options.debounceDelay || 500;
    this.fileTypes = options.fileTypes || ['.js', '.html', '.css'];
    this.ignorePaths = options.ignorePaths || ['node_modules', '.git', 'dist', '.DS_Store'];

    this.watcher = null;
    this.debounceTimer = null;
    this.isWatching = false;
    this.changeCount = 0;

    console.log('[FileWatcher] Instance created with options:', {
      watchPath: this.watchPath,
      debounceDelay: this.debounceDelay,
      fileTypes: this.fileTypes
    });
  }

  /**
   * 启动文件监听
   */
  start() {
    if (this.isWatching) {
      console.log('[FileWatcher] Already watching');
      return;
    }

    if (!this.watchPath) {
      console.error('[FileWatcher] Watch path not specified');
      return;
    }

    if (!fs.existsSync(this.watchPath)) {
      console.error('[FileWatcher] Watch path does not exist:', this.watchPath);
      return;
    }

    console.log('[FileWatcher] Starting file watcher on:', this.watchPath);

    try {
      // 使用 fs.watch() 监听目录
      // recursive: true 在 macOS/Windows 上支持递归监听
      this.watcher = fs.watch(
        this.watchPath,
        { recursive: true },
        (eventType, filename) => {
          this.handleFileChange(eventType, filename);
        }
      );

      this.isWatching = true;
      console.log('[FileWatcher] File watching started successfully');
      this.emit('started');
    } catch (error) {
      console.error('[FileWatcher] Failed to start file watcher:', error);
      this.emit('error', error);
    }
  }

  /**
   * 停止文件监听
   */
  stop() {
    if (!this.isWatching) {
      console.log('[FileWatcher] Not watching');
      return;
    }

    console.log('[FileWatcher] Stopping file watcher...');

    // 清除防抖定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // 关闭文件监听器
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isWatching = false;
    console.log('[FileWatcher] File watching stopped');
    this.emit('stopped');
  }

  /**
   * 处理文件变化事件
   * @param {string} eventType - 事件类型 ('change' 或 'rename')
   * @param {string} filename - 变化的文件名（相对路径）
   */
  handleFileChange(eventType, filename) {
    if (!filename) {
      return;
    }

    // 过滤：忽略的路径
    if (this.shouldIgnorePath(filename)) {
      return;
    }

    // 过滤：文件类型
    if (!this.shouldWatchFile(filename)) {
      return;
    }

    this.changeCount++;
    const fullPath = path.join(this.watchPath, filename);

    console.log(`[FileWatcher] File ${eventType}: ${filename} (count: ${this.changeCount})`);

    // 防抖处理
    this.debounceFileChange(eventType, fullPath, filename);
  }

  /**
   * 检查文件是否应该被监听
   * @param {string} filename - 文件名
   * @returns {boolean}
   */
  shouldWatchFile(filename) {
    const ext = path.extname(filename);
    return this.fileTypes.includes(ext);
  }

  /**
   * 检查路径是否应该被忽略
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  shouldIgnorePath(filePath) {
    return this.ignorePaths.some(ignorePath => {
      return filePath.includes(ignorePath);
    });
  }

  /**
   * 防抖处理文件变化
   * @param {string} eventType - 事件类型
   * @param {string} fullPath - 完整路径
   * @param {string} relativePath - 相对路径
   */
  debounceFileChange(eventType, fullPath, relativePath) {
    // 清除之前的定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 设置新的定时器
    this.debounceTimer = setTimeout(() => {
      console.log(`[FileWatcher] Debounced change detected (${this.changeCount} changes in ${this.debounceDelay}ms)`);
      console.log(`[FileWatcher] Emitting 'change' event for: ${relativePath}`);

      // 触发 'change' 事件
      this.emit('change', {
        eventType,
        fullPath,
        relativePath,
        changeCount: this.changeCount
      });

      // 重置计数器
      this.changeCount = 0;
    }, this.debounceDelay);
  }

  /**
   * 获取监听状态
   * @returns {Object}
   */
  getStatus() {
    return {
      isWatching: this.isWatching,
      watchPath: this.watchPath,
      debounceDelay: this.debounceDelay,
      fileTypes: this.fileTypes,
      ignorePaths: this.ignorePaths,
      changeCount: this.changeCount
    };
  }
}

module.exports = FileWatcher;
