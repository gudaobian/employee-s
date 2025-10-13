/**
 * 离线缓存服务
 * 负责在网络断开时缓存监控数据，网络恢复时同步数据
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { logger } from '../utils';

export interface CachedData {
  id: string;
  type: 'screenshot' | 'activity' | 'process';
  timestamp: number;
  deviceId: string;
  data: any;
  fingerprint: string; // 用于去重
  retryCount: number;
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
  private maxCacheSize: number = 100 * 1024 * 1024; // 100MB
  private maxItemAge: number = 7 * 24 * 60 * 60 * 1000; // 7天
  private maxRetryCount: number = 3;

  constructor(cacheDirectory?: string) {
    super();
    this.cacheDir = cacheDirectory || this.getDefaultCacheDirectory();
    this.ensureCacheDirectory();
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
      case 'linux':
        // Linux: ~/.cache/EmployeeMonitor/offline
        return path.join(process.env.XDG_CACHE_HOME || path.join(homeDir, '.cache'), 'EmployeeMonitor', 'offline');
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
      const cachedItem: CachedData = {
        id: this.generateId(),
        type,
        timestamp: Date.now(),
        deviceId,
        data,
        fingerprint: this.generateFingerprint(type, data),
        retryCount: 0
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

      logger.debug(`[OFFLINE_CACHE] Cached ${type} data: ${cachedItem.id}`);
      this.emit('data-cached', { id: cachedItem.id, type, size: JSON.stringify(cachedItem).length });

      // 检查缓存大小和清理旧数据
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
   * 清理过期和超大缓存
   */
  private async cleanupIfNeeded(): Promise<void> {
    try {
      const stats = await this.getCacheStats();
      
      // 清理过期数据
      const now = Date.now();
      const allData = await this.getAllCachedData();
      const expiredIds = allData
        .filter(item => now - item.timestamp > this.maxItemAge)
        .map(item => item.id);
      
      if (expiredIds.length > 0) {
        await this.removeCachedData(expiredIds);
        logger.info(`[OFFLINE_CACHE] Cleaned up ${expiredIds.length} expired cache items`);
      }

      // 如果缓存超过最大大小，删除最旧的数据
      if (stats.cacheSize > this.maxCacheSize) {
        const sortedData = allData.sort((a, b) => a.timestamp - b.timestamp);
        const itemsToRemove = Math.ceil(sortedData.length * 0.2); // 删除20%最旧的数据
        const idsToRemove = sortedData.slice(0, itemsToRemove).map(item => item.id);
        
        await this.removeCachedData(idsToRemove);
        logger.info(`[OFFLINE_CACHE] Cleaned up ${itemsToRemove} cache items due to size limit`);
      }
    } catch (error) {
      logger.error('[OFFLINE_CACHE] Failed to cleanup cache:', error);
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
}