/**
 * Preload 脚本 - 渲染进程安全的 IPC 桥梁
 *
 * 职责：
 * 1. 提供安全的 IPC 通信接口
 * 2. 隔离 Node.js API，防止安全漏洞
 * 3. 只暴露必要的功能给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] Loading preload script for renderer process...');

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // ==================== 发送消息到主进程 ====================

  /**
   * 发送单向消息到主进程
   * @param {string} channel - 频道名称
   * @param {*} data - 数据
   */
  send: (channel, data) => {
    const validChannels = [
      'state-update',           // 状态更新
      'log-message',            // 日志消息
      'screenshot-taken',       // 截图完成
      'data-synced',            // 数据同步完成
      'error-occurred',         // 错误发生
      'monitoring-paused',      // 监控已暂停
      'monitoring-resumed',     // 监控已恢复
      'hide-window',            // 隐藏窗口
      'show-window'             // 显示窗口
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn('[Preload] Attempted to send to invalid channel:', channel);
    }
  },

  // ==================== 接收主进程消息 ====================

  /**
   * 监听主进程消息
   * @param {string} channel - 频道名称
   * @param {Function} callback - 回调函数
   */
  on: (channel, callback) => {
    const validChannels = [
      'pause-monitoring',       // 暂停监控命令
      'resume-monitoring',      // 恢复监控命令
      'reload-renderer',        // 重载渲染进程
      'config-updated',         // 配置已更新
      'force-screenshot',       // 强制截图
      'sync-now',               // 立即同步数据
      'state-query'             // 查询状态
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

  /**
   * 移除监听器
   * @param {string} channel - 频道名称
   * @param {Function} callback - 回调函数
   */
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // ==================== 调用主进程方法（异步） ====================

  /**
   * 调用主进程方法并等待返回
   * @param {string} channel - 频道名称
   * @param {...*} args - 参数
   * @returns {Promise<*>} 返回值
   */
  invoke: async (channel, ...args) => {
    const validChannels = [
      // 配置相关
      'get-config',             // 获取配置
      'update-config',          // 更新配置

      // 设备信息
      'get-device-id',          // 获取设备ID
      'get-system-info',        // 获取系统信息

      // 截图相关
      'take-screenshot',        // 截图
      'get-screenshot-path',    // 获取截图路径

      // 文件操作
      'read-file',              // 读取文件
      'write-file',             // 写入文件
      'delete-file',            // 删除文件

      // 网络请求（通过主进程代理，避免 CORS）
      'fetch-api',              // API 请求

      // 其他
      'show-open-dialog',       // 显示打开对话框
      'show-save-dialog',       // 显示保存对话框
      'get-app-version',        // 获取应用版本
      'get-platform'            // 获取平台信息
    ];

    if (validChannels.includes(channel)) {
      return await ipcRenderer.invoke(channel, ...args);
    } else {
      console.warn('[Preload] Attempted to invoke invalid channel:', channel);
      throw new Error(`Invalid IPC channel: ${channel}`);
    }
  }
});

// 暴露版本信息（只读）
contextBridge.exposeInMainWorld('appInfo', {
  platform: process.platform,
  arch: process.arch,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});

console.log('[Preload] Preload script loaded successfully');
console.log('[Preload] Platform:', process.platform);
console.log('[Preload] Electron version:', process.versions.electron);
