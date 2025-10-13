/**
 * UNBOUND状态处理器 - 重构版本
 * 负责处理设备未绑定状态
 */

import { BaseStateHandler } from '../base-state-handler';
import { 
  DeviceState, 
  FSMContext, 
  StateHandlerResult 
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';

export class UnboundStateHandler extends BaseStateHandler {
  private configService: IConfigService;
  private checkAttempts = 0;
  private maxCheckAttempts = 10;

  constructor(configService: IConfigService) {
    super('UnboundStateHandler', [DeviceState.UNBOUND]);
    this.configService = configService;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      console.log('[UNBOUND] Handling unbound state...');
      
      this.validateContext(context);
      this.checkAttempts++;

      const config = this.configService.getConfig();
      if (!config.deviceId) {
        return {
          success: false,
          nextState: DeviceState.REGISTER,
          reason: 'Device ID not found, need to register'
        };
      }

      console.log(`[UNBOUND] Checking binding status (attempt ${this.checkAttempts}/${this.maxCheckAttempts})...`);

      // 定期检查绑定状态
      const bindingResult = await this.checkBindingStatus(config.deviceId, config.serverUrl);

      if (bindingResult.success) {
        if (bindingResult.isBound) {
          console.log('[UNBOUND] Device has been bound to an employee');
          this.resetCheckAttempts();
          
          return {
            success: true,
            nextState: DeviceState.BIND_CHECK,
            reason: 'Device binding detected, proceeding to binding verification',
            data: {
              employeeInfo: bindingResult.employeeInfo,
              bindingTime: new Date()
            }
          };
        } else {
          // 仍然未绑定，继续等待
          if (this.checkAttempts >= this.maxCheckAttempts) {
            console.log('[UNBOUND] Maximum check attempts reached, entering extended wait mode');
            this.resetCheckAttempts();
            
            return {
              success: true,
              nextState: DeviceState.UNBOUND,
              reason: 'Still unbound, entering extended wait mode',
              retryDelay: 60000 // 等待1分钟后重新开始检查
            };
          } else {
            return {
              success: true,
              nextState: DeviceState.UNBOUND,
              reason: `Still unbound, will check again (${this.checkAttempts}/${this.maxCheckAttempts})`,
              retryDelay: 10000 // 等待10秒后再次检查
            };
          }
        }
      } else {
        // 检查失败，可能是网络问题
        console.warn('[UNBOUND] Binding status check failed:', bindingResult.error);
        
        if (this.checkAttempts >= this.maxCheckAttempts) {
          return {
            success: false,
            nextState: DeviceState.ERROR,
            reason: `Repeated binding check failures: ${bindingResult.error}`
          };
        } else {
          return {
            success: false,
            nextState: DeviceState.UNBOUND,
            reason: `Binding check failed, retrying: ${bindingResult.error}`,
            retryDelay: 15000 // 等待15秒后重试
          };
        }
      }

    } catch (error: any) {
      console.error('[UNBOUND] Unbound state handling failed:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Unbound state handling failed: ${error.message}`,
        error
      };
    }
  }

  private async checkBindingStatus(deviceId: string, serverUrl: string): Promise<{
    success: boolean;
    isBound: boolean;
    employeeInfo?: any;
    error?: string;
  }> {
    try {
      console.log(`[UNBOUND] Checking binding status for device: ${deviceId.substring(0, 8)}...`);

      const bindingUrl = this.buildBindingCheckUrl(serverUrl, deviceId);
      const response = await this.sendBindingCheckRequest(bindingUrl);

      if (response.success) {
        const result = {
          success: true,
          isBound: response.data.isBound || false,
          employeeInfo: response.data.employeeInfo
        };

        console.log('[UNBOUND] Binding status check result:', {
          isBound: result.isBound,
          hasEmployeeInfo: !!result.employeeInfo
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
      console.error('[UNBOUND] Failed to check binding status:', error);
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
      return `${baseUrl}/api/device/binding-status?deviceId=${encodedDeviceId}`;
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
      console.log(`[UNBOUND] Sending binding check request to: ${url}`);

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
        return {
          success: true,
          data: data.data || data
        };
      } else if (response.status === 404) {
        // 设备未找到，可能需要重新注册
        console.warn('[UNBOUND] Device not found on server');
        return {
          success: false,
          error: 'Device not found on server'
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error: any) {
      console.error('[UNBOUND] Binding check request failed:', error);
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

  private resetCheckAttempts(): void {
    this.checkAttempts = 0;
    console.log('[UNBOUND] Reset check attempts counter');
  }

  protected async onEnter(context: FSMContext): Promise<void> {
    console.log('[UNBOUND] Entering unbound state');
    console.log('[UNBOUND] Device is not bound to any employee. Waiting for binding...');
    
    // 当进入unbound状态时，可以显示提示信息
    this.displayUnboundMessage();
  }

  protected async onExit(context: FSMContext): Promise<void> {
    console.log('[UNBOUND] Exiting unbound state');
    this.resetCheckAttempts();
  }

  private displayUnboundMessage(): void {
    try {
      console.log('='.repeat(60));
      console.log('[UNBOUND] DEVICE NOT BOUND');
      console.log('='.repeat(60));
      console.log('[UNBOUND] This device is not currently bound to any employee.');
      console.log('[UNBOUND] Please ask your administrator to bind this device in the management console.');
      console.log('[UNBOUND] The client will continue checking for binding status...');
      console.log('='.repeat(60));
    } catch (error) {
      // 忽略显示错误
    }
  }

  // 提供手动触发绑定检查的方法
  async triggerBindingCheck(): Promise<void> {
    try {
      console.log('[UNBOUND] Manual binding check triggered');
      this.checkAttempts = 0; // 重置尝试计数
      
      // 这里可以发出事件来触发状态机重新检查
      // 或者实现其他触发机制
    } catch (error: any) {
      console.error('[UNBOUND] Failed to trigger binding check:', error);
    }
  }

  // 获取当前状态信息
  getStatus(): {
    checkAttempts: number;
    maxCheckAttempts: number;
    nextCheckIn: string;
  } {
    const nextCheckDelay = this.checkAttempts >= this.maxCheckAttempts ? 60000 : 10000;
    
    return {
      checkAttempts: this.checkAttempts,
      maxCheckAttempts: this.maxCheckAttempts,
      nextCheckIn: `${nextCheckDelay / 1000} seconds`
    };
  }
}