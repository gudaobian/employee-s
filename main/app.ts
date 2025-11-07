/**
 * 应用程序主类
 * 统一管理所有服务和平台功能
 */

import { EventEmitter } from 'events';
import { DeviceState, DeviceFSMService } from '../common/services/fsm/device-fsm-service';
import { ServiceManager } from '../common/services';
import { TamperDetectionService, TamperEvent } from '../common/services/tamper-detection-service';
import { PowerEventService } from '../common/services/power-event-service';
import { PermissionMonitorService } from '../common/services/permission-monitor-service';
import { createPlatformAdapter, platformFactory } from '../platforms';
import { IPlatformAdapter as PlatformIPlatformAdapter } from '../platforms/interfaces/platform-interface';
import { IPlatformAdapter } from '../common/interfaces/platform-interface';
import { PlatformAdapterBridge } from './platform-adapter-bridge';
import { logger, timerManager } from '../common/utils';

export interface AppConfig {
  serverUrl?: string;
  deviceId?: string;
  enableMonitoring?: boolean;
  monitoringInterval?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  autoStart?: boolean;
  minimized?: boolean;
}

export enum AppState {
  STOPPED = 'stopped',
  STARTING = 'starting', 
  RUNNING = 'running',
  STOPPING = 'stopping',
  ERROR = 'error'
}

export class EmployeeMonitorApp extends EventEmitter {
  private state: AppState = AppState.STOPPED;
  private config: AppConfig;
  private serviceManager?: ServiceManager;
  private platformAdapter?: IPlatformAdapter;
  private stateMachine?: DeviceFSMService;
  private tamperDetectionService?: TamperDetectionService;
  private powerEventService?: PowerEventService;
  private permissionMonitorService?: PermissionMonitorService;
  private healthCheckTimer?: string;

  constructor(config: Partial<AppConfig> = {}) {
    super();
    
    this.config = {
      serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
      enableMonitoring: true,
      monitoringInterval: 30000, // 30秒
      logLevel: 'info',
      autoStart: false,
      minimized: false,
      ...config
    };
    
    // 注意：ServiceManager需要platformAdapter，将在initializeServices()中初始化
    
    try {
      logger.info('EmployeeMonitorApp created', { config: this.config });
    } catch (loggerError) {
      console.log('[APP] Logger failed in constructor, using console.log instead');
      console.log('[APP] EmployeeMonitorApp created with config:', this.config);
    }
  }

  /**
   * 启动应用程序
   */
  /**
   * 发送初始化进度事件
   */
  private emitProgress(message: string, percentage: number): void {
    this.emit('init-progress', { message, percentage });
    logger.info(`[INIT PROGRESS] ${percentage}% - ${message}`);
  }

  async start(): Promise<void> {
    if (this.state !== AppState.STOPPED) {
      throw new Error(`Cannot start app from state: ${this.state}`);
    }

    this.setState(AppState.STARTING);

    try {
      logger.info('Starting Employee Monitor App...');
      this.emitProgress('开始初始化应用程序...', 0);

      // 0. 等待网络就绪（新增）
      this.emitProgress('正在检测网络连接...', 10);
      await this.waitForNetworkReady(30000); // 最多等待30秒
      this.emitProgress('网络连接检测完成', 25);

      // 1. 初始化平台适配器（带超时保护）
      this.emitProgress('正在初始化平台适配器...', 30);
      await this.withTimeout(
        this.initializePlatform(),
        20000,
        'Platform initialization'
      );
      this.emitProgress('平台适配器初始化完成', 50);

      // 2. 初始化服务（带超时保护）
      this.emitProgress('正在初始化核心服务...', 55);
      await this.withTimeout(
        this.initializeServices(),
        30000,
        'Services initialization'
      );
      this.emitProgress('核心服务初始化完成', 75);

      // 3. 初始化状态机（但不启动，带超时保护）
      this.emitProgress('正在初始化设备状态机...', 80);
      await this.withTimeout(
        this.initializeStateMachine(),
        10000,
        'State machine initialization'
      );
      this.emitProgress('设备状态机初始化完成', 90);

      // 4. 启动健康检查
      this.emitProgress('正在启动健康检查...', 92);
      this.startHealthCheck();

      // 5. 启动篡改检测服务
      this.emitProgress('正在启动安全监控...', 95);
      this.initializeTamperDetection();

      // 6. 初始化电源事件服务
      this.emitProgress('正在启动电源事件监控...', 96);
      this.initializePowerEventService();

      // 7. 初始化权限监控服务（仅macOS）
      this.emitProgress('正在启动权限监控...', 98);
      this.initializePermissionMonitoring();

      this.setState(AppState.RUNNING);
      logger.info('Employee Monitor App started successfully');
      this.emitProgress('应用程序启动成功！', 100);

      this.emit('started');

    } catch (error) {
      this.setState(AppState.ERROR);
      logger.error('Failed to start Employee Monitor App', error);

      // 清理已初始化的资源
      await this.cleanup();

      throw error;
    }
  }

  /**
   * 停止应用程序
   */
  async stop(): Promise<void> {
    if (this.state === AppState.STOPPED || this.state === AppState.STOPPING) {
      return;
    }
    
    this.setState(AppState.STOPPING);
    
    try {
      logger.info('Stopping Employee Monitor App...');
      
      // 停止健康检查
      if (this.healthCheckTimer) {
        timerManager.clear(this.healthCheckTimer);
        this.healthCheckTimer = undefined;
      }

      // 停止篡改检测服务
      if (this.tamperDetectionService) {
        this.tamperDetectionService.stop();
      }

      // 停止电源事件服务
      if (this.powerEventService) {
        this.powerEventService.removeAllListeners();
        this.powerEventService = undefined;
      }

      // 停止权限监控服务
      if (this.permissionMonitorService) {
        this.permissionMonitorService.stop();
        this.permissionMonitorService = undefined;
      }

      // 停止状态机
      if (this.stateMachine) {
        await this.stateMachine.stop();
      }

      // 清理资源
      await this.cleanup();
      
      this.setState(AppState.STOPPED);
      logger.info('Employee Monitor App stopped successfully');
      
      this.emit('stopped');
      
    } catch (error) {
      this.setState(AppState.ERROR);
      logger.error('Error stopping Employee Monitor App', error);
      throw error;
    }
  }

  /**
   * 重启应用程序
   */
  async restart(): Promise<void> {
    logger.info('Restarting Employee Monitor App...');
    
    await this.stop();
    await this.start();
    
    this.emit('restarted');
  }

  /**
   * 启动监控（启动 FSM）
   */
  async startMonitoring(): Promise<void> {
    if (this.state !== AppState.RUNNING) {
      throw new Error('App must be running to start monitoring');
    }
    
    if (!this.stateMachine) {
      throw new Error('State machine not initialized');
    }
    
    logger.info('Starting monitoring (FSM)...');
    
    // 启动前刷新配置，确保使用最新的 UI 配置
    await this.refreshConfigFromUI();
    
    // 启动状态机
    await this.stateMachine.start();
    
    logger.info('Monitoring started successfully');
    this.emit('monitoringStarted');
  }

  /**
   * 停止监控（停止 FSM）
   */
  async stopMonitoring(): Promise<void> {
    if (!this.stateMachine) {
      throw new Error('State machine not initialized');
    }
    
    logger.info('Stopping monitoring (FSM)...');
    
    // 停止状态机
    await this.stateMachine.stop();
    
    logger.info('Monitoring stopped successfully');
    this.emit('monitoringStopped');
  }

  /**
   * 从 UI/配置服务刷新配置
   */
  private async refreshConfigFromUI(): Promise<void> {
    try {
      if (!this.serviceManager) {
        logger.warn('ServiceManager not available, using current config');
        return;
      }
      
      const configService = this.serviceManager.getConfigService();
      if (configService) {
        const latestConfig = configService.getConfig();
        logger.info('Refreshing config from UI:', {
          serverUrl: latestConfig.serverUrl,
          websocketUrl: latestConfig.websocketUrl
        });
        
        // 更新应用配置
        this.updateConfig({
          serverUrl: latestConfig.serverUrl
        });
      }
    } catch (error) {
      logger.error('Failed to refresh config from UI:', error);
    }
  }

  /**
   * 获取应用程序状态
   */
  getState(): AppState {
    return this.state;
  }

  /**
   * 获取监控状态
   */
  getMonitoringState(): { isRunning: boolean; deviceState?: DeviceState } {
    return {
      isRunning: this.stateMachine ? this.stateMachine.isServiceRunning() : false,
      deviceState: this.stateMachine?.getCurrentState()
    };
  }

  /**
   * 获取配置
   */
  getConfig(): AppConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<AppConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // 通知服务管理器更新配置
    if (newConfig.serverUrl && this.serviceManager) {
      // 暂时跳过，因为updateConfig方法不存在
      // this.serviceManager.updateConfig({ serverUrl: newConfig.serverUrl });
    }
    
    logger.info('App config updated', { newConfig });
    this.emit('configUpdated', this.config);
  }

  /**
   * 获取详细状态
   */
  async getDetailedStatus(): Promise<{
    appState: AppState;
    deviceState?: DeviceState;
    platformInfo: any;
    servicesStatus: any;
    lastActivity?: Date;
    uptime: number;
  }> {
    const platformInfo = this.platformAdapter ? {
      capabilities: this.platformAdapter.getPlatformSpecificCapabilities(),
      systemInfo: await this.platformAdapter.getSystemInfo().catch(() => null)
    } : null;
    
    const servicesStatus = this.serviceManager ? await this.serviceManager.getStatus?.() : null;
    
    return {
      appState: this.state,
      deviceState: this.stateMachine?.getCurrentState(),
      platformInfo,
      servicesStatus,
      uptime: process.uptime()
    };
  }

  /**
   * 执行手动同步
   */
  async syncData(): Promise<void> {
    if (this.state !== AppState.RUNNING) {
      throw new Error('App must be running to sync data');
    }
    
    if (!this.serviceManager) {
      throw new Error('Service manager not initialized');
    }
    
    logger.info('Manual data sync requested');
    // 暂时跳过，因为syncData方法不存在
    // await this.serviceManager.syncData();
    this.emit('dataSynced');
  }

  /**
   * 手动截屏
   */
  async takeScreenshot(): Promise<Buffer | null> {
    if (!this.platformAdapter) {
      throw new Error('Platform adapter not initialized');
    }
    
    const result = await this.platformAdapter.takeScreenshot();
    if (result.success && result.data) {
      this.emit('screenshotTaken');
      return result.data;
    }
    
    throw new Error(result.error || 'Screenshot failed');
  }

  /**
   * 获取平台适配器
   */
  getPlatformAdapter(): IPlatformAdapter | undefined {
    return this.platformAdapter;
  }

  /**
   * 获取服务管理器
   */
  getServiceManager(): ServiceManager | undefined {
    return this.serviceManager;
  }

  /**
   * 获取状态机
   */
  getStateMachine(): DeviceFSMService | undefined {
    return this.stateMachine;
  }

  // === Private Methods ===

  private setState(newState: AppState): void {
    const oldState = this.state;
    this.state = newState;
    
    logger.info(`App state changed: ${oldState} -> ${newState}`);
    this.emit('stateChanged', { oldState, newState });
  }

  private async initializePlatform(): Promise<void> {
    logger.info('Initializing platform adapter...');
    
    try {
      const rawPlatformAdapter = await createPlatformAdapter();
      this.platformAdapter = new PlatformAdapterBridge(rawPlatformAdapter);
      
      // Initialize the bridge adapter
      await this.platformAdapter.initialize();
      
      logger.info('Platform adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize platform adapter', error);
      throw new Error(`Platform initialization failed: ${error}`);
    }
  }

  private async initializeServices(): Promise<void> {
    logger.info('Initializing services...');
    
    try {
      // 创建服务管理器（需要platformAdapter）
      this.serviceManager = new ServiceManager(this.platformAdapter!, undefined, this);
      
      await this.serviceManager.initialize();
      
      // 设置网络状态监听
      this.setupNetworkEventListeners();
      
      logger.info('Services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize services', error);
      throw new Error(`Service initialization failed: ${error}`);
    }
  }

  private async initializeStateMachine(): Promise<void> {
    logger.info('Initializing state machine...');

    try {
      // 获取服务实例
      const configService = this.serviceManager?.getConfigService();
      const websocketService = this.serviceManager?.getWebSocketService();
      const activityCollectorService = this.serviceManager?.getActivityCollectorService();

      // 创建FSM服务实例，传入必要的依赖
      this.stateMachine = new DeviceFSMService(
        configService,
        this.platformAdapter,
        this,
        activityCollectorService,
        websocketService
      );
      
      // 监听状态变化
      this.stateMachine.on('state-changed', (data) => {
        logger.info(`Device state changed: ${data.from} -> ${data.to}`);
        this.emit('deviceStateChanged', data);
      });
      
      this.stateMachine.on('error', (error) => {
        logger.error('State machine error', error);
        this.emit('error', error);
      });
      
      logger.info('State machine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize state machine', error);
      throw new Error(`State machine initialization failed: ${error}`);
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = timerManager.setInterval(
      async () => {
        try {
          await this.performHealthCheck();
        } catch (error) {
          logger.error('Health check failed', error);
        }
      },
      60000, // 每分钟检查一次
      'app-health-check'
    );

    logger.info('Health check started');
  }

  /**
   * 初始化篡改检测服务
   */
  private initializeTamperDetection(): void {
    try {
      logger.info('[TamperDetection] Initializing service...');

      // 创建篡改检测服务实例
      this.tamperDetectionService = new TamperDetectionService({
        intervalMs: 30000, // 每30秒检查一次
        enabled: true
      });

      // 监听篡改事件
      this.tamperDetectionService.on('tamper', (event: TamperEvent) => {
        logger.error('[Security] 🚨 Tamper detected!', event);

        // 发出应用级篡改事件
        this.emit('tamperDetected', event);

        // 可选：执行额外的安全措施
        // - 通知管理员（via WebSocket or HTTP API）
        // - 进入安全模式
        // - 显示警告给用户
        this.handleTamperEvent(event);
      });

      // 启动篡改检测
      this.tamperDetectionService.start(30000);

      logger.info('[TamperDetection] Service started successfully');
    } catch (error) {
      logger.error('[TamperDetection] Failed to initialize service:', error);
      // 不抛出异常，允许应用继续运行
    }
  }

  /**
   * 初始化电源事件服务
   */
  private initializePowerEventService(): void {
    try {
      logger.info('[POWER_EVENT] Initializing service...');

      // 创建电源事件服务实例
      this.powerEventService = new PowerEventService();

      // 监听系统唤醒事件
      this.powerEventService.on('system-resume', (event) => {
        this.handleSystemResume(event);
      });

      // 监听系统休眠事件
      this.powerEventService.on('system-suspend', (event) => {
        this.handleSystemSuspend(event);
      });

      logger.info('[POWER_EVENT] Service started successfully');
    } catch (error) {
      logger.error('[POWER_EVENT] Failed to initialize service:', error);
      // 不抛出异常，允许应用继续运行
    }
  }

  /**
   * 初始化权限监控服务（仅macOS）
   */
  private async initializePermissionMonitoring(): Promise<void> {
    if (process.platform !== 'darwin') {
      logger.debug('[PermissionMonitor] Skipping - not macOS');
      return;
    }

    try {
      logger.info('[PermissionMonitor] Initializing service...');

      // 创建权限监控服务实例
      this.permissionMonitorService = new PermissionMonitorService();

      // 监听权限撤销事件
      this.permissionMonitorService.on('permission-revoked', (result) => {
        logger.warn('[App] ⚠️ Accessibility permission was revoked!');
        logger.warn('[App] 浏览器URL采集功能已停止工作');
        logger.info('[App] 请重新授予权限: npm run open-accessibility-settings');

        // 刷新平台适配器的权限状态（如果支持）
        if (this.platformAdapter && (this.platformAdapter as any).refreshPermissionStatus) {
          (this.platformAdapter as any).refreshPermissionStatus().catch((error: Error) => {
            logger.error('[App] Failed to refresh permission status:', error);
          });
        }

        // 发出应用事件
        this.emit('permission-revoked', result);
      });

      // 监听权限授予事件
      this.permissionMonitorService.on('permission-granted', (result) => {
        logger.info('[App] ✅ Accessibility permission was granted!');
        logger.info('[App] 浏览器URL采集功能已恢复');

        // 刷新平台适配器的权限状态（如果支持）
        if (this.platformAdapter && (this.platformAdapter as any).refreshPermissionStatus) {
          (this.platformAdapter as any).refreshPermissionStatus().catch((error: Error) => {
            logger.error('[App] Failed to refresh permission status:', error);
          });
        }

        // 发出应用事件
        this.emit('permission-granted', result);
      });

      // 启动权限监控（每60秒检查一次）
      await this.permissionMonitorService.start(60000);

      logger.info('[PermissionMonitor] Service started successfully');
    } catch (error) {
      logger.error('[PermissionMonitor] Failed to initialize service:', error);
      // 不抛出异常，允许应用继续运行
    }
  }

  /**
   * 处理系统唤醒事件
   */
  private async handleSystemResume(event: {
    timestamp: number;
    suspendDuration: number
  }): Promise<void> {
    logger.info('[APP] Handling system resume', {
      suspendDuration: `${Math.round(event.suspendDuration / 1000)}s`
    });

    // 等待 2 秒让网络稳定
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 检查 WebSocket 连接状态
    const wsService = this.serviceManager?.getWebSocketService();
    if (wsService) {
      const isConnected = wsService.isConnected();

      if (!isConnected) {
        logger.warn('[APP] WebSocket disconnected after resume, triggering reconnection');

        try {
          await wsService.connect();
          logger.info('[APP] ✅ WebSocket reconnected successfully');
        } catch (error) {
          logger.error('[APP] ❌ Failed to reconnect WebSocket:', error);
        }
      } else {
        logger.info('[APP] ✅ WebSocket already connected');
      }
    }

    // 触发状态机检查
    if (this.stateMachine) {
      this.stateMachine.emit('network-recovered');
    }
  }

  /**
   * 处理系统休眠事件
   */
  private handleSystemSuspend(event: { timestamp: number }): void {
    logger.info('[APP] Handling system suspend');

    const wsService = this.serviceManager?.getWebSocketService();
    if (wsService) {
      const isConnected = wsService.isConnected();
      logger.info('[APP] WebSocket state before suspend:', { isConnected });
    }
  }

  /**
   * 处理篡改事件
   */
  private handleTamperEvent(event: TamperEvent): void {
    try {
      // 1. 记录详细日志
      logger.warn('[Security] Handling tamper event:', {
        type: event.type,
        platform: event.platform,
        timestamp: new Date(event.timestamp).toISOString(),
        details: event.details
      });

      // 2. 可选：通过WebSocket通知服务器
      if (this.serviceManager) {
        const wsService = this.serviceManager.getWebSocketService();
        if (wsService && wsService.isConnected()) {
          wsService.send({ type: 'tamper-alert', data: event }).catch(error => {
            logger.error('[Security] Failed to send tamper alert to server:', error);
          });
        }
      }

      // 3. 可选：显示系统通知
      this.showSecurityNotification(
        '安全警告',
        `检测到潜在的篡改行为: ${event.details}`,
        'error'
      );

      // 4. 可选：根据篡改类型采取措施
      switch (event.type) {
        case 'permission_revoked':
          logger.error('[Security] Permission was revoked - monitoring may be compromised');
          // 可以选择暂停监控或请求重新授权
          break;
        case 'service_stopped':
          logger.error('[Security] Required service was stopped - monitoring may be compromised');
          // 可以尝试重启服务或通知管理员
          break;
        case 'extension_removed':
          logger.error('[Security] Browser extension was removed');
          break;
      }
    } catch (error) {
      logger.error('[Security] Error handling tamper event:', error);
    }
  }

  /**
   * 显示安全通知
   */
  private showSecurityNotification(title: string, message: string, type: 'success' | 'warning' | 'error'): void {
    try {
      // 复用现有的通知方法
      this.showNetworkNotification(title, message, type);
    } catch (error) {
      logger.error('[Security] Failed to show security notification:', error);
    }
  }

  private async performHealthCheck(): Promise<void> {
    // 检查服务状态
    const servicesStatus = this.serviceManager ? await this.serviceManager.getStatus?.() : null;
    
    // 检查平台适配器状态
    const platformHealthy = this.platformAdapter !== undefined;
    
    // 检查状态机状态
    const stateMachineHealthy = this.stateMachine ? true : false; // TODO: 添加isRunning公共方法
    
    const healthStatus = {
      services: servicesStatus,
      platform: platformHealthy,
      stateMachine: stateMachineHealthy,
      timestamp: new Date()
    };
    
    this.emit('healthCheck', healthStatus);
    
    // 如果发现问题，记录警告
    if (!platformHealthy || !stateMachineHealthy) {
      logger.warn('Health check detected issues', healthStatus);
    }
  }

  private async cleanup(): Promise<void> {
    logger.info('Cleaning up resources...');
    
    const cleanupTasks = [];
    
    // 清理服务管理器
    if (this.serviceManager && this.serviceManager.cleanup) {
      cleanupTasks.push(
        this.serviceManager.cleanup().catch(error => 
          logger.error('Error cleaning up service manager', error)
        )
      );
    }
    
    // 清理平台适配器
    if (this.platformAdapter) {
      cleanupTasks.push(
        this.platformAdapter.cleanup().catch(error => 
          logger.error('Error cleaning up platform adapter', error)
        )
      );
    }
    
    // 重置平台工厂以确保下次启动时创建新的适配器实例
    cleanupTasks.push(
      platformFactory.resetAdapter().catch(error => 
        logger.error('Error resetting platform factory', error)
      )
    );
    
    // 清理状态机
    if (this.stateMachine) {
      // TODO: 添加cleanup方法到DeviceFSMService
      // cleanupTasks.push(
      //   this.stateMachine.cleanup().catch(error => 
      //     logger.error('Error cleaning up state machine', error)
      //   )
      // );
    }
    
    // 等待所有清理任务完成
    await Promise.allSettled(cleanupTasks);
    
    // 重置引用
    this.platformAdapter = undefined;
    this.stateMachine = undefined;
    
    logger.info('Resource cleanup completed');
  }

  /**
   * 检查权限状态
   */
  async checkPermissions(permissions?: any): Promise<any> {
    if (!this.platformAdapter) {
      throw new Error('Platform adapter not initialized');
    }
    
    return await this.platformAdapter.checkPermissions();
  }

  /**
   * 请求权限
   */
  async requestPermissions(permissions?: any): Promise<any> {
    if (!this.platformAdapter) {
      throw new Error('Platform adapter not initialized');
    }
    
    return await this.platformAdapter.requestPermissions();
  }

  /**
   * 强制状态转换
   */
  async forceStateTransition(targetState: DeviceState): Promise<void> {
    if (!this.stateMachine) {
      throw new Error('State machine not initialized');
    }
    
    return await this.stateMachine.transitionTo(targetState);
  }

  /**
   * 设置网络事件监听器
   */
  private setupNetworkEventListeners(): void {
    if (!this.serviceManager) {
      logger.warn('[APP] Cannot setup network listeners: ServiceManager not initialized');
      return;
    }

    try {
      // 监听网络状态变化事件从ServiceManager
      // 由于ServiceManager本身不是EventEmitter，我们通过监听其内部服务的事件
      
      // 为了简化，我们直接在ServiceManager中设置了网络事件日志
      // 这里我们可以添加应用层的网络状态通知
      
      // 监听应用状态变化，在网络状态改变时发出通知
      this.on('network-status-changed', (status) => {
        this.handleNetworkStatusChange(status);
      });

      logger.info('[APP] Network event listeners setup completed');
    } catch (error) {
      logger.error('[APP] Failed to setup network event listeners:', error);
    }
  }

  /**
   * 处理网络状态变化
   */
  private handleNetworkStatusChange(status: { isOnline: boolean; serverReachable: boolean }): void {
    try {
      if (status.isOnline && status.serverReachable) {
        this.showNetworkNotification('网络已恢复', '已成功连接到服务器，数据同步将恢复正常', 'success');
        logger.info('[APP] Network recovered - online and server reachable');
      } else if (status.isOnline && !status.serverReachable) {
        this.showNetworkNotification('服务器连接中断', '网络正常但无法连接到服务器，正在尝试重新连接', 'warning');
        logger.warn('[APP] Network online but server unreachable');
      } else {
        this.showNetworkNotification('网络连接中断', '已切换到离线模式，数据将在网络恢复后同步', 'error');
        logger.warn('[APP] Network offline - switched to offline mode');
      }
    } catch (error) {
      logger.error('[APP] Error handling network status change:', error);
    }
  }

  /**
   * 显示网络状态通知
   */
  private showNetworkNotification(title: string, message: string, type: 'success' | 'warning' | 'error'): void {
    try {
      // 控制台通知
      const timestamp = new Date().toLocaleTimeString();
      const prefix = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '❌';

      console.log(`[${timestamp}] ${prefix} ${title}: ${message}`);
      logger.info(`[NETWORK_NOTIFICATION] ${title}: ${message}`, { type });

      // 发出应用事件供外部监听
      this.emit('notification', {
        title,
        message,
        type,
        timestamp: new Date(),
        category: 'network'
      });

      // 如果是桌面应用环境，可以显示系统通知
      if (typeof window !== 'undefined' && 'Notification' in window) {
        // 浏览器环境的系统通知
        if (Notification.permission === 'granted') {
          new Notification(title, {
            body: message,
            icon: type === 'success' ? '/icons/success.png' :
                  type === 'warning' ? '/icons/warning.png' : '/icons/error.png'
          });
        }
      }

      // Electron环境的通知 (如果运行在Electron中)
      if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
        try {
          // 通过IPC发送通知给主进程
          if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('show-notification', { title, message, type });
          }
        } catch (error) {
          // 静默失败，因为可能不在渲染进程中
        }
      }

    } catch (error) {
      logger.error('[APP] Failed to show network notification:', error);
      // 确保至少有控制台输出
      console.error(`[NOTIFICATION_ERROR] ${title}: ${message}`);
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
        logger.error(`[APP] ⚠️ ${operationName} timeout`, error);
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

  /**
   * 获取网络状态
   */
  async getNetworkStatus(): Promise<any> {
    try {
      if (!this.serviceManager) {
        throw new Error('ServiceManager not initialized');
      }

      // 从ServiceManager获取网络状态
      const networkStatus = this.serviceManager.getNetworkStatus();
      const recoveryStatus = this.serviceManager.getRecoveryStatus();

      return {
        network: networkStatus,
        recovery: recoveryStatus,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('[APP] Failed to get network status:', error);
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 等待网络就绪
   * 在启动FSM前确保网络已经可用
   */
  private async waitForNetworkReady(maxWaitTime: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 5000; // 每5秒检查一次
    let attempt = 0;
    const maxAttempts = Math.ceil(maxWaitTime / checkInterval);

    logger.info('[APP] Waiting for network ready...');

    while (Date.now() - startTime < maxWaitTime) {
      attempt++;
      const progressBase = 10;
      const progressRange = 15; // 10% to 25%
      const currentProgress = progressBase + Math.floor((attempt / maxAttempts) * progressRange);

      try {
        // 1. 检查网卡状态
        this.emitProgress(`检查网络适配器状态... (${attempt}/${maxAttempts})`, currentProgress);
        const hasActiveAdapter = await this.checkNetworkAdapter();
        if (!hasActiveAdapter) {
          logger.debug('[APP] No active network adapter, waiting...');
          this.emitProgress('等待网络适配器就绪...', currentProgress);
          await this.sleep(checkInterval);
          continue;
        }

        // 2. 检查DNS解析
        this.emitProgress(`检查DNS解析... (${attempt}/${maxAttempts})`, currentProgress + 2);
        const dnsWorks = await this.checkDNS();
        if (!dnsWorks) {
          logger.debug('[APP] DNS not ready, waiting...');
          this.emitProgress('等待DNS服务就绪...', currentProgress + 2);
          await this.sleep(checkInterval);
          continue;
        }

        // 3. 检查API server连通性
        this.emitProgress(`检查API服务器连通性... (${attempt}/${maxAttempts})`, currentProgress + 4);
        const apiReachable = await this.checkAPIServer();
        if (!apiReachable) {
          logger.debug('[APP] API server not reachable, waiting...');
          this.emitProgress('等待API服务器就绪...', currentProgress + 4);
          await this.sleep(checkInterval);
          continue;
        }

        logger.info('[APP] Network is ready!');
        return true;

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug(`[APP] Network check failed: ${errorMsg}, retrying...`);
        await this.sleep(checkInterval);
      }
    }

    logger.warn('[APP] Network ready timeout, proceeding anyway...');
    return false;
  }

  /**
   * 检查网卡状态
   */
  private async checkNetworkAdapter(): Promise<boolean> {
    try {
      const os = await import('os');
      const interfaces = os.networkInterfaces();

      if (!interfaces) {
        return false;
      }

      // 检查是否有活动的非回环网络接口
      for (const name of Object.keys(interfaces)) {
        const addrs = interfaces[name];
        if (!addrs) continue;

        for (const addr of addrs) {
          // 忽略回环地址和内部地址
          if (!addr.internal && addr.family === 'IPv4') {
            logger.debug(`[APP] Found active network adapter: ${name} (${addr.address})`);
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      logger.debug(`[APP] Error checking network adapter: ${error}`);
      return false;
    }
  }

  /**
   * 检查DNS解析
   * 使用多个备选域名提高检测成功率
   */
  private async checkDNS(): Promise<boolean> {
    try {
      const dns = await import('dns');
      const { promisify } = await import('util');
      const lookup = promisify(dns.lookup);

      // 使用多个备选域名
      const testDomains = [
        'www.baidu.com',      // 中国大陆
        'www.taobao.com',     // 中国大陆
        'www.cloudflare.com', // 国际
        '1.1.1.1'             // Cloudflare DNS
      ];

      // 串行测试，任意一个成功即可
      for (const domain of testDomains) {
        try {
          await lookup(domain);
          logger.debug(`[APP] DNS resolution working (${domain})`);
          return true;
        } catch (error) {
          logger.debug(`[APP] DNS test failed for ${domain}`);
          continue;
        }
      }

      logger.debug('[APP] All DNS tests failed');
      return false;
    } catch (error) {
      logger.debug(`[APP] DNS resolution failed: ${error}`);
      return false;
    }
  }

  /**
   * 检查API服务器连通性
   */
  private async checkAPIServer(): Promise<boolean> {
    try {
      const https = await import('https');
      const http = await import('http');
      const url = await import('url');

      const serverUrl = this.config.serverUrl || 'http://localhost:3000';
      const parsedUrl = new url.URL(serverUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      return new Promise<boolean>((resolve) => {
        const timeout = 2000; // 2秒超时

        const req = client.get(parsedUrl.href, { timeout }, (res) => {
          logger.debug(`[APP] API server reachable, status: ${res.statusCode}`);
          resolve(true);
        });

        req.on('error', (error) => {
          logger.debug(`[APP] API server unreachable: ${error.message}`);
          resolve(false);
        });

        req.on('timeout', () => {
          req.destroy();
          logger.debug('[APP] API server check timeout');
          resolve(false);
        });
      });
    } catch (error) {
      logger.debug(`[APP] Error checking API server: ${error}`);
      return false;
    }
  }

  /**
   * 延迟辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default EmployeeMonitorApp;