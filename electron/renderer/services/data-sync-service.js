/**
 * 数据同步服务 - 渲染进程代理版本
 *
 * 职责：
 * 1. 作为主进程数据同步服务的代理
 * 2. 管理本地同步状态
 * 3. 触发同步请求并接收同步结果
 *
 * 注意：实际的数据同步逻辑在主进程，此类主要负责触发和状态管理
 */

class DataSyncService extends EventEmitter {
  constructor(config) {
    super();

    this.config = config || {};
    this.deviceId = config.deviceId || null;
    this.apiUrl = config.apiUrl || '';
    this.syncInterval = config.syncInterval || 60000; // 默认 60 秒

    // 本地状态
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.syncError = null;
    this.syncTimer = null;
    this.syncCount = 0;

    console.log('[DataSyncService] Instance created with config:', {
      apiUrl: this.apiUrl,
      syncInterval: this.syncInterval,
      hasDeviceId: !!this.deviceId
    });
  }

  /**
   * 初始化
   */
  async init() {
    console.log('[DataSyncService] Initializing...');

    // 监听主进程的数据同步完成事件（如果有）
    if (window.electronAPI && window.electronAPI.on) {
      // 可以添加监听器
    }

    console.log('[DataSyncService] Initialized');
  }

  /**
   * 启动定时同步
   */
  start() {
    console.log('[DataSyncService] Starting periodic sync...');

    if (this.syncTimer) {
      console.warn('[DataSyncService] Sync already started');
      return;
    }

    // 立即执行一次同步
    this.sync();

    // 启动定时器
    this.syncTimer = setInterval(() => {
      this.sync();
    }, this.syncInterval);

    console.log('[DataSyncService] Periodic sync started with interval:', this.syncInterval);
  }

  /**
   * 停止定时同步
   */
  stop() {
    console.log('[DataSyncService] Stopping periodic sync...');

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    console.log('[DataSyncService] Periodic sync stopped');
  }

  /**
   * 执行同步
   */
  async sync() {
    if (this.isSyncing) {
      console.log('[DataSyncService] Sync already in progress, skipping...');
      return { success: false, error: 'Sync in progress' };
    }

    console.log('[DataSyncService] Syncing data...');
    this.isSyncing = true;
    this.emit('sync-start');

    try {
      // 调用主进程的同步功能
      const result = await this.performSync();

      this.isSyncing = false;
      this.lastSyncTime = Date.now();
      this.syncCount++;
      this.syncError = null;

      console.log('[DataSyncService] Sync completed successfully:', result);

      // 触发事件
      this.emit('sync-complete', {
        timestamp: this.lastSyncTime,
        count: this.syncCount,
        result
      });

      // 通知主进程同步完成
      if (window.electronAPI && window.electronAPI.send) {
        window.electronAPI.send('data-synced', {
          timestamp: this.lastSyncTime,
          success: true,
          count: this.syncCount
        });
      }

      return {
        success: true,
        timestamp: this.lastSyncTime,
        count: this.syncCount
      };

    } catch (error) {
      console.error('[DataSyncService] Sync failed:', error);

      this.isSyncing = false;
      this.syncError = error.message;

      this.emit('sync-failed', {
        error: error.message,
        timestamp: Date.now()
      });

      // 通知主进程同步失败
      if (window.electronAPI && window.electronAPI.send) {
        window.electronAPI.send('data-synced', {
          timestamp: Date.now(),
          success: false,
          error: error.message
        });
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 实际执行同步（可以通过 IPC 调用主进程）
   */
  async performSync() {
    // 模拟同步操作
    // 实际应该通过 IPC 调用主进程的同步服务

    // 检查是否有 system.syncData 方法
    if (window.electronAPI && window.electronAPI.system && window.electronAPI.system.syncData) {
      const result = await window.electronAPI.system.syncData();
      return result;
    }

    // 降级：模拟同步
    console.log('[DataSyncService] Using mock sync (main process sync not available)');

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          synced: true,
          itemCount: Math.floor(Math.random() * 10),
          timestamp: Date.now()
        });
      }, 500); // 模拟网络延迟
    });
  }

  /**
   * 强制立即同步
   */
  async syncNow() {
    console.log('[DataSyncService] Force sync requested');
    return await this.sync();
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    console.log('[DataSyncService] Updating config:', newConfig);

    if (newConfig.apiUrl) {
      this.apiUrl = newConfig.apiUrl;
    }

    if (newConfig.deviceId) {
      this.deviceId = newConfig.deviceId;
    }

    if (newConfig.syncInterval) {
      const oldInterval = this.syncInterval;
      this.syncInterval = newConfig.syncInterval;

      // 如果定时器正在运行，重启它
      if (this.syncTimer) {
        console.log('[DataSyncService] Restarting timer with new interval:', {
          old: oldInterval,
          new: this.syncInterval
        });

        this.stop();
        this.start();
      }
    }

    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取同步状态
   */
  getStatus() {
    return {
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      syncCount: this.syncCount,
      syncError: this.syncError,
      syncInterval: this.syncInterval
    };
  }

  /**
   * 保存状态（用于热更新）
   */
  saveState() {
    return {
      lastSyncTime: this.lastSyncTime,
      syncCount: this.syncCount,
      syncInterval: this.syncInterval,
      deviceId: this.deviceId,
      apiUrl: this.apiUrl
    };
  }

  /**
   * 恢复状态（热更新后）
   */
  restoreState(savedState) {
    if (!savedState) return;

    console.log('[DataSyncService] Restoring state');

    this.lastSyncTime = savedState.lastSyncTime || null;
    this.syncCount = savedState.syncCount || 0;
    this.syncInterval = savedState.syncInterval || this.syncInterval;
    this.deviceId = savedState.deviceId || this.deviceId;
    this.apiUrl = savedState.apiUrl || this.apiUrl;

    this.emit('state-restored', {
      lastSyncTime: this.lastSyncTime,
      syncCount: this.syncCount
    });
  }

  /**
   * 清理资源
   */
  cleanup() {
    console.log('[DataSyncService] Cleaning up...');

    // 停止定时器
    this.stop();

    // 移除所有监听器
    this.removeAllListeners();

    console.log('[DataSyncService] Cleanup complete');
  }
}

// 导出（浏览器环境）
