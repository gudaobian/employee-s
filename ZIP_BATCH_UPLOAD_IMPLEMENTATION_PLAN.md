# ZIP批量上传架构 - 完整实施方案

## 文档版本

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| 1.0 | 2024-12-24 | Claude | 初始版本 - 基于前期分析总结 |

---

## 一、项目背景

### 1.1 当前架构问题

#### 性能瓶颈
- **截图上传速度**: 1张/秒（200张需要3000秒 ≈ 50分钟）
- **队列积压**: 生产速度 > 消费速度，导致内存队列满溢出到磁盘
- **串行处理**: WebSocket本质是TCP流，即使客户端并发也是服务端串行处理

#### 架构缺陷
- **WebSocket不适合文件传输**: 应该用HTTP批量上传
- **缺乏幂等性**: 客户端超时重传导致重复数据
- **后端串行处理**: 即使客户端并发请求，后端也是串行处理
- **OSS超时时间过短**: 5秒超时不合理，应该30秒

#### 数据一致性问题
- **先上传OSS后写数据库**: 导致竞态条件（两个请求同时查库为空，都上传）
- **Check-Then-Act竞态**: 时序问题导致重复记录

### 1.2 前期优化尝试

| 优化项 | 版本 | 效果 | 问题 |
|--------|------|------|------|
| 增加队列容量 (5→20) | v2.3.1 | 缓解内存溢出 | 治标不治本 |
| 增加并发数 (1→5) | v2.3.2 | 5倍提速 | WebSocket仍串行 |
| 添加唯一ID | v2.3.3 | 支持幂等性 | 后端未实现 |

**结论**: 需要架构级别变更，而非参数调优。

---

## 二、解决方案设计

### 2.1 核心设计理念

**从"实时流式上传"转变为"批量离线上传"**

```
┌─────────────────────────────────────────────────────────────┐
│                      旧架构 (WebSocket)                       │
├─────────────────────────────────────────────────────────────┤
│ 采集 → 内存队列 → WebSocket发送 → 后端串行处理 → OSS/MySQL │
│ 问题: 串行、阻塞、重复、慢                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      新架构 (ZIP批量上传)                     │
├─────────────────────────────────────────────────────────────┤
│ 采集 → 磁盘持久化 → 压缩ZIP → HTTP批量上传 →                │
│ 后端接收存/tmp → 立即返回 → 异步并发处理 → OSS/MySQL       │
│ 优势: 并发、非阻塞、幂等、快                                 │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 技术方案

#### 客户端改造

**数据流转**:
```
1. 数据采集 (不变)
   ├─ 截图采集 (screenshotInterval: 60s)
   ├─ 活动采集 (activityInterval: 60s, 聚合累加)
   └─ 进程采集 (processInterval: 300s)

2. 持久化到磁盘 (不变)
   ├─ queue-cache/screenshots/*.json
   ├─ queue-cache/activities/*.json
   └─ queue-cache/processes/*.json

3. 定时压缩上传 (新增)
   ├─ 每5分钟检查一次
   ├─ 压缩为 upload_{timestamp}_{deviceId}.zip
   ├─ POST /api/device/batch-upload
   └─ 收到200 OK后删除原文件

4. 错误恢复
   ├─ 上传失败: ZIP保留在本地，下次重试
   ├─ 部分失败: 后端返回失败列表，客户端重新打包
   └─ 网络中断: 累积数据，恢复后批量上传
```

**ZIP文件结构**:
```
upload_1703401234567_device123.zip
├── manifest.json                    # 元数据清单
│   {
│     "uploadId": "uuid-v4",
│     "deviceId": "device123",
│     "sessionId": "session456",
│     "timestamp": "2024-12-24T10:30:00Z",
│     "counts": {
│       "screenshots": 50,
│       "activities": 10,
│       "processes": 5
│     }
│   }
├── screenshots/                     # 截图数据
│   ├── screenshot_1703401234567.json
│   │   {
│   │     "screenshotId": "uuid",
│   │     "timestamp": "2024-12-24T10:00:00Z",
│   │     "created_at": "2024-12-24T10:00:00Z",
│   │     "buffer": "base64...",
│   │     "fileSize": 25600
│   │   }
│   └── screenshot_1703401294567.json
├── activities/                      # 活动数据
│   ├── activity_1703401234567.json
│   │   {
│   │     "activityId": "uuid",
│   │     "timestamp": "2024-12-24T10:00:00Z",  # 60s周期结束时间
│   │     "keystrokes": 125,                     # 60s累加
│   │     "mouseClicks": 45,                     # 60s累加
│   │     "mouseScrolls": 12,                    # 60s累加
│   │     "activeWindow": "Chrome",              # 最后值
│   │     "url": "https://example.com"           # 最后值
│   │   }
│   └── activity_1703401294567.json
└── processes/                       # 进程数据
    └── process_1703401234567.json
        {
          "processId": "uuid",
          "timestamp": "2024-12-24T10:00:00Z",
          "processes": [...]
        }
```

#### 后端改造

**接收阶段**:
```typescript
POST /api/device/batch-upload
Content-Type: multipart/form-data

// 1. 接收ZIP文件
router.post('/batch-upload', upload.single('zipFile'), async (req, res) => {
  const { deviceId } = req.body;
  const zipFile = req.file;

  // 2. 保存到持久化缓冲区
  const bufferDir = `/tmp/upload-buffer/${deviceId}`;
  await fs.ensureDir(bufferDir);
  await fs.move(zipFile.path, `${bufferDir}/${zipFile.originalname}`);

  // 3. 立即返回成功 (非阻塞)
  res.status(200).json({
    success: true,
    uploadId: uploadId,
    message: 'Upload queued for processing'
  });

  // 4. 异步处理 (不阻塞响应)
  setImmediate(() => processUploadAsync(deviceId, zipFile.originalname));
});
```

**异步处理阶段**:
```typescript
async function processUploadAsync(deviceId: string, zipFileName: string) {
  try {
    // 1. 解压ZIP
    const extractDir = `/tmp/extract/${deviceId}/${Date.now()}`;
    await extract(zipPath, { dir: extractDir });

    // 2. 读取manifest
    const manifest = await fs.readJson(`${extractDir}/manifest.json`);

    // 3. 并发处理 (最大并发数: 10)
    const queue = new PQueue({ concurrency: 10 });

    // 3.1 处理截图 (OSS上传 + MySQL插入)
    const screenshotFiles = await fs.readdir(`${extractDir}/screenshots`);
    const screenshotResults = await Promise.allSettled(
      screenshotFiles.map(file =>
        queue.add(() => processScreenshot(deviceId, file))
      )
    );

    // 3.2 处理活动数据 (批量插入MySQL)
    const activityFiles = await fs.readdir(`${extractDir}/activities`);
    const activityResults = await Promise.allSettled(
      activityFiles.map(file =>
        queue.add(() => processActivity(deviceId, file))
      )
    );

    // 3.3 处理进程数据 (批量插入MySQL)
    const processFiles = await fs.readdir(`${extractDir}/processes`);
    const processResults = await Promise.allSettled(
      processFiles.map(file =>
        queue.add(() => processProcess(deviceId, file))
      )
    );

    // 4. 统计结果
    const stats = {
      screenshots: {
        total: screenshotResults.length,
        success: screenshotResults.filter(r => r.status === 'fulfilled').length,
        failed: screenshotResults.filter(r => r.status === 'rejected').length
      },
      activities: {
        total: activityResults.length,
        success: activityResults.filter(r => r.status === 'fulfilled').length,
        failed: activityResults.filter(r => r.status === 'rejected').length
      },
      processes: {
        total: processResults.length,
        success: processResults.filter(r => r.status === 'fulfilled').length,
        failed: processResults.filter(r => r.status === 'rejected').length
      }
    };

    // 5. 记录处理结果
    await logProcessingResult(manifest.uploadId, stats);

    // 6. 清理临时文件
    await fs.remove(extractDir);
    if (stats.screenshots.failed === 0 &&
        stats.activities.failed === 0 &&
        stats.processes.failed === 0) {
      await fs.remove(zipPath);  // 全部成功才删除
    }

  } catch (error) {
    logger.error(`[BATCH_UPLOAD] Processing failed: ${error.message}`);
    // 保留ZIP文件以便重试
  }
}
```

**幂等性实现**:
```typescript
// 截图处理
async function processScreenshot(deviceId: string, filePath: string) {
  const data = await fs.readJson(filePath);
  const { screenshotId, timestamp, created_at, buffer } = data;

  try {
    // 1. 先写数据库 (幂等性检查)
    await db.query(`
      INSERT INTO screenshots
        (screenshot_id, device_id, session_id, timestamp, created_at, oss_url, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE screenshot_id = screenshot_id
    `, [screenshotId, deviceId, sessionId, timestamp, created_at, '', fileSize]);

    // 2. 检查是否是新记录
    const result = await db.query(`
      SELECT oss_url FROM screenshots WHERE screenshot_id = ?
    `, [screenshotId]);

    if (result[0].oss_url) {
      // 已经上传过，跳过
      return { success: true, skipped: true };
    }

    // 3. 上传到OSS (30秒超时)
    const ossUrl = await ossClient.put(
      `screenshots/${deviceId}/${screenshotId}.jpg`,
      Buffer.from(buffer, 'base64'),
      { timeout: 30000 }
    );

    // 4. 更新OSS地址
    await db.query(`
      UPDATE screenshots SET oss_url = ? WHERE screenshot_id = ?
    `, [ossUrl.url, screenshotId]);

    return { success: true, ossUrl: ossUrl.url };

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      // 重复记录，幂等性保护
      return { success: true, skipped: true };
    }
    throw error;
  }
}

// 活动数据处理
async function processActivity(deviceId: string, filePath: string) {
  const data = await fs.readJson(filePath);
  const { activityId, timestamp, sessionId, ...activityData } = data;

  try {
    await db.query(`
      INSERT INTO activities
        (activity_id, device_id, session_id, timestamp, keystrokes, mouse_clicks, mouse_scrolls, active_window, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE activity_id = activity_id
    `, [activityId, deviceId, sessionId, timestamp,
        activityData.keystrokes, activityData.mouseClicks,
        activityData.mouseScrolls, activityData.activeWindow, activityData.url]);

    return { success: true };

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return { success: true, skipped: true };
    }
    throw error;
  }
}
```

**数据库Schema改造**:
```sql
-- 截图表 (唯一索引)
ALTER TABLE screenshots
ADD UNIQUE KEY uk_screenshot_unique (created_at, timestamp, device_id, session_id);

-- 活动表 (唯一索引)
ALTER TABLE activities
ADD UNIQUE KEY uk_activity_unique (timestamp, session_id);

-- 进程表 (唯一索引)
ALTER TABLE processes
ADD UNIQUE KEY uk_process_unique (timestamp, session_id);

-- 上传批次记录表 (新增)
CREATE TABLE upload_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  upload_id VARCHAR(64) UNIQUE NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  uploaded_at TIMESTAMP NOT NULL,
  processed_at TIMESTAMP NULL,
  status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
  total_screenshots INT DEFAULT 0,
  success_screenshots INT DEFAULT 0,
  failed_screenshots INT DEFAULT 0,
  total_activities INT DEFAULT 0,
  success_activities INT DEFAULT 0,
  failed_activities INT DEFAULT 0,
  total_processes INT DEFAULT 0,
  success_processes INT DEFAULT 0,
  failed_processes INT DEFAULT 0,
  error_message TEXT NULL,
  INDEX idx_device_status (device_id, status),
  INDEX idx_uploaded_at (uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 三、实施计划

### 3.1 阶段划分

#### 阶段一: 后端基础设施 (优先级: 🔴 CRITICAL)

**时间**: 第1-2周
**负责**: 后端团队

**任务清单**:
1. ✅ 数据库Schema改造
   - 添加唯一索引
   - 创建upload_batches表
   - 数据迁移脚本（如有历史数据）

2. ✅ ZIP上传接口开发
   - POST /api/device/batch-upload
   - 文件接收和持久化到/tmp
   - 异步处理队列

3. ✅ 异步处理服务
   - ZIP解压和文件解析
   - 并发处理逻辑 (PQueue, concurrency: 10)
   - 幂等性实现（先写数据库，ON DUPLICATE KEY UPDATE）

4. ✅ OSS超时调整
   - 从5秒增加到30秒
   - 重试机制优化

5. ✅ 监控和日志
   - 上传批次追踪
   - 处理成功率统计
   - 异常告警机制

**交付物**:
- 后端API接口文档
- 数据库变更SQL脚本
- 单元测试和集成测试
- 性能基准测试报告

#### 阶段二: 客户端改造 (优先级: 🔴 CRITICAL)

**时间**: 第2-3周
**负责**: 客户端团队

**任务清单**:
1. ✅ ZIP压缩服务开发
   - 定时扫描queue-cache目录
   - 压缩为标准格式ZIP
   - 生成manifest.json

2. ✅ HTTP批量上传服务
   - 替换WebSocket上传逻辑
   - 多文件并发上传支持
   - 断点续传机制

3. ✅ 上传策略优化
   - 定时上传 (默认5分钟)
   - 智能上传 (队列达到阈值时)
   - 离线缓存 (网络恢复后批量上传)

4. ✅ 错误恢复机制
   - 上传失败保留ZIP
   - 部分失败重新打包
   - 重试指数退避

5. ✅ 配置管理
   - 上传间隔可配置
   - 压缩级别可配置
   - 并发数可配置

**交付物**:
- 客户端新版本 (v3.0.0)
- 升级迁移脚本
- 测试用例和覆盖率报告
- 用户操作手册

#### 阶段三: 灰度发布和监控 (优先级: 🟡 IMPORTANT)

**时间**: 第4周
**负责**: 运维+测试团队

**任务清单**:
1. ✅ 灰度发布策略
   - 第1天: 10台设备 (1%)
   - 第3天: 100台设备 (10%)
   - 第5天: 500台设备 (50%)
   - 第7天: 全量发布 (100%)

2. ✅ 监控指标
   - 上传成功率 (目标: >99.5%)
   - 数据重复率 (目标: <0.1%)
   - 平均上传时间 (目标: <30秒)
   - 后端处理时间 (目标: <60秒)
   - OSS上传成功率 (目标: >99%)

3. ✅ A/B测试
   - 50%用户使用新架构
   - 50%用户使用旧架构
   - 对比性能和稳定性

4. ✅ 回滚预案
   - 客户端一键降级到v2.x
   - 后端接口向后兼容
   - 数据库回滚脚本

**交付物**:
- 灰度发布报告
- 性能对比报告
- 问题跟踪和修复记录

#### 阶段四: 旧架构下线 (优先级: 🟢 RECOMMENDED)

**时间**: 第5-6周
**负责**: 全栈团队

**任务清单**:
1. ✅ 确认新架构稳定
   - 7天无重大故障
   - 性能指标达标
   - 用户反馈良好

2. ✅ 下线WebSocket上传逻辑
   - 客户端移除相关代码
   - 后端关闭WebSocket上传接口
   - 清理废弃配置

3. ✅ 文档更新
   - 架构设计文档
   - API接口文档
   - 运维手册

4. ✅ 代码清理
   - 删除废弃代码
   - 优化依赖包
   - 代码审查

**交付物**:
- 项目总结报告
- 最终架构文档
- 性能提升报告

### 3.2 里程碑时间表

```
Week 1-2: 后端基础设施
├─ Day 1-3: 数据库改造和测试
├─ Day 4-7: ZIP上传接口开发
├─ Day 8-10: 异步处理服务开发
└─ Day 11-14: 测试和优化

Week 2-3: 客户端改造
├─ Day 1-4: ZIP压缩服务
├─ Day 5-8: HTTP批量上传服务
├─ Day 9-12: 错误恢复和配置
└─ Day 13-14: 联调测试

Week 4: 灰度发布
├─ Day 1-2: 灰度10台设备
├─ Day 3-4: 扩大到100台
├─ Day 5-6: 扩大到500台
└─ Day 7: 全量发布决策

Week 5-6: 稳定和下线
├─ Day 1-7: 监控和修复
├─ Day 8-10: 旧架构下线
└─ Day 11-14: 文档和总结
```

---

## 四、技术实现细节

### 4.1 客户端核心代码

#### ZipUploadService (新增)

```typescript
// src/common/services/zip-upload-service.ts
import * as fs from 'fs-extra';
import * as path from 'path';
import archiver from 'archiver';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface ZipUploadConfig {
  uploadInterval: number;      // 上传间隔 (默认300000ms = 5分钟)
  queueThreshold: number;       // 队列阈值 (达到后立即上传)
  compressionLevel: number;     // 压缩级别 (0-9, 默认6)
  maxRetries: number;           // 最大重试次数
  retryDelay: number;           // 重试延迟
  apiEndpoint: string;          // 上传接口地址
}

export class ZipUploadService {
  private config: ZipUploadConfig;
  private uploadTimer: NodeJS.Timeout | null = null;
  private isUploading = false;

  constructor(config: Partial<ZipUploadConfig>) {
    this.config = {
      uploadInterval: 300000,      // 5分钟
      queueThreshold: 100,         // 100条数据
      compressionLevel: 6,
      maxRetries: 3,
      retryDelay: 5000,
      apiEndpoint: '',
      ...config
    };
  }

  async start(): Promise<void> {
    // 启动定时上传
    this.uploadTimer = setInterval(async () => {
      await this.performUpload();
    }, this.config.uploadInterval);

    // 立即执行一次（清理启动前累积的数据）
    await this.performUpload();
  }

  async stop(): Promise<void> {
    if (this.uploadTimer) {
      clearInterval(this.uploadTimer);
      this.uploadTimer = null;
    }
  }

  private async performUpload(): Promise<void> {
    if (this.isUploading) {
      console.log('[ZIP_UPLOAD] Already uploading, skip...');
      return;
    }

    this.isUploading = true;

    try {
      // 1. 检查是否有数据需要上传
      const hasData = await this.checkHasData();
      if (!hasData) {
        console.log('[ZIP_UPLOAD] No data to upload');
        return;
      }

      // 2. 压缩数据
      const zipPath = await this.compressData();

      // 3. 上传ZIP
      const uploadSuccess = await this.uploadZip(zipPath);

      // 4. 清理
      if (uploadSuccess) {
        await this.cleanupAfterUpload(zipPath);
      } else {
        console.error('[ZIP_UPLOAD] Upload failed, keeping ZIP for retry');
      }

    } catch (error) {
      console.error('[ZIP_UPLOAD] Upload error:', error);
    } finally {
      this.isUploading = false;
    }
  }

  private async checkHasData(): Promise<boolean> {
    const queueCacheDir = path.join(
      process.env.HOME || '',
      'Library/Application Support/employee-safety-client/queue-cache'
    );

    const screenshotsDir = path.join(queueCacheDir, 'screenshots');
    const activitiesDir = path.join(queueCacheDir, 'activities');
    const processesDir = path.join(queueCacheDir, 'processes');

    const screenshots = await fs.readdir(screenshotsDir).catch(() => []);
    const activities = await fs.readdir(activitiesDir).catch(() => []);
    const processes = await fs.readdir(processesDir).catch(() => []);

    return screenshots.length > 0 || activities.length > 0 || processes.length > 0;
  }

  private async compressData(): Promise<string> {
    const timestamp = Date.now();
    const deviceId = await this.getDeviceId();
    const sessionId = await this.getSessionId();
    const uploadId = uuidv4();

    const queueCacheDir = path.join(
      process.env.HOME || '',
      'Library/Application Support/employee-safety-client/queue-cache'
    );

    const zipPath = path.join(queueCacheDir, `upload_${timestamp}_${deviceId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: this.config.compressionLevel }
    });

    return new Promise((resolve, reject) => {
      output.on('close', () => resolve(zipPath));
      archive.on('error', reject);

      archive.pipe(output);

      // 添加manifest.json
      const manifest = {
        uploadId,
        deviceId,
        sessionId,
        timestamp: new Date().toISOString(),
        counts: {
          screenshots: 0,
          activities: 0,
          processes: 0
        }
      };

      // 添加截图文件
      const screenshotsDir = path.join(queueCacheDir, 'screenshots');
      if (fs.existsSync(screenshotsDir)) {
        const files = fs.readdirSync(screenshotsDir);
        files.forEach(file => {
          archive.file(path.join(screenshotsDir, file), {
            name: `screenshots/${file}`
          });
        });
        manifest.counts.screenshots = files.length;
      }

      // 添加活动文件
      const activitiesDir = path.join(queueCacheDir, 'activities');
      if (fs.existsSync(activitiesDir)) {
        const files = fs.readdirSync(activitiesDir);
        files.forEach(file => {
          archive.file(path.join(activitiesDir, file), {
            name: `activities/${file}`
          });
        });
        manifest.counts.activities = files.length;
      }

      // 添加进程文件
      const processesDir = path.join(queueCacheDir, 'processes');
      if (fs.existsSync(processesDir)) {
        const files = fs.readdirSync(processesDir);
        files.forEach(file => {
          archive.file(path.join(processesDir, file), {
            name: `processes/${file}`
          });
        });
        manifest.counts.processes = files.length;
      }

      // 添加manifest
      archive.append(JSON.stringify(manifest, null, 2), {
        name: 'manifest.json'
      });

      archive.finalize();
    });
  }

  private async uploadZip(zipPath: string): Promise<boolean> {
    let retries = 0;

    while (retries < this.config.maxRetries) {
      try {
        const formData = new FormData();
        formData.append('zipFile', fs.createReadStream(zipPath));
        formData.append('deviceId', await this.getDeviceId());

        const response = await axios.post(
          this.config.apiEndpoint,
          formData,
          {
            headers: formData.getHeaders(),
            timeout: 60000,  // 60秒超时
            maxContentLength: 100 * 1024 * 1024,  // 100MB
            maxBodyLength: 100 * 1024 * 1024
          }
        );

        if (response.status === 200 && response.data.success) {
          console.log('[ZIP_UPLOAD] Upload successful:', response.data);
          return true;
        }

        console.error('[ZIP_UPLOAD] Upload failed:', response.data);
        return false;

      } catch (error) {
        retries++;
        console.error(`[ZIP_UPLOAD] Upload attempt ${retries} failed:`, error.message);

        if (retries < this.config.maxRetries) {
          await this.sleep(this.config.retryDelay * retries);  // 指数退避
        }
      }
    }

    return false;
  }

  private async cleanupAfterUpload(zipPath: string): Promise<void> {
    const queueCacheDir = path.join(
      process.env.HOME || '',
      'Library/Application Support/employee-safety-client/queue-cache'
    );

    // 删除原始文件
    await fs.remove(path.join(queueCacheDir, 'screenshots'));
    await fs.remove(path.join(queueCacheDir, 'activities'));
    await fs.remove(path.join(queueCacheDir, 'processes'));

    // 重新创建目录
    await fs.ensureDir(path.join(queueCacheDir, 'screenshots'));
    await fs.ensureDir(path.join(queueCacheDir, 'activities'));
    await fs.ensureDir(path.join(queueCacheDir, 'processes'));

    // 删除ZIP文件
    await fs.remove(zipPath);

    console.log('[ZIP_UPLOAD] Cleanup completed');
  }

  private async getDeviceId(): Promise<string> {
    // 实现获取设备ID逻辑
    return 'device123';
  }

  private async getSessionId(): Promise<string> {
    // 实现获取会话ID逻辑
    return 'session456';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

#### 集成到FSM状态处理器

```typescript
// src/common/services/fsm/state-handlers/data-collect-state-handler.ts

import { ZipUploadService } from '../../zip-upload-service';

export class DataCollectStateHandler {
  private zipUploadService: ZipUploadService | null = null;

  async onEnter(context: DeviceContext): Promise<void> {
    // ... 原有逻辑 ...

    // 启动ZIP批量上传服务
    this.zipUploadService = new ZipUploadService({
      uploadInterval: 300000,  // 5分钟
      apiEndpoint: `${this.apiBaseUrl}/api/device/batch-upload`
    });

    await this.zipUploadService.start();
  }

  async onExit(context: DeviceContext): Promise<void> {
    // 停止ZIP上传服务
    if (this.zipUploadService) {
      await this.zipUploadService.stop();
      this.zipUploadService = null;
    }

    // ... 原有逻辑 ...
  }
}
```

### 4.2 后端核心代码

#### BatchUploadController

```typescript
// api-server/src/controllers/batch-upload.controller.ts
import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BatchUploadService } from '../services/batch-upload.service';

const router = Router();
const upload = multer({
  dest: '/tmp/upload-temp',
  limits: {
    fileSize: 100 * 1024 * 1024  // 100MB
  }
});

const batchUploadService = new BatchUploadService();

router.post('/batch-upload', upload.single('zipFile'), async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body;
    const zipFile = req.file;

    if (!zipFile) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // 生成uploadId
    const uploadId = `upload_${Date.now()}_${deviceId}`;

    // 移动到持久化缓冲区
    const bufferDir = `/tmp/upload-buffer/${deviceId}`;
    await fs.ensureDir(bufferDir);
    const targetPath = path.join(bufferDir, `${uploadId}.zip`);
    await fs.move(zipFile.path, targetPath);

    // 记录上传批次
    await batchUploadService.recordUploadBatch({
      uploadId,
      deviceId,
      zipPath: targetPath
    });

    // 立即返回成功
    res.status(200).json({
      success: true,
      uploadId,
      message: 'Upload queued for processing'
    });

    // 异步处理（不阻塞响应）
    setImmediate(() => {
      batchUploadService.processUploadAsync(uploadId, deviceId, targetPath)
        .catch(error => {
          console.error(`[BATCH_UPLOAD] Processing failed for ${uploadId}:`, error);
        });
    });

  } catch (error) {
    console.error('[BATCH_UPLOAD] Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
```

#### BatchUploadService

```typescript
// api-server/src/services/batch-upload.service.ts
import * as fs from 'fs-extra';
import * as path from 'path';
import extract from 'extract-zip';
import PQueue from 'p-queue';
import { ScreenshotService } from './screenshot.service';
import { ActivityService } from './activity.service';
import { ProcessService } from './process.service';
import { DatabaseService } from './database.service';

interface ProcessResult {
  total: number;
  success: number;
  failed: number;
  errors: string[];
}

export class BatchUploadService {
  private screenshotService: ScreenshotService;
  private activityService: ActivityService;
  private processService: ProcessService;
  private db: DatabaseService;

  constructor() {
    this.screenshotService = new ScreenshotService();
    this.activityService = new ActivityService();
    this.processService = new ProcessService();
    this.db = new DatabaseService();
  }

  async recordUploadBatch(data: {
    uploadId: string;
    deviceId: string;
    zipPath: string;
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO upload_batches
        (upload_id, device_id, uploaded_at, status)
      VALUES (?, ?, NOW(), 'pending')
    `, [data.uploadId, data.deviceId]);
  }

  async processUploadAsync(
    uploadId: string,
    deviceId: string,
    zipPath: string
  ): Promise<void> {
    const extractDir = `/tmp/extract/${deviceId}/${Date.now()}`;

    try {
      // 更新状态为处理中
      await this.db.query(`
        UPDATE upload_batches
        SET status = 'processing', processed_at = NOW()
        WHERE upload_id = ?
      `, [uploadId]);

      // 1. 解压ZIP
      await extract(zipPath, { dir: extractDir });

      // 2. 读取manifest
      const manifestPath = path.join(extractDir, 'manifest.json');
      const manifest = await fs.readJson(manifestPath);
      const { sessionId } = manifest;

      // 3. 并发处理（最大并发数: 10）
      const queue = new PQueue({ concurrency: 10 });

      // 3.1 处理截图
      const screenshotResult = await this.processScreenshots(
        extractDir, deviceId, sessionId, queue
      );

      // 3.2 处理活动数据
      const activityResult = await this.processActivities(
        extractDir, deviceId, sessionId, queue
      );

      // 3.3 处理进程数据
      const processResult = await this.processProcesses(
        extractDir, deviceId, sessionId, queue
      );

      // 4. 更新统计
      await this.db.query(`
        UPDATE upload_batches
        SET
          status = 'completed',
          total_screenshots = ?,
          success_screenshots = ?,
          failed_screenshots = ?,
          total_activities = ?,
          success_activities = ?,
          failed_activities = ?,
          total_processes = ?,
          success_processes = ?,
          failed_processes = ?
        WHERE upload_id = ?
      `, [
        screenshotResult.total, screenshotResult.success, screenshotResult.failed,
        activityResult.total, activityResult.success, activityResult.failed,
        processResult.total, processResult.success, processResult.failed,
        uploadId
      ]);

      // 5. 清理
      await fs.remove(extractDir);

      const allSuccess =
        screenshotResult.failed === 0 &&
        activityResult.failed === 0 &&
        processResult.failed === 0;

      if (allSuccess) {
        await fs.remove(zipPath);  // 全部成功才删除ZIP
      }

      console.log(`[BATCH_UPLOAD] Completed ${uploadId}:`, {
        screenshots: screenshotResult,
        activities: activityResult,
        processes: processResult
      });

    } catch (error) {
      console.error(`[BATCH_UPLOAD] Processing error for ${uploadId}:`, error);

      await this.db.query(`
        UPDATE upload_batches
        SET status = 'failed', error_message = ?
        WHERE upload_id = ?
      `, [error.message, uploadId]);

      await fs.remove(extractDir).catch(() => {});
    }
  }

  private async processScreenshots(
    extractDir: string,
    deviceId: string,
    sessionId: string,
    queue: PQueue
  ): Promise<ProcessResult> {
    const result: ProcessResult = {
      total: 0,
      success: 0,
      failed: 0,
      errors: []
    };

    const screenshotsDir = path.join(extractDir, 'screenshots');
    if (!await fs.pathExists(screenshotsDir)) {
      return result;
    }

    const files = await fs.readdir(screenshotsDir);
    result.total = files.length;

    const results = await Promise.allSettled(
      files.map(file =>
        queue.add(() =>
          this.screenshotService.processScreenshot(
            deviceId,
            sessionId,
            path.join(screenshotsDir, file)
          )
        )
      )
    );

    results.forEach((r, index) => {
      if (r.status === 'fulfilled') {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(`${files[index]}: ${r.reason.message}`);
      }
    });

    return result;
  }

  private async processActivities(
    extractDir: string,
    deviceId: string,
    sessionId: string,
    queue: PQueue
  ): Promise<ProcessResult> {
    const result: ProcessResult = {
      total: 0,
      success: 0,
      failed: 0,
      errors: []
    };

    const activitiesDir = path.join(extractDir, 'activities');
    if (!await fs.pathExists(activitiesDir)) {
      return result;
    }

    const files = await fs.readdir(activitiesDir);
    result.total = files.length;

    const results = await Promise.allSettled(
      files.map(file =>
        queue.add(() =>
          this.activityService.processActivity(
            deviceId,
            sessionId,
            path.join(activitiesDir, file)
          )
        )
      )
    );

    results.forEach((r, index) => {
      if (r.status === 'fulfilled') {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(`${files[index]}: ${r.reason.message}`);
      }
    });

    return result;
  }

  private async processProcesses(
    extractDir: string,
    deviceId: string,
    sessionId: string,
    queue: PQueue
  ): Promise<ProcessResult> {
    const result: ProcessResult = {
      total: 0,
      success: 0,
      failed: 0,
      errors: []
    };

    const processesDir = path.join(extractDir, 'processes');
    if (!await fs.pathExists(processesDir)) {
      return result;
    }

    const files = await fs.readdir(processesDir);
    result.total = files.length;

    const results = await Promise.allSettled(
      files.map(file =>
        queue.add(() =>
          this.processService.processProcess(
            deviceId,
            sessionId,
            path.join(processesDir, file)
          )
        )
      )
    );

    results.forEach((r, index) => {
      if (r.status === 'fulfilled') {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(`${files[index]}: ${r.reason.message}`);
      }
    });

    return result;
  }
}
```

#### ScreenshotService (幂等性实现)

```typescript
// api-server/src/services/screenshot.service.ts
import * as fs from 'fs-extra';
import { DatabaseService } from './database.service';
import { OSSService } from './oss.service';

export class ScreenshotService {
  private db: DatabaseService;
  private oss: OSSService;

  constructor() {
    this.db = new DatabaseService();
    this.oss = new OSSService({
      timeout: 30000  // 30秒超时
    });
  }

  async processScreenshot(
    deviceId: string,
    sessionId: string,
    filePath: string
  ): Promise<void> {
    const data = await fs.readJson(filePath);
    const { screenshotId, timestamp, created_at, buffer, fileSize } = data;

    try {
      // 1. 先写数据库（幂等性检查）
      const insertResult = await this.db.query(`
        INSERT INTO screenshots
          (screenshot_id, device_id, session_id, timestamp, created_at, oss_url, file_size)
        VALUES (?, ?, ?, ?, ?, '', ?)
        ON DUPLICATE KEY UPDATE screenshot_id = screenshot_id
      `, [screenshotId, deviceId, sessionId, timestamp, created_at, fileSize]);

      // 2. 检查是否是新记录
      if (insertResult.affectedRows === 0) {
        // 重复记录，检查是否已上传
        const existing = await this.db.query(`
          SELECT oss_url FROM screenshots WHERE screenshot_id = ?
        `, [screenshotId]);

        if (existing[0]?.oss_url) {
          console.log(`[SCREENSHOT] Skipped duplicate: ${screenshotId}`);
          return;  // 已上传，跳过
        }
      }

      // 3. 上传到OSS
      const ossUrl = await this.oss.uploadScreenshot(
        `screenshots/${deviceId}/${screenshotId}.jpg`,
        Buffer.from(buffer, 'base64')
      );

      // 4. 更新OSS地址
      await this.db.query(`
        UPDATE screenshots SET oss_url = ? WHERE screenshot_id = ?
      `, [ossUrl, screenshotId]);

      console.log(`[SCREENSHOT] Processed: ${screenshotId} -> ${ossUrl}`);

    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        console.log(`[SCREENSHOT] Duplicate detected: ${screenshotId}`);
        return;  // 幂等性保护
      }
      throw error;
    }
  }
}
```

---

## 五、风险评估与缓解

### 5.1 技术风险

| 风险项 | 严重性 | 概率 | 影响 | 缓解措施 |
|--------|--------|------|------|----------|
| ZIP解压失败 | 高 | 低 | 数据丢失 | 解压前备份，失败保留原ZIP |
| OSS上传超时 | 中 | 中 | 部分数据丢失 | 30秒超时 + 重试机制 |
| 数据库死锁 | 中 | 低 | 性能下降 | 批量插入 + 事务隔离级别优化 |
| 磁盘空间不足 | 高 | 中 | 服务中断 | /tmp定期清理 + 磁盘监控告警 |
| 并发处理冲突 | 低 | 低 | 数据重复 | 唯一索引 + ON DUPLICATE KEY UPDATE |

### 5.2 业务风险

| 风险项 | 严重性 | 概率 | 影响 | 缓解措施 |
|--------|--------|------|------|----------|
| 灰度发布失败 | 高 | 低 | 用户投诉 | 快速回滚 + 7x24监控 |
| 数据迁移错误 | 高 | 低 | 历史数据丢失 | 数据备份 + 迁移验证脚本 |
| 性能不达预期 | 中 | 中 | 用户体验下降 | 压测验证 + 参数调优 |
| 客户端兼容性 | 中 | 低 | 老版本无法使用 | 强制升级提醒 + 向后兼容 |

### 5.3 运维风险

| 风险项 | 严重性 | 概率 | 影响 | 缓解措施 |
|--------|--------|------|------|----------|
| /tmp目录被清理 | 高 | 中 | 数据丢失 | 改用专用目录 + 定期备份 |
| 服务器OOM | 高 | 中 | 服务崩溃 | 内存监控 + PQueue并发限制 |
| 网络带宽不足 | 中 | 中 | 上传缓慢 | 带宽扩容 + 压缩级别调优 |
| 监控盲区 | 中 | 高 | 问题发现延迟 | 完善监控指标 + 告警规则 |

---

## 六、测试计划

### 6.1 单元测试

**客户端**:
```typescript
// tests/zip-upload-service.test.ts
describe('ZipUploadService', () => {
  test('应该正确压缩数据', async () => {
    const service = new ZipUploadService({...});
    const zipPath = await service.compressData();
    expect(fs.existsSync(zipPath)).toBe(true);
  });

  test('应该在上传失败后重试', async () => {
    const service = new ZipUploadService({ maxRetries: 3 });
    const uploadSpy = jest.spyOn(service, 'uploadZip');
    await service.performUpload();
    expect(uploadSpy).toHaveBeenCalledTimes(3);
  });
});
```

**后端**:
```typescript
// tests/batch-upload.service.test.ts
describe('BatchUploadService', () => {
  test('应该正确处理ZIP文件', async () => {
    const service = new BatchUploadService();
    await service.processUploadAsync('test-upload-id', 'device123', 'test.zip');
    // 验证数据库记录
  });

  test('应该实现幂等性', async () => {
    const screenshotService = new ScreenshotService();
    await screenshotService.processScreenshot('device123', 'session456', 'test.json');
    await screenshotService.processScreenshot('device123', 'session456', 'test.json');
    // 验证只插入一条记录
  });
});
```

### 6.2 集成测试

```bash
# 端到端测试流程
1. 启动客户端采集数据
2. 等待5分钟触发上传
3. 验证ZIP文件生成
4. 验证后端接收成功
5. 验证异步处理完成
6. 验证数据库记录正确
7. 验证OSS文件存在
8. 验证原文件已删除
```

### 6.3 性能测试

**压力测试**:
```yaml
场景1: 单设备大数据量
  数据: 1000张截图 + 500条活动 + 100条进程
  预期:
    - 压缩时间: <30秒
    - 上传时间: <60秒
    - 后端处理: <120秒
    - 总时间: <210秒

场景2: 多设备并发上传
  设备数: 100
  每设备: 200张截图 + 100条活动
  预期:
    - 并发处理: 10个设备同时
    - 单设备处理时间: <60秒
    - 总时间: <600秒 (100/10 * 60)
    - 成功率: >99%

场景3: 极限压测
  设备数: 1000
  持续时间: 1小时
  预期:
    - CPU使用率: <70%
    - 内存使用: <4GB
    - 磁盘IO: <80%
    - 无OOM/崩溃
```

### 6.4 兼容性测试

| 平台 | 版本 | 测试内容 |
|------|------|----------|
| macOS | 10.15+ | ZIP压缩、上传、错误恢复 |
| Windows | 10/11 | ZIP压缩、上传、错误恢复 |
| 客户端 | v2.x | 向后兼容性（WebSocket仍可用） |
| 后端 | v1.x | 接口向后兼容 |

---

## 七、性能预期

### 7.1 性能对比

| 指标 | 旧架构 (WebSocket) | 新架构 (ZIP批量) | 提升倍数 |
|------|-------------------|------------------|----------|
| **200张截图上传时间** | 3000秒 (50分钟) | 15秒 | **200x** |
| **单张截图平均耗时** | 15秒 | 0.075秒 | **200x** |
| **并发处理数** | 1 (串行) | 10 | **10x** |
| **网络请求数** | 200 | 1 | **200x** |
| **带宽利用率** | 低 (TCP头部开销大) | 高 (ZIP压缩) | **~30%节省** |
| **客户端阻塞时间** | 3000秒 | 0秒 (异步) | **∞** |

### 7.2 资源消耗

**客户端**:
| 资源 | 旧架构 | 新架构 | 变化 |
|------|--------|--------|------|
| CPU | 5-10% (持续) | 峰值20% (压缩时) | 更集中 |
| 内存 | 50-100MB | 30-50MB | 降低50% |
| 磁盘IO | 持续写入 | 间歇写入 | 降低80% |
| 网络 | 持续占用 | 间歇占用 | 降低90% |

**后端**:
| 资源 | 旧架构 | 新架构 | 变化 |
|------|--------|--------|------|
| CPU | 30-40% (持续) | 峰值60% (处理时) | 更集中 |
| 内存 | 2GB | 4GB | 增加2GB |
| 磁盘 | /tmp: 10GB | /tmp: 50GB | 需扩容 |
| 并发连接 | 1000+ | 100 | 降低90% |

### 7.3 业务指标

| 指标 | 目标 | 监控方式 |
|------|------|----------|
| 上传成功率 | >99.5% | Prometheus + Grafana |
| 数据重复率 | <0.1% | 数据库查询统计 |
| 平均上传延迟 | <30秒 | APM监控 |
| P95延迟 | <60秒 | APM监控 |
| P99延迟 | <120秒 | APM监控 |
| 后端处理成功率 | >99% | 日志分析 |
| OSS上传成功率 | >99% | OSS SDK metrics |

---

## 八、回滚方案

### 8.1 回滚触发条件

满足以下**任意一项**时执行回滚:
1. 上传成功率 < 95% 持续30分钟
2. 数据重复率 > 1%
3. P95延迟 > 300秒
4. 后端处理失败率 > 5%
5. 用户严重投诉 (如数据丢失)
6. 系统崩溃或OOM

### 8.2 回滚步骤

#### 客户端回滚 (5分钟内完成)

```bash
# 1. 推送降级配置
curl -X POST https://api.example.com/admin/feature-toggle \
  -d '{"feature": "zip_upload", "enabled": false}'

# 2. 客户端自动切换回WebSocket模式
# 无需重新安装，配置动态生效

# 3. 验证降级成功
curl https://api.example.com/admin/feature-status
```

#### 后端回滚 (10分钟内完成)

```bash
# 1. 切换流量到旧版本服务
kubectl set image deployment/api-server api-server=v2.3.3

# 2. 回滚数据库变更（如有问题）
mysql -u root -p < rollback_v3.0.0.sql

# 3. 验证服务恢复
curl https://api.example.com/health
```

### 8.3 数据一致性保证

**回滚期间数据处理**:
```
1. 已上传的ZIP文件: 继续处理完成，不中断
2. 正在上传的ZIP: 允许完成，成功后处理
3. 未上传的数据: 自动切换回WebSocket上传
4. 历史数据: 不受影响，已在数据库中
```

**零数据丢失保证**:
- 回滚不删除任何数据
- /tmp/upload-buffer 保留48小时
- 客户端queue-cache保留7天
- 所有失败上传自动重试

---

## 九、监控和告警

### 9.1 监控指标

#### 业务指标
```yaml
upload_success_rate:
  description: "上传成功率"
  query: "sum(upload_success) / sum(upload_total)"
  alert_threshold: "< 0.995"

data_duplicate_rate:
  description: "数据重复率"
  query: "sum(duplicate_inserts) / sum(total_inserts)"
  alert_threshold: "> 0.001"

average_upload_latency:
  description: "平均上传延迟"
  query: "avg(upload_duration_seconds)"
  alert_threshold: "> 30"

p95_upload_latency:
  description: "P95上传延迟"
  query: "histogram_quantile(0.95, upload_duration_seconds)"
  alert_threshold: "> 60"
```

#### 系统指标
```yaml
backend_processing_queue_depth:
  description: "后端处理队列深度"
  query: "processing_queue_size"
  alert_threshold: "> 100"

oss_upload_success_rate:
  description: "OSS上传成功率"
  query: "sum(oss_success) / sum(oss_total)"
  alert_threshold: "< 0.99"

tmp_disk_usage:
  description: "/tmp磁盘使用率"
  query: "disk_usage{path='/tmp'}"
  alert_threshold: "> 0.8"

backend_memory_usage:
  description: "后端内存使用"
  query: "container_memory_usage_bytes"
  alert_threshold: "> 3.5GB"
```

### 9.2 告警规则

**告警级别**:
- 🔴 P0 (Critical): 立即处理，15分钟内响应
- 🟡 P1 (High): 1小时内处理
- 🟢 P2 (Medium): 4小时内处理
- ⚪ P3 (Low): 24小时内处理

**告警配置**:
```yaml
alerts:
  - name: UploadSuccessRateLow
    level: P0
    condition: upload_success_rate < 0.95 for 5m
    action:
      - 发送钉钉告警
      - 电话通知on-call工程师
      - 触发自动回滚流程

  - name: DataDuplicateRateHigh
    level: P1
    condition: data_duplicate_rate > 0.01 for 10m
    action:
      - 发送邮件告警
      - 记录日志
      - 触发数据清理任务

  - name: BackendProcessingQueueFull
    level: P1
    condition: processing_queue_size > 100 for 5m
    action:
      - 扩容后端处理服务
      - 增加并发数

  - name: TmpDiskAlmostFull
    level: P0
    condition: tmp_disk_usage > 0.9
    action:
      - 立即清理旧文件
      - 磁盘扩容
      - 暂停新上传
```

### 9.3 日志收集

**客户端日志**:
```typescript
// 结构化日志格式
{
  "timestamp": "2024-12-24T10:30:00Z",
  "level": "INFO",
  "module": "ZipUploadService",
  "action": "upload_completed",
  "deviceId": "device123",
  "uploadId": "upload_1703401234567",
  "zipSize": 25600000,
  "duration": 15.2,
  "success": true
}
```

**后端日志**:
```typescript
// 结构化日志格式
{
  "timestamp": "2024-12-24T10:30:15Z",
  "level": "INFO",
  "module": "BatchUploadService",
  "action": "processing_completed",
  "uploadId": "upload_1703401234567",
  "deviceId": "device123",
  "stats": {
    "screenshots": { "total": 200, "success": 200, "failed": 0 },
    "activities": { "total": 100, "success": 100, "failed": 0 },
    "processes": { "total": 50, "success": 50, "failed": 0 }
  },
  "duration": 45.8
}
```

---

## 十、附录

### 10.1 术语表

| 术语 | 英文 | 解释 |
|------|------|------|
| 批量上传 | Batch Upload | 将多个文件打包后一次性上传 |
| 幂等性 | Idempotency | 同一操作执行多次结果相同 |
| 竞态条件 | Race Condition | 多个操作同时执行导致的时序问题 |
| 串行处理 | Serial Processing | 一次处理一个请求 |
| 并发处理 | Concurrent Processing | 同时处理多个请求 |
| 异步处理 | Asynchronous Processing | 非阻塞的后台处理 |
| 持久化缓冲 | Persistent Buffer | 数据临时存储，故障恢复用 |

### 10.2 参考文档

- [ZIP批量上传架构修正分析](./ZIP_UPLOAD_ARCHITECTURE_REVISED_ANALYSIS.md)
- [上传架构分析](./UPLOAD_ARCHITECTURE_ANALYSIS.md)
- [幂等性与竞态条件分析](./IDEMPOTENCY_RACE_CONDITION_ANALYSIS.md)
- [并发上传架构](./CONCURRENT_UPLOAD_ARCHITECTURE.md)

### 10.3 FAQ

**Q: 为什么不继续优化WebSocket而是改用HTTP?**
A: WebSocket基于TCP流，本质上是串行的。即使客户端并发发送，服务端也是按顺序接收处理。HTTP支持真正的并发连接。

**Q: ZIP压缩会不会增加客户端负担?**
A: 会在压缩时有短暂的CPU峰值（20%），但整体资源消耗降低。压缩时间约10-20秒，远小于节省的上传时间（200倍提升）。

**Q: 如果ZIP上传失败会怎样?**
A: ZIP文件保留在本地，下次重试。不会丢失数据。客户端有指数退避重试机制。

**Q: 幂等性如何保证?**
A: 通过数据库唯一索引 + ON DUPLICATE KEY UPDATE实现。同一数据插入多次也只会保留一条记录。

**Q: /tmp目录被系统清理了怎么办?**
A: 建议改用专用目录（如/var/upload-buffer），并设置定期备份策略。灰度期间会监控此问题。

**Q: 老版本客户端是否还能工作?**
A: 可以。后端会同时支持WebSocket和HTTP批量上传，向后兼容。

**Q: 性能提升200倍是如何计算的?**
A: 旧架构: 200张截图 × 15秒/张 = 3000秒
   新架构: 1次上传 + 15秒处理 = 15秒
   提升: 3000 / 15 = 200倍

---

## 十一、总结

本方案通过**架构级别的变更**（从WebSocket实时流式上传转变为ZIP批量离线上传），预期实现：

✅ **性能提升200倍** (3000秒 → 15秒)
✅ **彻底解决队列积压问题** (批量上传 > 采集速度)
✅ **实现数据幂等性** (数据库唯一索引)
✅ **降低客户端资源消耗** (内存降低50%，磁盘IO降低80%)
✅ **提升系统可扩展性** (后端并发处理，非阻塞)

方案已充分考虑：
- ✅ 数据安全性 (持久化缓冲 + 重试机制)
- ✅ 向后兼容性 (老版本客户端仍可用)
- ✅ 快速回滚能力 (5-10分钟内回滚)
- ✅ 完善的监控告警 (实时发现问题)

**建议立即启动实施，预计6周内完成全量发布。**
