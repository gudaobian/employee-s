/**
 * 增强版热更新管理器
 *
 * 新功能：
 * 1. 支持更多文件类型（.json, .scss, .ts）
 * 2. 智能重载（CSS 变化时只刷新样式）
 * 3. 重载通知和进度条
 * 4. 性能统计和调试信息
 * 5. 可配置的热更新选项
 */

const path = require('path');
const EventEmitter = require('events');
const FileWatcher = require('./file-watcher');

class EnhancedHotReloadManager extends EventEmitter {
  /**
   * 构造函数
   * @param {BrowserWindow} mainWindow - 主窗口实例
   * @param {Object} options - 配置选项
   */
  constructor(mainWindow, options = {}) {
    super();

    this.mainWindow = mainWindow;
    this.fileWatcher = null;
    this.isEnabled = false;
    this.reloadCount = 0;

    // 性能统计
    this.stats = {
      totalReloads: 0,
      cssOnlyReloads: 0,
      fullReloads: 0,
      averageReloadTime: 0,
      reloadTimes: [],
      lastReloadTime: null,
      fileChangeCounts: {}
    };

    // 配置选项
    this.options = {
      // 监听路径
      watchPath: options.watchPath || path.join(__dirname, 'renderer'),

      // 文件类型（扩展支持）
      fileTypes: options.fileTypes || [
        '.js', '.html', '.css',   // 基础类型
        '.json', '.scss', '.ts',  // 新增类型
        '.jsx', '.tsx', '.less'   // 可选类型
      ],

      // 忽略路径
      ignorePaths: options.ignorePaths || [
        'node_modules', '.git', 'dist',
        '.DS_Store', '*.map', '*.min.js'
      ],

      // 防抖延迟
      debounceDelay: options.debounceDelay || 500,

      // 重载延迟
      reloadDelay: options.reloadDelay || 100,

      // 智能重载
      smartReload: options.smartReload !== false, // 默认启用

      // 显示通知
      showNotifications: options.showNotifications !== false,

      // 显示进度条
      showProgress: options.showProgress !== false,

      // 调试模式
      debug: options.debug || false,

      // 性能统计
      enableStats: options.enableStats !== false,

      ...options
    };

    this.log('Instance created with options:', this.options);
  }

  /**
   * 日志输出
   */
  log(...args) {
    if (this.options.debug) {
      console.log('[EnhancedHotReloadManager]', ...args);
    }
  }

  /**
   * 启动热更新
   */
  start() {
    if (this.isEnabled) {
      this.log('Hot reload already enabled');
      return;
    }

    this.log('Starting hot reload...');

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
      this.log('File watcher started');
      this.emit('started');
    });

    // 监听错误事件
    this.fileWatcher.on('error', (error) => {
      console.error('[EnhancedHotReloadManager] File watcher error:', error);
      this.emit('error', error);
    });

    // 启动文件监听
    this.fileWatcher.start();
    this.isEnabled = true;

    this.log('Hot reload started successfully');
  }

  /**
   * 停止热更新
   */
  stop() {
    if (!this.isEnabled) {
      this.log('Hot reload not enabled');
      return;
    }

    this.log('Stopping hot reload...');

    // 停止文件监听
    if (this.fileWatcher) {
      this.fileWatcher.stop();
      this.fileWatcher = null;
    }

    this.isEnabled = false;

    this.log('Hot reload stopped');
    this.emit('stopped');
  }

  /**
   * 处理文件变化
   * @param {Object} data - 文件变化数据
   */
  handleFileChange(data) {
    const { relativePath, changeCount, fullPath } = data;

    this.log(`File change detected: ${relativePath}`);
    this.log(`${changeCount} changes detected`);

    // 更新统计
    if (this.options.enableStats) {
      this.stats.fileChangeCounts[relativePath] =
        (this.stats.fileChangeCounts[relativePath] || 0) + changeCount;
    }

    // 判断文件类型，决定重载策略
    const fileExt = path.extname(relativePath).toLowerCase();
    const isStyleFile = ['.css', '.scss', '.less'].includes(fileExt);

    if (this.options.smartReload && isStyleFile) {
      // CSS 文件变化：智能重载（只刷新样式）
      this.reloadStyles(relativePath);
    } else {
      // 其他文件：完整重载
      this.reload(relativePath);
    }
  }

  /**
   * 智能重载：只刷新 CSS 样式
   * @param {string} filePath - 变化的文件路径
   */
  async reloadStyles(filePath) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.error('[EnhancedHotReloadManager] Main window not available');
      return;
    }

    this.reloadCount++;
    const startTime = Date.now();

    this.log(`CSS-only reload #${this.reloadCount} starting for: ${filePath}`);

    try {
      // 发送样式重载通知
      if (this.options.showNotifications) {
        this.mainWindow.webContents.send('hot-reload:style-update', {
          filePath,
          reloadCount: this.reloadCount,
          timestamp: Date.now()
        });
      }

      // 执行 CSS 刷新（不重载整个页面）
      await this.mainWindow.webContents.executeJavaScript(`
        (function() {
          const links = document.querySelectorAll('link[rel="stylesheet"]');
          links.forEach(link => {
            const href = link.href;
            link.href = href.split('?')[0] + '?reload=' + Date.now();
          });
          console.log('[HOT-RELOAD] CSS styles refreshed');
        })();
      `);

      const endTime = Date.now();
      const reloadTime = endTime - startTime;

      // 更新统计
      if (this.options.enableStats) {
        this.stats.totalReloads++;
        this.stats.cssOnlyReloads++;
        this.stats.lastReloadTime = reloadTime;
        this.stats.reloadTimes.push(reloadTime);
        this.updateAverageReloadTime();
      }

      this.log(`CSS-only reload #${this.reloadCount} completed in ${reloadTime}ms`);

      // 发送完成通知
      if (this.options.showNotifications) {
        this.mainWindow.webContents.send('hot-reload:complete', {
          type: 'css-only',
          reloadCount: this.reloadCount,
          reloadTime,
          filePath
        });
      }

      this.emit('reload-complete', {
        type: 'css-only',
        reloadCount: this.reloadCount,
        reloadTime,
        filePath
      });

    } catch (error) {
      console.error(`[EnhancedHotReloadManager] CSS reload #${this.reloadCount} failed:`, error);

      // 发送错误通知
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('hot-reload:error', {
          message: error.message,
          reloadCount: this.reloadCount,
          filePath
        });
      }

      this.emit('reload-error', error);
    }
  }

  /**
   * 完整重载
   * @param {string} filePath - 变化的文件路径
   */
  async reload(filePath = 'unknown') {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.error('[EnhancedHotReloadManager] Main window not available');
      return;
    }

    this.reloadCount++;
    const startTime = Date.now();

    this.log(`Full reload #${this.reloadCount} starting for: ${filePath}`);

    try {
      // 1. 发送重载通知到渲染进程
      if (this.options.showNotifications) {
        this.log('Sending reload notification to renderer...');
        this.mainWindow.webContents.send('hot-reload:prepare', {
          filePath,
          reloadCount: this.reloadCount,
          timestamp: Date.now()
        });
      }

      // 2. 等待渲染进程保存状态
      if (this.options.showProgress) {
        this.mainWindow.webContents.send('hot-reload:progress', {
          step: 'saving-state',
          progress: 33
        });
      }

      this.log(`Waiting ${this.options.reloadDelay}ms for state save...`);
      await this.sleep(this.options.reloadDelay);

      // 3. 执行重载
      if (this.options.showProgress) {
        this.mainWindow.webContents.send('hot-reload:progress', {
          step: 'reloading',
          progress: 66
        });
      }

      this.log('Executing window reload...');
      this.mainWindow.reload();

      const endTime = Date.now();
      const reloadTime = endTime - startTime;

      // 更新统计
      if (this.options.enableStats) {
        this.stats.totalReloads++;
        this.stats.fullReloads++;
        this.stats.lastReloadTime = reloadTime;
        this.stats.reloadTimes.push(reloadTime);
        this.updateAverageReloadTime();
      }

      this.log(`Full reload #${this.reloadCount} completed in ${reloadTime}ms`);

      // 发送完成通知（延迟发送，等待页面重载完成）
      setTimeout(() => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('hot-reload:complete', {
            type: 'full',
            reloadCount: this.reloadCount,
            reloadTime,
            filePath
          });

          if (this.options.showProgress) {
            this.mainWindow.webContents.send('hot-reload:progress', {
              step: 'complete',
              progress: 100
            });
          }
        }
      }, 1000);

      this.emit('reload-complete', {
        type: 'full',
        reloadCount: this.reloadCount,
        reloadTime,
        filePath
      });

    } catch (error) {
      console.error(`[EnhancedHotReloadManager] Full reload #${this.reloadCount} failed:`, error);

      // 发送错误通知
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('hot-reload:error', {
          message: error.message,
          reloadCount: this.reloadCount,
          filePath
        });
      }

      this.emit('reload-error', error);
    }
  }

  /**
   * 更新平均重载时间
   */
  updateAverageReloadTime() {
    const times = this.stats.reloadTimes;
    if (times.length === 0) {
      this.stats.averageReloadTime = 0;
      return;
    }

    // 保留最近 100 次记录
    if (times.length > 100) {
      this.stats.reloadTimes = times.slice(-100);
    }

    const sum = this.stats.reloadTimes.reduce((a, b) => a + b, 0);
    this.stats.averageReloadTime = Math.round(sum / this.stats.reloadTimes.length);
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
      fileTypes: this.options.fileTypes,
      smartReload: this.options.smartReload,
      stats: this.options.enableStats ? this.stats : null,
      fileWatcher: this.fileWatcher ? this.fileWatcher.getStatus() : null
    };
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    if (!this.options.enableStats) {
      return null;
    }

    return {
      ...this.stats,
      successRate: this.stats.totalReloads > 0
        ? ((this.stats.totalReloads / (this.stats.totalReloads + this.stats.failedReloads || 0)) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalReloads: 0,
      cssOnlyReloads: 0,
      fullReloads: 0,
      averageReloadTime: 0,
      reloadTimes: [],
      lastReloadTime: null,
      fileChangeCounts: {}
    };
    this.log('Statistics reset');
  }

  /**
   * 更新配置
   * @param {Object} newOptions - 新配置
   */
  updateOptions(newOptions) {
    const needsRestart = this.isEnabled && (
      newOptions.watchPath !== this.options.watchPath ||
      JSON.stringify(newOptions.fileTypes) !== JSON.stringify(this.options.fileTypes)
    );

    Object.assign(this.options, newOptions);
    this.log('Options updated:', newOptions);

    if (needsRestart) {
      this.log('Restarting due to configuration change...');
      this.stop();
      this.start();
    }

    this.emit('options-updated', this.options);
  }
}

module.exports = EnhancedHotReloadManager;
