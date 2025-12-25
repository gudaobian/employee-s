/**
 * 热更新类型定义
 */

/**
 * 热更新清单
 */
export interface HotUpdateManifest {
  version: string;               // 目标版本号
  diffUrl: string;               // 差异包下载URL
  diffSha512: string;            // SHA512校验值
  diffSize: number;              // 差异包大小(字节)
  changedFilesCount: number;     // 修改文件数
  deletedFilesCount: number;     // 删除文件数
  releaseNotes?: string;         // 更新说明
  requiresRestart: boolean;      // 是否需要重启
  fallbackFullUrl?: string;      // 完整更新包URL(兜底)
}

/**
 * 差异包清单
 */
export interface DiffManifest {
  version: string;
  fromVersion: string;
  toVersion: string;
  added: string[];               // 新增文件路径列表
  changed: string[];             // 变更文件路径列表
  deleted: string[];             // 删除文件路径列表
  timestamp: string;
}

/**
 * 版本变更类型
 */
export type VersionChangeType = 'major' | 'minor' | 'patch';

/**
 * 更新检查响应
 */
export interface CheckUpdateResponse {
  hasUpdate: boolean;
  updateType?: 'full' | 'hot';
  version?: string;
  currentVersion?: string;           // 当前版本（后端新增）
  versionChangeType?: VersionChangeType; // 版本变更类型（后端新增）
  isForceUpdate?: boolean;           // 是否强制更新（后端新增）
  minVersion?: string | null;        // 最低版本要求（后端新增）
  manifest?: HotUpdateManifest;      // 直接的 manifest（兼容旧格式）
  hotUpdate?: {                      // 热更新信息（后端新格式）
    diffUrl?: string;
    manifest?: HotUpdateManifest;
  };
  downloadUrl?: string;              // 完整更新下载链接
  reason?: string;
  rolloutStatus?: 'eligible' | 'not_eligible';
}

/**
 * 上报请求
 */
export interface ReportUpdateRequest {
  deviceId: string;
  fromVersion: string;
  toVersion: string;
  platform: string;
  updateType: 'full' | 'hot' | 'hot_fallback';
  success: boolean;
  error?: string;
  fallbackReason?: string;
  downloadDuration?: number;
  installDuration?: number;
}

/**
 * 热更新事件
 */
export type HotUpdateEvent =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'download-progress'
  | 'verifying'
  | 'installing'
  | 'downloaded'
  | 'error';

/**
 * 下载进度
 */
export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}

/**
 * 热更新错误类型
 */
export enum HotUpdateError {
  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  DOWNLOAD_TIMEOUT = 'DOWNLOAD_TIMEOUT',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',

  // 校验错误
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  INVALID_PACKAGE = 'INVALID_PACKAGE',

  // 应用错误
  ASAR_EXTRACT_FAILED = 'ASAR_EXTRACT_FAILED',
  DIFF_APPLY_FAILED = 'DIFF_APPLY_FAILED',
  ASAR_PACK_FAILED = 'ASAR_PACK_FAILED',

  // 验证错误
  VERSION_MISMATCH = 'VERSION_MISMATCH',
  INTEGRITY_CHECK_FAILED = 'INTEGRITY_CHECK_FAILED',

  // 原生模块错误
  NATIVE_MODULE_CHANGE_DETECTED = 'NATIVE_MODULE_CHANGE_DETECTED',

  // 系统错误
  INSUFFICIENT_SPACE = 'INSUFFICIENT_SPACE',
  PERMISSION_DENIED = 'PERMISSION_DENIED'
}
