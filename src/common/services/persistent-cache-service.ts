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
   * CRITICAL: Prevent corruption by limiting cache size to prevent 512KB truncation
   */
  public async saveCache(cacheData: any[]): Promise<void> {
    try {
      const snapshot: CacheSnapshot = {
        timestamp: Date.now(),
        version: this.CACHE_VERSION,
        items: cacheData
      };

      const data = JSON.stringify(snapshot, null, 2);

      // CRITICAL: Prevent file corruption by enforcing size limits
      // Observed corruption at 524288 bytes (512KB), enforce 400KB hard limit
      const MAX_CACHE_SIZE = 400 * 1024; // 400KB safety margin
      if (data.length > MAX_CACHE_SIZE) {
        logger.warn(`[PERSISTENT_CACHE] Cache too large (${data.length} bytes), trimming to prevent corruption`);

        // Keep only most recent items (FIFO)
        const targetItems = Math.floor(cacheData.length * 0.5); // Keep 50%
        const trimmedSnapshot: CacheSnapshot = {
          timestamp: Date.now(),
          version: this.CACHE_VERSION,
          items: cacheData.slice(-targetItems) // Keep most recent half
        };

        const trimmedData = JSON.stringify(trimmedSnapshot, null, 2);
        await fs.promises.writeFile(this.cacheFilePath, trimmedData, 'utf-8');

        logger.info('[PERSISTENT_CACHE] Cache trimmed and saved', {
          originalItems: cacheData.length,
          savedItems: targetItems,
          originalSize: data.length,
          savedSize: trimmedData.length,
          path: this.cacheFilePath
        });
        return;
      }

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
   * CRITICAL: Validate and auto-delete corrupted cache to prevent memory crashes
   */
  public async loadCache(): Promise<any[]> {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        logger.info('[PERSISTENT_CACHE] No snapshot file found, starting fresh');
        return [];
      }

      // CRITICAL: Check file size before loading to prevent OOM
      const stats = await fs.promises.stat(this.cacheFilePath);
      if (stats.size > 500 * 1024) { // 500KB warning threshold
        logger.warn(`[PERSISTENT_CACHE] Cache file dangerously large: ${stats.size} bytes, deleting to prevent crash`);
        await fs.promises.unlink(this.cacheFilePath);
        return [];
      }

      const data = await fs.promises.readFile(this.cacheFilePath, 'utf-8');

      // CRITICAL: Validate JSON before parsing to catch corruption early
      let snapshot: CacheSnapshot;
      try {
        snapshot = JSON.parse(data);
      } catch (parseError: any) {
        logger.error(`[PERSISTENT_CACHE] JSON corruption detected at position ${parseError.message}`, {
          fileSize: stats.size,
          error: parseError.message
        });
        // Delete corrupted file immediately to prevent repeated crashes
        await fs.promises.unlink(this.cacheFilePath);
        logger.warn('[PERSISTENT_CACHE] Corrupted cache file deleted, starting fresh');
        return [];
      }

      // Validate version compatibility
      if (snapshot.version !== this.CACHE_VERSION) {
        logger.warn('[PERSISTENT_CACHE] Version mismatch, ignoring snapshot', {
          expected: this.CACHE_VERSION,
          found: snapshot.version
        });
        return [];
      }

      // Validate data structure
      if (!Array.isArray(snapshot.items)) {
        logger.error('[PERSISTENT_CACHE] Invalid snapshot structure, items is not array');
        await fs.promises.unlink(this.cacheFilePath);
        return [];
      }

      logger.info('[PERSISTENT_CACHE] Cache snapshot loaded successfully', {
        items: snapshot.items.length,
        path: this.cacheFilePath,
        fileSize: stats.size,
        age: Date.now() - snapshot.timestamp
      });

      return snapshot.items;
    } catch (error) {
      logger.error('[PERSISTENT_CACHE] Failed to load snapshot, deleting cache:', error);
      // Delete any problematic cache file
      try {
        if (fs.existsSync(this.cacheFilePath)) {
          await fs.promises.unlink(this.cacheFilePath);
        }
      } catch (unlinkError) {
        logger.error('[PERSISTENT_CACHE] Failed to delete corrupted cache:', unlinkError);
      }
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
