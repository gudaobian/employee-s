/**
 * BIND_CHECK状态处理器 - 重构版本
 * 负责检查设备绑定状态
 */

import { BaseStateHandler } from '../base-state-handler';
import { 
  DeviceState, 
  FSMContext, 
  StateHandlerResult 
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';

export class BindCheckStateHandler extends BaseStateHandler {
  private configService: IConfigService;

  constructor(configService: IConfigService) {
    super('BindCheckStateHandler', [DeviceState.BIND_CHECK]);
    this.configService = configService;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      console.log('[BIND_CHECK] Starting device binding check...');
      
      this.validateContext(context);

      const config = this.configService.getConfig();
      if (!config.deviceId) {
        return {
          success: false,
          nextState: DeviceState.REGISTER,
          reason: 'Device ID not found, need to register first'
        };
      }

      // 执行绑定状态检查
      const bindingResult = await this.checkBindingStatus(config.deviceId, config.serverUrl);

      if (bindingResult.success) {
        if (bindingResult.isBound) {
          console.log('[BIND_CHECK] Device is bound to an employee');
          return {
            success: true,
            nextState: DeviceState.WS_CHECK,
            reason: 'Device is bound, proceeding to WebSocket check',
            data: {
              employeeInfo: bindingResult.employeeInfo,
              bindingTime: bindingResult.bindingTime
            }
          };
        } else {
          console.log('[BIND_CHECK] Device is not bound to any employee');
          return {
            success: true,
            nextState: DeviceState.UNBOUND,
            reason: 'Device is not bound to any employee',
            retryDelay: 5000 // 等待5秒后重新检查
          };
        }
      } else {
        return {
          success: false,
          nextState: DeviceState.ERROR,
          reason: `Binding check failed: ${bindingResult.error}`
        };
      }

    } catch (error: any) {
      console.error('[BIND_CHECK] Binding check failed:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Binding check failed: ${error.message}`,
        error
      };
    }
  }

  private async checkBindingStatus(deviceId: string, serverUrl: string): Promise<{
    success: boolean;
    isBound: boolean;
    employeeInfo?: any;
    bindingTime?: Date;
    error?: string;
  }> {
    try {
      console.log(`[BIND_CHECK] Checking binding status for device: ${deviceId.substring(0, 8)}...`);

      const bindingUrl = this.buildBindingCheckUrl(serverUrl, deviceId);
      const response = await this.sendBindingCheckRequest(bindingUrl);

      if (response.success) {
        const result = {
          success: true,
          isBound: response.data.isBound || response.data.assigned || response.data.isAssigned || false, // 兼容新旧后端：isBound, assigned 和 isAssigned
          employeeInfo: response.data.employeeInfo || response.data.employee || response.data.user || {
            userId: response.data.userId,
            userFullName: response.data.user_full_name,
            userEmail: response.data.user_email
          },
          bindingTime: response.data.assignedAt ? new Date(response.data.assignedAt) : undefined
        };

        console.log('[BIND_CHECK] Binding status retrieved:', {
          isBound: result.isBound,
          hasEmployeeInfo: !!result.employeeInfo,
          userId: result.employeeInfo?.userId
        });

        return result;
      } else {
        return {
          success: false,
          isBound: false,
          error: response.error || 'Unknown error'
        };
      }

    } catch (error: any) {
      console.error('[BIND_CHECK] Failed to check binding status:', error);
      return {
        success: false,
        isBound: false,
        error: error.message
      };
    }
  }

  private buildBindingCheckUrl(serverUrl: string, deviceId: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      const encodedDeviceId = encodeURIComponent(deviceId);
      return `${baseUrl}/api/device/${encodedDeviceId}/assignment`;
    } catch (error: any) {
      throw new Error(`Failed to build binding check URL: ${error.message}`);
    }
  }

  private async sendBindingCheckRequest(url: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      console.log(`[BIND_CHECK] Sending request to: ${url}`);

      const response = await this.makeHttpRequest(url, {
        method: 'GET',
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[BIND_CHECK] Binding check response received');
        console.log('[BIND_CHECK] 🔍 原始响应数据:', JSON.stringify(data, null, 2));

        const result = {
          success: data.success !== false, // 默认为成功，除非明确失败
          data: data.data || data // 兼容不同的响应格式
        };
        
        console.log('[BIND_CHECK] 🔍 解析后的响应结构:', JSON.stringify(result, null, 2));
        return result;
      } else if (response.status === 404) {
        // 设备未找到，可能需要重新注册
        return {
          success: false,
          error: 'Device not found on server'
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error: any) {
      console.error('[BIND_CHECK] Binding check request failed:', error);
      throw error;
    }
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
              } catch (parseError) {
                console.warn('[BIND_CHECK] Failed to parse response as JSON:', parseError);
                return { rawData: data };
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
    console.log('[BIND_CHECK] Entering binding check state');
  }

  protected async onExit(context: FSMContext): Promise<void> {
    console.log('[BIND_CHECK] Exiting binding check state');
  }

  // 重写错误处理，对于某些错误可以重试
  protected isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'CONNECTION_REFUSED',
      'TEMPORARY_FAILURE',
      'ECONNRESET',
      'ENOTFOUND'
    ];
    
    return retryablePatterns.some(pattern => 
      error.message.includes(pattern) || 
      error.name.includes(pattern)
    );
  }
}