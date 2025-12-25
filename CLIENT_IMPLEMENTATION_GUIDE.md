# ZIP启动上传 - 客户端实现指南

## 文档版本

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| 1.0 | 2024-12-24 | System | 客户端详细实现文档 |
| 1.1 | 2024-12-24 | System | 更新实施状态（已完成） |

---

## ⚡ 实施状态

**版本**: 2.3.3
**状态**: ✅ 已完成实施

### 已实现功能

| 功能模块 | 状态 | 文件路径 |
|---------|------|---------|
| StartupUploadService | ✅ 已实现 | `src/common/services/startup-upload-service.ts` |
| FSM集成 | ✅ 已实现 | `src/common/services/fsm/state-handlers/ws-check-state-handler.ts` |
| 依赖包 | ✅ 已添加 | `package.json` (archiver, form-data, glob) |
| DiskQueueManager | ✅ 已存在 | `src/common/services/disk-queue-manager.ts` |
| 队列系统 | ✅ 已存在 | `src/common/services/queue-service.ts` |

### 工作流程

```
客户端启动/WebSocket重连
  ↓
FSM进入WS_CHECK状态
  ↓
WebSocket连接测试成功
  ↓
触发StartupUploadService.checkAndUpload() (非阻塞)
  ↓
检查本地积压数据
  ├─ 无数据 → 跳过
  └─ 有数据 →
      ├─ 压缩截图/活动/进程数据为ZIP
      ├─ 删除原始文件
      ├─ 上传ZIP文件到 /api/startup-upload
      └─ 上传成功 → 删除ZIP文件
          上传失败 → 保留ZIP文件（下次重试）
```

### 安装依赖

```bash
# 安装新增的依赖包
npm install archiver@^6.0.0 form-data@^4.0.0 glob@^10.0.0

# 编译TypeScript
npm run build

# 测试运行
npm run electron
```

---

## 一、架构概览

### 1.1 核心职责

客户端负责数据采集、本地持久化、ZIP压缩和上传:
1. **正常运行**: 实时采集 → WebSocket实时发送
2. **启动/重连**: 检查积压数据 → ZIP压缩 → HTTP上传 → 删除本地文件
3. **断网期间**: 数据持久化到本地 → 等待重连后批量上传

### 1.2 技术栈

```yaml
运行时: Node.js 16+ / Electron
语言: TypeScript
文件操作: fs-extra
压缩: archiver
HTTP: axios / node-fetch
状态管理: FSM (Finite State Machine)
```

---

## 二、本地持久化结构

### 2.1 目录结构

**状态**: ✅ 已实现 (DiskQueueManager v2.3.3)

```
~/Library/Application Support/employee-safety-client/queue-cache/
├── screenshots/                               # ✅ 由 DiskQueueManager 管理
│   ├── 2024-12-24/
│   │   ├── screenshot_1703401200000.jpg        # JPEG二进制
│   │   ├── screenshot_1703401200000.meta.json  # 元数据
│   │   ├── screenshot_1703401260000.jpg
│   │   └── screenshot_1703401260000.meta.json
│   └── 2024-12-25/
│       └── ...
├── activities/                                # ✅ 由 DiskQueueManager 管理
│   ├── 2024-12-24/
│   │   ├── activity_1703401200000.json
│   │   ├── activity_1703401260000.json
│   │   └── activity_1703401320000.json
│   └── 2024-12-25/
│       └── ...
├── processes/                                 # ✅ 由 DiskQueueManager 管理
│   ├── 2024-12-24/
│   │   ├── process_1703401200000.json
│   │   └── process_1703401500000.json
│   └── 2024-12-25/
│       └── ...
└── [临时ZIP文件]                              # ✅ 由 StartupUploadService 创建
    ├── screenshots_1703401234567.zip  # 仅在上传失败时保留
    ├── activities_1703401234567.zip   # 仅在上传失败时保留
    └── processes_1703401234567.zip    # 仅在上传失败时保留
```

**关键实现**:
- `DiskQueueManager` (src/common/services/disk-queue-manager.ts): 负责按日期目录管理持久化文件
- `StartupUploadService` (src/common/services/startup-upload-service.ts): 负责ZIP压缩和上传

### 2.2 截图数据格式

#### JPEG文件 (screenshot_{timestamp}.jpg)

```
二进制JPEG图片
- 分辨率: 1920x1080 或实际屏幕分辨率
- 质量: 75 (JPEG quality)
- 大小: 通常25-50KB
```

#### 元数据文件 (screenshot_{timestamp}.meta.json)

```json
{
  "id": "screenshot_1703401200000",
  "timestamp": 1703401200000,
  "bufferPath": "./screenshot_1703401200000.jpg",  // 相对路径
  "fileSize": 25600,
  "format": "jpg",
  "quality": 75,
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  "_metadata": {
    "uploadStatus": "pending",
    "createdAt": 1703401200000,
    "captureMethod": "electron-screenshot"
  }
}
```

**ZIP内JSON格式** (上传时需转换):

```json
{
  "id": "screenshot_1703401200000",
  "timestamp": 1703401200000,
  "buffer": "base64-encoded-jpeg-data",  // 读取JPEG文件并Base64编码
  "fileSize": 25600,
  "format": "jpg",
  "quality": 75,
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  "_metadata": {
    "uploadStatus": "pending",
    "createdAt": 1703401200000
  }
}
```

### 2.3 活动数据格式

#### activity_{timestamp}.json

```json
{
  "id": "activity_1703401200000",
  "timestamp": 1703401200000,  // 60秒周期结束时间
  "data": {
    "keystrokes": 116,          // 60秒内累加值
    "mouseClicks": 100,         // 60秒内累加值
    "mouseScrolls": 100,        // 60秒内累加值
    "activeWindow": "Google Chrome - Example.com",  // 周期结束时的值
    "activeWindowProcess": "Chrome",                // 周期结束时的值
    "url": "https://example.com/page"               // 周期结束时的值
  },
  "_metadata": {
    "uploadStatus": "pending",
    "createdAt": 1703401200000,
    "aggregationPeriod": 60000  // 聚合周期(毫秒)
  }
}
```

**关键说明**:
- `timestamp`: 必须是60秒聚合周期的**结束时间**
- 例如: `10:00:00`, `10:01:00`, `10:02:00` (精确到秒的整数倍)
- 数值字段(`keystrokes`, `mouseClicks`, `mouseScrolls`): 60秒内的**累加值**
- 文本字段(`activeWindow`, `url`): 周期结束时的**最后值**

### 2.4 进程数据格式

#### process_{timestamp}.json

```json
{
  "id": "process_1703401200000",
  "timestamp": 1703401200000,
  "data": {
    "processes": [
      {
        "name": "Google Chrome",
        "pid": 12345,
        "cpu": 15.5,        // CPU使用率(百分比)
        "memory": 512000000 // 内存使用(字节)
      },
      {
        "name": "Visual Studio Code",
        "pid": 12346,
        "cpu": 8.2,
        "memory": 256000000
      },
      {
        "name": "Electron",
        "pid": 12347,
        "cpu": 2.3,
        "memory": 128000000
      }
    ],
    "totalCpu": 25.8,            // 总CPU使用率
    "totalMemory": 8589934592,   // 总内存(8GB)
    "processCount": 45           // 进程总数
  },
  "_metadata": {
    "uploadStatus": "pending",
    "createdAt": 1703401200000,
    "collectionInterval": 300000  // 采集间隔(毫秒, 默认5分钟)
  }
}
```

---

## 三、核心服务实现

### 3.1 StartupUploadService

**文件路径**: `src/common/services/startup-upload-service.ts`

**状态**: ✅ 已实现 (版本 2.3.3)

#### 完整实现

```typescript
import * as fs from 'fs-extra';
import * as path from 'path';
import archiver from 'archiver';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils';
import FormData from 'form-data';

interface StartupUploadConfig {
  apiEndpoint: string;      // 上传接口地址 (如: http://api.com/api/startup-upload)
  deviceId: string;         // 设备ID
  sessionId: string;        // 会话ID
  queueCacheDir: string;    // 队列缓存目录
}

interface CompressResult {
  type: 'screenshots' | 'activities' | 'processes';
  zipPath: string | null;
  fileCount: number;
  originalSize: number;
  compressedSize: number;
}

export class StartupUploadService {
  private config: StartupUploadConfig;

  constructor(config: StartupUploadConfig) {
    this.config = config;
  }

  /**
   * 主入口: 检查并上传积压数据
   * 在客户端启动/WebSocket重连时调用
   */
  async checkAndUpload(): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info('[STARTUP_UPLOAD] 开始检查本地积压数据', {
        queueCacheDir: this.config.queueCacheDir
      });

      // 1. 检查是否有积压数据
      const hasData = await this.hasBacklogData();

      if (!hasData) {
        logger.info('[STARTUP_UPLOAD] 无积压数据,跳过上传');
        return;
      }

      logger.info('[STARTUP_UPLOAD] 发现积压数据,开始处理...');

      // 2. 压缩各类数据
      const compressResults: CompressResult[] = [];

      // 2.1 压缩截图数据(需要合并JPEG和元数据)
      const screenshotResult = await this.compressScreenshots();
      if (screenshotResult) {
        compressResults.push(screenshotResult);
      }

      // 2.2 压缩活动数据
      const activityResult = await this.compressActivities();
      if (activityResult) {
        compressResults.push(activityResult);
      }

      // 2.3 压缩进程数据
      const processResult = await this.compressProcesses();
      if (processResult) {
        compressResults.push(processResult);
      }

      if (compressResults.length === 0) {
        logger.info('[STARTUP_UPLOAD] 无数据需要上传');
        return;
      }

      // 3. 删除原始文件(压缩成功后)
      await this.deleteOriginalFiles();

      // 4. 上传ZIP文件
      const uploadSuccess = await this.uploadZipFiles(compressResults);

      // 5. 清理
      if (uploadSuccess) {
        // 上传成功,删除ZIP文件
        for (const result of compressResults) {
          if (result.zipPath) {
            await fs.remove(result.zipPath);
          }
        }

        const duration = Date.now() - startTime;
        logger.info('[STARTUP_UPLOAD] ✅ 积压数据上传成功', {
          duration,
          filesUploaded: compressResults.length,
          totalOriginalSize: compressResults.reduce((sum, r) => sum + r.originalSize, 0),
          totalCompressedSize: compressResults.reduce((sum, r) => sum + r.compressedSize, 0)
        });
      } else {
        // 上传失败,保留ZIP文件供下次重试
        logger.error('[STARTUP_UPLOAD] ❌ 上传失败,ZIP文件已保留', {
          zipFiles: compressResults.map(r => r.zipPath)
        });
      }

    } catch (error: any) {
      logger.error('[STARTUP_UPLOAD] 处理失败', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * 检查是否有积压数据
   */
  private async hasBacklogData(): Promise<boolean> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');
    const processesDir = path.join(this.config.queueCacheDir, 'processes');

    // 递归统计JSON文件数量
    const screenshotCount = await this.countJsonFiles(screenshotsDir);
    const activityCount = await this.countJsonFiles(activitiesDir);
    const processCount = await this.countJsonFiles(processesDir);

    logger.info('[STARTUP_UPLOAD] 积压数据统计', {
      screenshots: screenshotCount,
      activities: activityCount,
      processes: processCount
    });

    return screenshotCount > 0 || activityCount > 0 || processCount > 0;
  }

  /**
   * 统计目录下JSON文件数量
   */
  private async countJsonFiles(dir: string): Promise<number> {
    if (!await fs.pathExists(dir)) {
      return 0;
    }

    let count = 0;
    const items = await fs.readdir(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // 递归统计子目录
        count += await this.countJsonFiles(fullPath);
      } else if (item.endsWith('.json') && !item.endsWith('.meta.json')) {
        // 统计JSON文件(排除meta.json)
        count++;
      }
    }

    return count;
  }

  /**
   * 压缩截图数据
   * 需要将JPEG文件读取为Base64并合并到元数据JSON中
   */
  private async compressScreenshots(): Promise<CompressResult | null> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');

    if (!await fs.pathExists(screenshotsDir)) {
      return null;
    }

    // 收集所有元数据文件
    const metaFiles = await this.findFiles(screenshotsDir, '**/*.meta.json');

    if (metaFiles.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无截图数据需要压缩');
      return null;
    }

    const zipPath = path.join(
      this.config.queueCacheDir,
      `screenshots_${Date.now()}.zip`
    );

    logger.info('[STARTUP_UPLOAD] 开始压缩截图数据', {
      fileCount: metaFiles.length,
      zipPath
    });

    let originalSize = 0;

    // 创建ZIP
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 6 }  // 压缩级别6(平衡速度和压缩率)
    });

    archive.pipe(output);

    // 处理每个元数据文件
    for (const metaFilePath of metaFiles) {
      // 读取元数据
      const metadata = await fs.readJson(metaFilePath);

      // 读取对应的JPEG文件
      const jpegPath = metaFilePath.replace('.meta.json', '.jpg');

      if (!await fs.pathExists(jpegPath)) {
        logger.warn('[STARTUP_UPLOAD] JPEG文件不存在,跳过', {
          metaFile: metaFilePath,
          jpegPath
        });
        continue;
      }

      // 读取JPEG文件并转Base64
      const jpegBuffer = await fs.readFile(jpegPath);
      const base64Buffer = jpegBuffer.toString('base64');

      // 合并数据(ZIP内JSON格式)
      const zipData = {
        id: metadata.id,
        timestamp: metadata.timestamp,
        buffer: base64Buffer,  // Base64编码的JPEG数据
        fileSize: metadata.fileSize,
        format: metadata.format,
        quality: metadata.quality,
        resolution: metadata.resolution,
        _metadata: metadata._metadata
      };

      // 添加到ZIP(使用原始ID作为文件名)
      const jsonFileName = `${metadata.id}.json`;
      archive.append(JSON.stringify(zipData), { name: jsonFileName });

      originalSize += jpegBuffer.length + Buffer.byteLength(JSON.stringify(metadata));
    }

    await archive.finalize();

    // 等待流关闭
    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const compressedSize = (await fs.stat(zipPath)).size;

    logger.info('[STARTUP_UPLOAD] 截图数据压缩完成', {
      fileCount: metaFiles.length,
      originalSize,
      compressedSize,
      compressionRatio: `${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`,
      zipPath
    });

    return {
      type: 'screenshots',
      zipPath,
      fileCount: metaFiles.length,
      originalSize,
      compressedSize
    };
  }

  /**
   * 压缩活动数据
   */
  private async compressActivities(): Promise<CompressResult | null> {
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');

    if (!await fs.pathExists(activitiesDir)) {
      return null;
    }

    const jsonFiles = await this.findFiles(activitiesDir, '**/*.json');

    if (jsonFiles.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无活动数据需要压缩');
      return null;
    }

    const zipPath = path.join(
      this.config.queueCacheDir,
      `activities_${Date.now()}.zip`
    );

    logger.info('[STARTUP_UPLOAD] 开始压缩活动数据', {
      fileCount: jsonFiles.length,
      zipPath
    });

    let originalSize = 0;

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(output);

    // 添加所有JSON文件到ZIP
    for (const filePath of jsonFiles) {
      const fileContent = await fs.readFile(filePath);
      const fileName = path.basename(filePath);

      archive.append(fileContent, { name: fileName });
      originalSize += fileContent.length;
    }

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const compressedSize = (await fs.stat(zipPath)).size;

    logger.info('[STARTUP_UPLOAD] 活动数据压缩完成', {
      fileCount: jsonFiles.length,
      originalSize,
      compressedSize,
      compressionRatio: `${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`,
      zipPath
    });

    return {
      type: 'activities',
      zipPath,
      fileCount: jsonFiles.length,
      originalSize,
      compressedSize
    };
  }

  /**
   * 压缩进程数据
   */
  private async compressProcesses(): Promise<CompressResult | null> {
    const processesDir = path.join(this.config.queueCacheDir, 'processes');

    if (!await fs.pathExists(processesDir)) {
      return null;
    }

    const jsonFiles = await this.findFiles(processesDir, '**/*.json');

    if (jsonFiles.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无进程数据需要压缩');
      return null;
    }

    const zipPath = path.join(
      this.config.queueCacheDir,
      `processes_${Date.now()}.zip`
    );

    logger.info('[STARTUP_UPLOAD] 开始压缩进程数据', {
      fileCount: jsonFiles.length,
      zipPath
    });

    let originalSize = 0;

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(output);

    for (const filePath of jsonFiles) {
      const fileContent = await fs.readFile(filePath);
      const fileName = path.basename(filePath);

      archive.append(fileContent, { name: fileName });
      originalSize += fileContent.length;
    }

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const compressedSize = (await fs.stat(zipPath)).size;

    logger.info('[STARTUP_UPLOAD] 进程数据压缩完成', {
      fileCount: jsonFiles.length,
      originalSize,
      compressedSize,
      compressionRatio: `${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`,
      zipPath
    });

    return {
      type: 'processes',
      zipPath,
      fileCount: jsonFiles.length,
      originalSize,
      compressedSize
    };
  }

  /**
   * 查找文件(支持glob模式)
   */
  private async findFiles(dir: string, pattern: string): Promise<string[]> {
    const { glob } = await import('glob');
    const files = await glob(pattern, {
      cwd: dir,
      absolute: true,
      nodir: true
    });
    return files;
  }

  /**
   * 删除原始JSON和JPEG文件
   */
  private async deleteOriginalFiles(): Promise<void> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');
    const processesDir = path.join(this.config.queueCacheDir, 'processes');

    // 删除截图文件(.jpg + .meta.json)
    if (await fs.pathExists(screenshotsDir)) {
      await this.deleteFilesRecursive(screenshotsDir, ['.jpg', '.meta.json', '.json']);
    }

    // 删除活动JSON文件
    if (await fs.pathExists(activitiesDir)) {
      await this.deleteFilesRecursive(activitiesDir, ['.json']);
    }

    // 删除进程JSON文件
    if (await fs.pathExists(processesDir)) {
      await this.deleteFilesRecursive(processesDir, ['.json']);
    }

    logger.info('[STARTUP_UPLOAD] 原始文件已删除');
  }

  /**
   * 递归删除指定扩展名的文件
   */
  private async deleteFilesRecursive(dir: string, extensions: string[]): Promise<void> {
    if (!await fs.pathExists(dir)) {
      return;
    }

    const items = await fs.readdir(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // 递归删除子目录中的文件
        await this.deleteFilesRecursive(fullPath, extensions);

        // 如果目录为空,删除目录
        const remaining = await fs.readdir(fullPath);
        if (remaining.length === 0) {
          await fs.remove(fullPath);
        }
      } else {
        // 检查文件扩展名
        const ext = path.extname(item);
        if (extensions.includes(ext)) {
          await fs.remove(fullPath);
        }
      }
    }
  }

  /**
   * 上传ZIP文件
   */
  private async uploadZipFiles(compressResults: CompressResult[]): Promise<boolean> {
    const zipFilesWithPaths = compressResults.filter(r => r.zipPath !== null);

    if (zipFilesWithPaths.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无ZIP文件需要上传');
      return true;
    }

    try {
      const uploadId = uuidv4();

      logger.info('[STARTUP_UPLOAD] 开始上传ZIP文件', {
        uploadId,
        fileCount: zipFilesWithPaths.length,
        files: zipFilesWithPaths.map(r => ({
          type: r.type,
          size: r.compressedSize
        }))
      });

      // 创建FormData
      const formData = new FormData();

      formData.append('deviceId', this.config.deviceId);
      formData.append('sessionId', this.config.sessionId);
      formData.append('uploadId', uploadId);

      // 添加ZIP文件
      for (const result of zipFilesWithPaths) {
        if (result.zipPath) {
          const fieldName = `${result.type}Zip`;  // screenshotZip, activityZip, processZip
          formData.append(fieldName, fs.createReadStream(result.zipPath));
        }
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
        logger.info('[STARTUP_UPLOAD] 上传成功', {
          uploadId,
          response: response.data
        });
        return true;
      }

      logger.error('[STARTUP_UPLOAD] 上传失败', {
        uploadId,
        status: response.status,
        data: response.data
      });
      return false;

    } catch (error: any) {
      logger.error('[STARTUP_UPLOAD] 上传异常', {
        error: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      return false;
    }
  }
}
```

### 3.2 集成到FSM状态机

**文件路径**: `src/common/services/fsm/state-handlers/ws-check-state-handler.ts`

**状态**: ✅ 已实现 (版本 2.3.3)

#### 实际实现

```typescript
import { StartupUploadService } from '../../startup-upload-service';
import * as path from 'path';
import * as os from 'os';

export class WSCheckStateHandler extends BaseStateHandler {
  // ... (省略其他代码)

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      // 1. 构建WebSocket URL
      const websocketUrl = this.buildSocketIOUrl(config.serverUrl);

      // 2. 测试WebSocket连接
      const connectionResult = await this.testWebSocketConnection(websocketUrl, config.deviceId);

      if (connectionResult.success) {
        console.log('[WS_CHECK] WebSocket connection test successful');

        // 3. ✅ WebSocket连接成功，触发启动上传（非阻塞）
        await this.triggerStartupUpload(config, context);

        // 4. 进入下一个状态
        return {
          success: true,
          nextState: DeviceState.CONFIG_FETCH,
          reason: 'WebSocket connection verified'
        };
      }
    } catch (error: any) {
      console.error('[WS_CHECK] WebSocket check failed:', error);
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `WebSocket check failed: ${error.message}`
      };
    }
  }

  /**
   * 触发启动上传（非阻塞执行）
   */
  private async triggerStartupUpload(config: any, context: FSMContext): Promise<void> {
    try {
      console.log('[WS_CHECK] 触发启动上传检查...');

      // 获取队列缓存目录
      const queueCacheDir = this.getQueueCacheDir();

      // 创建上传服务
      const uploadService = new StartupUploadService({
        apiEndpoint: `${config.serverUrl}/api/startup-upload`,
        deviceId: config.deviceId,
        sessionId: context.sessionId || `session_${Date.now()}`,
        queueCacheDir
      });

      // 非阻塞执行上传（不等待结果）
      uploadService.checkAndUpload().then(() => {
        console.log('[WS_CHECK] 启动上传完成');
      }).catch((error: any) => {
        // 上传失败不影响主流程
        console.error('[WS_CHECK] 启动上传失败', error);
      });

    } catch (error: any) {
      // 启动上传失败不影响主流程
      console.error('[WS_CHECK] 触发启动上传失败', error);
    }
  }

  /**
   * 获取队列缓存目录
   */
  private getQueueCacheDir(): string {
    try {
      const { app } = require('electron');
      const userDataPath = app.getPath('userData');
      return path.join(userDataPath, 'queue-cache');
    } catch (error) {
      const tempDir = os.tmpdir();
      return path.join(tempDir, 'employee-monitor-cache');
    }
  }
}
```

**关键特性**:
- ✅ 非阻塞执行: 启动上传不阻塞FSM状态转换
- ✅ 错误隔离: 上传失败不影响主流程
- ✅ 自动触发: WebSocket连接成功后自动触发

---

## 四、数据采集规范

### 4.1 截图采集

```typescript
// 截图服务示例
class ScreenshotService {
  async captureAndSave(): Promise<void> {
    const timestamp = Date.now();
    const screenshotId = `screenshot_${timestamp}`;

    // 1. 截图
    const screenshot = await this.captureScreen();

    // 2. 压缩为JPEG
    const jpegBuffer = await this.compressToJPEG(screenshot, {
      quality: 75
    });

    // 3. 保存JPEG文件
    const dateDir = this.getDateDirectory();
    const jpegPath = path.join(dateDir, `${screenshotId}.jpg`);
    await fs.writeFile(jpegPath, jpegBuffer);

    // 4. 保存元数据
    const metaPath = path.join(dateDir, `${screenshotId}.meta.json`);
    await fs.writeJson(metaPath, {
      id: screenshotId,
      timestamp,
      bufferPath: `./${screenshotId}.jpg`,
      fileSize: jpegBuffer.length,
      format: 'jpg',
      quality: 75,
      resolution: {
        width: screenshot.width,
        height: screenshot.height
      },
      _metadata: {
        uploadStatus: 'pending',
        createdAt: timestamp
      }
    });

    logger.info('[SCREENSHOT] 截图已保存', {
      screenshotId,
      fileSize: jpegBuffer.length,
      path: jpegPath
    });
  }

  private getDateDirectory(): string {
    const today = new Date().toISOString().split('T')[0];  // 2024-12-24
    const dir = path.join(
      this.queueCacheDir,
      'screenshots',
      today
    );
    fs.ensureDirSync(dir);
    return dir;
  }
}
```

### 4.2 活动数据采集(60秒聚合)

```typescript
// 活动聚合服务示例
class ActivityAggregationService {
  private currentAggregation: {
    startTime: number;
    endTime: number;
    keystrokes: number;
    mouseClicks: number;
    mouseScrolls: number;
    activeWindow: string;
    activeWindowProcess: string;
    url: string;
  } | null = null;

  /**
   * 启动60秒聚合定时器
   */
  startAggregation(): void {
    // 每60秒保存一次聚合数据
    setInterval(() => {
      this.saveAggregation();
    }, 60000);

    // 初始化首个聚合周期
    this.resetAggregation();
  }

  /**
   * 记录用户活动
   */
  recordActivity(event: {
    keystrokes?: number;
    mouseClicks?: number;
    mouseScrolls?: number;
    activeWindow?: string;
    activeWindowProcess?: string;
    url?: string;
  }): void {
    if (!this.currentAggregation) {
      this.resetAggregation();
    }

    // 累加数值
    if (event.keystrokes) {
      this.currentAggregation!.keystrokes += event.keystrokes;
    }
    if (event.mouseClicks) {
      this.currentAggregation!.mouseClicks += event.mouseClicks;
    }
    if (event.mouseScrolls) {
      this.currentAggregation!.mouseScrolls += event.mouseScrolls;
    }

    // 更新最后值
    if (event.activeWindow) {
      this.currentAggregation!.activeWindow = event.activeWindow;
    }
    if (event.activeWindowProcess) {
      this.currentAggregation!.activeWindowProcess = event.activeWindowProcess;
    }
    if (event.url) {
      this.currentAggregation!.url = event.url;
    }
  }

  /**
   * 保存聚合数据
   */
  private async saveAggregation(): Promise<void> {
    if (!this.currentAggregation) {
      return;
    }

    const timestamp = this.currentAggregation.endTime;
    const activityId = `activity_${timestamp}`;

    const activityData = {
      id: activityId,
      timestamp,  // 60秒周期结束时间
      data: {
        keystrokes: this.currentAggregation.keystrokes,
        mouseClicks: this.currentAggregation.mouseClicks,
        mouseScrolls: this.currentAggregation.mouseScrolls,
        activeWindow: this.currentAggregation.activeWindow,
        activeWindowProcess: this.currentAggregation.activeWindowProcess,
        url: this.currentAggregation.url
      },
      _metadata: {
        uploadStatus: 'pending',
        createdAt: timestamp,
        aggregationPeriod: 60000
      }
    };

    // 保存到文件
    const dateDir = this.getDateDirectory();
    const filePath = path.join(dateDir, `${activityId}.json`);
    await fs.writeJson(filePath, activityData);

    logger.info('[ACTIVITY] 聚合数据已保存', {
      activityId,
      keystrokes: activityData.data.keystrokes,
      mouseClicks: activityData.data.mouseClicks,
      path: filePath
    });

    // 重置聚合周期
    this.resetAggregation();
  }

  /**
   * 重置聚合周期
   */
  private resetAggregation(): void {
    const now = Date.now();

    // 计算下一个60秒整点时间
    const nextMinute = Math.ceil(now / 60000) * 60000;

    this.currentAggregation = {
      startTime: now,
      endTime: nextMinute,
      keystrokes: 0,
      mouseClicks: 0,
      mouseScrolls: 0,
      activeWindow: '',
      activeWindowProcess: '',
      url: ''
    };
  }

  private getDateDirectory(): string {
    const today = new Date().toISOString().split('T')[0];
    const dir = path.join(
      this.queueCacheDir,
      'activities',
      today
    );
    fs.ensureDirSync(dir);
    return dir;
  }
}
```

---

## 五、错误处理与重试

### 5.1 上传失败处理

```typescript
// 上传失败时,ZIP文件会保留在queue-cache目录根部
// 下次WebSocket重连时,StartupUploadService会检测到这些ZIP文件并重新上传

async checkAndUpload(): Promise<void> {
  // 1. 检查是否有旧的ZIP文件(上次上传失败留下的)
  const existingZips = await this.findExistingZips();

  if (existingZips.length > 0) {
    logger.info('[STARTUP_UPLOAD] 发现旧ZIP文件,尝试重新上传', {
      zipFiles: existingZips
    });

    // 尝试重新上传
    const uploadSuccess = await this.uploadExistingZips(existingZips);

    if (uploadSuccess) {
      // 上传成功,删除ZIP
      for (const zipPath of existingZips) {
        await fs.remove(zipPath);
      }
    }
  }

  // 2. 继续正常流程...
}
```

### 5.2 网络错误重试

```typescript
// axios重试配置
const axiosRetry = require('axios-retry');

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    return retryCount * 1000;  // 1秒, 2秒, 3秒
  },
  retryCondition: (error) => {
    // 网络错误或5xx错误重试
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
           (error.response && error.response.status >= 500);
  }
});
```

---

## 六、性能优化

### 6.1 压缩级别选择

```typescript
// zlib压缩级别(0-9)
// 0: 不压缩
// 1: 最快速度,最低压缩率
// 6: 平衡(推荐)
// 9: 最高压缩率,最慢速度

const archive = archiver('zip', {
  zlib: { level: 6 }  // 推荐值
});
```

### 6.2 大文件处理

```typescript
// 如果积压数据过大(>100MB),分批上传
const MAX_ZIP_SIZE = 100 * 1024 * 1024;  // 100MB

if (estimatedSize > MAX_ZIP_SIZE) {
  // 分批处理
  await this.compressAndUploadInBatches();
}
```

---

## 七、测试要求

### 7.1 单元测试

```typescript
describe('StartupUploadService', () => {
  it('应该正确统计积压数据', async () => {
    // 测试逻辑
  });

  it('应该正确压缩截图数据', async () => {
    // 测试截图合并逻辑
  });

  it('应该处理上传失败', async () => {
    // 测试错误处理
  });
});
```

### 7.2 集成测试

- 模拟200张截图积压
- 模拟100条活动记录积压
- 测试压缩耗时 <5秒
- 测试上传成功率 >95%

---

## 八、部署清单

### 8.1 依赖安装

**状态**: ✅ 已添加 (版本 2.3.3)

```json
{
  "dependencies": {
    "archiver": "^6.0.0",       // ✅ 已添加
    "axios": "^1.6.0",          // ✅ 已存在
    "form-data": "^4.0.0",      // ✅ 已添加
    "fs-extra": "^11.3.2",      // ✅ 已存在
    "glob": "^10.0.0",          // ✅ 已添加
    "uuid": "^9.0.0"            // ✅ 已存在
  }
}
```

**安装命令**:
```bash
npm install archiver@^6.0.0 form-data@^4.0.0 glob@^10.0.0
```

### 8.2 配置文件

```json
{
  "queueCache": {
    "baseDir": "~/Library/Application Support/employee-safety-client/queue-cache",
    "maxAge": 7,  // 最多保留7天的数据
    "maxSize": 500  // 最多500MB
  },
  "upload": {
    "endpoint": "http://api.example.com/api/startup-upload",
    "timeout": 120000,
    "retries": 3
  }
}
```

---

## 九、FAQ

**Q: 为什么截图要分两个文件存储(.jpg + .meta.json)?**
A: 方便WebSocket实时上传时直接读取JPEG文件,不需要解析JSON。ZIP上传时再合并为一个JSON。

**Q: 活动数据为什么要60秒聚合?**
A: 减少数据量,避免高频写入磁盘,降低数据库插入频率。

**Q: ZIP上传失败后会怎样?**
A: ZIP文件保留在本地,下次WebSocket重连时自动重试。

**Q: 如何避免重复上传?**
A: 后端通过数据库唯一索引保证幂等性,重复数据会被自动跳过。

---

**实施建议**: 先实现截图和活动上传,测试通过后再添加进程数据上传。
