/**
 * Persistent Cache Service
 * Provides periodic snapshots of cache state to survive app restarts
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils';

export interface CacheSnapshot {
  timestamp: number;
  version: string;
  items: any[];
}

export class PersistentCacheService {
  private cacheFilePath: string;
  private readonly CACHE_VERSION = '1.0.0';

  constructor(cacheDir: string) {
    this.cacheFilePath = path.join(cacheDir, 'offline-cache-snapshot.json');
    this.ensureCacheDirectory();
  }

  private ensureCacheDirectory(): void {
    const dir = path.dirname(this.cacheFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Save cache snapshot to disk
   */
  public async saveCache(cacheData: any[]): Promise<void> {
    try {
      const snapshot: CacheSnapshot = {
        timestamp: Date.now(),
        version: this.CACHE_VERSION,
        items: cacheData
      };

      const data = JSON.stringify(snapshot, null, 2);
      await fs.promises.writeFile(this.cacheFilePath, data, 'utf-8');

      logger.info('[PERSISTENT_CACHE] Cache snapshot saved', {
        items: cacheData.length,
        path: this.cacheFilePath,
        size: data.length
      });
    } catch (error) {
      logger.error('[PERSISTENT_CACHE] Failed to save snapshot:', error);
    }
  }

  /**
   * Load cache snapshot from disk
   */
  public async loadCache(): Promise<any[]> {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        logger.info('[PERSISTENT_CACHE] No snapshot file found, starting fresh');
        return [];
      }

      const data = await fs.promises.readFile(this.cacheFilePath, 'utf-8');
      const snapshot: CacheSnapshot = JSON.parse(data);

      // Validate version compatibility
      if (snapshot.version !== this.CACHE_VERSION) {
        logger.warn('[PERSISTENT_CACHE] Version mismatch, ignoring snapshot', {
          expected: this.CACHE_VERSION,
          found: snapshot.version
        });
        return [];
      }

      logger.info('[PERSISTENT_CACHE] Cache snapshot loaded', {
        items: snapshot.items.length,
        path: this.cacheFilePath,
        age: Date.now() - snapshot.timestamp
      });

      return snapshot.items;
    } catch (error) {
      logger.error('[PERSISTENT_CACHE] Failed to load snapshot:', error);
      return [];
    }
  }

  /**
   * Clear cache snapshot file
   */
  public async clearCache(): Promise<void> {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        await fs.promises.unlink(this.cacheFilePath);
        logger.info('[PERSISTENT_CACHE] Cache snapshot deleted');
      }
    } catch (error) {
      logger.error('[PERSISTENT_CACHE] Failed to clear snapshot:', error);
    }
  }

  /**
   * Get snapshot file info
   */
  public async getSnapshotInfo(): Promise<{
    exists: boolean;
    size: number;
    timestamp: number;
    age: number;
  } | null> {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        return null;
      }

      const stats = await fs.promises.stat(this.cacheFilePath);
      const data = await fs.promises.readFile(this.cacheFilePath, 'utf-8');
      const snapshot: CacheSnapshot = JSON.parse(data);

      return {
        exists: true,
        size: stats.size,
        timestamp: snapshot.timestamp,
        age: Date.now() - snapshot.timestamp
      };
    } catch (error) {
      logger.error('[PERSISTENT_CACHE] Failed to get snapshot info:', error);
      return null;
    }
  }
}
