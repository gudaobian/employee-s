/**
 * 磁盘队列管理器
 *
 * 职责：
 * 1. 将内存队列溢出的项目持久化到磁盘
 * 2. 从磁盘读取最旧的项目加载到内存队列
 * 3. 上传成功后删除磁盘文件
 * 4. 定期清理过期文件（7天前）
 *
 * 目录结构：
 * /cache/
 *   ├── screenshots/
 *   │   ├── 2025-12-24/
 *   │   │   ├── screenshot_1703401200000.jpg
 *   │   │   └── screenshot_1703401200000.meta.json
 *   │   └── 2025-12-25/
 *   ├── activities/
 *   │   └── 2025-12-24/
 *   │       └── activity_1703401200000.json
 *   └── processes/
 *       └── 2025-12-24/
 *           └── process_1703401200000.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils';
import {
  AnyQueueItem,
  ScreenshotQueueItem,
  ActivityQueueItem,
  ProcessQueueItem,
  DiskFileMetadata,
  DiskQueueConfig
} from '../types/queue-types';

export class DiskQueueManager<T extends AnyQueueItem> {
  private baseDir: string;
  private type: 'screenshots' | 'activities' | 'processes';
  private maxAge: number;
  private maxSize: number;
  private cleanupInterval: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: DiskQueueConfig, type: 'screenshot' | 'activity' | 'process') {
    this.baseDir = path.join(config.baseDir, this.getTypePlural(type));
    this.type = this.getTypePlural(type);
    this.maxAge = config.maxAge || 7 * 24 * 60 * 60 * 1000; // 7天
    this.maxSize = config.maxSize || 50 * 1024 * 1024 * 1024; // 50GB
    this.cleanupInterval = config.cleanupInterval || 60 * 60 * 1000; // 1小时

    this.ensureBaseDirectory();
    this.startCleanupTask();

    logger.info(`[DiskQueue] ${type} 队列管理器已初始化`, {
      baseDir: this.baseDir,
      maxAge: `${this.maxAge / (24 * 60 * 60 * 1000)} 天`,
      maxSize: `${this.maxSize / (1024 * 1024 * 1024)} GB`
    });
  }

  /**
   * 写入项目到磁盘
   */
  async write(item: T): Promise<void> {
    try {
      const date = new Date(item.timestamp);
      const dateStr = this.formatDate(date);
      const dayDir = path.join(this.baseDir, dateStr);

      // 确保日期目录存在
      await fs.promises.mkdir(dayDir, { recursive: true });

      if (item.type === 'screenshot') {
        await this.writeScreenshot(item as ScreenshotQueueItem, dayDir);
      } else {
        await this.writeJson(item, dayDir);
      }

      logger.info(`[DiskQueue] 写入成功: ${item.id}`, {
        type: item.type,
        timestamp: item.timestamp,
        dir: dayDir
      });
    } catch (error: any) {
      logger.error(`[DiskQueue] 写入失败: ${item.id}`, error);
      throw error;
    }
  }

  /**
   * 写入截图数据（二进制 + 元数据）
   */
  private async writeScreenshot(item: ScreenshotQueueItem, dir: string): Promise<void> {
    const filename = `${item.id}.jpg`;
    const filePath = path.join(dir, filename);
    const metaPath = path.join(dir, `${item.id}.meta.json`);

    // 写入图片数据
    const buffer = Buffer.from(item.buffer, 'base64');
    await fs.promises.writeFile(filePath, buffer);

    // 写入元数据
    const metadata: DiskFileMetadata = {
      id: item.id,
      timestamp: item.timestamp,
      type: 'screenshot',
      filePath,
      metaPath,
      fileSize: buffer.length,
      uploadStatus: 'pending',
      uploadAttempts: 0,
      lastUploadAttempt: null,
      createdAt: Date.now()
    };

    await fs.promises.writeFile(metaPath, JSON.stringify(metadata, null, 2));

    logger.info(`[DiskQueue] 截图写入成功`, {
      id: item.id,
      fileSize: `${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
      filePath
    });
  }

  /**
   * 写入 JSON 数据（活动/进程）
   */
  private async writeJson(item: ActivityQueueItem | ProcessQueueItem, dir: string): Promise<void> {
    const filename = `${item.id}.json`;
    const filePath = path.join(dir, filename);

    const dataWithMeta = {
      ...item,
      _metadata: {
        uploadStatus: 'pending',
        uploadAttempts: 0,
        lastUploadAttempt: null,
        createdAt: Date.now()
      }
    };

    await fs.promises.writeFile(filePath, JSON.stringify(dataWithMeta, null, 2));

    logger.info(`[DiskQueue] JSON写入成功`, {
      id: item.id,
      type: item.type,
      filePath
    });
  }

  /**
   * 读取最旧的项目
   */
  async readOldest(): Promise<T | null> {
    try {
      const files = await this.listAll();

      if (files.length === 0) {
        logger.info(`[DiskQueue] 磁盘队列为空`);
        return null;
      }

      // 按时间戳排序，取最旧的
      files.sort((a, b) => a.timestamp - b.timestamp);
      const oldest = files[0];

      const item = await this.read(oldest.filePath, oldest.type);
      logger.info(`[DiskQueue] 读取最旧项目: ${oldest.id}`, {
        timestamp: oldest.timestamp,
        age: `${((Date.now() - oldest.timestamp) / 1000 / 60).toFixed(1)} 分钟前`
      });

      return item as T;
    } catch (error: any) {
      logger.error(`[DiskQueue] 读取最旧项目失败`, error);
      return null;
    }
  }

  /**
   * 读取指定文件
   */
  private async read(filePath: string, type: string): Promise<AnyQueueItem> {
    if (type === 'screenshot') {
      return await this.readScreenshot(filePath);
    } else {
      return await this.readJson(filePath);
    }
  }

  /**
   * 读取截图文件
   */
  private async readScreenshot(filePath: string): Promise<ScreenshotQueueItem> {
    const buffer = await fs.promises.readFile(filePath);
    const metaPath = filePath.replace(/\.jpg$/, '.meta.json');
    const metaContent = await fs.promises.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent) as DiskFileMetadata;

    return {
      id: meta.id,
      timestamp: meta.timestamp,
      type: 'screenshot',
      buffer: buffer.toString('base64'),
      fileSize: buffer.length,
      format: 'jpg',
      quality: 10, // 默认值
      resolution: { width: 1280, height: 720 } // 默认值
    };
  }

  /**
   * 读取 JSON 文件
   */
  private async readJson(filePath: string): Promise<ActivityQueueItem | ProcessQueueItem> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // 移除元数据字段
    delete data._metadata;

    return data;
  }

  /**
   * 删除已上传的项目
   */
  async delete(id: string): Promise<void> {
    try {
      const files = await this.listAll();
      const target = files.find(f => f.id === id);

      if (!target) {
        logger.warn(`[DiskQueue] 删除失败，项目不存在: ${id}`);
        return;
      }

      // 删除数据文件
      await fs.promises.unlink(target.filePath);

      // 删除元数据文件（仅截图）
      if (target.metaPath) {
        await fs.promises.unlink(target.metaPath).catch(() => {});
      }

      logger.info(`[DiskQueue] 删除成功: ${id}`, {
        filePath: target.filePath
      });
    } catch (error: any) {
      logger.error(`[DiskQueue] 删除失败: ${id}`, error);
      throw error;
    }
  }

  /**
   * 统计磁盘队列数量
   */
  async count(): Promise<number> {
    try {
      const files = await this.listAll();
      return files.length;
    } catch (error: any) {
      logger.error(`[DiskQueue] 统计失败`, error);
      return 0;
    }
  }

  /**
   * 统计磁盘占用大小
   */
  async size(): Promise<number> {
    try {
      const files = await this.listAll();
      return files.reduce((sum, file) => sum + file.fileSize, 0);
    } catch (error: any) {
      logger.error(`[DiskQueue] 计算大小失败`, error);
      return 0;
    }
  }

  /**
   * 列出所有文件
   */
  private async listAll(): Promise<DiskFileMetadata[]> {
    const result: DiskFileMetadata[] = [];

    try {
      if (!fs.existsSync(this.baseDir)) {
        return result;
      }

      const dirs = await fs.promises.readdir(this.baseDir);

      for (const dir of dirs) {
        const dirPath = path.join(this.baseDir, dir);
        const stat = await fs.promises.stat(dirPath).catch(() => null);

        if (stat && stat.isDirectory()) {
          const files = await fs.promises.readdir(dirPath);

          for (const file of files) {
            // 跳过元数据文件
            if (file.endsWith('.meta.json')) continue;

            const filePath = path.join(dirPath, file);
            const fileStat = await fs.promises.stat(filePath).catch(() => null);

            if (!fileStat) continue;

            const id = file.replace(/\.(jpg|json)$/, '');
            const timestamp = this.extractTimestamp(id);
            const type = this.extractType(file);

            const metadata: DiskFileMetadata = {
              id,
              timestamp,
              type: type as any,
              filePath,
              metaPath: file.endsWith('.jpg') ? filePath.replace(/\.jpg$/, '.meta.json') : undefined,
              fileSize: fileStat.size,
              uploadStatus: 'pending',
              uploadAttempts: 0,
              lastUploadAttempt: null,
              createdAt: fileStat.ctimeMs
            };

            result.push(metadata);
          }
        }
      }

      return result;
    } catch (error: any) {
      logger.error(`[DiskQueue] 列出文件失败`, error);
      return result;
    }
  }

  /**
   * 清理过期文件（7天前）
   */
  async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      const files = await this.listAll();
      let deletedCount = 0;
      let freedSize = 0;

      for (const file of files) {
        const age = now - file.timestamp;

        // 删除超过 maxAge 的文件
        if (age > this.maxAge) {
          try {
            await this.delete(file.id);
            deletedCount++;
            freedSize += file.fileSize;
          } catch (error) {
            logger.warn(`[DiskQueue] 清理文件失败: ${file.id}`, error);
          }
        }
      }

      if (deletedCount > 0) {
        logger.info(`[DiskQueue] 清理完成`, {
          deletedCount,
          freedSize: `${(freedSize / 1024 / 1024).toFixed(2)} MB`,
          remaining: files.length - deletedCount
        });
      }

      // 检查总大小是否超限
      const totalSize = await this.size();
      if (totalSize > this.maxSize) {
        await this.trimBySize(totalSize - this.maxSize);
      }
    } catch (error: any) {
      logger.error(`[DiskQueue] 清理失败`, error);
    }
  }

  /**
   * 按大小裁剪（删除最旧的文件直到满足大小限制）
   */
  private async trimBySize(excessSize: number): Promise<void> {
    logger.warn(`[DiskQueue] 磁盘占用超限，开始裁剪`, {
      excessSize: `${(excessSize / 1024 / 1024).toFixed(2)} MB`
    });

    const files = await this.listAll();
    files.sort((a, b) => a.timestamp - b.timestamp); // 按时间排序

    let freed = 0;
    let deletedCount = 0;

    for (const file of files) {
      if (freed >= excessSize) break;

      try {
        await this.delete(file.id);
        freed += file.fileSize;
        deletedCount++;
      } catch (error) {
        logger.warn(`[DiskQueue] 裁剪删除失败: ${file.id}`, error);
      }
    }

    logger.info(`[DiskQueue] 裁剪完成`, {
      deletedCount,
      freedSize: `${(freed / 1024 / 1024).toFixed(2)} MB`
    });
  }

  /**
   * 启动定时清理任务
   */
  private startCleanupTask(): void {
    this.cleanupTimer = setInterval(() => {
      logger.info(`[DiskQueue] 执行定时清理任务`);
      this.cleanup().catch(err => {
        logger.error(`[DiskQueue] 定时清理失败`, err);
      });
    }, this.cleanupInterval);

    // 立即执行一次清理
    this.cleanup().catch(() => {});
  }

  /**
   * 停止定时清理任务
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info(`[DiskQueue] 定时清理任务已停止`);
    }
  }

  /**
   * 工具方法
   */
  private getTypePlural(type: string): 'screenshots' | 'activities' | 'processes' {
    if (type === 'screenshot') return 'screenshots';
    if (type === 'activity') return 'activities';
    if (type === 'process') return 'processes';
    return 'screenshots';
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private extractTimestamp(id: string): number {
    // ID 格式: screenshot_1703401200000 或 activity_1703401200000
    const parts = id.split('_');
    return parseInt(parts[parts.length - 1]);
  }

  private extractType(filename: string): string {
    if (filename.includes('screenshot')) return 'screenshot';
    if (filename.includes('activity')) return 'activity';
    if (filename.includes('process')) return 'process';
    return 'screenshot';
  }

  private ensureBaseDirectory(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      logger.info(`[DiskQueue] 创建缓存目录: ${this.baseDir}`);
    }
  }
}
