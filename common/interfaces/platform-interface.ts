/**
 * 平台适配器统一接口定义
 * 定义跨平台功能的标准接口
 */

export interface IPlatformAdapter {
  // 生命周期管理
  initialize?(): Promise<void>;
  cleanup(): Promise<void>;
  
  // 截图服务
  takeScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  captureWindow(windowId: string): Promise<ScreenshotResult>;
  
  // 权限管理
  checkPermissions(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  
  // 系统信息
  getSystemInfo(): Promise<SystemInfo>;
  getProcessList(): Promise<ProcessInfo[]>;
  
  // 活动监控
  getActiveWindow(): Promise<WindowInfo>;
  startWindowMonitoring(callback: (window: WindowInfo) => void): void;
  stopWindowMonitoring(): void;
  createEventListener?(options: any): Promise<any>;
  
  // 数据收集
  collectMonitoringData(): Promise<any>;
  
  // 计数器管理
  onDataUploadSuccess?(): void; // 数据上传成功后重置计数器
  
  // 平台特定功能
  getPlatformSpecificCapabilities(): PlatformCapabilities;
}

export interface ScreenshotOptions {
  format?: 'png' | 'jpg' | 'bmp';
  quality?: number;
  screen?: number;
}

export interface ScreenshotResult {
  success: boolean;
  data?: Buffer;
  width?: number;
  height?: number;
  format?: string;
  timestamp?: number;
  error?: string;
}

export interface PermissionStatus {
  screenshot: boolean;
  accessibility: boolean;
  systemInfo: boolean;
  microphone?: boolean;
  camera?: boolean;
}

export interface SystemInfo {
  platform: string;
  hostname: string;
  username: string;
  osVersion: string;
  memory: number;
  cpu: string;
  deviceId: string;
  ipAddress?: string;
  macAddress?: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuUsage: number;
  memoryUsage: number;
  command?: string;
}

export interface WindowInfo {
  id: string;
  title: string;
  processName: string;
  processId: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;
}

export interface PlatformCapabilities {
  supportsScreenshot: boolean;
  supportsWindowMonitoring: boolean;
  supportsSystemInfo: boolean;
  nativePermissionRequired: boolean;
  supportedScreenshotFormats: string[];
  hasNativeAPI: boolean;
}