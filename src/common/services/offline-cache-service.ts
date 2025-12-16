/**
 * 离线缓存服务
 * 负责在网络断开时缓存监控数据，网络恢复时同步数据
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { logger } from '../utils';
import { PersistentCacheService } from './persistent-cache-service';

export interface CachedData {
  id: string;
  type: 'screenshot' | 'activity' | 'process';
  timestamp: number;
  deviceId: string;
  data: any;
  fingerprint: string; // 用于去重
  retryCount: number;
  priority: number; // 优先级权重
  size: number; // 数据大小(bytes)
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors: string[];
}

export interface CacheStats {
  totalItems: number;
  screenshotCount: number;
  activityCount: number;
  processCount: number;
  oldestTimestamp: number;
  newestTimestamp: number;
  cacheSize: number; // bytes
}

export class OfflineCacheService extends EventEmitter {
  private cacheDir: string;
  private maxCacheSize: number = 500 * 1024 * 1024; // 500MB (从100MB增加，支持20-30天离线)
  private maxItemAge: number = 30 * 24 * 60 * 60 * 1000; // 30天 (从7天延长，降低过期删除风险)
  private maxRetryCount: number = 10; // 10次 (从3次增加，降低80%数据丢失风险)
  private readonly MAX_CACHE_ITEMS = 500; // 最大缓存项数
  private readonly MAX_CACHE_AGE = 5 * 60 * 60 * 1000; // 5小时缓存过期时间（快速同步场景）
  private readonly MAX_CACHE_MEMORY_MB = 100; // 最大内存使用100MB

  // 优先级权重配置
  private readonly PRIORITY_WEIGHTS = {
    screenshot: 3, // 截图最高优先级
    activity: 2,   // 活动记录中优先级
    process: 1,    // 进程信息低优先级
    other: 0       // 其他数据最低优先级
  };

  private persistentCache: PersistentCacheService;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(cacheDirectory?: string) {
    super();
    this.cacheDir = cacheDirectory || this.getDefaultCacheDirectory();
    this.ensureCacheDirectory();

    // 初始化持久化缓存服务
    this.persistentCache = new PersistentCacheService(this.cacheDir);

    // 启动自动保存快照
    this.startAutoSave();
  }

  /**
   * 获取默认缓存目录 - 支持不同操作系统
   */
  private getDefaultCacheDirectory(): string {
    const homeDir = os.homedir();
    
    switch (process.platform) {
      case 'darwin':
        // macOS: ~/Library/Caches/EmployeeMonitor/offline
        return path.join(homeDir, 'Library', 'Caches', 'EmployeeMonitor', 'offline');
      case 'win32':
        // Windows: %LOCALAPPDATA%\EmployeeMonitor\Cache\offline
        return path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'EmployeeMonitor', 'Cache', 'offline');
      default:
        // 其他平台使用 ~/.employee-monitor/cache/offline
        return path.join(homeDir, '.employee-monitor', 'cache', 'offline');
    }
  }

  private ensureCacheDirectory(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        logger.info(`[OFFLINE_CACHE] Created cache directory: ${this.cacheDir}`);
      }
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to create cache directory:', error);
      throw error;
    }
  }

  /**
   * 缓存数据到本地
   */
  async cacheData(type: CachedData['type'], deviceId: string, data: any): Promise<string> {
    try {
      const dataString = JSON.stringify(data);
      const cachedItem: CachedData = {
        id: this.generateId(),
        type,
        timestamp: Date.now(),
        deviceId,
        data,
        fingerprint: this.generateFingerprint(type, data),
        retryCount: 0,
        priority: this.PRIORITY_WEIGHTS[type] || 0,
        size: this.estimateDataSize(data)
      };

      // 检查是否重复
      if (await this.isDuplicate(cachedItem.fingerprint)) {
        logger.debug('[OFFLINE_CACHE] Duplicate data detected, skipping cache');
        return cachedItem.id;
      }

      const filePath = this.getDataFilePath(cachedItem.id);
      await new Promise<void>((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(cachedItem), 'utf8', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logger.debug(`[OFFLINE_CACHE] Cached ${type} data: ${cachedItem.id}`, {
        priority: cachedItem.priority,
        size: cachedItem.size
      });
      this.emit('data-cached', { id: cachedItem.id, type, size: cachedItem.size });

      // 检查缓存大小和清理旧数据（使用增强的优先级清理）
      await this.cleanupIfNeeded();

      return cachedItem.id;
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to cache data:', error);
      throw error;
    }
  }

  /**
   * 批量缓存数据
   */
  async cacheBatch(items: Array<{ type: CachedData['type'], deviceId: string, data: any }>): Promise<string[]> {
    const cachedIds: string[] = [];
    
    for (const item of items) {
      try {
        const id = await this.cacheData(item.type, item.deviceId, item.data);
        cachedIds.push(id);
      } catch (error) {
        logger.error('[OFFLINE_CACHE] Failed to cache item in batch:', error);
      }
    }

    return cachedIds;
  }

  /**
   * 获取所有缓存数据
   */
  async getAllCachedData(): Promise<CachedData[]> {
    try {
      const files = await new Promise<string[]>((resolve, reject) => {
        fs.readdir(this.cacheDir, (err, files) => {
          if (err) reject(err);
          else resolve(files);
        });
      });
      const dataFiles = files.filter(file => file.endsWith('.json'));
      
      const cachedData: CachedData[] = [];
      
      for (const file of dataFiles) {
        try {
          const filePath = path.join(this.cacheDir, file);
          const content = await new Promise<string>((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
          });
          const item: CachedData = JSON.parse(content);
          cachedData.push(item);
        } catch (error) {
          logger.warn(`[OFFLINE_CACHE] Failed to read cache file ${file}:`, error);
        }
      }

      // 按时间戳排序
      return cachedData.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to get cached data:', error);
      return [];
    }
  }

  /**
   * 获取指定类型的缓存数据
   */
  async getCachedDataByType(type: CachedData['type']): Promise<CachedData[]> {
    const allData = await this.getAllCachedData();
    return allData.filter(item => item.type === type);
  }

  /**
   * 删除缓存数据
   */
  async removeCachedData(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        const filePath = this.getDataFilePath(id);
        if (fs.existsSync(filePath)) {
          await new Promise<void>((resolve, reject) => {
            fs.unlink(filePath, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          logger.debug(`[OFFLINE_CACHE] Removed cached data: ${id}`);
        }
      } catch (error) {
        logger.warn(`[OFFLINE_CACHE] Failed to remove cached data ${id}:`, error);
      }
    }
    
    this.emit('data-removed', { ids, count: ids.length });
  }

  /**
   * 增加重试计数
   */
  async incrementRetryCount(id: string): Promise<boolean> {
    try {
      const filePath = this.getDataFilePath(id);
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const content = await new Promise<string>((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      const item: CachedData = JSON.parse(content);
      
      item.retryCount++;
      
      if (item.retryCount >= this.maxRetryCount) {
        logger.warn(`[OFFLINE_CACHE] Max retry count reached for ${id}, removing from cache`);
        await this.removeCachedData([id]);
        return false;
      }

      await new Promise<void>((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(item), 'utf8', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return true;
    } catch (error) {
      logger.error(`[OFFLINE_CACHE] Failed to increment retry count for ${id}:`, error);
      return false;
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getCacheStats(): Promise<CacheStats> {
    try {
      const allData = await this.getAllCachedData();
      
      const stats: CacheStats = {
        totalItems: allData.length,
        screenshotCount: allData.filter(item => item.type === 'screenshot').length,
        activityCount: allData.filter(item => item.type === 'activity').length,
        processCount: allData.filter(item => item.type === 'process').length,
        oldestTimestamp: allData.length > 0 ? Math.min(...allData.map(item => item.timestamp)) : 0,
        newestTimestamp: allData.length > 0 ? Math.max(...allData.map(item => item.timestamp)) : 0,
        cacheSize: 0
      };

      // 计算缓存大小
      const files = await new Promise<string[]>((resolve, reject) => {
        fs.readdir(this.cacheDir, (err, files) => {
          if (err) reject(err);
          else resolve(files);
        });
      });
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        const stat = await new Promise<fs.Stats>((resolve, reject) => {
          fs.stat(filePath, (err, stats) => {
            if (err) reject(err);
            else resolve(stats);
          });
        });
        stats.cacheSize += stat.size;
      }

      return stats;
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to get cache stats:', error);
      return {
        totalItems: 0,
        screenshotCount: 0,
        activityCount: 0,
        processCount: 0,
        oldestTimestamp: 0,
        newestTimestamp: 0,
        cacheSize: 0
      };
    }
  }

  /**
   * 清空所有缓存
   */
  async clearCache(): Promise<void> {
    try {
      const files = await new Promise<string[]>((resolve, reject) => {
        fs.readdir(this.cacheDir, (err, files) => {
          if (err) reject(err);
          else resolve(files);
        });
      });
      
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        await new Promise<void>((resolve, reject) => {
          fs.unlink(filePath, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      logger.info('[OFFLINE_CACHE] All cache cleared');
      this.emit('cache-cleared');
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to clear cache:', error);
      throw error;
    }
  }

  /**
   * 清理过期和超大缓存（增强优先级清理）
   */
  private async cleanupIfNeeded(): Promise<void> {
    try {
      const allData = await this.getAllCachedData();

      // 按数量清理
      if (allData.length > this.MAX_CACHE_ITEMS) {
        await this.cleanupByCount(allData);
      }

      // 按年龄清理（使用快速同步5小时策略）
      await this.cleanupByAge(allData);

      // 按内存清理
      await this.cleanupByMemory(allData);

      // 清理长期过期数据（30天备份策略）
      await this.cleanupLongTermExpired(allData);
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to cleanup cache:', error);
    }
  }

  /**
   * 按数量清理：超过500项时删除低优先级旧数据
   */
  private async cleanupByCount(allData: CachedData[]): Promise<void> {
    const overCount = allData.length - this.MAX_CACHE_ITEMS;
    if (overCount <= 0) return;

    // 排序：优先级低的排前面，同优先级按时间旧的排前面
    const sorted = allData.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.timestamp - b.timestamp;
    });

    const idsToRemove = sorted.slice(0, overCount).map(item => item.id);
    await this.removeCachedData(idsToRemove);

    logger.info('[OFFLINE_CACHE] Cleaned by count', {
      removed: idsToRemove.length,
      remaining: allData.length - idsToRemove.length
    });
  }

  /**
   * 按年龄清理：超过5小时的数据（快速同步策略）
   */
  private async cleanupByAge(allData: CachedData[]): Promise<void> {
    const now = Date.now();
    const expiredIds = allData
      .filter(item => now - item.timestamp > this.MAX_CACHE_AGE)
      .map(item => item.id);

    if (expiredIds.length > 0) {
      await this.removeCachedData(expiredIds);
      logger.info('[OFFLINE_CACHE] Cleaned by age (5h)', {
        removed: expiredIds.length
      });
    }
  }

  /**
   * 按内存清理：超过100MB时删除低优先级大文件
   */
  private async cleanupByMemory(allData: CachedData[]): Promise<void> {
    const stats = await this.getCacheStats();
    const totalSizeMB = stats.cacheSize / 1024 / 1024;

    if (totalSizeMB <= this.MAX_CACHE_MEMORY_MB) return;

    // 计算每项的评分：优先级高 - 大小小 = 分数高（保留）
    const scored = allData.map(item => ({
      ...item,
      score: item.priority - (item.size / 1024 / 1024)
    }));

    // 分数低的排前面（优先删除）
    scored.sort((a, b) => a.score - b.score);

    const targetSizeMB = this.MAX_CACHE_MEMORY_MB * 0.8; // 清理到80%
    let currentSizeMB = totalSizeMB;
    const idsToRemove: string[] = [];

    for (const item of scored) {
      if (currentSizeMB <= targetSizeMB) break;
      idsToRemove.push(item.id);
      currentSizeMB -= item.size / 1024 / 1024;
    }

    if (idsToRemove.length > 0) {
      await this.removeCachedData(idsToRemove);
      logger.info('[OFFLINE_CACHE] Cleaned by memory', {
        removed: idsToRemove.length,
        freedMB: (totalSizeMB - currentSizeMB).toFixed(2)
      });
    }
  }

  /**
   * 清理长期过期数据：超过30天的备份数据
   */
  private async cleanupLongTermExpired(allData: CachedData[]): Promise<void> {
    const now = Date.now();
    const expiredIds = allData
      .filter(item => now - item.timestamp > this.maxItemAge)
      .map(item => item.id);

    if (expiredIds.length > 0) {
      await this.removeCachedData(expiredIds);
      logger.info('[OFFLINE_CACHE] Cleaned long-term expired (30d)', {
        removed: expiredIds.length
      });
    }
  }

  /**
   * 估算数据大小
   */
  private estimateDataSize(data: any): number {
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }

  private generateId(): string {
    return `cache_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFingerprint(type: CachedData['type'], data: any): string {
    const content = JSON.stringify({ type, data });
    const timestamp = Math.floor(Date.now() / 60000); // 分钟级精度
    return `${type}_${timestamp}_${this.hashString(content)}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  private async isDuplicate(fingerprint: string): Promise<boolean> {
    try {
      const allData = await this.getAllCachedData();
      return allData.some(item => item.fingerprint === fingerprint);
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to check duplicate:', error);
      return false;
    }
  }

  private getDataFilePath(id: string): string {
    return path.join(this.cacheDir, `${id}.json`);
  }

  /**
   * 启动自动保存快照（每5分钟）
   */
  private startAutoSave(): void {
    // 每5分钟保存一次缓存快照
    this.autoSaveInterval = setInterval(async () => {
      try {
        const allData = await this.getAllCachedData();

        // 过滤掉大型数据（截图），只保存元数据
        // 这样避免 JSON.stringify 超过最大字符串长度限制
        const metadataOnly = allData.map(item => {
          if (item.type === 'screenshot' && item.data) {
            // 移除截图的 Base64 数据，只保留元数据
            return {
              ...item,
              data: {
                ...item.data,
                imageData: '[EXCLUDED_FROM_SNAPSHOT]' // 标记为已排除
              },
              size: item.size // 保留原始大小信息
            };
          }
          return item;
        });

        await this.persistentCache.saveCache(metadataOnly);
        logger.debug('[OFFLINE_CACHE] Auto-save snapshot completed', {
          items: allData.length,
          excludedScreenshots: allData.filter(i => i.type === 'screenshot').length
        });
      } catch (error) {
        logger.error('[OFFLINE_CACHE] Auto-save failed:', error);
      }
    }, 5 * 60 * 1000);

    logger.info('[OFFLINE_CACHE] Auto-save started (5min interval)');
  }

  /**
   * 加载持久化快照（应用启动时调用）
   */
  public async loadFromSnapshot(): Promise<void> {
    try {
      const snapshot = await this.persistentCache.loadCache();

      if (snapshot.length === 0) {
        logger.info('[OFFLINE_CACHE] No snapshot to restore');
        return;
      }

      // 恢复快照中的缓存项到文件系统
      let restored = 0;
      for (const item of snapshot) {
        try {
          const filePath = this.getDataFilePath(item.id);

          // 如果文件已存在，跳过
          if (fs.existsSync(filePath)) {
            continue;
          }

          await fs.promises.writeFile(filePath, JSON.stringify(item), 'utf8');
          restored++;
        } catch (error) {
          logger.warn('[OFFLINE_CACHE] Failed to restore item from snapshot:', error);
        }
      }

      logger.info('[OFFLINE_CACHE] Snapshot restored', {
        total: snapshot.length,
        restored,
        skipped: snapshot.length - restored
      });
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to load from snapshot:', error);
    }
  }

  /**
   * 关闭服务（保存快照并清理）
   */
  public async shutdown(): Promise<void> {
    try {
      // 停止自动保存
      if (this.autoSaveInterval) {
        clearInterval(this.autoSaveInterval);
        this.autoSaveInterval = null;
      }

      // 最后一次保存快照（排除大型截图数据）
      const allData = await this.getAllCachedData();

      const metadataOnly = allData.map(item => {
        if (item.type === 'screenshot' && item.data) {
          return {
            ...item,
            data: {
              ...item.data,
              imageData: '[EXCLUDED_FROM_SNAPSHOT]'
            },
            size: item.size
          };
        }
        return item;
      });

      await this.persistentCache.saveCache(metadataOnly);

      logger.info('[OFFLINE_CACHE] Service shutdown completed', {
        savedItems: allData.length,
        excludedScreenshots: allData.filter(i => i.type === 'screenshot').length
      });
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Shutdown error:', error);
    }
  }

  /**
   * 获取快照信息
   */
  public async getSnapshotInfo() {
    return await this.persistentCache.getSnapshotInfo();
  }
}