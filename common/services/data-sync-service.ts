/**
 * 数据同步服务 - 重构版本
 * 负责设备数据的收集、缓存和上传
 */

import { BaseService } from '../utils/base-service';
import { IConfigService, IDataSyncService } from '../interfaces/service-interfaces';
import { IPlatformAdapter } from '../interfaces/platform-interface';

interface QueuedData {
  id: string;
  type: 'activity' | 'screenshot' | 'system';
  data: any;
  timestamp: Date;
  retryCount: number;
  size: number;
}

export class DataSyncService extends BaseService implements IDataSyncService {
  private configService: IConfigService;
  private authService: any;
  private dataTransformer: any;
  private platformAdapter: IPlatformAdapter;
  private syncQueue: QueuedData[] = [];
  private maxQueueSize = 1000;
  private maxRetries = 3;
  private isSyncing = false;
  private isRunning = false;
  private syncInterval?: any;
  private lastSyncTime = 0;
  private syncIntervalMs = 30000; // 30秒

  constructor(configService: IConfigService, platformAdapter: IPlatformAdapter) {
    super();
    this.configService = configService;
    this.platformAdapter = platformAdapter;
  }

  initialize(config: any, auth: any, transformer: any): void {
    this.authService = auth;
    this.dataTransformer = transformer;
    console.log('[DATA_SYNC] Service initialized with config, auth, and transformer');
  }

  async collectData(): Promise<any> {
    try {
      const data = await this.platformAdapter.collectMonitoringData();
      console.log('[DATA_SYNC] Data collected successfully');
      return data;
    } catch (error: any) {
      console.error('[DATA_SYNC] Failed to collect data:', error);
      throw error;
    }
  }

  async uploadData(data: any): Promise<void> {
    try {
      const queueItem = this.createQueueItem('activity', data);
      await this.addToQueue(queueItem);
      await this.performSync();
      console.log('[DATA_SYNC] Data uploaded successfully');
    } catch (error: any) {
      console.error('[DATA_SYNC] Failed to upload data:', error);
      throw error;
    }
  }

  startSync(): void {
    this.start().catch(error => {
      console.error('[DATA_SYNC] Failed to start sync:', error);
    });
  }

  stopSync(): void {
    this.stop().catch(error => {
      console.error('[DATA_SYNC] Failed to stop sync:', error);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[DATA_SYNC] Service already running');
      return;
    }

    try {
      console.log('[DATA_SYNC] Starting data sync service...');
      
      this.isRunning = true;
      
      // 启动定期同步
      this.startSyncInterval();

      // 立即执行一次同步检查
      setTimeout(() => this.performSync(), 5000);

      this.emit('service-started');
      console.log('[DATA_SYNC] Data sync service started successfully');

    } catch (error: any) {
      console.error('[DATA_SYNC] Failed to start service:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[DATA_SYNC] Stopping data sync service...');

      this.isRunning = false;

      // 停止同步定时器
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
        this.syncInterval = undefined;
      }

      // 尝试同步剩余数据
      if (this.syncQueue.length > 0) {
        console.log(`[DATA_SYNC] Syncing ${this.syncQueue.length} remaining items...`);
        await this.performSync();
      }

      this.emit('service-stopped');
      console.log('[DATA_SYNC] Data sync service stopped');

    } catch (error: any) {
      console.error('[DATA_SYNC] Error stopping service:', error);
    }
  }

  // 数据添加方法
  async addActivityData(data: any): Promise<void> {
    try {
      const queueItem = this.createQueueItem('activity', data);
      await this.addToQueue(queueItem);
      
      // 活动数据优先处理
      if (!this.isSyncing) {
        setTimeout(() => this.performSync(), 1000);
      }

    } catch (error: any) {
      console.error('[DATA_SYNC] Failed to add activity data:', error);
      throw error;
    }
  }

  async addScreenshotData(data: any): Promise<void> {
    try {
      // 检查队列中截图数量，避免内存堆积
      const screenshotCount = this.syncQueue.filter(item => item.type === 'screenshot').length;
      if (screenshotCount >= 10) {
        console.warn('[DATA_SYNC] Too many screenshots in queue, skipping this one');
        return;
      }

      const queueItem = this.createQueueItem('screenshot', data);
      await this.addToQueue(queueItem);

    } catch (error: any) {
      console.error('[DATA_SYNC] Failed to add screenshot data:', error);
      throw error;
    }
  }

  async addSystemData(data: any): Promise<void> {
    try {
      const queueItem = this.createQueueItem('system', data);
      await this.addToQueue(queueItem);

    } catch (error: any) {
      console.error('[DATA_SYNC] Failed to add system data:', error);
      throw error;
    }
  }

  // 强制同步
  async forceSync(): Promise<void> {
    if (this.isSyncing) {
      console.log('[DATA_SYNC] Sync already in progress');
      return;
    }

    console.log('[DATA_SYNC] Force sync requested');
    await this.performSync();
  }

  // 获取状态信息
  getStatus(): {
    isRunning: boolean;
    isSyncing: boolean;
    queueSize: number;
    lastSyncTime: Date | null;
    queueByType: Record<string, number>;
  } {
    const queueByType = this.syncQueue.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      isRunning: this.isRunning,
      isSyncing: this.isSyncing,
      queueSize: this.syncQueue.length,
      lastSyncTime: this.lastSyncTime > 0 ? new Date(this.lastSyncTime) : null,
      queueByType
    };
  }

  // 清空队列
  async clearQueue(): Promise<number> {
    const removedCount = this.syncQueue.length;
    this.syncQueue = [];
    
    console.log(`[DATA_SYNC] Cleared queue (${removedCount} items removed)`);
    this.emit('queue-cleared', removedCount);
    
    return removedCount;
  }

  // 私有方法

  private startSyncInterval(): void {
    this.syncInterval = setInterval(async () => {
      if (this.isRunning && !this.isSyncing) {
        try {
          await this.performSync();
        } catch (error) {
          console.error('[DATA_SYNC] Sync interval error:', error);
        }
      }
    }, this.syncIntervalMs);
  }

  private createQueueItem(type: 'activity' | 'screenshot' | 'system', data: any): QueuedData {
    return {
      id: this.generateId(),
      type,
      data,
      timestamp: new Date(),
      retryCount: 0,
      size: this.calculateDataSize(data)
    };
  }

  private async addToQueue(item: QueuedData): Promise<void> {
    // 检查队列大小限制
    if (this.syncQueue.length >= this.maxQueueSize) {
      // 移除最旧的项目
      const removed = this.syncQueue.shift();
      console.warn(`[DATA_SYNC] Queue full, removed oldest item: ${removed?.id}`);
    }

    this.syncQueue.push(item);
    
    console.log(`[DATA_SYNC] Added ${item.type} data to queue`, {
      id: item.id,
      queueSize: this.syncQueue.length,
      dataSize: item.size
    });

    this.emit('queue-updated', {
      size: this.syncQueue.length,
      type: item.type,
      itemId: item.id
    });
  }

  private async performSync(): Promise<void> {
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }

    try {
      this.isSyncing = true;
      this.emit('sync-started');

      console.log(`[DATA_SYNC] Starting sync process with ${this.syncQueue.length} items`);

      // 批量处理数据
      const batchSize = Math.min(10, this.syncQueue.length);
      const batch = this.syncQueue.splice(0, batchSize);
      
      // 按类型分组数据
      const groupedData = this.groupDataByType(batch);

      // 并行同步不同类型的数据
      const syncPromises = Object.entries(groupedData).map(([type, items]) =>
        this.syncDataBatch(type as any, items)
      );

      const results = await Promise.allSettled(syncPromises);

      // 处理失败的项目
      const failedItems: QueuedData[] = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const type = Object.keys(groupedData)[index];
          const items = groupedData[type];
          failedItems.push(...items);
        }
      });

      // 重新加入失败的项目
      for (const item of failedItems) {
        item.retryCount++;
        if (item.retryCount <= this.maxRetries) {
          this.syncQueue.push(item);
        } else {
          console.error(`[DATA_SYNC] Dropping item after ${this.maxRetries} retries: ${item.id}`);
        }
      }

      this.lastSyncTime = Date.now();

      console.log(`[DATA_SYNC] Sync completed`, {
        processed: batch.length,
        failed: failedItems.length,
        remaining: this.syncQueue.length
      });

      this.emit('sync-completed', {
        processed: batch.length,
        failed: failedItems.length,
        remaining: this.syncQueue.length
      });

    } catch (error: any) {
      console.error('[DATA_SYNC] Sync operation failed:', error);
      this.emit('sync-error', error);
    } finally {
      this.isSyncing = false;
    }
  }

  private groupDataByType(items: QueuedData[]): Record<string, QueuedData[]> {
    return items.reduce((groups, item) => {
      if (!groups[item.type]) {
        groups[item.type] = [];
      }
      groups[item.type].push(item);
      return groups;
    }, {} as Record<string, QueuedData[]>);
  }

  private async syncDataBatch(type: 'activity' | 'screenshot' | 'system', items: QueuedData[]): Promise<void> {
    try {
      console.log(`[DATA_SYNC] Syncing ${items.length} ${type} items`);

      const config = this.configService.getConfig();
      const uploadUrl = this.buildUploadUrl(config.serverUrl, type);
      
      // 准备数据
      const dataToSync = items.map(item => ({
        ...item.data,
        syncId: item.id,
        syncTimestamp: item.timestamp.toISOString()
      }));

      // 发送数据
      const response = await this.sendDataToServer(uploadUrl, dataToSync);

      if (response.success) {
        console.log(`[DATA_SYNC] Successfully synced ${items.length} ${type} items`);
        this.emit('sync-success', {
          type,
          count: items.length
        });
      } else {
        throw new Error(`Server rejected ${type} data: ${response.error}`);
      }

    } catch (error: any) {
      console.error(`[DATA_SYNC] Failed to sync ${type} data:`, error);
      throw error;
    }
  }

  private buildUploadUrl(serverUrl: string, type: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      return `${baseUrl}/api/data/${type}`;
    } catch (error: any) {
      throw new Error(`Failed to build upload URL: ${error.message}`);
    }
  }

  private async sendDataToServer(url: string, data: any[]): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const response = await this.makeHttpRequest(url, {
        method: 'POST',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        },
        body: JSON.stringify({
          deviceId: this.configService.getConfig().deviceId,
          data,
          timestamp: new Date().toISOString()
        })
      });

      if (response.ok) {
        const result = await response.json();
        return {
          success: result.success !== false
        };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async makeHttpRequest(url: string, options: {
    method: string;
    timeout: number;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<any>;
  }> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const https = eval('require')('https');
      const http = eval('require')('http');
      const httpModule = isHttps ? https : http;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method,
        headers: options.headers,
        timeout: options.timeout
      };

      const req = httpModule.request(requestOptions, (res: any) => {
        let data = '';
        
        res.on('data', (chunk: any) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage || 'Unknown',
            json: async () => {
              try {
                return data ? JSON.parse(data) : {};
              } catch {
                return {};
              }
            }
          });
        });
      });

      req.on('error', (error: any) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.setTimeout(options.timeout);

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  private calculateDataSize(data: any): number {
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}