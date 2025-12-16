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
import { app } from 'electron';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { machineIdSync } from 'node-machine-id';
import { updateLogger } from '../utils/update-logger';
import { UpdateApiClient } from './update-api-client';
import { appConfig } from '../config/app-config-manager';
import {
  UpdateStatus,
  UpdateStatusReport,
  UpdateMetadata,
  UpdateInfo,
  UpdateDownloadProgress
} from '../interfaces/update-status-interface';

export interface AutoUpdateServiceOptions {
  updateServerUrl?: string; // 可选，如果不提供则使用 URLConfigManager
  channel?: 'stable' | 'beta' | 'dev';
  autoDownload?: boolean;
  autoInstallOnQuit?: boolean;
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

  constructor(options: AutoUpdateServiceOptions) {
    super();

    // Get device ID for multi-region OSS support
    try {
      this.deviceId = machineIdSync();
      updateLogger.info('Device ID acquired', { deviceId: this.deviceId });
    } catch (error: any) {
      // Fallback to hash of userData path if machineIdSync fails
      const fallbackId = crypto.createHash('md5').update(app.getPath('userData')).digest('hex');
      this.deviceId = fallbackId;
      updateLogger.warn('Failed to get machine ID, using fallback', {
        error: error.message,
        deviceId: this.deviceId
      });
    }

    this.channel = options.channel || 'stable';

    // 优先使用传入的 updateServerUrl，否则使用 AppConfigManager
    const updateServerUrl = options.updateServerUrl || appConfig.getUpdateServerUrl();

    this.apiClient = new UpdateApiClient(
      updateServerUrl,
      app.getVersion()
    );

    this.configureAutoUpdater(options, updateServerUrl);
    this.setupEventHandlers();

    // 监听配置变更，支持热更新
    appConfig.on('config-updated', this.handleConfigUpdate.bind(this));

    updateLogger.info('AutoUpdateService initialized', {
      version: app.getVersion(),
      channel: this.channel,
      updateServerUrl,
      deviceId: this.deviceId
    });
  }

  /**
   * Configure electron-updater
   */
  private configureAutoUpdater(options: AutoUpdateServiceOptions, updateServerUrl: string): void {
    // Build feed URL with deviceId query parameter for multi-region OSS support
    const feedURL = `${updateServerUrl}?deviceId=${this.deviceId}`;

    // Set feed URL
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedURL,
      channel: this.channel
    });

    // Configure auto-download
    autoUpdater.autoDownload = options.autoDownload !== false;

    // Configure auto-install on quit
    autoUpdater.autoInstallOnAppQuit = options.autoInstallOnQuit !== false;

    // Set logger
    autoUpdater.logger = updateLogger.getLogger();

    // Allow downgrade (for beta/dev channels)
    autoUpdater.allowDowngrade = this.channel !== 'stable';

    // Don't force dev-server update in development
    autoUpdater.forceDevUpdateConfig = false;

    updateLogger.info('AutoUpdater configured', {
      feedURL,
      deviceId: this.deviceId,
      channel: this.channel,
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnQuit: autoUpdater.autoInstallOnAppQuit,
      allowDowngrade: autoUpdater.allowDowngrade
    });
  }

  /**
   * Setup electron-updater event handlers
   */
  private setupEventHandlers(): void {
    // Checking for update
    autoUpdater.on('checking-for-update', () => {
      const feedURL = `${this.apiClient.getBaseURL()}?deviceId=${this.deviceId}`;
      updateLogger.info('[EVENT] Checking for updates...', {
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
      updateLogger.info('[EVENT] Update available', {
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
        updateLogger.info('[EVENT] New version detected, will show notification', {
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
        updateLogger.debug('[EVENT] Same version as before, skipping notification', { version: info.version });
      }
    });

    // No update available
    autoUpdater.on('update-not-available', (info: ElectronUpdateInfo) => {
      updateLogger.info('[EVENT] No update available', {
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
      updateLogger.debug('[EVENT] Download progress', {
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

      updateLogger.info('[EVENT] Update downloaded', {
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
      updateLogger.error('[EVENT] Update error', {
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
      updateLogger.warn('Periodic check already running, stopping previous interval');
      this.stopPeriodicCheck();
    }

    updateLogger.info(`Starting periodic update check`, {
      interval: this.formatDuration(intervalMs)
    });

    // Check immediately
    this.checkForUpdates().catch((error) => {
      updateLogger.error('Initial update check failed', error);
    });

    // Then check periodically
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates().catch((error) => {
        updateLogger.error('Periodic update check failed', error);
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
      updateLogger.info('Stopped periodic update check');
    }
  }

  /**
   * Manually check for updates
   */
  async checkForUpdates(): Promise<void> {
    if (this.isChecking) {
      updateLogger.debug('Update check already in progress');
      return;
    }

    if (this.downloadInProgress) {
      updateLogger.debug('Download in progress, skipping update check');
      return;
    }

    try {
      this.isChecking = true;
      const feedURL = `${this.apiClient.getBaseURL()}?deviceId=${this.deviceId}`;
      updateLogger.info('[CHECK] Manual update check triggered', {
        currentVersion: app.getVersion(),
        feedURL,
        deviceId: this.deviceId,
        channel: this.channel,
        timestamp: new Date().toISOString()
      });

      const result = await autoUpdater.checkForUpdates();

      if (result) {
        updateLogger.info('[CHECK] Update check completed', {
          updateInfo: result.updateInfo,
          hasUpdate: result.updateInfo.version !== app.getVersion()
        });
      }
    } catch (error: any) {
      updateLogger.error('[CHECK] Failed to check for updates', {
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
      updateLogger.warn('Download already in progress');
      return;
    }

    try {
      this.downloadInProgress = true;
      this.downloadStartTime = Date.now();
      updateLogger.info('Starting manual update download');

      await autoUpdater.downloadUpdate();
    } catch (error: any) {
      this.downloadInProgress = false;
      updateLogger.error('Download failed', error);
      throw error;
    }
  }

  /**
   * Quit and install update
   */
  async quitAndInstall(isSilent: boolean = false, isForceRunAfter: boolean = true): Promise<void> {
    try {
      updateLogger.info('Preparing to quit and install update', {
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
      updateLogger.error('Failed to quit and install', error);
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

      updateLogger.info('Application state saved', state);
    } catch (error: any) {
      updateLogger.error('Failed to save application state', error);
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

        updateLogger.logUpdateSuccess(state.lastVersion, currentVersion, installDuration);

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
      updateLogger.error('Failed to verify update', error);
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
      updateLogger.debug('Update status reported', { status });
    } catch (error: any) {
      updateLogger.error('Failed to report update status', error);
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
    updateLogger.info('Update channel changed', { channel, feedURL, deviceId: this.deviceId });
  }

  /**
   * 处理配置更新事件（支持热更新）
   */
  private handleConfigUpdate(updates: any): void {
    try {
      if (updates.baseUrl) {
        const newUpdateServerUrl = appConfig.getUpdateServerUrl();

        if (!newUpdateServerUrl) {
          updateLogger.warn('baseUrl changed but updateServerUrl is undefined, skipping update');
          return;
        }

        const oldUpdateServerUrl = this.apiClient.getBaseURL();

        if (oldUpdateServerUrl !== newUpdateServerUrl) {
          updateLogger.info('Update server URL changed, reconfiguring AutoUpdateService', {
            oldUrl: oldUpdateServerUrl,
            newUrl: newUpdateServerUrl
          });

          // 重新创建 API 客户端
          this.apiClient = new UpdateApiClient(
            newUpdateServerUrl,
            app.getVersion()
          );

          // 重新配置 autoUpdater
          const feedURL = `${newUpdateServerUrl}?deviceId=${this.deviceId}`;
          autoUpdater.setFeedURL({
            provider: 'generic',
            url: feedURL,
            channel: this.channel
          });

          updateLogger.info('AutoUpdateService reconfigured with new URL', {
            feedURL,
            channel: this.channel
          });
        }
      }
    } catch (error: any) {
      updateLogger.error('Failed to handle config update in AutoUpdateService', error);
    }
  }
}
