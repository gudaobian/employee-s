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

  // 事件监听API
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
      'init-progress'
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
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
      'init-progress'
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