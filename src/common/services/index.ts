/**
 * 通用服务模块统一导出
 * 重构版本 - 所有服务的统一入口
 */

// 核心服务
export { ConfigServiceCLI as ConfigService } from '../config/config-service-cli';
export { AuthService } from './auth-service';
export { DataSyncService } from './data-sync-service';
export { DeviceInfoService } from './device-info-service';
export { WebSocketService } from './websocket-service';
export { ActivityCollectorService } from './activity-collector-service';
export { OfflineCacheService } from './offline-cache-service';
export { PersistentCacheService } from './persistent-cache-service';

// 队列服务（新架构：有界队列 + 磁盘持久化）
export { QueueService, queueService } from './queue-service';
export { DiskQueueManager } from './disk-queue-manager';
export { BoundedQueue } from './bounded-queue';
export { UploadManager } from './upload-manager';

// 网络相关服务
export { NetworkMonitor } from '../utils/network-monitor';
export { ErrorRecoveryService } from '../utils/error-recovery';

// FSM服务
export * from './fsm';

// 服务接口
export * from '../interfaces/service-interfaces';

// 服务管理器
import { ConfigServiceCLI as ConfigService } from '../config/config-service-cli';
import { AuthService } from './auth-service';
import { DataSyncService } from './data-sync-service';
import { DeviceInfoService } from './device-info-service';
import { WebSocketService } from './websocket-service';
import { ActivityCollectorService } from './activity-collector-service';
import { OfflineCacheService } from './offline-cache-service';
import { NetworkMonitor } from '../utils/network-monitor';
import { ErrorRecoveryService } from '../utils/error-recovery';
import { FSMServiceManager } from './fsm';
import { queueService } from './queue-service';

import { IPlatformAdapter } from '../interfaces/platform-interface';
import { IConfigService } from '../interfaces/service-interfaces';
import { createLogger } from '../utils/logger';

export class ServiceManager {
  // 服务实例
  private configService: ConfigService;
  private authService: AuthService;
  private dataSyncService: DataSyncService;
  private deviceInfoService: DeviceInfoService;
  private webSocketService: WebSocketService;
  private activityCollectorService: ActivityCollectorService;
  private fsmServiceManager: FSMServiceManager;

  // 网络相关服务
  private offlineCacheService: OfflineCacheService;
  private networkMonitor: NetworkMonitor;
  private errorRecoveryService: ErrorRecoveryService;

  private platformAdapter: IPlatformAdapter;
  private isInitialized = false;
  private isRunning = false;
  private logger = createLogger('ServiceManager');

  constructor(platformAdapter: IPlatformAdapter, configService?: IConfigService, appInstance?: any) {
    this.platformAdapter = platformAdapter;
    
    // 创建服务实例
    this.configService = configService as ConfigService || ConfigService.getInstance();
    this.authService = new AuthService(this.configService);

    // 初始化网络相关服务（需要先创建，供其他服务使用）
    this.offlineCacheService = new OfflineCacheService();
    this.networkMonitor = new NetworkMonitor();
    this.errorRecoveryService = new ErrorRecoveryService(this.networkMonitor, this.offlineCacheService);

    // 创建数据同步服务（集成离线缓存服务，支持内存队列持久化）
    this.dataSyncService = new DataSyncService(this.configService, this.platformAdapter, this.offlineCacheService);
    this.deviceInfoService = new DeviceInfoService(this.configService, this.platformAdapter);
    this.webSocketService = new WebSocketService(this.configService);
    this.activityCollectorService = new ActivityCollectorService(this.configService, this.dataSyncService, this.platformAdapter, this.webSocketService);

    this.fsmServiceManager = new FSMServiceManager(
      this.configService,
      this.platformAdapter,
      appInstance,
      this.activityCollectorService,
      this.webSocketService,
      this.dataSyncService
    );
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('[SERVICE_MANAGER] Already initialized');
      return;
    }

    try {
      console.log('[SERVICE_MANAGER] Initializing services...');

      // 初始化配置服务（带超时保护）
      await this.withTimeout(
        this.configService.initialize(),
        5000,
        'Config service initialization'
      );
      console.log('[SERVICE_MANAGER] Config service initialized');

      // 初始化FSM服务管理器（带超时保护）
      await this.withTimeout(
        this.fsmServiceManager.initialize(),
        5000,
        'FSM service manager initialization'
      );
      console.log('[SERVICE_MANAGER] FSM service manager initialized');

      // 初始化队列服务（有界队列 + 磁盘持久化）
      await this.withTimeout(
        queueService.initialize(this.webSocketService),
        5000,
        'Queue service initialization'
      );
      console.log('[SERVICE_MANAGER] Queue service initialized');

      // 设置服务间依赖关系
      this.setupServiceIntegrations();

      // 加载离线缓存快照（如果存在）
      await this.offlineCacheService.loadFromSnapshot();
      console.log('[SERVICE_MANAGER] Offline cache snapshot loaded');

      this.isInitialized = true;
      console.log('[SERVICE_MANAGER] All services initialized successfully');

    } catch (error: any) {
      console.error('[SERVICE_MANAGER] Failed to initialize services:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Services must be initialized before starting');
    }

    if (this.isRunning) {
      console.warn('[SERVICE_MANAGER] Services already running');
      return;
    }

    try {
      console.log('[SERVICE_MANAGER] Starting services...');

      // 启动服务的顺序很重要
      
      // 1. 首先启动设备信息服务
      await this.deviceInfoService.start();
      console.log('[SERVICE_MANAGER] Device info service started');

      // 2. 启动认证服务
      // 注意：认证可能是可选的，取决于配置
      try {
        const deviceInfo = await this.deviceInfoService.getDeviceInfo();
        const deviceId = this.configService.getDeviceId();
        await this.authService.authenticate(deviceId, deviceInfo);
        console.log('[SERVICE_MANAGER] Auth service authenticated');
      } catch (error) {
        console.warn('[SERVICE_MANAGER] Auth service authentication failed, continuing:', error);
      }

      // 3. 启动网络监控服务（带超时保护）
      try {
        const config = this.configService.getConfig();
        await this.withTimeout(
          Promise.resolve(this.networkMonitor.startMonitoring(config.serverUrl)),
          3000,
          'Network monitor start'
        );
        console.log('[SERVICE_MANAGER] Network monitor started');
      } catch (error) {
        console.warn('[SERVICE_MANAGER] Network monitor failed to start:', error);
        // 继续启动，不阻塞整个流程
      }

      // 4. 启动WebSocket服务（带超时保护）
      try {
        await this.withTimeout(
          this.webSocketService.connect(),
          5000,
          'WebSocket connection'
        );
        console.log('[SERVICE_MANAGER] WebSocket service connected');
      } catch (error) {
        console.warn('[SERVICE_MANAGER] WebSocket service connection failed, continuing:', error);
        // 继续启动，不阻塞整个流程
      }

      // 5. 启动数据同步服务
      await this.dataSyncService.start();
      console.log('[SERVICE_MANAGER] Data sync service started');

      // 6. 启动活动收集服务（注意：ActivityCollectorService会在DataCollectStateHandler中自动启动）
      // 这里不需要手动启动，因为它会被FSM状态处理器管理
      console.log('[SERVICE_MANAGER] Activity collector service will be managed by FSM');

      // 7. 最后启动FSM服务（它会协调整个流程）
      await this.fsmServiceManager.start();
      console.log('[SERVICE_MANAGER] FSM service started');

      this.isRunning = true;
      console.log('[SERVICE_MANAGER] All services started successfully');

    } catch (error: any) {
      console.error('[SERVICE_MANAGER] Failed to start services:', error);
      await this.stop(); // 清理已启动的服务
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[SERVICE_MANAGER] Stopping services...');

      // 停止服务的顺序与启动相反

      // 1. 停止FSM服务
      await this.fsmServiceManager.stop();
      console.log('[SERVICE_MANAGER] FSM service stopped');

      // 2. 停止活动收集服务（确保完全停止）
      try {
        if (this.activityCollectorService.isRunning()) {
          await this.activityCollectorService.stop();
          console.log('[SERVICE_MANAGER] Activity collector service stopped');
        }
      } catch (error) {
        console.warn('[SERVICE_MANAGER] Error stopping activity collector service:', error);
      }

      // 3. 停止数据同步服务
      await this.dataSyncService.stop();
      console.log('[SERVICE_MANAGER] Data sync service stopped');

      // 4. 停止WebSocket服务
      await this.webSocketService.disconnect();
      console.log('[SERVICE_MANAGER] WebSocket service disconnected');

      // 5. 停止网络监控服务
      this.networkMonitor.stopMonitoring();
      console.log('[SERVICE_MANAGER] Network monitor stopped');

      // 6. 登出认证服务
      await this.authService.logout();
      console.log('[SERVICE_MANAGER] Auth service logged out');

      // 7. 停止设备信息服务
      await this.deviceInfoService.stop();
      console.log('[SERVICE_MANAGER] Device info service stopped');

      // 8. 关闭离线缓存服务（保存快照）
      await this.offlineCacheService.shutdown();
      console.log('[SERVICE_MANAGER] Offline cache service shutdown');

      this.isRunning = false;
      console.log('[SERVICE_MANAGER] All services stopped');

    } catch (error: any) {
      console.error('[SERVICE_MANAGER] Error stopping services:', error);
    }
  }

  // 服务访问器
  getConfigService(): ConfigService {
    return this.configService;
  }

  getAuthService(): AuthService {
    return this.authService;
  }

  getDataSyncService(): DataSyncService {
    return this.dataSyncService;
  }

  getDeviceInfoService(): DeviceInfoService {
    return this.deviceInfoService;
  }

  getWebSocketService(): WebSocketService {
    return this.webSocketService;
  }

  getActivityCollectorService(): ActivityCollectorService {
    return this.activityCollectorService;
  }

  getFSMServiceManager(): FSMServiceManager {
    return this.fsmServiceManager;
  }

  // 状态查询
  isInitializedStatus(): boolean {
    return this.isInitialized;
  }

  isRunningStatus(): boolean {
    return this.isRunning;
  }

  // 健康检查
  getHealthStatus(): {
    overall: boolean;
    services: {
      config: any;
      auth: any;
      dataSync: any;
      deviceInfo: any;
      webSocket: any;
      fsm: any;
    };
  } {
    try {
      const services = {
        config: { healthy: true, initialized: this.isInitialized },
        auth: this.authService.healthCheck(),
        dataSync: this.dataSyncService.getStatus ? {
          healthy: this.dataSyncService.getStatus().isRunning,
          details: this.dataSyncService.getStatus()
        } : { healthy: true },
        deviceInfo: this.deviceInfoService.healthCheck(),
        webSocket: this.webSocketService.healthCheck(),
        fsm: { healthy: true, currentState: this.fsmServiceManager.getCurrentState() }
      };

      const overall = Object.values(services).every(service => service.healthy);

      return {
        overall,
        services
      };

    } catch (error: any) {
      console.error('[SERVICE_MANAGER] Health check failed:', error);
      return {
        overall: false,
        services: {
          config: { healthy: false, error: error.message },
          auth: { healthy: false, error: error.message },
          dataSync: { healthy: false, error: error.message },
          deviceInfo: { healthy: false, error: error.message },
          webSocket: { healthy: false, error: error.message },
          fsm: { healthy: false, error: error.message }
        }
      };
    }
  }

  // 私有方法
  private setupServiceIntegrations(): void {
    try {
      console.log('[SERVICE_MANAGER] Setting up service integrations...');

      // WebSocket服务事件集成
      this.webSocketService.on('connected', () => {
        console.log('[SERVICE_MANAGER] WebSocket connected');
        // 可以触发数据同步等操作
      });

      this.webSocketService.on('disconnected', () => {
        console.log('[SERVICE_MANAGER] WebSocket disconnected');
        // 可以暂停某些操作或切换到离线模式
      });

      // 监听WebSocket配置更新事件并传递给FSM
      this.webSocketService.on('config-update', (configData) => {
        console.log('[SERVICE_MANAGER] Configuration update received via WebSocket:', configData);

        // 提取嵌套的 data 字段（服务器返回格式: { success, data: {...}, timestamp }）
        const config = configData.data || configData;

        if (config && typeof config === 'object') {
          // 将服务器配置更新到本地配置服务
          try {
            // 只提取监控相关的配置字段，不包括 success/timestamp 等元数据
            const updatedConfig = {
              screenshotInterval: config.screenshotInterval,
              activityInterval: config.activityInterval,
              processScanInterval: config.processScanInterval,
              enableScreenshot: config.enableScreenshot,
              enableActivity: config.enableActivity,
              enableProcess: config.enableProcess
            };

            console.log('[SERVICE_MANAGER] Extracted config from WebSocket:', updatedConfig);

            // 调用配置服务的更新方法（如果存在）
            if (typeof (this.configService as any).updateConfig === 'function') {
              (this.configService as any).updateConfig(updatedConfig);
            }
            console.log('[SERVICE_MANAGER] ✅ Local configuration updated from WebSocket');

            // 将提取后的配置数据传递给FSM管理器
            this.fsmServiceManager.emit('config-update', updatedConfig);
            console.log('[SERVICE_MANAGER] Configuration update forwarded to FSM');
          } catch (error) {
            console.error('[SERVICE_MANAGER] ❌ Failed to update local configuration:', error);
          }
        } else {
          console.warn('[SERVICE_MANAGER] ⚠️ Invalid config data received, ignoring update');
        }
      });

      // 认证服务事件集成
      this.authService.on('authenticated', (data) => {
        console.log('[SERVICE_MANAGER] Device authenticated');
        // 可以启用某些需要认证的功能
      });

      this.authService.on('session-expired', () => {
        console.log('[SERVICE_MANAGER] Session expired');
        // 可以触发重新认证流程
      });

      // 数据同步服务事件集成
      this.dataSyncService.on('sync-completed', (data) => {
        console.log(`[SERVICE_MANAGER] Data sync completed: ${data.processed} items`);
      });

      this.dataSyncService.on('sync-error', (error) => {
        console.error('[SERVICE_MANAGER] Data sync error:', error);
      });

      // 设备信息服务事件集成
      this.deviceInfoService.on('device-info-updated', (deviceInfo) => {
        console.log('[SERVICE_MANAGER] Device info updated');
      });

      // 活动收集服务事件集成
      this.activityCollectorService.on('data-uploaded', (data) => {
        console.log('[SERVICE_MANAGER] Activity data uploaded successfully, resetting platform counters');
        try {
          // 触发平台适配器的计数器重置
          if (this.platformAdapter && typeof this.platformAdapter.onDataUploadSuccess === 'function') {
            this.platformAdapter.onDataUploadSuccess();
            console.log('[SERVICE_MANAGER] ✅ Platform counters reset after data upload');
          } else {
            console.warn('[SERVICE_MANAGER] ⚠️ Platform adapter does not support counter reset');
          }
        } catch (error) {
          console.error('[SERVICE_MANAGER] ❌ Failed to reset platform counters:', error);
        }
      });

      this.activityCollectorService.on('upload-error', (error) => {
        console.error('[SERVICE_MANAGER] Activity data upload failed:', error);
      });

      // 网络监控事件集成
      this.networkMonitor.on('online', (status) => {
        console.log('[SERVICE_MANAGER] Network status: ONLINE', status);
        // 通知FSM网络恢复
        this.fsmServiceManager.emit('network-online', status);
      });

      this.networkMonitor.on('offline', (status) => {
        console.log('[SERVICE_MANAGER] Network status: OFFLINE', status);
        // 通知FSM网络断开
        this.fsmServiceManager.emit('network-offline', status);
      });

      this.networkMonitor.on('status-changed', (newStatus, previousStatus) => {
        console.log('[SERVICE_MANAGER] Network status changed:', {
          previous: { online: previousStatus?.isOnline, server: previousStatus?.serverReachable },
          current: { online: newStatus.isOnline, server: newStatus.serverReachable }
        });
      });

      // 错误恢复服务事件集成
      this.errorRecoveryService.on('recovery-started', (event) => {
        console.log(`[SERVICE_MANAGER] Network recovery started: ${event.recoveryId}`);
        // 可以显示用户提示：正在尝试恢复连接
      });

      this.errorRecoveryService.on('recovery-completed', (event) => {
        console.log(`[SERVICE_MANAGER] Network recovery completed in ${event.duration}ms`);
        // 可以显示用户提示：连接已恢复
      });

      this.errorRecoveryService.on('recovery-failed', (event) => {
        console.error(`[SERVICE_MANAGER] Network recovery failed at stage: ${event.stage}`, event.reason);
        // 可以显示用户提示：连接恢复失败，将在离线模式下继续
      });

      this.errorRecoveryService.on('recovery-stage-completed', (event) => {
        console.log(`[SERVICE_MANAGER] Recovery stage completed: ${event.stage} (${event.duration}ms)`);
      });

      // WebSocket错误处理增强
      this.webSocketService.on('error', (error) => {
        console.error('[SERVICE_MANAGER] WebSocket error:', error);
        // 检查是否为网络相关错误
        if (NetworkMonitor.isNetworkError(error)) {
          console.log('[SERVICE_MANAGER] Network error detected, triggering recovery');
          // 触发错误恢复流程
          this.performNetworkRecovery();
        }
      });

      // FSM服务事件集成
      // TODO: FSMServiceManager需要暴露事件方法或继承EventEmitter
      // this.fsmServiceManager.on('state-changed', (event) => {
      //   console.log(`[SERVICE_MANAGER] FSM state changed: ${event.from} → ${event.to}`);
      // });

      console.log('[SERVICE_MANAGER] Service integrations configured');

    } catch (error: any) {
      console.error('[SERVICE_MANAGER] Failed to setup service integrations:', error);
    }
  }

  /**
   * 执行网络恢复流程
   */
  private async performNetworkRecovery(): Promise<void> {
    try {
      const config = this.configService.getConfig();
      const recoveryResult = await this.errorRecoveryService.performRecovery(
        config.serverUrl, 
        this.webSocketService
      );
      
      if (recoveryResult.success) {
        console.log('[SERVICE_MANAGER] Network recovery completed successfully');
      } else {
        console.error('[SERVICE_MANAGER] Network recovery failed:', recoveryResult.reason);
      }
    } catch (error) {
      console.error('[SERVICE_MANAGER] Error during network recovery:', error);
    }
  }

  /**
   * 获取网络监控状态
   */
  getNetworkStatus(): any {
    if (!this.networkMonitor) {
      return { available: false, error: 'Network monitor not initialized' };
    }
    
    return {
      available: true,
      status: this.networkMonitor.getCurrentStatus(),
      monitoring: this.isRunning
    };
  }

  /**
   * 获取错误恢复状态
   */
  getRecoveryStatus(): any {
    if (!this.errorRecoveryService) {
      return { available: false, error: 'Error recovery service not initialized' };
    }
    
    return {
      available: true,
      status: this.errorRecoveryService.getRecoveryStatus()
    };
  }


  // 获取服务状态
  async getStatus(): Promise<any> {
    try {
      const status = {
        configService: {
          initialized: this.isInitialized,
          deviceId: this.configService.getDeviceId()
        },
        authService: {
          authenticated: this.authService.isAuthenticated()
        },
        deviceInfoService: {
          healthy: this.deviceInfoService.healthCheck().healthy
        },
        webSocketService: {
          connected: this.webSocketService.isConnected()
        },
        fsmService: {
          currentState: this.fsmServiceManager.getCurrentState()
        }
      };
      return status;
    } catch (error: any) {
      console.error('[SERVICE_MANAGER] Failed to get status:', error);
      return {
        error: error.message
      };
    }
  }

  // 清理资源
  async cleanup(): Promise<void> {
    try {
      console.log('[SERVICE_MANAGER] Cleaning up resources...');

      // 清理所有服务
      if (this.authService.cleanup) {
        this.authService.cleanup();
      }

      if (this.webSocketService.cleanup) {
        this.webSocketService.cleanup();
      }

      console.log('[SERVICE_MANAGER] Cleanup completed');

    } catch (error: any) {
      console.error('[SERVICE_MANAGER] Cleanup failed:', error);
    }
  }

  /**
   * 带超时保护的异步操作包装器
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const error = new Error(`${operationName} timeout after ${timeoutMs}ms`);
        console.warn(`[SERVICE_MANAGER] ⚠️ ${operationName} timeout, continuing...`);
        reject(error);
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
}