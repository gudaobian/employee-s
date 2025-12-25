/**
 * Auto Update Service
 *
 * Core service for automatic application updates using electron-updater
 * Features:
 * - Automatic update checking
 * - Download with progress tracking
 * - Silent installation on quit
 * - Update status reporting
 * - Error handling and recovery
 * - Post-update verification
 */

import { autoUpdater, UpdateInfo as ElectronUpdateInfo, ProgressInfo } from 'electron-updater';
import { app, dialog, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { machineIdSync } from 'node-machine-id';
// ⚠️ 延迟导入：避免在模块加载时触发 getInstance() 导致同步文件操作
// import { updateLogger } from '../utils/update-logger';
// import { appConfig } from '../config/app-config-manager';
import { UpdateApiClient } from './update-api-client';
import {
  UpdateStatus,
  UpdateStatusReport,
  UpdateMetadata,
  UpdateInfo,
  UpdateDownloadProgress
} from '../interfaces/update-status-interface';
import { HotUpdateService } from './hot-update/HotUpdateService';
import { CheckUpdateResponse } from '../types/hot-update.types';
import {
  meetsMinVersion,
  formatVersionChange,
  getVersionChangeTitle,
  getVersionChangeDetail
} from '../utils/version-helper';

export interface AutoUpdateServiceOptions {
  updateServerUrl?: string; // 可选，如果不提供则使用 URLConfigManager
  channel?: 'stable' | 'beta' | 'dev';
  autoDownload?: boolean;
  autoInstallOnQuit?: boolean;
}

/**
 * 延迟加载配置管理器和日志器，避免模块加载时的同步文件操作
 * 这些 getter 会在首次访问时才加载模块，避免 require() 阶段的死锁
 */
let _appConfig: any = null;
let _updateLogger: any = null;

function getAppConfig() {
  if (!_appConfig) {
    const { appConfig } = require('../config/app-config-manager');
    _appConfig = appConfig;
  }
  return _appConfig;
}

function getUpdateLogger() {
  if (!_updateLogger) {
    const { updateLogger } = require('../utils/update-logger');
    _updateLogger = updateLogger;
  }
  return _updateLogger;
}

export class AutoUpdateService extends EventEmitter {
  private updateCheckInterval?: NodeJS.Timeout;
  private apiClient: UpdateApiClient;
  private isChecking: boolean = false;
  private downloadInProgress: boolean = false;
  private updateStartTime?: number;
  private downloadStartTime?: number;
  private channel: string;
  private lastNotifiedVersion?: string; // 记录上次通知的版本，避免重复通知
  private deviceId: string; // Device ID for multi-region OSS support
  private hotUpdateService: HotUpdateService | null = null; // 热更新服务

  constructor(options: AutoUpdateServiceOptions) {
    super();

    // Get device ID for multi-region OSS support
    try {
      this.deviceId = machineIdSync();
      getUpdateLogger().info('Device ID acquired', { deviceId: this.deviceId });
    } catch (error: any) {
      // Fallback to hash of userData path if machineIdSync fails
      const fallbackId = crypto.createHash('md5').update(app.getPath('userData')).digest('hex');
      this.deviceId = fallbackId;
      getUpdateLogger().warn('Failed to get machine ID, using fallback', {
        error: error.message,
        deviceId: this.deviceId
      });
    }

    this.channel = options.channel || 'stable';

    // 优先使用传入的 updateServerUrl，否则使用 AppConfigManager
    const updateServerUrl = options.updateServerUrl || getAppConfig().getUpdateServerUrl();

    this.apiClient = new UpdateApiClient(
      updateServerUrl,
      app.getVersion()
    );

    this.configureAutoUpdater(options, updateServerUrl);
    this.setupEventHandlers();

    // 监听配置变更，支持热更新
    getAppConfig().on('config-updated', this.handleConfigUpdate.bind(this));

    // ⚠️ 延迟初始化热更新服务，避免循环依赖
    // HotUpdateService 会在首次 checkForUpdates() 时按需初始化
    // 这样可以避免在模块加载阶段就创建实例导致的死锁
    this.hotUpdateService = null;

    getUpdateLogger().info('AutoUpdateService initialized', {
      version: app.getVersion(),
      channel: this.channel,
      updateServerUrl,
      deviceId: this.deviceId,
      hotUpdateEnabled: this.hotUpdateService !== null
    });
  }

  /**
   * Configure electron-updater
   */
  private configureAutoUpdater(options: AutoUpdateServiceOptions, updateServerUrl: string): void {
    // Set feed URL with deviceId as query parameter (required by backend)
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: `${updateServerUrl}?deviceId=${this.deviceId}`,
      channel: this.channel
    });

    // Configure auto-download
    autoUpdater.autoDownload = options.autoDownload !== false;

    // Configure auto-install on quit
    autoUpdater.autoInstallOnAppQuit = options.autoInstallOnQuit !== false;

    // Set logger
    autoUpdater.logger = getUpdateLogger().getLogger();

    // Allow downgrade (for beta/dev channels)
    autoUpdater.allowDowngrade = this.channel !== 'stable';

    // Don't force dev-server update in development
    autoUpdater.forceDevUpdateConfig = false;

    getUpdateLogger().info('AutoUpdater configured', {
      feedURL: `${updateServerUrl}?deviceId=${this.deviceId}`,
      channel: this.channel,
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnQuit: autoUpdater.autoInstallOnAppQuit,
      allowDowngrade: autoUpdater.allowDowngrade
    });
  }

  /**
   * Setup electron-updater event handlers
   *
   * ⚠️ DEPRECATED: 不再使用 electron-updater 进行全量更新
   * - 热更新：使用 HotUpdateService（差异包）
   * - 完整更新：提示用户手动下载 DMG
   *
   * 保留此方法以防未来需要恢复全量自动更新功能
   */
  private setupEventHandlers(): void {
    // ⚠️ 以下事件监听器已废弃，不再触发（因为不调用 autoUpdater.checkForUpdates()）
    // Checking for update
    autoUpdater.on('checking-for-update', () => {
      const feedURL = `${this.apiClient.getBaseURL()}?deviceId=${this.deviceId}`;
      getUpdateLogger().info('[EVENT] Checking for updates...', {
        feedURL,
        currentVersion: app.getVersion(),
        deviceId: this.deviceId,
        channel: this.channel,
        timestamp: new Date().toISOString()
      });
      this.emit('checking-for-update');
      this.reportUpdateStatus(UpdateStatus.CHECKING);
    });

    // Update available
    autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
      const downloadUrl = info.files?.[0]?.url || 'N/A';
      getUpdateLogger().info('[EVENT] Update available', {
        version: info.version,
        releaseDate: info.releaseDate,
        size: info.files?.[0]?.size,
        downloadUrl,
        currentVersion: app.getVersion(),
        deviceId: this.deviceId,
        timestamp: new Date().toISOString()
      });

      // 检查是否是新版本（与上次通知的版本不同）
      const isNewVersion = this.lastNotifiedVersion !== info.version;

      if (isNewVersion) {
        // 记录这次通知的版本
        this.lastNotifiedVersion = info.version;
        getUpdateLogger().info('[EVENT] New version detected, will show notification', {
          version: info.version,
          downloadUrl
        });

        this.updateStartTime = Date.now();
        this.emit('update-available', this.convertUpdateInfo(info));

        this.reportUpdateStatus(UpdateStatus.UPDATE_FOUND, {
          targetVersion: info.version,
          metadata: {
            releaseDate: info.releaseDate,
            size: info.files?.[0]?.size,
            releaseNotes: info.releaseNotes as string
          }
        });
      } else {
        getUpdateLogger().debug('[EVENT] Same version as before, skipping notification', { version: info.version });
      }
    });

    // No update available
    autoUpdater.on('update-not-available', (info: ElectronUpdateInfo) => {
      getUpdateLogger().info('[EVENT] No update available', {
        currentVersion: app.getVersion(),
        deviceId: this.deviceId,
        timestamp: new Date().toISOString()
      });
      this.emit('update-not-available', this.convertUpdateInfo(info));
      this.reportUpdateStatus(UpdateStatus.NO_UPDATE);
    });

    // Download progress
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      const percentRounded = Math.round(progress.percent);
      getUpdateLogger().debug('[EVENT] Download progress', {
        percent: percentRounded,
        transferred: this.formatBytes(progress.transferred),
        total: this.formatBytes(progress.total),
        speed: this.formatBytes(progress.bytesPerSecond) + '/s',
        deviceId: this.deviceId
      });

      const downloadProgress: UpdateDownloadProgress = {
        total: progress.total,
        delta: progress.delta,
        transferred: progress.transferred,
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond
      };

      this.emit('download-progress', downloadProgress);
    });

    // Update downloaded
    autoUpdater.on('update-downloaded', (info: ElectronUpdateInfo) => {
      const downloadDuration = this.downloadStartTime
        ? Date.now() - this.downloadStartTime
        : undefined;

      getUpdateLogger().info('[EVENT] Update downloaded', {
        version: info.version,
        downloadDuration: downloadDuration ? `${downloadDuration}ms` : 'unknown',
        path: info.path,
        deviceId: this.deviceId,
        timestamp: new Date().toISOString()
      });

      this.downloadInProgress = false;
      // 下载完成后清空已通知版本，允许下次检测到新版本时再次通知
      this.lastNotifiedVersion = undefined;
      this.emit('update-downloaded', this.convertUpdateInfo(info));

      this.reportUpdateStatus(UpdateStatus.DOWNLOADED, {
        targetVersion: info.version,
        metadata: {
          releaseDate: info.releaseDate,
          downloadDuration
        }
      });
    });

    // Error
    autoUpdater.on('error', (error: Error) => {
      getUpdateLogger().error('[EVENT] Update error', {
        error: error.message,
        stack: error.stack,
        deviceId: this.deviceId,
        timestamp: new Date().toISOString()
      });
      this.downloadInProgress = false;
      this.isChecking = false;
      this.emit('error', error);

      this.reportUpdateStatus(UpdateStatus.ERROR, {
        errorMessage: error.message
      });
    });
  }

  /**
   * Start periodic update checking
   */
  startPeriodicCheck(intervalMs: number = 6 * 60 * 60 * 1000): void {
    if (this.updateCheckInterval) {
      getUpdateLogger().warn('Periodic check already running, stopping previous interval');
      this.stopPeriodicCheck();
    }

    getUpdateLogger().info(`Starting periodic update check`, {
      interval: this.formatDuration(intervalMs)
    });

    // Check immediately
    this.checkForUpdates().catch((error) => {
      getUpdateLogger().error('Initial update check failed', error);
    });

    // Then check periodically
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates().catch((error) => {
        getUpdateLogger().error('Periodic update check failed', error);
      });
    }, intervalMs);
  }

  /**
   * Stop periodic update checking
   */
  stopPeriodicCheck(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = undefined;
      getUpdateLogger().info('Stopped periodic update check');
    }
  }

  /**
   * 检查是否满足最低版本要求
   */
  private checkMinVersion(minVersion: string | null | undefined): boolean {
    return meetsMinVersion(app.getVersion(), minVersion);
  }

  /**
   * 延迟初始化热更新服务（避免循环依赖）
   */
  private ensureHotUpdateService(): void {
    if (this.hotUpdateService || !app.isPackaged) {
      return; // 已初始化或非打包环境
    }

    try {
      const hotUpdateEnabled = getAppConfig().get('hotUpdateEnabled');
      if (hotUpdateEnabled !== false) {
        this.hotUpdateService = new HotUpdateService();
        this.setupHotUpdateListeners();
        getUpdateLogger().info('HotUpdateService lazy-initialized');
      } else {
        getUpdateLogger().info('HotUpdateService disabled by config');
      }
    } catch (error: any) {
      getUpdateLogger().warn('Failed to lazy-initialize HotUpdateService:', error.message);
    }
  }

  /**
   * Manually check for updates (支持热更新优先)
   */
  async checkForUpdates(): Promise<void> {
    if (this.isChecking) {
      getUpdateLogger().debug('Update check already in progress');
      return;
    }

    if (this.downloadInProgress) {
      getUpdateLogger().debug('Download in progress, skipping update check');
      return;
    }

    try {
      this.isChecking = true;

      // 延迟初始化热更新服务（避免模块加载时的循环依赖）
      this.ensureHotUpdateService();

      // 1. 优先尝试热更新
      if (this.hotUpdateService) {
        getUpdateLogger().info('[CHECK] Trying hot update first');

        const updateInfo = await this.hotUpdateService.checkForUpdates();

        // 兼容两种格式：优先使用 hotUpdate.manifest，其次使用直接的 manifest
        const manifest = updateInfo?.hotUpdate?.manifest || updateInfo?.manifest;

        if (updateInfo?.hasUpdate && updateInfo.updateType === 'hot' && manifest) {
          // 发现热更新
          getUpdateLogger().info(`[CHECK] Hot update available: ${updateInfo.version}`, {
            versionChangeType: updateInfo.versionChangeType,
            isForceUpdate: updateInfo.isForceUpdate,
            currentVersion: updateInfo.currentVersion,
            minVersion: updateInfo.minVersion,
            manifestSource: updateInfo.hotUpdate?.manifest ? 'hotUpdate.manifest' : 'manifest'
          });

          // 检查最低版本要求
          if (!this.checkMinVersion(updateInfo.minVersion)) {
            getUpdateLogger().warn('[CHECK] Current version below minimum required, forcing update', {
              currentVersion: app.getVersion(),
              minVersion: updateInfo.minVersion
            });
            // 强制更新标识
            updateInfo.isForceUpdate = true;
          }

          const success = await this.hotUpdateService.downloadAndApply(manifest);

          if (success) {
            // 热更新成功,提示用户重启（传递完整更新信息）
            getUpdateLogger().info('[CHECK] Hot update successful, prompting restart');
            this.promptUserToRestart(manifest.version, updateInfo);
            return;
          }

          // 热更新失败，直接报错，不降级到手动下载
          getUpdateLogger().error('[CHECK] Hot update failed, will not fallback to manual download');
          return;
        }

        if (updateInfo?.updateType === 'full') {
          // 后端判定需要完整更新（通常是Major版本），提示用户手动下载DMG
          getUpdateLogger().info('[CHECK] Full update required (backend decision), prompting manual download', {
            currentVersion: updateInfo.currentVersion,
            newVersion: updateInfo.version,
            reason: updateInfo.reason
          });
          this.showManualDownloadNotification(updateInfo);
          return;
        }
      }

      // 如果热更新服务未初始化或没有发现更新，记录日志
      getUpdateLogger().info('[CHECK] No hot update available, no further action needed');
    } catch (error: any) {
      getUpdateLogger().error('[CHECK] Failed to check for updates', {
        error: error.message,
        stack: error.stack,
        feedURL: `${this.apiClient.getBaseURL()}?deviceId=${this.deviceId}`
      });
      throw error;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Download update manually
   */
  async downloadUpdate(): Promise<void> {
    if (this.downloadInProgress) {
      getUpdateLogger().warn('Download already in progress');
      return;
    }

    try {
      this.downloadInProgress = true;
      this.downloadStartTime = Date.now();
      getUpdateLogger().info('Starting manual update download');

      await autoUpdater.downloadUpdate();
    } catch (error: any) {
      this.downloadInProgress = false;
      getUpdateLogger().error('Download failed', error);
      throw error;
    }
  }

  /**
   * Quit and install update
   */
  async quitAndInstall(isSilent: boolean = false, isForceRunAfter: boolean = true): Promise<void> {
    try {
      getUpdateLogger().info('Preparing to quit and install update', {
        isSilent,
        isForceRunAfter
      });

      // Save application state before quitting
      await this.saveApplicationState();

      // Report installing status
      this.reportUpdateStatus(UpdateStatus.INSTALLING);

      // Delay to ensure state is saved
      setTimeout(() => {
        autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
      }, 1000);
    } catch (error: any) {
      getUpdateLogger().error('Failed to quit and install', error);
      throw error;
    }
  }

  /**
   * Save application state before update
   */
  private async saveApplicationState(): Promise<void> {
    try {
      const state = {
        lastVersion: app.getVersion(),
        updateTime: new Date().toISOString(),
        wasUpdated: true,
        channel: this.channel
      };

      const statePath = path.join(app.getPath('userData'), 'update-state.json');
      await fs.promises.writeFile(statePath, JSON.stringify(state, null, 2));

      getUpdateLogger().info('Application state saved', state);
    } catch (error: any) {
      getUpdateLogger().error('Failed to save application state', error);
    }
  }

  /**
   * Verify update success after restart
   */
  async verifyUpdateSuccess(): Promise<boolean> {
    try {
      const statePath = path.join(app.getPath('userData'), 'update-state.json');

      if (!fs.existsSync(statePath)) {
        return false; // No update record
      }

      const state = JSON.parse(await fs.promises.readFile(statePath, 'utf-8'));

      if (!state.wasUpdated) {
        return false;
      }

      const currentVersion = app.getVersion();
      const wasSuccessful = currentVersion !== state.lastVersion;

      if (wasSuccessful) {
        const installDuration = this.updateStartTime
          ? Date.now() - this.updateStartTime
          : undefined;

        getUpdateLogger().logUpdateSuccess(state.lastVersion, currentVersion, installDuration);

        // Report success
        await this.reportUpdateStatus(UpdateStatus.INSTALLED, {
          targetVersion: currentVersion,
          metadata: {
            previousVersion: state.lastVersion,
            installDuration
          }
        });

        // Clear update flag
        state.wasUpdated = false;
        await fs.promises.writeFile(statePath, JSON.stringify(state, null, 2));
      }

      return wasSuccessful;
    } catch (error: any) {
      getUpdateLogger().error('Failed to verify update', error);
      return false;
    }
  }

  /**
   * Report update status to server
   */
  private async reportUpdateStatus(
    status: UpdateStatus,
    options?: {
      targetVersion?: string;
      errorMessage?: string;
      metadata?: UpdateMetadata;
    }
  ): Promise<void> {
    try {
      const report: UpdateStatusReport = {
        deviceId: this.getDeviceId(),
        currentVersion: app.getVersion(),
        targetVersion: options?.targetVersion,
        status,
        errorMessage: options?.errorMessage,
        timestamp: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        metadata: options?.metadata
      };

      await this.apiClient.reportUpdateStatus(report);
      getUpdateLogger().debug('Update status reported', { status });
    } catch (error: any) {
      getUpdateLogger().error('Failed to report update status', error);
      // Don't throw - status reporting failures shouldn't break update flow
    }
  }

  /**
   * Get device ID
   */
  private getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Convert electron-updater UpdateInfo to our format
   */
  private convertUpdateInfo(info: ElectronUpdateInfo): UpdateInfo {
    return {
      version: info.version,
      releaseNotes: info.releaseNotes as string,
      releaseDate: info.releaseDate,
      files: info.files?.map(f => ({
        url: f.url,
        size: f.size || 0,
        sha512: f.sha512 || ''
      })),
      path: info.path,
      sha512: info.sha512
    };
  }

  /**
   * Format bytes to human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Format duration to human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Get current update channel
   */
  getChannel(): string {
    return this.channel;
  }

  /**
   * Change update channel
   */
  setChannel(channel: 'stable' | 'beta' | 'dev'): void {
    this.channel = channel;
    const feedURL = `${this.apiClient.getBaseURL()}?deviceId=${this.deviceId}`;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedURL,
      channel
    });
    getUpdateLogger().info('Update channel changed', { channel, feedURL });
  }

  /**
   * 处理配置更新事件（支持热更新）
   */
  private handleConfigUpdate(updates: any): void {
    try {
      if (updates.baseUrl) {
        const newUpdateServerUrl = getAppConfig().getUpdateServerUrl();

        if (!newUpdateServerUrl) {
          getUpdateLogger().warn('baseUrl changed but updateServerUrl is undefined, skipping update');
          return;
        }

        const oldUpdateServerUrl = this.apiClient.getBaseURL();

        if (oldUpdateServerUrl !== newUpdateServerUrl) {
          getUpdateLogger().info('Update server URL changed, reconfiguring AutoUpdateService', {
            oldUrl: oldUpdateServerUrl,
            newUrl: newUpdateServerUrl
          });

          // 重新创建 API 客户端
          this.apiClient = new UpdateApiClient(
            newUpdateServerUrl,
            app.getVersion()
          );

          // 重新配置 autoUpdater
          autoUpdater.setFeedURL({
            provider: 'generic',
            url: `${newUpdateServerUrl}?deviceId=${this.deviceId}`,
            channel: this.channel
          });

          getUpdateLogger().info('AutoUpdateService reconfigured with new URL', {
            feedURL: `${newUpdateServerUrl}?deviceId=${this.deviceId}`,
            channel: this.channel
          });
        }
      }
    } catch (error: any) {
      getUpdateLogger().error('Failed to handle config update in AutoUpdateService', error);
    }
  }

  /**
   * 设置热更新事件监听
   */
  private setupHotUpdateListeners(): void {
    if (!this.hotUpdateService) return;

    this.hotUpdateService.on('checking', () => {
      getUpdateLogger().info('[HotUpdate] Checking for hot updates');
    });

    this.hotUpdateService.on('available', (updateInfo: CheckUpdateResponse) => {
      getUpdateLogger().info('[HotUpdate] Hot update available', {
        version: updateInfo.version,
        updateType: updateInfo.updateType
      });
    });

    this.hotUpdateService.on('not-available', () => {
      getUpdateLogger().info('[HotUpdate] No hot update available');
    });

    this.hotUpdateService.on('download-progress', (progress) => {
      getUpdateLogger().debug('[HotUpdate] Download progress', {
        percent: progress.percent,
        transferred: this.formatBytes(progress.transferred),
        total: this.formatBytes(progress.total)
      });
    });

    this.hotUpdateService.on('downloaded', (info) => {
      getUpdateLogger().info('[HotUpdate] Downloaded', { version: info.version });
    });

    this.hotUpdateService.on('error', (error) => {
      getUpdateLogger().error('[HotUpdate] Error', error);
    });
  }

  /**
   * 设置自动启动标志文件
   * 在热更新完成后重启前调用，用于标记应用在重启后自动启动服务
   */
  private setAutoStartFlag(): void {
    try {
      const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');
      const flagData = {
        timestamp: Date.now(),
        version: app.getVersion()
      };

      fs.writeFileSync(flagPath, JSON.stringify(flagData), 'utf-8');
      getUpdateLogger().info('[AUTO_START_FLAG] Flag file created', {
        path: flagPath,
        data: flagData
      });
    } catch (error: any) {
      getUpdateLogger().error('[AUTO_START_FLAG] Failed to create flag file', {
        error: error.message
      });
    }
  }

  /**
   * 提示用户重启应用（增强版：支持版本类型和强制更新）
   * ⚠️ 已修改为自动重启模式：热更新完成后自动重启，无需用户确认
   */
  private promptUserToRestart(version: string, updateInfo?: CheckUpdateResponse): void {
    try {
      const isForceUpdate = updateInfo?.isForceUpdate || false;
      const versionChangeType = updateInfo?.versionChangeType || 'patch';
      const currentVersion = updateInfo?.currentVersion || app.getVersion();

      getUpdateLogger().info('[AUTO_RESTART] Hot update downloaded, preparing auto-restart', {
        fromVersion: currentVersion,
        toVersion: version,
        versionChangeType,
        isForceUpdate
      });

      // 1️⃣ 设置自动启动标志文件
      this.setAutoStartFlag();

      // 2️⃣ 延迟1秒后自动重启（确保标志文件写入完成）
      setTimeout(() => {
        getUpdateLogger().info('[AUTO_RESTART] Restarting application...');
        app.relaunch();
        app.quit();
      }, 1000);

    } catch (error: any) {
      getUpdateLogger().error('[AUTO_RESTART] Failed to restart application', {
        error: error.message
      });
    }
  }

  /**
   * 显示手动下载通知（用于大版本更新或热更新失败）
   */
  private showManualDownloadNotification(updateInfo: CheckUpdateResponse & { downloadUrl?: string }): void {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];

      if (!mainWindow) {
        getUpdateLogger().warn('[MANUAL_DOWNLOAD] No main window found');
        return;
      }

      const currentVersion = updateInfo.currentVersion || app.getVersion();
      const newVersion = updateInfo.version;
      const downloadUrl = updateInfo.downloadUrl || updateInfo.manifest?.fallbackFullUrl;

      const title = '🚀 重大版本更新';
      const message = `发现新版本 ${newVersion}`;
      const detail =
        `当前版本: ${currentVersion}\n` +
        `新版本: ${newVersion}\n\n` +
        '检测到重大版本更新，需要手动下载安装。\n\n' +
        '点击"下载更新"将打开浏览器下载页面。';

      getUpdateLogger().info('[MANUAL_DOWNLOAD] Showing download notification', {
        currentVersion,
        newVersion,
        downloadUrl
      });

      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title,
        message,
        detail,
        buttons: ['下载更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      }).then((result) => {
        if (result.response === 0) {
          // 用户选择下载
          getUpdateLogger().info('[MANUAL_DOWNLOAD] User chose to download');

          if (downloadUrl) {
            // 打开浏览器下载
            const { shell } = require('electron');
            shell.openExternal(downloadUrl).then(() => {
              getUpdateLogger().info('[MANUAL_DOWNLOAD] Opened download URL in browser', { url: downloadUrl });
            }).catch((error: any) => {
              getUpdateLogger().error('[MANUAL_DOWNLOAD] Failed to open download URL', error);
            });
          } else {
            getUpdateLogger().error('[MANUAL_DOWNLOAD] No download URL available');
            dialog.showErrorBox('错误', '无法获取下载链接，请联系管理员');
          }
        } else {
          getUpdateLogger().info('[MANUAL_DOWNLOAD] User postponed download');
        }
      });
    } catch (error: any) {
      getUpdateLogger().error('[MANUAL_DOWNLOAD] Failed to show download notification', error);
    }
  }

}
