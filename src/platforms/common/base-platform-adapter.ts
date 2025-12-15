/**
 * 平台适配器基类
 * 提供平台适配器的通用功能和默认实现
 */

import { EventEmitter } from 'events';
import { 
  IPlatformAdapter, 
  ScreenshotOptions, 
  ScreenshotResult, 
  PermissionStatus, 
  SystemInfo, 
  ProcessInfo, 
  WindowInfo, 
  PlatformCapabilities 
} from '../../common/interfaces/platform-interface';

export abstract class BasePlatformAdapter extends EventEmitter implements IPlatformAdapter {
  protected isInitialized = false;
  protected lastError: Error | null = null;

  constructor() {
    super();
    this.setMaxListeners(20); // 增加监听器限制
  }

  /**
   * 初始化平台适配器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.doInitialize();
      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      this.lastError = error as Error;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.doCleanup();
      this.isInitialized = false;
      this.emit('cleanup');
    } catch (error) {
      this.lastError = error as Error;
      this.emit('error', error);
    }
  }

  /**
   * 获取最后一次错误
   */
  getLastError(): Error | null {
    return this.lastError;
  }

  /**
   * 检查是否已初始化
   */
  getInitialized(): boolean {
    return this.isInitialized;
  }

  // 抽象方法 - 子类必须实现
  abstract takeScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  abstract captureWindow(windowId: string): Promise<ScreenshotResult>;
  abstract checkPermissions(): Promise<PermissionStatus>;
  abstract requestPermissions(): Promise<PermissionStatus>;
  abstract getSystemInfo(): Promise<SystemInfo>;
  abstract getProcessList(): Promise<ProcessInfo[]>;
  abstract getActiveWindow(): Promise<WindowInfo>;
  abstract startWindowMonitoring(callback: (window: WindowInfo) => void): void;
  abstract stopWindowMonitoring(): void;
  abstract getPlatformSpecificCapabilities(): PlatformCapabilities;

  // 钩子方法 - 子类可以重写
  protected abstract doInitialize(): Promise<void>;
  protected abstract doCleanup(): Promise<void>;

  /**
   * 执行带错误处理的操作
   */
  protected async executeWithErrorHandling<T>(
    operation: () => Promise<T>,
    operationName: string,
    fallback?: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.lastError = error as Error;
      this.emit('operation-error', {
        operation: operationName,
        error: error as Error
      });

      if (fallback) {
        try {
          return await fallback();
        } catch (fallbackError) {
          this.emit('fallback-error', {
            operation: operationName,
            originalError: error,
            fallbackError
          });
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  /**
   * 获取平台标识
   */
  protected getPlatformId(): string {
    return process.platform;
  }

  /**
   * 获取架构信息
   */
  protected getArchitecture(): string {
    return process.arch;
  }

  /**
   * 验证选项参数
   */
  protected validateOptions(options: any, requiredFields: string[] = []): void {
    if (!options) {
      if (requiredFields.length > 0) {
        throw new Error(`Options object is required with fields: ${requiredFields.join(', ')}`);
      }
      return;
    }

    for (const field of requiredFields) {
      if (!(field in options)) {
        throw new Error(`Required field '${field}' is missing from options`);
      }
    }
  }

  /**
   * 记录操作日志
   */
  protected logOperation(operation: string, data?: any): void {
    this.emit('operation-log', {
      operation,
      timestamp: Date.now(),
      platform: this.getPlatformId(),
      data
    });
  }

  /**
   * 收集监控数据 - 抽象方法，由子类实现
   */
  abstract collectMonitoringData(): Promise<any>;
}