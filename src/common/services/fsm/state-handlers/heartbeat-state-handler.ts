/**
 * HEARTBEAT状态处理器 - 重构版本
 * 负责与服务器建立心跳连接
 */

import { BaseStateHandler } from '../base-state-handler';
import { 
  DeviceState, 
  FSMContext, 
  StateHandlerResult 
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';

export class HeartbeatStateHandler extends BaseStateHandler {
  private configService: IConfigService;
  private heartbeatAttempts = 0;

  constructor(configService: IConfigService) {
    super('HeartbeatStateHandler', [DeviceState.HEARTBEAT]);
    this.configService = configService;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      console.log('[HEARTBEAT] Starting heartbeat check...');
      
      this.validateContext(context);
      this.heartbeatAttempts++;

      // 获取服务器配置
      const config = this.configService.getConfig();
      if (!config.serverUrl) {
        throw new Error('Server URL not configured');
      }

      // 执行心跳检查
      const heartbeatResult = await this.performHeartbeatCheck(config.serverUrl);

      if (heartbeatResult.success) {
        console.log('[HEARTBEAT] Heartbeat check successful');
        console.log('[HEARTBEAT] Heartbeat result analysis:', JSON.stringify({
          deviceRegistered: heartbeatResult.deviceRegistered,
          isAssigned: heartbeatResult.isAssigned,
          canStartMonitoring: heartbeatResult.canStartMonitoring
        }));
        
        // Follow FSM design: HEARTBEAT always goes to REGISTER, 
        // but log assignment status for debugging
        console.log('[HEARTBEAT] Device assignment status for reference:');
        console.log(`  - Device registered: ${heartbeatResult.deviceRegistered}`);
        console.log(`  - Device assigned: ${heartbeatResult.isAssigned}`);
        console.log(`  - Can start monitoring: ${heartbeatResult.canStartMonitoring}`);
        
        // Always proceed to REGISTER state as per FSM design
        // REGISTER handler will make intelligent decisions based on device status
        return {
          success: true,
          nextState: DeviceState.REGISTER,
          reason: 'Heartbeat successful, proceeding to device registration check'
        };
      } else {
        // 心跳失败，但可以重试，使用递增延迟避免速率限制
        // 优化：增加重试次数和延迟时间，适应跨境网络环境
        const maxHeartbeatAttempts = 5;  // 从3次增加到5次
        if (this.heartbeatAttempts < maxHeartbeatAttempts) {
          // 递增延迟：5s, 10s, 15s, 20s, 25s（最大30s）
          const delay = Math.min(this.heartbeatAttempts * 5000, 30000);
          console.log(`[HEARTBEAT] Attempt ${this.heartbeatAttempts}/${maxHeartbeatAttempts} failed, retrying in ${delay/1000}s`);
          return {
            success: false,
            nextState: DeviceState.HEARTBEAT,
            reason: `Heartbeat failed (attempt ${this.heartbeatAttempts}/${maxHeartbeatAttempts}), retrying in ${delay/1000}s`,
            retryDelay: delay
          };
        } else {
          console.error(`[HEARTBEAT] All ${maxHeartbeatAttempts} attempts failed, transitioning to DISCONNECT`);
          return {
            success: false,
            nextState: DeviceState.DISCONNECT,
            reason: `Heartbeat failed after ${maxHeartbeatAttempts} retries`
          };
        }
      }

    } catch (error: any) {
      console.error('[HEARTBEAT] Heartbeat check failed:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Heartbeat check failed: ${error.message}`,
        error
      };
    }
  }

  private async performHeartbeatCheck(serverUrl: string): Promise<{
    success: boolean;
    deviceRegistered: boolean;
    isAssigned?: boolean;
    canStartMonitoring?: boolean;
    serverTime?: Date;
  }> {
    try {
      console.log(`[HEARTBEAT] Checking server connectivity: ${serverUrl}`);

      // 构建心跳检查URL
      const heartbeatUrl = this.buildHeartbeatUrl(serverUrl);
      
      // 发送心跳请求
      const response = await this.sendHeartbeatRequest(heartbeatUrl);
      
      return {
        success: true,
        deviceRegistered: response.deviceExists || true, // If heartbeat succeeds, device exists
        isAssigned: response.isAssigned || false,
        canStartMonitoring: response.canStartMonitoring || false,
        serverTime: response.serverTime ? new Date(response.serverTime) : new Date()
      };

    } catch (error: any) {
      console.error('[HEARTBEAT] Server connectivity check failed:', error);
      
      return {
        success: false,
        deviceRegistered: false
      };
    }
  }

  private buildHeartbeatUrl(serverUrl: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      
      // 使用正确的设备心跳API路径
      const heartbeatPath = '/api/device/heartbeat';
      
      return `${baseUrl}${heartbeatPath}`;
    } catch (error: any) {
      throw new Error(`Failed to build heartbeat URL: ${error.message}`);
    }
  }

  private async sendHeartbeatRequest(url: string): Promise<{
    deviceExists: boolean;
    isAssigned: boolean;
    canStartMonitoring: boolean;
    serverTime: string;
  }> {
    try {
      console.log(`[HEARTBEAT] Sending POST request to: ${url}`);
      
      const config = this.configService.getConfig();
      const heartbeatData = {
        deviceId: config.deviceId,
        timestamp: Date.now(),
        status: 'online'
      };

      console.log('[HEARTBEAT] Heartbeat data:', heartbeatData);

      // 使用POST方法发送心跳数据
      // 优化：超时时间从5秒增加到15秒，适应跨境网络延迟
      const response = await this.makeHttpRequest(url, {
        method: 'POST',
        timeout: 15000,  // 从5000ms增加到15000ms
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        },
        body: JSON.stringify(heartbeatData)
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[HEARTBEAT] Server response:', JSON.stringify(data));
        
        // 适配服务器返回的数据格式
        if (data.success && data.data) {
          const result = {
            deviceExists: true,
            isAssigned: data.data.isAssigned || false,
            canStartMonitoring: data.data.canStartMonitoring || false,
            serverTime: data.data.timestamp || new Date().toISOString()
          };
          console.log('[HEARTBEAT] Parsed response data:', JSON.stringify(result));
          return result;
        } else if (data.success === false) {
          console.warn('[HEARTBEAT] Server returned success: false', JSON.stringify(data));
          return {
            deviceExists: false,
            isAssigned: false,
            canStartMonitoring: false,
            serverTime: new Date().toISOString()
          };
        } else {
          // 降级处理旧格式
          console.log('[HEARTBEAT] Using fallback format parsing');
          return {
            deviceExists: data.deviceExists || false,
            isAssigned: data.isAssigned || false,
            canStartMonitoring: data.canStartMonitoring || false,
            serverTime: data.serverTime || new Date().toISOString()
          };
        }
      } else if (response.status === 429) {
        throw new Error('Rate limit exceeded - too many requests, will retry with delay');
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Server connection refused - server may be down');
      } else if (error.code === 'ETIMEDOUT') {
        throw new Error('Server request timeout');
      } else if (error.code === 'ENOTFOUND') {
        throw new Error('Server not found - check server URL');
      } else {
        throw new Error(`Network error: ${error.message}`);
      }
    }
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
    // 简化的HTTP请求实现
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
                return JSON.parse(data);
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
      
      // 如果有请求体，写入数据
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }

  // 重置心跳尝试计数
  protected async onEnter(context: FSMContext): Promise<void> {
    this.heartbeatAttempts = 0;
    console.log('[HEARTBEAT] Entering heartbeat state, reset attempt counter');
  }

  protected async onExit(context: FSMContext): Promise<void> {
    console.log(`[HEARTBEAT] Exiting heartbeat state after ${this.heartbeatAttempts} attempts`);
  }
}