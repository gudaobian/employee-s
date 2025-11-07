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
  getActiveURL?(browserName: string, windowTitle?: string): Promise<string | null>; // 获取浏览器URL（可选，windowTitle用于匹配正确的浏览器窗口）
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
  maxWidth?: number;  // 最大宽度（用于分辨率控制）
  maxHeight?: number; // 最大高度（用于分辨率控制）
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
  application: string;  // 应用程序名（进程名） - 统一使用 application
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