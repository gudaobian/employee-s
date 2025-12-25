/**
 * 渲染进程应用主类
 *
 * 职责：
 * 1. 管理所有业务逻辑和服务
 * 2. 提供热更新能力（通过 reload() 可以更新）
 * 3. 与主进程通过 IPC 通信
 * 4. 更新 UI 界面
 *
 * 重要：此文件中的所有代码都可以通过窗口重载热更新
 */

// ==================== 注意：服务类在独立文件中 ====================
// FSMService - services/fsm-service.js
// AuthService - services/auth-service.js
// DataSyncService - services/data-sync-service.js
// 这些服务会在 HTML 中先加载

// ==================== 渲染进程应用主类 ====================

class RendererApp {
  constructor() {
    this.fsm = null;
    this.services = {};
    this.state = 'INIT';
    this.config = null;
    this.ipcUnsubscribers = [];

    console.log('[RendererApp] Instance created');
  }

  /**
   * 初始化应用
   */
  async init() {
    console.log('[RendererApp] Initializing...');

    try {
      // 显示初始化进度
      this.updateStatus('正在初始化...');

      // 1. 加载配置
      await this.loadConfig();

      // 2. 初始化服务
      await this.initServices();

      // 3. 初始化 FSM
      await this.initFSM();

      // 4. 设置 IPC 监听
      this.setupIPC();

      // 5. 设置 UI 事件
      this.setupUI();

      // 6. 尝试恢复之前的状态
      this.restoreState();

      // 7. 启动 FSM
      await this.fsm.start();

      console.log('[RendererApp] Initialization complete');
      this.updateStatus('运行中');

    } catch (error) {
      console.error('[RendererApp] Initialization failed:', error);
      this.updateStatus('初始化失败: ' + error.message);
      throw error;
    }
  }

  /**
   * 加载配置
   */
  async loadConfig() {
    try {
      // 从主进程获取配置
      this.config = await window.electronAPI.invoke('get-config');
      console.log('[RendererApp] Config loaded:', this.config);
    } catch (error) {
      console.error('[RendererApp] Failed to load config:', error);

      // 使用默认配置
      this.config = {
        apiUrl: 'http://localhost:3000',
        wsUrl: 'ws://localhost:3000',
        syncInterval: 60000,
        screenshotInterval: 300000,
        screenshotQuality: 80
      };

      console.log('[RendererApp] Using default config:', this.config);
    }
  }

  /**
   * 初始化服务
   */
  async initServices() {
    console.log('[RendererApp] Initializing services...');

    try {
      // 获取设备 ID
      let deviceId;
      try {
        deviceId = await window.electronAPI.invoke('get-device-id');
        console.log('[RendererApp] Device ID:', deviceId);
      } catch (error) {
        console.warn('[RendererApp] Failed to get device ID:', error.message);
        deviceId = 'unknown-device';
      }

      // 创建服务实例（真实服务类）
      this.services = {
        auth: new AuthService({
          deviceId,
          apiUrl: this.config.apiUrl
        }),

        dataSync: new DataSyncService({
          deviceId,
          apiUrl: this.config.apiUrl,
          syncInterval: this.config.syncInterval
        })
      };

      // 初始化服务
      await this.services.auth.init();
      await this.services.dataSync.init();

      // 启动数据同步服务
      this.services.dataSync.start();

      console.log('[RendererApp] Services initialized successfully');

    } catch (error) {
      console.error('[RendererApp] Failed to initialize services:', error);
      throw error;
    }
  }

  /**
   * 初始化 FSM
   */
  async initFSM() {
    console.log('[RendererApp] Initializing FSM...');

    // 创建 FSM 服务实例（真实服务类）
    this.fsm = new FSMService();

    // 初始化 FSM 服务
    await this.fsm.init();

    // 监听状态变化
    this.fsm.on('state-change', (state, previousState) => {
      this.state = state;
      console.log('[RendererApp] FSM state changed:', previousState, '->', state);

      // 更新 UI
      this.updateUI(state);

      // 通知主进程（如果需要）
      window.electronAPI.send('state-update', {
        state,
        previousState,
        timestamp: Date.now()
      });
    });

    // 监听错误
    this.fsm.on('error', (error) => {
      console.error('[FSM] Error:', error);
      this.updateStatus('错误: ' + (error.message || error));

      window.electronAPI.send('error-occurred', {
        message: error.message || String(error),
        stack: error.stack || '',
        timestamp: Date.now()
      });
    });

    // 监听设备状态变化
    this.fsm.on('device-status', (data) => {
      console.log('[RendererApp] Device status:', data);
      // 可以在这里处理设备状态变化
    });

    console.log('[RendererApp] FSM initialized');
  }

  /**
   * 设置 IPC 监听
   */
  setupIPC() {
    console.log('[RendererApp] Setting up IPC listeners...');

    // 暂停监控
    const unsub1 = window.electronAPI.on('pause-monitoring', () => {
      console.log('[RendererApp] Received pause command from main process');
      this.fsm.pause();
      window.electronAPI.send('monitoring-paused', { timestamp: Date.now() });
    });
    this.ipcUnsubscribers.push(unsub1);

    // 恢复监控
    const unsub2 = window.electronAPI.on('resume-monitoring', () => {
      console.log('[RendererApp] Received resume command from main process');
      this.fsm.resume();
      window.electronAPI.send('monitoring-resumed', { timestamp: Date.now() });
    });
    this.ipcUnsubscribers.push(unsub2);

    // 配置更新
    const unsub3 = window.electronAPI.on('config-updated', (newConfig) => {
      console.log('[RendererApp] Config updated from main process:', newConfig);
      this.config = { ...this.config, ...newConfig };
      this.applyConfigChanges(newConfig);
    });
    this.ipcUnsubscribers.push(unsub3);

    // 热更新通知
    const unsub4 = window.electronAPI.on('reload-renderer', () => {
      console.log('[RendererApp] Hot reload requested by main process');
      this.prepareForReload();
    });
    this.ipcUnsubscribers.push(unsub4);

    console.log('[RendererApp] IPC listeners setup complete');
  }

  /**
   * 设置 UI 事件
   */
  setupUI() {
    console.log('[RendererApp] Setting up UI events...');

    // 暂停按钮
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        console.log('[UI] Pause button clicked');
        this.fsm.pause();
      });
    }

    // 恢复按钮
    const resumeBtn = document.getElementById('btn-resume');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        console.log('[UI] Resume button clicked');
        this.fsm.resume();
      });
    }

    // 后台按钮
    const bgBtn = document.getElementById('btn-background');
    if (bgBtn) {
      bgBtn.addEventListener('click', () => {
        console.log('[UI] Background button clicked');
        window.electronAPI.send('hide-window');
      });
    }

    console.log('[RendererApp] UI events setup complete');
  }

  /**
   * 更新 UI 状态
   */
  updateUI(state) {
    // 更新状态显示
    const statusElement = document.getElementById('status');
    if (statusElement) {
      const statusText = {
        'INIT': '初始化中',
        'RUNNING': '运行中',
        'PAUSED': '已暂停',
        'STOPPED': '已停止',
        'ERROR': '错误'
      };
      statusElement.textContent = statusText[state] || state;
    }

    // 更新按钮状态
    const pauseBtn = document.getElementById('btn-pause');
    const resumeBtn = document.getElementById('btn-resume');

    if (state === 'RUNNING') {
      if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.classList.remove('disabled');
      }
      if (resumeBtn) {
        resumeBtn.disabled = true;
        resumeBtn.classList.add('disabled');
      }
    } else if (state === 'PAUSED') {
      if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.classList.add('disabled');
      }
      if (resumeBtn) {
        resumeBtn.disabled = false;
        resumeBtn.classList.remove('disabled');
      }
    }
  }

  /**
   * 更新状态消息
   */
  updateStatus(message) {
    console.log('[RendererApp]', message);

    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = message;
    }

    // 发送日志到主进程
    window.electronAPI.send('log-message', {
      level: 'info',
      message,
      timestamp: Date.now()
    });
  }

  /**
   * 应用配置变更
   */
  applyConfigChanges(newConfig) {
    console.log('[RendererApp] Applying config changes:', newConfig);

    // 更新数据同步服务配置
    if (this.services.dataSync && newConfig.syncInterval) {
      this.services.dataSync.updateConfig({
        syncInterval: newConfig.syncInterval
      });
    }

    // 可以添加其他服务的配置更新
  }

  /**
   * 准备重载（保存状态并清理）
   */
  async prepareForReload() {
    console.log('[RendererApp] Preparing for hot reload...');

    try {
      // 1. 保存当前状态到 localStorage
      const currentState = {
        fsmState: this.fsm ? this.fsm.saveState() : null,
        authState: this.services.auth ? this.services.auth.saveState() : null,
        dataSyncState: this.services.dataSync ? this.services.dataSync.saveState() : null,
        config: this.config,
        timestamp: Date.now()
      };
      localStorage.setItem('app-state-backup', JSON.stringify(currentState));
      console.log('[RendererApp] State saved for hot reload');

      // 2. 停止 FSM
      if (this.fsm) {
        await this.fsm.stop();
      }

      // 3. 清理服务
      if (this.services) {
        Object.values(this.services).forEach(service => {
          if (service && service.cleanup && typeof service.cleanup === 'function') {
            service.cleanup();
          }
        });
      }

      // 4. 清理 FSM
      if (this.fsm && this.fsm.cleanup) {
        this.fsm.cleanup();
      }

      // 5. 移除 IPC 监听器
      this.ipcUnsubscribers.forEach(unsub => unsub());
      this.ipcUnsubscribers = [];

      console.log('[RendererApp] Cleanup complete, ready for reload');

    } catch (error) {
      console.error('[RendererApp] Cleanup failed:', error);
    }
  }

  /**
   * 恢复之前保存的状态
   */
  restoreState() {
    const savedState = localStorage.getItem('app-state-backup');

    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        console.log('[RendererApp] Restoring previous state from:', new Date(state.timestamp));

        // 恢复配置（合并，不完全覆盖）
        if (state.config) {
          this.config = { ...this.config, ...state.config };
        }

        // 恢复 FSM 状态
        if (state.fsmState && this.fsm && this.fsm.restoreState) {
          this.fsm.restoreState(state.fsmState);
          console.log('[RendererApp] FSM state restored');
        }

        // 恢复认证服务状态
        if (state.authState && this.services.auth && this.services.auth.restoreState) {
          this.services.auth.restoreState(state.authState);
          console.log('[RendererApp] Auth state restored');
        }

        // 恢复数据同步服务状态
        if (state.dataSyncState && this.services.dataSync && this.services.dataSync.restoreState) {
          this.services.dataSync.restoreState(state.dataSyncState);
          console.log('[RendererApp] DataSync state restored');
        }

        // 清除已恢复的状态
        localStorage.removeItem('app-state-backup');

        this.updateStatus('已恢复之前的状态');

      } catch (error) {
        console.error('[RendererApp] Failed to restore state:', error);
        localStorage.removeItem('app-state-backup');
      }
    }
  }

  /**
   * 清理资源（在页面卸载时调用）
   */
  async cleanup() {
    console.log('[RendererApp] Cleaning up resources...');

    try {
      // 停止 FSM
      if (this.fsm) {
        await this.fsm.stop();
      }

      // 清理服务
      Object.values(this.services).forEach(service => {
        if (service.cleanup && typeof service.cleanup === 'function') {
          service.cleanup();
        }
      });

      // 移除 IPC 监听器
      this.ipcUnsubscribers.forEach(unsub => unsub());
      this.ipcUnsubscribers = [];

      console.log('[RendererApp] Cleanup complete');

    } catch (error) {
      console.error('[RendererApp] Cleanup error:', error);
    }
  }
}

// ==================== 全局初始化逻辑 ====================

let app = null;

// 页面加载完成时初始化应用
window.addEventListener('DOMContentLoaded', async () => {
  console.log('[Global] DOMContentLoaded event');

  try {
    // 创建应用实例
    app = new RendererApp();

    // 初始化应用
    await app.init();

    console.log('[Global] Application initialized successfully');

  } catch (error) {
    console.error('[Global] Application initialization failed:', error);

    // 显示错误信息
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = '启动失败: ' + error.message;
      statusElement.style.color = 'red';
    }
  }
});

// 页面卸载前清理资源
window.addEventListener('beforeunload', async (event) => {
  console.log('[Global] beforeunload event');

  if (app) {
    // 注意：beforeunload 中不能使用异步操作
    // 所以这里只是触发清理，不等待完成
    app.cleanup().catch(err => {
      console.error('[Global] Cleanup error:', err);
    });
  }
});

// 热更新事件（由主进程触发）
window.addEventListener('hot-reload', async () => {
  console.log('[Global] Hot reload event received');

  if (app) {
    // 准备重载
    await app.prepareForReload();

    // 延迟100ms后重新初始化
    setTimeout(async () => {
      try {
        app = new RendererApp();
        await app.init();
        console.log('[Global] Hot reload complete');
      } catch (error) {
        console.error('[Global] Hot reload failed:', error);
      }
    }, 100);
  }
});

console.log('[Global] Renderer app script loaded');
