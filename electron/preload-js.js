/**
 * Electron预加载脚本 - JavaScript版本
 * 为渲染进程提供安全的API访问
 */

const { contextBridge, ipcRenderer } = require('electron');

// 为渲染进程暴露安全的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用控制API
  app: {
    start: () => ipcRenderer.invoke('app:start'),
    stop: () => ipcRenderer.invoke('app:stop'),
    restart: () => ipcRenderer.invoke('app:restart'),
    getStatus: () => ipcRenderer.invoke('app:getStatus'),
    getConfig: () => ipcRenderer.invoke('app:getConfig')
  },

  // 权限管理API
  permission: {
    check: () => ipcRenderer.invoke('permission:check'),
    request: (permissions) => ipcRenderer.invoke('permission:request', permissions),
    requestAll: () => ipcRenderer.invoke('permission:requestAll'),
    showWizard: () => ipcRenderer.invoke('permission:showWizard')
  },

  // FSM状态机API
  fsm: {
    getCurrentState: () => ipcRenderer.invoke('fsm:getCurrentState'),
    forceTransition: (targetState) => ipcRenderer.invoke('fsm:forceTransition', targetState)
  },

  // 系统操作API
  system: {
    takeScreenshot: () => ipcRenderer.invoke('system:takeScreenshot'),
    syncData: () => ipcRenderer.invoke('system:syncData'),
    getPlatformInfo: () => ipcRenderer.invoke('system:getPlatformInfo'),
    openSystemPreferences: () => ipcRenderer.invoke('system:openSystemPreferences')
  },

  // 窗口控制API
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    show: () => ipcRenderer.invoke('window:show')
  },

  // 配置管理API
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    update: (config) => ipcRenderer.invoke('config:update', config)
  },

  // 日志API
  log: {
    add: (message, type = 'info') => ipcRenderer.invoke('log:add', { message, type }),
    getUILogs: () => ipcRenderer.invoke('log:getUILogs'),
    getStats: () => ipcRenderer.invoke('log:getStats'),
    cleanup: (maxDays) => ipcRenderer.invoke('log:cleanup', maxDays)
  },

  // 自启动API
  autostart: {
    enable: () => ipcRenderer.invoke('autostart:enable'),
    disable: () => ipcRenderer.invoke('autostart:disable'),
    getStatus: () => ipcRenderer.invoke('autostart:status')
  },

  // Windows原生模块API
  nativeModule: {
    checkStatus: () => ipcRenderer.invoke('check-native-module-status'),
    install: () => ipcRenderer.invoke('install-native-module'),
    getProgress: () => ipcRenderer.invoke('get-install-progress'),
    restartApp: () => ipcRenderer.invoke('restart-with-native-module')
  },

  // 安装进度监听
  onInstallProgress: (callback) => {
    ipcRenderer.on('install-progress-update', (event, progressData) => {
      callback(progressData);
    });
  },

  // 日志监听器
  onLogReceived: (callback) => {
    ipcRenderer.on('log:received', (event, logData) => {
      callback(logData);
    });
  },

  // 发送单向消息到主进程
  send: (channel, data) => {
    const validChannels = [
      'state-update',
      'log-message',
      'screenshot-taken',
      'data-synced',
      'error-occurred',
      'monitoring-paused',
      'monitoring-resumed',
      'hide-window',
      'show-window'
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn('[Preload] Attempted to send to invalid channel:', channel);
    }
  },

  // 调用主进程方法并等待返回
  invoke: async (channel, ...args) => {
    const validChannels = [
      'get-config',
      'update-config',
      'get-device-id',
      'get-system-info',
      'take-screenshot',
      'get-screenshot-path',
      'read-file',
      'write-file',
      'delete-file',
      'fetch-api',
      'show-open-dialog',
      'show-save-dialog',
      'get-app-version',
      'get-platform',
      'update-download-progress',
      // 版本更新相关的IPC channels
      'check-for-updates',
      'install-update',
      'get-update-status',
      'set-update-channel'
    ];

    if (validChannels.includes(channel)) {
      return await ipcRenderer.invoke(channel, ...args);
    } else {
      console.warn('[Preload] Attempted to invoke invalid channel:', channel);
      throw new Error(`Invalid IPC channel: ${channel}`);
    }
  },

  // 事件监听API（返回取消订阅函数）
  on: (channel, callback) => {
    const validChannels = [
      'app-status-changed',
      'device-status-changed',
      'fsm-state-changed',
      'permission-required',
      'status-update',
      'log:received',
      'log-update',
      'install-progress-update',
      'init-progress',
      'autostart-status-changed',
      'pause-monitoring',
      'resume-monitoring',
      'reload-renderer',
      'config-updated',
      'force-screenshot',
      'sync-now',
      'state-query',
      'update-download-progress',
      // 增强版热更新事件
      'hot-reload:prepare',
      'hot-reload:style-update',
      'hot-reload:progress',
      'hot-reload:complete',
      'hot-reload:error'
    ];

    if (validChannels.includes(channel)) {
      const subscription = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);

      // 返回取消订阅函数
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    } else {
      console.warn('[Preload] Attempted to listen to invalid channel:', channel);
      return () => {}; // 返回空函数
    }
  },

  off: (channel, callback) => {
    const validChannels = [
      'app-status-changed',
      'device-status-changed',
      'fsm-state-changed',
      'permission-required',
      'status-update',
      'log:received',
      'log-update',
      'install-progress-update',
      'init-progress',
      'autostart-status-changed',
      'reload-renderer',
      // 增强版热更新事件
      'hot-reload:prepare',
      'hot-reload:style-update',
      'hot-reload:progress',
      'hot-reload:complete',
      'hot-reload:error'
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback);
    }
  },

  // 系统信息
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});

// 初始化日志
console.log('Electron preload script loaded successfully');
console.log('Platform:', process.platform);
console.log('Versions:', {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron
});