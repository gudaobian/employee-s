/**
 * Update API Client
 *
 * Handles communication with the update server API
 * - Check for updates
 * - Report update status
 * - Upload diagnostic logs
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

export interface UpdateCheckResponse {
  available: boolean;
  version?: string;
  releaseNotes?: string;
  releaseDate?: string;
  downloadUrl?: string;
  sha512?: string;
  mandatory?: boolean;
  size?: number;
}

export interface UpdateStatusReport {
  deviceId: string;
  currentVersion: string;
  targetVersion?: string;
  status: string;
  errorMessage?: string;
  timestamp: string;
  platform: string;
  arch: string;
  metadata?: Record<string, any>;
}

export interface DiagnosticReport {
  deviceId: string;
  version: string;
  platform: string;
  logs: string;
  errorContext?: string;
  timestamp: string;
}

export class UpdateApiClient {
  private client: AxiosInstance;
  private baseURL: string;
  private appVersion: string;

  constructor(baseURL: string, appVersion: string) {
    this.baseURL = baseURL;
    this.appVersion = appVersion;

    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': appVersion,
        'X-Platform': process.platform,
        'X-Arch': process.arch
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        this.handleApiError(error);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(channel?: string): Promise<UpdateCheckResponse> {
    try {
      const response = await this.client.get<UpdateCheckResponse>('/check-update', {
        params: {
          currentVersion: this.appVersion,
          platform: process.platform,
          arch: process.arch,
          channel: channel || 'stable'
        }
      });

      return response.data;
    } catch (error) {
      throw this.enrichError(error, 'Failed to check for updates');
    }
  }

  /**
   * Report update status to server
   */
  async reportUpdateStatus(report: UpdateStatusReport): Promise<void> {
    try {
      await this.client.post('/report-status', report);
    } catch (error) {
      // Don't throw on status report failures to avoid breaking update flow
      console.error('Failed to report update status:', error);
    }
  }

  /**
   * Upload diagnostic logs
   */
  async uploadDiagnosticLogs(report: DiagnosticReport): Promise<void> {
    try {
      await this.client.post('/upload-logs', report);
    } catch (error) {
      console.error('Failed to upload diagnostic logs:', error);
      throw this.enrichError(error, 'Failed to upload diagnostic logs');
    }
  }

  /**
   * Get update release notes
   */
  async getReleaseNotes(version: string): Promise<string> {
    try {
      const response = await this.client.get<{ releaseNotes: string }>(
        '/release-notes',
        {
          params: { version }
        }
      );

      return response.data.releaseNotes || 'No release notes available';
    } catch (error) {
      console.error('Failed to get release notes:', error);
      return 'Release notes unavailable';
    }
  }

  /**
   * Handle API errors
   */
  private handleApiError(error: AxiosError): void {
    if (error.response) {
      // Server responded with error status
      console.error('Update API Error:', {
        status: error.response.status,
        data: error.response.data
      });
    } else if (error.request) {
      // Request made but no response received
      console.error('Update API Network Error:', error.message);
    } else {
      // Error setting up the request
      console.error('Update API Request Error:', error.message);
    }
  }

  /**
   * Enrich error with context
   */
  private enrichError(error: any, context: string): Error {
    const message = error.response?.data?.message || error.message || 'Unknown error';
    return new Error(`${context}: ${message}`);
  }

  /**
   * Update base URL
   */
  setBaseURL(url: string): void {
    this.baseURL = url;
    this.client.defaults.baseURL = url;
  }

  /**
   * Get current base URL
   */
  getBaseURL(): string {
    return this.baseURL;
  }
}
