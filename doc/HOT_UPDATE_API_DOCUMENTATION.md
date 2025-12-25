# 热更新API文档与实施完整指南

> **项目**: Employee Monitoring System - 热更新API完整文档
>
> **版本**: v1.0
>
> **关联文档**: HOT_UPDATE_BACKEND_IMPLEMENTATION.md (架构与Model层)
>
> **预计工期**: 3 工作日

---

## 📋 目录

- [1. Controller层实现](#1-controller层实现)
- [2. 路由配置](#2-路由配置)
- [3. 单元测试](#3-单元测试)
- [4. 集成测试](#4-集成测试)
- [5. 部署方案](#5-部署方案)
- [6. 运维监控](#6-运维监控)
- [7. 完整API文档](#7-完整api文档)
- [8. 技术决策记录](#8-技术决策记录)

---

## 1. Controller层实现

### 1.1 HotUpdateController

**文件**: `src/controllers/HotUpdateController.ts`

```typescript
import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import ClientVersionMetadata from '../models/ClientVersionMetadata';
import ClientVersion from '../models/ClientVersion';
import DiffPackage from '../models/DiffPackage';
import { RolloutService } from '../services/RolloutService';
import { MultiRegionClientStorageService } from '../services/MultiRegionClientStorageService';
import HotUpdateService from '../services/HotUpdateService';

/**
 * 检查更新请求参数
 */
interface CheckUpdateRequest {
  currentVersion: string;
  platform: 'darwin' | 'win32';
  deviceId: string;
  departmentId?: number;
}

/**
 * 检查更新响应
 */
interface CheckUpdateResponse {
  hasUpdate: boolean;
  updateType?: 'full' | 'hot';
  version?: string;
  downloadUrl?: string;
  diffUrl?: string;
  fileSize?: number;
  sha512?: string;
  releaseNotes?: string;
  rolloutStatus?: 'eligible' | 'not_eligible';
  reason?: string;
}

/**
 * 上报更新结果请求
 */
interface ReportUpdateRequest {
  deviceId: string;
  fromVersion: string;
  toVersion: string;
  updateType: 'full' | 'hot' | 'hot_fallback';
  success: boolean;
  error?: string;
  fallbackReason?: string;
  downloadDuration?: number;
  installDuration?: number;
}

/**
 * 热更新Controller
 */
export class HotUpdateController {
  private rolloutService: RolloutService;
  private storageService: MultiRegionClientStorageService;

  constructor() {
    this.rolloutService = new RolloutService();
    this.storageService = new MultiRegionClientStorageService();
  }

  /**
   * 检查更新 (支持热更新)
   *
   * GET /api/hot-update/check
   * Query: currentVersion, platform, deviceId, departmentId
   */
  async checkUpdate(req: Request, res: Response): Promise<void> {
    try {
      const {
        currentVersion,
        platform,
        deviceId,
        departmentId
      } = req.query as unknown as CheckUpdateRequest;

      // 参数校验
      if (!currentVersion || !platform || !deviceId) {
        res.status(400).json({
          success: false,
          message: '缺少必需参数: currentVersion, platform, deviceId'
        });
        return;
      }

      logger.info(`[HotUpdateController] 检查更新请求: ${deviceId}, ${currentVersion} (${platform})`);

      // 1. 查询最新发布版本
      const latestVersion = await ClientVersion.findOne({
        where: { platform, status: 'published' },
        order: [['createdAt', 'DESC']]
      });

      if (!latestVersion) {
        res.json({
          success: true,
          data: { hasUpdate: false, reason: '暂无可用版本' }
        });
        return;
      }

      // 2. 版本比较
      if (this.compareVersions(currentVersion, latestVersion.version) >= 0) {
        res.json({
          success: true,
          data: { hasUpdate: false, reason: '已是最新版本' }
        });
        return;
      }

      // 3. 灰度发布判断
      if (departmentId) {
        const rolloutCheck = await this.rolloutService.checkRolloutEligibility(
          latestVersion.id,
          Number(departmentId)
        );

        if (!rolloutCheck.eligible) {
          res.json({
            success: true,
            data: {
              hasUpdate: true,
              rolloutStatus: 'not_eligible',
              reason: '当前部门未在灰度发布范围内'
            }
          });
          return;
        }
      }

      // 4. 兼容性检查
      const compatibility = await ClientVersionMetadata.areCompatible(
        currentVersion,
        latestVersion.version,
        platform
      );

      // 5. 决定更新类型
      if (compatibility.compatible) {
        // 可以热更新
        const diffPackage = await DiffPackage.findDiff(
          currentVersion,
          latestVersion.version,
          platform
        );

        if (diffPackage) {
          // 差异包已存在
          await diffPackage.recordDownload();

          const response: CheckUpdateResponse = {
            hasUpdate: true,
            updateType: 'hot',
            version: latestVersion.version,
            diffUrl: diffPackage.diffUrlCn || diffPackage.diffUrlEn,
            fileSize: diffPackage.diffSize,
            sha512: diffPackage.diffSha512,
            releaseNotes: latestVersion.releaseNotes,
            rolloutStatus: 'eligible'
          };

          res.json({ success: true, data: response });
          return;
        }

        // 差异包不存在，异步生成
        this.generateDiffAsync(currentVersion, latestVersion.version, platform);
      }

      // 6. 返回完整更新包
      const downloadUrl = await this.storageService.getDownloadUrl(
        latestVersion.filePathCn || latestVersion.filePathEn!,
        'china' // TODO: 根据设备区域选择
      );

      const response: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'full',
        version: latestVersion.version,
        downloadUrl,
        fileSize: latestVersion.fileSize,
        sha512: latestVersion.sha512,
        releaseNotes: latestVersion.releaseNotes,
        rolloutStatus: 'eligible',
        reason: compatibility.compatible ? '差异包生成中，暂用完整包' : compatibility.reason
      };

      res.json({ success: true, data: response });

    } catch (error: any) {
      logger.error('[HotUpdateController] 检查更新失败:', error);
      res.status(500).json({
        success: false,
        message: '检查更新失败',
        error: error.message
      });
    }
  }

  /**
   * 上报更新结果
   *
   * POST /api/hot-update/report
   * Body: ReportUpdateRequest
   */
  async reportUpdate(req: Request, res: Response): Promise<void> {
    try {
      const {
        deviceId,
        fromVersion,
        toVersion,
        updateType,
        success,
        error,
        fallbackReason,
        downloadDuration,
        installDuration
      } = req.body as ReportUpdateRequest;

      logger.info(`[HotUpdateController] 更新上报: ${deviceId}, ${fromVersion}→${toVersion}, type=${updateType}, success=${success}`);

      // 1. 更新差异包统计
      if (updateType === 'hot' || updateType === 'hot_fallback') {
        const diffPackage = await DiffPackage.findDiff(
          fromVersion,
          toVersion,
          req.body.platform || 'darwin'
        );

        if (diffPackage) {
          if (success && updateType === 'hot') {
            await diffPackage.recordSuccess();
          } else {
            await diffPackage.recordFailure();
          }
        }
      }

      // 2. 记录更新日志
      // TODO: 调用UpdateLogService记录详细日志

      res.json({
        success: true,
        message: '上报成功'
      });

    } catch (error: any) {
      logger.error('[HotUpdateController] 上报更新失败:', error);
      res.status(500).json({
        success: false,
        message: '上报失败',
        error: error.message
      });
    }
  }

  /**
   * 获取版本元数据
   *
   * GET /api/hot-update/metadata/:version/:platform
   */
  async getMetadata(req: Request, res: Response): Promise<void> {
    try {
      const { version, platform } = req.params;

      const metadata = await ClientVersionMetadata.findByVersion(version, platform);

      if (!metadata) {
        res.status(404).json({
          success: false,
          message: '版本元数据不存在'
        });
        return;
      }

      res.json({
        success: true,
        data: metadata
      });

    } catch (error: any) {
      logger.error('[HotUpdateController] 获取元数据失败:', error);
      res.status(500).json({
        success: false,
        message: '获取元数据失败',
        error: error.message
      });
    }
  }

  /**
   * 获取差异包统计
   *
   * GET /api/hot-update/stats
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const { toVersion, platform } = req.query;

      const stats = await DiffPackage.getStats(
        toVersion as string,
        platform as string
      );

      res.json({
        success: true,
        data: stats
      });

    } catch (error: any) {
      logger.error('[HotUpdateController] 获取统计失败:', error);
      res.status(500).json({
        success: false,
        message: '获取统计失败',
        error: error.message
      });
    }
  }

  /**
   * 版本号比较
   * @returns >0 if v1 > v2, 0 if equal, <0 if v1 < v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;
      if (num1 !== num2) return num1 - num2;
    }

    return 0;
  }

  /**
   * 异步生成差异包
   */
  private async generateDiffAsync(
    fromVersion: string,
    toVersion: string,
    platform: string
  ): Promise<void> {
    // 在后台异步生成，不阻塞响应
    setImmediate(async () => {
      try {
        logger.info(`[HotUpdateController] 开始异步生成差异包: ${fromVersion}→${toVersion}`);
        await HotUpdateService.generateDiffPackage(fromVersion, toVersion, platform);
      } catch (error: any) {
        logger.error(`[HotUpdateController] 异步生成差异包失败:`, error);
      }
    });
  }
}

export default new HotUpdateController();
```

---

## 2. 路由配置

### 2.1 热更新路由

**文件**: `src/routes/hotUpdate.ts`

```typescript
import { Router } from 'express';
import HotUpdateController from '../controllers/HotUpdateController';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * 热更新路由
 * 基础路径: /api/hot-update
 */

// 检查更新 (客户端无需认证)
router.get('/check', (req, res) => HotUpdateController.checkUpdate(req, res));

// 上报更新结果 (客户端无需认证)
router.post('/report', (req, res) => HotUpdateController.reportUpdate(req, res));

// 获取版本元数据 (需要认证)
router.get(
  '/metadata/:version/:platform',
  authenticate,
  (req, res) => HotUpdateController.getMetadata(req, res)
);

// 获取差异包统计 (需要认证)
router.get(
  '/stats',
  authenticate,
  (req, res) => HotUpdateController.getStats(req, res)
);

export default router;
```

### 2.2 主路由注册

**文件**: `src/index.ts` (修改片段)

```typescript
// ... 其他导入
import hotUpdateRoutes from './routes/hotUpdate';

// ... Express配置

// 注册热更新路由
app.use('/api/hot-update', hotUpdateRoutes);

// ... 其他路由
```

---

## 3. 单元测试

### 3.1 ClientVersionMetadata测试

**文件**: `src/tests/models/ClientVersionMetadata.test.ts`

```typescript
import ClientVersionMetadata from '../../models/ClientVersionMetadata';
import { NativeModule } from '../../models/ClientVersionMetadata';

describe('ClientVersionMetadata Model', () => {
  const mockMetadata1 = {
    version: '1.0.132',
    platform: 'darwin' as const,
    electronVersion: '28.0.0',
    nodeVersion: '18.18.2',
    chromeVersion: '120.0.6099.56',
    nativeModulesHash: 'abc123',
    nativeModules: [
      { name: 'test.node', path: 'test.node', size: 1024, abi: 108 }
    ] as NativeModule[]
  };

  const mockMetadata2 = {
    ...mockMetadata1,
    version: '1.0.133',
    electronVersion: '28.0.1' // 不兼容
  };

  beforeEach(async () => {
    await ClientVersionMetadata.destroy({ where: {} });
  });

  test('应该创建版本元数据', async () => {
    const metadata = await ClientVersionMetadata.create(mockMetadata1);
    expect(metadata.version).toBe('1.0.132');
    expect(metadata.nativeModules.length).toBe(1);
  });

  test('应该正确判断版本兼容性 - 兼容', async () => {
    await ClientVersionMetadata.create(mockMetadata1);
    await ClientVersionMetadata.create({
      ...mockMetadata1,
      version: '1.0.133'
    });

    const result = await ClientVersionMetadata.areCompatible(
      '1.0.132',
      '1.0.133',
      'darwin'
    );

    expect(result.compatible).toBe(true);
  });

  test('应该正确判断版本兼容性 - 不兼容(Electron版本)', async () => {
    await ClientVersionMetadata.create(mockMetadata1);
    await ClientVersionMetadata.create(mockMetadata2);

    const result = await ClientVersionMetadata.areCompatible(
      '1.0.132',
      '1.0.133',
      'darwin'
    );

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('Electron版本不同');
  });

  test('应该获取兼容版本列表', async () => {
    // 创建3个兼容版本
    await ClientVersionMetadata.bulkCreate([
      mockMetadata1,
      { ...mockMetadata1, version: '1.0.131' },
      { ...mockMetadata1, version: '1.0.130' }
    ]);

    const compatibleVersions = await ClientVersionMetadata.getCompatibleVersions(
      '1.0.132',
      'darwin',
      10
    );

    expect(compatibleVersions.length).toBe(2);
    expect(compatibleVersions).toContain('1.0.131');
    expect(compatibleVersions).toContain('1.0.130');
  });
});
```

### 3.2 DiffPackage测试

**文件**: `src/tests/models/DiffPackage.test.ts`

```typescript
import DiffPackage from '../../models/DiffPackage';

describe('DiffPackage Model', () => {
  const mockDiff = {
    fromVersion: '1.0.132',
    toVersion: '1.0.133',
    platform: 'darwin' as const,
    diffUrlCn: 'https://cn.oss/diff.tar.gz',
    diffUrlEn: 'https://en.oss/diff.tar.gz',
    diffSha512: 'abc123',
    diffSize: 8388608,
    changedFiles: ['src/main.js', 'src/renderer.js'],
    deletedFiles: ['old/legacy.js'],
    changedFilesCount: 2,
    deletedFilesCount: 1
  };

  beforeEach(async () => {
    await DiffPackage.destroy({ where: {} });
  });

  test('应该创建差异包记录', async () => {
    const diff = await DiffPackage.create(mockDiff);
    expect(diff.fromVersion).toBe('1.0.132');
    expect(diff.diffSize).toBe(8388608);
  });

  test('应该正确记录下载统计', async () => {
    const diff = await DiffPackage.create(mockDiff);

    await diff.recordDownload();
    await diff.reload();
    expect(diff.downloadCount).toBe(1);

    await diff.recordSuccess();
    await diff.reload();
    expect(diff.successCount).toBe(1);
  });

  test('应该正确计算成功率', async () => {
    const diff = await DiffPackage.create(mockDiff);

    await diff.increment('downloadCount', { by: 10 });
    await diff.increment('successCount', { by: 9 });
    await diff.reload();

    expect(diff.getSuccessRate()).toBe(90);
  });

  test('应该查找差异包', async () => {
    await DiffPackage.create(mockDiff);

    const found = await DiffPackage.findDiff('1.0.132', '1.0.133', 'darwin');
    expect(found).not.toBeNull();
    expect(found?.diffSize).toBe(8388608);
  });

  test('应该获取统计信息', async () => {
    await DiffPackage.bulkCreate([
      mockDiff,
      {
        ...mockDiff,
        fromVersion: '1.0.131',
        downloadCount: 100,
        successCount: 95,
        failureCount: 5
      }
    ]);

    const stats = await DiffPackage.getStats();
    expect(stats.totalDownloads).toBe(100);
    expect(stats.successRate).toBeCloseTo(95);
  });
});
```

### 3.3 HotUpdateController测试

**文件**: `src/tests/controllers/HotUpdateController.test.ts`

```typescript
import request from 'supertest';
import app from '../../app';
import ClientVersion from '../../models/ClientVersion';
import ClientVersionMetadata from '../../models/ClientVersionMetadata';
import DiffPackage from '../../models/DiffPackage';

jest.mock('../../services/RolloutService');
jest.mock('../../services/MultiRegionClientStorageService');

describe('HotUpdateController', () => {
  beforeAll(async () => {
    // 初始化测试数据
    await ClientVersion.create({
      version: '1.0.133',
      platform: 'darwin',
      status: 'published',
      filePathCn: 'test/darwin/1.0.133.dmg',
      fileSize: 104857600,
      sha512: 'test-sha512'
    });

    await ClientVersionMetadata.bulkCreate([
      {
        version: '1.0.132',
        platform: 'darwin',
        electronVersion: '28.0.0',
        nodeVersion: '18.18.2',
        chromeVersion: '120.0.0',
        nativeModulesHash: 'hash123',
        nativeModules: []
      },
      {
        version: '1.0.133',
        platform: 'darwin',
        electronVersion: '28.0.0',
        nodeVersion: '18.18.2',
        chromeVersion: '120.0.0',
        nativeModulesHash: 'hash123',
        nativeModules: []
      }
    ]);

    await DiffPackage.create({
      fromVersion: '1.0.132',
      toVersion: '1.0.133',
      platform: 'darwin',
      diffUrlCn: 'https://test.oss/diff.tar.gz',
      diffSha512: 'diff-sha512',
      diffSize: 8388608,
      changedFiles: ['main.js'],
      deletedFiles: [],
      changedFilesCount: 1,
      deletedFilesCount: 0,
      status: 'active'
    });
  });

  describe('GET /api/hot-update/check', () => {
    test('应该返回热更新包', async () => {
      const response = await request(app)
        .get('/api/hot-update/check')
        .query({
          currentVersion: '1.0.132',
          platform: 'darwin',
          deviceId: 'test-device-123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.hasUpdate).toBe(true);
      expect(response.body.data.updateType).toBe('hot');
      expect(response.body.data.diffUrl).toBeDefined();
    });

    test('应该在版本不兼容时返回完整更新包', async () => {
      await ClientVersionMetadata.create({
        version: '1.0.131',
        platform: 'darwin',
        electronVersion: '27.0.0', // 不同的Electron版本
        nodeVersion: '18.18.2',
        chromeVersion: '120.0.0',
        nativeModulesHash: 'hash456',
        nativeModules: []
      });

      const response = await request(app)
        .get('/api/hot-update/check')
        .query({
          currentVersion: '1.0.131',
          platform: 'darwin',
          deviceId: 'test-device-456'
        });

      expect(response.status).toBe(200);
      expect(response.body.data.updateType).toBe('full');
      expect(response.body.data.downloadUrl).toBeDefined();
    });

    test('应该在缺少必需参数时返回400', async () => {
      const response = await request(app)
        .get('/api/hot-update/check')
        .query({
          currentVersion: '1.0.132'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/hot-update/report', () => {
    test('应该正确记录更新成功', async () => {
      const response = await request(app)
        .post('/api/hot-update/report')
        .send({
          deviceId: 'test-device-123',
          fromVersion: '1.0.132',
          toVersion: '1.0.133',
          platform: 'darwin',
          updateType: 'hot',
          success: true,
          downloadDuration: 5000,
          installDuration: 2000
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // 验证统计数据更新
      const diff = await DiffPackage.findDiff('1.0.132', '1.0.133', 'darwin');
      expect(diff?.successCount).toBe(1);
    });

    test('应该正确记录更新失败', async () => {
      const response = await request(app)
        .post('/api/hot-update/report')
        .send({
          deviceId: 'test-device-456',
          fromVersion: '1.0.132',
          toVersion: '1.0.133',
          platform: 'darwin',
          updateType: 'hot',
          success: false,
          error: 'Download failed'
        });

      expect(response.status).toBe(200);

      const diff = await DiffPackage.findDiff('1.0.132', '1.0.133', 'darwin');
      expect(diff?.failureCount).toBe(1);
    });
  });
});
```

---

## 4. 集成测试

### 4.1 完整更新流程测试

**文件**: `src/tests/integration/hotUpdate.integration.test.ts`

```typescript
import request from 'supertest';
import app from '../../app';
import ClientVersion from '../../models/ClientVersion';
import ClientVersionMetadata from '../../models/ClientVersionMetadata';
import DiffPackage from '../../models/DiffPackage';

describe('Hot Update Integration Tests', () => {
  beforeAll(async () => {
    // 初始化完整测试数据
  });

  afterAll(async () => {
    // 清理测试数据
  });

  test('完整热更新流程 - 从检查到上报', async () => {
    // 1. 检查更新
    const checkResponse = await request(app)
      .get('/api/hot-update/check')
      .query({
        currentVersion: '1.0.132',
        platform: 'darwin',
        deviceId: 'integration-test-device'
      });

    expect(checkResponse.body.data.updateType).toBe('hot');
    const diffUrl = checkResponse.body.data.diffUrl;

    // 2. 模拟下载
    // (实际测试中应该真实下载并验证SHA512)

    // 3. 上报成功
    const reportResponse = await request(app)
      .post('/api/hot-update/report')
      .send({
        deviceId: 'integration-test-device',
        fromVersion: '1.0.132',
        toVersion: '1.0.133',
        platform: 'darwin',
        updateType: 'hot',
        success: true,
        downloadDuration: 5000,
        installDuration: 2000
      });

    expect(reportResponse.body.success).toBe(true);

    // 4. 验证统计
    const statsResponse = await request(app)
      .get('/api/hot-update/stats')
      .query({ toVersion: '1.0.133', platform: 'darwin' });

    expect(statsResponse.body.data.totalSuccess).toBeGreaterThan(0);
  });

  test('降级流程 - 热更新失败后使用完整更新', async () => {
    // 1. 检查更新 - 返回热更新
    const checkResponse = await request(app)
      .get('/api/hot-update/check')
      .query({
        currentVersion: '1.0.132',
        platform: 'darwin',
        deviceId: 'fallback-test-device'
      });

    expect(checkResponse.body.data.updateType).toBe('hot');

    // 2. 上报热更新失败
    await request(app)
      .post('/api/hot-update/report')
      .send({
        deviceId: 'fallback-test-device',
        fromVersion: '1.0.132',
        toVersion: '1.0.133',
        platform: 'darwin',
        updateType: 'hot_fallback',
        success: false,
        fallbackReason: 'ASAR checksum mismatch'
      });

    // 3. 客户端再次检查更新，应该返回完整更新
    // (实际逻辑可能需要在客户端实现)
  });
});
```

---

## 5. 部署方案

### 5.1 部署前检查清单

```bash
# 1. 数据库迁移
cd api-server
npm run db:migrate -- src/database/migrations/005_add_hot_update_tables.sql

# 2. 验证数据库表
psql -U monitoring_user -d employee_monitoring << EOF
\dt client_version_metadata
\dt diff_packages
\d+ update_logs
EOF

# 3. 安装新依赖
npm install @electron/asar tar

# 4. 验证环境变量
cat .env | grep -E "DATABASE|REDIS|MINIO|JWT"

# 5. 编译TypeScript
npm run build:prod

# 6. 运行测试
npm test -- --testPathPattern=hotUpdate

# 7. 语法检查
npm run lint
```

### 5.2 Docker部署步骤

```bash
# 1. 构建镜像
cd api-server
docker build -t api-server:hot-update-v1.0 -f Dockerfile .

# 2. 标签管理
docker tag api-server:hot-update-v1.0 registry.example.com/api-server:hot-update-v1.0
docker push registry.example.com/api-server:hot-update-v1.0

# 3. 停止现有服务
docker-compose stop api-server

# 4. 运行数据库迁移
docker run --rm \
  --network employee-monitoring-network \
  -e DATABASE_HOST=postgres \
  -e DATABASE_PORT=5432 \
  -e DATABASE_NAME=employee_monitoring \
  -e DATABASE_USER=monitoring_user \
  -e DATABASE_PASSWORD=monitoring_pass_2024 \
  api-server:hot-update-v1.0 \
  npm run db:migrate

# 5. 启动新服务
docker-compose up -d api-server

# 6. 验证服务健康
sleep 10
curl http://localhost:3000/api/health

# 7. 验证热更新端点
curl "http://localhost:3000/api/hot-update/check?currentVersion=1.0.132&platform=darwin&deviceId=test"

# 8. 查看日志
docker-compose logs -f api-server | grep HotUpdate
```

### 5.3 灰度发布策略

#### 阶段1: 内部测试 (1-2天)
```yaml
target: 开发团队和测试团队设备
scope: 5-10台设备
rollout_config:
  department_ids: [1, 2]  # 开发部门, 测试部门
  percentage: 100%
monitoring:
  - 实时查看更新成功率
  - 每小时检查错误日志
  - 性能指标监控
success_criteria:
  - 成功率 > 90%
  - 无严重错误
  - 性能影响 < 5%
```

#### 阶段2: 小范围试点 (2-3天)
```yaml
target: 单个业务部门
scope: 50-100台设备
rollout_config:
  department_ids: [3]  # 试点部门
  percentage: 100%
monitoring:
  - 每小时检查统计数据
  - 监控差异包下载成功率
  - 用户反馈收集
success_criteria:
  - 成功率 > 95%
  - 平均更新时间 < 5分钟
  - 无用户投诉
```

#### 阶段3: 全量发布 (3-5天)
```yaml
target: 所有用户
scope: 全部设备
rollout_config:
  department_ids: "*"  # 所有部门
  percentage: 100%
monitoring:
  - 自动告警异常率
  - Dashboard实时监控
  - 每日统计报告
success_criteria:
  - 成功率 > 95%
  - 故障降级率 < 5%
  - 服务可用性 > 99.9%
```

### 5.4 回滚方案

#### 方案1: 数据库回滚
```bash
# 执行回滚脚本
psql -U monitoring_user -d employee_monitoring \
  < src/database/migrations/005_add_hot_update_tables_rollback.sql

# 验证表已删除
psql -U monitoring_user -d employee_monitoring -c "\dt" | grep -E "client_version_metadata|diff_packages"
```

#### 方案2: 代码回滚
```bash
# Git回滚
git revert <hot-update-commit-hash>
git push origin main

# 重新构建
npm run build:prod

# 重启服务
docker-compose restart api-server
```

#### 方案3: 功能开关（推荐）
```bash
# 通过环境变量禁用热更新
docker-compose stop api-server

# 编辑 docker-compose.yml
# 添加: HOT_UPDATE_ENABLED=false

docker-compose up -d api-server

# 验证：所有请求返回完整更新包
curl "http://localhost:3000/api/hot-update/check?currentVersion=1.0.132&platform=darwin&deviceId=test" \
  | jq '.data.updateType'  # 应该返回 "full"
```

---

## 6. 运维监控

### 6.1 关键指标

**性能指标**:
```yaml
diff_generation_time:
  description: 差异包生成耗时
  target: < 30秒
  alert_threshold: > 60秒

diff_download_speed:
  description: 差异包下载速度
  target: > 1MB/s
  alert_threshold: < 500KB/s

hot_update_success_rate:
  description: 热更新成功率
  target: > 95%
  alert_threshold: < 85%

api_response_time:
  description: API响应时间
  target: < 500ms
  alert_threshold: > 1000ms
```

**业务指标**:
```yaml
hot_update_ratio:
  description: 热更新占比
  formula: hot_updates / (hot_updates + full_updates)
  target: > 80%

version_distribution:
  description: 版本分布情况
  monitoring: 实时版本占比统计

average_diff_size:
  description: 平均差异包大小
  target: < 10MB

update_failure_reasons:
  description: 更新失败原因分布
  categories:
    - download_error
    - checksum_mismatch
    - install_error
    - compatibility_error
```

### 6.2 监控SQL

#### 热更新成功率
```sql
-- 最近7天热更新成功率
SELECT
  to_version,
  platform,
  SUM(download_count) as total_downloads,
  SUM(success_count) as total_success,
  SUM(failure_count) as total_failure,
  ROUND(
    SUM(success_count)::numeric / NULLIF(SUM(download_count), 0) * 100,
    2
  ) as success_rate_percent
FROM diff_packages
WHERE status = 'active'
  AND generated_at > NOW() - INTERVAL '7 days'
GROUP BY to_version, platform
ORDER BY generated_at DESC;
```

#### 差异包大小统计
```sql
-- 按平台统计差异包大小
SELECT
  platform,
  COUNT(*) as package_count,
  ROUND(AVG(diff_size::numeric / 1024 / 1024), 2) as avg_size_mb,
  ROUND(MIN(diff_size::numeric / 1024 / 1024), 2) as min_size_mb,
  ROUND(MAX(diff_size::numeric / 1024 / 1024), 2) as max_size_mb,
  ROUND(AVG(compression_ratio), 2) as avg_compression
FROM diff_packages
WHERE status = 'active'
GROUP BY platform;
```

#### 版本兼容性分析
```sql
-- 版本兼容性矩阵
SELECT
  electron_version,
  node_version,
  COUNT(*) as version_count,
  COUNT(DISTINCT native_modules_hash) as unique_native_hashes,
  STRING_AGG(DISTINCT version, ', ' ORDER BY version DESC) as versions
FROM client_version_metadata
GROUP BY electron_version, node_version
ORDER BY version_count DESC;
```

#### 更新类型分布
```sql
-- 最近7天更新类型分布
SELECT
  update_type,
  COUNT(*) as count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER() * 100, 2) as percentage
FROM update_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY update_type
ORDER BY count DESC;
```

#### 失败原因统计
```sql
-- 热更新失败原因TOP10
SELECT
  fallback_reason,
  COUNT(*) as count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER() * 100, 2) as percentage
FROM update_logs
WHERE update_type = 'hot_fallback'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY fallback_reason
ORDER BY count DESC
LIMIT 10;
```

### 6.3 告警规则

**文件**: `alerts/hot-update-alerts.yml`

```yaml
groups:
  - name: hot_update_alerts
    interval: 5m
    rules:
      # 热更新成功率低
      - alert: HotUpdateSuccessRateLow
        expr: |
          (sum(diff_packages_success_count) / sum(diff_packages_download_count)) < 0.85
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "热更新成功率低于85%"
          description: "当前成功率: {{ $value | humanizePercentage }}"
          runbook: "检查差异包质量和网络状况"

      # 差异包生成失败
      - alert: DiffPackageGenerationFailed
        expr: diff_packages_status{status="failed"} > 0
        for: 1m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "差异包生成失败"
          description: "版本 {{ $labels.to_version }} 差异包生成失败"
          runbook: "检查ASAR提取和文件比较逻辑"

      # API响应时间慢
      - alert: HotUpdateAPIResponseSlow
        expr: |
          histogram_quantile(0.95,
            rate(http_request_duration_seconds_bucket{endpoint="/api/hot-update/check"}[5m])
          ) > 1.0
        for: 3m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "热更新API响应慢"
          description: "P95响应时间: {{ $value | humanizeDuration }}"
          runbook: "检查数据库查询和OSS性能"

      # 存储空间告警
      - alert: DiffPackageStorageLow
        expr: (oss_used_space / oss_total_space) > 0.8
        for: 10m
        labels:
          severity: warning
          team: ops
        annotations:
          summary: "差异包存储空间不足"
          description: "已使用: {{ $value | humanizePercentage }}"
          runbook: "清理旧版本差异包或扩容OSS"

      # 数据库连接池告警
      - alert: DatabaseConnectionPoolExhausted
        expr: database_connections_active > 80
        for: 2m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "数据库连接池接近耗尽"
          description: "活跃连接数: {{ $value }}"
          runbook: "检查连接泄漏和查询性能"
```

### 6.4 日志查询

```bash
# 查看热更新相关日志
docker logs api-server | grep HotUpdate

# 查看差异包生成日志
docker logs api-server | grep "差异包生成"

# 查看更新失败日志
docker logs api-server | grep "更新失败"

# 实时监控更新请求
docker logs -f api-server | grep "检查更新请求"

# 统计最近1小时热更新请求量
docker logs api-server --since 1h | grep "检查更新请求" | grep "hot" | wc -l

# 查找特定版本的更新日志
docker logs api-server | grep "1.0.133"
```

### 6.5 性能监控Dashboard

**Grafana Panel配置**:

```json
{
  "dashboard": {
    "title": "Hot Update Monitoring",
    "panels": [
      {
        "title": "热更新成功率",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(hot_update_success_total[5m])) / sum(rate(hot_update_total[5m]))",
            "legendFormat": "Success Rate"
          }
        ]
      },
      {
        "title": "更新类型分布",
        "type": "pie",
        "targets": [
          {
            "expr": "sum by (update_type) (rate(update_total[5m]))"
          }
        ]
      },
      {
        "title": "差异包大小趋势",
        "type": "graph",
        "targets": [
          {
            "expr": "avg(diff_package_size_bytes / 1024 / 1024)",
            "legendFormat": "Avg Diff Size (MB)"
          }
        ]
      },
      {
        "title": "API响应时间",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "P95 Response Time"
          }
        ]
      }
    ]
  }
}
```

### 6.6 维护任务

#### 每日任务
```bash
#!/bin/bash
# daily-hot-update-maintenance.sh

# 1. 检查热更新成功率
psql -U monitoring_user -d employee_monitoring -c "
SELECT 'Hot Update Success Rate' as metric,
       ROUND(SUM(success_count)::numeric / NULLIF(SUM(download_count), 0) * 100, 2) as value
FROM diff_packages
WHERE generated_at > NOW() - INTERVAL '24 hours';
"

# 2. 验证差异包生成状态
psql -U monitoring_user -d employee_monitoring -c "
SELECT status, COUNT(*) FROM diff_packages
WHERE generated_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
"

# 3. 清理过期临时文件
docker exec api-server find /app/temp/hot-update -type f -mtime +7 -delete

echo "Daily maintenance completed at $(date)"
```

#### 每周任务
```bash
#!/bin/bash
# weekly-hot-update-analysis.sh

# 1. 版本分布分析
psql -U monitoring_user -d employee_monitoring -c "
SELECT version, platform, COUNT(*) as device_count
FROM (
  SELECT DISTINCT device_id, current_version as version, platform
  FROM update_logs
  WHERE created_at > NOW() - INTERVAL '7 days'
) sub
GROUP BY version, platform
ORDER BY device_count DESC;
"

# 2. 失败原因统计
psql -U monitoring_user -d employee_monitoring -c "
SELECT fallback_reason, COUNT(*)
FROM update_logs
WHERE update_type = 'hot_fallback'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY fallback_reason
ORDER BY count DESC;
"

# 3. 生成周报
echo "Weekly Hot Update Report - $(date)" > /tmp/hot-update-weekly-report.txt
# ... 添加更多统计信息

# 4. 发送邮件
mail -s "Hot Update Weekly Report" team@example.com < /tmp/hot-update-weekly-report.txt
```

#### 每月任务
```bash
#!/bin/bash
# monthly-hot-update-cleanup.sh

# 1. 归档旧版本差异包
psql -U monitoring_user -d employee_monitoring -c "
UPDATE diff_packages
SET status = 'deprecated'
WHERE to_version NOT IN (
  SELECT version FROM client_versions
  WHERE created_at > NOW() - INTERVAL '90 days'
)
AND status = 'active';
"

# 2. 清理deprecated状态记录
psql -U monitoring_user -d employee_monitoring -c "
DELETE FROM diff_packages
WHERE status = 'deprecated'
  AND generated_at < NOW() - INTERVAL '180 days';
"

# 3. 优化数据库表
psql -U monitoring_user -d employee_monitoring -c "
VACUUM ANALYZE diff_packages;
VACUUM ANALYZE client_version_metadata;
VACUUM ANALYZE update_logs;
"

# 4. 性能优化评估
# 生成性能报告并发送给团队

echo "Monthly cleanup completed at $(date)"
```

---

## 7. 完整API文档

### 7.1 检查更新 (Check Update)

#### 端点
```
GET /api/hot-update/check
```

#### 认证
无需认证（客户端公开接口）

#### 请求参数 (Query String)

| 参数 | 类型 | 必需 | 说明 | 示例 |
|------|------|------|------|------|
| currentVersion | string | ✅ | 当前版本号 | "1.0.132" |
| platform | string | ✅ | 平台类型 | "darwin" / "win32" |
| deviceId | string | ✅ | 设备唯一ID | "device-abc-123" |
| departmentId | number | ❌ | 部门ID（用于灰度发布） | 5 |

#### 响应格式

**成功响应 - 有热更新**:
```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "updateType": "hot",
    "version": "1.0.133",
    "diffUrl": "https://cn.oss.com/diffs/darwin/1.0.132-to-1.0.133.tar.gz",
    "fileSize": 8388608,
    "sha512": "abc123def456...",
    "releaseNotes": "修复已知bug，优化性能",
    "rolloutStatus": "eligible"
  }
}
```

**成功响应 - 完整更新**:
```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "updateType": "full",
    "version": "1.0.133",
    "downloadUrl": "https://cn.oss.com/clients/darwin/1.0.133.dmg",
    "fileSize": 104857600,
    "sha512": "def456ghi789...",
    "releaseNotes": "重大版本更新",
    "rolloutStatus": "eligible",
    "reason": "Electron版本不兼容，需要完整更新"
  }
}
```

**成功响应 - 无更新**:
```json
{
  "success": true,
  "data": {
    "hasUpdate": false,
    "reason": "已是最新版本"
  }
}
```

**成功响应 - 不在灰度范围**:
```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "rolloutStatus": "not_eligible",
    "reason": "当前部门未在灰度发布范围内"
  }
}
```

**错误响应**:
```json
{
  "success": false,
  "message": "缺少必需参数: currentVersion, platform, deviceId"
}
```

#### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 参数错误 |
| 500 | 服务器内部错误 |

#### 示例

```bash
# cURL示例 - 热更新场景
curl -X GET "http://localhost:3000/api/hot-update/check?currentVersion=1.0.132&platform=darwin&deviceId=test-device-123"

# cURL示例 - 带部门ID
curl -X GET "http://localhost:3000/api/hot-update/check?currentVersion=1.0.132&platform=darwin&deviceId=test-device-123&departmentId=5"
```

---

### 7.2 上报更新结果 (Report Update)

#### 端点
```
POST /api/hot-update/report
```

#### 认证
无需认证（客户端公开接口）

#### 请求Body (JSON)

| 字段 | 类型 | 必需 | 说明 | 示例 |
|------|------|------|------|------|
| deviceId | string | ✅ | 设备ID | "device-abc-123" |
| fromVersion | string | ✅ | 源版本号 | "1.0.132" |
| toVersion | string | ✅ | 目标版本号 | "1.0.133" |
| platform | string | ✅ | 平台 | "darwin" / "win32" |
| updateType | string | ✅ | 更新类型 | "full" / "hot" / "hot_fallback" |
| success | boolean | ✅ | 是否成功 | true / false |
| error | string | ❌ | 错误信息 | "Download timeout" |
| fallbackReason | string | ❌ | 降级原因 | "ASAR checksum mismatch" |
| downloadDuration | number | ❌ | 下载耗时(ms) | 5000 |
| installDuration | number | ❌ | 安装耗时(ms) | 2000 |

#### 响应格式

**成功响应**:
```json
{
  "success": true,
  "message": "上报成功"
}
```

**错误响应**:
```json
{
  "success": false,
  "message": "上报失败",
  "error": "Database connection error"
}
```

#### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 上报成功 |
| 500 | 服务器内部错误 |

#### 示例

```bash
# cURL示例 - 热更新成功
curl -X POST "http://localhost:3000/api/hot-update/report" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "device-abc-123",
    "fromVersion": "1.0.132",
    "toVersion": "1.0.133",
    "platform": "darwin",
    "updateType": "hot",
    "success": true,
    "downloadDuration": 5000,
    "installDuration": 2000
  }'

# cURL示例 - 热更新失败降级
curl -X POST "http://localhost:3000/api/hot-update/report" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "device-abc-123",
    "fromVersion": "1.0.132",
    "toVersion": "1.0.133",
    "platform": "darwin",
    "updateType": "hot_fallback",
    "success": false,
    "error": "ASAR extraction failed",
    "fallbackReason": "Checksum verification failed"
  }'
```

---

### 7.3 获取版本元数据 (Get Metadata)

#### 端点
```
GET /api/hot-update/metadata/:version/:platform
```

#### 认证
需要JWT认证（管理端接口）

#### 路径参数

| 参数 | 类型 | 必需 | 说明 | 示例 |
|------|------|------|------|------|
| version | string | ✅ | 版本号 | "1.0.133" |
| platform | string | ✅ | 平台 | "darwin" / "win32" |

#### 响应格式

**成功响应**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "version": "1.0.133",
    "platform": "darwin",
    "electronVersion": "28.0.0",
    "nodeVersion": "18.18.2",
    "chromeVersion": "120.0.6099.56",
    "nativeModulesHash": "abc123def456...",
    "nativeModules": [
      {
        "name": "native-event-monitor.node",
        "path": "node_modules/native-event-monitor/build/Release/native-event-monitor.node",
        "size": 245760,
        "abi": 108
      },
      {
        "name": "better-sqlite3.node",
        "path": "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        "size": 1048576,
        "abi": 108
      }
    ],
    "asarSize": 83886080,
    "asarSha512": "def456ghi789...",
    "createdAt": "2025-12-17T10:00:00.000Z"
  }
}
```

**错误响应 - 未找到**:
```json
{
  "success": false,
  "message": "版本元数据不存在"
}
```

**错误响应 - 未认证**:
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

#### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 401 | 未认证 |
| 404 | 版本不存在 |
| 500 | 服务器内部错误 |

#### 示例

```bash
# cURL示例
curl -X GET "http://localhost:3000/api/hot-update/metadata/1.0.133/darwin" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 7.4 获取差异包统计 (Get Stats)

#### 端点
```
GET /api/hot-update/stats
```

#### 认证
需要JWT认证（管理端接口）

#### 请求参数 (Query String)

| 参数 | 类型 | 必需 | 说明 | 示例 |
|------|------|------|------|------|
| toVersion | string | ❌ | 筛选目标版本 | "1.0.133" |
| platform | string | ❌ | 筛选平台 | "darwin" / "win32" |

#### 响应格式

**成功响应**:
```json
{
  "success": true,
  "data": {
    "totalDownloads": 1250,
    "totalSuccess": 1188,
    "totalFailures": 62,
    "successRate": 95.04,
    "averageDiffSize": 8388608,
    "averageCompressionRatio": 0.08
  }
}
```

**错误响应**:
```json
{
  "success": false,
  "message": "获取统计失败",
  "error": "Database query error"
}
```

#### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 401 | 未认证 |
| 500 | 服务器内部错误 |

#### 示例

```bash
# cURL示例 - 全部统计
curl -X GET "http://localhost:3000/api/hot-update/stats" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# cURL示例 - 筛选特定版本
curl -X GET "http://localhost:3000/api/hot-update/stats?toVersion=1.0.133&platform=darwin" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 7.5 错误码汇总

| 错误码 | HTTP状态码 | 说明 | 解决方案 |
|--------|-----------|------|---------|
| `MISSING_PARAMS` | 400 | 缺少必需参数 | 检查请求参数是否完整 |
| `INVALID_VERSION` | 400 | 版本号格式错误 | 确保版本号符合语义化版本规范 |
| `INVALID_PLATFORM` | 400 | 不支持的平台 | 仅支持 darwin 和 win32 |
| `VERSION_NOT_FOUND` | 404 | 版本不存在 | 确认版本号正确 |
| `METADATA_NOT_FOUND` | 404 | 版本元数据不存在 | 确保版本已上传并提取元数据 |
| `UNAUTHORIZED` | 401 | 未授权访问 | 提供有效的JWT Token |
| `DATABASE_ERROR` | 500 | 数据库错误 | 检查数据库连接和查询 |
| `OSS_ERROR` | 500 | 对象存储错误 | 检查OSS服务状态 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 | 查看服务器日志排查问题 |

---

## 8. 技术决策记录

### 8.1 为什么使用ASAR格式？

**决策**: 使用Electron原生的ASAR格式作为热更新载体

**理由**:
1. **签名兼容**: ASAR可以在不破坏应用签名的情况下替换，保留macOS/Windows系统权限
2. **原生支持**: Electron原生支持ASAR，无需额外解析库，性能最优
3. **透明访问**: 支持透明的文件系统访问，应用代码无需修改
4. **压缩效率**: 内置压缩，减少包体积约30-50%

**替代方案**:
- 直接文件替换：需要重新签名，权限管理复杂
- ZIP压缩包：需要额外解压步骤，性能较差

---

### 8.2 为什么需要三因素兼容性检查？

**决策**: Electron版本 + Node版本 + 原生模块哈希

**理由**:
1. **Electron版本**: 保证V8和Chromium ABI兼容性
2. **Node版本**: 确保C++模块依赖的Node ABI一致
3. **原生模块哈希**: 确保所有.node文件完全一致，避免二进制不兼容

**案例**:
- Electron 27 (Node 16, ABI 93) → Electron 28 (Node 18, ABI 108): 不兼容
- Electron 28.0.0 → Electron 28.0.1 (补丁版本): 兼容

---

### 8.3 为什么异步生成差异包？

**决策**: 首次请求时异步生成，后续请求直接使用

**理由**:
1. **避免超时**: 差异包生成可能需要30-60秒，同步生成会导致API超时
2. **资源复用**: 一次生成，多次使用，服务器资源利用率高
3. **降低峰值压力**: 异步生成可以削峰填谷，避免服务器瞬时压力过大

**流程**:
```
首次请求 → 返回完整包 + 后台异步生成差异包
后续请求 → 直接返回差异包 (已生成完成)
```

---

### 8.4 为什么支持完整更新降级？

**决策**: 热更新失败时自动降级到完整更新

**理由**:
1. **可靠性优先**: 确保用户总能更新到最新版本
2. **故障隔离**: 热更新问题不影响完整更新流程
3. **数据收集**: 失败案例帮助优化热更新逻辑

**降级场景**:
- 版本不兼容（Electron/Node版本变更）
- 差异包校验失败
- ASAR提取失败
- 网络下载失败

---

### 8.5 为什么使用多区域OSS？

**决策**: 中国区(CN) + 海外区(EN) 双区域部署

**理由**:
1. **下载速度**: 就近下载，提升用户体验
2. **容灾备份**: 单区域故障时自动切换
3. **合规要求**: 满足数据本地化要求

**实现**:
- 上传时同步到两个区域
- 下载时优先本地区域，失败后切换到备用区域

---

### 8.6 为什么需要差异包统计？

**决策**: 记录downloadCount, successCount, failureCount

**理由**:
1. **质量监控**: 实时了解差异包质量
2. **问题定位**: 快速发现有问题的差异包
3. **容量规划**: 根据下载量评估服务器和带宽需求
4. **自动清理**: 根据使用频率决定是否归档

**应用**:
- 成功率 < 85% → 自动告警
- 下载量 > 1000 → 优先保留
- 30天无下载 → 自动归档

---

**文档完成时间**: 2025-12-17
**文档版本**: v1.0
**维护人**: Backend Team
**审核人**: Tech Lead