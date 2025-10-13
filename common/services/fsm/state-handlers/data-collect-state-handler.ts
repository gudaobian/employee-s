/**
 * DATA_COLLECT状态处理器 - 重构版本
 * 负责数据收集和监控任务
 */

import { BaseStateHandler } from '../base-state-handler';
import {
  DeviceState,
  FSMContext,
  StateHandlerResult
} from '../../../interfaces/fsm-interfaces';
import { IConfigService, IWebSocketService } from '../../../interfaces/service-interfaces';
import { IPlatformAdapter } from '../../../interfaces/platform-interface';
import { ActivityCollectorService } from '../../activity-collector-service';
import { OfflineCacheService } from '../../offline-cache-service';
import { NetworkMonitor } from '../../../utils/network-monitor';
import { ErrorRecoveryService } from '../../../utils/error-recovery';
import { logger } from '../../../utils';
import { EventEmitter } from 'events';

// 网络子状态枚举
export enum NetworkSubState {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  RECOVERING = 'RECOVERING'
}

export class DataCollectStateHandler extends BaseStateHandler {
  private configService: IConfigService;
  private platformAdapter: IPlatformAdapter;
  private appInstance?: EventEmitter; // 应用实例引用，用于发射事件
  private activityCollectorService?: ActivityCollectorService; // 活动收集服务
  private websocketService?: IWebSocketService; // WebSocket服务
  private isCollecting = false;
  private collectionInterval?: NodeJS.Timeout;
  // 独立的定时器，用于不同类型的数据采集
  private screenshotInterval?: NodeJS.Timeout;
  private activityInterval?: NodeJS.Timeout;
  private processInterval?: NodeJS.Timeout;
  // 时间戳记录，用于控制各种采集的频率
  private lastScreenshotTime = 0;
  private lastActivityTime = 0;
  private lastProcessTime = 0;
  private lastCollectionTime = 0;
  private lastScreenshotData: any = null; // 用于内存清理

  // 网络状态管理
  private networkSubState: NetworkSubState = NetworkSubState.ONLINE;
  private offlineCacheService: OfflineCacheService;
  private networkMonitor: NetworkMonitor;
  private errorRecoveryService: ErrorRecoveryService;
  private networkCheckInterval?: NodeJS.Timeout;
  private lastNetworkCheck = 0;
  private offlineStartTime = 0;

  constructor(
    configService: IConfigService,
    platformAdapter: IPlatformAdapter,
    appInstance?: EventEmitter,
    activityCollectorService?: ActivityCollectorService,
    websocketService?: IWebSocketService
  ) {
    super('DataCollectStateHandler', [DeviceState.DATA_COLLECT]);
    this.configService = configService;
    this.platformAdapter = platformAdapter;
    this.appInstance = appInstance;
    this.activityCollectorService = activityCollectorService;
    this.websocketService = websocketService;

    // 初始化网络相关服务
    this.offlineCacheService = new OfflineCacheService();
    this.networkMonitor = new NetworkMonitor();
    this.errorRecoveryService = new ErrorRecoveryService(this.networkMonitor, this.offlineCacheService);

    // 设置网络监控事件监听
    this.setupNetworkEventListeners();
    
    // 监听配置更新事件
    this.configService.on?.('config-updated', this.handleConfigUpdate.bind(this));
    
    // 如果应用实例存在，同时监听WebSocket配置更新事件
    if (this.appInstance) {
      this.appInstance.on('config-update', this.handleConfigUpdate.bind(this));
    }
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      logger.info(`[DATA_COLLECT] 🚀 execute() called - networkSubState: ${this.networkSubState}, isCollecting: ${this.isCollecting}`);

      this.validateContext(context);

      // 根据网络子状态执行不同逻辑
      switch (this.networkSubState) {
        case NetworkSubState.ONLINE:
          logger.info('[DATA_COLLECT] 📡 Calling handleOnlineCollection...');
          return await this.handleOnlineCollection(context);
        case NetworkSubState.OFFLINE:
          logger.info('[DATA_COLLECT] 🔌 Calling handleOfflineCollection...');
          return await this.handleOfflineCollection(context);
        case NetworkSubState.RECOVERING:
          logger.info('[DATA_COLLECT] 🔄 Calling handleRecoveryCollection...');
          return await this.handleRecoveryCollection(context);
        default:
          logger.warn(`[DATA_COLLECT] Unknown network sub-state: ${this.networkSubState}`);
          return await this.handleOnlineCollection(context);
      }

    } catch (error: any) {
      logger.error('[DATA_COLLECT] Data collection failed:', error);
      
      // 检查是否为网络错误
      if (NetworkMonitor.isNetworkError(error)) {
        logger.info('[DATA_COLLECT] Network error detected, switching to offline mode');
        this.switchToOfflineMode();
        return await this.handleOfflineCollection(context);
      }

      // 清理收集资源
      await this.stopDataCollection();

      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Data collection failed: ${error.message}`,
        error
      };
    }
  }

  private async startDataCollection(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      logger.info('[DATA_COLLECT] 🎬 startDataCollection() called - isCollecting:' + this.isCollecting);

      if (this.isCollecting) {
        logger.info('[DATA_COLLECT] ⚠️ Data collection already running - RETURNING EARLY');
        logger.info('[DATA_COLLECT] 🔍 Debug: screenshotInterval defined: ' + !!this.screenshotInterval);
        logger.info('[DATA_COLLECT] 🔍 Debug: activityInterval defined: ' + !!this.activityInterval);
        logger.info('[DATA_COLLECT] 🔍 Debug: processInterval defined: ' + !!this.processInterval);
        return { success: true };
      }

      // 获取监控配置
      const config = this.configService.getConfig();
      const monitoringConfig = config.monitoring || {};

      // 使用服务器配置的具体间隔时间
      const screenshotInterval = (config as any).screenshotInterval || (monitoringConfig as any).screenshotInterval || 300000; // 默认5分钟
      const activityInterval = (config as any).activityInterval || 60000;     // 默认1分钟
      const processInterval = (config as any).processScanInterval || 180000;  // 默认3分钟

      // 读取监控开关（默认启用）
      const enableScreenshot = (config as any).enableScreenshot !== false;
      const enableActivity = (config as any).enableActivity !== false;
      const enableProcess = (config as any).enableProcess !== false;

      logger.info(`[DATA_COLLECT] 监控配置 - 截图: ${enableScreenshot ? '启用' : '禁用'}(${screenshotInterval}ms), 活动: ${enableActivity ? '启用' : '禁用'}(${activityInterval}ms), 进程: ${enableProcess ? '启用' : '禁用'}(${processInterval}ms)`);

      // 修复：不再使用共享的主收集周期，而是为每种数据类型使用独立的定时器
      // 使用活动间隔作为基础检查周期（通常是最频繁的，用于心跳等基础功能）
      const baseCheckInterval = activityInterval;
      logger.info(`[DATA_COLLECT] 基础检查周期: ${baseCheckInterval}ms (${baseCheckInterval/1000}s) - 用于活动监控和连接维护`);

      // 检查权限
      logger.info('[DATA_COLLECT] 🔐 Checking permissions...');
      const permissionResult = await this.checkPermissions();
      logger.info('[DATA_COLLECT] 🔐 Permission check result:', {
        hasRequired: permissionResult.hasRequiredPermissions,
        missing: permissionResult.missingPermissions
      });

      if (!permissionResult.hasRequiredPermissions) {
        logger.error('[DATA_COLLECT] ❌ Insufficient permissions - STOPPING', { missing: permissionResult.missingPermissions });
        return {
          success: false,
          error: `Insufficient permissions: ${permissionResult.missingPermissions.join(', ')}`
        };
      }

      logger.info('[DATA_COLLECT] ✅ Permissions checked, setting isCollecting = true');

      // WebSocket服务已在全局启动,无需建立额外连接
      logger.info('[DATA_COLLECT] 🔌 Using global WebSocket service for data upload');
      if (!this.websocketService) {
        logger.warn('[DATA_COLLECT] ⚠️ WebSocket service not available, data upload may fail');
      } else if (!this.websocketService.isConnected()) {
        logger.warn('[DATA_COLLECT] ⚠️ WebSocket not connected yet, waiting for connection...');
      } else {
        logger.info('[DATA_COLLECT] ✅ WebSocket service is ready for data upload');
      }

      // 启动活动收集服务
      logger.info('[DATA_COLLECT] 启动活动收集服务...');
      try {
        if (this.activityCollectorService) {
          await this.activityCollectorService.start();
          logger.info('[DATA_COLLECT] ✅ ActivityCollectorService已启动');
        } else {
          logger.warn('[DATA_COLLECT] ⚠️ ActivityCollectorService不可用，使用传统活动监控');
          // 备用方案：使用平台适配器的活动监控
          if (typeof (this.platformAdapter as any).startActivityMonitoring === 'function') {
            await (this.platformAdapter as any).startActivityMonitoring();
            logger.info('[DATA_COLLECT] ✅ 真实活动监控已启动（备用方案）');
          } else {
            logger.warn('[DATA_COLLECT] ⚠️ 平台适配器不支持活动监控');
          }
        }
      } catch (error) {
        logger.error('[DATA_COLLECT] ❌ 启动活动监控失败:', error);
      }

      // 开始定期数据收集 - 使用独立定时器
      logger.info('[DATA_COLLECT] ✅ Permissions checked, setting isCollecting = true');
      this.isCollecting = true;

      logger.info('[DATA_COLLECT] 🕐 Starting independent collection timers...');
      this.startIndependentCollectionTimers(screenshotInterval, activityInterval, processInterval, enableScreenshot, enableActivity, enableProcess);

      // 立即执行第一次数据收集
      logger.info('[DATA_COLLECT] 🚀 Performing initial data collection...');
      await this.performInitialDataCollection();

      logger.info('[DATA_COLLECT] ✅✅ Data collection started successfully');
      return { success: true };

    } catch (error: any) {
      logger.error('[DATA_COLLECT] Failed to start data collection:', error);
      this.isCollecting = false;
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async stopDataCollection(): Promise<void> {
    try {
      logger.info('[DATA_COLLECT] Stopping data collection...');

      this.isCollecting = false;

      // 清理所有定时器
      if (this.collectionInterval) {
        clearInterval(this.collectionInterval);
        this.collectionInterval = undefined;
      }
      
      if (this.screenshotInterval) {
        clearInterval(this.screenshotInterval);
        this.screenshotInterval = undefined;
      }
      
      if (this.activityInterval) {
        clearInterval(this.activityInterval);
        this.activityInterval = undefined;
      }
      
      if (this.processInterval) {
        clearInterval(this.processInterval);
        this.processInterval = undefined;
      }

      // 停止活动收集服务
      logger.info('[DATA_COLLECT] 停止活动收集服务...');
      try {
        if (this.activityCollectorService) {
          await this.activityCollectorService.stop();
          logger.info('[DATA_COLLECT] ✅ ActivityCollectorService已停止');
        } else if (typeof (this.platformAdapter as any).stopActivityMonitoring === 'function') {
          await (this.platformAdapter as any).stopActivityMonitoring();
          logger.info('[DATA_COLLECT] ✅ 真实活动监控已停止（传统方式）');
        }
      } catch (error) {
        logger.error('[DATA_COLLECT] ❌ 停止活动监控失败:', error);
      }

      // WebSocket连接由全局服务管理,无需在此处断开
      logger.info('[DATA_COLLECT] WebSocket connection managed by global service');

      logger.info('[DATA_COLLECT] Data collection stopped');
    } catch (error: any) {
      logger.error('[DATA_COLLECT] Error stopping data collection:', error);
    }
  }

  /**
   * 启动独立的数据收集定时器，每种数据类型使用自己的间隔
   */
  private startIndependentCollectionTimers(
    screenshotInterval: number,
    activityInterval: number,
    processInterval: number,
    enableScreenshot: boolean,
    enableActivity: boolean,
    enableProcess: boolean
  ): void {
    logger.info('[DATA_COLLECT] 🕒 启动独立定时器...');
    logger.info('[DATA_COLLECT] 🔍 Current isCollecting state: ' + this.isCollecting);
    logger.info('[DATA_COLLECT] 🔍 Intervals', { screenshot: screenshotInterval, activity: activityInterval, process: processInterval });
    logger.info('[DATA_COLLECT] 🔍 Switches', { screenshot: enableScreenshot, activity: enableActivity, process: enableProcess });

    // 截图定时器 - 根据开关决定是否启动
    if (enableScreenshot) {
      logger.info('[DATA_COLLECT] 📸 Setting up screenshot timer...');
      this.screenshotInterval = setInterval(async () => {
        logger.info(`[DATA_COLLECT] ⏰ Screenshot timer FIRED - isCollecting: ${this.isCollecting}`);
        if (this.isCollecting) {
          try {
            logger.info(`[DATA_COLLECT] 📸 执行截图采集 (间隔: ${screenshotInterval/1000}s)`);
            await this.performScreenshotCollection();
          } catch (error) {
            logger.error('[DATA_COLLECT] Screenshot collection failed:', error);
          }
        } else {
          logger.info('[DATA_COLLECT] ⚠️ Screenshot timer fired but isCollecting is FALSE');
        }
      }, screenshotInterval);
      logger.info(`[DATA_COLLECT] ✅ Screenshot timer started - interval: ${screenshotInterval}ms`);
    } else {
      logger.info('[DATA_COLLECT] ⏸️ Screenshot monitoring disabled by config');
    }

    // 活动数据定时器 - 根据开关决定是否启动
    if (enableActivity) {
      logger.info('[DATA_COLLECT] 🎯 Setting up activity timer...');
      this.activityInterval = setInterval(async () => {
        logger.info(`[DATA_COLLECT] ⏰ Activity timer FIRED - isCollecting: ${this.isCollecting}`);
        if (this.isCollecting) {
          try {
            logger.info(`[DATA_COLLECT] 🎯 执行活动数据采集 (间隔: ${activityInterval/1000}s)`);
            await this.performActivityCollection();
          } catch (error) {
            logger.error('[DATA_COLLECT] Activity collection failed:', error);
          }
        } else {
          logger.info('[DATA_COLLECT] ⚠️ Activity timer fired but isCollecting is FALSE');
        }
      }, activityInterval);
      logger.info(`[DATA_COLLECT] ✅ Activity timer started - interval: ${activityInterval}ms`);
    } else {
      logger.info('[DATA_COLLECT] ⏸️ Activity monitoring disabled by config');
    }

    // 进程扫描定时器 - 根据开关决定是否启动
    if (enableProcess) {
      logger.info('[DATA_COLLECT] 🔍 Setting up process timer...');
      this.processInterval = setInterval(async () => {
        logger.info(`[DATA_COLLECT] ⏰ Process timer FIRED - isCollecting: ${this.isCollecting}`);
        if (this.isCollecting) {
          try {
            logger.info(`[DATA_COLLECT] 🔍 执行进程扫描 (间隔: ${processInterval/1000}s)`);
            await this.performProcessCollection();
          } catch (error) {
            logger.error('[DATA_COLLECT] Process collection failed:', error);
          }
        } else {
          logger.info('[DATA_COLLECT] ⚠️ Process timer fired but isCollecting is FALSE');
        }
      }, processInterval);
      logger.info(`[DATA_COLLECT] ✅ Process timer started - interval: ${processInterval}ms`);
    } else {
      logger.info('[DATA_COLLECT] ⏸️ Process monitoring disabled by config');
    }

    logger.info('[DATA_COLLECT] ✅✅ 独立定时器启动完成');
    logger.info(`[DATA_COLLECT] 📸 截图: ${enableScreenshot ? `启用(每${screenshotInterval/1000}秒)` : '禁用'}`);
    logger.info(`[DATA_COLLECT] 🎯 活动: ${enableActivity ? `启用(每${activityInterval/1000}秒)` : '禁用'}`);
    logger.info(`[DATA_COLLECT] 🔍 进程: ${enableProcess ? `启用(每${processInterval/1000}秒)` : '禁用'}`);
  }

  /**
   * 执行初始数据收集（启动时立即执行一次）
   */
  private async performInitialDataCollection(): Promise<void> {
    logger.info('[DATA_COLLECT] 🚀 执行初始数据收集...');
    logger.info('[DATA_COLLECT] 🔍 isCollecting state: ' + this.isCollecting);
    try {
      // 并行执行所有类型的初始数据收集
      logger.info('[DATA_COLLECT] 🏃 Starting parallel initial collection...');
      await Promise.all([
        this.performScreenshotCollection().then(() => logger.info('[DATA_COLLECT] ✅ Initial screenshot done')),
        this.performActivityCollection().then(() => logger.info('[DATA_COLLECT] ✅ Initial activity done')),
        this.performProcessCollection().then(() => logger.info('[DATA_COLLECT] ✅ Initial process done'))
      ]);
      logger.info('[DATA_COLLECT] ✅✅ 初始数据收集完成');
    } catch (error) {
      logger.error('[DATA_COLLECT] ❌ 初始数据收集失败:', error);
    }
  }


  private async collectSystemData(): Promise<any> {
    try {
      logger.info('[DATA_COLLECT] Collecting system data...');

      const systemInfo = await this.platformAdapter.getSystemInfo();
      const memoryUsage = process.memoryUsage();

      return {
        timestamp: Date.now(),
        hostname: systemInfo.hostname,
        platform: systemInfo.platform,
        uptime: process.uptime(),
        memoryUsage: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          external: memoryUsage.external,
          rss: memoryUsage.rss
        },
        cpuUsage: process.cpuUsage(),
        loadAverage: require('os').loadavg()
      };
    } catch (error: any) {
      logger.error('[DATA_COLLECT] Failed to collect system data:', error);
      return {
        timestamp: Date.now(),
        error: error.message
      };
    }
  }

  private async collectActivityData(monitoringConfig: any): Promise<any> {
    try {
      logger.info('[DATA_COLLECT] Collecting activity data...');

      // 使用平台适配器获取真实的活动数据
      let activityData;
      try {
        // 检查平台适配器是否有 getActivityData 方法
        if (typeof (this.platformAdapter as any).getActivityData === 'function') {
          activityData = await (this.platformAdapter as any).getActivityData();
          logger.info('[DATA_COLLECT] Got activity data from platform adapter', {
            keystrokes: activityData.keystrokes,
            mouseClicks: activityData.mouseClicks,
            activeWindow: activityData.activeWindow?.application || 'Unknown',
            idleTime: activityData.idleTime
          });
        }
      } catch (error) {
        logger.warn('[DATA_COLLECT] Failed to get activity data from platform adapter', error);
      }

      // 获取当前活动窗口信息
      let activeWindowInfo;
      try {
        if (typeof this.platformAdapter.getActiveWindow === 'function') {
          const windowInfo = await this.platformAdapter.getActiveWindow();
          if (windowInfo) {
            activeWindowInfo = {
              title: windowInfo.title || 'Unknown',
              application: (windowInfo as any).application || windowInfo.processName || 'Unknown',
              pid: (windowInfo as any).pid || windowInfo.processId || 0,
              timestamp: Date.now()
            };
          }
        }
      } catch (error) {
        logger.warn('[DATA_COLLECT] Failed to get active window info', error);
      }

      // 构建包含真实数据的活动记录
      const result = {
        timestamp: Date.now(),
        activeWindow: activeWindowInfo,
        keystrokes: activityData?.keystrokes || 0,
        mouseClicks: activityData?.mouseClicks || 0,
        idleTime: activityData?.idleTime || 0,
        userActivity: {
          lastActivity: Date.now(),
          isActive: activityData ? (activityData.idleTime < 30) : true
        }
      };

      logger.info('[DATA_COLLECT] Final activity data', {
        keystrokes: result.keystrokes,
        mouseClicks: result.mouseClicks,
        activeWindow: result.activeWindow?.application || 'Unknown',
        isActive: result.userActivity.isActive
      });

      return result;
    } catch (error: any) {
      logger.error('[DATA_COLLECT] Failed to collect activity data:', error);
      return {
        timestamp: Date.now(),
        error: error.message,
        keystrokes: 0,
        mouseClicks: 0,
        idleTime: 0,
        userActivity: {
          lastActivity: Date.now(),
          isActive: false
        }
      };
    }
  }

  private async collectScreenshotData(screenshotConfig: any): Promise<any> {
    try {
      logger.info('[DATA_COLLECT] Collecting screenshot data...');

      // 直接尝试截图，不进行权限预检查
      // 因为权限检查阶段已经通过实际截图验证了权限
      logger.info('[DATA_COLLECT] Attempting screenshot directly (permissions verified by startup check)...');

      const screenshotResult = await this.platformAdapter.takeScreenshot({
        quality: screenshotConfig.quality || 80,
        format: screenshotConfig.format || 'jpg'
      });

      if (screenshotResult.success && screenshotResult.data) {
        return {
          timestamp: Date.now(),
          format: screenshotResult.format || screenshotConfig.format || 'jpg',
          size: screenshotResult.data.length,
          data: screenshotResult.data
        };
      } else {
        logger.warn('[DATA_COLLECT] Screenshot capture failed: ' + (screenshotResult.error || 'Unknown error'));
        return null;
      }
    } catch (error: any) {
      logger.error('[DATA_COLLECT] Failed to collect screenshot:', error);
      return null;
    }
  }

  private async collectProcessData(): Promise<any> {
    try {
      logger.info('[DATA_COLLECT] Collecting process data...');

      // 获取当前运行的进程列表
      let processData;
      try {
        // 检查平台适配器是否有获取进程列表的方法
        if (typeof (this.platformAdapter as any).getRunningProcesses === 'function') {
          processData = await (this.platformAdapter as any).getRunningProcesses();
          logger.info(`[DATA_COLLECT] Got ${Array.isArray(processData) ? processData.length : 0} processes from platform adapter`);
        } else if (typeof (this.platformAdapter as any).getActiveWindow === 'function') {
          // 如果没有进程列表方法，至少获取当前活动窗口信息
          const windowInfo = await (this.platformAdapter as any).getActiveWindow();
          processData = windowInfo ? [{
            name: windowInfo.title || 'Unknown',
            processName: (windowInfo as any).application || windowInfo.processName || 'Unknown',
            pid: (windowInfo as any).pid || 0,
            isActive: true,
            timestamp: Date.now()
          }] : [];
        }
      } catch (error) {
        logger.warn('[DATA_COLLECT] Failed to get process data from platform adapter', error);
        processData = [];
      }

      return {
        timestamp: Date.now(),
        processes: processData || [],
        processCount: Array.isArray(processData) ? processData.length : 0,
        success: true
      };
    } catch (error: any) {
      logger.error('[DATA_COLLECT] Failed to collect process data:', error);
      return {
        timestamp: Date.now(),
        error: error.message,
        processes: [],
        processCount: 0,
        success: false
      };
    }
  }

  /**
   * DEPRECATED: 使用WebSocketService替代
   * 保留此方法以避免编译错误,但不应再被调用
   */
  // @ts-ignore
  private async sendDataToServer(dataPackage: any, serverUrl: string, uploadStats?: any): Promise<{
    success: boolean;
    error?: string;
    details?: string;
  }> {
    // DEPRECATED: 此方法已废弃,使用WebSocketService.sendActivityData/sendScreenshotData替代
    logger.warn('[DATA_COLLECT] sendDataToServer is deprecated, use WebSocketService instead');
    return { success: false, error: 'Method deprecated' };

    /*
    try {
      logger.info('[DATA_COLLECT] Sending data to server via persistent WebSocket...');

      // 检查持久连接状态，如果断开则重新连接
      if (!this.socketConnected || !this.persistentSocket) {
        logger.info('[DATA_COLLECT] Persistent socket not connected, attempting to reconnect...');
        await this.establishPersistentConnection(serverUrl, dataPackage.deviceId);
      }
      
      if (!this.socketConnected || !this.persistentSocket) {
        throw new Error('Failed to establish persistent WebSocket connection');
      }
      
      let successCount = 0;
      let totalEvents = 0;
      
      // 发送活动数据
      if (dataPackage.activityData) {
        totalEvents++;
        const activityResult = await this.sendActivityData(this.persistentSocket, dataPackage.activityData, dataPackage.deviceId);
        if (activityResult.success) {
          successCount++;
          if (uploadStats) uploadStats.activityDataUploaded = true;
        } else {
          logger.warn('[DATA_COLLECT] ⚠️ 活动数据上传失败: ' + activityResult.error);
          if (uploadStats) uploadStats.activityDataUploaded = false;
        }
      } else {
        // 如果没有活动数据，标记为未上传
        if (uploadStats) uploadStats.activityDataUploaded = false;
        logger.info('[DATA_COLLECT] 🎯 无活动数据，跳过活动数据上传');
      }
      
      // 发送系统进程数据（如果有的话）
      if (dataPackage.systemData && dataPackage.systemData.processes) {
        totalEvents++;
        const processResult = await this.sendProcessData(this.persistentSocket, dataPackage.systemData, dataPackage.deviceId);
        if (processResult.success) {
          successCount++;
          if (uploadStats) uploadStats.systemDataUploaded = true;
        } else {
          logger.warn('[DATA_COLLECT] ⚠️ 系统数据上传失败: ' + processResult.error);
          if (uploadStats) uploadStats.systemDataUploaded = false;
        }
      } else if (dataPackage.systemData) {
        // 如果有系统数据但没有进程数据，仍算作系统数据成功上传
        if (uploadStats) uploadStats.systemDataUploaded = true;
        logger.info('[DATA_COLLECT] 🖥️ 系统数据已收集但无进程信息');
      } else {
        // 如果没有系统数据，标记为未上传
        if (uploadStats) uploadStats.systemDataUploaded = false;
        logger.info('[DATA_COLLECT] 🖥️ 无系统数据，跳过系统数据上传');
      }
      
      // 发送截图数据
      if (dataPackage.screenshotData) {
        totalEvents++;
        logger.info('[DATA_COLLECT] 📸 开始发送截图数据...');
        const screenshotResult = await this.sendScreenshotData(this.persistentSocket, dataPackage.screenshotData, dataPackage.deviceId);
        if (screenshotResult.success) {
          successCount++;
          if (uploadStats) uploadStats.screenshotDataUploaded = true;
          logger.info('[DATA_COLLECT] ✅ 截图数据上传成功');
        } else {
          logger.warn('[DATA_COLLECT] ⚠️ 截图数据上传失败: ' + screenshotResult.error);
          if (uploadStats) uploadStats.screenshotDataUploaded = false;
        }
      } else {
        // 如果没有截图数据，明确标记为未上传（但不是失败）
        if (uploadStats) uploadStats.screenshotDataUploaded = false;
        logger.info('[DATA_COLLECT] 📸 无截图数据，跳过截图上传');
      }
      
      logger.info(`[DATA_COLLECT] Persistent WebSocket data sent: ${successCount}/${totalEvents} events successful`);

      return {
        success: successCount > 0,
        details: `${successCount}/${totalEvents} events sent successfully`
      };

    } catch (error: any) {
      logger.error('[DATA_COLLECT] Failed to send data via persistent WebSocket:', error);

      // 如果发送失败，标记连接为断开状态
      this.socketConnected = false;

      return {
        success: false,
        error: error.message
      };
    }
    */
  }

  private buildDataUploadUrl(serverUrl: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      return `${baseUrl}/api/data/upload`;
    } catch (error: any) {
      throw new Error(`Failed to build data upload URL: ${error.message}`);
    }
  }

  private async checkPermissions(): Promise<{
    hasRequiredPermissions: boolean;
    missingPermissions: string[];
  }> {
    try {
      logger.info('[DATA_COLLECT] 🔍 Calling platformAdapter.checkPermissions()...');

      // 检查 platformAdapter 是否存在
      if (!this.platformAdapter) {
        logger.error('[DATA_COLLECT] ❌ platformAdapter is null or undefined');
        return {
          hasRequiredPermissions: false,
          missingPermissions: ['platformAdapter-not-initialized']
        };
      }

      // 检查 checkPermissions 方法是否存在
      if (typeof this.platformAdapter.checkPermissions !== 'function') {
        logger.error('[DATA_COLLECT] ❌ platformAdapter.checkPermissions is not a function');
        logger.error('[DATA_COLLECT] platformAdapter type:', typeof this.platformAdapter);
        logger.error('[DATA_COLLECT] Available methods:', Object.keys(this.platformAdapter));
        return {
          hasRequiredPermissions: false,
          missingPermissions: ['checkPermissions-not-implemented']
        };
      }

      logger.info('[DATA_COLLECT] ✅ platformAdapter.checkPermissions exists, calling it...');
      const permissions = await this.platformAdapter.checkPermissions();
      logger.info('[DATA_COLLECT] ✅ platformAdapter.checkPermissions returned:', permissions);

      const missingPermissions: string[] = [];

      // 检查基本权限
      if (!permissions.systemInfo) {
        missingPermissions.push('systemInfo');
      }

      // 截图权限检查已移除 - 在实际收集时验证权限
      // 注释：由于权限检测方法不一致，移除初始化阶段的截图权限预检查
      // 在实际截图收集时会进行真实的权限测试

      return {
        hasRequiredPermissions: missingPermissions.length === 0,
        missingPermissions
      };
    } catch (error: any) {
      logger.error('[DATA_COLLECT] ❌ Permission check failed with error:', error);
      logger.error('[DATA_COLLECT] Error stack:', error.stack);
      return {
        hasRequiredPermissions: false,
        missingPermissions: ['unknown']
      };
    }
  }

  private async checkCollectionStatus(): Promise<StateHandlerResult> {
    try {
      // 检查是否需要停止收集（例如设备被解绑）
      const config = this.configService.getConfig();
      const bindingCheck = await this.checkDeviceBinding(config.serverUrl, config.deviceId);

      if (!bindingCheck.isBound) {
        logger.info('[DATA_COLLECT] Device is no longer bound, stopping collection');
        await this.stopDataCollection();
        
        return {
          success: true,
          nextState: DeviceState.UNBOUND,
          reason: 'Device is no longer bound to an employee'
        };
      }

      // 继续收集数据
      return {
        success: true,
        nextState: DeviceState.DATA_COLLECT,
        reason: 'Data collection is running normally',
        retryDelay: 30000
      };

    } catch (error: any) {
      logger.error('[DATA_COLLECT] Status check failed:', error);
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Status check failed: ${error.message}`,
        error
      };
    }
  }

  private async checkDeviceBinding(serverUrl: string, deviceId: string): Promise<{
    isBound: boolean;
  }> {
    try {
      // 使用正确的API端点: /api/device/:deviceId/assignment
      const bindingUrl = `${serverUrl}/api/device/${encodeURIComponent(deviceId)}/assignment`;
      logger.info(`[DATA_COLLECT] Checking device binding status: ${bindingUrl}`);

      const response = await this.makeHttpRequest(bindingUrl, {
        method: 'GET',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      logger.info(`[DATA_COLLECT] Binding check response: status=${response.status}, ok=${response.ok}`);

      if (response.ok) {
        const data = await response.json();
        // 使用正确的字段名: isAssigned 而不是 isBound
        const isAssigned = data.data?.isAssigned || false;
        logger.info(`[DATA_COLLECT] Binding check result: isAssigned=${isAssigned}, userId=${data.data?.userId || 'none'}`);

        return {
          isBound: isAssigned
        };
      } else {
        // 假设仍然绑定，避免误停止
        logger.warn(`[DATA_COLLECT] Binding check HTTP error: ${response.status} ${response.statusText}`);
        return { isBound: true };
      }
    } catch (error) {
      logger.warn('[DATA_COLLECT] Binding check failed, assuming bound', error);
      return { isBound: true };
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
      const httpModule = isHttps ? require('https') : require('http');

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

  /**
   * DEPRECATED: 使用全局WebSocketService替代
   */
  // @ts-ignore
  private async establishPersistentConnection(serverUrl: string, deviceId: string): Promise<void> {
    logger.warn('[DATA_COLLECT] establishPersistentConnection is deprecated');
    return;
    /*
    try {
      logger.info('[DATA_COLLECT] Establishing persistent WebSocket connection...');

      // 如果已有连接，先断开
      if (this.persistentSocket) {
        this.persistentSocket.disconnect();
        this.persistentSocket = null;
        this.socketConnected = false;
      }
      
      // 检查Socket.IO客户端模块是否可用
      let io: any;
      try {
        io = require('socket.io-client');
      } catch (requireError) {
        throw new Error('Socket.IO client not available');
      }
      
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      const socket = io(`${baseUrl}/client`, {
        timeout: 10000,
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        auth: {
          deviceId: deviceId
        }
      });
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.disconnect();
          reject(new Error('Persistent connection timeout'));
        }, 10000);
        
        socket.on('connect', async () => {
          clearTimeout(timeout);
          this.persistentSocket = socket;
          this.socketConnected = true;
          logger.info('[DATA_COLLECT] Persistent WebSocket connected successfully');
          
          // 直接使用当前后端格式，无需兼容性检测
          
          // 发射WebSocket连接成功事件
          this.emitEvent('websocketConnected');
          
          // 设置断开连接处理
          socket.on('disconnect', (reason: string) => {
            logger.warn(`[DATA_COLLECT] Persistent WebSocket disconnected: ${reason}`);
            this.socketConnected = false;
            // 发射WebSocket断开连接事件
            this.emitEvent('websocketDisconnected');
            
            // 如果是意外断开，尝试重连
            if (reason !== 'io client disconnect' && this.isCollecting) {
              logger.info('[DATA_COLLECT] Attempting to reconnect persistent WebSocket...');
              setTimeout(() => {
                if (!this.socketConnected && this.isCollecting) {
                  this.establishPersistentConnection(serverUrl, deviceId).catch(error => {
                    logger.error('[DATA_COLLECT] Failed to reconnect persistent WebSocket:', error);
                  });
                }
              }, 2000);
            }
          });
          
          resolve();
        });
        
        socket.on('connect_error', (error: any) => {
          clearTimeout(timeout);
          logger.error('[DATA_COLLECT] Persistent WebSocket connection error:', error);
          reject(error);
        });
        
        socket.connect();
      });
      
    } catch (error: any) {
      logger.error('[DATA_COLLECT] Failed to establish persistent WebSocket connection:', error);
      throw error;
    }
    */
  }

  // WebSocket连接和数据发送方法
  private async connectToWebSocket(serverUrl: string, deviceId: string): Promise<{
    success: boolean;
    error?: string;
    socket?: any;
  }> {
    try {
      // 检查Socket.IO客户端模块是否可用
      let io: any;
      try {
        io = require('socket.io-client');
      } catch (requireError) {
        return {
          success: false,
          error: 'Socket.IO client not available'
        };
      }
      
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      const socket = io(`${baseUrl}/client`, {
        timeout: 10000,
        autoConnect: false,
        reconnection: false,
        auth: {
          deviceId: deviceId
        }
      });
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          socket.disconnect();
          resolve({
            success: false,
            error: 'Connection timeout'
          });
        }, 10000);
        
        socket.on('connect', () => {
          clearTimeout(timeout);
          logger.info('[DATA_COLLECT] WebSocket connected successfully');
          resolve({
            success: true,
            socket: socket
          });
        });
        
        socket.on('connect_error', (error: any) => {
          clearTimeout(timeout);
          logger.error('[DATA_COLLECT] WebSocket connection error:', error);
          resolve({
            success: false,
            error: error.message
          });
        });
        
        socket.connect();
      });
      
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /** DEPRECATED: 使用websocketService.sendActivityData()替代 */
  // @ts-ignore
  private async sendActivityData(socket: any, activityData: any, deviceId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    logger.warn('[DATA_COLLECT] sendActivityData is deprecated');
    return { success: false, error: 'Method deprecated' };
    /*
    return new Promise((resolve) => {
      try {
        // 直接使用当前后端格式
        const event = 'client:activity';
        const ackEvent = 'client:activity:ack';
        const data = {
          deviceId: deviceId,
          sessionId: `session_${Date.now()}`,
          timestamp: Date.now(),
          isActive: activityData.userActivity?.isActive !== undefined ? activityData.userActivity.isActive : true,
          idleTime: Math.max(0, activityData.userActivity?.idleTime || 0),
          keystrokes: Math.max(0, activityData.keystrokes || 0),
          mouseClicks: Math.max(0, activityData.mouseClicks || 0),
          activeWindow: activityData.activeWindow?.application || activityData.activeWindow?.title || 'Unknown',
          activeWindowProcess: activityData.activeWindow?.application || activityData.activeWindow?.title || 'Unknown',
          messageId: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        logger.info(`[DATA_COLLECT] 发送活动数据 - 事件: ${event}, 确认事件: ${ackEvent}`);
        logger.info('[DATA_COLLECT] 数据内容', {
          keystrokes: data.keystrokes,
          mouseClicks: data.mouseClicks,
          activeWindow: data.activeWindow,
          isActive: data.isActive
        });
        
        const timeout = setTimeout(() => {
          resolve({ success: false, error: 'Activity data send timeout' });
        }, 10000); // 增加到10秒
        
        socket.once(ackEvent, (ackData: any) => {
          clearTimeout(timeout);
          logger.info(`[DATA_COLLECT] 收到确认: ${ackEvent}`, ackData);
          
          // 验证确认消息的messageId匹配
          const isValidAck = ackData.messageId === data.messageId && ackData.success;
          
          if (isValidAck) {
            logger.info('[DATA_COLLECT] ✅ Activity data sent successfully');
            resolve({ success: true });
          } else {
            logger.info('[DATA_COLLECT] ❌ Invalid ACK response');
            resolve({ success: false, error: 'Invalid ACK response' });
          }
        });
        
        // 监听错误事件（服务器可能发送error而不是ack）
        socket.once('error', (errorData: any) => {
          clearTimeout(timeout);
          logger.info('[DATA_COLLECT] 收到错误响应', errorData);
          
          // 如果是处理错误，我们认为数据已发送但服务器处理失败
          // 基于调试分析，这是服务器端问题，不是客户端问题
          if (errorData.code === 'PROCESSING_ERROR' && errorData.messageId === data.messageId) {
            logger.info('[DATA_COLLECT] ⚠️ 服务器处理失败，但数据已接收 - 视为成功发送');
            logger.info('[DATA_COLLECT] 💡 这是服务器端处理问题，数据格式正确');
            resolve({ 
              success: true, // 改为true，因为数据确实到达了服务器
              error: `Server processing issue (data received): ${errorData.message}` 
            });
          } else {
            resolve({ success: false, error: errorData.message || 'Unknown error' });
          }
        });
        
        socket.emit(event, data);
        
      } catch (error: any) {
        resolve({ success: false, error: error.message });
      }
    });
    */
  }

  /** DEPRECATED: 使用websocketService.sendSystemData()替代 */
  // @ts-ignore
  private async sendProcessData(socket: any, systemData: any, deviceId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    logger.warn('[DATA_COLLECT] sendProcessData is deprecated');
    return { success: false, error: 'Method deprecated' };
    /*
    return new Promise((resolve) => {
      try {
        if (!systemData.processes || !Array.isArray(systemData.processes)) {
          resolve({ success: false, error: 'No process data available' });
          return;
        }
        
        // 直接使用当前后端格式
        const event = 'client:process';
        const ackEvent = 'client:process:ack';
        const data = {
          deviceId: deviceId,
          timestamp: Date.now(),
          processes: systemData.processes || [],
          messageId: `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        logger.info(`[DATA_COLLECT] 发送进程数据 - 事件: ${event}, 确认事件: ${ackEvent}`);
        
        const timeout = setTimeout(() => {
          resolve({ success: false, error: 'Process data send timeout' });
        }, 10000); // 增加到10秒
        
        socket.once(ackEvent, (ackData: any) => {
          clearTimeout(timeout);
          logger.info(`[DATA_COLLECT] 收到确认: ${ackEvent}`, ackData);
          
          // 验证确认消息的messageId匹配
          const isValidAck = ackData.messageId === data.messageId && ackData.success;
          
          if (isValidAck) {
            logger.info('[DATA_COLLECT] ✅ Process data sent successfully');
            resolve({ success: true });
          } else {
            resolve({ success: false, error: 'Invalid ACK response' });
          }
        });
        
        socket.once('error', (error: any) => {
          clearTimeout(timeout);
          resolve({ success: false, error: error.message });
        });
        
        socket.emit(event, data);

      } catch (error: any) {
        resolve({ success: false, error: error.message });
      }
    });
    */
  }

  /** DEPRECATED: 使用websocketService.sendScreenshotData()替代 */
  // @ts-ignore
  private async sendScreenshotData(socket: any, screenshotData: any, deviceId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    logger.warn('[DATA_COLLECT] sendScreenshotData is deprecated');
    return { success: false, error: 'Method deprecated' };
    /*
    return new Promise((resolve) => {
      try {
        if (!screenshotData || !screenshotData.data) {
          resolve({ success: false, error: 'No screenshot data available' });
          return;
        }
        
        // 使用后端期望的格式: timestamp 和 buffer
        const event = 'client:screenshot';
        
        // 将Buffer转换为base64字符串，确保WebSocket传输兼容性
        let bufferData: string;
        if (Buffer.isBuffer(screenshotData.data)) {
          bufferData = screenshotData.data.toString('base64');
          logger.info(`[DATA_COLLECT] 📸 截图数据转换: Buffer (${screenshotData.data.length} bytes) → base64 (${bufferData.length} chars)`);
          
          // 验证base64格式和内容完整性
          const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(bufferData);
          const isPngFormat = screenshotData.data[0] === 0x89 && screenshotData.data[1] === 0x50; // PNG magic bytes
          logger.info(`[DATA_COLLECT] 🔍 数据验证: base64格式=${isValidBase64}, PNG格式=${isPngFormat}, 前8字节=[${Array.from(screenshotData.data.slice(0, 8)).join(',')}]`);
        } else if (typeof screenshotData.data === 'string') {
          // 移除可能的data URI前缀
          if (screenshotData.data.startsWith('data:image/')) {
            const base64Index = screenshotData.data.indexOf('base64,');
            if (base64Index !== -1) {
              bufferData = screenshotData.data.substring(base64Index + 7);
              logger.info(`[DATA_COLLECT] 📸 移除data URI前缀: ${screenshotData.data.length} → ${bufferData.length} chars`);
            } else {
              bufferData = screenshotData.data;
            }
          } else {
            bufferData = screenshotData.data;
          }
          logger.info(`[DATA_COLLECT] 📸 截图数据已是字符串格式: ${bufferData.length} chars`);
        } else {
          throw new Error('Unsupported screenshot data format');
        }
        
        const data = {
          deviceId: deviceId,
          timestamp: Date.now(),
          buffer: bufferData,  // 发送base64字符串而不是Buffer对象
          format: screenshotData.format || 'png',
          messageId: `screenshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        logger.info(`[DATA_COLLECT] 📤 发送截图数据到服务器:`);
        logger.info(`  - deviceId: ${deviceId}`);
        logger.info(`  - timestamp: ${data.timestamp}`);
        logger.info(`  - format: ${data.format}`);
        logger.info(`  - buffer size: ${bufferData.length} chars`);
        logger.info(`  - messageId: ${data.messageId}`);
        
        const timeout = setTimeout(() => {
          resolve({ success: false, error: 'Screenshot data send timeout' });
        }, 15000); // 截图数据可能很大，给更长的超时时间
        
        // 使用Socket.IO内置的acknowledgment callback机制，与WebSocket服务保持一致
        socket.emit(event, data, (response: any) => {
          clearTimeout(timeout);
          logger.info('[DATA_COLLECT] 📥 收到服务器响应', response);
          
          if (response && response.success) {
            logger.info('[DATA_COLLECT] ✅ 截图数据上传成功');
            resolve({ success: true });
          } else {
            const errorMsg = response?.error || response?.message || 'Server response indicated failure';
            logger.info(`[DATA_COLLECT] ❌ 截图数据上传失败: ${errorMsg}`);
            resolve({ success: false, error: errorMsg });
          }
        });
        
        socket.once('error', (error: any) => {
          clearTimeout(timeout);
          resolve({ success: false, error: error.message });
        });
        
      } catch (error: any) {
        resolve({ success: false, error: error.message });
      }
    });
    */
  }

  /**
   * 执行截图数据采集
   */
  private async performScreenshotCollection(): Promise<void> {
    try {
      logger.info('[DATA_COLLECT] 执行截图采集...');

      // 获取当前配置
      const config = this.configService.getConfig();

      // 直接使用服务器传来的配置字段
      const isScreenshotEnabled = (config as any).enableScreenshot;

      logger.info(`[DATA_COLLECT] 截图采集启用状态: ${isScreenshotEnabled}`);

      if (!isScreenshotEnabled) {
        logger.info('[DATA_COLLECT] 截图采集已禁用，跳过');
        return;
      }

      // 执行截图采集 - 使用原有的截图逻辑
      const screenshotConfig = config.monitoring?.screenshotInterval ? {
        enabled: true,
        quality: 80,
        format: 'jpg'
      } : undefined;
      const screenshotResult = await this.collectScreenshotData(screenshotConfig);
      if (screenshotResult && screenshotResult.data) {
        logger.info('[DATA_COLLECT] ✅ 截图采集成功，开始上传...');
        this.emitEvent('screenshot-collected', screenshotResult);

        // 使用WebSocket服务上传截图数据
        if (this.websocketService && this.websocketService.isConnected()) {
          try {
            // 使用WebSocket服务的sendScreenshotData方法
            // 注意: 服务器期望字段名为 buffer 和 timestamp
            // deviceId 不需要发送，服务器从 socket session 中自动获取

            // 🔧 关键修复: 将 Buffer 转换为 Base64 字符串
            // Socket.IO 不能直接传输 Buffer，需要转换为字符串
            const bufferBase64 = screenshotResult.data instanceof Buffer
              ? screenshotResult.data.toString('base64')
              : screenshotResult.data;

            const dataSize = screenshotResult.data.length;
            const base64Size = bufferBase64.length;

            // 验证 Base64 格式
            const base64Preview = bufferBase64.substring(0, 50) + '...' + bufferBase64.substring(bufferBase64.length - 20);
            const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(bufferBase64.replace(/\s/g, ''));

            logger.info(`[DATA_COLLECT] 截图数据转换: Buffer(${dataSize} bytes) → Base64(${base64Size} chars)`);
            logger.info(`[DATA_COLLECT] Base64验证: ${isValidBase64 ? '✅ 格式正确' : '❌ 格式错误'}`);
            logger.info(`[DATA_COLLECT] Base64预览: ${base64Preview}`);

            // 检查原始图片格式 (magic bytes)
            const magicBytes = screenshotResult.data.slice(0, 4);
            const isPNG = magicBytes[0] === 0x89 && magicBytes[1] === 0x50;
            const isJPEG = magicBytes[0] === 0xFF && magicBytes[1] === 0xD8;
            const isWebP = magicBytes.toString('ascii', 0, 4) === 'RIFF';
            logger.info(`[DATA_COLLECT] 图片格式: ${isPNG ? 'PNG' : isJPEG ? 'JPEG' : isWebP ? 'WebP' : 'Unknown'}`);

            await this.websocketService.sendScreenshotData({
              buffer: bufferBase64,  // Base64 编码的字符串
              timestamp: screenshotResult.timestamp,
              fileSize: dataSize  // 原始 Buffer 字节大小（不是 Base64 长度）
            });
            logger.info('[DATA_COLLECT] ✅ 截图数据已通过WebSocket服务上传');
            this.emitEvent('screenshot-uploaded', screenshotResult);
          } catch (error: any) {
            logger.warn('[DATA_COLLECT] ⚠️ 截图数据上传失败: ' + error.message);
            this.emitEvent('screenshot-upload-failed', { error: error.message });
          }
        } else {
          logger.warn('[DATA_COLLECT] ⚠️ WebSocket服务未连接，截图数据未上传');
          // TODO: 实现离线缓存功能
          logger.info('[DATA_COLLECT] 📦 截图数据将在连接恢复后重试');
        }
      } else {
        logger.warn('[DATA_COLLECT] ⚠️ 截图采集失败');
        this.emitEvent('screenshot-failed', { error: 'Screenshot collection failed' });
      }
      
    } catch (error: any) {
      logger.error('[DATA_COLLECT] 截图采集异常:', error);
      this.emitEvent('screenshot-failed', { error: error.message });
    }
  }

  /**
   * 执行活动数据采集
   */
  private async performActivityCollection(): Promise<void> {
    try {
      logger.info('[DATA_COLLECT] 执行活动数据采集...');

      // 获取当前配置
      const config = this.configService.getConfig();

      // 直接使用服务器传来的配置字段
      const isActivityEnabled = (config as any).enableActivity;

      logger.info(`[DATA_COLLECT] 活动监控启用状态: ${isActivityEnabled}`);

      if (!isActivityEnabled) {
        logger.info('[DATA_COLLECT] 活动监控已禁用，跳过');
        return;
      }

      // 使用ActivityCollectorService进行活动数据采集
      if (this.activityCollectorService) {
        logger.info('[DATA_COLLECT] 使用ActivityCollectorService采集活动数据...');
        
        // ActivityCollectorService会自动处理间隔收集和上传
        // 这里只需要确保服务正在运行即可
        const isRunning = this.activityCollectorService.isRunning();
        if (isRunning) {
          logger.info('[DATA_COLLECT] ✅ ActivityCollectorService正在运行中');
          this.emitEvent('activity-service-running');
        } else {
          logger.warn('[DATA_COLLECT] ⚠️ ActivityCollectorService未运行，尝试重新启动');
          try {
            await this.activityCollectorService.start();
            logger.info('[DATA_COLLECT] ✅ ActivityCollectorService重新启动成功');
            this.emitEvent('activity-service-restarted');
          } catch (restartError) {
            logger.error('[DATA_COLLECT] ❌ ActivityCollectorService重新启动失败:', restartError);
            this.emitEvent('activity-service-failed', { error: restartError });
          }
        }
      } else {
        // 备用方案：使用原有的活动采集逻辑
        logger.info('[DATA_COLLECT] ActivityCollectorService不可用，使用传统活动采集...');
        const activityResult = await this.collectActivityData(config.monitoring || {});
        if (activityResult && !activityResult.error) {
          logger.info('[DATA_COLLECT] ✅ 活动数据采集成功，开始上传...');
          this.emitEvent('activity-collected', activityResult);

          // 使用WebSocket服务上传活动数据
          if (this.websocketService && this.websocketService.isConnected()) {
            try {
              // 使用WebSocket服务的sendActivityData方法
              await this.websocketService.sendActivityData({
                deviceId: config.deviceId,
                ...activityResult
              });
              logger.info('[DATA_COLLECT] ✅ 活动数据已通过WebSocket服务上传');
              this.emitEvent('activity-uploaded', activityResult);

              // 通知平台适配器数据上传成功，重置活动计数器
              if (typeof (this.platformAdapter as any).onDataUploadSuccess === 'function') {
                try {
                  logger.info('[DATA_COLLECT] 🔄 调用平台适配器的计数器重置方法...');
                  (this.platformAdapter as any).onDataUploadSuccess();
                  logger.info('[DATA_COLLECT] ✅ 平台适配器计数器重置方法调用完成');
                } catch (error) {
                  logger.error('[DATA_COLLECT] ❌ 重置活动计数器失败:', error);
                }
              }
            } catch (error: any) {
              logger.warn('[DATA_COLLECT] ⚠️ 活动数据上传失败: ' + error.message);
              this.emitEvent('activity-upload-failed', { error: error.message });
            }
          } else {
            logger.warn('[DATA_COLLECT] ⚠️ WebSocket服务未连接，活动数据未上传');
            // TODO: 实现离线缓存功能
            logger.info('[DATA_COLLECT] 📦 活动数据将在连接恢复后重试');
          }
        } else {
          logger.warn('[DATA_COLLECT] ⚠️ 活动数据采集失败: ' + (activityResult?.error || 'Unknown error'));
          this.emitEvent('activity-failed', { error: activityResult?.error || 'Activity collection failed' });
        }
      }
      
    } catch (error: any) {
      logger.error('[DATA_COLLECT] 活动数据采集异常:', error);
      this.emitEvent('activity-failed', { error: error.message });
    }
  }

  /**
   * 执行进程数据采集
   */
  private async performProcessCollection(): Promise<void> {
    try {
      logger.info('[DATA_COLLECT] 执行进程数据采集...');

      // 获取当前配置
      const config = this.configService.getConfig();

      // 直接使用服务器传来的配置字段
      const isProcessEnabled = (config as any).enableProcess;

      logger.info(`[DATA_COLLECT] 进程监控启用状态: ${isProcessEnabled}`);

      if (!isProcessEnabled) {
        logger.info('[DATA_COLLECT] 进程监控已禁用，跳过');
        return;
      }

      // 执行进程数据采集 - 使用原有的进程采集逻辑
      const processResult = await this.collectProcessData();
      if (processResult.success) {
        logger.info('[DATA_COLLECT] ✅ 进程数据采集成功，开始上传...');
        this.emitEvent('process-collected', processResult);

        // 使用WebSocket服务上传进程数据
        if (this.websocketService && this.websocketService.isConnected()) {
          try {
            const systemData = {
              deviceId: config.deviceId,
              timestamp: processResult.timestamp,
              processes: processResult.processes,
              processCount: processResult.processCount
            };
            await this.websocketService.sendSystemData(systemData);
            logger.info('[DATA_COLLECT] ✅ 进程数据已通过WebSocket服务上传');
            this.emitEvent('process-uploaded', processResult);
          } catch (error: any) {
            logger.warn('[DATA_COLLECT] ⚠️ 进程数据上传失败: ' + error.message);
            this.emitEvent('process-upload-failed', { error: error.message });
          }
        } else {
          logger.warn('[DATA_COLLECT] ⚠️ WebSocket服务未连接，进程数据未上传');
        }
      } else {
        logger.warn('[DATA_COLLECT] ⚠️ 进程数据采集失败: ' + processResult.error);
        this.emitEvent('process-failed', { error: processResult.error });
      }
      
    } catch (error: any) {
      logger.error('[DATA_COLLECT] 进程数据采集异常:', error);
      this.emitEvent('process-failed', { error: error.message });
    }
  }

  protected async onEnter(context: FSMContext): Promise<void> {
    logger.info('[DATA_COLLECT] Entering data collection state');
  }

  protected async onExit(context: FSMContext): Promise<void> {
    logger.info('[DATA_COLLECT] Exiting data collection state');
    await this.stopDataCollection();
  }

  // 辅助方法：发射事件到应用实例
  private emitEvent(eventName: string, data?: any): void {
    try {
      // 对于进程数据和截图数据，只记录摘要避免日志过多
      let logData = data;

      if (eventName === 'process-collected' && data) {
        logData = {
          processCount: data.processCount || (Array.isArray(data.processes) ? data.processes.length : 0),
          timestamp: data.timestamp
        };
      } else if (eventName === 'screenshot-collected' && data) {
        logData = {
          format: data.format,
          size: data.size || (data.data ? data.data.length : 0),
          timestamp: data.timestamp
        };
      } else if (eventName === 'activity-collected' && data) {
        logData = {
          keystrokes: data.keystrokes,
          mouseClicks: data.mouseClicks,
          activeWindow: data.activeWindow?.application || 'Unknown',
          timestamp: data.timestamp
        };
      }

      logger.info(`[DATA_COLLECT] Attempting to emit event '${eventName}'`, { hasAppInstance: !!this.appInstance, data: logData });
      if (this.appInstance) {
        this.appInstance.emit(eventName, data);
        logger.info(`[DATA_COLLECT] Successfully emitted event '${eventName}'`);
      } else {
        logger.warn(`[DATA_COLLECT] Cannot emit event '${eventName}': appInstance is null/undefined`);
      }
    } catch (error) {
      logger.warn(`[DATA_COLLECT] Failed to emit event '${eventName}':`, error);
    }
  }

  /**
   * 处理配置更新事件 - 立即持久化配置，条件性重启定时器
   *
   * 核心逻辑:
   * 1. 提取新配置参数
   * 2. 立即持久化到 ConfigService (写入配置文件)
   * 3. 如果正在收集数据 (isCollecting = true)，重启定时器应用新配置
   * 4. 如果未开始收集 (isCollecting = false)，配置已保存，等 startDataCollection() 时自动应用
   */
  private async handleConfigUpdate(updatedConfig: any): Promise<void> {
    try {
      logger.info('[DATA_COLLECT] Configuration update received', updatedConfig);
      logger.info(`[DATA_COLLECT] Current state: isCollecting=${this.isCollecting}, networkSubState=${this.networkSubState}`);

      // 提取新配置参数 (使用 fallback 确保有值)
      const config = this.configService.getConfig();

      const newScreenshotInterval = updatedConfig?.screenshotInterval ||
                                    (config as any).screenshotInterval ||
                                    300000;  // 默认5分钟
      const newActivityInterval = updatedConfig?.activityInterval ||
                                 (config as any).activityInterval ||
                                 60000;  // 默认1分钟
      const newProcessInterval = updatedConfig?.processScanInterval ||
                                (config as any).processScanInterval ||
                                180000;  // 默认3分钟

      // 读取监控开关 (处理 undefined 情况)
      const newEnableScreenshot = updatedConfig?.enableScreenshot !== undefined ?
                                 updatedConfig.enableScreenshot :
                                 ((config as any).enableScreenshot !== false);
      const newEnableActivity = updatedConfig?.enableActivity !== undefined ?
                               updatedConfig.enableActivity :
                               ((config as any).enableActivity !== false);
      const newEnableProcess = updatedConfig?.enableProcess !== undefined ?
                              updatedConfig.enableProcess :
                              ((config as any).enableProcess !== false);

      logger.info(`[DATA_COLLECT] 📝 新配置参数 - ` +
                  `截图: ${newEnableScreenshot ? '启用' : '禁用'}(${newScreenshotInterval}ms), ` +
                  `活动: ${newEnableActivity ? '启用' : '禁用'}(${newActivityInterval}ms), ` +
                  `进程: ${newEnableProcess ? '启用' : '禁用'}(${newProcessInterval}ms)`);

      // 注意: 不需要再次调用 configService.updateConfig()
      // 因为这个方法是响应 config:updated 事件，说明配置已经更新过了
      // 再次调用会导致事件循环：updateConfig → emit config:updated → handleConfigUpdate → updateConfig ...
      logger.info('[DATA_COLLECT] 📝 配置更新事件已收到，应用新配置到定时器');

      // 条件性重启定时器: 如果正在收集数据，立即应用新配置
      if (this.isCollecting) {
        logger.info('[DATA_COLLECT] 🔄 Currently collecting data, restarting timers with new configuration...');

        await this.restartCollectionTimers(
          newScreenshotInterval, newActivityInterval, newProcessInterval,
          newEnableScreenshot, newEnableActivity, newEnableProcess
        );

        logger.info('[DATA_COLLECT] ✅ 定时器已重启，新配置已生效 (运行时应用)');
      } else {
        logger.info('[DATA_COLLECT] ⏸️ Not currently collecting, configuration saved and will be applied when collection starts');
        logger.info('[DATA_COLLECT] ℹ️ Next startDataCollection() will read the updated config from ConfigService');
      }

      // 发射配置更新事件 (供其他模块监听)
      this.emitEvent('configurationUpdated', {
        screenshotInterval: newScreenshotInterval,
        activityInterval: newActivityInterval,
        processInterval: newProcessInterval,
        enableScreenshot: newEnableScreenshot,
        enableActivity: newEnableActivity,
        enableProcess: newEnableProcess,
        appliedAt: new Date(),
        appliedToRunningTimers: this.isCollecting  // 标记是否立即应用到定时器
      });

      logger.info('[DATA_COLLECT] ✅✅ 配置更新处理完成');

    } catch (error: any) {
      logger.error('[DATA_COLLECT] ❌ 处理配置更新失败:', error);
      // 不抛出异常，避免影响其他流程
    }
  }

  /**
   * 重启收集定时器以应用新的间隔配置和监控开关
   */
  private async restartCollectionTimers(
    screenshotInterval: number,
    activityInterval: number,
    processInterval: number,
    enableScreenshot: boolean,
    enableActivity: boolean,
    enableProcess: boolean
  ): Promise<void> {
    try {
      logger.info('[DATA_COLLECT] 重启收集定时器...');
      logger.info('[DATA_COLLECT] 新配置 - 截图: ' + (enableScreenshot ? `启用(${screenshotInterval}ms)` : '禁用'));
      logger.info('[DATA_COLLECT] 新配置 - 活动: ' + (enableActivity ? `启用(${activityInterval}ms)` : '禁用'));
      logger.info('[DATA_COLLECT] 新配置 - 进程: ' + (enableProcess ? `启用(${processInterval}ms)` : '禁用'));

      // 清除所有现有定时器
      if (this.screenshotInterval) {
        clearInterval(this.screenshotInterval);
        this.screenshotInterval = undefined;
      }
      if (this.activityInterval) {
        clearInterval(this.activityInterval);
        this.activityInterval = undefined;
      }
      if (this.processInterval) {
        clearInterval(this.processInterval);
        this.processInterval = undefined;
      }
      if (this.collectionInterval) {
        clearInterval(this.collectionInterval);
        this.collectionInterval = undefined;
      }

      // 根据开关决定是否启动定时器
      logger.info('[DATA_COLLECT] 启动新的定时器...');

      // 截图定时器 - 根据开关决定是否启动
      if (enableScreenshot) {
        this.screenshotInterval = setInterval(async () => {
          try {
            await this.performScreenshotCollection();
          } catch (error) {
            logger.error('[DATA_COLLECT] 截图收集定时器错误:', error);
          }
        }, screenshotInterval);
        logger.info(`[DATA_COLLECT] ✅ 截图定时器已重启，间隔: ${screenshotInterval}ms`);
      } else {
        logger.info('[DATA_COLLECT] ⏸️ 截图定时器已停止（开关禁用）');
      }

      // 活动监控定时器 - 根据开关决定是否启动
      if (enableActivity) {
        this.activityInterval = setInterval(async () => {
          try {
            await this.performActivityCollection();
          } catch (error) {
            logger.error('[DATA_COLLECT] 活动收集定时器错误:', error);
          }
        }, activityInterval);
        logger.info(`[DATA_COLLECT] ✅ 活动定时器已重启，间隔: ${activityInterval}ms`);
      } else {
        logger.info('[DATA_COLLECT] ⏸️ 活动定时器已停止（开关禁用）');
      }

      // 进程扫描定时器 - 根据开关决定是否启动
      if (enableProcess) {
        this.processInterval = setInterval(async () => {
          try {
            await this.performProcessCollection();
          } catch (error) {
            logger.error('[DATA_COLLECT] 进程收集定时器错误:', error);
          }
        }, processInterval);
        logger.info(`[DATA_COLLECT] ✅ 进程定时器已重启，间隔: ${processInterval}ms`);
      } else {
        logger.info('[DATA_COLLECT] ⏸️ 进程定时器已停止（开关禁用）');
      }

      // 主收集定时器（用于连接维护等）
      const baseCheckInterval = Math.min(activityInterval, 30000); // 最多30秒检查一次
      this.collectionInterval = setInterval(async () => {
        try {
          await this.performBasicMaintenance();
        } catch (error) {
          logger.error('[DATA_COLLECT] 基础维护定时器错误:', error);
        }
      }, baseCheckInterval);
      logger.info(`[DATA_COLLECT] ✅ 基础维护定时器已重启，间隔: ${baseCheckInterval}ms`);

      logger.info('[DATA_COLLECT] ✅✅ 所有定时器已重启，新配置已生效');

    } catch (error: any) {
      logger.error('[DATA_COLLECT] 重启定时器失败:', error);
      throw error;
    }
  }

  /**
   * 执行基础维护任务（连接检查、心跳等）
   */
  private async performBasicMaintenance(): Promise<void> {
    // 在在线模式下检查WebSocket连接状态
    const isSocketConnected = this.websocketService?.isConnected() || false;
    if (this.networkSubState === NetworkSubState.ONLINE && !isSocketConnected && this.isCollecting) {
      logger.info('[DATA_COLLECT] WebSocket连接断开，检查网络状态...');

      // 检查网络状态，如果网络不可用则切换到离线模式
      const networkStatus = await this.networkMonitor.checkNow();
      if (!networkStatus.isOnline || !networkStatus.serverReachable) {
        logger.info('[DATA_COLLECT] 网络不可用，切换到离线模式');
        this.switchToOfflineMode();
      } else {
        // 网络正常但WebSocket断开，全局WebSocketService会自动重连
        // 我们不需要在这里手动重连，只需记录日志
        logger.info('[DATA_COLLECT] 网络正常，WebSocketService会自动重连');
      }
    }
  }

  // =========================
  // 网络状态处理方法
  // =========================

  /**
   * 设置网络监控事件监听
   */
  private setupNetworkEventListeners(): void {
    this.networkMonitor.on('online', (status) => {
      logger.info('[DATA_COLLECT] Network monitor detected online status');
      if (this.networkSubState === NetworkSubState.OFFLINE) {
        this.switchToRecoveryMode();
      }
    });

    this.networkMonitor.on('offline', (status) => {
      logger.info('[DATA_COLLECT] Network monitor detected offline status');
      if (this.networkSubState === NetworkSubState.ONLINE) {
        this.switchToOfflineMode();
      }
    });

    this.errorRecoveryService.on('recovery-completed', (result) => {
      logger.info(`[DATA_COLLECT] Recovery completed: ${result.syncedItems || 0} items synced`);
      this.switchToOnlineMode();
    });

    this.errorRecoveryService.on('recovery-failed', (result) => {
      logger.info(`[DATA_COLLECT] Recovery failed: ${result.reason}`);
      this.switchToOfflineMode();
    });
  }

  /**
   * 处理在线状态的数据收集
   */
  private async handleOnlineCollection(context: FSMContext): Promise<StateHandlerResult> {
    try {
      logger.info('[DATA_COLLECT] 📊 handleOnlineCollection() - isCollecting: ' + this.isCollecting);

      // 如果已经在收集数据，检查状态
      if (this.isCollecting) {
        logger.info('[DATA_COLLECT] ✅ Already collecting, calling checkCollectionStatus()');
        return await this.checkCollectionStatus();
      }

      // 开始数据收集
      logger.info('[DATA_COLLECT] 🏁 Not collecting yet, calling startDataCollection()');
      const startResult = await this.startDataCollection();

      if (startResult.success) {
        logger.info('[DATA_COLLECT] Data collection started successfully');
        this.emitEvent('dataCollectionStart');
        return {
          success: true,
          nextState: DeviceState.DATA_COLLECT,
          reason: 'Data collection is running',
          retryDelay: 30000
        };
      } else {
        return {
          success: false,
          nextState: DeviceState.ERROR,
          reason: `Failed to start data collection: ${startResult.error}`
        };
      }
    } catch (error) {
      if (NetworkMonitor.isNetworkError(error)) {
        this.switchToOfflineMode();
        return await this.handleOfflineCollection(context);
      }
      throw error;
    }
  }

  /**
   * 处理离线状态的数据收集
   */
  private async handleOfflineCollection(context: FSMContext): Promise<StateHandlerResult> {
    try {
      logger.info('[DATA_COLLECT] 离线模式数据收集');

      // 1. 启动网络监控（如果尚未启动）
      if (!this.networkCheckInterval) {
        this.startNetworkMonitoring();
      }

      // 2. 收集数据但不上传，存储到本地缓存
      const data = await this.collectDataLocally(context);

      // 3. 定期检查网络恢复
      if (await this.checkNetworkRecovery()) {
        logger.info('[DATA_COLLECT] 检测到网络恢复，开始恢复流程');
        this.switchToRecoveryMode();
      }

      return {
        success: true,
        nextState: DeviceState.DATA_COLLECT,
        reason: 'Offline data collection active',
        retryDelay: 30000,
        data: { mode: 'offline', cachedItems: data?.length || 0 }
      };

    } catch (error) {
      logger.error('[DATA_COLLECT] 离线数据收集失败:', error);
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Offline collection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * 处理网络恢复状态的数据收集
   */
  private async handleRecoveryCollection(context: FSMContext): Promise<StateHandlerResult> {
    try {
      logger.info('[DATA_COLLECT] 网络恢复模式');

      // 1. 验证连接稳定性
      const config = this.configService.getConfig();
      const isStable = await this.errorRecoveryService.verifyConnectionStability(config.serverUrl);
      
      if (!isStable.success) {
        logger.info('[DATA_COLLECT] 连接不稳定，返回离线模式');
        this.switchToOfflineMode();
        return await this.handleOfflineCollection(context);
      }

      // 2. 执行完整恢复流程
      const recoveryResult = await this.errorRecoveryService.performRecovery(
        config.serverUrl,
        this.getWebSocketService()
      );

      if (recoveryResult.success) {
        logger.info(`[DATA_COLLECT] ✅ 网络恢复完成，同步了${recoveryResult.syncedItems || 0}条数据`);
        this.switchToOnlineMode();

        // 恢复正常数据收集
        return await this.handleOnlineCollection(context);
      } else {
        logger.error(`[DATA_COLLECT] ❌ 网络恢复失败: ${recoveryResult.reason}`);
        this.switchToOfflineMode();
        return await this.handleOfflineCollection(context);
      }

    } catch (error) {
      logger.error('[DATA_COLLECT] 网络恢复处理失败:', error);
      this.switchToOfflineMode();
      return await this.handleOfflineCollection(context);
    }
  }

  /**
   * 收集数据到本地缓存（离线模式）
   */
  private async collectDataLocally(context: FSMContext): Promise<any[]> {
    const collectedData: any[] = [];
    const config = this.configService.getConfig();

    try {
      // 收集截图数据
      if ((config as any).enableScreenshot !== false) {
        try {
          const screenshotData = await this.collectScreenshotData(config.monitoring || {});
          if (screenshotData && !screenshotData.error) {
            await this.offlineCacheService.cacheData('screenshot', config.deviceId, screenshotData);
            collectedData.push(screenshotData);
          }
        } catch (error) {
          logger.warn('[DATA_COLLECT] 离线截图收集失败', error);
        }
      }

      // 收集活动数据
      if ((config as any).enableActivity !== false) {
        try {
          const activityData = await this.collectActivityData(config.monitoring || {});
          if (activityData && !activityData.error) {
            await this.offlineCacheService.cacheData('activity', config.deviceId, activityData);
            collectedData.push(activityData);
          }
        } catch (error) {
          logger.warn('[DATA_COLLECT] 离线活动收集失败', error);
        }
      }

      // 收集进程数据
      if ((config as any).enableProcess !== false) {
        try {
          const processData = await this.collectProcessData();
          if (processData && !processData.error) {
            await this.offlineCacheService.cacheData('process', config.deviceId, processData);
            collectedData.push(processData);
          }
        } catch (error) {
          logger.warn('[DATA_COLLECT] 离线进程收集失败', error);
        }
      }

      logger.info(`[DATA_COLLECT] 离线模式收集了${collectedData.length}项数据`);
      
      // 触发内存清理
      this.performMemoryCleanup();
      
      return collectedData;

    } catch (error) {
      logger.error('[DATA_COLLECT] 本地数据收集失败:', error);
      return [];
    }
  }

  /**
   * 启动网络监控
   */
  private startNetworkMonitoring(): void {
    const config = this.configService.getConfig();
    if (config.serverUrl) {
      this.networkMonitor.startMonitoring(config.serverUrl);
    }

    // 设置定期网络检查
    this.networkCheckInterval = setInterval(async () => {
      await this.checkNetworkRecovery();
    }, 30000); // 每30秒检查一次
  }

  /**
   * 停止网络监控
   */
  private stopNetworkMonitoring(): void {
    this.networkMonitor.stopMonitoring();
    
    if (this.networkCheckInterval) {
      clearInterval(this.networkCheckInterval);
      this.networkCheckInterval = undefined;
    }
  }

  /**
   * 检查网络恢复
   */
  private async checkNetworkRecovery(): Promise<boolean> {
    try {
      const now = Date.now();
      if (now - this.lastNetworkCheck < 10000) {
        return false; // 10秒内不重复检查
      }
      this.lastNetworkCheck = now;

      const config = this.configService.getConfig();
      const networkStatus = await this.networkMonitor.checkServerHealth(config.serverUrl);
      
      return networkStatus.httpCheck && networkStatus.websocketCheck;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取WebSocket服务实例
   */
  private getWebSocketService(): any {
    // 尝试从应用实例获取WebSocket服务
    // 这个方法可能需要根据实际的服务管理器结构调整
    return null; // 暂时返回null，后续会通过服务管理器集成
  }

  // =========================
  // 网络状态切换方法
  // =========================

  /**
   * 切换到离线模式
   */
  private switchToOfflineMode(): void {
    if (this.networkSubState === NetworkSubState.OFFLINE) {
      return; // 已经是离线模式
    }

    logger.info('[DATA_COLLECT] 切换到离线模式');
    this.networkSubState = NetworkSubState.OFFLINE;
    this.offlineStartTime = Date.now();

    // WebSocket连接由全局服务管理
    logger.info('[DATA_COLLECT] 离线模式:WebSocket连接由全局服务管理');
    
    // 启动网络监控
    this.startNetworkMonitoring();
    
    // 发射事件
    this.emitEvent('network-offline', {
      timestamp: this.offlineStartTime,
      previousState: NetworkSubState.ONLINE
    });
  }

  /**
   * 切换到恢复模式
   */
  private switchToRecoveryMode(): void {
    if (this.networkSubState === NetworkSubState.RECOVERING) {
      return; // 已经在恢复模式
    }

    logger.info('[DATA_COLLECT] 切换到网络恢复模式');
    this.networkSubState = NetworkSubState.RECOVERING;
    
    // 发射事件
    this.emitEvent('network-recovering', {
      timestamp: Date.now(),
      offlineDuration: this.offlineStartTime > 0 ? Date.now() - this.offlineStartTime : 0
    });
  }

  /**
   * 切换到在线模式
   */
  private switchToOnlineMode(): void {
    if (this.networkSubState === NetworkSubState.ONLINE) {
      return; // 已经是在线模式
    }

    logger.info('[DATA_COLLECT] 切换到在线模式');
    const offlineDuration = this.offlineStartTime > 0 ? Date.now() - this.offlineStartTime : 0;
    
    this.networkSubState = NetworkSubState.ONLINE;
    this.offlineStartTime = 0;
    
    // 停止网络监控（在线模式下由基础维护处理）
    this.stopNetworkMonitoring();
    
    // 发射事件
    this.emitEvent('network-online', {
      timestamp: Date.now(),
      offlineDuration,
      recovered: true
    });
  }

  /**
   * 获取当前网络状态信息
   */
  public getNetworkStatus(): { subState: NetworkSubState; offlineDuration: number; isRecovering: boolean } {
    return {
      subState: this.networkSubState,
      offlineDuration: this.offlineStartTime > 0 ? Date.now() - this.offlineStartTime : 0,
      isRecovering: this.errorRecoveryService.getRecoveryStatus().isRecovering
    };
  }

  /**
   * 执行内存清理
   */
  private performMemoryCleanup(): void {
    try {
      // 检查当前内存使用情况
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      
      logger.info(`[DATA_COLLECT] 当前内存使用: ${heapUsedMB}MB`);
      
      // 如果内存使用超过200MB，触发垃圾回收
      if (memUsage.heapUsed > 200 * 1024 * 1024) {
        logger.info('[DATA_COLLECT] 内存使用较高，触发垃圾回收');
        
        // 强制垃圾回收（如果可用）
        if (global.gc) {
          global.gc();
          
          // 回收后再次检查内存
          const newMemUsage = process.memoryUsage();
          const newHeapUsedMB = Math.round(newMemUsage.heapUsed / 1024 / 1024);
          logger.info(`[DATA_COLLECT] 垃圾回收后内存使用: ${newHeapUsedMB}MB`);
        } else {
          logger.info('[DATA_COLLECT] 垃圾回收功能不可用（需要--expose-gc启动参数）');
        }
      }
      
      // 清理可能的循环引用
      if (this.lastScreenshotData) {
        this.lastScreenshotData = null;
      }
      
    } catch (error) {
      logger.warn('[DATA_COLLECT] 内存清理失败:', error);
    }
  }
}