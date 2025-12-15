/**
 * Update Status Interface
 *
 * Defines types and enums for update status reporting
 */

export interface UpdateStatusReport {
  deviceId: string;
  currentVersion: string;
  targetVersion?: string;
  status: UpdateStatus;
  errorMessage?: string;
  timestamp: string;
  platform: string;
  arch: string;
  metadata?: UpdateMetadata;
}

export enum UpdateStatus {
  CHECKING = 'checking',
  UPDATE_FOUND = 'update-found',
  DOWNLOADING = 'downloading',
  DOWNLOADED = 'downloaded',
  INSTALLING = 'installing',
  INSTALLED = 'installed',
  ERROR = 'error',
  SKIPPED = 'skipped',
  NO_UPDATE = 'no-update'
}

export interface UpdateMetadata {
  releaseDate?: string;
  size?: number;
  mandatory?: boolean;
  releaseNotes?: string;
  downloadSpeed?: number;
  downloadDuration?: number;
  installDuration?: number;
  previousVersion?: string;
}

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
  files?: UpdateFileInfo[];
  path?: string;
  sha512?: string;
  releaseName?: string;
  releaseNotesUrl?: string;
}

export interface UpdateFileInfo {
  url: string;
  size: number;
  sha512: string;
  isAdminRightsRequired?: boolean;
}

export interface UpdateDownloadProgress {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
}

export interface UpdateCheckResult {
  updateInfo: UpdateInfo;
  cancellationToken?: any;
  versionInfo?: any;
  downloadPromise?: Promise<string[]> | null;
}
