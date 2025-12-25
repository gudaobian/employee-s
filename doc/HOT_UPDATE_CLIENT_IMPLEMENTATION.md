# 客户端热更新完整实施方案

> **项目**: Employee Monitoring System - 客户端热更新实施
>
> **版本**: v1.0
>
> **日期**: 2025-12-17
>
> **关联文档**:
> - HOT_UPDATE_IMPLEMENTATION_GUIDE.md (后端方案)
> - HOT_UPDATE_API_DOCUMENTATION.md (API文档)
>
> **预计工期**: 2-3 工作日

---

## 📋 目录

- [1. 方案概述](#1-方案概述)
- [2. 文件结构](#2-文件结构)
- [3. 核心服务实现](#3-核心服务实现)
- [4. AutoUpdateService集成](#4-autoupdateservice集成)
- [5. 启动完整性检查](#5-启动完整性检查)
- [6. 配置管理](#6-配置管理)
- [7. 错误处理与降级](#7-错误处理与降级)
- [8. 事件系统](#8-事件系统)
- [9. 测试方案](#9-测试方案)
- [10. 实施步骤](#10-实施步骤)
- [11. 部署指南](#11-部署指南)
- [12. 监控与日志](#12-监控与日志)

---

## 1. 方案概述

### 1.1 目标

实现客户端热更新能力,使 **90% 的日常更新无需用户重新授权系统权限**。

### 1.2 核心原理

```yaml
ASAR热更新:
  原理: "macOS签名验证忽略 app.asar 文件"
  方法: "只替换ASAR内容,不修改应用签名"
  效果: "保持系统权限授权状态"

更新流程:
  1. 检查更新 → /api/hot-update/check
  2. 判断兼容性 → Electron版本 + Node版本 + 原生模块
  3. 下载差异包 → 小于10MB (vs 100MB+)
  4. 应用差异 → ASAR解包 → 应用变更 → 重新打包
  5. 验证 → SHA512校验
  6. 重启应用 → 保留权限
```

### 1.3 技术栈

```json
{
  "dependencies": {
    "@electron/asar": "^3.2.7",
    "tar": "^6.2.0",
    "node-fetch": "^2.7.0",
    "fs-extra": "^11.2.0"
  },
  "runtime": {
    "electron": "≥28.0.0",
    "node": "≥18.18.2"
  }
}
```

### 1.4 成功指标

| 指标 | 目标值 | 当前 |
|------|--------|------|
| 热更新成功率 | ≥ 95% | N/A |
| 更新时间 | ≤ 30秒 | 2-5分钟 |
| 包大小 | ≤ 10MB | 100MB+ |
| 降级率 | ≤ 10% | N/A |

---

## 2. 文件结构

### 2.1 新增文件清单

```
employee-client/
├── src/
│   └── common/
│       ├── services/
│       │   └── hot-update/
│       │       ├── HotUpdateService.ts         # ✅ 核心热更新服务
│       │       ├── DiffApplier.ts              # ✅ 差异应用器
│       │       ├── AsarManager.ts              # ✅ ASAR管理器
│       │       └── UpdateVerifier.ts           # ✅ 更新验证器
│       ├── interfaces/
│       │   └── IHotUpdate.ts                   # ✅ 热更新接口定义
│       └── types/
│           └── hot-update.types.ts             # ✅ 类型定义
│
├── test/
│   ├── unit/
│   │   └── hot-update/
│   │       ├── HotUpdateService.test.ts        # ✅ 单元测试
│   │       ├── DiffApplier.test.ts
│   │       └── AsarManager.test.ts
│   └── integration/
│       └── hot-update.integration.test.ts      # ✅ 集成测试
│
└── scripts/
    └── test-hot-update.js                      # ✅ 测试脚本
```

### 2.2 修改文件清单

```
employee-client/
├── src/
│   └── common/
│       ├── services/
│       │   └── AutoUpdateService.ts            # 🔧 集成热更新
│       └── config/
│           └── AppConfig.ts                    # 🔧 添加热更新配置
│
├── electron/
│   └── main.ts                                 # 🔧 添加启动检查
│
└── package.json                                # 🔧 添加依赖
```

---

## 3. 核心服务实现

### 3.1 类型定义

**文件**: `src/common/types/hot-update.types.ts`

```typescript
/**
 * 热更新清单
 */
export interface HotUpdateManifest {
  version: string;               // 目标版本号
  diffUrl: string;               // 差异包下载URL
  diffSha512: string;            // SHA512校验值
  diffSize: number;              // 差异包大小(字节)
  changedFilesCount: number;     // 修改文件数
  deletedFilesCount: number;     // 删除文件数
  releaseNotes?: string;         // 更新说明
  requiresRestart: boolean;      // 是否需要重启
  fallbackFullUrl?: string;      // 完整更新包URL(兜底)
}

/**
 * 差异包清单
 */
export interface DiffManifest {
  version: string;
  fromVersion: string;
  toVersion: string;
  changed: string[];             // 变更文件路径列表
  deleted: string[];             // 删除文件路径列表
  timestamp: string;
}

/**
 * 更新检查响应
 */
export interface CheckUpdateResponse {
  hasUpdate: boolean;
  updateType?: 'full' | 'hot';
  version?: string;
  manifest?: HotUpdateManifest;
  reason?: string;
}

/**
 * 上报请求
 */
export interface ReportUpdateRequest {
  deviceId: string;
  fromVersion: string;
  toVersion: string;
  platform: string;
  updateType: 'full' | 'hot' | 'hot_fallback';
  success: boolean;
  error?: string;
  fallbackReason?: string;
  downloadDuration?: number;
  installDuration?: number;
}

/**
 * 热更新事件
 */
export type HotUpdateEvent =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'download-progress'
  | 'verifying'
  | 'installing'
  | 'downloaded'
  | 'error';

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}
```

### 3.2 ASAR管理器

**文件**: `src/common/services/hot-update/AsarManager.ts`

```typescript
import * as path from 'path';
import * as fs from 'fs-extra';
import { app } from 'electron';
const asar = require('@electron/asar');

/**
 * ASAR文件管理器
 */
export class AsarManager {
  private readonly asarPath: string;
  private readonly backupPath: string;

  constructor() {
    if (!app.isPackaged) {
      throw new Error('AsarManager只能在打包环境下使用');
    }

    this.asarPath = path.join(process.resourcesPath, 'app.asar');
    this.backupPath = `${this.asarPath}.backup`;
  }

  /**
   * 获取ASAR路径
   */
  getAsarPath(): string {
    return this.asarPath;
  }

  /**
   * 获取备份路径
   */
  getBackupPath(): string {
    return this.backupPath;
  }

  /**
   * 创建备份
   */
  async createBackup(): Promise<void> {
    if (!fs.existsSync(this.asarPath)) {
      throw new Error('ASAR文件不存在');
    }

    await fs.copy(this.asarPath, this.backupPath, { overwrite: true });
  }

  /**
   * 从备份恢复
   */
  async restoreFromBackup(): Promise<void> {
    if (!fs.existsSync(this.backupPath)) {
      throw new Error('备份文件不存在');
    }

    await fs.copy(this.backupPath, this.asarPath, { overwrite: true });
  }

  /**
   * 删除备份
   */
  async removeBackup(): Promise<void> {
    if (fs.existsSync(this.backupPath)) {
      await fs.remove(this.backupPath);
    }
  }

  /**
   * 解包ASAR到临时目录
   */
  async extract(targetDir: string): Promise<void> {
    await fs.ensureDir(targetDir);
    await asar.extractAll(this.asarPath, targetDir);
  }

  /**
   * 打包目录为ASAR
   */
  async pack(sourceDir: string, targetPath?: string): Promise<void> {
    const target = targetPath || this.asarPath;
    await asar.createPackage(sourceDir, target);
  }

  /**
   * 验证ASAR完整性
   */
  async verify(): Promise<boolean> {
    try {
      // 尝试读取package.json
      const packageJson = asar.extractFile(this.asarPath, 'package.json');
      const parsed = JSON.parse(packageJson.toString());
      return !!parsed.name && !!parsed.version;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取ASAR中的版本号
   */
  async getVersion(): Promise<string | null> {
    try {
      const packageJson = asar.extractFile(this.asarPath, 'package.json');
      const parsed = JSON.parse(packageJson.toString());
      return parsed.version || null;
    } catch (error) {
      return null;
    }
  }
}
```

### 3.3 差异应用器

**文件**: `src/common/services/hot-update/DiffApplier.ts`

```typescript
import * as path from 'path';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import { DiffManifest } from '../../types/hot-update.types';
import { logger } from '../../utils/logger';

/**
 * 差异包应用器
 */
export class DiffApplier {
  /**
   * 解压差异包
   */
  async extractDiffPackage(diffPath: string, targetDir: string): Promise<void> {
    await fs.ensureDir(targetDir);
    await tar.extract({
      file: diffPath,
      cwd: targetDir
    });
  }

  /**
   * 读取差异清单
   */
  async readManifest(diffDir: string): Promise<DiffManifest> {
    const manifestPath = path.join(diffDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('差异清单文件不存在');
    }

    const content = await fs.readJson(manifestPath);
    return content as DiffManifest;
  }

  /**
   * 应用差异到ASAR解包目录
   */
  async applyDiff(
    asarExtractDir: string,
    diffDir: string,
    manifest: DiffManifest
  ): Promise<void> {
    logger.info('[DiffApplier] 开始应用差异');
    logger.info(`[DiffApplier] 变更文件: ${manifest.changed.length}, 删除文件: ${manifest.deleted.length}`);

    // 1. 删除文件
    for (const filePath of manifest.deleted) {
      const targetPath = path.join(asarExtractDir, filePath);
      if (fs.existsSync(targetPath)) {
        await fs.remove(targetPath);
        logger.debug(`[DiffApplier] 已删除: ${filePath}`);
      }
    }

    // 2. 添加/修改文件
    const filesDir = path.join(diffDir, 'files');
    for (const filePath of manifest.changed) {
      const sourcePath = path.join(filesDir, filePath);
      const targetPath = path.join(asarExtractDir, filePath);

      if (!fs.existsSync(sourcePath)) {
        logger.warn(`[DiffApplier] 源文件不存在,跳过: ${filePath}`);
        continue;
      }

      await fs.ensureDir(path.dirname(targetPath));
      await fs.copy(sourcePath, targetPath, { overwrite: true });
      logger.debug(`[DiffApplier] 已复制: ${filePath}`);
    }

    logger.info('[DiffApplier] 差异应用完成');
  }

  /**
   * 验证差异应用结果
   */
  async verify(asarExtractDir: string, manifest: DiffManifest): Promise<boolean> {
    try {
      // 验证删除的文件确实不存在
      for (const filePath of manifest.deleted) {
        const targetPath = path.join(asarExtractDir, filePath);
        if (fs.existsSync(targetPath)) {
          logger.error(`[DiffApplier] 验证失败: 文件应该被删除但仍存在: ${filePath}`);
          return false;
        }
      }

      // 验证修改的文件存在
      for (const filePath of manifest.changed) {
        const targetPath = path.join(asarExtractDir, filePath);
        if (!fs.existsSync(targetPath)) {
          logger.error(`[DiffApplier] 验证失败: 文件应该存在但不存在: ${filePath}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('[DiffApplier] 验证过程出错:', error);
      return false;
    }
  }
}
```

### 3.4 更新验证器

**文件**: `src/common/services/hot-update/UpdateVerifier.ts`

```typescript
import * as crypto from 'crypto';
import * as fs from 'fs';
import { logger } from '../../utils/logger';

/**
 * 更新验证器
 */
export class UpdateVerifier {
  /**
   * 计算文件SHA512
   */
  async calculateSHA512(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha512');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 验证文件完整性
   */
  async verify(filePath: string, expectedSha512: string): Promise<boolean> {
    try {
      const actualSha512 = await this.calculateSHA512(filePath);
      const isValid = actualSha512 === expectedSha512;

      if (!isValid) {
        logger.error('[UpdateVerifier] SHA512校验失败');
        logger.error(`[UpdateVerifier] 期望: ${expectedSha512}`);
        logger.error(`[UpdateVerifier] 实际: ${actualSha512}`);
      }

      return isValid;
    } catch (error) {
      logger.error('[UpdateVerifier] 校验过程出错:', error);
      return false;
    }
  }

  /**
   * 验证版本号格式
   */
  isValidVersion(version: string): boolean {
    // 语义化版本格式: x.y.z
    const semverRegex = /^\d+\.\d+\.\d+$/;
    return semverRegex.test(version);
  }

  /**
   * 比较版本号
   * @returns >0 if v1 > v2, 0 if equal, <0 if v1 < v2
   */
  compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;
      if (num1 !== num2) return num1 - num2;
    }

    return 0;
  }
}
```

### 3.5 核心热更新服务

**文件**: `src/common/services/hot-update/HotUpdateService.ts`

```typescript
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import fetch from 'node-fetch';
import { app } from 'electron';
import { logger } from '../../utils/logger';
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

/**
 * 热更新服务
 */
export class HotUpdateService extends EventEmitter {
  private asarManager: AsarManager;
  private diffApplier: DiffApplier;
  private verifier: UpdateVerifier;
  private configManager: AppConfigManager;
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

    const config = this.configManager.getConfig();
    this.apiBaseUrl = config.serverUrl || 'http://localhost:3000';
    this.tempDir = path.join(os.tmpdir(), 'employee-monitor-hot-update');
  }

  /**
   * 检查更新
   */
  async checkForUpdates(): Promise<CheckUpdateResponse | null> {
    try {
      this.emit('checking');
      logger.info('[HotUpdate] 开始检查更新');

      const currentVersion = app.getVersion();
      const platform = process.platform === 'darwin' ? 'darwin' : 'win32';
      const deviceId = this.configManager.getDeviceId();

      const url = `${this.apiBaseUrl}/api/hot-update/check?` +
        `currentVersion=${currentVersion}&` +
        `platform=${platform}&` +
        `deviceId=${deviceId}`;

      const response = await fetch(url, {
        method: 'GET',
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { success: boolean; data: CheckUpdateResponse };

      if (!result.success || !result.data.hasUpdate) {
        this.emit('not-available');
        return null;
      }

      logger.info(`[HotUpdate] 发现更新: ${result.data.version} (${result.data.updateType})`);
      this.emit('available', result.data);

      return result.data;
    } catch (error) {
      logger.error('[HotUpdate] 检查更新失败:', error);
      this.emit('error', error);
      return null;
    }
  }

  /**
   * 下载并应用热更新
   */
  async downloadAndApply(manifest: HotUpdateManifest): Promise<boolean> {
    if (this.isUpdating) {
      logger.warn('[HotUpdate] 更新已在进行中');
      return false;
    }

    this.isUpdating = true;
    const startTime = Date.now();
    let downloadDuration = 0;
    let installDuration = 0;

    try {
      logger.info(`[HotUpdate] 开始下载并应用更新: ${manifest.version}`);

      // 1. 下载差异包
      this.emit('downloading', { percent: 0, transferred: 0, total: manifest.diffSize });
      const diffPath = await this.downloadDiffPackage(manifest);
      downloadDuration = Date.now() - startTime;
      logger.info(`[HotUpdate] 下载完成,耗时: ${downloadDuration}ms`);

      // 2. 验证完整性
      this.emit('verifying');
      const isValid = await this.verifier.verify(diffPath, manifest.diffSha512);
      if (!isValid) {
        throw new Error('差异包SHA512校验失败');
      }
      logger.info('[HotUpdate] 校验通过');

      // 3. 备份当前ASAR
      await this.asarManager.createBackup();
      logger.info('[HotUpdate] 备份完成');

      // 4. 应用差异
      this.emit('installing');
      const installStartTime = Date.now();
      await this.applyDiffPackage(diffPath, manifest);
      installDuration = Date.now() - installStartTime;
      logger.info(`[HotUpdate] 安装完成,耗时: ${installDuration}ms`);

      // 5. 验证新版本
      const newVersion = await this.asarManager.getVersion();
      if (newVersion !== manifest.version) {
        throw new Error(`版本验证失败: 期望 ${manifest.version}, 实际 ${newVersion}`);
      }
      logger.info(`[HotUpdate] 版本验证通过: ${newVersion}`);

      // 6. 清理临时文件
      await this.cleanup();

      // 7. 上报成功
      await this.reportResult(manifest, true, null, downloadDuration, installDuration);

      this.emit('downloaded', { version: manifest.version });
      logger.info('[HotUpdate] 热更新成功完成');

      this.isUpdating = false;
      return true;

    } catch (error: any) {
      logger.error('[HotUpdate] 热更新失败:', error);

      // 回滚
      try {
        await this.rollback();
        logger.info('[HotUpdate] 回滚成功');
      } catch (rollbackError) {
        logger.error('[HotUpdate] 回滚失败:', rollbackError);
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
   */
  private async applyDiffPackage(diffPath: string, manifest: HotUpdateManifest): Promise<void> {
    const tempExtractDir = path.join(this.tempDir, 'asar-extract');
    const tempDiffDir = path.join(this.tempDir, 'diff-extract');

    try {
      // 1. 解包当前ASAR
      await this.asarManager.extract(tempExtractDir);

      // 2. 解压差异包
      await this.diffApplier.extractDiffPackage(diffPath, tempDiffDir);

      // 3. 读取差异清单
      const diffManifest = await this.diffApplier.readManifest(tempDiffDir);

      // 4. 应用差异
      await this.diffApplier.applyDiff(tempExtractDir, tempDiffDir, diffManifest);

      // 5. 验证差异应用
      const verifyResult = await this.diffApplier.verify(tempExtractDir, diffManifest);
      if (!verifyResult) {
        throw new Error('差异应用验证失败');
      }

      // 6. 重新打包ASAR (原子替换)
      const tempAsarPath = `${this.asarManager.getAsarPath()}.tmp`;
      await this.asarManager.pack(tempExtractDir, tempAsarPath);
      await fs.rename(tempAsarPath, this.asarManager.getAsarPath());

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
    logger.info('[HotUpdate] 开始回滚');
    await this.asarManager.restoreFromBackup();
  }

  /**
   * 清理临时文件
   */
  private async cleanup(): Promise<void> {
    try {
      await fs.remove(this.tempDir);
      await this.asarManager.removeBackup();
    } catch (error) {
      logger.warn('[HotUpdate] 清理临时文件失败:', error);
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
      const deviceId = this.configManager.getDeviceId();

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

      await fetch(`${this.apiBaseUrl}/api/hot-update/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
        timeout: 15000
      });

      logger.info('[HotUpdate] 上报结果成功');
    } catch (error) {
      logger.error('[HotUpdate] 上报结果失败:', error);
    }
  }
}
```

---

## 4. AutoUpdateService集成

**文件**: `src/common/services/AutoUpdateService.ts` (修改)

```typescript
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { HotUpdateService } from './hot-update/HotUpdateService';
import { CheckUpdateResponse } from '../types/hot-update.types';
import { AppConfigManager } from '../config/app-config-manager';

/**
 * 自动更新服务(支持热更新)
 */
export class AutoUpdateService extends EventEmitter {
  private hotUpdateService: HotUpdateService | null = null;
  private configManager: AppConfigManager;

  constructor() {
    super();
    this.configManager = AppConfigManager.getInstance();

    // 初始化热更新服务
    if (app.isPackaged) {
      try {
        const config = this.configManager.getConfig();
        if (config.hotUpdateEnabled !== false) {
          this.hotUpdateService = new HotUpdateService();
          this.setupHotUpdateListeners();
          logger.info('[AutoUpdate] 热更新服务已启用');
        }
      } catch (error) {
        logger.warn('[AutoUpdate] 热更新服务初始化失败:', error);
      }
    }

    this.setupAutoUpdaterListeners();
  }

  /**
   * 检查更新 (优先热更新)
   */
  async checkForUpdates(): Promise<void> {
    try {
      // 1. 优先尝试热更新
      if (this.hotUpdateService) {
        logger.info('[AutoUpdate] 尝试热更新');

        const updateInfo = await this.hotUpdateService.checkForUpdates();

        if (updateInfo?.hasUpdate && updateInfo.updateType === 'hot' && updateInfo.manifest) {
          // 发现热更新
          logger.info(`[AutoUpdate] 发现热更新: ${updateInfo.version}`);

          const success = await this.hotUpdateService.downloadAndApply(updateInfo.manifest);

          if (success) {
            // 热更新成功,提示用户重启
            this.promptUserToRestart(updateInfo.manifest.version);
            return;
          }

          // 热更新失败,继续完整更新
          logger.warn('[AutoUpdate] 热更新失败,降级到完整更新');
        }

        if (updateInfo?.updateType === 'full') {
          // 需要完整更新
          logger.info('[AutoUpdate] 需要完整更新:', updateInfo.reason);
        }
      }

      // 2. 完整更新流程 (原有逻辑)
      logger.info('[AutoUpdate] 执行完整更新检查');
      autoUpdater.checkForUpdates();

    } catch (error) {
      logger.error('[AutoUpdate] 检查更新失败:', error);
      this.emit('error', error);
    }
  }

  /**
   * 设置热更新事件监听
   */
  private setupHotUpdateListeners(): void {
    if (!this.hotUpdateService) return;

    this.hotUpdateService.on('checking', () => {
      this.sendStatusToRenderer({ type: 'checking-for-update' });
    });

    this.hotUpdateService.on('available', (updateInfo: CheckUpdateResponse) => {
      this.sendStatusToRenderer({
        type: 'update-available',
        data: {
          version: updateInfo.version,
          updateType: updateInfo.updateType
        }
      });
    });

    this.hotUpdateService.on('not-available', () => {
      this.sendStatusToRenderer({ type: 'update-not-available' });
    });

    this.hotUpdateService.on('download-progress', (progress) => {
      this.sendStatusToRenderer({
        type: 'download-progress',
        data: progress
      });
    });

    this.hotUpdateService.on('downloaded', (info) => {
      this.sendStatusToRenderer({
        type: 'update-downloaded',
        data: info
      });
    });

    this.hotUpdateService.on('error', (error) => {
      this.sendStatusToRenderer({
        type: 'error',
        data: { message: error.message }
      });
    });
  }

  /**
   * 设置autoUpdater事件监听
   */
  private setupAutoUpdaterListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      logger.info('[AutoUpdate] 检查完整更新');
      this.sendStatusToRenderer({ type: 'checking-for-update' });
    });

    autoUpdater.on('update-available', (info) => {
      logger.info('[AutoUpdate] 发现完整更新:', info.version);
      this.sendStatusToRenderer({
        type: 'update-available',
        data: { version: info.version, updateType: 'full' }
      });
    });

    autoUpdater.on('update-not-available', () => {
      logger.info('[AutoUpdate] 无可用更新');
      this.sendStatusToRenderer({ type: 'update-not-available' });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.sendStatusToRenderer({
        type: 'download-progress',
        data: progress
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.info('[AutoUpdate] 完整更新下载完成:', info.version);
      this.sendStatusToRenderer({
        type: 'update-downloaded',
        data: { version: info.version }
      });
    });

    autoUpdater.on('error', (error) => {
      logger.error('[AutoUpdate] 完整更新错误:', error);
      this.sendStatusToRenderer({
        type: 'error',
        data: { message: error.message }
      });
    });
  }

  /**
   * 发送状态到渲染进程
   */
  private sendStatusToRenderer(status: any): void {
    // 通过BrowserWindow发送到渲染进程
    const { BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('update-status', status);
    }
  }

  /**
   * 提示用户重启
   */
  private promptUserToRestart(version: string): void {
    const { dialog, BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];

    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '更新完成',
        message: `新版本 ${version} 已安装`,
        detail: '重启应用以使用新版本',
        buttons: ['立即重启', '稍后']
      }).then((result) => {
        if (result.response === 0) {
          app.relaunch();
          app.quit();
        }
      });
    }
  }

  /**
   * 立即安装更新
   */
  quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }
}
```

---

## 5. 启动完整性检查

**文件**: `electron/main.ts` (添加)

```typescript
import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
const asar = require('@electron/asar');

/**
 * 检查ASAR完整性
 */
function checkAsarIntegrity(): boolean {
  if (!app.isPackaged) {
    return true;
  }

  const asarPath = path.join(process.resourcesPath, 'app.asar');
  const backupPath = `${asarPath}.backup`;

  try {
    // 尝试读取package.json
    const packageJson = asar.extractFile(asarPath, 'package.json');
    const parsed = JSON.parse(packageJson.toString());

    // 验证必要字段
    if (!parsed.name || !parsed.version) {
      throw new Error('package.json缺少必要字段');
    }

    console.log(`[Startup] ASAR完整性检查通过,版本: ${parsed.version}`);
    return true;

  } catch (error) {
    console.error('[Startup] ASAR损坏:', error);

    // 尝试从备份恢复
    if (fs.existsSync(backupPath)) {
      try {
        console.log('[Startup] 尝试从备份恢复');
        fs.copyFileSync(backupPath, asarPath);
        console.log('[Startup] 恢复成功,准备重启');
        app.relaunch();
        app.exit(0);
        return false;
      } catch (restoreError) {
        console.error('[Startup] 恢复失败:', restoreError);
        return false;
      }
    }

    console.error('[Startup] 备份不存在,无法恢复');
    return false;
  }
}

// 在app.whenReady()之前检查
if (!checkAsarIntegrity()) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      '应用文件损坏',
      '检测到应用文件损坏且无法自动恢复,请重新安装应用。'
    );
    app.quit();
  });
} else {
  // 正常启动
  app.whenReady().then(createWindow);
}
```

---

## 6. 配置管理

**文件**: `src/common/config/AppConfig.ts` (扩展)

```typescript
export interface AppConfig {
  // ... 现有配置 ...

  // 热更新配置
  hotUpdateEnabled: boolean;          // 是否启用热更新
  hotUpdateFallbackTimeout: number;   // 热更新超时(ms)
  hotUpdateRetryCount: number;        // 热更新失败重试次数
}

export const DEFAULT_CONFIG: AppConfig = {
  // ... 现有默认值 ...

  // 热更新默认配置
  hotUpdateEnabled: true,
  hotUpdateFallbackTimeout: 120000,  // 2分钟
  hotUpdateRetryCount: 2
};
```

---

## 7. 错误处理与降级

### 7.1 错误分类

```typescript
export enum HotUpdateError {
  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  DOWNLOAD_TIMEOUT = 'DOWNLOAD_TIMEOUT',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',

  // 校验错误
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  INVALID_PACKAGE = 'INVALID_PACKAGE',

  // 应用错误
  ASAR_EXTRACT_FAILED = 'ASAR_EXTRACT_FAILED',
  DIFF_APPLY_FAILED = 'DIFF_APPLY_FAILED',
  ASAR_PACK_FAILED = 'ASAR_PACK_FAILED',

  // 验证错误
  VERSION_MISMATCH = 'VERSION_MISMATCH',
  INTEGRITY_CHECK_FAILED = 'INTEGRITY_CHECK_FAILED',

  // 系统错误
  INSUFFICIENT_SPACE = 'INSUFFICIENT_SPACE',
  PERMISSION_DENIED = 'PERMISSION_DENIED'
}
```

### 7.2 降级策略

```typescript
/**
 * 热更新失败降级处理
 */
async handleHotUpdateFailure(error: Error, manifest: HotUpdateManifest): Promise<void> {
  logger.error('[AutoUpdate] 热更新失败,准备降级:', error);

  // 上报失败
  await this.hotUpdateService?.reportResult(
    manifest,
    false,
    error.message
  );

  // 检查是否有完整更新URL
  if (manifest.fallbackFullUrl) {
    logger.info('[AutoUpdate] 使用完整更新包降级');

    // 使用传统更新流程
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: manifest.fallbackFullUrl
    });
    autoUpdater.checkForUpdates();
  } else {
    // 通知用户手动更新
    logger.warn('[AutoUpdate] 无完整更新包,需要手动更新');
    this.notifyManualUpdate(manifest.version);
  }
}
```

---

## 8. 事件系统

### 8.1 渲染进程监听

**文件**: `electron/renderer/update-listener.ts`

```typescript
import { ipcRenderer } from 'electron';

/**
 * 更新状态监听器
 */
export class UpdateListener {
  private callbacks: Map<string, Function[]> = new Map();

  constructor() {
    this.setupIpcListener();
  }

  /**
   * 监听更新事件
   */
  on(event: string, callback: Function): void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);
  }

  /**
   * 设置IPC监听
   */
  private setupIpcListener(): void {
    ipcRenderer.on('update-status', (_, status) => {
      const { type, data } = status;

      // 触发回调
      const callbacks = this.callbacks.get(type) || [];
      callbacks.forEach(cb => cb(data));

      // 全局回调
      const globalCallbacks = this.callbacks.get('*') || [];
      globalCallbacks.forEach(cb => cb(type, data));
    });
  }

  /**
   * 请求检查更新
   */
  checkForUpdates(): void {
    ipcRenderer.send('check-for-updates');
  }

  /**
   * 立即安装更新
   */
  installUpdate(): void {
    ipcRenderer.send('install-update');
  }
}

// 使用示例
const updateListener = new UpdateListener();

updateListener.on('checking-for-update', () => {
  console.log('正在检查更新...');
});

updateListener.on('update-available', (data) => {
  console.log(`发现更新: ${data.version} (${data.updateType})`);
});

updateListener.on('download-progress', (progress) => {
  console.log(`下载进度: ${progress.percent}%`);
});

updateListener.on('update-downloaded', (data) => {
  console.log(`更新下载完成: ${data.version}`);
});

updateListener.on('error', (data) => {
  console.error('更新错误:', data.message);
});
```

---

## 9. 测试方案

### 9.1 单元测试

**文件**: `test/unit/hot-update/HotUpdateService.test.ts`

```typescript
import { HotUpdateService } from '../../../src/common/services/hot-update/HotUpdateService';
import { AsarManager } from '../../../src/common/services/hot-update/AsarManager';
import * as fs from 'fs-extra';
import * as path from 'path';

jest.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.0.132',
    getPath: (name: string) => `/tmp/test-${name}`
  }
}));

describe('HotUpdateService', () => {
  let service: HotUpdateService;

  beforeEach(() => {
    service = new HotUpdateService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('应该成功检查更新', async () => {
    // Mock fetch响应
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          hasUpdate: true,
          updateType: 'hot',
          version: '1.0.133',
          manifest: {
            version: '1.0.133',
            diffUrl: 'https://test.com/diff.tar.gz',
            diffSha512: 'abc123',
            diffSize: 8388608,
            changedFilesCount: 10,
            deletedFilesCount: 2,
            requiresRestart: true
          }
        }
      })
    });

    const result = await service.checkForUpdates();
    expect(result).not.toBeNull();
    expect(result?.updateType).toBe('hot');
    expect(result?.version).toBe('1.0.133');
  });

  test('应该在无更新时返回null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { hasUpdate: false }
      })
    });

    const result = await service.checkForUpdates();
    expect(result).toBeNull();
  });

  test('应该在网络错误时触发error事件', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const errorCallback = jest.fn();
    service.on('error', errorCallback);

    const result = await service.checkForUpdates();
    expect(result).toBeNull();
    expect(errorCallback).toHaveBeenCalled();
  });
});
```

### 9.2 集成测试

**文件**: `test/integration/hot-update.integration.test.ts`

```typescript
import { HotUpdateService } from '../../src/common/services/hot-update/HotUpdateService';
import { AsarManager } from '../../src/common/services/hot-update/AsarManager';
import { DiffApplier } from '../../src/common/services/hot-update/DiffApplier';
import * as fs from 'fs-extra';
import * as path from 'path';

describe('Hot Update Integration Tests', () => {
  const testDir = path.join(__dirname, 'test-data');
  const oldAsarPath = path.join(testDir, 'old-app.asar');
  const newAsarPath = path.join(testDir, 'new-app.asar');
  const diffPath = path.join(testDir, 'diff.tar.gz');

  beforeAll(async () => {
    // 准备测试数据
    await fs.ensureDir(testDir);
    // 创建模拟的ASAR文件和差异包
  });

  afterAll(async () => {
    await fs.remove(testDir);
  });

  test('完整热更新流程 - 从下载到应用', async () => {
    const service = new HotUpdateService();

    // 监听事件
    const events: string[] = [];
    service.on('checking', () => events.push('checking'));
    service.on('available', () => events.push('available'));
    service.on('downloading', () => events.push('downloading'));
    service.on('verifying', () => events.push('verifying'));
    service.on('installing', () => events.push('installing'));
    service.on('downloaded', () => events.push('downloaded'));

    // 执行更新
    const manifest = {
      version: '1.0.133',
      diffUrl: 'file://' + diffPath,
      diffSha512: 'expected-sha512',
      diffSize: 1024,
      changedFilesCount: 5,
      deletedFilesCount: 1,
      requiresRestart: true
    };

    const result = await service.downloadAndApply(manifest);

    // 验证
    expect(result).toBe(true);
    expect(events).toContain('downloading');
    expect(events).toContain('installing');
    expect(events).toContain('downloaded');
  });

  test('应该在校验失败时回滚', async () => {
    // 测试回滚逻辑
  });

  test('应该正确处理网络中断', async () => {
    // 测试网络错误处理
  });
});
```

---

## 10. 实施步骤

### Day 1: 基础设施搭建 (8小时)

**上午 (4h)**:
```bash
cd employee-client

# 1. 安装依赖
npm install @electron/asar tar node-fetch fs-extra

# 2. 创建目录结构
mkdir -p src/common/services/hot-update
mkdir -p src/common/types
mkdir -p test/unit/hot-update
mkdir -p test/integration

# 3. 创建类型定义
touch src/common/types/hot-update.types.ts
# 编写接口定义

# 4. 创建辅助类
touch src/common/services/hot-update/AsarManager.ts
touch src/common/services/hot-update/DiffApplier.ts
touch src/common/services/hot-update/UpdateVerifier.ts
```

**下午 (4h)**:
```bash
# 1. 实现辅助类
# 实现 AsarManager、DiffApplier、UpdateVerifier

# 2. 编写单元测试
npm test -- AsarManager
npm test -- DiffApplier
npm test -- UpdateVerifier

# 3. 测试ASAR操作
node -e "
const AsarManager = require('./dist/common/services/hot-update/AsarManager').AsarManager;
const manager = new AsarManager();
console.log('ASAR Path:', manager.getAsarPath());
"
```

**验收标准**:
- ✅ 依赖安装成功
- ✅ 辅助类单元测试通过
- ✅ ASAR读写操作正常

---

### Day 2: 核心服务实现 (8小时)

**上午 (4h)**:
```bash
# 1. 实现HotUpdateService核心方法
touch src/common/services/hot-update/HotUpdateService.ts

# 实现方法:
# - checkForUpdates()
# - downloadDiffPackage()
# - verifyPackage()
```

**下午 (4h)**:
```bash
# 1. 实现差异应用逻辑
# - applyDiffPackage()
# - rollback()
# - cleanup()

# 2. 实现上报逻辑
# - reportResult()

# 3. 单元测试
npm test -- HotUpdateService
```

**验收标准**:
- ✅ API调用成功
- ✅ 差异包下载成功
- ✅ SHA512校验通过
- ✅ 上报请求成功

---

### Day 3: 集成与测试 (8小时)

**上午 (4h)**:
```bash
# 1. 集成到AutoUpdateService
# 修改 src/common/services/AutoUpdateService.ts

# 2. 添加启动检查
# 修改 electron/main.ts

# 3. 扩展配置
# 修改 src/common/config/AppConfig.ts
```

**下午 (4h)**:
```bash
# 1. 端到端测试
npm run dev

# 手动测试流程:
# - 检查更新
# - 下载差异包
# - 应用差异
# - 重启验证

# 2. 集成测试
npm test -- integration/hot-update

# 3. 构建测试
npm run build
npm run pack:mac
```

**验收标准**:
- ✅ 热更新完整流程成功
- ✅ 重启后版本正确
- ✅ 系统权限保持
- ✅ 降级逻辑正常

---

## 11. 部署指南

### 11.1 package.json配置

```json
{
  "name": "employee-monitor",
  "version": "1.0.132",
  "dependencies": {
    "@electron/asar": "^3.2.7",
    "tar": "^6.2.0",
    "node-fetch": "^2.7.0",
    "fs-extra": "^11.2.0"
  },
  "build": {
    "appId": "com.employee.monitor",
    "asar": true,
    "asarUnpack": [
      "node_modules/native-event-monitor/**/*",
      "native/**/*"
    ],
    "mac": {
      "hardenedRuntime": true,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    }
  }
}
```

### 11.2 打包流程

```bash
# 1. 版本号递增
npm version patch  # 1.0.132 → 1.0.133

# 2. 构建
npm run build

# 3. 打包(macOS)
npm run pack:mac

# 4. 验证ASAR
node -e "
const asar = require('@electron/asar');
const pkg = JSON.parse(
  asar.extractFile('dist/mac/Employee Monitor.app/Contents/Resources/app.asar', 'package.json')
);
console.log('Version:', pkg.version);
"

# 5. 上传到服务器
# 服务器会自动提取ASAR并生成差异包
```

### 11.3 灰度发布策略

```yaml
阶段1: IT部门测试 (1-2天)
  范围: 5-10人
  监控: 热更新成功率、错误日志

阶段2: 测试部门 (2-3天)
  范围: 20-30人
  监控: 兼容性、回滚率

阶段3: 20%用户 (3-5天)
  范围: 全公司20%
  监控: 性能指标、用户反馈

阶段4: 50%用户 (3-5天)
  范围: 全公司50%
  监控: 统计分析

阶段5: 100%全量 (稳定后)
  范围: 全部用户
```

---

## 12. 监控与日志

### 12.1 日志记录

```typescript
// 关键日志点
logger.info('[HotUpdate] 开始检查更新');
logger.info(`[HotUpdate] 发现更新: ${version} (${updateType})`);
logger.info('[HotUpdate] 下载完成,耗时: ${duration}ms');
logger.info('[HotUpdate] 校验通过');
logger.info('[HotUpdate] 备份完成');
logger.info(`[HotUpdate] 安装完成,耗时: ${duration}ms`);
logger.info(`[HotUpdate] 版本验证通过: ${newVersion}`);
logger.error('[HotUpdate] 热更新失败:', error);
logger.info('[HotUpdate] 回滚成功');
```

### 12.2 性能监控

```typescript
/**
 * 性能指标收集
 */
export class HotUpdateMetrics {
  private startTime: number = 0;
  private downloadStartTime: number = 0;
  private installStartTime: number = 0;

  startUpdate(): void {
    this.startTime = Date.now();
  }

  startDownload(): void {
    this.downloadStartTime = Date.now();
  }

  endDownload(): number {
    return Date.now() - this.downloadStartTime;
  }

  startInstall(): void {
    this.installStartTime = Date.now();
  }

  endInstall(): number {
    return Date.now() - this.installStartTime;
  }

  getTotalDuration(): number {
    return Date.now() - this.startTime;
  }
}
```

### 12.3 本地日志查看

```bash
# macOS
tail -f ~/Library/Logs/employee-monitor/hot-update.log

# 查看最近热更新记录
grep "HotUpdate" ~/Library/Logs/employee-monitor/main.log | tail -20

# 查看错误
grep "ERROR.*HotUpdate" ~/Library/Logs/employee-monitor/main.log
```

---

## 13. 故障排查

### 13.1 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| ASAR损坏无法启动 | 差异应用失败 | 启动检查自动从backup恢复 |
| 校验失败 | 网络传输损坏 | 自动重试3次,失败后降级 |
| 下载超时 | 网络不稳定 | 增加超时时间,启用多区域 |
| 版本不匹配 | 差异应用错误 | 回滚+上报错误 |
| 权限问题 | 临时目录无权限 | 检查tmp目录权限 |

### 13.2 诊断命令

```bash
# 检查ASAR完整性
node -e "
const asar = require('@electron/asar');
const path = '/Applications/Employee Monitor.app/Contents/Resources/app.asar';
try {
  const pkg = asar.extractFile(path, 'package.json');
  console.log('Version:', JSON.parse(pkg).version);
} catch (e) {
  console.error('ASAR损坏:', e.message);
}
"

# 检查备份
ls -lh "/Applications/Employee Monitor.app/Contents/Resources/app.asar.backup"

# 模拟热更新流程
npm run test:hot-update -- --verbose
```

---

## 14. 附录

### 14.1 依赖清单

```json
{
  "dependencies": {
    "@electron/asar": "^3.2.7",
    "tar": "^6.2.0",
    "node-fetch": "^2.7.0",
    "fs-extra": "^11.2.0"
  },
  "devDependencies": {
    "@types/tar": "^6.1.5",
    "@types/node-fetch": "^2.6.4",
    "@types/fs-extra": "^11.0.1"
  }
}
```

### 14.2 相关文档

- 📖 [Electron ASAR文档](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- 📖 [electron-updater文档](https://github.com/electron-userland/electron-builder)
- 📖 [后端实施指南](./HOT_UPDATE_IMPLEMENTATION_GUIDE.md)
- 📖 [API文档](./HOT_UPDATE_API_DOCUMENTATION.md)

### 14.3 下一步行动

**立即开始**:
```bash
# 1. 创建功能分支
git checkout -b feature/hot-update-client

# 2. 安装依赖
cd employee-client
npm install @electron/asar tar node-fetch fs-extra

# 3. 从Day 1开始执行
mkdir -p src/common/services/hot-update
```

**需要决策**:
- [ ] 是否实施热更新客户端?
- [ ] 优先支持哪个平台? (macOS / Windows)
- [ ] 灰度发布策略?

---

**文档版本**: v1.0
**最后更新**: 2025-12-17
**维护者**: Client Team
