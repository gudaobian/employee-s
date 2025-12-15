/**
 * 错误恢复工具类
 * 提供网络恢复和数据同步的核心逻辑
 */

import { EventEmitter } from 'events';
import { logger } from './index';
import { NetworkMonitor, ServerHealthCheck } from './network-monitor';
import { OfflineCacheService, CachedData, SyncResult } from '../services/offline-cache-service';

export interface RecoveryResult {
  success: boolean;
  stage: string;
  syncedItems?: number;
  failedItems?: number;
  reason?: string;
  duration?: number;
  errors?: string[];
}

export interface RecoveryStage {
  name: string;
  description: string;
  timeout: number;
  critical: boolean; // 是否为关键阶段，失败时终止恢复
}

export class ErrorRecoveryService extends EventEmitter {
  private networkMonitor: NetworkMonitor;
  private offlineCacheService: OfflineCacheService;
  private isRecovering = false;
  private recoveryStartTime = 0;
  private maxRecoveryTime = 300000; // 5分钟最大恢复时间
  private batchSize = 20; // 每批同步的数据量
  private maxRetries = 3;

  private recoveryStages: RecoveryStage[] = [
    {
      name: 'connection_verification',
      description: '验证网络连接稳定性',
      timeout: 30000,
      critical: true
    },
    {
      name: 'websocket_reconnection',
      description: '重新建立WebSocket连接',
      timeout: 15000,
      critical: true
    },
    {
      name: 'data_synchronization',
      description: '同步离线缓存数据',
      timeout: 120000,
      critical: false
    },
    {
      name: 'service_restoration',
      description: '恢复正常服务',
      timeout: 10000,
      critical: false
    },
    {
      name: 'cleanup',
      description: '清理恢复状态',
      timeout: 5000,
      critical: false
    }
  ];

  constructor(networkMonitor: NetworkMonitor, offlineCacheService: OfflineCacheService) {
    super();
    this.networkMonitor = networkMonitor;
    this.offlineCacheService = offlineCacheService;
  }

  /**
   * 执行完整的恢复流程
   */
  async performRecovery(serverUrl: string, websocketService?: any): Promise<RecoveryResult> {
    if (this.isRecovering) {
      logger.warn('[ERROR_RECOVERY] Recovery already in progress');
      return { success: false, stage: 'already_running', reason: 'Recovery already in progress' };
    }

    this.isRecovering = true;
    this.recoveryStartTime = Date.now();
    
    const recoveryId = this.generateRecoveryId();
    logger.info(`[ERROR_RECOVERY] Starting recovery process: ${recoveryId}`);
    
    try {
      this.emit('recovery-started', { recoveryId, timestamp: this.recoveryStartTime });

      for (const stage of this.recoveryStages) {
        const stageResult = await this.executeStage(stage, serverUrl, websocketService);
        
        this.emit('recovery-stage-completed', {
          recoveryId,
          stage: stage.name,
          success: stageResult.success,
          duration: stageResult.duration
        });

        if (!stageResult.success) {
          if (stage.critical) {
            logger.error(`[ERROR_RECOVERY] Critical stage ${stage.name} failed, terminating recovery`);
            this.isRecovering = false;
            this.emit('recovery-failed', { recoveryId, stage: stage.name, reason: stageResult.reason });
            return stageResult;
          } else {
            logger.warn(`[ERROR_RECOVERY] Non-critical stage ${stage.name} failed, continuing`);
          }
        }

        // 检查总恢复时间
        if (Date.now() - this.recoveryStartTime > this.maxRecoveryTime) {
          logger.error('[ERROR_RECOVERY] Recovery timeout exceeded');
          this.isRecovering = false;
          return { success: false, stage: stage.name, reason: 'Recovery timeout' };
        }
      }

      const totalDuration = Date.now() - this.recoveryStartTime;
      logger.info(`[ERROR_RECOVERY] Recovery completed successfully in ${totalDuration}ms`);
      
      this.isRecovering = false;
      this.emit('recovery-completed', { recoveryId, duration: totalDuration });
      
      return { 
        success: true, 
        stage: 'completed',
        duration: totalDuration
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ERROR_RECOVERY] Recovery failed with error:', error);
      
      this.isRecovering = false;
      this.emit('recovery-error', { recoveryId, error: errorMessage });
      
      return { 
        success: false, 
        stage: 'error', 
        reason: errorMessage 
      };
    }
  }

  /**
   * 验证连接稳定性
   */
  async verifyConnectionStability(serverUrl: string, checks = 3, interval = 2000): Promise<RecoveryResult> {
    try {
      logger.info(`[ERROR_RECOVERY] Verifying connection stability with ${checks} checks`);
      
      for (let i = 0; i < checks; i++) {
        const health = await this.networkMonitor.checkServerHealth(serverUrl);
        
        if (!health.httpCheck && !health.websocketCheck) {
          return {
            success: false,
            stage: 'connection_verification',
            reason: `Connection check ${i + 1}/${checks} failed`
          };
        }

        if (i < checks - 1) {
          await this.sleep(interval);
        }
      }

      logger.info('[ERROR_RECOVERY] Connection stability verified');
      return { success: true, stage: 'connection_verification' };
      
    } catch (error) {
      return {
        success: false,
        stage: 'connection_verification',
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 重新建立WebSocket连接
   */
  async reestablishWebSocket(websocketService: any): Promise<RecoveryResult> {
    try {
      logger.info('[ERROR_RECOVERY] Reestablishing WebSocket connection');
      
      if (!websocketService) {
        return {
          success: false,
          stage: 'websocket_reconnection',
          reason: 'WebSocket service not provided'
        };
      }

      // 断开现有连接
      if (typeof websocketService.disconnect === 'function') {
        websocketService.disconnect();
        await this.sleep(1000);
      }

      // 重新连接
      if (typeof websocketService.connect === 'function') {
        await websocketService.connect();
      } else if (typeof websocketService.initialize === 'function') {
        await websocketService.initialize();
      }

      // 验证连接
      const isConnected = await this.waitForConnection(websocketService, 10000);
      
      if (isConnected) {
        logger.info('[ERROR_RECOVERY] WebSocket reconnection successful');
        return { success: true, stage: 'websocket_reconnection' };
      } else {
        return {
          success: false,
          stage: 'websocket_reconnection',
          reason: 'Connection timeout'
        };
      }
      
    } catch (error) {
      return {
        success: false,
        stage: 'websocket_reconnection',
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 同步离线缓存数据
   */
  async syncCachedData(dataSyncService?: any): Promise<RecoveryResult> {
    try {
      logger.info('[ERROR_RECOVERY] Starting cached data synchronization');
      
      const cachedData = await this.offlineCacheService.getAllCachedData();
      
      if (cachedData.length === 0) {
        logger.info('[ERROR_RECOVERY] No cached data to sync');
        return { success: true, stage: 'data_synchronization', syncedItems: 0 };
      }

      logger.info(`[ERROR_RECOVERY] Found ${cachedData.length} cached items to sync`);
      
      // 按类型分组数据
      const groupedData = this.groupDataByType(cachedData);
      
      let totalSynced = 0;
      let totalFailed = 0;
      const errors: string[] = [];

      // 按批次同步每种类型的数据
      for (const [type, items] of Object.entries(groupedData)) {
        logger.info(`[ERROR_RECOVERY] Syncing ${items.length} ${type} items`);
        
        const syncResult = await this.syncDataBatch(items, dataSyncService);
        totalSynced += syncResult.syncedCount;
        totalFailed += syncResult.failedCount;
        errors.push(...syncResult.errors);

        // 批次间短暂延迟，避免服务器压力
        await this.sleep(500);
      }

      logger.info(`[ERROR_RECOVERY] Data sync completed: ${totalSynced} synced, ${totalFailed} failed`);
      
      return {
        success: totalFailed === 0 || totalSynced > 0,
        stage: 'data_synchronization',
        syncedItems: totalSynced,
        failedItems: totalFailed,
        errors: errors.length > 0 ? errors : undefined
      };
      
    } catch (error) {
      return {
        success: false,
        stage: 'data_synchronization',
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async executeStage(
    stage: RecoveryStage, 
    serverUrl: string, 
    websocketService?: any
  ): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    logger.info(`[ERROR_RECOVERY] Executing stage: ${stage.name} - ${stage.description}`);
    this.emit('recovery-stage-started', { stage: stage.name, description: stage.description });

    try {
      let result: RecoveryResult;

      switch (stage.name) {
        case 'connection_verification':
          result = await this.verifyConnectionStability(serverUrl);
          break;
          
        case 'websocket_reconnection':
          result = await this.reestablishWebSocket(websocketService);
          break;
          
        case 'data_synchronization':
          result = await this.syncCachedData(websocketService);
          break;
          
        case 'service_restoration':
          result = await this.restoreServices();
          break;
          
        case 'cleanup':
          result = await this.cleanupRecovery();
          break;
          
        default:
          result = { success: false, stage: stage.name, reason: `Unknown stage: ${stage.name}` };
      }

      result.duration = Date.now() - startTime;
      return result;
      
    } catch (error) {
      return {
        success: false,
        stage: stage.name,
        reason: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      };
    }
  }

  private async syncDataBatch(items: CachedData[], dataSyncService?: any): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      errors: []
    };

    // 按批次处理
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      
      try {
        // 尝试上传批次
        const uploadSuccess = await this.uploadBatch(batch, dataSyncService);
        
        if (uploadSuccess) {
          // 上传成功，删除缓存
          const ids = batch.map(item => item.id);
          await this.offlineCacheService.removeCachedData(ids);
          result.syncedCount += batch.length;
          
          logger.debug(`[ERROR_RECOVERY] Batch uploaded and cached: ${batch.length} items`);
        } else {
          // 上传失败，增加重试计数
          for (const item of batch) {
            const shouldRetry = await this.offlineCacheService.incrementRetryCount(item.id);
            if (!shouldRetry) {
              result.failedCount++;
            }
          }
          result.errors.push(`Batch upload failed: ${batch.length} items`);
        }
        
      } catch (error) {
        result.failedCount += batch.length;
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      }

      // 批次间延迟
      if (i + this.batchSize < items.length) {
        await this.sleep(100);
      }
    }

    result.success = result.syncedCount > 0 || result.failedCount === 0;
    return result;
  }

  private async uploadBatch(batch: CachedData[], dataSyncService?: any): Promise<boolean> {
    if (!dataSyncService) {
      // 如果没有数据同步服务，假设上传成功（测试模式）
      logger.warn('[ERROR_RECOVERY] No data sync service provided, simulating upload');
      return true;
    }

    try {
      // 按数据类型分别上传
      const screenshots = batch.filter(item => item.type === 'screenshot');
      const activities = batch.filter(item => item.type === 'activity');
      const processes = batch.filter(item => item.type === 'process');

      const uploadPromises: Promise<boolean>[] = [];

      if (screenshots.length > 0) {
        uploadPromises.push(this.uploadScreenshots(screenshots, dataSyncService));
      }
      if (activities.length > 0) {
        uploadPromises.push(this.uploadActivities(activities, dataSyncService));
      }
      if (processes.length > 0) {
        uploadPromises.push(this.uploadProcesses(processes, dataSyncService));
      }

      const results = await Promise.allSettled(uploadPromises);
      return results.every(result => result.status === 'fulfilled' && result.value === true);

    } catch (error) {
      logger.error('[ERROR_RECOVERY] Batch upload failed:', error);
      return false;
    }
  }

  private async uploadScreenshots(screenshots: CachedData[], dataSyncService: any): Promise<boolean> {
    try {
      if (typeof dataSyncService.addScreenshotData === 'function') {
        for (const screenshot of screenshots) {
          await dataSyncService.addScreenshotData(screenshot.data);
        }
        return true;
      }
      return false;
    } catch (error) {
      logger.error('[ERROR_RECOVERY] Screenshot upload failed:', error);
      return false;
    }
  }

  private async uploadActivities(activities: CachedData[], dataSyncService: any): Promise<boolean> {
    try {
      if (typeof dataSyncService.addActivityData === 'function') {
        for (const activity of activities) {
          await dataSyncService.addActivityData(activity.data);
        }
        return true;
      }
      return false;
    } catch (error) {
      logger.error('[ERROR_RECOVERY] Activity upload failed:', error);
      return false;
    }
  }

  private async uploadProcesses(processes: CachedData[], dataSyncService: any): Promise<boolean> {
    try {
      if (typeof dataSyncService.addProcessData === 'function') {
        for (const process of processes) {
          await dataSyncService.addProcessData(process.data);
        }
        return true;
      }
      return false;
    } catch (error) {
      logger.error('[ERROR_RECOVERY] Process upload failed:', error);
      return false;
    }
  }

  private async restoreServices(): Promise<RecoveryResult> {
    try {
      logger.info('[ERROR_RECOVERY] Restoring services to normal operation');
      
      // 这里可以添加服务恢复逻辑
      // 例如：重新启动定时器、重置状态等
      
      return { success: true, stage: 'service_restoration' };
    } catch (error) {
      return {
        success: false,
        stage: 'service_restoration',
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async cleanupRecovery(): Promise<RecoveryResult> {
    try {
      logger.info('[ERROR_RECOVERY] Cleaning up recovery state');
      
      // 清理恢复相关的临时状态
      this.isRecovering = false;
      
      return { success: true, stage: 'cleanup' };
    } catch (error) {
      return {
        success: false,
        stage: 'cleanup',
        reason: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private groupDataByType(data: CachedData[]): Record<string, CachedData[]> {
    return data.reduce((groups, item) => {
      if (!groups[item.type]) {
        groups[item.type] = [];
      }
      groups[item.type].push(item);
      return groups;
    }, {} as Record<string, CachedData[]>);
  }

  private async waitForConnection(websocketService: any, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkConnection = () => {
        if (Date.now() - startTime > timeout) {
          resolve(false);
          return;
        }

        // 检查连接状态的方法可能因实现而异
        if (websocketService.isConnected && websocketService.isConnected()) {
          resolve(true);
        } else if (websocketService.connected) {
          resolve(true);
        } else {
          setTimeout(checkConnection, 500);
        }
      };

      checkConnection();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateRecoveryId(): string {
    return `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取恢复状态
   */
  getRecoveryStatus(): { isRecovering: boolean; startTime: number; duration: number } {
    return {
      isRecovering: this.isRecovering,
      startTime: this.recoveryStartTime,
      duration: this.isRecovering ? Date.now() - this.recoveryStartTime : 0
    };
  }

  /**
   * 设置批量大小
   */
  setBatchSize(size: number): void {
    this.batchSize = Math.max(1, Math.min(size, 100)); // 1-100范围
  }

  /**
   * 设置最大恢复时间
   */
  setMaxRecoveryTime(timeMs: number): void {
    this.maxRecoveryTime = Math.max(60000, timeMs); // 最少1分钟
  }
}