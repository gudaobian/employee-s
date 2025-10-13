/**
 * 平台适配器桥接器
 * 解决不同接口定义的兼容性问题
 */

import { IPlatformAdapter as CommonIPlatformAdapter } from '../common/interfaces/platform-interface';
import { IPlatformAdapter as PlatformIPlatformAdapter, PlatformAdapterBase } from '../platforms/interfaces/platform-interface';
import { logger } from '../common/utils/logger';

/**
 * 桥接器类，将platforms接口适配为common接口
 */
export class PlatformAdapterBridge extends PlatformAdapterBase implements CommonIPlatformAdapter {
  constructor(private platformAdapter: PlatformIPlatformAdapter) {
    super();
  }

  async takeScreenshot(options?: any): Promise<any> {
    this.ensureInitialized();
    return this.platformAdapter.takeScreenshot(options);
  }

  async captureWindow(windowId: string): Promise<any> {
    // 这个方法在platforms接口中不存在，返回默认值
    throw new Error('captureWindow not implemented in platform adapter');
  }

  async checkPermissions(): Promise<any> {
    // 映射到新接口的权限检查
    const screenshot = await this.platformAdapter.checkScreenshotPermission();
    const accessibility = await this.platformAdapter.checkAccessibilityPermission();
    
    return {
      screenshot: screenshot.granted,
      accessibility: accessibility.granted,
      systemInfo: true // 假设系统信息总是可用
    };
  }

  async requestPermissions(): Promise<any> {
    // 映射到新接口的权限请求
    const screenshot = await this.platformAdapter.requestScreenshotPermission();
    const accessibility = await this.platformAdapter.requestAccessibilityPermission();
    
    return {
      screenshot: screenshot.granted,
      accessibility: accessibility.granted,
      systemInfo: true
    };
  }

  startWindowMonitoring(callback: (window: any) => void): void {
    // 这个功能在新接口中不存在，空实现
    logger.warn('[PLATFORM_BRIDGE] startWindowMonitoring not implemented');
  }

  stopWindowMonitoring(): void {
    // 这个功能在新接口中不存在，空实现
    logger.warn('[PLATFORM_BRIDGE] stopWindowMonitoring not implemented');
  }

  async collectMonitoringData(): Promise<any> {
    return this.platformAdapter.getActivityData();
  }

  getPlatformSpecificCapabilities(): any {
    return {
      supportsScreenshot: true,
      supportsWindowMonitoring: true,
      supportsSystemInfo: true,
      nativePermissionRequired: true,
      supportedScreenshotFormats: this.platformAdapter.getPlatformCapabilities(),
      hasNativeAPI: true
    };
  }

  // 实现抽象方法
  protected async performInitialization(): Promise<void> {
    await this.platformAdapter.initialize();
  }

  protected async performCleanup(): Promise<void> {
    await this.platformAdapter.cleanup();
  }

  // 转发所有方法到底层适配器
  async getSystemInfo(): Promise<any> {
    return this.platformAdapter.getSystemInfo();
  }

  async getProcessList(): Promise<any> {
    return this.platformAdapter.getRunningProcesses();
  }

  async getRunningProcesses(): Promise<any> {
    return this.platformAdapter.getRunningProcesses();
  }

  async getActiveWindow(): Promise<any> {
    return this.platformAdapter.getActiveWindow();
  }

  async getNetworkInfo(): Promise<any> {
    return this.platformAdapter.getNetworkInfo();
  }

  async checkScreenshotPermission(): Promise<any> {
    return this.platformAdapter.checkScreenshotPermission();
  }

  async requestScreenshotPermission(): Promise<any> {
    return this.platformAdapter.requestScreenshotPermission();
  }

  async startActivityMonitoring(): Promise<void> {
    this.monitoringActive = true;
    return this.platformAdapter.startActivityMonitoring();
  }

  async stopActivityMonitoring(): Promise<void> {
    this.monitoringActive = false;
    return this.platformAdapter.stopActivityMonitoring();
  }

  async getActivityData(): Promise<any> {
    return this.platformAdapter.getActivityData();
  }

  async checkAccessibilityPermission(): Promise<any> {
    return this.platformAdapter.checkAccessibilityPermission();
  }

  async requestAccessibilityPermission(): Promise<any> {
    return this.platformAdapter.requestAccessibilityPermission();
  }

  async isAutoStartEnabled(): Promise<boolean> {
    return this.platformAdapter.isAutoStartEnabled();
  }

  async enableAutoStart(): Promise<boolean> {
    return this.platformAdapter.enableAutoStart();
  }

  async disableAutoStart(): Promise<boolean> {
    return this.platformAdapter.disableAutoStart();
  }

  getPlatformCapabilities(): string[] {
    return this.platformAdapter.getPlatformCapabilities();
  }

  async executePlatformSpecificOperation(operation: string, params?: any): Promise<any> {
    return this.platformAdapter.executePlatformSpecificOperation(operation, params);
  }

  // 数据上传成功后重置计数器
  onDataUploadSuccess(): void {
    logger.info('[PLATFORM_BRIDGE] 收到数据上传成功通知，转发给底层平台适配器');
    try {
      // 检查底层平台适配器是否支持计数器重置（使用可选链和类型守卫）
      if (this.platformAdapter?.onDataUploadSuccess) {
        this.platformAdapter.onDataUploadSuccess();
        logger.info('[PLATFORM_BRIDGE] ✅ 成功转发计数器重置请求');
      } else {
        logger.warn('[PLATFORM_BRIDGE] ⚠️ 底层平台适配器不支持计数器重置功能');
        logger.debug('[PLATFORM_BRIDGE] platformAdapter类型:', this.platformAdapter?.constructor.name);
      }
    } catch (error) {
      logger.error('[PLATFORM_BRIDGE] ❌ 转发计数器重置请求失败:', error);
    }
  }

  // 创建事件监听器
  async createEventListener(options: any): Promise<any> {
    logger.info('[PLATFORM_BRIDGE] 创建事件监听器请求，转发给底层平台适配器');
    try {
      // 检查底层平台适配器是否支持createEventListener（使用可选链）
      if (this.platformAdapter?.createEventListener) {
        const listener = await this.platformAdapter.createEventListener(options);
        logger.info('[PLATFORM_BRIDGE] ✅ 成功创建事件监听器');
        return listener;
      } else {
        logger.warn('[PLATFORM_BRIDGE] ⚠️ 底层平台适配器不支持createEventListener');
        logger.debug('[PLATFORM_BRIDGE] platformAdapter类型:', this.platformAdapter?.constructor.name);
        return null;
      }
    } catch (error) {
      logger.error('[PLATFORM_BRIDGE] ❌ 创建事件监听器失败:', error);
      return null;
    }
  }
}