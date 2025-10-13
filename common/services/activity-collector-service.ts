/**
 * 活动收集器服务 - 优化版本
 * 实现按配置间隔累积收集键盘鼠标活动的机制
 */

import { EventEmitter } from 'events';
import { IConfigService, IDataSyncService, IWebSocketService } from '../interfaces/service-interfaces';
import { IPlatformAdapter } from '../interfaces/platform-interface';
import { BaseService } from '../utils/base-service';

export interface ActivityData {
  keystrokes: number;
  mouseClicks: number;
  mouseMoves: number;
  scrollEvents: number;
  activeTime: number; // 活跃时间（毫秒）
  idleTime: number; // 空闲时间（毫秒）
  intervalDuration: number; // 收集间隔（毫秒）
  windowTitle?: string;
  processName?: string;
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

  // 配置相关
  private config: ActivityCollectorConfig = {
    activityInterval: 60000, // 默认1分钟
    enableActivity: true,
    enableIdleDetection: true,
    idleThreshold: 30000 // 30秒空闲阈值
  };

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
  }

  async start(): Promise<void> {
    if (this.isCollecting) {
      console.warn('[ACTIVITY_COLLECTOR] Service already running');
      return;
    }

    try {
      console.log('[ACTIVITY_COLLECTOR] Starting activity collection service...');

      // 加载配置
      await this.loadConfig();

      // 检查是否启用活动监控
      if (!this.config.enableActivity) {
        console.log('[ACTIVITY_COLLECTOR] Activity monitoring is disabled');
        return;
      }

      this.isCollecting = true;

      // 初始化累积数据
      this.resetAccumulatedData();

      // 启动原生事件监听
      await this.startNativeEventListener();

      // 启动上传定时器
      this.startUploadTimer();

      // 监听配置变更
      this.setupConfigChangeListener();

      this.emit('service-started');
      console.log('[ACTIVITY_COLLECTOR] Activity collection service started successfully');

    } catch (error: any) {
      console.error('[ACTIVITY_COLLECTOR] Failed to start service:', error);
      this.isCollecting = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isCollecting) {
      return;
    }

    try {
      console.log('[ACTIVITY_COLLECTOR] Stopping activity collection service...');

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
      console.log('[ACTIVITY_COLLECTOR] Activity collection service stopped');

    } catch (error: any) {
      console.error('[ACTIVITY_COLLECTOR] Error stopping service:', error);
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
      console.log('[ACTIVITY_COLLECTOR] Updating configuration...', newConfig);

      const oldInterval = this.config.activityInterval;
      const newInterval = newConfig.activityInterval;

      // 如果间隔时间发生变化，需要处理当前收集的数据
      if (newInterval && newInterval !== oldInterval && this.isCollecting) {
        // 先上传当前累积的数据
        if (this.hasAccumulatedData()) {
          await this.uploadAccumulatedData();
        }

        // 更新配置
        this.config = { ...this.config, ...newConfig };

        // 重置收集器
        this.resetAccumulatedData();

        // 重启上传定时器
        this.restartUploadTimer();

        console.log(`[ACTIVITY_COLLECTOR] Collection interval updated: ${oldInterval}ms -> ${newInterval}ms`);
      } else {
        // 仅更新配置
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
      console.error('[ACTIVITY_COLLECTOR] Failed to update config:', error);
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
        activityInterval: config.activityInterval || 60000,
        enableActivity: config.enableActivity !== false,
        enableIdleDetection: config.enableIdleDetection !== false,
        idleThreshold: config.idleThreshold || 30000
      };

      console.log('[ACTIVITY_COLLECTOR] Configuration loaded:', this.config);
    } catch (error) {
      console.warn('[ACTIVITY_COLLECTOR] Failed to load config, using defaults:', error);
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

        console.log('[ACTIVITY_COLLECTOR] Native event listener started');
      } else {
        console.warn('[ACTIVITY_COLLECTOR] Failed to create native event listener');
      }

    } catch (error) {
      console.error('[ACTIVITY_COLLECTOR] Failed to start native event listener:', error);
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
        console.log('[ACTIVITY_COLLECTOR] Native event listener stopped');
      } catch (error) {
        console.error('[ACTIVITY_COLLECTOR] Error stopping native event listener:', error);
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
        this.accumulatedData.scrollEvents++;
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
      console.log('[ACTIVITY_COLLECTOR] User became idle');
    } else if (!isIdle && this.isCurrentlyIdle) {
      // 从空闲状态恢复
      this.isCurrentlyIdle = false;
      this.accumulatedData.idleTime += timeDiff;
      this.updateLastActivityTime();
      console.log('[ACTIVITY_COLLECTOR] User became active again', { idleTime: timeDiff });
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
          console.error('[ACTIVITY_COLLECTOR] Upload interval error:', error);
        }
      }
    }, this.config.activityInterval);

    console.log(`[ACTIVITY_COLLECTOR] Upload timer started with interval: ${this.config.activityInterval}ms`);
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
      scrollEvents: 0,
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

    console.log('[ACTIVITY_COLLECTOR] Accumulated data reset');
  }

  private hasAccumulatedData(): boolean {
    return this.accumulatedData.keystrokes > 0 || 
           this.accumulatedData.mouseClicks > 0 || 
           this.accumulatedData.mouseMoves > 0 ||
           this.accumulatedData.scrollEvents > 0 ||
           this.accumulatedData.activeTime > 0;
  }

  private async uploadAccumulatedData(): Promise<void> {
    try {
      const now = Date.now();
      const actualDuration = now - this.collectionStartTime;

      // 更新数据
      this.accumulatedData.intervalDuration = actualDuration;
      this.accumulatedData.timestamp = new Date();

      // 获取当前窗口信息
      try {
        const windowInfo = await this.platformAdapter.getActiveWindow();
        this.accumulatedData.windowTitle = windowInfo?.title;
        this.accumulatedData.processName = windowInfo?.processName;
      } catch (error) {
        console.debug('[ACTIVITY_COLLECTOR] Failed to get window info:', error);
      }

      console.log('[ACTIVITY_COLLECTOR] Uploading accumulated data:', {
        keystrokes: this.accumulatedData.keystrokes,
        mouseClicks: this.accumulatedData.mouseClicks,
        activeTime: this.accumulatedData.activeTime,
        duration: actualDuration
      });

      // 准备数据格式 - 匹配服务器期望的字段
      const inputActivityData = {
        timestamp: this.accumulatedData.timestamp.toISOString(), // 必需: 时间戳
        isActive: true, // 必需: 活动状态（有键盘鼠标事件即为活动）
        keystrokes: this.accumulatedData.keystrokes,
        mouseClicks: this.accumulatedData.mouseClicks,
        idleTime: this.accumulatedData.idleTime,
        activeWindow: this.accumulatedData.windowTitle,
        activeWindowProcess: this.accumulatedData.processName,
        activityInterval: this.accumulatedData.intervalDuration
      };

      // 优先使用WebSocket上传，失败则使用HTTP
      let uploadSuccess = false;

      if (this.websocketService && this.websocketService.isConnected()) {
        try {
          console.log('[ACTIVITY_COLLECTOR] ⚡ Uploading via WebSocket (real-time)');
          await this.websocketService.sendActivityData(inputActivityData);
          uploadSuccess = true;
          console.log('[ACTIVITY_COLLECTOR] ✅ WebSocket upload successful');
        } catch (wsError: any) {
          console.error('[ACTIVITY_COLLECTOR] ❌ WebSocket upload failed, falling back to HTTP:', {
            message: wsError?.message,
            code: wsError?.code
          });
        }
      } else {
        console.log('[ACTIVITY_COLLECTOR] WebSocket not connected, using HTTP fallback');
      }

      // HTTP fallback
      if (!uploadSuccess) {
        console.log('[ACTIVITY_COLLECTOR] 🔄 Uploading via HTTP API (fallback)');
        await this.dataSyncService.addActivityData(inputActivityData);
        console.log('[ACTIVITY_COLLECTOR] ✅ HTTP upload successful');
      }

      // 重置累积数据
      this.resetAccumulatedData();

      this.emit('data-uploaded', this.accumulatedData);

    } catch (error: any) {
      console.error('[ACTIVITY_COLLECTOR] Failed to upload accumulated data:', error);
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
}