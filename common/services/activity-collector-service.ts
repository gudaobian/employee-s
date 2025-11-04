/**
 * 活动收集器服务 - 优化版本
 * 实现按配置间隔累积收集键盘鼠标活动的机制
 */

import { EventEmitter } from 'events';
import { IConfigService, IDataSyncService, IWebSocketService } from '../interfaces/service-interfaces';
import { IPlatformAdapter } from '../interfaces/platform-interface';
import { BaseService } from '../utils/base-service';
import { logger } from '../utils';
import { URLCollectorService } from './url-collector-service';

export interface ActivityData {
  keystrokes: number;
  mouseClicks: number;
  mouseMoves: number;
  mouseScrolls: number;
  activeTime: number; // 活跃时间（毫秒）
  idleTime: number; // 空闲时间（毫秒）
  intervalDuration: number; // 收集间隔（毫秒）
  windowTitle?: string;
  processName?: string;
  activeUrl?: string; // 活动窗口的URL（如果是浏览器）
  timestamp: Date;
  sessionId?: string;
}

export interface ActivityCollectorConfig {
  activityInterval: number; // 活动采集间隔（毫秒）
  enableActivity: boolean; // 是否启用活动监控
  enableIdleDetection: boolean; // 是否启用空闲检测
  idleThreshold: number; // 空闲阈值（毫秒，默认30秒）
}

/**
 * 优化的活动收集器
 * 支持配置间隔的累积收集模式
 */
export class ActivityCollectorService extends BaseService {
  private configService: IConfigService;
  private dataSyncService: IDataSyncService;
  private websocketService?: IWebSocketService;
  private platformAdapter: IPlatformAdapter;
  private urlCollectorService?: URLCollectorService;

  // 配置相关
  private config: ActivityCollectorConfig = {
    activityInterval: 60000, // 默认1分钟
    enableActivity: true,
    enableIdleDetection: true,
    idleThreshold: 30000 // 30秒空闲阈值
  };
  private pendingConfig?: Partial<ActivityCollectorConfig>; // 待应用的配置（等待当前周期完成）

  // 收集状态
  private isCollecting = false;
  private collectionInterval?: NodeJS.Timeout;
  private uploadInterval?: NodeJS.Timeout;

  // 累积数据
  private accumulatedData: ActivityData = this.createEmptyActivityData();
  private collectionStartTime: number = 0;
  private lastActivityTime: number = 0;
  private isCurrentlyIdle = false;

  // 原生事件监听器
  private nativeEventListener?: any;

  constructor(
    configService: IConfigService,
    dataSyncService: IDataSyncService,
    platformAdapter: IPlatformAdapter,
    websocketService?: IWebSocketService
  ) {
    super();
    this.configService = configService;
    this.dataSyncService = dataSyncService;
    this.platformAdapter = platformAdapter;
    this.websocketService = websocketService;

    // 初始化URL采集服务
    this.urlCollectorService = new URLCollectorService();
  }

  async start(): Promise<void> {
    if (this.isCollecting) {
      logger.warn('[ACTIVITY_COLLECTOR] Service already running');
      return;
    }

    try {
      logger.info('[ACTIVITY_COLLECTOR] Starting activity collection service...');

      // 加载配置
      await this.loadConfig();

      // 检查是否启用活动监控
      if (!this.config.enableActivity) {
        logger.info('[ACTIVITY_COLLECTOR] Activity monitoring is disabled');
        return;
      }

      this.isCollecting = true;

      // 初始化累积数据
      this.resetAccumulatedData();

      // 初始化URL采集服务
      if (this.urlCollectorService) {
        await this.urlCollectorService.initialize(this.platformAdapter);
      }

      // 启动原生事件监听
      await this.startNativeEventListener();

      // 启动上传定时器
      this.startUploadTimer();

      // 监听配置变更
      this.setupConfigChangeListener();

      this.emit('service-started');
      logger.info('[ACTIVITY_COLLECTOR] Activity collection service started successfully');

    } catch (error: any) {
      logger.error('[ACTIVITY_COLLECTOR] Failed to start service:', error);
      this.isCollecting = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isCollecting) {
      return;
    }

    try {
      logger.info('[ACTIVITY_COLLECTOR] Stopping activity collection service...');

      this.isCollecting = false;

      // 停止定时器
      if (this.collectionInterval) {
        clearInterval(this.collectionInterval);
        this.collectionInterval = undefined;
      }

      if (this.uploadInterval) {
        clearInterval(this.uploadInterval);
        this.uploadInterval = undefined;
      }

      // 停止原生事件监听
      await this.stopNativeEventListener();

      // 上传剩余数据
      if (this.hasAccumulatedData()) {
        await this.uploadAccumulatedData();
      }

      this.emit('service-stopped');
      logger.info('[ACTIVITY_COLLECTOR] Activity collection service stopped');

    } catch (error: any) {
      logger.error('[ACTIVITY_COLLECTOR] Error stopping service:', error);
    }
  }

  /**
   * 检查服务是否正在运行
   */
  isRunning(): boolean {
    return this.isCollecting;
  }

  /**
   * 更新活动收集配置
   */
  async updateConfig(newConfig: Partial<ActivityCollectorConfig>): Promise<void> {
    try {
      logger.info('[ACTIVITY_COLLECTOR] Updating configuration...', newConfig);

      const oldInterval = this.config.activityInterval;
      const newInterval = newConfig.activityInterval;

      // 如果间隔时间发生变化，需要处理当前收集的数据
      if (newInterval && newInterval !== oldInterval && this.isCollecting) {
        // 如果定时器正在运行，延迟应用配置（等待当前周期完成）
        if (this.uploadInterval) {
          this.pendingConfig = newConfig;
          logger.info(`[ACTIVITY_COLLECTOR] ⏳ Config update pending (timer running): ${oldInterval}ms -> ${newInterval}ms`);
          logger.info('[ACTIVITY_COLLECTOR] Will apply config after current collection cycle completes');
          return; // 不立即应用，等待定时器触发上传时应用
        }

        // 定时器未运行，立即应用配置
        logger.info('[ACTIVITY_COLLECTOR] Timer not running, applying config immediately');

        // 先上传当前累积的数据（如果有）
        if (this.hasAccumulatedData()) {
          await this.uploadAccumulatedData();
        }

        // 更新配置
        this.config = { ...this.config, ...newConfig };

        // 重置收集器
        this.resetAccumulatedData();

        // 重启上传定时器
        this.restartUploadTimer();

        logger.info(`[ACTIVITY_COLLECTOR] ✅ Collection interval updated immediately: ${oldInterval}ms -> ${newInterval}ms`);
      } else {
        // 间隔未变化，仅更新其他配置项
        this.config = { ...this.config, ...newConfig };
      }

      // 处理监控开关
      if (newConfig.enableActivity !== undefined) {
        if (newConfig.enableActivity && !this.config.enableActivity) {
          // 启用监控
          await this.start();
        } else if (!newConfig.enableActivity && this.config.enableActivity) {
          // 禁用监控
          await this.stop();
        }
      }

      this.emit('config-updated', this.config);

    } catch (error: any) {
      logger.error('[ACTIVITY_COLLECTOR] Failed to update config:', error);
      throw error;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): ActivityCollectorConfig {
    return { ...this.config };
  }

  /**
   * 获取当前状态
   */
  getStatus(): {
    isCollecting: boolean;
    config: ActivityCollectorConfig;
    accumulatedData: ActivityData;
    nextUploadTime: Date | null;
  } {
    const nextUploadTime = this.collectionStartTime 
      ? new Date(this.collectionStartTime + this.config.activityInterval)
      : null;

    return {
      isCollecting: this.isCollecting,
      config: this.config,
      accumulatedData: { ...this.accumulatedData },
      nextUploadTime
    };
  }

  // 私有方法

  private async loadConfig(): Promise<void> {
    try {
      const config = this.configService.getConfig();

      this.config = {
        activityInterval: config.activityInterval ?? 60000,
        enableActivity: config.enableActivity !== false,
        enableIdleDetection: config.enableIdleDetection !== false,
        idleThreshold: config.idleThreshold ?? 30000
      };

      logger.info('[ACTIVITY_COLLECTOR] Configuration loaded:', {
        activityInterval: this.config.activityInterval,
        enableActivity: this.config.enableActivity,
        enableIdleDetection: this.config.enableIdleDetection,
        idleThreshold: this.config.idleThreshold
      });

      // 添加警告：如果使用了默认值
      if (config.activityInterval === undefined || config.activityInterval === null) {
        logger.warn('[ACTIVITY_COLLECTOR] ⚠️ activityInterval not configured, using default 60000ms');
        logger.warn('[ACTIVITY_COLLECTOR] ⚠️ This should be configured in system_config table');
        logger.warn('[ACTIVITY_COLLECTOR] ⚠️ Expected value from server: 600000ms (10 minutes)');
      } else if (this.config.activityInterval === 60000) {
        logger.warn('[ACTIVITY_COLLECTOR] ⚠️ activityInterval is 60000ms (1 minute)');
        logger.warn('[ACTIVITY_COLLECTOR] ⚠️ Expected configured value: 600000ms (10 minutes)');
      } else {
        logger.info('[ACTIVITY_COLLECTOR] ✅ Using configured activityInterval:', this.config.activityInterval);
      }
    } catch (error) {
      logger.warn('[ACTIVITY_COLLECTOR] Failed to load config, using defaults:', error);
    }
  }

  private setupConfigChangeListener(): void {
    // 监听配置服务的变更事件
    this.configService.on?.('config-updated', async (updatedConfig: any) => {
      if (updatedConfig.activityInterval !== undefined ||
          updatedConfig.enableActivity !== undefined) {
        
        await this.updateConfig({
          activityInterval: updatedConfig.activityInterval,
          enableActivity: updatedConfig.enableActivity,
          enableIdleDetection: updatedConfig.enableIdleDetection,
          idleThreshold: updatedConfig.idleThreshold
        });
      }
    });
  }

  private async startNativeEventListener(): Promise<void> {
    try {
      // 获取平台特定的事件监听器
      this.nativeEventListener = await this.platformAdapter.createEventListener({
        keyboard: true,
        mouse: true,
        idle: this.config.enableIdleDetection
      });

      if (this.nativeEventListener) {
        // 监听键盘事件
        this.nativeEventListener.on('keyboard', (data: any) => {
          this.handleKeyboardEvent(data);
        });

        // 监听鼠标事件
        this.nativeEventListener.on('mouse', (data: any) => {
          this.handleMouseEvent(data);
        });

        // 监听空闲状态变化
        if (this.config.enableIdleDetection) {
          this.nativeEventListener.on('idle', (isIdle: boolean) => {
            this.handleIdleStateChange(isIdle);
          });
        }

        logger.info('[ACTIVITY_COLLECTOR] Native event listener started');
      } else {
        logger.warn('[ACTIVITY_COLLECTOR] Failed to create native event listener');
      }

    } catch (error) {
      logger.error('[ACTIVITY_COLLECTOR] Failed to start native event listener:', error);
      // 继续运行，但没有原生事件监听
    }
  }

  private async stopNativeEventListener(): Promise<void> {
    if (this.nativeEventListener) {
      try {
        this.nativeEventListener.removeAllListeners();
        if (this.nativeEventListener.stop) {
          await this.nativeEventListener.stop();
        }
        this.nativeEventListener = undefined;
        logger.info('[ACTIVITY_COLLECTOR] Native event listener stopped');
      } catch (error) {
        logger.error('[ACTIVITY_COLLECTOR] Error stopping native event listener:', error);
      }
    }
  }

  private handleKeyboardEvent(data: any): void {
    if (!this.isCollecting) return;

    this.accumulatedData.keystrokes++;
    this.updateLastActivityTime();
    this.updateActiveTime();

    // console.debug('[ACTIVITY_COLLECTOR] Keyboard event:', { keystrokes: this.accumulatedData.keystrokes });
  }

  private handleMouseEvent(data: any): void {
    if (!this.isCollecting) return;

    switch (data.type) {
      case 'click':
        this.accumulatedData.mouseClicks++;
        break;
      case 'move':
        this.accumulatedData.mouseMoves++;
        break;
      case 'scroll':
        this.accumulatedData.mouseScrolls++;
        break;
    }

    this.updateLastActivityTime();
    this.updateActiveTime();

    // console.debug('[ACTIVITY_COLLECTOR] Mouse event:', { 
    //   type: data.type, 
    //   clicks: this.accumulatedData.mouseClicks,
    //   moves: this.accumulatedData.mouseMoves
    // });
  }

  private handleIdleStateChange(isIdle: boolean): void {
    if (!this.isCollecting) return;

    const now = Date.now();
    const timeDiff = now - this.lastActivityTime;

    if (isIdle && !this.isCurrentlyIdle) {
      // 变为空闲状态
      this.isCurrentlyIdle = true;
      logger.info('[ACTIVITY_COLLECTOR] User became idle');
    } else if (!isIdle && this.isCurrentlyIdle) {
      // 从空闲状态恢复
      this.isCurrentlyIdle = false;
      this.accumulatedData.idleTime += timeDiff;
      this.updateLastActivityTime();
      logger.info('[ACTIVITY_COLLECTOR] User became active again', { idleTime: timeDiff });
    }
  }

  private updateLastActivityTime(): void {
    this.lastActivityTime = Date.now();
  }

  private updateActiveTime(): void {
    if (!this.isCurrentlyIdle) {
      const now = Date.now();
      const timeSinceLastActivity = now - this.lastActivityTime;
      
      // 只有在合理的时间范围内才累积活跃时间
      if (timeSinceLastActivity < this.config.idleThreshold) {
        this.accumulatedData.activeTime += timeSinceLastActivity;
      }
    }
  }

  private startUploadTimer(): void {
    this.uploadInterval = setInterval(async () => {
      if (this.isCollecting && this.hasAccumulatedData()) {
        try {
          await this.uploadAccumulatedData();
        } catch (error) {
          logger.error('[ACTIVITY_COLLECTOR] Upload interval error:', error);
        }
      }
    }, this.config.activityInterval);

    logger.info(`[ACTIVITY_COLLECTOR] Upload timer started with interval: ${this.config.activityInterval}ms`);
  }

  private restartUploadTimer(): void {
    if (this.uploadInterval) {
      clearInterval(this.uploadInterval);
      this.uploadInterval = undefined;
    }
    this.startUploadTimer();
  }

  private createEmptyActivityData(): ActivityData {
    return {
      keystrokes: 0,
      mouseClicks: 0,
      mouseMoves: 0,
      mouseScrolls: 0,
      activeTime: 0,
      idleTime: 0,
      intervalDuration: this.config.activityInterval,
      timestamp: new Date()
    };
  }

  private resetAccumulatedData(): void {
    this.accumulatedData = this.createEmptyActivityData();
    this.collectionStartTime = Date.now();
    this.lastActivityTime = this.collectionStartTime;
    this.isCurrentlyIdle = false;

    logger.info('[ACTIVITY_COLLECTOR] Accumulated data reset');
  }

  private hasAccumulatedData(): boolean {
    return this.accumulatedData.keystrokes > 0 ||
           this.accumulatedData.mouseClicks > 0 ||
           this.accumulatedData.mouseMoves > 0 ||
           this.accumulatedData.mouseScrolls > 0 ||
           this.accumulatedData.activeTime > 0;
  }

  private async uploadAccumulatedData(): Promise<void> {
    try {
      // 使用配置的间隔值，而不是实际计时时长
      // 这样可以避免计时器漂移导致的间隔不一致
      this.accumulatedData.intervalDuration = this.config.activityInterval;
      this.accumulatedData.timestamp = new Date();

      // 获取当前窗口信息
      try {
        const windowInfo = await this.platformAdapter.getActiveWindow();
        this.accumulatedData.windowTitle = windowInfo?.title;
        // 修复: 使用 application 字段（统一接口定义），兼容旧的 processName
        this.accumulatedData.processName = windowInfo?.application || (windowInfo as any)?.processName;

        // 采集浏览器URL（仅当活动窗口是浏览器时）
        logger.info('[ACTIVITY_COLLECTOR] Window info:', {
          hasWindowInfo: !!windowInfo,
          application: windowInfo?.application,
          isBrowser: windowInfo?.application ? this.isBrowserApplication(windowInfo.application) : false,
          hasUrlCollector: !!this.urlCollectorService
        });

        if (windowInfo?.application && this.isBrowserApplication(windowInfo.application)) {
          try {
            if (this.urlCollectorService) {
              const urlInfo = await this.urlCollectorService.collectActiveURL();
              if (urlInfo) {
                this.accumulatedData.activeUrl = urlInfo.url;
                logger.debug('[ACTIVITY_COLLECTOR] Collected browser URL:', {
                  browser: windowInfo.application,
                  url: urlInfo.url
                });
              }
            }
          } catch (error) {
            logger.debug('[ACTIVITY_COLLECTOR] Failed to collect URL from browser:', error);
          }
        }
      } catch (error) {
        logger.warn('[ACTIVITY_COLLECTOR] Failed to get window info:', error);
      }

      logger.info('[ACTIVITY_COLLECTOR] Uploading accumulated data:', {
        keystrokes: this.accumulatedData.keystrokes,
        mouseClicks: this.accumulatedData.mouseClicks,
        mouseScrolls: this.accumulatedData.mouseScrolls,
        activeTime: this.accumulatedData.activeTime,
        duration: this.config.activityInterval
      });

      // 准备数据格式 - 匹配服务器期望的字段
      const inputActivityData = {
        timestamp: this.accumulatedData.timestamp.toISOString(), // 必需: 时间戳
        isActive: true, // 必需: 活动状态（有键盘鼠标事件即为活动）
        keystrokes: this.accumulatedData.keystrokes,
        mouseClicks: this.accumulatedData.mouseClicks,
        mouseScrolls: this.accumulatedData.mouseScrolls,
        idleTime: this.accumulatedData.idleTime,
        activeWindow: this.accumulatedData.windowTitle,
        activeWindowProcess: this.accumulatedData.processName,
        activeUrl: this.accumulatedData.activeUrl, // 浏览器URL（已脱敏）
        activityInterval: this.accumulatedData.intervalDuration
      };

      // 详细的上传数据日志
      logger.info('[ACTIVITY_COLLECTOR] 📤 Data to upload:', {
        activityInterval: inputActivityData.activityInterval,
        configInterval: this.config.activityInterval,
        match: inputActivityData.activityInterval === this.config.activityInterval,
        expectedInterval: 600000
      });

      // 验证：activityInterval应该等于配置值
      if (inputActivityData.activityInterval === this.config.activityInterval) {
        logger.info(`[ACTIVITY_COLLECTOR] ✅ Uploading activityInterval: ${inputActivityData.activityInterval}ms`);
      } else {
        logger.warn('[ACTIVITY_COLLECTOR] ⚠️ activityInterval mismatch:', {
          uploading: inputActivityData.activityInterval,
          configured: this.config.activityInterval
        });
      }

      // 优先使用WebSocket上传，失败则使用HTTP
      let uploadSuccess = false;

      if (this.websocketService && this.websocketService.isConnected()) {
        try {
          logger.info('[ACTIVITY_COLLECTOR] ⚡ Uploading via WebSocket (real-time)');
          await this.websocketService.sendActivityData(inputActivityData);
          uploadSuccess = true;
          logger.info('[ACTIVITY_COLLECTOR] ✅ WebSocket upload successful');
        } catch (wsError: any) {
          logger.error('[ACTIVITY_COLLECTOR] ❌ WebSocket upload failed, falling back to HTTP:', {
            message: wsError?.message,
            code: wsError?.code
          });
        }
      } else {
        logger.info('[ACTIVITY_COLLECTOR] WebSocket not connected, using HTTP fallback');
      }

      // HTTP fallback
      if (!uploadSuccess) {
        logger.info('[ACTIVITY_COLLECTOR] 🔄 Uploading via HTTP API (fallback)');
        await this.dataSyncService.addActivityData(inputActivityData);
        logger.info('[ACTIVITY_COLLECTOR] ✅ HTTP upload successful');
      }

      // 检查是否有待应用的配置（在上传完成后应用）
      if (this.pendingConfig) {
        const oldInterval = this.config.activityInterval;
        const newInterval = this.pendingConfig.activityInterval;

        logger.info('[ACTIVITY_COLLECTOR] ✅ Applying pending config after upload completed');
        logger.info(`[ACTIVITY_COLLECTOR] Interval change: ${oldInterval}ms -> ${newInterval}ms`);

        // 应用待定配置
        this.config = { ...this.config, ...this.pendingConfig };
        this.pendingConfig = undefined;

        // 重启上传定时器（使用新间隔）
        this.restartUploadTimer();

        logger.info('[ACTIVITY_COLLECTOR] ✅ Pending config applied, timer restarted with new interval');
      }

      // 重置累积数据
      this.resetAccumulatedData();

      this.emit('data-uploaded', this.accumulatedData);

    } catch (error: any) {
      logger.error('[ACTIVITY_COLLECTOR] Failed to upload accumulated data:', error);
      this.emit('upload-error', error);
      throw error;
    }
  }

  // 公共方法：手动上传数据
  async forceUpload(): Promise<void> {
    if (this.hasAccumulatedData()) {
      await this.uploadAccumulatedData();
    }
  }

  // 公共方法：获取实时活动状态
  getCurrentActivity(): {
    isActive: boolean;
    isIdle: boolean;
    lastActivityTime: Date;
    accumulatedData: ActivityData;
  } {
    return {
      isActive: !this.isCurrentlyIdle,
      isIdle: this.isCurrentlyIdle,
      lastActivityTime: new Date(this.lastActivityTime),
      accumulatedData: { ...this.accumulatedData }
    };
  }

  /**
   * 判断应用是否为浏览器
   */
  private isBrowserApplication(appName: string): boolean {
    if (!appName) return false;

    const lowerAppName = appName.toLowerCase();
    const browserNames = [
      'safari',
      'chrome',
      'google chrome',
      'firefox',
      'edge',
      'microsoft edge',
      'brave',
      'brave browser',
      'opera',
      'vivaldi',
      'arc'
    ];

    return browserNames.some(browser => lowerAppName.includes(browser));
  }
}