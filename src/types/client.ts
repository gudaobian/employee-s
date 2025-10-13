// ===== 客户端专用类型定义 =====

// 客户端配置相关
export interface ClientConfig {
  server: {
    url: string;
    apiKey?: string;
    timeout: number;
    retryInterval: number;
    maxRetries: number;
  };
  monitoring: {
    screenshotInterval: number;
    activityInterval: number;
    processScanInterval: number;
    enableScreenshot: boolean;
    enableActivity: boolean;
    enableProcess: boolean;
    enableSmartDetection: boolean;
  };
  privacy: {
    blurSensitiveWindows: boolean;
    excludedApplications: string[];
    excludedDomains: string[];
    enableSmartBlur: boolean;
    privacyKeywords: string[];
  };
  storage: {
    offlineQueueSize: number;
    compressionQuality: number;
    maxFileSize: number;
    retentionDays: number;
  };
  security: {
    encryptData: boolean;
    requireAuth: boolean;
    certificateValidation: boolean;
  };
}

// 设备信息相关
export interface DeviceInfo {
  deviceId: string;
  hostname: string;
  platform: NodeJS.Platform;
  os: string;
  osVersion: string;
  cpuInfo: {
    model: string;
    cores: number;
    speed: number;
  };
  memory: {
    total: number;
    available: number;
  };
  displays: Array<{
    id: number;
    width: number;
    height: number;
    isPrimary: boolean;
  }>;
  networkInterfaces: Array<{
    name: string;
    address: string;
    type: 'IPv4' | 'IPv6';
  }>;
}

// 认证相关
export interface AuthCredentials {
  email: string;
  password: string;
  deviceId: string;
}

export interface AuthToken {
  token: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  token: AuthToken | null;
  deviceBound: boolean;
  userId?: string;
  lastAuth?: number;
}

// 活动监控相关
export interface ActivityData {
  deviceId: string;
  sessionId: string;
  timestamp: Date;
  isActive: boolean;
  idleTime: number;
  keystrokes?: number;
  mouseClicks?: number;
  mouseMovement?: number;
  scrollEvents?: number;
  activeWindow?: WindowInfo;
  systemMetrics?: SystemMetrics;
}

export interface WindowInfo {
  process: string;
  title: string;
  pid: number;
  executable?: string;
  className?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkActivity: {
    bytesReceived: number;
    bytesSent: number;
  };
  batteryLevel?: number;
  isPluggedIn?: boolean;
}

// 进程监控相关
export interface ProcessInfo {
  name: string;
  executable: string;
  pid: number;
  windowTitle: string;
  startTime: Date;
  cpuUsage?: number;
  memoryUsage?: number;
  isVisible: boolean;
  category?: 'productive' | 'neutral' | 'unproductive';
}

export interface ProcessUsageData {
  deviceId: string;
  sessionId: string;
  timestamp: Date;
  processes: ProcessInfo[];
  activeProcess?: ProcessInfo;
  systemUsage: SystemMetrics;
  durationSeconds: number;
}

// 截图相关
export interface ScreenshotConfig {
  quality: number;
  format: 'jpeg' | 'png';
  maxWidth?: number;
  maxHeight?: number;
  enableCompression: boolean;
  blurSensitive: boolean;
  excludeWindows: string[];
}

export interface ScreenshotData {
  deviceId: string;
  sessionId: string;
  timestamp: Date;
  data: Buffer;
  metadata: {
    originalSize: number;
    compressedSize: number;
    resolution: {
      width: number;
      height: number;
    };
    format: string;
    quality: number;
    isBlurred: boolean;
    blurScore?: number;
    activeWindow?: WindowInfo;
    displays: Array<{
      id: number;
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }>;
  };
}

// 心跳和状态相关
export interface HeartbeatData {
  deviceId: string;
  timestamp: Date;
  status: 'active' | 'idle' | 'offline';
  systemInfo: SystemMetrics;
  appVersion: string;
  uptime: number;
}

export interface DeviceStatus {
  isOnline: boolean;
  lastHeartbeat: Date;
  status: 'active' | 'idle' | 'offline' | 'error';
  connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected';
  errorMessage?: string;
}

// 数据传输相关
export interface DataPacket {
  id: string;
  type: 'activity' | 'screenshot' | 'process' | 'heartbeat';
  deviceId: string;
  timestamp: Date;
  data: any;
  checksum: string;
  encrypted: boolean;
  compressed: boolean;
  retryCount: number;
}

export interface UploadProgress {
  packetId: string;
  type: DataPacket['type'];
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
  startTime: Date;
  endTime?: Date;
}

export interface SyncStatus {
  lastSync: Date;
  pendingUploads: number;
  failedUploads: number;
  totalUploaded: number;
  uploadProgress: UploadProgress[];
  isOnline: boolean;
  nextSyncTime?: Date;
}

// 事件系统相关
export interface ClientEvent {
  type: string;
  data: any;
  timestamp: Date;
  source: string;
}

export interface EventHandler<T = any> {
  (event: ClientEvent & { data: T }): void | Promise<void>;
}

export interface EventSubscription {
  id: string;
  type: string;
  handler: EventHandler;
  once: boolean;
}

// 存储相关
export interface StorageItem<T = any> {
  key: string;
  data: T;
  createdAt: Date;
  expiresAt?: Date;
  encrypted: boolean;
}

export interface OfflineQueueItem {
  id: string;
  packet: DataPacket;
  attempts: number;
  lastAttempt: Date;
  nextAttempt: Date;
  priority: 'low' | 'normal' | 'high';
}

// 智能检测相关
export interface ActivityPattern {
  name: string;
  confidence: number;
  triggers: string[];
  weight: number;
  description: string;
}

export interface SmartDetectionResult {
  isActive: boolean;
  confidence: number;
  activePatterns: ActivityPattern[];
  workMode: 'coding' | 'meeting' | 'research' | 'design' | 'idle' | 'unknown';
  recommendedBreak: boolean;
  insights: string[];
}

// 隐私保护相关
export interface PrivacyRule {
  id: string;
  name: string;
  type: 'window-title' | 'process-name' | 'url-pattern' | 'keyword';
  pattern: string;
  action: 'blur' | 'skip' | 'anonymize';
  enabled: boolean;
}

export interface BlurDetectionResult {
  isBlurred: boolean;
  blurScore: number;
  method: 'automatic' | 'manual' | 'rule-based';
  rules: PrivacyRule[];
  sensitive: boolean;
}

// 状态机相关
export interface FSMState {
  name: string;
  description: string;
  canTransitionTo: string[];
  onEnter?: () => void | Promise<void>;
  onExit?: () => void | Promise<void>;
  onUpdate?: () => void | Promise<void>;
}

export interface FSMTransition {
  from: string;
  to: string;
  trigger: string;
  condition?: () => boolean | Promise<boolean>;
  action?: () => void | Promise<void>;
}

export interface ClientState {
  current: string;
  previous?: string;
  data: Record<string, any>;
  lastTransition: Date;
  transitionHistory: Array<{
    from: string;
    to: string;
    trigger: string;
    timestamp: Date;
  }>;
}

// 平台适配相关
export interface PlatformAdapter {
  platform: NodeJS.Platform;
  getSystemInfo(): Promise<DeviceInfo>;
  getActiveWindow(): Promise<WindowInfo | null>;
  getRunningProcesses(): Promise<ProcessInfo[]>;
  captureScreenshot(config: ScreenshotConfig): Promise<ScreenshotData>;
  detectUserActivity(): Promise<boolean>;
  getSystemMetrics(): Promise<SystemMetrics>;
  registerHotkeys?(hotkeys: HotkeyConfig[]): Promise<void>;
  unregisterHotkeys?(): Promise<void>;
}

export interface HotkeyConfig {
  keys: string[];
  action: string;
  description: string;
  global: boolean;
}

// 网络相关
export interface NetworkConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
  headers: Record<string, string>;
  proxy?: {
    host: string;
    port: number;
    auth?: {
      username: string;
      password: string;
    };
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

export interface WebSocketConfig {
  url: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  protocols?: string[];
  headers?: Record<string, string>;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  id?: string;
  timestamp: Date;
}

// 日志相关
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  timestamp: Date;
  category: string;
  metadata?: Record<string, any>;
  error?: Error;
}

export interface LogConfig {
  level: LogEntry['level'];
  outputToFile: boolean;
  outputToConsole: boolean;
  maxFileSize: number;
  maxFiles: number;
  logDirectory: string;
  categories: string[];
}

// 更新相关
export interface UpdateInfo {
  version: string;
  releaseDate: string;
  changelog: string[];
  downloadUrl: string;
  fileSize: number;
  checksum: string;
  mandatory: boolean;
}

export interface UpdateProgress {
  phase: 'checking' | 'downloading' | 'installing' | 'completed' | 'error';
  progress: number;
  currentFile?: string;
  error?: string;
  estimatedTimeRemaining?: number;
}

// 性能监控相关
export interface PerformanceMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    temperature?: number;
  };
  memory: {
    used: number;
    available: number;
    percentage: number;
  };
  disk: {
    usage: number;
    readSpeed: number;
    writeSpeed: number;
  };
  network: {
    uploadSpeed: number;
    downloadSpeed: number;
    latency: number;
  };
  application: {
    memoryUsage: number;
    cpuUsage: number;
    threadCount: number;
    handleCount?: number;
  };
}

// 错误处理相关
export interface ClientError {
  code: string;
  message: string;
  category: 'network' | 'auth' | 'storage' | 'system' | 'permission' | 'config';
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  context?: Record<string, any>;
  stack?: string;
  recoverable: boolean;
}

export interface ErrorHandler {
  handle(error: ClientError): Promise<void>;
  canHandle(error: ClientError): boolean;
  priority: number;
}

// 插件系统相关
export interface Plugin {
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  config?: Record<string, any>;
  hooks: PluginHooks;
}

export interface PluginHooks {
  onStart?: () => Promise<void>;
  onStop?: () => Promise<void>;
  onActivityDetected?: (activity: ActivityData) => Promise<ActivityData>;
  onScreenshotTaken?: (screenshot: ScreenshotData) => Promise<ScreenshotData>;
  onDataUpload?: (packet: DataPacket) => Promise<DataPacket>;
  onConfigChange?: (config: ClientConfig) => Promise<void>;
}

// 类型守卫函数
export function isApiResponse<T>(obj: any): obj is ApiResponse<T> {
  return obj && typeof obj.success === 'boolean';
}

export function isDeviceInfo(obj: any): obj is DeviceInfo {
  return obj && typeof obj.deviceId === 'string' && typeof obj.hostname === 'string';
}

export function isActivityData(obj: any): obj is ActivityData {
  return obj && typeof obj.deviceId === 'string' && typeof obj.isActive === 'boolean';
}

export function isProcessInfo(obj: any): obj is ProcessInfo {
  return obj && typeof obj.name === 'string' && typeof obj.pid === 'number';
}

export function isScreenshotData(obj: any): obj is ScreenshotData {
  return obj && typeof obj.deviceId === 'string' && obj.data instanceof Buffer;
}

export function isClientError(obj: any): obj is ClientError {
  return obj && typeof obj.code === 'string' && typeof obj.message === 'string';
}