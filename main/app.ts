/**
 * 应用程序主类
 * 统一管理所有服务和平台功能
 */

import { EventEmitter } from 'events';
import { DeviceState, DeviceFSMService } from '../common/services/fsm/device-fsm-service';
import { ServiceManager } from '../common/services';
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
  async start(): Promise<void> {
    if (this.state !== AppState.STOPPED) {
      throw new Error(`Cannot start app from state: ${this.state}`);
    }

    this.setState(AppState.STARTING);

    try {
      logger.info('Starting Employee Monitor App...');

      // 0. 等待网络就绪（新增）
      await this.waitForNetworkReady(60000); // 最多等待60秒

      // 1. 初始化平台适配器（带超时保护）
      await this.withTimeout(
        this.initializePlatform(),
        20000,
        'Platform initialization'
      );

      // 2. 初始化服务（带超时保护）
      await this.withTimeout(
        this.initializeServices(),
        30000,
        'Services initialization'
      );

      // 3. 初始化状态机（但不启动，带超时保护）
      await this.withTimeout(
        this.initializeStateMachine(),
        10000,
        'State machine initialization'
      );

      // 4. 启动健康检查
      this.startHealthCheck();

      this.setState(AppState.RUNNING);
      logger.info('Employee Monitor App started successfully');

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

    logger.info('[APP] Waiting for network ready...');

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // 1. 检查网卡状态
        const hasActiveAdapter = await this.checkNetworkAdapter();
        if (!hasActiveAdapter) {
          logger.debug('[APP] No active network adapter, waiting...');
          await this.sleep(checkInterval);
          continue;
        }

        // 2. 检查DNS解析
        const dnsWorks = await this.checkDNS();
        if (!dnsWorks) {
          logger.debug('[APP] DNS not ready, waiting...');
          await this.sleep(checkInterval);
          continue;
        }

        // 3. 检查API server连通性
        const apiReachable = await this.checkAPIServer();
        if (!apiReachable) {
          logger.debug('[APP] API server not reachable, waiting...');
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
   */
  private async checkDNS(): Promise<boolean> {
    try {
      const dns = await import('dns');
      const { promisify } = await import('util');
      const lookup = promisify(dns.lookup);

      // 尝试解析一个常见的域名
      await lookup('www.google.com');
      logger.debug('[APP] DNS resolution working');
      return true;
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
        const timeout = 5000; // 5秒超时

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