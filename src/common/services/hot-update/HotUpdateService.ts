import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import fetch from 'node-fetch';
import { app } from 'electron';
import * as log from 'electron-log';
import { AsarManager } from './AsarManager';
import { DiffApplier } from './DiffApplier';
import { UpdateVerifier } from './UpdateVerifier';
import {
  HotUpdateManifest,
  CheckUpdateResponse,
  ReportUpdateRequest,
  HotUpdateEvent,
  DownloadProgress
} from '../../types/hot-update.types';
import { AppConfigManager } from '../../config/app-config-manager';
import { StableHardwareIdentifier } from '../../utils/stable-hardware-identifier';

/**
 * 热更新服务
 *
 * 负责检查更新、下载差异包、应用差异、回滚和上报
 */
export class HotUpdateService extends EventEmitter {
  private asarManager: AsarManager;
  private diffApplier: DiffApplier;
  private verifier: UpdateVerifier;
  private configManager: AppConfigManager;
  private hardwareIdentifier: StableHardwareIdentifier;
  private apiBaseUrl: string;
  private tempDir: string;
  private isUpdating: boolean = false;

  constructor() {
    super();

    if (!app.isPackaged) {
      throw new Error('HotUpdateService只能在打包环境下使用');
    }

    this.asarManager = new AsarManager();
    this.diffApplier = new DiffApplier();
    this.verifier = new UpdateVerifier();
    this.configManager = AppConfigManager.getInstance();
    this.hardwareIdentifier = StableHardwareIdentifier.getInstance();

    // 获取API基础URL
    const baseUrl = this.configManager.getBaseUrl();
    if (!baseUrl) {
      log.warn('[HotUpdate] 未配置服务器地址,使用默认地址');
      this.apiBaseUrl = 'http://23.95.207.162:3000';
    } else {
      this.apiBaseUrl = baseUrl;
    }

    this.tempDir = path.join(os.tmpdir(), 'employee-monitor-hot-update');
  }

  /**
   * 检查更新
   */
  async checkForUpdates(): Promise<CheckUpdateResponse | null> {
    try {
      this.emit('checking');
      log.info('[HotUpdate] 开始检查更新');

      const currentVersion = app.getVersion();
      const platform = process.platform === 'darwin' ? 'darwin' : 'win32';
      const deviceInfo = await this.hardwareIdentifier.generateStableDeviceId();
      const deviceId = deviceInfo.deviceId;

      // 🆕 获取CPU架构信息
      const arch = process.arch; // 'arm64', 'x64', 'ia32'

      const url = `${this.apiBaseUrl}/api/hot-update/check?` +
        `currentVersion=${currentVersion}&` +
        `platform=${platform}&` +
        `arch=${arch}&` +
        `deviceId=${deviceId}`;

      log.info(`[HotUpdate] 请求URL: ${url}`);
      log.info(`[HotUpdate] 设备架构: ${platform}-${arch}`);

      const response = await fetch(url, {
        method: 'GET',
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { success: boolean; data: CheckUpdateResponse };

      if (!result.success || !result.data.hasUpdate) {
        log.info('[HotUpdate] 无可用更新');
        this.emit('not-available');
        return null;
      }

      log.info(`[HotUpdate] 发现更新: ${result.data.version} (${result.data.updateType})`);
      this.emit('available', result.data);

      return result.data;
    } catch (error: any) {
      log.error('[HotUpdate] 检查更新失败:', error);
      this.emit('error', error);
      return null;
    }
  }

  /**
   * 下载并应用热更新
   */
  async downloadAndApply(manifest: HotUpdateManifest): Promise<boolean> {
    if (this.isUpdating) {
      log.warn('[HotUpdate] 更新已在进行中');
      return false;
    }

    this.isUpdating = true;
    const startTime = Date.now();
    let downloadDuration = 0;
    let installDuration = 0;

    try {
      log.info(`[HotUpdate] 开始下载并应用更新: ${manifest.version}`);

      // 1. 下载差异包
      this.emit('downloading', { percent: 0, transferred: 0, total: manifest.diffSize });
      const diffPath = await this.downloadDiffPackage(manifest);
      downloadDuration = Date.now() - startTime;
      log.info(`[HotUpdate] 下载完成,耗时: ${downloadDuration}ms`);

      // 2. 验证完整性
      this.emit('verifying');
      const isValid = await this.verifier.verify(diffPath, manifest.diffSha512);
      if (!isValid) {
        throw new Error('差异包SHA512校验失败');
      }
      log.info('[HotUpdate] 校验通过');

      // 3. 备份当前ASAR + unpacked
      await this.asarManager.createFullBackup();
      log.info('[HotUpdate] 完整备份完成（ASAR + unpacked）');

      // 4. 应用差异
      this.emit('installing');
      const installStartTime = Date.now();
      const newAsarPath = await this.applyDiffPackage(diffPath, manifest);
      installDuration = Date.now() - installStartTime;
      log.info(`[HotUpdate] 安装完成,耗时: ${installDuration}ms`);

      // 5. 验证新版本（验证.new文件）
      const newVersion = await this.asarManager.getVersionFromFile(newAsarPath);
      if (newVersion !== manifest.version) {
        throw new Error(`版本验证失败: 期望 ${manifest.version}, 实际 ${newVersion}`);
      }
      log.info(`[HotUpdate] 版本验证通过: ${newVersion}`);

      // 6. 清理临时文件
      await this.cleanup();

      // 7. 上报成功
      await this.reportResult(manifest, true, null, downloadDuration, installDuration);

      this.emit('downloaded', { version: manifest.version });
      log.info('[HotUpdate] 热更新成功完成');

      this.isUpdating = false;
      return true;

    } catch (error: any) {
      log.error('[HotUpdate] 热更新失败:', error);

      // 回滚
      try {
        await this.rollback();
        log.info('[HotUpdate] 回滚成功');
      } catch (rollbackError) {
        log.error('[HotUpdate] 回滚失败:', rollbackError);
      }

      // 上报失败
      await this.reportResult(
        manifest,
        false,
        error.message,
        downloadDuration,
        installDuration
      );

      this.emit('error', error);
      this.isUpdating = false;
      return false;
    }
  }

  /**
   * 下载差异包
   */
  private async downloadDiffPackage(manifest: HotUpdateManifest): Promise<string> {
    await fs.ensureDir(this.tempDir);
    const diffPath = path.join(this.tempDir, `diff-${manifest.version}.tar.gz`);

    const response = await fetch(manifest.diffUrl, {
      timeout: 120000 // 2分钟超时
    });

    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }

    const totalBytes = manifest.diffSize;
    let downloadedBytes = 0;

    return new Promise<string>((resolve, reject) => {
      const fileStream = fs.createWriteStream(diffPath);

      response.body!.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        const percent = Math.round((downloadedBytes / totalBytes) * 100);

        this.emit('download-progress', {
          percent,
          transferred: downloadedBytes,
          total: totalBytes
        } as DownloadProgress);
      });

      response.body!.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(diffPath);
      });

      fileStream.on('error', (error) => {
        fs.remove(diffPath).catch(() => {});
        reject(error);
      });
    });
  }

  /**
   * 应用差异包
   * @returns 新ASAR文件的路径
   */
  private async applyDiffPackage(diffPath: string, manifest: HotUpdateManifest): Promise<string> {
    const tempExtractDir = path.join(this.tempDir, 'extract');  // 包含 asar/ 和 unpacked/ 子目录
    const tempDiffDir = path.join(this.tempDir, 'diff-extract');

    try {
      // 1. 解包当前ASAR + unpacked
      log.info('[HotUpdate] 开始解包当前应用（ASAR + unpacked）');
      await this.asarManager.extractWithUnpacked(tempExtractDir);

      // 2. 解压差异包
      log.info('[HotUpdate] 解压差异包');
      await this.diffApplier.extractDiffPackage(diffPath, tempDiffDir);

      // 3. 读取差异清单
      log.info('[HotUpdate] 读取差异清单');
      const diffManifest = await this.diffApplier.readManifest(tempDiffDir);

      // 4. 应用差异（支持 ASAR + unpacked）
      log.info('[HotUpdate] 应用差异');
      await this.diffApplier.applyDiffWithUnpacked(tempExtractDir, tempDiffDir, diffManifest);

      // 5. 验证差异应用
      log.info('[HotUpdate] 验证差异应用');
      const asarExtractDir = path.join(tempExtractDir, 'asar');
      const verifyResult = await this.diffApplier.verify(asarExtractDir, diffManifest);
      if (!verifyResult) {
        throw new Error('差异应用验证失败');
      }

      // 6. 重新打包ASAR + unpacked 并保存为 .new 文件（不能直接替换正在运行的文件）
      log.info('[HotUpdate] 重新打包应用');
      const newAsarPath = `${this.asarManager.getAsarPath()}.new`;
      await this.asarManager.packWithUnpacked(tempExtractDir, newAsarPath);
      log.info('[HotUpdate] 新版本已保存:', newAsarPath);

      return newAsarPath;

    } finally {
      // 清理临时目录
      await fs.remove(tempExtractDir).catch(() => {});
      await fs.remove(tempDiffDir).catch(() => {});
    }
  }

  /**
   * 回滚到备份
   */
  private async rollback(): Promise<void> {
    log.info('[HotUpdate] 开始回滚（恢复 ASAR + unpacked）');
    await this.asarManager.restoreFromFullBackup();
    log.info('[HotUpdate] 回滚完成');
  }

  /**
   * 清理临时文件
   */
  private async cleanup(): Promise<void> {
    try {
      await fs.remove(this.tempDir);
      await this.asarManager.removeFullBackup();
      log.info('[HotUpdate] 清理完成（包括 unpacked 备份）');
    } catch (error) {
      log.warn('[HotUpdate] 清理临时文件失败:', error);
    }
  }

  /**
   * 上报更新结果
   */
  private async reportResult(
    manifest: HotUpdateManifest,
    success: boolean,
    error: string | null = null,
    downloadDuration: number = 0,
    installDuration: number = 0
  ): Promise<void> {
    try {
      const currentVersion = app.getVersion();
      const platform = process.platform === 'darwin' ? 'darwin' : 'win32';
      const deviceInfo = await this.hardwareIdentifier.generateStableDeviceId();
      const deviceId = deviceInfo.deviceId;

      const reportData: ReportUpdateRequest = {
        deviceId,
        fromVersion: currentVersion,
        toVersion: manifest.version,
        platform,
        updateType: 'hot',
        success,
        downloadDuration,
        installDuration
      };

      if (!success && error) {
        reportData.error = error;
        reportData.updateType = 'hot_fallback';
        reportData.fallbackReason = error;
      }

      const response = await fetch(`${this.apiBaseUrl}/api/hot-update/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
        timeout: 15000
      });

      if (response.ok) {
        log.info('[HotUpdate] 上报结果成功');
      } else {
        log.warn(`[HotUpdate] 上报结果失败: ${response.status}`);
      }
    } catch (error) {
      log.error('[HotUpdate] 上报结果失败:', error);
    }
  }

  /**
   * 获取是否正在更新
   */
  isInProgress(): boolean {
    return this.isUpdating;
  }
}
