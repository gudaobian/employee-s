/**
 * Electron预加载脚本 - JavaScript版本
 * 提供安全的渲染进程API
 */

const { contextBridge, ipcRenderer } = require('electron');

// 导出安全的API到渲染进程
const electronAPI = {
  app: {
    start: () => ipcRenderer.invoke('app:start'),
    stop: () => ipcRenderer.invoke('app:stop'),
    restart: () => ipcRenderer.invoke('app:restart'),
    getStatus: () => ipcRenderer.invoke('app:getStatus'),
    getConfig: () => ipcRenderer.invoke('app:get-config'),
    updateConfig: (config) => ipcRenderer.invoke('app:update-config', config)
  },

  permission: {
    check: (permissions) => ipcRenderer.invoke('permission:check', permissions),
    request: (permissions) => ipcRenderer.invoke('permission:request', permissions),
    requestAll: () => ipcRenderer.invoke('permission:requestAll'),
    showWizard: (permissions) => ipcRenderer.invoke('permission:show-wizard', permissions)
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    update: (config) => ipcRenderer.invoke('config:update', config)
  },

  autostart: {
    enable: () => ipcRenderer.invoke('autostart:enable'),
    disable: () => ipcRenderer.invoke('autostart:disable'),
    getStatus: () => ipcRenderer.invoke('autostart:status')
  },

  log: {
    getUILogs: () => ipcRenderer.invoke('log:getUILogs'),
    getStats: () => ipcRenderer.invoke('log:getStats'),
    cleanup: (days) => ipcRenderer.invoke('log:cleanup', days)
  },

  fsm: {
    getCurrentState: () => ipcRenderer.invoke('fsm:get-current-state'),
    forceTransition: (targetState) => ipcRenderer.invoke('fsm:force-transition', targetState)
  },

  system: {
    takeScreenshot: () => ipcRenderer.invoke('system:take-screenshot'),
    syncData: () => ipcRenderer.invoke('system:sync-data'),
    getPlatformInfo: () => ipcRenderer.invoke('system:get-platform-info'),
    openSystemPreferences: () => ipcRenderer.invoke('system:open-system-preferences')
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    show: () => ipcRenderer.invoke('window:show')
  },

  on: (channel, callback) => {
    ipcRenderer.on(channel, (_, data) => callback(data));
  },

  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // 日志接收API
  onLogReceived: (callback) => {
    ipcRenderer.on('log:received', (_, logData) => callback(logData));
  },

  // 消息监听API
  onMessage: (channel, callback) => {
    ipcRenderer.on(channel, (_, ...args) => callback(...args));
  },

  platform: process.platform,
  versions: process.versions
};

// 将API暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

console.log('Preload script loaded successfully');
console.log('Platform:', process.platform);
console.log('Node version:', process.versions.node);
console.log('Electron version:', process.versions.electron);