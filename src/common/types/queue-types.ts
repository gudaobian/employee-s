/**
 * 队列系统类型定义
 *
 * 架构说明：
 * - 内存队列：容量5，快速访问，FIFO策略
 * - 磁盘队列：无限容量，持久化存储，按时间排序
 * - 上传循环：队列出→上传→成功→磁盘入→删除文件
 */

/**
 * 队列项目基础接口
 */
export interface QueueItem {
  id: string;                // 唯一标识符
  timestamp: number;         // 创建时间戳
  type: 'screenshot' | 'activity' | 'process';  // 数据类型
}

/**
 * 截图队列项目
 */
export interface ScreenshotQueueItem extends QueueItem {
  type: 'screenshot';
  buffer: string;            // Base64 编码的图片数据
  fileSize: number;          // 原始文件大小（字节）
  format: 'jpg' | 'png';     // 图片格式
  quality: number;           // JPEG 质量 (1-100)
  resolution: {
    width: number;
    height: number;
  };
}

/**
 * 活动数据队列项目
 */
export interface ActivityQueueItem extends QueueItem {
  type: 'activity';
  data: {
    deviceId: string;
    timestamp: number;
    activityInterval?: {
      start: number;
      end: number;
      duration: number;
    };
    activeTime?: number;
    idleTime?: number;
    mouseClicks?: number;
    keystrokes?: number;
    applications?: any[];
    urls?: any[];
    [key: string]: any;      // 其他活动数据
  };
}

/**
 * 进程数据队列项目
 */
export interface ProcessQueueItem extends QueueItem {
  type: 'process';
  data: {
    deviceId: string;
    timestamp: number;
    processes: Array<{
      name: string;
      pid: number;
      cpu?: number;
      memory?: number;
      [key: string]: any;
    }>;
    [key: string]: any;
  };
}

/**
 * 通用队列项目类型
 */
export type AnyQueueItem = ScreenshotQueueItem | ActivityQueueItem | ProcessQueueItem;

/**
 * 磁盘文件元数据
 */
export interface DiskFileMetadata {
  id: string;
  timestamp: number;
  type: 'screenshot' | 'activity' | 'process';
  filePath: string;         // 数据文件路径
  metaPath?: string;        // 元数据文件路径（仅截图）
  fileSize: number;         // 文件大小
  uploadStatus: 'pending' | 'uploading' | 'success' | 'failed';
  uploadAttempts: number;   // 上传尝试次数
  lastUploadAttempt: number | null;  // 最后上传尝试时间
  createdAt: number;        // 创建时间
}

/**
 * 队列统计信息
 */
export interface QueueStats {
  memory: number;           // 内存队列项目数
  disk: number;             // 磁盘队列项目数
  memorySize: number;       // 内存队列占用字节数
  diskSize: number;         // 磁盘队列占用字节数
}

/**
 * 上传结果
 */
export interface UploadResult {
  success: boolean;
  itemId: string;
  error?: string;
  duration?: number;        // 上传耗时（毫秒）
}

/**
 * 磁盘队列配置
 */
export interface DiskQueueConfig {
  baseDir: string;          // 缓存根目录
  maxAge?: number;          // 最大保留时间（毫秒），默认7天
  maxSize?: number;         // 最大磁盘占用（字节），默认50GB
  cleanupInterval?: number; // 清理间隔（毫秒），默认1小时
}

/**
 * 有界队列配置
 */
export interface BoundedQueueConfig {
  capacity: number;         // 队列容量，默认5
  type: 'screenshot' | 'activity' | 'process';
  diskManager: any;         // DiskQueueManager 实例
}

/**
 * 上传管理器配置
 */
export interface UploadManagerConfig {
  screenshotQueue: any;     // BoundedQueue<ScreenshotQueueItem>
  activityQueue: any;       // BoundedQueue<ActivityQueueItem>
  processQueue: any;        // BoundedQueue<ProcessQueueItem>
  websocketService: any;    // WebSocket 服务实例
  retryDelay?: number;      // 重试延迟（毫秒），默认5秒
  maxRetries?: number;      // 最大重试次数，默认3次
  concurrency?: number;     // 并发上传数，默认1（串行）
}
