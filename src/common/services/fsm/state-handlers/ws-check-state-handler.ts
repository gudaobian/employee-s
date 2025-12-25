/**
 * WS_CHECK状态处理器 - 重构版本
 * 负责检查WebSocket连接状态
 *
 * 职责:
 * 1. 检查WebSocket连接状态
 * 2. WebSocket连接成功后触发启动上传
 */

import { BaseStateHandler } from '../base-state-handler';
import {
  DeviceState,
  FSMContext,
  StateHandlerResult
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';
import { StartupUploadService } from '../../startup-upload-service';
import * as path from 'path';
import * as os from 'os';

export class WSCheckStateHandler extends BaseStateHandler {
  private configService: IConfigService;

  constructor(configService: IConfigService) {
    super('WSCheckStateHandler', [DeviceState.WS_CHECK]);
    this.configService = configService;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      console.log('[WS_CHECK] Starting WebSocket connection check...');
      
      this.validateContext(context);

      const config = this.configService.getConfig();
      if (!config.deviceId) {
        return {
          success: false,
          nextState: DeviceState.REGISTER,
          reason: 'Device ID not found'
        };
      }

      // 直接构建Socket.IO WebSocket URL，跳过API调用
      const websocketUrl = this.buildSocketIOUrl(config.serverUrl);
      console.log(`[WS_CHECK] Built Socket.IO URL: ${websocketUrl}`);
      
      // 测试WebSocket连接
      const connectionResult = await this.testWebSocketConnection(websocketUrl, config.deviceId);
      if (connectionResult.success) {
        console.log('[WS_CHECK] WebSocket connection test successful');

        // ✅ WebSocket连接成功，触发启动上传
        await this.triggerStartupUpload(config, context);

        return {
          success: true,
          nextState: DeviceState.CONFIG_FETCH,
          reason: 'WebSocket connection verified',
          data: {
            websocketUrl: websocketUrl,
            connectionTime: new Date()
          }
        };
      } else {
        console.warn('[WS_CHECK] WebSocket connection test failed, but continuing to CONFIG_FETCH');
        // Socket.IO连接测试失败不影响继续流程，因为可能在实际使用时连接正常
        return {
          success: true,
          nextState: DeviceState.CONFIG_FETCH,
          reason: 'WebSocket test failed but continuing (may work in actual usage)',
          data: {
            websocketUrl: websocketUrl,
            connectionTime: new Date(),
            connectionTestFailed: true
          }
        };
      }

    } catch (error: any) {
      console.error('[WS_CHECK] WebSocket check failed:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `WebSocket check failed: ${error.message}`,
        error
      };
    }
  }

  private async getWebSocketConnectionInfo(serverUrl: string, deviceId: string): Promise<{
    success: boolean;
    websocketUrl?: string;
    error?: string;
  }> {
    try {
      console.log('[WS_CHECK] Getting WebSocket connection information...');

      const wsInfoUrl = this.buildWebSocketInfoUrl(serverUrl, deviceId);
      const response = await this.sendWebSocketInfoRequest(wsInfoUrl);

      if (response.success && response.data) {
        const websocketUrl = response.data.websocketUrl || this.buildDefaultWebSocketUrl(serverUrl);
        
        return {
          success: true,
          websocketUrl
        };
      } else {
        return {
          success: false,
          error: response.error || 'Failed to get WebSocket info'
        };
      }

    } catch (error: any) {
      console.error('[WS_CHECK] Failed to get WebSocket connection info:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private buildWebSocketInfoUrl(serverUrl: string, deviceId: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      const encodedDeviceId = encodeURIComponent(deviceId);
      return `${baseUrl}/api/device/websocket-info?deviceId=${encodedDeviceId}`;
    } catch (error: any) {
      throw new Error(`Failed to build WebSocket info URL: ${error.message}`);
    }
  }

  private buildSocketIOUrl(serverUrl: string): string {
    try {
      // Socket.IO 直接使用HTTP/HTTPS URL，连接到/client命名空间
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      return `${baseUrl}/client`; // Socket.IO会自动处理WebSocket升级，连接到/client命名空间
    } catch (error: any) {
      throw new Error(`Failed to build Socket.IO URL: ${error.message}`);
    }
  }

  private buildDefaultWebSocketUrl(serverUrl: string): string {
    try {
      const url = new URL(serverUrl);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${url.host}/ws`;
    } catch (error: any) {
      throw new Error(`Failed to build default WebSocket URL: ${error.message}`);
    }
  }

  private async sendWebSocketInfoRequest(url: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      console.log(`[WS_CHECK] Sending request to: ${url}`);

      const response = await this.makeHttpRequest(url, {
        method: 'GET',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        }
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          data: data.data || data
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error: any) {
      console.error('[WS_CHECK] WebSocket info request failed:', error);
      throw error;
    }
  }

  private async testWebSocketConnection(websocketUrl: string, deviceId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      console.log(`[WS_CHECK] Testing WebSocket connection to: ${websocketUrl}`);

      // 简单的WebSocket连接测试
      const connectionResult = await this.performWebSocketTest(websocketUrl, deviceId);

      if (connectionResult.connected) {
        console.log('[WS_CHECK] WebSocket connection test successful');
        return { success: true };
      } else {
        return {
          success: false,
          error: connectionResult.error || 'Connection test failed'
        };
      }

    } catch (error: any) {
      console.error('[WS_CHECK] WebSocket connection test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async performWebSocketTest(websocketUrl: string, deviceId: string): Promise<{
    connected: boolean;
    error?: string;
  }> {
    return new Promise((resolve) => {
      try {
        // 检查Socket.IO客户端模块是否可用
        let io: any;
        try {
          io = require('socket.io-client');
        } catch {
          // 如果socket.io-client模块不可用，尝试使用普通WebSocket
          console.warn('[WS_CHECK] Socket.IO client not available, trying plain WebSocket test');
          try {
            const WebSocket = require('ws');
            // 构建WebSocket URL
            const url = new URL(websocketUrl);
            const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${url.host}/socket.io/?EIO=4&transport=websocket`;
            
            const ws = new WebSocket(wsUrl);
            const timeout = setTimeout(() => {
              ws.close();
              resolve({ connected: false, error: 'Connection timeout' });
            }, 3000);
            
            ws.on('open', () => {
              clearTimeout(timeout);
              ws.close();
              resolve({ connected: true });
            });
            
            ws.on('error', (error: any) => {
              clearTimeout(timeout);
              resolve({ connected: false, error: error.message });
            });
            
            return;
          } catch {
            // 如果所有WebSocket库都不可用，返回成功（跳过测试）
            console.warn('[WS_CHECK] No WebSocket libraries available, assuming connection works');
            resolve({ connected: true });
            return;
          }
        }
        
        // 使用Socket.IO客户端进行连接测试
        const socket = io(websocketUrl, {
          timeout: 3000,
          autoConnect: false,
          reconnection: false,
          auth: {
            deviceId: deviceId,
            // token 是可选的，设备可以无token连接
            token: undefined
          }
        });
        
        const timeout = setTimeout(() => {
          socket.disconnect();
          resolve({
            connected: false,
            error: 'Socket.IO connection timeout'
          });
        }, 3000);
        
        socket.on('connect', () => {
          clearTimeout(timeout);
          console.log('[WS_CHECK] Socket.IO connection opened successfully');
          
          // 发送测试消息
          socket.emit('connection_test', {
            deviceId: deviceId,
            timestamp: Date.now()
          });
          
          socket.disconnect();
          resolve({ connected: true });
        });
        
        socket.on('connect_error', (error: any) => {
          clearTimeout(timeout);
          console.error('[WS_CHECK] Socket.IO connection error:', error);
          resolve({
            connected: false,
            error: error.message
          });
        });
        
        socket.connect();
      } catch (error: any) {
        console.error('[WS_CHECK] Socket.IO test setup failed:', error);
        resolve({
          connected: false,
          error: error.message
        });
      }
    });
  }

  private async makeHttpRequest(url: string, options: {
    method: string;
    timeout: number;
    headers: Record<string, string>;
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
      req.end();
    });
  }

  protected async onEnter(context: FSMContext): Promise<void> {
    console.log('[WS_CHECK] Entering WebSocket check state');
  }

  protected async onExit(context: FSMContext): Promise<void> {
    console.log('[WS_CHECK] Exiting WebSocket check state');
  }

  /**
   * 触发启动上传
   * WebSocket连接成功后调用，非阻塞执行
   */
  private async triggerStartupUpload(config: any, context: FSMContext): Promise<void> {
    try {
      console.log('[WS_CHECK] 触发启动上传检查...');

      // 获取队列缓存目录
      const queueCacheDir = this.getQueueCacheDir();

      // 创建上传服务
      const uploadService = new StartupUploadService({
        apiEndpoint: `${config.serverUrl}/api/startup-upload`,
        deviceId: config.deviceId,
        sessionId: (context.data?.sessionId as string) || `session_${Date.now()}`,
        queueCacheDir
      });

      // 非阻塞执行上传（不等待结果）
      uploadService.checkAndUpload().then(() => {
        console.log('[WS_CHECK] 启动上传完成');
      }).catch((error: any) => {
        // 上传失败不影响主流程
        console.error('[WS_CHECK] 启动上传失败', {
          error: error.message,
          stack: error.stack
        });
      });

    } catch (error: any) {
      // 启动上传失败不影响主流程
      console.error('[WS_CHECK] 触发启动上传失败', {
        error: error.message
      });
    }
  }

  /**
   * 获取队列缓存目录
   */
  private getQueueCacheDir(): string {
    try {
      // 使用 userData 目录
      const { app } = require('electron');
      const userDataPath = app.getPath('userData');
      return path.join(userDataPath, 'queue-cache');
    } catch (error) {
      // 如果 app.getPath 不可用（非 Electron 环境），使用临时目录
      const tempDir = os.tmpdir();
      return path.join(tempDir, 'employee-monitor-cache');
    }
  }
}