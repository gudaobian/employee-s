/**
 * 认证服务 - 重构版本
 * 负责设备认证和会话管理
 */

import { BaseService } from '../utils/base-service';
import { IConfigService, IAuthService, AuthResult } from '../interfaces/service-interfaces';

interface AuthSession {
  deviceId: string;
  sessionId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt: Date;
  createdAt: Date;
  lastRefresh: Date;
}

interface AuthStatus {
  isAuthenticated: boolean;
  deviceId?: string;
  sessionId?: string;
  expiresAt?: Date;
  timeToExpiry?: number;
}

export class AuthService extends BaseService implements IAuthService {
  private configService: IConfigService;
  private session?: AuthSession;
  private refreshTimer?: any;
  private isRefreshing = false;

  constructor(configService: IConfigService) {
    super();
    this.configService = configService;
  }

  async authenticate(deviceId: string, deviceInfo: any): Promise<AuthResult> {
    try {
      console.log('[AUTH] Starting authentication process...');

      const config = this.configService.getConfig();
      const targetDeviceId = deviceId || config.deviceId;
      if (!targetDeviceId) {
        console.warn('[AUTH] No device ID found, authentication skipped');
        return {
          token: '',
          expiresAt: 0,
          deviceId: '',
          isAuthenticated: false
        };
      }

      // 检查现有会话
      if (this.session && this.isSessionValid()) {
        console.log('[AUTH] Valid session exists, authentication not required');
        return {
          token: this.session.accessToken || '',
          expiresAt: this.session.expiresAt.getTime(),
          deviceId: this.session.deviceId,
          isAuthenticated: true
        };
      }

      // 执行设备认证
      const authResult = await this.performDeviceAuth(targetDeviceId, config.serverUrl);

      if (authResult.success && authResult.session) {
        this.session = authResult.session;
        this.startSessionRefresh();
        
        console.log('[AUTH] Authentication successful');
        this.emit('authenticated', {
          deviceId: this.session.deviceId,
          sessionId: this.session.sessionId
        });

        return {
          token: this.session.accessToken || '',
          expiresAt: this.session.expiresAt.getTime(),
          deviceId: this.session.deviceId,
          isAuthenticated: true
        };
      } else {
        console.error('[AUTH] Authentication failed:', authResult.error);
        this.emit('authentication-failed', authResult.error);
        return {
          token: '',
          expiresAt: 0,
          deviceId: targetDeviceId,
          isAuthenticated: false
        };
      }

    } catch (error: any) {
      console.error('[AUTH] Authentication error:', error);
      this.emit('authentication-error', error);
      return {
        token: '',
        expiresAt: 0,
        deviceId: deviceId || '',
        isAuthenticated: false
      };
    }
  }

  async logout(): Promise<void> {
    try {
      console.log('[AUTH] Logging out...');

      // 停止会话刷新
      this.stopSessionRefresh();

      // 通知服务器会话结束（如果有有效会话）
      if (this.session && this.isSessionValid()) {
        await this.revokeSession();
      }

      // 清除本地会话
      this.session = undefined;

      console.log('[AUTH] Logout completed');
      this.emit('logged-out');

    } catch (error: any) {
      console.error('[AUTH] Logout error:', error);
      this.emit('logout-error', error);
    }
  }

  isAuthenticated(): boolean {
    return this.session ? this.isSessionValid() : false;
  }

  getAuthStatus(): AuthStatus {
    if (!this.session) {
      return { isAuthenticated: false };
    }

    const isValid = this.isSessionValid();
    const timeToExpiry = isValid ? 
      Math.max(0, this.session.expiresAt.getTime() - Date.now()) : 0;

    return {
      isAuthenticated: isValid,
      deviceId: this.session.deviceId,
      sessionId: this.session.sessionId,
      expiresAt: this.session.expiresAt,
      timeToExpiry
    };
  }

  getAuthToken(): string | null {
    return this.session?.accessToken || null;
  }

  refreshToken(): Promise<string> {
    return this.refreshSession().then(success => 
      success ? (this.session?.accessToken || '') : ''
    );
  }

  getSessionId(): string | undefined {
    return this.session?.sessionId;
  }

  async refreshSession(): Promise<boolean> {
    if (!this.session || this.isRefreshing) {
      return false;
    }

    try {
      console.log('[AUTH] Refreshing session...');
      this.isRefreshing = true;

      const refreshResult = await this.performSessionRefresh();

      if (refreshResult.success && refreshResult.session) {
        this.session = refreshResult.session;
        
        console.log('[AUTH] Session refreshed successfully');
        this.emit('session-refreshed', {
          sessionId: this.session.sessionId,
          expiresAt: this.session.expiresAt
        });

        return true;
      } else {
        console.warn('[AUTH] Session refresh failed:', refreshResult.error);
        
        // 会话刷新失败，重新认证
        this.session = undefined;
        this.emit('session-expired');
        
        return false;
      }

    } catch (error: any) {
      console.error('[AUTH] Session refresh error:', error);
      this.emit('session-refresh-error', error);
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  // 私有方法

  private async performDeviceAuth(deviceId: string, serverUrl: string): Promise<{
    success: boolean;
    session?: AuthSession;
    error?: string;
  }> {
    try {
      console.log(`[AUTH] Authenticating device: ${deviceId.substring(0, 8)}...`);

      const authUrl = this.buildAuthUrl(serverUrl);
      const authData = {
        deviceId,
        timestamp: Date.now(),
        clientVersion: '1.0.0'
      };

      const response = await this.makeHttpRequest(authUrl, {
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        },
        body: JSON.stringify(authData)
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.session) {
          const session: AuthSession = {
            deviceId,
            sessionId: data.session.sessionId,
            accessToken: data.session.accessToken,
            refreshToken: data.session.refreshToken,
            expiresAt: new Date(data.session.expiresAt),
            createdAt: new Date(),
            lastRefresh: new Date()
          };

          return { success: true, session };
        } else {
          return {
            success: false,
            error: data.error || 'Authentication rejected by server'
          };
        }
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async performSessionRefresh(): Promise<{
    success: boolean;
    session?: AuthSession;
    error?: string;
  }> {
    if (!this.session) {
      return { success: false, error: 'No session to refresh' };
    }

    try {
      const config = this.configService.getConfig();
      const refreshUrl = this.buildRefreshUrl(config.serverUrl);
      
      const refreshData = {
        deviceId: this.session.deviceId,
        sessionId: this.session.sessionId,
        refreshToken: this.session.refreshToken,
        timestamp: Date.now()
      };

      const response = await this.makeHttpRequest(refreshUrl, {
        method: 'POST',
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0',
          'Authorization': this.session.accessToken ? `Bearer ${this.session.accessToken}` : ''
        },
        body: JSON.stringify(refreshData)
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.session) {
          const refreshedSession: AuthSession = {
            ...this.session,
            accessToken: data.session.accessToken,
            refreshToken: data.session.refreshToken || this.session.refreshToken,
            expiresAt: new Date(data.session.expiresAt),
            lastRefresh: new Date()
          };

          return { success: true, session: refreshedSession };
        } else {
          return {
            success: false,
            error: data.error || 'Session refresh rejected'
          };
        }
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async revokeSession(): Promise<void> {
    if (!this.session) {
      return;
    }

    try {
      console.log('[AUTH] Revoking session...');

      const config = this.configService.getConfig();
      const revokeUrl = this.buildRevokeUrl(config.serverUrl);

      const revokeData = {
        deviceId: this.session.deviceId,
        sessionId: this.session.sessionId
      };

      await this.makeHttpRequest(revokeUrl, {
        method: 'POST',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0',
          'Authorization': this.session.accessToken ? `Bearer ${this.session.accessToken}` : ''
        },
        body: JSON.stringify(revokeData)
      });

      console.log('[AUTH] Session revoked');

    } catch (error: any) {
      console.warn('[AUTH] Failed to revoke session:', error);
      // 不抛出错误，因为这不是关键操作
    }
  }

  private isSessionValid(): boolean {
    if (!this.session) {
      return false;
    }

    // 检查会话是否过期（提前5分钟）
    const bufferTime = 5 * 60 * 1000; // 5分钟
    const expiryWithBuffer = this.session.expiresAt.getTime() - bufferTime;
    
    return Date.now() < expiryWithBuffer;
  }

  private startSessionRefresh(): void {
    if (!this.session) {
      return;
    }

    this.stopSessionRefresh();

    // 计算刷新时间（过期前10分钟）
    const refreshTime = this.session.expiresAt.getTime() - Date.now() - (10 * 60 * 1000);
    const delayMs = Math.max(60000, refreshTime); // 至少1分钟后刷新

    console.log(`[AUTH] Session refresh scheduled in ${Math.round(delayMs / 1000)} seconds`);

    this.refreshTimer = setTimeout(async () => {
      const refreshSuccess = await this.refreshSession();
      
      if (refreshSuccess) {
        // 递归设置下一次刷新
        this.startSessionRefresh();
      } else {
        // 刷新失败，触发重新认证
        this.emit('session-expired');
      }
    }, delayMs);
  }

  private stopSessionRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private buildAuthUrl(serverUrl: string): string {
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    return `${baseUrl}/api/auth/device`;
  }

  private buildRefreshUrl(serverUrl: string): string {
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    return `${baseUrl}/api/auth/refresh`;
  }

  private buildRevokeUrl(serverUrl: string): string {
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    return `${baseUrl}/api/auth/revoke`;
  }

  private async makeHttpRequest(url: string, options: {
    method: string;
    timeout: number;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<any>;
  }> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const https = eval('require')('https');
      const http = eval('require')('http');
      const httpModule = isHttps ? https : http;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method,
        headers: options.headers,
        timeout: options.timeout
      };

      const req = httpModule.request(requestOptions, (res: any) => {
        let data = '';
        
        res.on('data', (chunk: any) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage || 'Unknown',
            json: async () => {
              try {
                return data ? JSON.parse(data) : {};
              } catch {
                return {};
              }
            }
          });
        });
      });

      req.on('error', (error: any) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.setTimeout(options.timeout);

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  // 清理资源
  cleanup(): void {
    this.stopSessionRefresh();
    this.removeAllListeners();
    this.session = undefined;
    console.log('[AUTH] Service cleanup completed');
  }

  // 健康检查
  healthCheck(): {
    healthy: boolean;
    details: {
      isAuthenticated: boolean;
      hasValidSession: boolean;
      timeToExpiry?: number;
      isRefreshing: boolean;
    };
  } {
    const authStatus = this.getAuthStatus();
    
    return {
      healthy: authStatus.isAuthenticated,
      details: {
        isAuthenticated: authStatus.isAuthenticated,
        hasValidSession: !!this.session,
        timeToExpiry: authStatus.timeToExpiry,
        isRefreshing: this.isRefreshing
      }
    };
  }
}