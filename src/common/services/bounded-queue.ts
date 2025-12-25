/**
 * 有界队列（容量5）
 *
 * 核心逻辑：
 * 1. 入队：队列满 → 溢出最旧的到磁盘 → 加入新项目
 * 2. 出队：队列空 → 从磁盘加载最旧的 → 返回
 * 3. 内存占用：固定 ≤ 100 MB (5 × 20 MB)
 *
 * FIFO策略：
 * - 内存队列：先进先出
 * - 磁盘队列：按时间戳排序，最旧的优先
 */

import { logger } from '../utils';
import { DiskQueueManager } from './disk-queue-manager';
import {
  AnyQueueItem,
  BoundedQueueConfig,
  QueueStats
} from '../types/queue-types';

export class BoundedQueue<T extends AnyQueueItem> {
  private queue: T[] = [];
  private readonly capacity: number;
  private readonly type: string;
  private diskManager: DiskQueueManager<T>;
  private isProcessing: boolean = false;

  constructor(config: BoundedQueueConfig) {
    this.capacity = config.capacity || 5;
    this.type = config.type;
    this.diskManager = config.diskManager;

    logger.info(`[BoundedQueue] ${this.type} 队列已初始化`, {
      capacity: this.capacity
    });
  }

  /**
   * 入队
   * 如果队列满，将最旧的项目溢出到磁盘
   */
  async enqueue(item: T): Promise<void> {
    try {
      // 如果队列满，溢出到磁盘
      if (this.queue.length >= this.capacity) {
        const overflow = this.queue.shift(); // FIFO：移除最旧的

        if (overflow) {
          await this.diskManager.write(overflow);

          const diskCount = await this.diskManager.count();
          logger.info(`[BoundedQueue] 队列满，溢出到磁盘`, {
            type: this.type,
            overflowId: overflow.id,
            queueSize: this.queue.length,
            diskSize: diskCount
          });
        }
      }

      // 入队新项目
      this.queue.push(item);

      logger.info(`[BoundedQueue] 入队成功`, {
        type: this.type,
        itemId: item.id,
        queueSize: this.queue.length,
        capacity: this.capacity
      });
    } catch (error: any) {
      logger.error(`[BoundedQueue] 入队失败`, error, {
        type: this.type,
        itemId: item.id
      });
      throw error;
    }
  }

  /**
   * 出队（改进版：主动填充策略）
   * 1. 检查内存队列剩余空间
   * 2. 从磁盘预加载数据填充到内存（并删除磁盘文件）
   * 3. 从内存队列返回
   */
  async dequeue(): Promise<T | null> {
    try {
      // 主动填充：如果内存队列未满，从磁盘加载数据
      const remainingSpace = this.capacity - this.queue.length;

      if (remainingSpace > 0) {
        const diskCount = await this.diskManager.count();

        if (diskCount > 0) {
          const loadCount = Math.min(remainingSpace, diskCount);

          logger.info(`[BoundedQueue] 主动填充：从磁盘加载 ${loadCount} 个项目到内存`, {
            type: this.type,
            remainingSpace,
            diskCount,
            loadCount
          });

          // 批量加载并删除磁盘文件
          for (let i = 0; i < loadCount; i++) {
            const diskItem = await this.diskManager.readOldest();

            if (diskItem) {
              this.queue.push(diskItem);

              // 立即删除磁盘文件（已加载到内存）
              await this.diskManager.delete(diskItem.id);

              logger.info(`[BoundedQueue] 磁盘文件已加载并删除`, {
                type: this.type,
                itemId: diskItem.id
              });
            }
          }
        }
      }

      // 从内存队列取出
      if (this.queue.length > 0) {
        const item = this.queue.shift();
        logger.info(`[BoundedQueue] 出队成功（内存）`, {
          type: this.type,
          itemId: item?.id,
          remaining: this.queue.length
        });
        return item || null;
      }

      // 内存和磁盘都空
      logger.info(`[BoundedQueue] 队列为空`, { type: this.type });
      return null;
    } catch (error: any) {
      logger.error(`[BoundedQueue] 出队失败`, error, {
        type: this.type
      });
      return null;
    }
  }

  /**
   * 查看队首元素（不出队）
   */
  async peek(): Promise<T | null> {
    if (this.queue.length > 0) {
      return this.queue[0];
    }

    // 内存队列空，查看磁盘最旧的
    return await this.diskManager.readOldest();
  }

  /**
   * 获取队列统计信息
   */
  async stats(): Promise<QueueStats> {
    const memoryCount = this.queue.length;
    const diskCount = await this.diskManager.count();

    // 计算内存占用（估算）
    const avgItemSize = this.type === 'screenshot' ? 20 * 1024 * 1024 : 10 * 1024; // 20MB 或 10KB
    const memorySize = memoryCount * avgItemSize;
    const diskSize = await this.diskManager.size();

    return {
      memory: memoryCount,
      disk: diskCount,
      memorySize,
      diskSize
    };
  }

  /**
   * 清空队列（慎用！）
   */
  async clear(): Promise<void> {
    logger.warn(`[BoundedQueue] 清空队列`, {
      type: this.type,
      memoryItems: this.queue.length
    });

    this.queue = [];
  }

  /**
   * 判断队列是否为空（内存+磁盘）
   */
  async isEmpty(): Promise<boolean> {
    const stats = await this.stats();
    return stats.memory === 0 && stats.disk === 0;
  }

  /**
   * 判断队列是否满
   */
  isFull(): boolean {
    return this.queue.length >= this.capacity;
  }

  /**
   * 获取内存队列长度
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * 获取磁盘队列长度
   */
  async diskSize(): Promise<number> {
    return await this.diskManager.count();
  }

  /**
   * 获取总长度（内存+磁盘）
   */
  async totalSize(): Promise<number> {
    const diskCount = await this.diskManager.count();
    return this.queue.length + diskCount;
  }

  /**
   * 删除磁盘中的项目（上传成功后调用）
   */
  async deleteFromDisk(id: string): Promise<void> {
    try {
      await this.diskManager.delete(id);
      logger.info(`[BoundedQueue] 从磁盘删除`, {
        type: this.type,
        itemId: id
      });
    } catch (error: any) {
      logger.error(`[BoundedQueue] 从磁盘删除失败`, error, {
        type: this.type,
        itemId: id
      });
      throw error;
    }
  }

  /**
   * 停止队列（清理资源）
   */
  stop(): void {
    this.diskManager.stop();
    logger.info(`[BoundedQueue] 队列已停止`, { type: this.type });
  }

  /**
   * 获取磁盘管理器（用于上传管理器）
   */
  getDiskManager(): DiskQueueManager<T> {
    return this.diskManager;
  }
}
