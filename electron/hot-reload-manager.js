/**
 * 热更新管理器
 *
 * 功能：
 * 1. 管理文件监听器
 * 2. 触发渲染进程重载
 * 3. 处理重载流程
 *
 * 使用场景：开发环境
 */

const path = require('path');
const FileWatcher = require('./file-watcher');

class HotReloadManager {
  /**
   * 构造函数
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @param {Object} options - 配置选项
   */
  constructor(mainWindow, options = {}) {
    this.mainWindow = mainWindow;
    this.fileWatcher = null;
    this.isEnabled = false;
    this.reloadCount = 0;

    // 配置选项
    this.options = {
      watchPath: options.watchPath || path.join(__dirname, 'renderer'),
      debounceDelay: options.debounceDelay || 500,
      fileTypes: options.fileTypes || ['.js', '.html', '.css'],
      ignorePaths: options.ignorePaths || ['node_modules', '.git', 'dist', '.DS_Store'],
      reloadDelay: options.reloadDelay || 100, // 重载前的延迟（给渲染进程时间保存状态）
      ...options
    };

    console.log('[HotReloadManager] Instance created with options:', this.options);
  }

  /**
   * 启动热更新
   */
  start() {
    if (this.isEnabled) {
      console.log('[HotReloadManager] Hot reload already enabled');
      return;
    }

    console.log('[HotReloadManager] Starting hot reload...');

    // 创建文件监听器
    this.fileWatcher = new FileWatcher({
      watchPath: this.options.watchPath,
      debounceDelay: this.options.debounceDelay,
      fileTypes: this.options.fileTypes,
      ignorePaths: this.options.ignorePaths
    });

    // 监听文件变化事件
    this.fileWatcher.on('change', (data) => {
      this.handleFileChange(data);
    });

    // 监听启动事件
    this.fileWatcher.on('started', () => {
      console.log('[HotReloadManager] File watcher started');
    });

    // 监听错误事件
    this.fileWatcher.on('error', (error) => {
      console.error('[HotReloadManager] File watcher error:', error);
    });

    // 启动文件监听
    this.fileWatcher.start();
    this.isEnabled = true;

    console.log('[HotReloadManager] Hot reload started successfully');
  }

  /**
   * 停止热更新
   */
  stop() {
    if (!this.isEnabled) {
      console.log('[HotReloadManager] Hot reload not enabled');
      return;
    }

    console.log('[HotReloadManager] Stopping hot reload...');

    // 停止文件监听
    if (this.fileWatcher) {
      this.fileWatcher.stop();
      this.fileWatcher = null;
    }

    this.isEnabled = false;

    console.log('[HotReloadManager] Hot reload stopped');
  }

  /**
   * 处理文件变化
   * @param {Object} data - 文件变化数据
   */
  handleFileChange(data) {
    const { relativePath, changeCount } = data;

    console.log(`[HotReloadManager] File change detected: ${relativePath}`);
    console.log(`[HotReloadManager] ${changeCount} changes detected, triggering reload...`);

    // 触发重载
    this.reload();
  }

  /**
   * 执行重载
   */
  async reload() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.error('[HotReloadManager] Main window not available');
      return;
    }

    this.reloadCount++;
    console.log(`[HotReloadManager] Reload #${this.reloadCount} starting...`);

    try {
      // 1. 发送重载通知到渲染进程
      console.log('[HotReloadManager] Sending reload notification to renderer...');
      this.mainWindow.webContents.send('reload-renderer');

      // 2. 等待渲染进程保存状态
      console.log(`[HotReloadManager] Waiting ${this.options.reloadDelay}ms for state save...`);
      await this.sleep(this.options.reloadDelay);

      // 3. 执行重载
      console.log('[HotReloadManager] Executing window reload...');
      this.mainWindow.reload();

      console.log(`[HotReloadManager] Reload #${this.reloadCount} completed`);
    } catch (error) {
      console.error(`[HotReloadManager] Reload #${this.reloadCount} failed:`, error);

      // 可选：显示错误通知
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('hot-reload-error', {
          message: error.message,
          reloadCount: this.reloadCount
        });
      }
    }
  }

  /**
   * 睡眠函数
   * @param {number} ms - 毫秒数
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取状态
   * @returns {Object}
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      reloadCount: this.reloadCount,
      watchPath: this.options.watchPath,
      fileWatcher: this.fileWatcher ? this.fileWatcher.getStatus() : null
    };
  }
}

module.exports = HotReloadManager;
