/**
 * Update Diagnostics Service
 *
 * Generates comprehensive diagnostic reports for update troubleshooting
 */

import { app, systemPreferences } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { updateLogger } from '@common/utils/update-logger';
import { PermissionVerificationService } from './permission-verification-service';
import { appConfig } from '@common/config/app-config-manager';

export interface DiagnosticReport {
  timestamp: string;
  system: SystemInfo;
  app: AppInfo;
  permissions: PermissionInfo;
  network: NetworkInfo;
  disk: DiskInfo;
  updateStatus: UpdateStatusInfo;
  logs: string;
}

interface SystemInfo {
  platform: string;
  arch: string;
  osVersion: string;
  nodeVersion: string;
  electronVersion: string;
  memory: {
    total: number;
    free: number;
    used: number;
  };
}

interface AppInfo {
  version: string;
  bundleId: string;
  path: string;
  userData: string;
  isPackaged: boolean;
}

interface PermissionInfo {
  accessibility: boolean;
  screenRecording: boolean;
  bundleIdCorrect: boolean;
  allGranted: boolean;
  issues: string[];
}

interface NetworkInfo {
  online: boolean;
  updateServerReachable: boolean;
  latency?: number;
}

interface DiskInfo {
  available: number;
  total: number;
  percentUsed: number;
}

interface UpdateStatusInfo {
  lastCheck?: string;
  lastUpdate?: string;
  currentChannel: string;
  pendingUpdate: boolean;
}

export class UpdateDiagnosticsService {
  private permissionService: PermissionVerificationService;

  constructor() {
    this.permissionService = new PermissionVerificationService();
  }

  /**
   * Generate comprehensive diagnostic report
   */
  async generateDiagnosticReport(): Promise<DiagnosticReport> {
    updateLogger.info('Generating diagnostic report...');

    const report: DiagnosticReport = {
      timestamp: new Date().toISOString(),
      system: await this.getSystemInfo(),
      app: this.getAppInfo(),
      permissions: await this.getPermissionInfo(),
      network: await this.getNetworkInfo(),
      disk: await this.getDiskInfo(),
      updateStatus: await this.getUpdateStatus(),
      logs: await this.getRecentLogs()
    };

    updateLogger.info('Diagnostic report generated successfully');
    return report;
  }

  /**
   * Get system information
   */
  private async getSystemInfo(): Promise<SystemInfo> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      platform: process.platform,
      arch: process.arch,
      osVersion: os.release(),
      nodeVersion: process.version,
      electronVersion: process.versions.electron || 'unknown',
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem
      }
    };
  }

  /**
   * Get application information
   */
  private getAppInfo(): AppInfo {
    return {
      version: app.getVersion(),
      bundleId: app.getName(),
      path: app.getAppPath(),
      userData: app.getPath('userData'),
      isPackaged: app.isPackaged
    };
  }

  /**
   * Get permission information
   */
  private async getPermissionInfo(): Promise<PermissionInfo> {
    try {
      const status = await this.permissionService.verifyPermissionsAfterUpdate();
      return status;
    } catch (error: any) {
      updateLogger.error('Failed to get permission info', error);
      return {
        accessibility: false,
        screenRecording: false,
        bundleIdCorrect: false,
        allGranted: false,
        issues: ['Failed to check permissions: ' + error.message]
      };
    }
  }

  /**
   * Get network information
   */
  private async getNetworkInfo(): Promise<NetworkInfo> {
    const axios = require('axios');

    const info: NetworkInfo = {
      online: false,
      updateServerReachable: false
    };

    try {
      // Check if online
      const startTime = Date.now();
      await axios.get('https://www.google.com', { timeout: 5000 });
      info.online = true;
      info.latency = Date.now() - startTime;
    } catch (error) {
      updateLogger.debug('Network check failed', error);
    }

    try {
      // Check update server
      const updateServerUrl = appConfig.getUpdateServerUrl();
      if (updateServerUrl) {
        await axios.get(updateServerUrl, { timeout: 5000 });
        info.updateServerReachable = true;
      }
    } catch (error) {
      updateLogger.debug('Update server check failed', error);
    }

    return info;
  }

  /**
   * Get disk information
   */
  private async getDiskInfo(): Promise<DiskInfo> {
    try {
      const checkDiskSpace = require('check-disk-space').default;
      const diskSpace = await checkDiskSpace(app.getPath('userData'));

      return {
        available: diskSpace.free,
        total: diskSpace.size,
        percentUsed: ((diskSpace.size - diskSpace.free) / diskSpace.size) * 100
      };
    } catch (error: any) {
      updateLogger.error('Failed to get disk info', error);
      return {
        available: 0,
        total: 0,
        percentUsed: 0
      };
    }
  }

  /**
   * Get update status
   */
  private async getUpdateStatus(): Promise<UpdateStatusInfo> {
    try {
      const statePath = path.join(app.getPath('userData'), 'update-state.json');

      const status: UpdateStatusInfo = {
        currentChannel: 'stable',
        pendingUpdate: false
      };

      if (fs.existsSync(statePath)) {
        const state = JSON.parse(await fs.promises.readFile(statePath, 'utf-8'));
        status.lastUpdate = state.updateTime;
        status.pendingUpdate = state.wasUpdated || false;
      }

      // Try to get preferences
      const prefsPath = path.join(
        app.getPath('userData'),
        'config.json' // electron-store default
      );
      if (fs.existsSync(prefsPath)) {
        const prefs = JSON.parse(await fs.promises.readFile(prefsPath, 'utf-8'));
        status.lastCheck = prefs.lastCheckTime;
      }

      return status;
    } catch (error: any) {
      updateLogger.error('Failed to get update status', error);
      return {
        currentChannel: 'unknown',
        pendingUpdate: false
      };
    }
  }

  /**
   * Get recent logs
   */
  private async getRecentLogs(lines: number = 1000): Promise<string> {
    try {
      const logs = await updateLogger.readLogs(lines);
      return logs;
    } catch (error: any) {
      updateLogger.error('Failed to read logs', error);
      return `Error reading logs: ${error.message}`;
    }
  }

  /**
   * Export diagnostic report to file
   */
  async exportReport(report: DiagnosticReport, filePath?: string): Promise<string> {
    const exportPath =
      filePath ||
      path.join(
        app.getPath('desktop'),
        `update-diagnostic-${Date.now()}.json`
      );

    try {
      await fs.promises.writeFile(exportPath, JSON.stringify(report, null, 2));
      updateLogger.info('Diagnostic report exported', { path: exportPath });
      return exportPath;
    } catch (error: any) {
      updateLogger.error('Failed to export diagnostic report', error);
      throw error;
    }
  }

  /**
   * Generate summary report (text format)
   */
  generateSummary(report: DiagnosticReport): string {
    const lines: string[] = [
      '='.repeat(60),
      'UPDATE DIAGNOSTIC REPORT',
      '='.repeat(60),
      '',
      `Generated: ${report.timestamp}`,
      '',
      '--- SYSTEM INFO ---',
      `Platform: ${report.system.platform} (${report.system.arch})`,
      `OS Version: ${report.system.osVersion}`,
      `Electron: ${report.system.electronVersion}`,
      `Memory: ${this.formatBytes(report.system.memory.used)} / ${this.formatBytes(report.system.memory.total)} (${Math.round((report.system.memory.used / report.system.memory.total) * 100)}%)`,
      '',
      '--- APPLICATION INFO ---',
      `Version: ${report.app.version}`,
      `Bundle ID: ${report.app.bundleId}`,
      `Packaged: ${report.app.isPackaged}`,
      `Path: ${report.app.path}`,
      '',
      '--- PERMISSIONS ---',
      `✓ Accessibility: ${report.permissions.accessibility ? 'Granted' : 'NOT GRANTED'}`,
      `✓ Screen Recording: ${report.permissions.screenRecording ? 'Granted' : 'NOT GRANTED'}`,
      `✓ Bundle ID: ${report.permissions.bundleIdCorrect ? 'Correct' : 'INCORRECT'}`,
      `Status: ${report.permissions.allGranted ? '✅ All OK' : '❌ Issues Detected'}`,
      ...(report.permissions.issues.length > 0
        ? ['Issues:', ...report.permissions.issues.map((i) => `  - ${i}`)]
        : []),
      '',
      '--- NETWORK ---',
      `Online: ${report.network.online ? 'Yes' : 'No'}`,
      ...(report.network.latency
        ? [`Latency: ${report.network.latency}ms`]
        : []),
      `Update Server: ${report.network.updateServerReachable ? 'Reachable' : 'Unreachable'}`,
      '',
      '--- DISK SPACE ---',
      `Available: ${this.formatBytes(report.disk.available)}`,
      `Total: ${this.formatBytes(report.disk.total)}`,
      `Used: ${Math.round(report.disk.percentUsed)}%`,
      '',
      '--- UPDATE STATUS ---',
      `Channel: ${report.updateStatus.currentChannel}`,
      ...(report.updateStatus.lastCheck
        ? [`Last Check: ${report.updateStatus.lastCheck}`]
        : []),
      ...(report.updateStatus.lastUpdate
        ? [`Last Update: ${report.updateStatus.lastUpdate}`]
        : []),
      `Pending Update: ${report.updateStatus.pendingUpdate ? 'Yes' : 'No'}`,
      '',
      '='.repeat(60)
    ];

    return lines.join('\n');
  }

  /**
   * Format bytes to human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}
