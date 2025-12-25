# 热更新完整实施指南

> **项目**: Employee Monitoring System - 客户端热更新方案
>
> **版本**: v1.0
>
> **日期**: 2025-12-17
>
> **预计工期**: 3-5 工作日

---

## 📋 目录

- [1. 方案概述](#1-方案概述)
- [2. 现状分析](#2-现状分析)
- [3. 后端实施方案](#3-后端实施方案)
- [4. 客户端实施方案](#4-客户端实施方案)
- [5. 实施步骤](#5-实施步骤)
- [6. 测试验证](#6-测试验证)
- [7. 风险评估](#7-风险评估)
- [8. 监控指标](#8-监控指标)
- [9. 实施建议](#9-实施建议)

---

## 1. 方案概述

### 1.1 目标

实现应用热更新，使 **90%的日常更新无需用户重新授权系统权限**（屏幕录制、辅助功能等）。

### 1.2 核心原理

- macOS签名验证忽略 `app.asar` 文件
- 只替换ASAR内容，不修改应用签名
- 保持系统权限授权状态

### 1.3 更新策略

```yaml
检测流程:
  1. 客户端请求更新检查
  2. 服务端判断是否支持热更新
  3. 如支持 → 返回差异包
  4. 如不支持 → 返回完整安装包

热更新条件:
  - ✅ Electron版本未变化
  - ✅ Node.js版本未变化
  - ✅ 原生模块未变化
  - ✅ 仅业务代码更新

降级到完整更新:
  - ❌ Electron版本升级
  - ❌ 原生模块变化
  - ❌ 热更新失败
```

### 1.4 成功指标

| 指标 | 目标值 | 现状 |
|------|--------|------|
| 热更新成功率 | ≥ 95% | N/A |
| 更新包大小 | ≤ 10MB | 100MB+ |
| 更新时间 | ≤ 30秒 | 2-5分钟 |
| 重新授权率 | ≤ 10% | 100% |

---

## 2. 现状分析

### 2.1 当前系统优势

✅ **灰度发布体系成熟**:
- 部门树递归查询，子部门自动继承
- 定向用户推送（管理员/测试人员优先）
- 分阶段发布 (`StagedRolloutService`)

✅ **多区域存储完善**:
- 中国/海外双区域并行上传
- 自动重试（指数退避）+ 跨区域容错
- SHA512 完整性校验

✅ **版本管理完整**:
- 异步上传队列 (Bull Queue)
- 版本发布/归档/删除
- 统计分析（成功率、错误类型、下载速度）

### 2.2 缺失功能

❌ **后端缺失**:
1. 数据库表: `client_version_metadata`, `diff_packages`
2. ASAR提取: 发布时未从安装包提取 `app.asar`
3. 版本元数据收集: 未记录 Electron/Node 版本、原生模块哈希
4. 差异包生成服务: 无 ASAR 解包/对比/打包逻辑
5. 热更新API: 无 `/api/hot-update/check` 和 `/report` 接口

❌ **客户端缺失**:
1. 客户端热更新服务: 下载差异包、应用到 ASAR
2. AutoUpdateService 集成: 未优先尝试热更新
3. 启动完整性检查: 未检测 ASAR 损坏和自动恢复
4. 回滚机制: 热更新失败时的自动回滚

### 2.3 更新流程对比

**当前完整更新流程**:
```
客户端 → checkForUpdates
  ↓
判断灰度条件 → 通过
  ↓
返回完整安装包 URL (100MB+)
  ↓
下载 → 安装 → 重启
  ↓
❌ 需要重新授权系统权限
```

**热更新方案流程**:
```
客户端 → /api/hot-update/check
  ↓
判断兼容性 (Electron版本、原生模块)
  ├── ✅ 兼容 → 返回差异包 (<10MB)
  │     ↓
  │   下载差异包 → 应用到 ASAR → 重启
  │     ↓
  │   ✅ 保留系统权限
  │
  └── ❌ 不兼容 → 返回完整包 → 传统更新流程
```

---

## 3. 后端实施方案

### 3.1 数据库设计

**文件**: `src/database/migrations/005_add_hot_update_tables.sql`

```sql
-- ============================================
-- 客户端版本元数据表（用于兼容性判断）
-- ============================================
CREATE TABLE IF NOT EXISTS client_version_metadata (
  id SERIAL PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('darwin', 'win32')),

  -- 运行时版本信息
  electron_version VARCHAR(20) NOT NULL,
  node_version VARCHAR(20) NOT NULL,
  chrome_version VARCHAR(20) NOT NULL,

  -- 原生模块指纹（用于判断是否可热更新）
  native_modules_hash VARCHAR(64) NOT NULL, -- SHA256
  native_modules JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ASAR文件信息
  asar_size BIGINT,
  asar_sha512 VARCHAR(128),

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(version, platform)
);

CREATE INDEX idx_version_metadata_platform ON client_version_metadata(platform, version);
CREATE INDEX idx_version_metadata_electron ON client_version_metadata(electron_version, node_version);

COMMENT ON TABLE client_version_metadata IS '客户端版本元数据，用于热更新兼容性判断';

-- ============================================
-- 差异包记录表
-- ============================================
CREATE TABLE IF NOT EXISTS diff_packages (
  id SERIAL PRIMARY KEY,
  from_version VARCHAR(20) NOT NULL,
  to_version VARCHAR(20) NOT NULL,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('darwin', 'win32')),

  -- 差异包文件信息
  diff_url_cn TEXT,
  diff_url_en TEXT,
  diff_sha512 VARCHAR(128) NOT NULL,
  diff_size BIGINT NOT NULL,

  -- 差异内容
  changed_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  deleted_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_files_count INT DEFAULT 0,
  deleted_files_count INT DEFAULT 0,

  -- 统计信息
  generated_at TIMESTAMP DEFAULT NOW(),
  download_count INT DEFAULT 0,
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,

  -- 状态
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'failed')),

  UNIQUE(from_version, to_version, platform)
);

CREATE INDEX idx_diff_packages_lookup ON diff_packages(from_version, to_version, platform);
CREATE INDEX idx_diff_packages_status ON diff_packages(status, generated_at DESC);

-- ============================================
-- 扩展现有 update_logs 表
-- ============================================
ALTER TABLE update_logs ADD COLUMN IF NOT EXISTS update_type VARCHAR(20) DEFAULT 'full'
  CHECK (update_type IN ('full', 'hot', 'hot_fallback'));
ALTER TABLE update_logs ADD COLUMN IF NOT EXISTS diff_package_id INT REFERENCES diff_packages(id);
ALTER TABLE update_logs ADD COLUMN IF NOT EXISTS hot_update_error TEXT;
ALTER TABLE update_logs ADD COLUMN IF NOT EXISTS fallback_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_update_logs_type ON update_logs(update_type, status);
```

### 3.2 TypeScript Model

**文件**: `src/models/ClientVersionMetadata.ts`

```typescript
import { Model, DataTypes } from 'sequelize';
import sequelize from '../database/sequelize';

export interface NativeModule {
  name: string;
  version: string;
  abi: number;
  path?: string;
}

export interface VersionMetadataAttributes {
  id?: number;
  version: string;
  platform: 'darwin' | 'win32';
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  nativeModulesHash: string;
  nativeModules: NativeModule[];
  asarSize?: number;
  asarSha512?: string;
  createdAt?: Date;
}

export class ClientVersionMetadata extends Model<VersionMetadataAttributes> {
  declare id: number;
  declare version: string;
  declare platform: 'darwin' | 'win32';
  declare electronVersion: string;
  declare nodeVersion: string;
  declare chromeVersion: string;
  declare nativeModulesHash: string;
  declare nativeModules: NativeModule[];
  declare asarSize: number | null;
  declare asarSha512: string | null;
  declare createdAt: Date;

  /**
   * 检查两个版本是否兼容热更新
   */
  static async areCompatible(
    fromVersion: string,
    toVersion: string,
    platform: string
  ): Promise<{ compatible: boolean; reason?: string }> {
    const fromMeta = await this.findOne({ where: { version: fromVersion, platform } });
    const toMeta = await this.findOne({ where: { version: toVersion, platform } });

    if (!fromMeta) return { compatible: false, reason: `源版本元数据不存在: ${fromVersion}` };
    if (!toMeta) return { compatible: false, reason: `目标版本元数据不存在: ${toVersion}` };

    if (fromMeta.electronVersion !== toMeta.electronVersion) {
      return { compatible: false, reason: `Electron版本不同: ${fromMeta.electronVersion} → ${toMeta.electronVersion}` };
    }

    if (fromMeta.nodeVersion !== toMeta.nodeVersion) {
      return { compatible: false, reason: `Node版本不同: ${fromMeta.nodeVersion} → ${toMeta.nodeVersion}` };
    }

    if (fromMeta.nativeModulesHash !== toMeta.nativeModulesHash) {
      return { compatible: false, reason: '原生模块已变更' };
    }

    return { compatible: true };
  }
}

ClientVersionMetadata.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    version: { type: DataTypes.STRING(20), allowNull: false },
    platform: { type: DataTypes.STRING(10), allowNull: false },
    electronVersion: { type: DataTypes.STRING(20), allowNull: false, field: 'electron_version' },
    nodeVersion: { type: DataTypes.STRING(20), allowNull: false, field: 'node_version' },
    chromeVersion: { type: DataTypes.STRING(20), allowNull: false, field: 'chrome_version' },
    nativeModulesHash: { type: DataTypes.STRING(64), allowNull: false, field: 'native_modules_hash' },
    nativeModules: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'native_modules' },
    asarSize: { type: DataTypes.BIGINT, allowNull: true, field: 'asar_size' },
    asarSha512: { type: DataTypes.STRING(128), allowNull: true, field: 'asar_sha512' },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' }
  },
  { sequelize, tableName: 'client_version_metadata', timestamps: false }
);
```

**文件**: `src/models/DiffPackage.ts`

```typescript
import { Model, DataTypes } from 'sequelize';
import sequelize from '../database/sequelize';

export class DiffPackage extends Model {
  declare id: number;
  declare fromVersion: string;
  declare toVersion: string;
  declare platform: 'darwin' | 'win32';
  declare diffUrlCn: string | null;
  declare diffUrlEn: string | null;
  declare diffSha512: string;
  declare diffSize: number;
  declare changedFiles: string[];
  declare deletedFiles: string[];
  declare downloadCount: number;
  declare successCount: number;
  declare failureCount: number;

  static async findDiff(fromVersion: string, toVersion: string, platform: string) {
    return this.findOne({ where: { fromVersion, toVersion, platform, status: 'active' } });
  }

  async recordDownload() { await this.increment('downloadCount'); }
  async recordSuccess() { await this.increment('successCount'); }
  async recordFailure() { await this.increment('failureCount'); }
}

DiffPackage.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    fromVersion: { type: DataTypes.STRING(20), allowNull: false, field: 'from_version' },
    toVersion: { type: DataTypes.STRING(20), allowNull: false, field: 'to_version' },
    platform: { type: DataTypes.STRING(10), allowNull: false },
    diffUrlCn: { type: DataTypes.TEXT, allowNull: true, field: 'diff_url_cn' },
    diffUrlEn: { type: DataTypes.TEXT, allowNull: true, field: 'diff_url_en' },
    diffSha512: { type: DataTypes.STRING(128), allowNull: false, field: 'diff_sha512' },
    diffSize: { type: DataTypes.BIGINT, allowNull: false, field: 'diff_size' },
    changedFiles: { type: DataTypes.JSONB, defaultValue: [], field: 'changed_files' },
    deletedFiles: { type: DataTypes.JSONB, defaultValue: [], field: 'deleted_files' },
    changedFilesCount: { type: DataTypes.INTEGER, defaultValue: 0, field: 'changed_files_count' },
    deletedFilesCount: { type: DataTypes.INTEGER, defaultValue: 0, field: 'deleted_files_count' },
    downloadCount: { type: DataTypes.INTEGER, defaultValue: 0, field: 'download_count' },
    successCount: { type: DataTypes.INTEGER, defaultValue: 0, field: 'success_count' },
    failureCount: { type: DataTypes.INTEGER, defaultValue: 0, field: 'failure_count' },
    status: { type: DataTypes.STRING(20), defaultValue: 'active' }
  },
  { sequelize, tableName: 'diff_packages', timestamps: false }
);
```

### 3.3 核心服务: HotUpdateService

**文件**: `src/services/HotUpdateService.ts`

核心功能:
1. ✅ **extractAsarFromPackage()** - 从完整安装包提取ASAR
2. ✅ **collectVersionMetadata()** - 收集Electron版本、原生模块哈希
3. ✅ **generateDiffPackage()** - 生成ASAR差异包
4. ✅ **compareDirectories()** - 对比文件差异
5. ✅ **createDiffPackage()** - 打包差异文件为tar.gz
6. ✅ **uploadDiffPackage()** - 上传到多区域OSS

**关键方法实现**:

```typescript
export class HotUpdateService {
  private readonly asarStorageDir: string;
  private readonly diffsDir: string;

  constructor() {
    const storageRoot = path.join(__dirname, '../../storage');
    this.asarStorageDir = path.join(storageRoot, 'client-asars');
    this.diffsDir = path.join(storageRoot, 'client-diffs');
  }

  /**
   * 生成差异包核心流程
   */
  async generateDiffPackage(fromVersion: string, toVersion: string, platform: string) {
    // 1. 检查兼容性
    const compatibility = await ClientVersionMetadata.areCompatible(fromVersion, toVersion, platform);
    if (!compatibility.compatible) throw new Error(compatibility.reason);

    // 2. 解包两个版本的ASAR
    const oldExtractDir = /* 临时目录 */;
    const newExtractDir = /* 临时目录 */;
    asar.extractAll(oldAsarPath, oldExtractDir);
    asar.extractAll(newAsarPath, newExtractDir);

    // 3. 对比文件差异
    const manifest = await this.compareDirectories(oldExtractDir, newExtractDir, ...);

    // 4. 打包差异文件
    const diffPath = await this.createDiffPackage(manifest, newExtractDir, platform);

    // 5. 计算SHA512
    const sha512 = await this.calculateSHA512(diffPath);

    return { diffPath, manifest, size, sha512 };
  }
}
```

**完整实现**: 参考 `HOT_UPDATE_IMPLEMENTATION_PLAN.md` 第406-717行

### 3.4 API Controller

**文件**: `src/controllers/HotUpdateController.ts`

**API接口**:

#### `GET /api/hot-update/check`

检查热更新可用性。

**Query参数**:
```typescript
{
  version: string,    // 当前版本号
  platform: string,   // darwin | win32
  deviceId: string    // 设备ID
}
```

**Response**:
```typescript
{
  success: true,
  data: {
    updateAvailable: true,
    hotUpdateAvailable: true,  // 是否支持热更新
    manifest: {
      version: "1.0.133",
      diffUrl: "https://...",
      diffSha512: "...",
      diffSize: 8388608,       // 8MB
      changedFilesCount: 45,
      deletedFilesCount: 3,
      fallbackFullUrl: "...",  // 兜底完整更新
      releaseNotes: "...",
      requiresRestart: true
    }
  }
}
```

#### `POST /api/hot-update/report`

客户端上报热更新结果。

**Body**:
```typescript
{
  deviceId: string,
  fromVersion: string,
  toVersion: string,
  platform: string,
  diffPackageId: number,
  success: boolean,
  errorMessage?: string,
  duration?: number
}
```

**核心逻辑**:

```typescript
static async checkUpdate(req: Request, res: Response) {
  // 1. 查询最新版本
  const latestVersion = await ClientVersionModel.findLatestPublished(platform);

  // 2. 版本比较
  if (versionCompare <= 0) return { updateAvailable: false };

  // 3. 检查灰度发布
  const eligible = await RolloutService.checkRolloutEligibility(latestVersion.id, deviceId);
  if (!eligible) return { updateAvailable: false };

  // 4. 检查兼容性
  const compatibility = await ClientVersionMetadata.areCompatible(fromVersion, toVersion, platform);

  // 不兼容 → 返回完整更新
  if (!compatibility.compatible) {
    return { fullUpdateRequired: true, incompatibilityReason: ... };
  }

  // 5. 查找或生成差异包
  let diffPackage = await DiffPackage.findDiff(fromVersion, toVersion, platform);
  if (!diffPackage) {
    const hotUpdateService = new HotUpdateService();
    const diffResult = await hotUpdateService.generateDiffPackage(...);
    // 上传到OSS + 创建数据库记录
  }

  // 6. 返回热更新清单
  return { hotUpdateAvailable: true, manifest: { ... } };
}
```

### 3.5 路由注册

**文件**: `src/routes/hotUpdate.ts`

```typescript
import { Router } from 'express';
import { HotUpdateController } from '../controllers/HotUpdateController';

const router = Router();

router.get('/check', HotUpdateController.checkUpdate);
router.post('/report', HotUpdateController.reportResult);

export default router;
```

**修改**: `src/index.ts`

```typescript
import hotUpdateRoutes from './routes/hotUpdate';

app.use('/api/hot-update', hotUpdateRoutes);
```

### 3.6 集成到版本上传流程

**修改**: `src/controllers/ClientVersionController.ts`

在异步上传队列处理完成后添加:

```typescript
// 在 clientVersionUploadQueue 的 process handler 中
import { HotUpdateService } from '../services/HotUpdateService';
import { ClientVersionMetadata } from '../models/ClientVersionMetadata';

// ... 上传到OSS完成后 ...

try {
  const hotUpdateService = new HotUpdateService();

  // 1. 提取ASAR
  const asarPath = await hotUpdateService.extractAsarFromPackage(
    localFilePath,
    version,
    platform as 'darwin' | 'win32'
  );

  // 2. 收集元数据
  const metadata = await hotUpdateService.collectVersionMetadata(asarPath, version, platform);

  // 3. 保存到数据库
  await ClientVersionMetadata.create(metadata);

  logger.info(`[Upload] 版本元数据已保存: ${version}`);
} catch (error) {
  logger.error(`[Upload] ASAR提取失败:`, error);
  // 不阻塞上传流程
}
```

---

## 4. 客户端实施方案

### 4.1 热更新服务

**文件**: `employee-client/src/common/services/HotUpdateService.ts`

**核心功能**:
1. ✅ **checkForUpdates()** - 检查热更新可用性
2. ✅ **downloadAndApply()** - 下载并应用差异包
3. ✅ **downloadDiffPackage()** - 下载差异包（含进度通知）
4. ✅ **verifyPackage()** - SHA512完整性校验
5. ✅ **createBackup()** - 备份当前ASAR
6. ✅ **applyDiffPackage()** - 应用差异到ASAR
7. ✅ **rollback()** - 失败时回滚

**事件系统**:
```typescript
export class HotUpdateService extends EventEmitter {
  // 事件: checking, available, not-available
  //      downloading, verifying, installing
  //      downloaded, error
}
```

**核心流程**:

```typescript
async downloadAndApply(manifest: HotUpdateManifest) {
  try {
    // 步骤1: 下载差异包
    this.emit('downloading', { percent: 0 });
    const diffPath = await this.downloadDiffPackage(manifest);

    // 步骤2: 验证完整性
    this.emit('verifying');
    await this.verifyPackage(diffPath, manifest.diffSha512);

    // 步骤3: 备份
    await this.createBackup();

    // 步骤4: 应用差异
    this.emit('installing');
    await this.applyDiffPackage(diffPath, manifest);

    // 步骤5: 验证新版本
    await this.validateNewVersion(manifest.version);

    // 步骤6: 清理 + 上报成功
    await this.reportResult(manifest, true);
    this.emit('downloaded', { version: manifest.version });

  } catch (error) {
    // 回滚 + 上报失败
    await this.rollback();
    await this.reportResult(manifest, false, error);
    this.emit('error', error);
  }
}
```

**关键: 差异应用逻辑**:

```typescript
private async applyDiffPackage(diffPath: string, manifest: HotUpdateManifest) {
  // 1. 解包当前ASAR
  asar.extractAll(this.asarPath, tempExtractDir);

  // 2. 解压差异包
  await tar.extract({ file: diffPath, cwd: tempDiffDir });

  // 3. 读取manifest
  const diffManifest = await fs.readJson(path.join(tempDiffDir, 'manifest.json'));

  // 4. 删除文件
  for (const filePath of diffManifest.deleted) {
    await fs.remove(path.join(tempExtractDir, filePath));
  }

  // 5. 添加/修改文件
  for (const filePath of diffManifest.changed) {
    const sourcePath = path.join(tempDiffDir, 'files', filePath);
    const targetPath = path.join(tempExtractDir, filePath);
    await fs.copy(sourcePath, targetPath, { overwrite: true });
  }

  // 6. 重新打包ASAR（原子替换）
  const tempAsarPath = `${this.asarPath}.tmp`;
  await asar.createPackage(tempExtractDir, tempAsarPath);
  await fs.rename(tempAsarPath, this.asarPath);  // 原子操作
}
```

### 4.2 集成到AutoUpdateService

**修改**: `employee-client/src/common/services/AutoUpdateService.ts`

```typescript
import { HotUpdateService } from './HotUpdateService';
import { autoUpdater } from 'electron-updater';

export class AutoUpdateService {
  private hotUpdateService: HotUpdateService | null = null;

  constructor() {
    // 初始化热更新服务
    if (app.isPackaged) {
      try {
        this.hotUpdateService = new HotUpdateService();
        this.setupHotUpdateListeners();
      } catch (error) {
        logger.warn('[AutoUpdate] 热更新服务初始化失败:', error);
      }
    }
  }

  /**
   * 检查更新（优先热更新）
   */
  async checkForUpdates() {
    // 1. 优先尝试热更新
    if (this.hotUpdateService) {
      try {
        const updateInfo = await this.hotUpdateService.checkForUpdates();

        if (updateInfo?.hotUpdateAvailable && updateInfo.manifest) {
          // 发现热更新
          await this.hotUpdateService.downloadAndApply(updateInfo.manifest);
          this.promptUserToRestart(updateInfo.manifest.version);
          return;
        }

        if (updateInfo?.fullUpdateRequired) {
          // 需要完整更新
          logger.info('[AutoUpdate] 需要完整更新:', updateInfo.incompatibilityReason);
          // 继续执行下方的完整更新
        }
      } catch (error) {
        logger.error('[AutoUpdate] 热更新失败，降级完整更新:', error);
      }
    }

    // 2. 完整更新流程（原有逻辑）
    autoUpdater.checkForUpdates();
  }

  private setupHotUpdateListeners() {
    this.hotUpdateService.on('downloading', (progress) => {
      this.sendStatusToRenderer({ type: 'download-progress', data: progress });
    });

    this.hotUpdateService.on('downloaded', (info) => {
      this.sendStatusToRenderer({ type: 'update-downloaded', data: info });
    });

    // ... 其他事件监听 ...
  }
}
```

### 4.3 启动完整性检查

**修改**: `employee-client/electron/main.ts`

```typescript
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
const asar = require('@electron/asar');

function checkAsarIntegrity(): boolean {
  if (!app.isPackaged) return true;

  const asarPath = path.join(process.resourcesPath, 'app.asar');
  const backupPath = `${asarPath}.backup`;

  try {
    // 尝试读取package.json
    const packageJson = asar.extractFile(asarPath, 'package.json');
    JSON.parse(packageJson.toString());
    return true;
  } catch (error) {
    console.error('[Startup] ASAR损坏:', error);

    // 尝试从备份恢复
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, asarPath);
        app.relaunch();
        app.exit(0);
      } catch (restoreError) {
        return false;
      }
    }
    return false;
  }
}

// 在app.whenReady()之前检查
if (!checkAsarIntegrity()) {
  app.whenReady().then(() => {
    dialog.showErrorBox('应用文件损坏', '请重新安装应用');
    app.quit();
  });
} else {
  // 正常启动
  app.whenReady().then(createWindow);
}
```

### 4.4 配置项

**修改**: `employee-client/src/common/config/AppConfig.ts`

```typescript
export interface AppConfig {
  // 热更新配置
  hotUpdateEnabled: boolean;          // 是否启用热更新
  hotUpdateFallbackTimeout: number;   // 热更新超时（ms）
}

export const DEFAULT_CONFIG: AppConfig = {
  hotUpdateEnabled: true,
  hotUpdateFallbackTimeout: 120000,  // 2分钟
};
```

---

## 5. 实施步骤

### Day 1: 后端基础（数据库+Model）

**上午 (4h)**:
```bash
# 1. 创建数据库迁移
cd api-server
npm run migration:create -- add_hot_update_tables

# 2. 编写迁移SQL
vim src/database/migrations/005_add_hot_update_tables.sql

# 3. 执行迁移
npm run migration:run

# 4. 验证表结构
psql -d employee_monitoring -c "\d client_version_metadata"
```

**下午 (4h)**:
```bash
# 1. 创建Model
touch src/models/ClientVersionMetadata.ts
touch src/models/DiffPackage.ts

# 2. 编写单元测试
npm test -- ClientVersionMetadata
```

**验收标准**:
- ✅ 数据库表创建成功
- ✅ `areCompatible()` 方法正确判断兼容性
- ✅ 单元测试覆盖率 ≥ 80%

---

### Day 2: 后端核心服务

**上午 (4h)**:
```bash
# 1. 安装依赖
npm install @electron/asar tar

# 2. 实现ASAR提取
touch src/services/HotUpdateService.ts
# 实现: extractAsarFromPackage, collectVersionMetadata
```

**下午 (4h)**:
```bash
# 1. 实现差异生成
# 实现: generateDiffPackage, compareDirectories

# 2. 测试差异生成
npm run test:hot-update
```

**验收标准**:
- ✅ 能从安装包提取ASAR
- ✅ 能收集版本元数据
- ✅ 差异包大小 < 原ASAR的20%

---

### Day 3: 后端API接口

**上午 (3h)**:
```bash
# 1. 创建Controller
touch src/controllers/HotUpdateController.ts

# 2. 创建路由
touch src/routes/hotUpdate.ts

# 3. 注册路由
# 修改 src/index.ts
```

**下午 (5h)**:
```bash
# 1. 集成到版本上传流程
# 修改 ClientVersionController.upload()

# 2. 测试API
curl "http://localhost:3000/api/hot-update/check?version=1.0.132&platform=darwin&deviceId=test"
```

**验收标准**:
- ✅ `/api/hot-update/check` 返回正确清单
- ✅ 不兼容版本能降级
- ✅ 灰度发布逻辑正确

---

### Day 4: 客户端热更新服务

**上午 (4h)**:
```bash
cd employee-client

# 1. 安装依赖
npm install @electron/asar tar node-fetch

# 2. 实现核心方法
touch src/common/services/HotUpdateService.ts
```

**下午 (4h)**:
```bash
# 1. 实现差异应用
# applyDiffPackage, rollback

# 2. 本地测试
npm run dev
```

**验收标准**:
- ✅ 能下载差异包
- ✅ SHA512校验通过
- ✅ 能应用差异到ASAR

---

### Day 5: 客户端集成与测试

**上午 (3h)**:
```bash
# 1. 集成到AutoUpdateService
# 修改 AutoUpdateService.ts

# 2. 添加启动检查
# 修改 electron/main.ts
```

**下午 (5h)**:
```bash
# 1. 端到端测试
npm version 1.0.132 && npm run pack:mac
npm version 1.0.133 && npm run pack:mac

# 2. 异常场景测试
```

**验收标准**:
- ✅ 热更新成功后重启，版本正确
- ✅ 系统权限保持不变
- ✅ 异常场景正确处理

---

## 6. 测试验证

### 6.1 功能测试清单

| 测试场景 | 预期结果 | 优先级 |
|---------|---------|--------|
| 兼容版本热更新 (1.0.132→1.0.133) | ✅ 热更新成功，<30秒，无需授权 | P0 |
| 不兼容版本 (Electron升级) | ✅ 返回完整更新包 | P0 |
| 差异包损坏 | ❌ 校验失败，回滚 | P0 |
| 网络中断 | ❌ 下载失败，保持当前版本 | P1 |
| ASAR损坏启动 | ✅ 自动从backup恢复 | P0 |
| 灰度发布命中/未命中 | ✅ 正确判断 | P1 |
| 跨版本热更新 (1.0.130→1.0.133) | ✅ 直接生成差异包 | P2 |

### 6.2 性能测试

```yaml
测试指标:
  差异包大小: "< 10MB (vs 100MB+)"
  下载时间: "< 30秒 (100Mbps)"
  应用时间: "< 10秒"
  总更新时间: "< 1分钟"
  成功率: "≥ 95%"
```

### 6.3 安全测试

```yaml
检查项:
  - SHA512完整性校验
  - 版本号校验
  - 原子替换
  - 备份机制
  - 权限验证
```

---

## 7. 风险评估

### 风险1: ASAR损坏 🔴

**影响**: 严重 - 应用无法启动

**应对**:
1. ✅ 启动完整性检查 + 自动恢复
2. ✅ 差异应用前备份
3. 🆘 提示用户重新安装

---

### 风险2: 差异包生成失败 🟡

**影响**: 中等 - 降级完整更新

**应对**:
1. ✅ 自动降级
2. ✅ 记录失败原因
3. 📊 监控生成成功率

---

### 风险3: 跨区域网络不稳定 🟡

**影响**: 中等 - 下载超时

**应对**:
1. ✅ 多区域容错
2. ✅ 重试机制（3次）
3. ⏳ 超时设置（120秒）

---

### 风险4: 存储成本增加 🟢

**影响**: 低

**应对**:
1. 📦 保留最近10个版本
2. 🗑️ 定期清理（>3个月）
3. 💰 预算：< ¥10/月

---

## 8. 监控指标

### 8.1 热更新成功率

```sql
SELECT
  to_version,
  COUNT(*) FILTER (WHERE update_type = 'hot' AND status = 'success') as hot_success,
  COUNT(*) FILTER (WHERE update_type = 'hot' AND status = 'failed') as hot_failed,
  COUNT(*) FILTER (WHERE update_type = 'hot_fallback') as hot_fallback,
  ROUND(
    COUNT(*) FILTER (WHERE update_type = 'hot' AND status = 'success')::decimal /
    NULLIF(COUNT(*) FILTER (WHERE update_type IN ('hot', 'hot_fallback')), 0) * 100,
    2
  ) as hot_success_rate
FROM update_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY to_version;
```

### 8.2 差异包统计

```sql
SELECT
  from_version,
  to_version,
  ROUND(diff_size / 1024.0 / 1024.0, 2) as size_mb,
  download_count,
  success_count,
  failure_count,
  ROUND(success_count::decimal / NULLIF(download_count, 0) * 100, 2) as success_rate
FROM diff_packages
WHERE status = 'active'
ORDER BY generated_at DESC;
```

### 8.3 关键指标

| 指标 | 目标值 | 告警阈值 |
|------|--------|----------|
| 热更新成功率 | ≥ 95% | < 90% |
| 差异包生成成功率 | ≥ 98% | < 95% |
| 平均下载时间 | ≤ 30秒 | > 60秒 |
| 回滚率 | ≤ 5% | > 10% |
| 完整更新降级率 | ≤ 10% | > 20% |

---

## 9. 实施建议

### 9.1 灰度发布策略

**Option 1: 保守渐进式**（推荐）

```yaml
第1周:
  范围: "IT部门内部测试 (5-10人)"
  监控: "热更新成功率、错误日志"

第2周:
  范围: "扩大到测试部门 (20人)"
  监控: "兼容性、回滚率"

第3周:
  范围: "20% 用户"
  监控: "性能指标、用户反馈"

第4周:
  范围: "50% 用户"

第5周:
  范围: "100% 全量"
```

**Option 2: 快速验证式**

```yaml
Week 1: "内部开发团队 (5人)"
Week 2: "Beta测试组 (20人)"
Week 3: "灰度50% + 监控"
Week 4: "全量发布"
```

### 9.2 投入产出分析

**投入成本**:
```yaml
开发成本:
  后端: "3人日"
  客户端: "2人日"
  测试: "2人日"
  总计: "7人日 ≈ 1.5周"

存储成本:
  ASAR: "800MB (10版本 × 80MB)"
  差异包: "~500MB"
  月成本: "< ¥20/月"
```

**产出收益**:
```yaml
用户体验:
  更新时间: "2-5分钟 → 30秒 (83%↓)"
  流量消耗: "100MB → 10MB (90%↓)"
  重新授权: "100% → 10% (90%↓)"

业务价值:
  用户流失率: "降低5-10%"
  更新推送效率: "提升3-5倍"
```

**ROI**: 极高 (投入1.5周，长期受益)

### 9.3 关键决策点

**需要决策**:
1. ✅ 是否立即实施热更新？
2. ✅ 灰度策略：保守渐进 vs 快速验证？
3. ✅ 优先平台：macOS优先 还是 Windows优先？

**建议**:
- ✅ 如果用户对重新授权抱怨强烈 → 立即实施
- ✅ 如果更新频率高（每周/两周） → 收益明显
- ✅ 如果团队资源充足 → 推荐实施

---

## 10. 附录

### 10.1 依赖清单

**后端**:
```json
{
  "@electron/asar": "^3.2.7",
  "tar": "^6.2.0"
}
```

**客户端**:
```json
{
  "@electron/asar": "^3.2.7",
  "tar": "^6.2.0",
  "node-fetch": "^2.7.0"
}
```

### 10.2 目录结构

**后端**:
```
api-server/
├── src/
│   ├── models/
│   │   ├── ClientVersionMetadata.ts
│   │   └── DiffPackage.ts
│   ├── services/
│   │   └── HotUpdateService.ts
│   ├── controllers/
│   │   └── HotUpdateController.ts
│   └── routes/
│       └── hotUpdate.ts
├── storage/
│   ├── client-asars/      # 历史版本ASAR
│   └── client-diffs/      # 差异包
└── migrations/
    └── 005_add_hot_update_tables.sql
```

**客户端**:
```
employee-client/
└── src/common/
    └── services/
        └── HotUpdateService.ts
```

### 10.3 相关文档

- 📖 [Electron ASAR文档](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- 📖 [electron-updater源码](https://github.com/electron-userland/electron-builder)
- 📖 [阿里云OSS SDK](https://help.aliyun.com/document_detail/64041.html)

---

## 11. 下一步行动

**立即可做**:
```bash
# 1. 克隆代码准备开发
git checkout -b feature/hot-update

# 2. 从Day 1开始执行
cd api-server
npm run migration:create -- add_hot_update_tables
```

**需要决策**:
- [ ] 是否实施热更新？
- [ ] 选择哪种灰度策略？
- [ ] 优先支持哪个平台？

**联系方式**:
如需技术支持，请联系开发团队或提交Issue。

---

**文档版本**: v1.0
**最后更新**: 2025-12-17
**维护者**: Development Team
