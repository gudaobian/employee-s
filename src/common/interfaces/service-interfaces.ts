/**
 * 服务接口定义
 * 定义各个服务组件的标准接口
 */

export interface IConfigService {
  getConfig(): Config;
  updateConfig(config: Partial<Config>): Promise<void>;
  getDeviceId(): string;
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  validateConfig(): boolean;
  on(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): boolean;
}

export interface IAuthService {
  authenticate(deviceId: string, deviceInfo: any): Promise<AuthResult>;
  refreshToken(): Promise<string>;
  getAuthToken(): string | null;
  isAuthenticated(): boolean;
  logout(): Promise<void>;
}

export interface IDeviceInfoService {
  getDeviceInfo(level?: 'basic' | 'full'): Promise<DeviceInfo>;
  getHardwareInfo(): Promise<HardwareInfo>;
  getSystemInfo(): Promise<SystemInfo>;
  getNetworkInfo(): Promise<NetworkInfo>;
}

export interface IDataSyncService {
  initialize(config: any, auth: any, transformer: any): void;
  collectData(): Promise<MonitoringData>;
  uploadData(data: MonitoringData): Promise<void>;
  startSync(): void;
  stopSync(): void;
  addActivityData(data: InputActivityData): Promise<void>;
}

export interface IWebSocketService {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: any): Promise<void>;
  sendActivityData(activityData: any): Promise<void>;
  sendScreenshotData(screenshotData: any): Promise<void>;
  sendSystemData(systemData: any): Promise<void>;
  isConnected(): boolean;
  getConnectionState(): ConnectionState;
}

// 数据类型定义
export interface Config {
  serverUrl: string;
  websocketUrl?: string;  // 可选，可从 URLConfigManager 自动生成
  apiVersion: string;
  timeout: number;
  retryAttempts: number;
  deviceId: string;
  authToken?: string;
  monitoring: MonitoringConfig;
  security: SecurityConfig;
  logging: LoggingConfig;
  // Activity collector 相关配置
  activityInterval?: number;
  enableActivity?: boolean;
  enableIdleDetection?: boolean;
  idleThreshold?: number;
  // WebSocket 配置同步相关字段 (从服务器接收的扁平配置)
  screenshotInterval?: number;
  processScanInterval?: number;
  enableScreenshot?: boolean;
  enableProcess?: boolean;
}

export interface MonitoringConfig {
  enableScreenshot: boolean;
  screenshotInterval: number;
  enableKeylogger: boolean;
  enableMouseTracking: boolean;
  enableAppUsage: boolean;
  workingHours: {
    start: string;
    end: string;
    timezone: string;
  };
  uploadBatchSize: number;
  retentionDays: number;
}

export interface SecurityConfig {
  encryptData: boolean;
  allowedNetworks: string[];
  restrictedApps: string[];
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  enableFile: boolean;
  enableConsole: boolean;
  logFile: string;
  maxFileSize: number;
}

export interface AuthResult {
  token: string;
  expiresAt: number;
  deviceId: string;
  isAuthenticated: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  hostname: string;
  platform: string;
  platformVersion: string;
  username: string;
  ipAddress?: string;
  macAddress?: string;
  cpuModel?: string;
  totalMemory?: number;
}

export interface HardwareInfo {
  cpuModel: string;
  cpuCores: number;
  totalMemory: number;
  diskSpace: number;
  screenResolution: string;
  macAddress: string[];
  biosSerial?: string;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  platformVersion: string;
  arch: string;
  username: string;
  userDirectory: string;
  systemUptime: number;
}

export interface NetworkInfo {
  ipAddress: string[];
  networkInterfaces: NetworkInterface[];
  defaultGateway: string;
  dnsServers: string[];
  isConnected: boolean;
}

export interface NetworkInterface {
  name: string;
  address: string;
  netmask: string;
  family: string;
  mac: string;
  internal: boolean;
}

export interface MonitoringData {
  deviceId: string;
  timestamp: number;
  screenshots?: ScreenshotData[];
  appUsage?: AppUsageData[];
  inputActivity?: InputActivityData;
  systemMetrics?: SystemMetrics;
}

export interface ScreenshotData {
  timestamp: number;
  data: Buffer | string;
  format: string;
  width: number;
  height: number;
}

export interface AppUsageData {
  appName: string;
  windowTitle: string;
  startTime: number;
  endTime: number;
  duration: number;
  isActive: boolean;
}

export interface InputActivityData {
  timestamp: string; // ISO 8601 格式时间戳
  isActive: boolean; // 是否活动状态
  keystrokes: number;
  mouseClicks: number;
  idleTime: number;
  activeWindow?: string; // 活动窗口标题
  activeWindowProcess?: string; // 活动窗口进程名
  activityInterval: number; // 活动采集间隔（毫秒）
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkIO: {
    bytesIn: number;
    bytesOut: number;
  };
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';