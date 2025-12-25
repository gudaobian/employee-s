# 渲染进程重载方案 - 实施计划

## 📋 当前架构分析

### 现状
```
electron/main-minimal.js (主入口)
  ↓ 加载
out/dist/main/app.js (EmployeeMonitorApp)
  ├─ FSM (状态机)                    ❌ 在主进程
  ├─ AuthService (认证服务)           ❌ 在主进程
  ├─ DataSyncService (数据同步)       ❌ 在主进程
  ├─ WebSocketService (WebSocket)    ❌ 在主进程
  ├─ ScreenshotService (截图服务)     ❌ 在主进程
  └─ ConfigService (配置管理)         ❌ 在主进程

electron/renderer/minimal-index.html
  └─ 只有 UI 显示                     ✅ 在渲染进程
```

**问题**: 所有业务逻辑在主进程，更新需要重启整个应用。

---

## 🎯 目标架构

```
electron/main-minimal.js (主进程 - 最小化)
  ├─ 窗口创建和管理                    ✅ 核心逻辑，很少变动
  ├─ 托盘图标                         ✅ 核心逻辑，很少变动
  ├─ IPC 通信桥梁                     ✅ 核心逻辑，很少变动
  └─ 热更新管理器                     ✅ 核心逻辑，很少变动

electron/renderer/
  ├─ index.html (UI 界面)            ✅ 可重载
  ├─ renderer-app.js (应用入口)       ✅ 可重载
  ├─ services/ (业务服务)             ✅ 可重载
  │   ├─ fsm.js                      ✅ 可重载
  │   ├─ auth-service.js             ✅ 可重载
  │   ├─ data-sync-service.js        ✅ 可重载
  │   ├─ websocket-service.js        ✅ 可重载
  │   └─ screenshot-service.js       ✅ 可重载
  └─ ui/ (UI 组件)                    ✅ 可重载
```

**优势**: 70% 的业务逻辑在渲染进程，更新只需 `reload()`，0.5 秒完成。

---

## 📝 实施步骤

### Phase 1: 创建渲染进程应用结构

#### 1.1 创建 Preload 脚本（安全的 IPC 桥梁）

**文件**: `electron/preload-renderer.js`

```javascript
const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 IPC API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 发送事件到主进程
  send: (channel, data) => {
    const validChannels = [
      'state-update',
      'log-message',
      'screenshot-taken',
      'data-synced'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // 接收主进程事件
  on: (channel, callback) => {
    const validChannels = [
      'pause-monitoring',
      'resume-monitoring',
      'reload-renderer',
      'config-updated'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  // 移除监听器
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // 调用主进程方法并等待返回
  invoke: async (channel, ...args) => {
    const validChannels = [
      'get-config',
      'update-config',
      'get-device-id',
      'take-screenshot',
      'get-system-info'
    ];
    if (validChannels.includes(channel)) {
      return await ipcRenderer.invoke(channel, ...args);
    }
  }
});
```

---

#### 1.2 创建渲染进程应用入口

**文件**: `electron/renderer/renderer-app.js`

```javascript
/**
 * 渲染进程应用主类
 * 包含所有业务逻辑，可以通过 reload() 热更新
 */
class RendererApp {
  constructor() {
    this.fsm = null;
    this.services = {};
    this.state = 'INIT';
    this.config = null;
  }

  /**
   * 初始化应用
   */
  async init() {
    console.log('[RendererApp] Initializing...');

    try {
      // 1. 加载配置
      this.config = await window.electronAPI.invoke('get-config');
      console.log('[RendererApp] Config loaded:', this.config);

      // 2. 初始化服务
      await this.initServices();

      // 3. 初始化 FSM
      await this.initFSM();

      // 4. 设置 IPC 监听
      this.setupIPC();

      // 5. 设置 UI 事件
      this.setupUI();

      // 6. 启动 FSM
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
   * 初始化服务
   */
  async initServices() {
    // 获取 deviceId
    const deviceId = await window.electronAPI.invoke('get-device-id');

    this.services = {
      auth: new AuthService({
        deviceId,
        apiUrl: this.config.apiUrl
      }),

      dataSync: new DataSyncService({
        deviceId,
        apiUrl: this.config.apiUrl,
        syncInterval: this.config.syncInterval
      }),

      websocket: new WebSocketService({
        deviceId,
        wsUrl: this.config.wsUrl
      }),

      screenshot: new ScreenshotService({
        quality: this.config.screenshotQuality,
        interval: this.config.screenshotInterval
      })
    };

    console.log('[RendererApp] Services initialized');
  }

  /**
   * 初始化 FSM
   */
  async initFSM() {
    this.fsm = new DeviceFSM(this.services);

    // 监听状态变化
    this.fsm.on('state-change', (state) => {
      this.state = state;
      this.updateUI(state);

      // 通知主进程
      window.electronAPI.send('state-update', {
        state,
        timestamp: Date.now()
      });
    });

    // 监听错误
    this.fsm.on('error', (error) => {
      console.error('[FSM] Error:', error);
      this.updateStatus('错误: ' + error.message);
    });

    console.log('[RendererApp] FSM initialized');
  }

  /**
   * 设置 IPC 监听
   */
  setupIPC() {
    // 接收主进程的暂停命令
    window.electronAPI.on('pause-monitoring', () => {
      console.log('[RendererApp] Received pause command');
      this.fsm.pause();
    });

    // 接收主进程的恢复命令
    window.electronAPI.on('resume-monitoring', () => {
      console.log('[RendererApp] Received resume command');
      this.fsm.resume();
    });

    // 接收配置更新
    window.electronAPI.on('config-updated', (newConfig) => {
      console.log('[RendererApp] Config updated:', newConfig);
      this.config = newConfig;
      this.applyConfigChanges(newConfig);
    });

    // 接收热更新命令
    window.electronAPI.on('reload-renderer', () => {
      console.log('[RendererApp] Hot reload requested');
      this.prepareForReload();
    });

    console.log('[RendererApp] IPC listeners setup complete');
  }

  /**
   * 设置 UI 事件
   */
  setupUI() {
    // 暂停按钮
    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.fsm.pause();
    });

    // 恢复按钮
    document.getElementById('btn-resume')?.addEventListener('click', () => {
      this.fsm.resume();
    });

    // 后台按钮
    document.getElementById('btn-background')?.addEventListener('click', () => {
      window.electronAPI.send('hide-window');
    });

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
        'HEARTBEAT': '心跳中',
        'REGISTER': '注册中',
        'BIND_CHECK': '检查绑定',
        'WS_CHECK': 'WebSocket检查',
        'CONFIG_FETCH': '获取配置',
        'DATA_COLLECT': '数据收集中',
        'UNBOUND': '未绑定',
        'DISCONNECT': '已断线'
      };
      statusElement.textContent = statusText[state] || state;
    }

    // 更新按钮状态
    const pauseBtn = document.getElementById('btn-pause');
    const resumeBtn = document.getElementById('btn-resume');

    if (state === 'DATA_COLLECT') {
      if (pauseBtn) pauseBtn.disabled = false;
      if (resumeBtn) resumeBtn.disabled = true;
    } else {
      if (pauseBtn) pauseBtn.disabled = true;
      if (resumeBtn) resumeBtn.disabled = false;
    }
  }

  /**
   * 更新状态消息
   */
  updateStatus(message) {
    console.log('[RendererApp]', message);
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
    // 更新服务配置
    if (this.services.dataSync) {
      this.services.dataSync.updateConfig({
        syncInterval: newConfig.syncInterval
      });
    }

    if (this.services.screenshot) {
      this.services.screenshot.updateConfig({
        quality: newConfig.screenshotQuality,
        interval: newConfig.screenshotInterval
      });
    }
  }

  /**
   * 准备重载（清理资源）
   */
  async prepareForReload() {
    console.log('[RendererApp] Preparing for reload...');

    try {
      // 保存当前状态
      const currentState = {
        fsmState: this.fsm.getState(),
        config: this.config,
        timestamp: Date.now()
      };
      localStorage.setItem('app-state', JSON.stringify(currentState));

      // 停止 FSM
      await this.fsm.stop();

      // 清理服务
      Object.values(this.services).forEach(service => {
        if (service.cleanup) {
          service.cleanup();
        }
      });

      console.log('[RendererApp] Cleanup complete, ready for reload');

    } catch (error) {
      console.error('[RendererApp] Cleanup failed:', error);
    }
  }

  /**
   * 恢复之前保存的状态
   */
  restoreState() {
    const savedState = localStorage.getItem('app-state');
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        console.log('[RendererApp] Restoring state:', state);

        // 恢复配置
        if (state.config) {
          this.config = { ...this.config, ...state.config };
        }

        // 恢复 FSM 状态（如果需要）
        // this.fsm.restoreState(state.fsmState);

        localStorage.removeItem('app-state');
      } catch (error) {
        console.error('[RendererApp] Failed to restore state:', error);
      }
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    console.log('[RendererApp] Cleaning up...');

    if (this.fsm) {
      await this.fsm.stop();
    }

    Object.values(this.services).forEach(service => {
      if (service.cleanup) {
        service.cleanup();
      }
    });

    console.log('[RendererApp] Cleanup complete');
  }
}

// ==================== 全局初始化 ====================

let app = null;

// 页面加载时初始化
window.addEventListener('DOMContentLoaded', async () => {
  console.log('[RendererApp] DOMContentLoaded');

  try {
    app = new RendererApp();

    // 尝试恢复之前的状态
    app.restoreState();

    // 初始化应用
    await app.init();

  } catch (error) {
    console.error('[RendererApp] Failed to initialize:', error);
    document.getElementById('status').textContent = '启动失败: ' + error.message;
  }
});

// 页面卸载时清理
window.addEventListener('beforeunload', async () => {
  console.log('[RendererApp] beforeunload');

  if (app) {
    await app.cleanup();
  }
});

// 热更新接口
window.addEventListener('hot-reload', async () => {
  console.log('[RendererApp] Hot reload event received');

  if (app) {
    await app.prepareForReload();
  }

  // 延迟重新初始化，让清理完成
  setTimeout(async () => {
    app = new RendererApp();
    app.restoreState();
    await app.init();
  }, 100);
});
```

---

### Phase 2: 创建服务类（渲染进程版本）

这些服务需要从 TypeScript 的 `src/common/services/` 迁移到 JavaScript 的 `electron/renderer/services/`。

#### 2.1 FSM (状态机)

**文件**: `electron/renderer/services/fsm.js`

```javascript
/**
 * 设备状态机（渲染进程版本）
 */
class DeviceFSM extends EventEmitter {
  constructor(services) {
    super();
    this.services = services;
    this.currentState = 'INIT';
    this.states = {
      'INIT': new InitState(this),
      'HEARTBEAT': new HeartbeatState(this),
      'REGISTER': new RegisterState(this),
      // ... 其他状态
    };
  }

  async start() {
    console.log('[FSM] Starting...');
    this.transition('HEARTBEAT');
  }

  async stop() {
    console.log('[FSM] Stopping...');
    // 停止逻辑
  }

  pause() {
    console.log('[FSM] Pausing...');
    this.emit('state-change', 'PAUSED');
  }

  resume() {
    console.log('[FSM] Resuming...');
    this.emit('state-change', this.currentState);
  }

  transition(newState) {
    const oldState = this.currentState;
    this.currentState = newState;

    console.log(`[FSM] State transition: ${oldState} -> ${newState}`);

    this.emit('state-change', newState);

    // 执行新状态的进入逻辑
    if (this.states[newState]) {
      this.states[newState].enter();
    }
  }

  getState() {
    return this.currentState;
  }
}
```

#### 2.2 AuthService

**文件**: `electron/renderer/services/auth-service.js`

```javascript
/**
 * 认证服务（渲染进程版本）
 */
class AuthService {
  constructor(config) {
    this.deviceId = config.deviceId;
    this.apiUrl = config.apiUrl;
    this.token = null;
  }

  async authenticate() {
    const response = await fetch(`${this.apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: this.deviceId })
    });

    const data = await response.json();
    this.token = data.token;

    return this.token;
  }

  getToken() {
    return this.token;
  }

  cleanup() {
    this.token = null;
  }
}
```

#### 2.3 其他服务

类似地创建：
- `data-sync-service.js`
- `websocket-service.js`
- `screenshot-service.js`

---

### Phase 3: 简化主进程

**文件**: `electron/main-minimal.js` (修改)

```javascript
// ==================== 主进程简化版本 ====================

const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let config = null;

// ==================== 窗口管理 ====================

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 340,
    height: 265,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-renderer.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createTray() {
  tray = new Tray(/* icon path */);

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow.show() },
    { label: '暂停监控', click: () => pauseMonitoring() },
    { label: '恢复监控', click: () => resumeMonitoring() },
    { label: '退出', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
}

// ==================== IPC 通信 ====================

function setupIPC() {
  // 渲染进程请求配置
  ipcMain.handle('get-config', async () => {
    return config;
  });

  // 渲染进程请求 deviceId
  ipcMain.handle('get-device-id', async () => {
    return getDeviceId();
  });

  // 接收渲染进程的状态更新
  ipcMain.on('state-update', (event, data) => {
    console.log('[Main] State updated:', data);
    updateTrayTooltip(data.state);
  });

  // 接收渲染进程的日志
  ipcMain.on('log-message', (event, data) => {
    console.log(`[Renderer] ${data.level}: ${data.message}`);
  });
}

// ==================== 控制命令 ====================

function pauseMonitoring() {
  if (mainWindow) {
    mainWindow.webContents.send('pause-monitoring');
  }
}

function resumeMonitoring() {
  if (mainWindow) {
    mainWindow.webContents.send('resume-monitoring');
  }
}

// ==================== 热更新 ====================

async function checkAndApplyHotUpdate() {
  try {
    // 检查更新
    const updateInfo = await checkForRendererUpdate();

    if (!updateInfo.hasUpdate) {
      return;
    }

    console.log('[HotUpdate] Update available:', updateInfo.version);

    // 下载更新
    const updateFiles = await downloadRendererUpdate(updateInfo);

    // 应用更新
    await applyRendererUpdate(updateFiles);

    // 重载渲染进程
    reloadRenderer();

  } catch (error) {
    console.error('[HotUpdate] Failed:', error);
  }
}

function reloadRenderer() {
  if (mainWindow) {
    console.log('[HotUpdate] Reloading renderer...');

    // 通知渲染进程准备重载
    mainWindow.webContents.send('reload-renderer');

    // 延迟后重载
    setTimeout(() => {
      mainWindow.reload();
    }, 200);
  }
}

// ==================== 应用启动 ====================

app.on('ready', async () => {
  // 加载配置
  config = loadConfig();

  // 创建窗口和托盘
  createMainWindow();
  createTray();

  // 设置 IPC
  setupIPC();

  // 定期检查热更新（每 2 分钟）
  setInterval(() => {
    checkAndApplyHotUpdate();
  }, 120000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

---

## 📦 迁移检查清单

### ✅ 准备工作
- [ ] 备份当前代码
- [ ] 创建新分支 `feature/renderer-reload`
- [ ] 确保测试环境可用

### ✅ Phase 1: 基础设施
- [ ] 创建 `electron/preload-renderer.js`
- [ ] 创建 `electron/renderer/renderer-app.js`
- [ ] 创建 `electron/renderer/services/` 目录

### ✅ Phase 2: 服务迁移
- [ ] 迁移 FSM → `services/fsm.js`
- [ ] 迁移 AuthService → `services/auth-service.js`
- [ ] 迁移 DataSyncService → `services/data-sync-service.js`
- [ ] 迁移 WebSocketService → `services/websocket-service.js`
- [ ] 迁移 ScreenshotService → `services/screenshot-service.js`

### ✅ Phase 3: 主进程简化
- [ ] 移除主进程中的业务逻辑
- [ ] 保留窗口管理
- [ ] 保留 IPC 通信
- [ ] 保留托盘管理

### ✅ Phase 4: UI 更新
- [ ] 更新 `minimal-index.html`
- [ ] 引入 `renderer-app.js`
- [ ] 引入服务脚本

### ✅ Phase 5: 热更新
- [ ] 实现 `checkForRendererUpdate()`
- [ ] 实现 `downloadRendererUpdate()`
- [ ] 实现 `applyRendererUpdate()`
- [ ] 实现 `reloadRenderer()`

### ✅ Phase 6: 测试
- [ ] 测试基本功能
- [ ] 测试 IPC 通信
- [ ] 测试热更新流程
- [ ] 测试状态恢复

---

## 🚀 下一步

开始实施 Phase 1: 创建基础设施。

是否继续？
