/**
 * 上传管理器
 *
 * 职责：
 * 1. WebSocket 连接恢复时启动上传循环
 * 2. 从队列中取出项目并上传
 * 3. 上传成功 → 删除磁盘文件
 * 4. 上传失败 → 重新入队 + 退避重试
 * 5. 队列清空后结束循环
 *
 * 上传流程：
 * 1. queue.dequeue() → 获取最旧项目
 * 2. websocketService.send() → 上传
 * 3. 成功: diskManager.delete() → 删除磁盘文件
 * 4. 失败: queue.enqueue() → 重新入队
 * 5. 循环直到 queue.isEmpty()
 */

import { EventEmitter } from 'events';
import { logger } from '../utils';
import { BoundedQueue } from './bounded-queue';
import {
  ScreenshotQueueItem,
  ActivityQueueItem,
  ProcessQueueItem,
  UploadManagerConfig,
  UploadResult
} from '../types/queue-types';

export class UploadManager extends EventEmitter {
  private screenshotQueue: BoundedQueue<ScreenshotQueueItem>;
  private activityQueue: BoundedQueue<ActivityQueueItem>;
  private processQueue: BoundedQueue<ProcessQueueItem>;
  private websocketService: any;

  private retryDelay: number;
  private maxRetries: number;
  private concurrency: number;

  private uploading: boolean = false;
  private uploadStats = {
    screenshot: { success: 0, failed: 0, total: 0 },
    activity: { success: 0, failed: 0, total: 0 },
    process: { success: 0, failed: 0, total: 0 }
  };

  constructor(config: UploadManagerConfig) {
    super();

    this.screenshotQueue = config.screenshotQueue;
    this.activityQueue = config.activityQueue;
    this.processQueue = config.processQueue;
    this.websocketService = config.websocketService;

    this.retryDelay = config.retryDelay || 5000; // 5秒
    this.maxRetries = config.maxRetries || 3;
    this.concurrency = config.concurrency || 1; // 串行上传

    logger.info(`[UploadManager] 上传管理器已初始化`, {
      retryDelay: `${this.retryDelay / 1000}秒`,
      maxRetries: this.maxRetries,
      concurrency: this.concurrency
    });
  }

  /**
   * 启动上传循环
   * 在 WebSocket 连接恢复时调用
   */
  async startUpload(): Promise<void> {
    if (this.uploading) {
      logger.warn(`[UploadManager] 上传已在进行中，忽略重复请求`);
      return;
    }

    if (!this.websocketService || !this.websocketService.isConnected()) {
      logger.warn(`[UploadManager] WebSocket 未连接，无法启动上传`);
      return;
    }

    this.uploading = true;
    this.resetStats();

    logger.info(`[UploadManager] 🚀 开始上传循环...`);
    this.emit('upload-started');

    const startTime = Date.now();

    try {
      // 并行上传三种数据类型
      await Promise.all([
        this.uploadLoop('screenshot', this.screenshotQueue),
        this.uploadLoop('activity', this.activityQueue),
        this.uploadLoop('process', this.processQueue)
      ]);

      const duration = Date.now() - startTime;
      logger.info(`[UploadManager] ✅ 所有数据上传完成`, {
        duration: `${(duration / 1000).toFixed(1)}秒`,
        stats: this.uploadStats
      });

      this.emit('upload-completed', {
        duration,
        stats: this.uploadStats
      });
    } catch (error: any) {
      logger.error(`[UploadManager] ❌ 上传循环失败`, error);
      this.emit('upload-failed', { error: error.message });
    } finally {
      this.uploading = false;
    }
  }

  /**
   * 停止上传循环
   */
  stopUpload(): void {
    if (!this.uploading) {
      logger.warn(`[UploadManager] 上传未在进行中`);
      return;
    }

    logger.warn(`[UploadManager] 停止上传循环`);
    this.uploading = false;
    this.emit('upload-stopped');
  }

  /**
   * 上传循环（单个数据类型）- 支持并发上传
   */
  private async uploadLoop(
    type: 'screenshot' | 'activity' | 'process',
    queue: BoundedQueue<any>
  ): Promise<void> {
    logger.info(`[UploadManager] ${type} 上传循环开始`, {
      concurrency: this.concurrency
    });

    let consecutiveFailures = 0;

    while (this.uploading) {
      try {
        // 检查队列是否为空
        const isEmpty = await queue.isEmpty();
        if (isEmpty) {
          logger.info(`[UploadManager] ${type} 队列已清空，结束循环`);
          break;
        }

        // 检查 WebSocket 是否仍然连接
        if (!this.websocketService.isConnected()) {
          logger.warn(`[UploadManager] WebSocket 断开，暂停 ${type} 上传`);
          break;
        }

        // ✅ 并发上传：一次取出多个项目并行上传
        const batch: any[] = [];
        for (let i = 0; i < this.concurrency; i++) {
          const item = await queue.dequeue();
          if (item) {
            batch.push(item);
          } else {
            break; // 队列已空
          }
        }

        if (batch.length === 0) {
          logger.info(`[UploadManager] ${type} 队列为空，结束循环`);
          break;
        }

        logger.info(`[UploadManager] ${type} 批量上传 ${batch.length} 个项目 (并发: ${this.concurrency})`);
        this.uploadStats[type].total += batch.length;

        // ✅ 并行上传整个批次
        const results = await Promise.allSettled(
          batch.map(item => this.uploadItem(type, item))
        );

        // ✅ 处理每个上传结果
        let batchSuccessCount = 0;
        let batchFailureCount = 0;

        for (let i = 0; i < results.length; i++) {
          const settledResult = results[i];
          const item = batch[i];

          if (settledResult.status === 'fulfilled' && settledResult.value.success) {
            // 上传成功：删除磁盘文件
            try {
              await queue.deleteFromDisk(item.id);
            } catch (error) {
              logger.warn(`[UploadManager] 删除磁盘文件失败，可能已被删除`, {
                type,
                itemId: item.id
              });
            }

            this.uploadStats[type].success++;
            batchSuccessCount++;

            this.emit('item-uploaded', {
              type,
              itemId: item.id,
              success: true
            });
          } else {
            // 上传失败处理
            const error = settledResult.status === 'rejected'
              ? settledResult.reason
              : (settledResult.value as any).error;

            const errorMsg = String(error?.message || error || '');
            const errorCode = String(error?.code || '');

            // 判断失败原因类型
            const isDuplicate = this.isDuplicateError(errorMsg, errorCode);
            const isNetworkError = this.isNetworkError(errorMsg, errorCode);

            if (isDuplicate) {
              // ✅ 数据已存在（唯一索引冲突）：删除本地副本，计入成功
              logger.info(`[UploadManager] ${type} 数据已存在于服务器，删除本地副本`, {
                itemId: item.id,
                error: errorMsg
              });

              try {
                await queue.deleteFromDisk(item.id);
              } catch (deleteError) {
                logger.warn(`[UploadManager] 删除磁盘文件失败（可能已删除）`, {
                  type,
                  itemId: item.id
                });
              }

              // 计入成功（数据已在服务器）
              this.uploadStats[type].success++;
              batchSuccessCount++;

              this.emit('item-uploaded', {
                type,
                itemId: item.id,
                success: true,
                fromServer: true  // 标记为服务器已有
              });
            } else if (type === 'process') {
              // ✅ 进程数据上传失败：直接丢弃（不重试）
              logger.warn(`[UploadManager] ⚠️ 进程数据上传失败，已丢弃（不重试）`, {
                itemId: item.id,
                error: errorMsg
              });

              this.uploadStats[type].failed++;
              batchFailureCount++;

              try {
                await queue.deleteFromDisk(item.id);
              } catch (deleteError) {
                // 忽略删除错误
              }

              this.emit('item-upload-failed', {
                type,
                itemId: item.id,
                error: errorMsg,
                discarded: true
              });
            } else {
              // ✅ 截图和活动数据：网络/服务器错误则重新入队重试
              if (isNetworkError) {
                logger.warn(`[UploadManager] ⚠️ ${type} 网络/服务器错误，重新入队重试`, {
                  itemId: item.id,
                  error: errorMsg
                });
              } else {
                logger.error(`[UploadManager] ❌ ${type} 未知错误，重新入队重试`, {
                  itemId: item.id,
                  error: errorMsg
                });
              }

              this.uploadStats[type].failed++;
              batchFailureCount++;

              // 重新入队（会溢出到磁盘）
              await queue.enqueue(item);

              this.emit('item-upload-failed', {
                type,
                itemId: item.id,
                error: errorMsg,
                discarded: false
              });
            }
          }
        }

        // 更新连续失败计数
        if (batchSuccessCount > 0) {
          consecutiveFailures = 0; // 有成功的，重置计数
        } else {
          consecutiveFailures += batchFailureCount; // 全部失败，累加
        }

        const remaining = await queue.totalSize();
        logger.info(`[UploadManager] ${type} 批次上传完成`, {
          success: batchSuccessCount,
          failed: batchFailureCount,
          remaining
        });

        // 如果批次全部失败，延长等待时间
        if (batchFailureCount > 0 && batchSuccessCount === 0) {
          const backoffDelay = this.retryDelay * Math.min(consecutiveFailures, 5);
          logger.warn(`[UploadManager] ${type} 批次全部失败，等待 ${backoffDelay}ms`);
          await this.delay(backoffDelay);

          // 如果连续失败超过阈值，等待更长时间后重置并继续
          if (consecutiveFailures >= this.maxRetries) {
            const pauseDuration = 60000; // 60秒暂停
            logger.warn(`[UploadManager] ${type} 连续失败 ${consecutiveFailures} 次，暂停 ${pauseDuration / 1000}秒后重试`, {
              reason: '达到最大重试次数，等待网络恢复或问题解决'
            });

            await this.delay(pauseDuration);

            // 暂停后检查WebSocket是否仍然连接
            if (!this.websocketService.isConnected()) {
              logger.warn(`[UploadManager] WebSocket 已断开，停止 ${type} 上传循环`);
              break;
            }

            // 重置连续失败计数器，继续尝试
            consecutiveFailures = 0;
            logger.info(`[UploadManager] ${type} 重置失败计数器，继续上传循环`);
          }
        }
      } catch (error: any) {
        logger.error(`[UploadManager] ${type} 上传循环异常`, error);
        await this.delay(this.retryDelay);
      }
    }

    logger.info(`[UploadManager] ${type} 上传循环结束`, {
      stats: this.uploadStats[type]
    });
  }

  /**
   * 上传单个项目
   */
  private async uploadItem(
    type: 'screenshot' | 'activity' | 'process',
    item: any
  ): Promise<UploadResult> {
    const startTime = Date.now();

    try {
      if (type === 'screenshot') {
        await this.uploadScreenshot(item as ScreenshotQueueItem);
      } else if (type === 'activity') {
        await this.uploadActivity(item as ActivityQueueItem);
      } else if (type === 'process') {
        await this.uploadProcess(item as ProcessQueueItem);
      }

      return {
        success: true,
        itemId: item.id,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        itemId: item.id,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 上传截图
   */
  private async uploadScreenshot(item: ScreenshotQueueItem): Promise<void> {
    await this.websocketService.sendScreenshotData({
      screenshotId: item.id,      // ✅ 发送唯一ID，用于服务器端幂等性检查
      buffer: item.buffer,
      timestamp: item.timestamp,
      fileSize: item.fileSize
    });

    logger.info(`[UploadManager] 截图上传成功`, {
      itemId: item.id,
      screenshotId: item.id,      // 日志中记录截图ID便于追踪
      fileSize: `${(item.fileSize / 1024 / 1024).toFixed(2)} MB`,
      timestamp: item.timestamp
    });
  }

  /**
   * 上传活动数据
   */
  private async uploadActivity(item: ActivityQueueItem): Promise<void> {
    await this.websocketService.sendActivityData({
      activityId: item.id,        // ✅ 发送唯一ID，用于服务器端幂等性检查
      ...item.data
    });

    logger.info(`[UploadManager] 活动数据上传成功`, {
      itemId: item.id,
      activityId: item.id,        // 日志中记录活动ID便于追踪
      timestamp: item.timestamp
    });
  }

  /**
   * 上传进程数据
   */
  private async uploadProcess(item: ProcessQueueItem): Promise<void> {
    await this.websocketService.sendSystemData({
      processId: item.id,         // ✅ 发送唯一ID，用于服务器端幂等性检查
      ...item.data
    });

    logger.info(`[UploadManager] 进程数据上传成功`, {
      itemId: item.id,
      processId: item.id,         // 日志中记录进程ID便于追踪
      timestamp: item.timestamp
    });
  }

  /**
   * 获取上传状态
   */
  isUploading(): boolean {
    return this.uploading;
  }

  /**
   * 获取上传统计
   */
  getStats() {
    return { ...this.uploadStats };
  }

  /**
   * 重置统计
   */
  private resetStats(): void {
    this.uploadStats = {
      screenshot: { success: 0, failed: 0, total: 0 },
      activity: { success: 0, failed: 0, total: 0 },
      process: { success: 0, failed: 0, total: 0 }
    };
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取队列统计信息
   */
  async getQueueStats() {
    const [screenshotStats, activityStats, processStats] = await Promise.all([
      this.screenshotQueue.stats(),
      this.activityQueue.stats(),
      this.processQueue.stats()
    ]);

    return {
      screenshot: screenshotStats,
      activity: activityStats,
      process: processStats
    };
  }

  /**
   * 判断是否为唯一索引冲突错误
   */
  private isDuplicateError(errorMsg: string, errorCode: string): boolean {
    const duplicateKeywords = [
      'duplicate',
      '重复',
      '已存在',
      'unique constraint',
      'UNIQUE constraint',
      'duplicate key',
      'already exists',
      'constraint violation'
    ];

    const msgLower = errorMsg.toLowerCase();
    const codeLower = errorCode.toLowerCase();

    return duplicateKeywords.some(keyword =>
      msgLower.includes(keyword.toLowerCase()) || codeLower.includes(keyword.toLowerCase())
    );
  }

  /**
   * 判断是否为网络/服务器错误
   */
  private isNetworkError(errorMsg: string, errorCode: string): boolean {
    const networkKeywords = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'timeout',
      'network',
      '网络',
      '500',
      '502',
      '503',
      '504',
      'Internal Server Error',
      'Bad Gateway',
      'Service Unavailable',
      'Gateway Timeout'
    ];

    const msgLower = errorMsg.toLowerCase();
    const codeLower = errorCode.toLowerCase();

    return networkKeywords.some(keyword =>
      msgLower.includes(keyword.toLowerCase()) || codeLower.includes(keyword.toLowerCase())
    );
  }
}
