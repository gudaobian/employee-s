/**
 * 队列服务
 *
 * 职责：
 * 1. 初始化三个有界队列（截图、活动、进程）
 * 2. 初始化上传管理器
 * 3. 提供全局访问接口
 * 4. 管理队列生命周期
 *
 * 使用方式：
 * ```typescript
 * import { queueService } from '@common/services/queue-service';
 *
 * // 入队
 * await queueService.enqueueScreenshot(screenshotItem);
 *
 * // 启动上传（WebSocket 连接恢复时）
 * await queueService.startUpload();
 * ```
 */

import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { logger } from '../utils';
import { DiskQueueManager } from './disk-queue-manager';
import { BoundedQueue } from './bounded-queue';
import { UploadManager } from './upload-manager';
import {
  ScreenshotQueueItem,
  ActivityQueueItem,
  ProcessQueueItem,
  DiskQueueConfig
} from '../types/queue-types';

export class QueueService {
  private screenshotQueue!: BoundedQueue<ScreenshotQueueItem>;
  private activityQueue!: BoundedQueue<ActivityQueueItem>;
  private processQueue!: BoundedQueue<ProcessQueueItem>;

  private screenshotDiskManager!: DiskQueueManager<ScreenshotQueueItem>;
  private activityDiskManager!: DiskQueueManager<ActivityQueueItem>;
  private processDiskManager!: DiskQueueManager<ProcessQueueItem>;

  private uploadManager!: UploadManager;
  private websocketService: any;

  private initialized: boolean = false;

  /**
   * 初始化队列服务
   */
  async initialize(websocketService: any): Promise<void> {
    if (this.initialized) {
      logger.warn(`[QueueService] 队列服务已初始化，忽略重复请求`);
      return;
    }

    this.websocketService = websocketService;

    logger.info(`[QueueService] 开始初始化队列服务...`);

    try {
      // 1. 确定缓存目录
      const cacheDir = this.getCacheDirectory();
      logger.info(`[QueueService] 缓存目录: ${cacheDir}`);

      // 2. 创建磁盘队列管理器配置
      const diskConfig: DiskQueueConfig = {
        baseDir: cacheDir,
        maxAge: 7 * 24 * 60 * 60 * 1000,      // 7天
        maxSize: 50 * 1024 * 1024 * 1024,     // 50GB
        cleanupInterval: 60 * 60 * 1000        // 1小时
      };

      // 3. 创建三个磁盘队列管理器
      this.screenshotDiskManager = new DiskQueueManager<ScreenshotQueueItem>(diskConfig, 'screenshot');
      this.activityDiskManager = new DiskQueueManager<ActivityQueueItem>(diskConfig, 'activity');
      this.processDiskManager = new DiskQueueManager<ProcessQueueItem>(diskConfig, 'process');

      // 4. 创建三个有界队列
      // ✅ 统一队列容量为 5 (快速溢出到磁盘，便于测试ZIP上传)
      this.screenshotQueue = new BoundedQueue<ScreenshotQueueItem>({
        capacity: 5,  // 容纳5张截图 (约125KB内存)
        type: 'screenshot',
        diskManager: this.screenshotDiskManager
      });

      this.activityQueue = new BoundedQueue<ActivityQueueItem>({
        capacity: 5,  // 容纳5条活动数据 (约2.5KB内存)
        type: 'activity',
        diskManager: this.activityDiskManager
      });

      this.processQueue = new BoundedQueue<ProcessQueueItem>({
        capacity: 5,  // 容纳5条进程数据 (约5KB内存)
        type: 'process',
        diskManager: this.processDiskManager
      });

      // 5. 创建上传管理器
      this.uploadManager = new UploadManager({
        screenshotQueue: this.screenshotQueue,
        activityQueue: this.activityQueue,
        processQueue: this.processQueue,
        websocketService: this.websocketService,
        retryDelay: 5000,
        maxRetries: 3,
        concurrency: 1  // ✅ 串行上传：逐个上传，简单可靠（上传速率 >> 生产速率）
      });

      // 6. 监听上传事件
      this.setupUploadListeners();

      this.initialized = true;

      logger.info(`[QueueService] ✅ 队列服务初始化成功`, {
        cacheDir,
        queueCapacity: 5,  // ✅ 所有队列容量统一为5
        maxAge: '7天',
        maxSize: '50GB'
      });

      // 7. 打印当前队列状态
      await this.printStats();
    } catch (error: any) {
      logger.error(`[QueueService] ❌ 队列服务初始化失败`, error);
      throw error;
    }
  }

  /**
   * 获取缓存目录
   */
  private getCacheDirectory(): string {
    try {
      // 优先使用 userData 目录
      const userDataPath = app.getPath('userData');
      return path.join(userDataPath, 'queue-cache');
    } catch (error) {
      // 如果 app.getPath 不可用（非 Electron 环境），使用临时目录
      const tempDir = os.tmpdir();
      return path.join(tempDir, 'employee-monitor-cache');
    }
  }

  /**
   * 设置上传监听器
   */
  private setupUploadListeners(): void {
    this.uploadManager.on('upload-started', () => {
      logger.info(`[QueueService] 📤 上传循环已启动`);
    });

    this.uploadManager.on('upload-completed', (data: any) => {
      logger.info(`[QueueService] ✅ 上传循环已完成`, data);
    });

    this.uploadManager.on('upload-failed', (data: any) => {
      logger.error(`[QueueService] ❌ 上传循环失败`, data);
    });

    this.uploadManager.on('item-uploaded', (data: any) => {
      logger.info(`[QueueService] ✅ 项目上传成功`, data);
    });

    this.uploadManager.on('item-upload-failed', (data: any) => {
      logger.warn(`[QueueService] ⚠️  项目上传失败`, data);
    });
  }

  /**
   * 入队截图（改进版：入队后主动触发上传）
   */
  async enqueueScreenshot(item: ScreenshotQueueItem): Promise<void> {
    this.ensureInitialized();
    await this.screenshotQueue.enqueue(item);

    // 入队后，如果条件满足，立即触发上传
    await this.tryTriggerUpload('screenshot');
  }

  /**
   * 入队活动数据（改进版：入队后主动触发上传）
   */
  async enqueueActivity(item: ActivityQueueItem): Promise<void> {
    this.ensureInitialized();
    await this.activityQueue.enqueue(item);

    // 入队后，如果条件满足，立即触发上传
    await this.tryTriggerUpload('activity');
  }

  /**
   * 入队进程数据（改进版：入队后主动触发上传）
   */
  async enqueueProcess(item: ProcessQueueItem): Promise<void> {
    this.ensureInitialized();
    await this.processQueue.enqueue(item);

    // 入队后，如果条件满足，立即触发上传
    await this.tryTriggerUpload('process');
  }

  /**
   * 尝试触发上传（如果条件满足）
   */
  private async tryTriggerUpload(type: string): Promise<void> {
    // 检查条件：已连接 + 未在上传
    if (this.websocketService &&
        this.websocketService.isConnected() &&
        !this.uploadManager.isUploading()) {

      logger.info(`[QueueService] ${type} 数据入队，主动触发上传`, {
        type
      });

      // 非阻塞触发上传（不等待完成）
      this.uploadManager.startUpload().catch((error: any) => {
        logger.error(`[QueueService] 主动触发上传失败`, error, {
          type
        });
      });
    }
  }

  /**
   * 启动上传循环
   * 在 WebSocket 连接恢复时调用
   */
  async startUpload(): Promise<void> {
    this.ensureInitialized();

    if (!this.websocketService || !this.websocketService.isConnected()) {
      logger.warn(`[QueueService] WebSocket 未连接，无法启动上传`);
      return;
    }

    logger.info(`[QueueService] 🚀 启动上传循环...`);
    await this.uploadManager.startUpload();
  }

  /**
   * 停止上传循环
   */
  stopUpload(): void {
    this.ensureInitialized();
    this.uploadManager.stopUpload();
  }

  /**
   * 获取队列统计信息
   */
  async getStats() {
    this.ensureInitialized();
    return await this.uploadManager.getQueueStats();
  }

  /**
   * 打印队列统计信息
   */
  async printStats(): Promise<void> {
    try {
      const stats = await this.getStats();

      logger.info(`[QueueService] 📊 队列统计信息`, {
        screenshot: {
          memory: stats.screenshot.memory,
          disk: stats.screenshot.disk,
          memorySize: `${(stats.screenshot.memorySize / 1024 / 1024).toFixed(2)} MB`,
          diskSize: `${(stats.screenshot.diskSize / 1024 / 1024).toFixed(2)} MB`
        },
        activity: {
          memory: stats.activity.memory,
          disk: stats.activity.disk,
          diskSize: `${(stats.activity.diskSize / 1024).toFixed(2)} KB`
        },
        process: {
          memory: stats.process.memory,
          disk: stats.process.disk,
          diskSize: `${(stats.process.diskSize / 1024).toFixed(2)} KB`
        }
      });
    } catch (error: any) {
      logger.error(`[QueueService] 打印统计信息失败`, error);
    }
  }

  /**
   * 判断是否正在上传
   */
  isUploading(): boolean {
    this.ensureInitialized();
    return this.uploadManager.isUploading();
  }

  /**
   * 获取上传统计
   */
  getUploadStats() {
    this.ensureInitialized();
    return this.uploadManager.getStats();
  }

  /**
   * 停止队列服务
   */
  stop(): void {
    if (!this.initialized) return;

    logger.info(`[QueueService] 停止队列服务...`);

    this.uploadManager.stopUpload();
    this.screenshotQueue.stop();
    this.activityQueue.stop();
    this.processQueue.stop();

    this.initialized = false;

    logger.info(`[QueueService] ✅ 队列服务已停止`);
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[QueueService] 队列服务未初始化，请先调用 initialize()');
    }
  }

  /**
   * 获取队列实例（用于高级操作）
   */
  getQueues() {
    this.ensureInitialized();
    return {
      screenshot: this.screenshotQueue,
      activity: this.activityQueue,
      process: this.processQueue
    };
  }

  /**
   * 获取上传管理器实例（用于高级操作）
   */
  getUploadManager() {
    this.ensureInitialized();
    return this.uploadManager;
  }
}

// 导出单例
export const queueService = new QueueService();
