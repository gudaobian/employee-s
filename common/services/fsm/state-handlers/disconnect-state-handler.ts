/**
 * DISCONNECT状态处理器 - 重构版本
 * 负责处理连接断开和重连逻辑
 */

import { BaseStateHandler } from '../base-state-handler';
import { 
  DeviceState, 
  FSMContext, 
  StateHandlerResult 
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';

export class DisconnectStateHandler extends BaseStateHandler {
  private configService: IConfigService;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5秒
  private lastDisconnectReason?: string;

  constructor(configService: IConfigService) {
    super('DisconnectStateHandler', [DeviceState.DISCONNECT]);
    this.configService = configService;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      console.log('[DISCONNECT] Handling disconnect state...');
      
      this.validateContext(context);
      this.reconnectAttempts++;

      // 记录断开原因
      if (context.data?.reason) {
        this.lastDisconnectReason = context.data.reason;
      }

      console.log(`[DISCONNECT] Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      if (this.lastDisconnectReason) {
        console.log(`[DISCONNECT] Last disconnect reason: ${this.lastDisconnectReason}`);
      }

      // 执行重连前的准备工作
      await this.prepareForReconnection();

      // 尝试重新连接
      const reconnectResult = await this.attemptReconnection();

      if (reconnectResult.success) {
        console.log('[DISCONNECT] Reconnection successful');
        this.resetReconnectState();
        
        return {
          success: true,
          nextState: DeviceState.HEARTBEAT,
          reason: 'Reconnection successful, returning to heartbeat check',
          data: {
            reconnectAttempts: this.reconnectAttempts,
            reconnectTime: new Date()
          }
        };
      } else {
        // 重连失败
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('[DISCONNECT] Maximum reconnection attempts exceeded');
          return {
            success: false,
            nextState: DeviceState.ERROR,
            reason: `Reconnection failed after ${this.maxReconnectAttempts} attempts: ${reconnectResult.error}`
          };
        } else {
          // 继续重试
          const nextDelay = this.calculateReconnectDelay();
          console.log(`[DISCONNECT] Reconnection failed, will retry in ${nextDelay}ms`);
          
          return {
            success: false,
            nextState: DeviceState.DISCONNECT,
            reason: `Reconnection failed (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}): ${reconnectResult.error}`,
            retryDelay: nextDelay
          };
        }
      }

    } catch (error: any) {
      console.error('[DISCONNECT] Disconnect handling failed:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Disconnect handling failed: ${error.message}`,
        error
      };
    }
  }

  private async prepareForReconnection(): Promise<void> {
    try {
      console.log('[DISCONNECT] Preparing for reconnection...');

      // 清理任何残留的连接状态
      await this.cleanupConnectionState();

      // 等待一小段时间，避免立即重试
      if (this.reconnectAttempts > 1) {
        const waitTime = Math.min(1000 * this.reconnectAttempts, 5000);
        console.log(`[DISCONNECT] Waiting ${waitTime}ms before reconnection attempt...`);
        await this.sleep(waitTime);
      }

      console.log('[DISCONNECT] Preparation completed');
    } catch (error: any) {
      console.warn('[DISCONNECT] Preparation failed:', error);
      // 不抛出错误，继续重连尝试
    }
  }

  private async cleanupConnectionState(): Promise<void> {
    try {
      console.log('[DISCONNECT] Cleaning up connection state...');

      // 这里可以清理任何连接相关的资源
      // 例如：关闭WebSocket连接、清理缓存、停止定时器等
      
      // 模拟清理操作
      await this.sleep(100);

      console.log('[DISCONNECT] Connection state cleanup completed');
    } catch (error: any) {
      console.warn('[DISCONNECT] Cleanup failed:', error);
    }
  }

  private async attemptReconnection(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      console.log('[DISCONNECT] Attempting reconnection...');

      const config = this.configService.getConfig();
      if (!config.serverUrl) {
        return {
          success: false,
          error: 'Server URL not configured'
        };
      }

      // 执行连接测试
      const connectionResult = await this.testServerConnection(config.serverUrl);

      if (connectionResult.success) {
        console.log('[DISCONNECT] Server connection test successful');

        // 验证设备状态
        if (config.deviceId) {
          const deviceResult = await this.verifyDeviceStatus(config.serverUrl, config.deviceId);
          
          if (deviceResult.success) {
            console.log('[DISCONNECT] Device status verification successful');
            return { success: true };
          } else {
            return {
              success: false,
              error: `Device verification failed: ${deviceResult.error}`
            };
          }
        } else {
          // 没有设备ID，需要重新注册
          console.log('[DISCONNECT] No device ID, will need to register');
          return { success: true }; // 让状态机处理注册流程
        }
      } else {
        return {
          success: false,
          error: `Server connection test failed: ${connectionResult.error}`
        };
      }

    } catch (error: any) {
      console.error('[DISCONNECT] Reconnection attempt failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async testServerConnection(serverUrl: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      console.log(`[DISCONNECT] Testing server connection: ${serverUrl}`);

      const testUrl = this.buildConnectionTestUrl(serverUrl);
      const response = await this.makeHttpRequest(testUrl, {
        method: 'GET',
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        }
      });

      if (response.ok) {
        console.log('[DISCONNECT] Server connection test passed');
        return { success: true };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

    } catch (error: any) {
      console.error('[DISCONNECT] Server connection test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async verifyDeviceStatus(serverUrl: string, deviceId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      console.log(`[DISCONNECT] Verifying device status: ${deviceId.substring(0, 8)}...`);

      // 使用心跳接口进行设备状态验证（心跳接口不需要认证，更适合重连场景）
      const heartbeatUrl = `${serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl}/api/device/heartbeat`;
      const response = await this.makeHttpRequest(heartbeatUrl, {
        method: 'POST',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        },
        body: JSON.stringify({
          deviceId,
          timestamp: new Date().toISOString(),
          status: 'online'
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[DISCONNECT] Device status verification completed');

        // 心跳成功即表示设备有效
        if (data.success) {
          return { success: true };
        } else {
          return {
            success: false,
            error: 'Device heartbeat failed'
          };
        }
      } else if (response.status === 404) {
        return {
          success: false,
          error: 'Device not found on server'
        };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

    } catch (error: any) {
      console.error('[DISCONNECT] Device status verification failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private buildConnectionTestUrl(serverUrl: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      return `${baseUrl}/api/health`;
    } catch (error: any) {
      throw new Error(`Failed to build connection test URL: ${error.message}`);
    }
  }

  private buildDeviceStatusUrl(serverUrl: string, deviceId: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      const encodedDeviceId = encodeURIComponent(deviceId);
      return `${baseUrl}/api/device/status?deviceId=${encodedDeviceId}`;
    } catch (error: any) {
      throw new Error(`Failed to build device status URL: ${error.message}`);
    }
  }

  private calculateReconnectDelay(): number {
    // 指数退避算法：延迟时间随重试次数增加
    const baseDelay = this.reconnectDelay;
    const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    const maxDelay = 60000; // 最大1分钟
    
    return Math.min(exponentialDelay, maxDelay);
  }

  private resetReconnectState(): void {
    this.reconnectAttempts = 0;
    this.lastDisconnectReason = undefined;
    console.log('[DISCONNECT] Reconnect state reset');
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
      const httpModule = isHttps ? require('https') : require('http');

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

      // 如果有 body，写入请求体
      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  protected async onEnter(context: FSMContext): Promise<void> {
    console.log('[DISCONNECT] Entering disconnect state');
    
    if (context.data?.reason) {
      console.log(`[DISCONNECT] Disconnect reason: ${context.data.reason}`);
    }
  }

  protected async onExit(context: FSMContext): Promise<void> {
    console.log('[DISCONNECT] Exiting disconnect state');
    
    // 注意：FSMContext没有nextState属性，这里可以通过其他方式判断
    console.log('[DISCONNECT] Exit completed, state machine will handle transition');
  }

  // 提供获取重连状态的方法
  getReconnectStatus(): {
    attempts: number;
    maxAttempts: number;
    nextRetryIn: number;
    lastReason?: string;
  } {
    return {
      attempts: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      nextRetryIn: this.calculateReconnectDelay(),
      lastReason: this.lastDisconnectReason
    };
  }

  // 允许手动重置重连状态
  resetReconnectionAttempts(): void {
    this.resetReconnectState();
    console.log('[DISCONNECT] Reconnection attempts manually reset');
  }
}