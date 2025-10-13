/**
 * 平台抽象接口
 * 定义所有平台需要实现的通用功能
 */

export interface SystemInfo {
  platform: string;
  architecture: string;
  version: string;
  hostname: string;
  username: string;
  memory: {
    total: number;
    free: number;
    used: number;
  };
  cpu: {
    model: string;
    cores: number;
    usage: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
  };
  processes?: ProcessInfo[]; // 添加进程列表
}

export interface ProcessInfo {
  pid: number;
  name: string;
  executablePath: string;
  commandLine: string;
  memoryUsage: number;
  cpuUsage: number;
  startTime: Date;
  windowTitle?: string;
}

export interface NetworkInfo {
  interfaces: Array<{
    name: string;
    ip: string;
    mac: string;
    type: string;
  }>;
  activeConnections: Array<{
    protocol: string;
    localAddress: string;
    localPort: number;
    remoteAddress?: string;
    remotePort?: number;
    state: string;
  }>;
}

export interface ScreenshotOptions {
  format?: 'png' | 'jpg' | 'bmp';
  quality?: number;
  width?: number;
  height?: number;
  displayId?: number;
}

export interface ScreenshotResult {
  success: boolean;
  data?: Buffer;
  width?: number;
  height?: number;
  error?: string;
}

export interface PermissionResult {
  granted: boolean;
  canRequest: boolean;
  error?: string;
}

export interface ActivityData {
  timestamp: Date;
  activeWindow?: {
    title: string;
    application: string;
    pid: number;
  };
  keystrokes?: number;
  mouseClicks?: number;
  mouseMovements?: number;
  idleTime?: number;
}

/**
 * 平台特定功能接口
 */
export interface IPlatformAdapter {
  /**
   * 初始化平台适配器
   */
  initialize(): Promise<void>;

  /**
   * 清理资源
   */
  cleanup(): Promise<void>;

  // === 系统信息 ===
  /**
   * 获取系统信息
   */
  getSystemInfo(): Promise<SystemInfo>;

  // === 进程管理 ===
  /**
   * 获取运行中的进程列表
   */
  getRunningProcesses(): Promise<ProcessInfo[]>;

  /**
   * 获取活动窗口信息
   */
  getActiveWindow(): Promise<{
    title: string;
    application: string;
    pid: number;
  } | null>;

  // === 网络信息 ===
  /**
   * 获取网络信息
   */
  getNetworkInfo(): Promise<NetworkInfo>;

  // === 截屏功能 ===
  /**
   * 检查截屏权限
   */
  checkScreenshotPermission(): Promise<PermissionResult>;

  /**
   * 请求截屏权限
   */
  requestScreenshotPermission(): Promise<PermissionResult>;

  /**
   * 截取屏幕
   */
  takeScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;

  // === 活动监控 ===
  /**
   * 开始活动监控
   */
  startActivityMonitoring(): Promise<void>;

  /**
   * 停止活动监控
   */
  stopActivityMonitoring(): Promise<void>;

  /**
   * 获取活动数据
   */
  getActivityData(): Promise<ActivityData>;

  // === 权限管理 ===
  /**
   * 检查辅助功能权限
   */
  checkAccessibilityPermission(): Promise<PermissionResult>;

  /**
   * 请求辅助功能权限
   */
  requestAccessibilityPermission(): Promise<PermissionResult>;

  // === 自启动管理 ===
  /**
   * 检查是否已设置自启动
   */
  isAutoStartEnabled(): Promise<boolean>;

  /**
   * 设置自启动
   */
  enableAutoStart(): Promise<boolean>;

  /**
   * 禁用自启动
   */
  disableAutoStart(): Promise<boolean>;

  // === 平台特有功能 ===
  /**
   * 获取平台特有功能列表
   */
  getPlatformCapabilities(): string[];

  /**
   * 执行平台特有操作
   */
  executePlatformSpecificOperation(operation: string, params?: any): Promise<any>;

  // === 数据管理 ===
  /**
   * 数据上传成功后的回调，用于重置计数器
   * 可选方法，平台可以选择实现
   */
  onDataUploadSuccess?(): void;

  /**
   * 创建事件监听器
   * 可选方法，用于ActivityCollectorService
   */
  createEventListener?(options: { keyboard?: boolean; mouse?: boolean; idle?: boolean }): Promise<any>;
}

/**
 * 平台适配器基类
 */
export abstract class PlatformAdapterBase implements IPlatformAdapter {
  protected initialized = false;
  protected monitoringActive = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    await this.performInitialization();
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    if (this.monitoringActive) {
      await this.stopActivityMonitoring();
    }
    
    await this.performCleanup();
    this.initialized = false;
  }

  protected abstract performInitialization(): Promise<void>;
  protected abstract performCleanup(): Promise<void>;

  // 抽象方法需要子类实现
  abstract getSystemInfo(): Promise<SystemInfo>;
  abstract getRunningProcesses(): Promise<ProcessInfo[]>;
  abstract getActiveWindow(): Promise<{ title: string; application: string; pid: number } | null>;
  abstract getNetworkInfo(): Promise<NetworkInfo>;
  abstract checkScreenshotPermission(): Promise<PermissionResult>;
  abstract requestScreenshotPermission(): Promise<PermissionResult>;
  abstract takeScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  abstract startActivityMonitoring(): Promise<void>;
  abstract stopActivityMonitoring(): Promise<void>;
  abstract getActivityData(): Promise<ActivityData>;
  abstract checkAccessibilityPermission(): Promise<PermissionResult>;
  abstract requestAccessibilityPermission(): Promise<PermissionResult>;
  abstract isAutoStartEnabled(): Promise<boolean>;
  abstract enableAutoStart(): Promise<boolean>;
  abstract disableAutoStart(): Promise<boolean>;
  abstract getPlatformCapabilities(): string[];
  abstract executePlatformSpecificOperation(operation: string, params?: any): Promise<any>;

  /**
   * 检查是否已初始化
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Platform adapter not initialized. Call initialize() first.');
    }
  }
}

export default IPlatformAdapter;