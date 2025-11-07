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
import { updateLogger } from '@common/utils/update-logger';
import { UpdateApiClient } from './update-api-client';
import {
  UpdateStatus,
  UpdateStatusReport,
  UpdateMetadata,
  UpdateInfo,
  UpdateDownloadProgress
} from '@common/interfaces/update-status-interface';

export interface AutoUpdateServiceOptions {
  updateServerUrl: string;
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

  constructor(options: AutoUpdateServiceOptions) {
    super();

    this.channel = options.channel || 'stable';
    this.apiClient = new UpdateApiClient(
      options.updateServerUrl,
      app.getVersion()
    );

    this.configureAutoUpdater(options);
    this.setupEventHandlers();

    updateLogger.info('AutoUpdateService initialized', {
      version: app.getVersion(),
      channel: this.channel,
      updateServerUrl: options.updateServerUrl
    });
  }

  /**
   * Configure electron-updater
   */
  private configureAutoUpdater(options: AutoUpdateServiceOptions): void {
    // Set feed URL
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: options.updateServerUrl,
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
      updateLogger.info('Checking for updates...');
      this.emit('checking-for-update');
      this.reportUpdateStatus(UpdateStatus.CHECKING);
    });

    // Update available
    autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
      updateLogger.info('Update available', {
        version: info.version,
        releaseDate: info.releaseDate,
        size: info.files?.[0]?.size
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
    });

    // No update available
    autoUpdater.on('update-not-available', (info: ElectronUpdateInfo) => {
      updateLogger.info('No update available', { currentVersion: app.getVersion() });
      this.emit('update-not-available', this.convertUpdateInfo(info));
      this.reportUpdateStatus(UpdateStatus.NO_UPDATE);
    });

    // Download progress
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      updateLogger.debug('Download progress', {
        percent: Math.round(progress.percent),
        transferred: this.formatBytes(progress.transferred),
        total: this.formatBytes(progress.total),
        speed: this.formatBytes(progress.bytesPerSecond) + '/s'
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

      updateLogger.info('Update downloaded', {
        version: info.version,
        downloadDuration: downloadDuration ? `${downloadDuration}ms` : 'unknown'
      });

      this.downloadInProgress = false;
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
      updateLogger.error('Update error', error);
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
      updateLogger.info('Manual update check triggered');
      await autoUpdater.checkForUpdates();
    } catch (error: any) {
      updateLogger.error('Failed to check for updates', error);
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
    const machineId = app.getPath('userData');
    return crypto.createHash('md5').update(machineId).digest('hex');
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
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: this.apiClient.getBaseURL(),
      channel
    });
    updateLogger.info('Update channel changed', { channel });
  }
}
