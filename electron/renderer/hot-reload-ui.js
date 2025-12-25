/**
 * 热更新 UI 组件
 *
 * 功能：
 * 1. 显示重载通知
 * 2. 显示进度条
 * 3. 显示重载统计
 * 4. 提供配置界面
 */

class HotReloadUI {
  constructor(options = {}) {
    this.options = {
      position: options.position || 'top-right', // top-right, top-left, bottom-right, bottom-left
      autoHide: options.autoHide !== false, // 自动隐藏
      autoHideDelay: options.autoHideDelay || 3000, // 自动隐藏延迟
      showStats: options.showStats !== false, // 显示统计
      theme: options.theme || 'dark', // dark, light
      ...options
    };

    this.container = null;
    this.notification = null;
    this.progressBar = null;
    this.statsPanel = null;
    this.configPanel = null;

    this.init();
    this.setupEventListeners();
  }

  /**
   * 初始化 UI
   */
  init() {
    this.createContainer();
    this.createNotification();
    this.createProgressBar();
    if (this.options.showStats) {
      this.createStatsPanel();
    }
    this.injectStyles();
  }

  /**
   * 创建容器
   */
  createContainer() {
    this.container = document.createElement('div');
    this.container.id = 'hot-reload-ui-container';
    this.container.className = `hot-reload-ui ${this.options.position} ${this.options.theme}`;
    document.body.appendChild(this.container);
  }

  /**
   * 创建通知组件
   */
  createNotification() {
    this.notification = document.createElement('div');
    this.notification.id = 'hot-reload-notification';
    this.notification.className = 'hot-reload-notification';
    this.notification.style.display = 'none';

    this.notification.innerHTML = `
      <div class="hot-reload-notification-content">
        <div class="hot-reload-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
        </div>
        <div class="hot-reload-message">
          <div class="hot-reload-title">Hot Reload</div>
          <div class="hot-reload-text"></div>
        </div>
        <button class="hot-reload-close" aria-label="Close">&times;</button>
      </div>
    `;

    this.container.appendChild(this.notification);

    // 关闭按钮事件
    this.notification.querySelector('.hot-reload-close').addEventListener('click', () => {
      this.hideNotification();
    });
  }

  /**
   * 创建进度条
   */
  createProgressBar() {
    this.progressBar = document.createElement('div');
    this.progressBar.id = 'hot-reload-progress';
    this.progressBar.className = 'hot-reload-progress';
    this.progressBar.style.display = 'none';

    this.progressBar.innerHTML = `
      <div class="hot-reload-progress-bar">
        <div class="hot-reload-progress-fill"></div>
      </div>
      <div class="hot-reload-progress-text"></div>
    `;

    this.container.appendChild(this.progressBar);
  }

  /**
   * 创建统计面板
   */
  createStatsPanel() {
    this.statsPanel = document.createElement('div');
    this.statsPanel.id = 'hot-reload-stats';
    this.statsPanel.className = 'hot-reload-stats';
    this.statsPanel.style.display = 'none';

    this.statsPanel.innerHTML = `
      <div class="hot-reload-stats-header">
        <span>🔥 Hot Reload Stats</span>
        <button class="hot-reload-stats-toggle">_</button>
      </div>
      <div class="hot-reload-stats-body">
        <div class="hot-reload-stat">
          <span class="hot-reload-stat-label">Total Reloads:</span>
          <span class="hot-reload-stat-value" id="stat-total">0</span>
        </div>
        <div class="hot-reload-stat">
          <span class="hot-reload-stat-label">CSS Only:</span>
          <span class="hot-reload-stat-value" id="stat-css">0</span>
        </div>
        <div class="hot-reload-stat">
          <span class="hot-reload-stat-label">Full Reloads:</span>
          <span class="hot-reload-stat-value" id="stat-full">0</span>
        </div>
        <div class="hot-reload-stat">
          <span class="hot-reload-stat-label">Avg Time:</span>
          <span class="hot-reload-stat-value" id="stat-avg-time">0ms</span>
        </div>
        <div class="hot-reload-stat">
          <span class="hot-reload-stat-label">Last Reload:</span>
          <span class="hot-reload-stat-value" id="stat-last-time">-</span>
        </div>
      </div>
    `;

    this.container.appendChild(this.statsPanel);

    // 切换统计面板
    this.statsPanel.querySelector('.hot-reload-stats-toggle').addEventListener('click', () => {
      this.toggleStatsPanel();
    });

    // 默认显示统计面板
    setTimeout(() => {
      this.showStatsPanel();
    }, 1000);
  }

  /**
   * 注入样式
   */
  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .hot-reload-ui {
        position: fixed;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .hot-reload-ui.top-right {
        top: 20px;
        right: 20px;
      }

      .hot-reload-ui.top-left {
        top: 20px;
        left: 20px;
      }

      .hot-reload-ui.bottom-right {
        bottom: 20px;
        right: 20px;
      }

      .hot-reload-ui.bottom-left {
        bottom: 20px;
        left: 20px;
      }

      /* 通知样式 */
      .hot-reload-notification {
        background: #1e1e1e;
        color: #ffffff;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        margin-bottom: 10px;
        animation: slideIn 0.3s ease-out;
        overflow: hidden;
      }

      .hot-reload-ui.light .hot-reload-notification {
        background: #ffffff;
        color: #1e1e1e;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .hot-reload-notification-content {
        display: flex;
        align-items: center;
        padding: 12px 16px;
        gap: 12px;
      }

      .hot-reload-icon {
        flex-shrink: 0;
        color: #4fc3f7;
        animation: rotate 2s linear infinite;
      }

      .hot-reload-message {
        flex: 1;
        min-width: 0;
      }

      .hot-reload-title {
        font-weight: 600;
        font-size: 14px;
        margin-bottom: 2px;
      }

      .hot-reload-text {
        font-size: 12px;
        opacity: 0.8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hot-reload-close {
        flex-shrink: 0;
        background: none;
        border: none;
        color: currentColor;
        font-size: 20px;
        cursor: pointer;
        opacity: 0.6;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .hot-reload-close:hover {
        opacity: 1;
      }

      /* 进度条样式 */
      .hot-reload-progress {
        background: #1e1e1e;
        color: #ffffff;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        padding: 12px 16px;
        margin-bottom: 10px;
      }

      .hot-reload-ui.light .hot-reload-progress {
        background: #ffffff;
        color: #1e1e1e;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .hot-reload-progress-bar {
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
        margin-bottom: 8px;
      }

      .hot-reload-ui.light .hot-reload-progress-bar {
        background: rgba(0, 0, 0, 0.1);
      }

      .hot-reload-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #4fc3f7, #667eea);
        border-radius: 2px;
        transition: width 0.3s ease-out;
        width: 0%;
      }

      .hot-reload-progress-text {
        font-size: 12px;
        opacity: 0.8;
      }

      /* 统计面板样式 */
      .hot-reload-stats {
        background: #1e1e1e;
        color: #ffffff;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        min-width: 250px;
      }

      .hot-reload-ui.light .hot-reload-stats {
        background: #ffffff;
        color: #1e1e1e;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .hot-reload-stats-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        font-weight: 600;
        font-size: 14px;
      }

      .hot-reload-ui.light .hot-reload-stats-header {
        border-bottom-color: rgba(0, 0, 0, 0.1);
      }

      .hot-reload-stats-toggle {
        background: none;
        border: none;
        color: currentColor;
        cursor: pointer;
        font-size: 16px;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .hot-reload-stats-body {
        padding: 12px 16px;
      }

      .hot-reload-stats.collapsed .hot-reload-stats-body {
        display: none;
      }

      .hot-reload-stat {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        font-size: 12px;
      }

      .hot-reload-stat:last-child {
        margin-bottom: 0;
      }

      .hot-reload-stat-label {
        opacity: 0.8;
      }

      .hot-reload-stat-value {
        font-weight: 600;
        color: #4fc3f7;
      }

      /* 动画 */
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes rotate {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes fadeOut {
        from {
          opacity: 1;
        }
        to {
          opacity: 0;
        }
      }

      .hot-reload-notification.hiding {
        animation: fadeOut 0.3s ease-out forwards;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    if (!window.electronAPI || !window.electronAPI.on) {
      console.warn('[HotReloadUI] Electron API not available');
      return;
    }

    // 监听重载准备
    window.electronAPI.on('hot-reload:prepare', (data) => {
      this.showNotification('准备重载...', data.filePath);
    });

    // 监听样式更新
    window.electronAPI.on('hot-reload:style-update', (data) => {
      this.showNotification('刷新样式中...', data.filePath, 'css');
    });

    // 监听进度更新
    window.electronAPI.on('hot-reload:progress', (data) => {
      this.showProgress(data.step, data.progress);
    });

    // 监听完成
    window.electronAPI.on('hot-reload:complete', (data) => {
      if (data.type === 'css-only') {
        this.showNotification(
          `样式已更新 (${data.reloadTime}ms)`,
          data.filePath,
          'success'
        );
      } else {
        this.showNotification(
          `重载完成 (${data.reloadTime}ms)`,
          data.filePath,
          'success'
        );
      }

      this.hideProgress();
      this.updateStats(data);
    });

    // 监听错误
    window.electronAPI.on('hot-reload:error', (data) => {
      this.showNotification(
        `重载失败: ${data.message}`,
        data.filePath,
        'error'
      );
      this.hideProgress();
    });
  }

  /**
   * 显示通知
   * @param {string} message - 消息内容
   * @param {string} detail - 详细信息
   * @param {string} type - 类型 (info, success, error, css)
   */
  showNotification(message, detail = '', type = 'info') {
    const textEl = this.notification.querySelector('.hot-reload-text');
    textEl.textContent = detail || message;

    this.notification.style.display = 'block';

    // 根据类型设置图标颜色
    const icon = this.notification.querySelector('.hot-reload-icon');
    if (type === 'success') {
      icon.style.color = '#81c784';
    } else if (type === 'error') {
      icon.style.color = '#e57373';
    } else if (type === 'css') {
      icon.style.color = '#ffb74d';
    } else {
      icon.style.color = '#4fc3f7';
    }

    // 自动隐藏
    if (this.options.autoHide && type !== 'error') {
      setTimeout(() => {
        this.hideNotification();
      }, this.options.autoHideDelay);
    }
  }

  /**
   * 隐藏通知
   */
  hideNotification() {
    this.notification.classList.add('hiding');
    setTimeout(() => {
      this.notification.style.display = 'none';
      this.notification.classList.remove('hiding');
    }, 300);
  }

  /**
   * 显示进度
   * @param {string} step - 步骤
   * @param {number} progress - 进度 (0-100)
   */
  showProgress(step, progress) {
    const fillEl = this.progressBar.querySelector('.hot-reload-progress-fill');
    const textEl = this.progressBar.querySelector('.hot-reload-progress-text');

    fillEl.style.width = `${progress}%`;

    const stepTexts = {
      'saving-state': '保存状态中...',
      'reloading': '重载页面中...',
      'complete': '完成'
    };

    textEl.textContent = stepTexts[step] || step;

    this.progressBar.style.display = 'block';
  }

  /**
   * 隐藏进度
   */
  hideProgress() {
    setTimeout(() => {
      this.progressBar.style.display = 'none';
    }, 1000);
  }

  /**
   * 更新统计
   * @param {Object} data - 重载数据
   */
  updateStats(data) {
    if (!this.statsPanel) return;

    // 从 localStorage 获取统计数据
    const stats = JSON.parse(localStorage.getItem('hot-reload-stats') || '{}');

    stats.totalReloads = (stats.totalReloads || 0) + 1;
    if (data.type === 'css-only') {
      stats.cssOnlyReloads = (stats.cssOnlyReloads || 0) + 1;
    } else {
      stats.fullReloads = (stats.fullReloads || 0) + 1;
    }

    // 更新平均时间
    stats.reloadTimes = stats.reloadTimes || [];
    stats.reloadTimes.push(data.reloadTime);
    if (stats.reloadTimes.length > 100) {
      stats.reloadTimes = stats.reloadTimes.slice(-100);
    }
    const avgTime = Math.round(
      stats.reloadTimes.reduce((a, b) => a + b, 0) / stats.reloadTimes.length
    );

    stats.averageReloadTime = avgTime;
    stats.lastReloadTime = data.reloadTime;

    // 保存到 localStorage
    localStorage.setItem('hot-reload-stats', JSON.stringify(stats));

    // 更新 UI
    document.getElementById('stat-total').textContent = stats.totalReloads;
    document.getElementById('stat-css').textContent = stats.cssOnlyReloads || 0;
    document.getElementById('stat-full').textContent = stats.fullReloads || 0;
    document.getElementById('stat-avg-time').textContent = avgTime + 'ms';
    document.getElementById('stat-last-time').textContent = data.reloadTime + 'ms';
  }

  /**
   * 显示统计面板
   */
  showStatsPanel() {
    if (!this.statsPanel) return;
    this.statsPanel.style.display = 'block';

    // 加载统计数据
    const stats = JSON.parse(localStorage.getItem('hot-reload-stats') || '{}');
    document.getElementById('stat-total').textContent = stats.totalReloads || 0;
    document.getElementById('stat-css').textContent = stats.cssOnlyReloads || 0;
    document.getElementById('stat-full').textContent = stats.fullReloads || 0;
    document.getElementById('stat-avg-time').textContent = (stats.averageReloadTime || 0) + 'ms';
    document.getElementById('stat-last-time').textContent = stats.lastReloadTime ? stats.lastReloadTime + 'ms' : '-';
  }

  /**
   * 隐藏统计面板
   */
  hideStatsPanel() {
    if (!this.statsPanel) return;
    this.statsPanel.style.display = 'none';
  }

  /**
   * 切换统计面板
   */
  toggleStatsPanel() {
    if (!this.statsPanel) return;
    this.statsPanel.classList.toggle('collapsed');
  }

  /**
   * 销毁 UI
   */
  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HotReloadUI;
}
