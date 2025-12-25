# ZIP启动上传架构 - 完整实施方案

## 文档版本

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| 2.0 | 2024-12-24 | Claude | 修正版本 - 基于用户核心思想 |

---

## 一、核心设计思想

### 1.1 问题根源

**OSS上传缓慢导致的问题**：
- 单张截图上传OSS耗时较长（网络延迟 + OSS处理时间）
- 客户端启动/重连时，本地可能积压大量持久化数据
- 如果逐条通过WebSocket上传，会阻塞很长时间
- 影响客户端启动速度和用户体验

### 1.2 解决方案设计

**双模式架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                    正常运行模式 (WebSocket)                   │
├─────────────────────────────────────────────────────────────┤
│ WebSocket连接正常 → 实时采集 → 实时发送 → 保证实时性        │
│ - 截图: 每60秒实时发送                                       │
│ - 活动: 每60秒聚合后实时发送                                 │
│ - 进程: 每300秒实时发送                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              启动/重连清理模式 (ZIP批量上传)                  │
├─────────────────────────────────────────────────────────────┤
│ 客户端启动/WebSocket重连时                                   │
│ → 检查本地持久化数据（queue-cache目录）                      │
│ → 如果有积压数据 → ZIP压缩 → HTTP上传 → 异步处理            │
│ 作用: 快速清理积压数据，避免阻塞启动流程                     │
└─────────────────────────────────────────────────────────────┘
```

**关键设计原则**：
- ✅ **实时性优先**: 正常运行时使用WebSocket实时发送
- ✅ **启动优化**: 启动/重连时ZIP批量上传清理积压
- ✅ **数据安全**: /tmp/设备ID 作为持久化缓冲，失败可重试
- ✅ **异步处理**: 后端异步上传OSS，不阻塞客户端

---

## 二、详细流程设计

### 2.1 客户端启动/重连流程

#### 触发时机

1. **客户端首次启动**
2. **WebSocket连接断开后重连成功**
3. **应用从后台恢复到前台**（可选）

#### 完整流程

```typescript
┌──────────────────────────────────────────────────────────────┐
│ 1. 客户端启动 / WebSocket重连成功                            │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. 检查本地持久化目录                                         │
│    - queue-cache/screenshots/                                │
│    - queue-cache/activities/                                 │
│    - queue-cache/processes/                                  │
└──────────────────────────────────────────────────────────────┘
                          ↓
                    【有积压数据？】
                    /            \
                  是              否
                  ↓               ↓
┌──────────────────────────────┐  ┌─────────────────────────┐
│ 3. ZIP压缩                    │  │ 跳过，直接进入正常运行   │
│    - screenshots.zip         │  └─────────────────────────┘
│    - activities.zip          │
│    - processes.zip (可选)    │
└──────────────────────────────┘
                ↓
┌──────────────────────────────┐
│ 4. 删除原始文件               │
│    - 删除 queue-cache/ 下     │
│      所有 JSON 文件           │
│    - 保留 ZIP 文件            │
└──────────────────────────────┘
                ↓
┌──────────────────────────────┐
│ 5. HTTP上传ZIP                │
│    POST /api/startup-upload  │
│    - screenshots.zip         │
│    - activities.zip          │
│    - deviceId, sessionId     │
└──────────────────────────────┘
                ↓
┌──────────────────────────────┐
│ 6. 等待服务器确认             │
│    - 200 OK (成功)           │
│    - 4xx/5xx (失败)          │
└──────────────────────────────┘
                ↓
          【上传成功？】
            /        \
          是          否
          ↓           ↓
┌───────────────┐  ┌──────────────────┐
│ 7. 删除ZIP     │  │ 8. 保留ZIP，下次  │
│    客户端本地  │  │    重连时重试     │
└───────────────┘  └──────────────────┘
          ↓
┌───────────────────────────────┐
│ 9. 进入正常运行模式            │
│    - WebSocket实时发送        │
│    - 保证数据实时性            │
└───────────────────────────────┘
```

### 2.2 后端接收与处理流程

```typescript
┌──────────────────────────────────────────────────────────────┐
│ 1. 接收ZIP文件                                                │
│    POST /api/startup-upload                                  │
│    - multipart/form-data                                     │
│    - screenshots.zip, activities.zip                         │
│    - deviceId, sessionId                                     │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. 保存到持久化缓冲区                                          │
│    /tmp/upload-buffer/{deviceId}/                            │
│    ├── upload_{timestamp}_screenshots.zip                   │
│    └── upload_{timestamp}_activities.zip                    │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. 立即返回成功                                                │
│    HTTP 200 OK                                               │
│    { success: true, uploadId: "..." }                        │
│    ⚠️ 注意: 此时还未上传OSS，仅保存到/tmp                      │
└──────────────────────────────────────────────────────────────┘
                          ↓
                   【客户端删除ZIP】
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. 异步处理（不阻塞响应）                                      │
│    setImmediate(() => processUploadAsync())                  │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. 解压ZIP文件                                                │
│    /tmp/extract/{deviceId}/{timestamp}/                     │
│    ├── screenshots/                                          │
│    │   ├── screenshot_1.json                                 │
│    │   └── screenshot_2.json                                 │
│    └── activities/                                           │
│        ├── activity_1.json                                   │
│        └── activity_2.json                                   │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 6. 并发处理（PQueue, concurrency: 10）                        │
│                                                              │
│ 截图处理:                                                     │
│  ├─ 读取 screenshot_1.json                                   │
│  ├─ 检查数据库是否存在（唯一索引）                             │
│  ├─ 如果存在 → 跳过                                          │
│  ├─ 如果不存在 → 插入数据库（先写DB）                         │
│  ├─ 上传图片到OSS (30秒超时)                                 │
│  ├─ 更新数据库 oss_url 字段                                  │
│  └─ 成功 → 删除 screenshot_1.json                            │
│                                                              │
│ 活动处理:                                                     │
│  ├─ 读取 activity_1.json                                     │
│  ├─ 检查数据库是否存在（唯一索引）                             │
│  ├─ 如果存在 → 跳过                                          │
│  ├─ 如果不存在 → 插入数据库                                  │
│  └─ 成功 → 删除 activity_1.json                              │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 7. 处理结果统计                                                │
│    - 成功: N 条                                               │
│    - 跳过（重复）: M 条                                       │
│    - 失败: K 条                                               │
└──────────────────────────────────────────────────────────────┘
                          ↓
                   【全部成功？】
                    /          \
                  是            否
                  ↓             ↓
┌─────────────────────┐  ┌───────────────────────┐
│ 8. 清理               │  │ 9. 保留失败数据        │
│    - 删除ZIP          │  │    - 保留ZIP           │
│    - 删除解压目录     │  │    - 保留失败的JSON    │
│                      │  │    - 下次重试          │
└─────────────────────┘  └───────────────────────┘
```

### 2.3 数据库幂等性设计

#### 截图表唯一索引

```sql
-- screenshots 表
ALTER TABLE screenshots
ADD UNIQUE INDEX idx_screenshot_unique (
  created_at,   -- 客户端生成时间（可以等于timestamp）
  timestamp,    -- 截图时间戳
  device_id,    -- 设备ID
  session_id    -- 会话ID
);
```

**插入逻辑**（先写数据库，后上传OSS）：
```typescript
// 1. 先插入数据库（幂等性检查）
await db.query(`
  INSERT INTO screenshots
    (screenshot_id, device_id, session_id, created_at, timestamp, oss_url, file_size)
  VALUES (?, ?, ?, ?, ?, '', ?)
  ON DUPLICATE KEY UPDATE screenshot_id = screenshot_id
`, [screenshotId, deviceId, sessionId, createdAt, timestamp, fileSize]);

// 2. 检查是否是新记录
const result = await db.query(`
  SELECT oss_url FROM screenshots WHERE screenshot_id = ?
`, [screenshotId]);

if (result[0]?.oss_url) {
  // 已经上传过OSS，跳过
  return { success: true, skipped: true };
}

// 3. 上传到OSS
const ossUrl = await ossClient.put(
  `screenshots/${deviceId}/${screenshotId}.jpg`,
  buffer,
  { timeout: 30000 }
);

// 4. 更新OSS地址
await db.query(`
  UPDATE screenshots SET oss_url = ? WHERE screenshot_id = ?
`, [ossUrl.url, screenshotId]);
```

**为什么先写数据库？**
- 避免竞态条件：两个请求同时查库为空，都上传OSS
- 数据库唯一索引保证幂等性
- OSS上传失败可以重试，数据库已有记录

#### 活动表唯一索引

```sql
-- activity_records 表
ALTER TABLE activity_records
ADD UNIQUE INDEX idx_activity_unique (
  timestamp,    -- 活动时间戳（60秒聚合周期结束时间）
  session_id    -- 会话ID
);
```

**为什么这个索引安全？**
- 活动数据是 **60秒聚合** 后产生 **1条记录**
- timestamp 是聚合周期的结束时间（如 10:00:00, 10:01:00, 10:02:00）
- 不存在"同一毫秒多条记录"的情况
- sessionId 确保不同会话数据隔离

**数据示例**：
```json
{
  "id": "activity_1766566510856",
  "timestamp": 1766566510856,  // 60秒周期结束时间
  "data": {
    "keystrokes": 116,        // 60秒累加
    "mouseClicks": 100,       // 60秒累加
    "mouseScrolls": 100,      // 60秒累加
    "activeWindow": "Chrome", // 最后值
    "url": "http://..."       // 最后值
  }
}
```

**插入逻辑**：
```typescript
await db.query(`
  INSERT INTO activity_records
    (activity_id, device_id, session_id, timestamp, keystrokes, mouse_clicks, mouse_scrolls, active_window, url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE activity_id = activity_id
`, [activityId, deviceId, sessionId, timestamp, keystrokes, mouseClicks, mouseScrolls, activeWindow, url]);
```

---

## 三、客户端实现

### 3.1 StartupUploadService（新增）

```typescript
// src/common/services/startup-upload-service.ts
import * as fs from 'fs-extra';
import * as path from 'path';
import archiver from 'archiver';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils';

interface StartupUploadConfig {
  apiEndpoint: string;      // 上传接口地址
  deviceId: string;         // 设备ID
  sessionId: string;        // 会话ID
  queueCacheDir: string;    // 队列缓存目录
}

export class StartupUploadService {
  private config: StartupUploadConfig;

  constructor(config: StartupUploadConfig) {
    this.config = config;
  }

  /**
   * 主入口：检查并上传积压数据
   * 在客户端启动/WebSocket重连时调用
   */
  async checkAndUpload(): Promise<void> {
    try {
      logger.info('[STARTUP_UPLOAD] 开始检查本地积压数据...');

      // 1. 检查是否有积压数据
      const hasData = await this.hasBacklogData();
      if (!hasData) {
        logger.info('[STARTUP_UPLOAD] 无积压数据，跳过上传');
        return;
      }

      logger.info('[STARTUP_UPLOAD] 发现积压数据，开始处理...');

      // 2. 压缩截图数据
      const screenshotZip = await this.compressScreenshots();

      // 3. 压缩活动数据
      const activityZip = await this.compressActivities();

      // 4. 删除原始文件（压缩成功后）
      await this.deleteOriginalFiles();

      // 5. 上传ZIP文件
      const uploadSuccess = await this.uploadZipFiles({
        screenshotZip,
        activityZip
      });

      // 6. 清理
      if (uploadSuccess) {
        await this.cleanupZipFiles([screenshotZip, activityZip]);
        logger.info('[STARTUP_UPLOAD] ✅ 积压数据上传成功');
      } else {
        logger.error('[STARTUP_UPLOAD] ❌ 上传失败，ZIP文件已保留，下次重连时重试');
      }

    } catch (error) {
      logger.error('[STARTUP_UPLOAD] 处理失败:', error);
      throw error;
    }
  }

  /**
   * 检查是否有积压数据
   */
  private async hasBacklogData(): Promise<boolean> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');

    const screenshots = await fs.readdir(screenshotsDir).catch(() => []);
    const activities = await fs.readdir(activitiesDir).catch(() => []);

    // 过滤掉ZIP文件，只统计JSON文件
    const screenshotJsons = screenshots.filter(f => f.endsWith('.json'));
    const activityJsons = activities.filter(f => f.endsWith('.json'));

    logger.info('[STARTUP_UPLOAD] 积压数据统计:', {
      screenshots: screenshotJsons.length,
      activities: activityJsons.length
    });

    return screenshotJsons.length > 0 || activityJsons.length > 0;
  }

  /**
   * 压缩截图数据
   */
  private async compressScreenshots(): Promise<string | null> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');
    const files = await fs.readdir(screenshotsDir).catch(() => []);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无截图数据需要压缩');
      return null;
    }

    const zipPath = path.join(
      this.config.queueCacheDir,
      `screenshots_${Date.now()}.zip`
    );

    await this.createZip(screenshotsDir, jsonFiles, zipPath);

    logger.info('[STARTUP_UPLOAD] 截图数据压缩完成:', {
      files: jsonFiles.length,
      zipPath
    });

    return zipPath;
  }

  /**
   * 压缩活动数据
   */
  private async compressActivities(): Promise<string | null> {
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');
    const files = await fs.readdir(activitiesDir).catch(() => []);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无活动数据需要压缩');
      return null;
    }

    const zipPath = path.join(
      this.config.queueCacheDir,
      `activities_${Date.now()}.zip`
    );

    await this.createZip(activitiesDir, jsonFiles, zipPath);

    logger.info('[STARTUP_UPLOAD] 活动数据压缩完成:', {
      files: jsonFiles.length,
      zipPath
    });

    return zipPath;
  }

  /**
   * 创建ZIP文件
   */
  private async createZip(
    sourceDir: string,
    files: string[],
    zipPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', {
        zlib: { level: 6 }  // 压缩级别 6（平衡速度和压缩率）
      });

      output.on('close', () => resolve());
      archive.on('error', reject);

      archive.pipe(output);

      // 添加所有JSON文件到ZIP
      files.forEach(file => {
        archive.file(path.join(sourceDir, file), { name: file });
      });

      archive.finalize();
    });
  }

  /**
   * 删除原始JSON文件
   */
  private async deleteOriginalFiles(): Promise<void> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');

    // 删除截图JSON文件
    const screenshotFiles = await fs.readdir(screenshotsDir).catch(() => []);
    for (const file of screenshotFiles) {
      if (file.endsWith('.json')) {
        await fs.remove(path.join(screenshotsDir, file));
      }
    }

    // 删除活动JSON文件
    const activityFiles = await fs.readdir(activitiesDir).catch(() => []);
    for (const file of activityFiles) {
      if (file.endsWith('.json')) {
        await fs.remove(path.join(activitiesDir, file));
      }
    }

    logger.info('[STARTUP_UPLOAD] 原始JSON文件已删除');
  }

  /**
   * 上传ZIP文件
   */
  private async uploadZipFiles(zipFiles: {
    screenshotZip: string | null;
    activityZip: string | null;
  }): Promise<boolean> {
    const { screenshotZip, activityZip } = zipFiles;

    if (!screenshotZip && !activityZip) {
      logger.info('[STARTUP_UPLOAD] 无ZIP文件需要上传');
      return true;
    }

    try {
      const formData = new FormData();

      // 添加设备和会话信息
      formData.append('deviceId', this.config.deviceId);
      formData.append('sessionId', this.config.sessionId);
      formData.append('uploadId', uuidv4());

      // 添加ZIP文件
      if (screenshotZip) {
        formData.append('screenshotZip', fs.createReadStream(screenshotZip));
      }
      if (activityZip) {
        formData.append('activityZip', fs.createReadStream(activityZip));
      }

      // 上传
      const response = await axios.post(
        this.config.apiEndpoint,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 120000,  // 2分钟超时
          maxContentLength: 500 * 1024 * 1024,  // 500MB
          maxBodyLength: 500 * 1024 * 1024
        }
      );

      if (response.status === 200 && response.data.success) {
        logger.info('[STARTUP_UPLOAD] 上传成功:', response.data);
        return true;
      }

      logger.error('[STARTUP_UPLOAD] 上传失败:', response.data);
      return false;

    } catch (error) {
      logger.error('[STARTUP_UPLOAD] 上传异常:', error.message);
      return false;
    }
  }

  /**
   * 清理ZIP文件
   */
  private async cleanupZipFiles(zipPaths: (string | null)[]): Promise<void> {
    for (const zipPath of zipPaths) {
      if (zipPath) {
        await fs.remove(zipPath).catch(err => {
          logger.warn('[STARTUP_UPLOAD] 删除ZIP文件失败:', err);
        });
      }
    }
  }
}
```

### 3.2 集成到FSM状态处理器

```typescript
// src/common/services/fsm/state-handlers/ws-check-state-handler.ts

import { StartupUploadService } from '../../startup-upload-service';

export class WsCheckStateHandler {
  private startupUploadService: StartupUploadService | null = null;

  async onEnter(context: DeviceContext): Promise<void> {
    try {
      // WebSocket连接检查
      const wsConnected = await this.checkWebSocketConnection();

      if (wsConnected) {
        logger.info('[WS_CHECK] WebSocket连接正常');

        // ✅ WebSocket重连成功，检查并上传积压数据
        await this.uploadBacklogData(context);

        // 进入数据采集状态
        await this.transitionTo('DATA_COLLECT', context);
      } else {
        // WebSocket未连接，进入断网状态
        await this.transitionTo('DISCONNECT', context);
      }
    } catch (error) {
      logger.error('[WS_CHECK] 状态处理失败:', error);
      await this.transitionTo('DISCONNECT', context);
    }
  }

  /**
   * 上传积压数据
   */
  private async uploadBacklogData(context: DeviceContext): Promise<void> {
    try {
      logger.info('[WS_CHECK] 检查本地积压数据...');

      const config = this.configService.getConfig();
      const queueCacheDir = path.join(
        process.env.HOME || '',
        'Library/Application Support/employee-safety-client/queue-cache'
      );

      this.startupUploadService = new StartupUploadService({
        apiEndpoint: `${config.apiBaseUrl}/api/startup-upload`,
        deviceId: config.deviceId,
        sessionId: context.sessionId,
        queueCacheDir
      });

      // 执行上传（非阻塞）
      await this.startupUploadService.checkAndUpload();

      logger.info('[WS_CHECK] 积压数据处理完成');

    } catch (error) {
      // 上传失败不影响主流程
      logger.error('[WS_CHECK] 积压数据上传失败:', error);
    }
  }
}
```

---

## 四、后端实现

### 4.1 StartupUploadController

```typescript
// api-server/src/controllers/startup-upload.controller.ts
import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs-extra';
import * as path from 'path';
import { StartupUploadService } from '../services/startup-upload.service';
import { logger } from '../utils/logger';

const router = Router();

// 配置multer存储
const upload = multer({
  dest: '/tmp/upload-temp',
  limits: {
    fileSize: 500 * 1024 * 1024  // 500MB
  }
});

const startupUploadService = new StartupUploadService();

/**
 * 启动上传接口
 * 客户端启动/重连时上传积压数据
 */
router.post(
  '/startup-upload',
  upload.fields([
    { name: 'screenshotZip', maxCount: 1 },
    { name: 'activityZip', maxCount: 1 }
  ]),
  async (req: Request, res: Response) => {
    try {
      const { deviceId, sessionId, uploadId } = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      logger.info('[STARTUP_UPLOAD] 接收到上传请求:', {
        deviceId,
        sessionId,
        uploadId,
        files: Object.keys(files)
      });

      // 1. 验证参数
      if (!deviceId || !sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Missing deviceId or sessionId'
        });
      }

      // 2. 创建设备缓冲目录
      const bufferDir = `/tmp/upload-buffer/${deviceId}`;
      await fs.ensureDir(bufferDir);

      // 3. 移动ZIP文件到缓冲目录
      const savedFiles: string[] = [];

      if (files.screenshotZip && files.screenshotZip[0]) {
        const screenshotZipPath = path.join(
          bufferDir,
          `screenshots_${uploadId}_${Date.now()}.zip`
        );
        await fs.move(files.screenshotZip[0].path, screenshotZipPath);
        savedFiles.push(screenshotZipPath);
        logger.info('[STARTUP_UPLOAD] 截图ZIP已保存:', screenshotZipPath);
      }

      if (files.activityZip && files.activityZip[0]) {
        const activityZipPath = path.join(
          bufferDir,
          `activities_${uploadId}_${Date.now()}.zip`
        );
        await fs.move(files.activityZip[0].path, activityZipPath);
        savedFiles.push(activityZipPath);
        logger.info('[STARTUP_UPLOAD] 活动ZIP已保存:', activityZipPath);
      }

      // 4. 立即返回成功（不等待处理完成）
      res.status(200).json({
        success: true,
        uploadId,
        message: 'Files received and queued for processing'
      });

      // 5. 异步处理（不阻塞响应）
      setImmediate(() => {
        startupUploadService.processUploadAsync({
          deviceId,
          sessionId,
          uploadId,
          zipFiles: savedFiles
        }).catch(error => {
          logger.error('[STARTUP_UPLOAD] 异步处理失败:', error);
        });
      });

    } catch (error) {
      logger.error('[STARTUP_UPLOAD] 接收失败:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

export default router;
```

### 4.2 StartupUploadService

```typescript
// api-server/src/services/startup-upload.service.ts
import * as fs from 'fs-extra';
import * as path from 'path';
import extract from 'extract-zip';
import PQueue from 'p-queue';
import { logger } from '../utils/logger';
import { ScreenshotService } from './screenshot.service';
import { ActivityService } from './activity.service';

interface ProcessOptions {
  deviceId: string;
  sessionId: string;
  uploadId: string;
  zipFiles: string[];
}

export class StartupUploadService {
  private screenshotService: ScreenshotService;
  private activityService: ActivityService;

  constructor() {
    this.screenshotService = new ScreenshotService();
    this.activityService = new ActivityService();
  }

  /**
   * 异步处理上传的ZIP文件
   */
  async processUploadAsync(options: ProcessOptions): Promise<void> {
    const { deviceId, sessionId, uploadId, zipFiles } = options;

    logger.info('[STARTUP_UPLOAD] 开始异步处理:', {
      deviceId,
      uploadId,
      fileCount: zipFiles.length
    });

    const extractBaseDir = `/tmp/extract/${deviceId}/${uploadId}`;

    try {
      // 1. 解压所有ZIP文件
      for (const zipPath of zipFiles) {
        const zipName = path.basename(zipPath, '.zip');
        const extractDir = path.join(extractBaseDir, zipName);

        logger.info('[STARTUP_UPLOAD] 解压ZIP:', { zipPath, extractDir });
        await extract(zipPath, { dir: extractDir });
      }

      // 2. 并发处理（最大并发数: 10）
      const queue = new PQueue({ concurrency: 10 });

      // 2.1 处理截图
      const screenshotDir = path.join(extractBaseDir, 'screenshots_*');
      const screenshotResults = await this.processScreenshots(
        screenshotDir,
        deviceId,
        sessionId,
        queue
      );

      // 2.2 处理活动
      const activityDir = path.join(extractBaseDir, 'activities_*');
      const activityResults = await this.processActivities(
        activityDir,
        deviceId,
        sessionId,
        queue
      );

      // 3. 统计结果
      logger.info('[STARTUP_UPLOAD] 处理完成:', {
        uploadId,
        screenshots: screenshotResults,
        activities: activityResults
      });

      // 4. 清理
      const allSuccess =
        screenshotResults.failed === 0 &&
        activityResults.failed === 0;

      if (allSuccess) {
        // 全部成功，删除ZIP和解压目录
        for (const zipPath of zipFiles) {
          await fs.remove(zipPath);
        }
        await fs.remove(extractBaseDir);
        logger.info('[STARTUP_UPLOAD] 清理完成，ZIP和临时文件已删除');
      } else {
        // 有失败，保留文件以便重试
        logger.warn('[STARTUP_UPLOAD] 存在失败记录，保留文件以便重试');
      }

    } catch (error) {
      logger.error('[STARTUP_UPLOAD] 处理失败:', error);
      // 保留文件以便重试
    }
  }

  /**
   * 处理截图数据
   */
  private async processScreenshots(
    screenshotDirPattern: string,
    deviceId: string,
    sessionId: string,
    queue: PQueue
  ): Promise<{ total: number; success: number; failed: number }> {
    const result = { total: 0, success: 0, failed: 0 };

    // 查找所有符合模式的目录
    const dirs = await this.findDirs(screenshotDirPattern);

    for (const dir of dirs) {
      const files = await fs.readdir(dir).catch(() => []);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      result.total += jsonFiles.length;

      const results = await Promise.allSettled(
        jsonFiles.map(file =>
          queue.add(() =>
            this.screenshotService.processScreenshot(
              deviceId,
              sessionId,
              path.join(dir, file)
            )
          )
        )
      );

      results.forEach(r => {
        if (r.status === 'fulfilled') {
          result.success++;
        } else {
          result.failed++;
        }
      });
    }

    return result;
  }

  /**
   * 处理活动数据
   */
  private async processActivities(
    activityDirPattern: string,
    deviceId: string,
    sessionId: string,
    queue: PQueue
  ): Promise<{ total: number; success: number; failed: number }> {
    const result = { total: 0, success: 0, failed: 0 };

    const dirs = await this.findDirs(activityDirPattern);

    for (const dir of dirs) {
      const files = await fs.readdir(dir).catch(() => []);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      result.total += jsonFiles.length;

      const results = await Promise.allSettled(
        jsonFiles.map(file =>
          queue.add(() =>
            this.activityService.processActivity(
              deviceId,
              sessionId,
              path.join(dir, file)
            )
          )
        )
      );

      results.forEach(r => {
        if (r.status === 'fulfilled') {
          result.success++;
        } else {
          result.failed++;
        }
      });
    }

    return result;
  }

  /**
   * 查找匹配模式的目录
   */
  private async findDirs(pattern: string): Promise<string[]> {
    // 简单实现：假设只有一个目录匹配
    const baseDir = path.dirname(pattern);
    const patternName = path.basename(pattern);

    if (!await fs.pathExists(baseDir)) {
      return [];
    }

    const items = await fs.readdir(baseDir);
    const dirs: string[] = [];

    for (const item of items) {
      const fullPath = path.join(baseDir, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory() && item.startsWith(patternName.replace('*', ''))) {
        dirs.push(fullPath);
      }
    }

    return dirs;
  }
}
```

### 4.3 ScreenshotService（幂等性实现）

```typescript
// api-server/src/services/screenshot.service.ts
import * as fs from 'fs-extra';
import { DatabaseService } from './database.service';
import { OSSService } from './oss.service';
import { logger } from '../utils/logger';

export class ScreenshotService {
  private db: DatabaseService;
  private oss: OSSService;

  constructor() {
    this.db = new DatabaseService();
    this.oss = new OSSService({
      timeout: 30000  // 30秒超时
    });
  }

  /**
   * 处理单个截图文件
   * 实现幂等性：先写数据库，后上传OSS
   */
  async processScreenshot(
    deviceId: string,
    sessionId: string,
    filePath: string
  ): Promise<void> {
    const data = await fs.readJson(filePath);
    const {
      id: screenshotId,
      timestamp,
      buffer,
      fileSize,
      _metadata
    } = data;

    const createdAt = _metadata?.createdAt || timestamp;

    try {
      // 1. 先写数据库（幂等性检查）
      const insertResult = await this.db.query(`
        INSERT INTO screenshots
          (screenshot_id, device_id, session_id, created_at, timestamp, oss_url, file_size)
        VALUES (?, ?, ?, ?, ?, '', ?)
        ON DUPLICATE KEY UPDATE screenshot_id = screenshot_id
      `, [screenshotId, deviceId, sessionId, createdAt, timestamp, fileSize]);

      // 2. 检查是否是新记录
      const existing = await this.db.query(`
        SELECT oss_url FROM screenshots
        WHERE created_at = ? AND timestamp = ? AND device_id = ? AND session_id = ?
      `, [createdAt, timestamp, deviceId, sessionId]);

      if (existing[0]?.oss_url) {
        // 已经上传过OSS，跳过
        logger.info('[SCREENSHOT] 跳过重复截图:', { screenshotId });
        return;
      }

      // 3. 上传到OSS
      const ossUrl = await this.oss.uploadScreenshot(
        `screenshots/${deviceId}/${screenshotId}.jpg`,
        Buffer.from(buffer, 'base64')
      );

      // 4. 更新OSS地址
      await this.db.query(`
        UPDATE screenshots SET oss_url = ?
        WHERE screenshot_id = ?
      `, [ossUrl, screenshotId]);

      logger.info('[SCREENSHOT] 处理成功:', { screenshotId, ossUrl });

    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        logger.info('[SCREENSHOT] 重复记录（幂等性保护）:', { screenshotId });
        return;
      }
      throw error;
    }
  }
}
```

### 4.4 ActivityService（幂等性实现）

```typescript
// api-server/src/services/activity.service.ts
import * as fs from 'fs-extra';
import { DatabaseService } from './database.service';
import { logger } from '../utils/logger';

export class ActivityService {
  private db: DatabaseService;

  constructor() {
    this.db = new DatabaseService();
  }

  /**
   * 处理单个活动记录
   * 实现幂等性：timestamp + sessionId 唯一索引
   */
  async processActivity(
    deviceId: string,
    sessionId: string,
    filePath: string
  ): Promise<void> {
    const data = await fs.readJson(filePath);
    const {
      id: activityId,
      timestamp,
      data: activityData
    } = data;

    try {
      await this.db.query(`
        INSERT INTO activity_records
          (activity_id, device_id, session_id, timestamp, keystrokes, mouse_clicks, mouse_scrolls, active_window, url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE activity_id = activity_id
      `, [
        activityId,
        deviceId,
        sessionId,
        timestamp,
        activityData.keystrokes,
        activityData.mouseClicks,
        activityData.mouseScrolls,
        activityData.activeWindow,
        activityData.url
      ]);

      logger.info('[ACTIVITY] 处理成功:', { activityId });

    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        logger.info('[ACTIVITY] 重复记录（幂等性保护）:', { activityId });
        return;
      }
      throw error;
    }
  }
}
```

---

## 五、数据库Schema

```sql
-- 1. 截图表唯一索引
ALTER TABLE screenshots
ADD UNIQUE INDEX idx_screenshot_unique (
  created_at,   -- 客户端生成时间（可以等于timestamp）
  timestamp,    -- 截图时间戳
  device_id,    -- 设备ID
  session_id    -- 会话ID
);

-- 2. 活动表唯一索引
ALTER TABLE activity_records
ADD UNIQUE INDEX idx_activity_unique (
  timestamp,    -- 活动时间戳（60秒聚合周期结束时间）
  session_id    -- 会话ID
);

-- 3. 调整OSS超时时间（代码层面）
-- OSSService 构造函数中设置 timeout: 30000（30秒）
```

---

## 六、实施计划

### 6.1 阶段一：后端基础设施（1-2周）

**任务清单**:
1. ✅ 数据库Schema改造
   - 添加唯一索引
   - 数据验证脚本

2. ✅ StartupUploadController开发
   - 接收ZIP文件
   - 保存到/tmp/upload-buffer

3. ✅ StartupUploadService开发
   - 异步解压和处理
   - 并发上传OSS（PQueue, concurrency: 10）
   - 幂等性实现

4. ✅ OSSService超时调整
   - 从5秒增加到30秒

5. ✅ 测试和验证
   - 单元测试
   - 集成测试

### 6.2 阶段二：客户端实现（1-2周）

**任务清单**:
1. ✅ StartupUploadService开发
   - 检查积压数据
   - ZIP压缩
   - HTTP上传

2. ✅ 集成到FSM
   - WS_CHECK状态调用
   - 启动流程优化

3. ✅ 错误处理
   - 上传失败保留ZIP
   - 下次重连重试

4. ✅ 测试
   - 模拟积压数据
   - 上传成功/失败场景

### 6.3 阶段三：灰度发布（1周）

**策略**:
- Day 1-2: 10台设备（1%）
- Day 3-4: 100台设备（10%）
- Day 5-7: 全量发布（100%）

**监控指标**:
- 上传成功率 >99%
- 数据重复率 <0.1%
- 平均处理时间 <60秒

---

## 七、关键差异对比

| 维度 | 之前理解（错误） | 用户实际设计（正确） |
|------|----------------|---------------------|
| **ZIP上传时机** | 定时上传（每5分钟） | 仅启动/重连时上传积压数据 |
| **正常运行模式** | 全部使用ZIP上传 | WebSocket实时发送（保证实时性） |
| **活动数据频率** | 每次点击产生记录 | 60秒聚合产生1条记录 |
| **唯一索引冲突** | 高频冲突，数据丢失 | 无冲突（聚合数据，低频） |
| **created_at字段** | 后端数据库生成 | 客户端生成（可等于timestamp） |
| **后端数据安全** | 异步处理可能丢失 | /tmp缓冲，失败可重试 |
| **上传流程** | 先删除后确认 | 压缩→上传→确认→删除 |

---

## 八、性能预期

### 启动/重连场景

**积压数据**: 200张截图 + 100条活动

| 阶段 | 旧方案（WebSocket逐条） | 新方案（ZIP批量） |
|------|----------------------|------------------|
| **压缩** | - | 5秒 |
| **上传** | 3000秒（逐条发送） | 10秒（单次HTTP） |
| **后端处理** | 同步阻塞3000秒 | 异步60秒（不阻塞客户端） |
| **客户端阻塞时间** | 3000秒 | 15秒 |
| **性能提升** | - | **200倍** |

### 正常运行场景

**无变化**：仍使用WebSocket实时发送，保证数据实时性。

---

## 九、总结

### 核心优势

✅ **启动速度提升**: 积压数据快速清理，客户端启动不阻塞
✅ **实时性保证**: 正常运行时WebSocket实时发送
✅ **数据安全**: /tmp缓冲 + 幂等性设计 + 重试机制
✅ **后端并发**: 异步处理 + PQueue并发上传OSS
✅ **数据库唯一索引**: 防止重复数据，聚合数据低频无冲突

### 适用场景

1. **客户端首次启动**: 清理本地持久化数据
2. **WebSocket重连**: 清理断网期间积压数据
3. **应用后台恢复**: 清理后台运行时积压数据

### 不适用场景

1. **正常运行时**: 继续使用WebSocket实时发送
2. **小量数据**: 积压数据<10条时，WebSocket更高效

---

**建议**: 立即启动实施，预计4周内完成全量发布。
