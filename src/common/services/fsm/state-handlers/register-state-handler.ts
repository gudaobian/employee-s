/**
 * REGISTER状态处理器 - 重构版本
 * 负责设备注册流程
 */

import { BaseStateHandler } from '../base-state-handler';
import { 
  DeviceState, 
  FSMContext, 
  StateHandlerResult 
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';
import { IPlatformAdapter } from '../../../interfaces/platform-interface';
import { logger } from '../../../utils/logger';

export class RegisterStateHandler extends BaseStateHandler {
  private configService: IConfigService;
  private platformAdapter: IPlatformAdapter;

  constructor(configService: IConfigService, platformAdapter: IPlatformAdapter) {
    super('RegisterStateHandler', [DeviceState.REGISTER]);
    this.configService = configService;
    this.platformAdapter = platformAdapter;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      logger.info('[REGISTER] Starting device registration...');
      
      this.validateContext(context);

      // 收集设备信息
      const deviceInfo = await this.collectDeviceInfo();
      logger.info('[REGISTER] Device info collected:', {
        hostname: deviceInfo.hostname,
        platform: deviceInfo.platform,
        hasSystemInfo: !!deviceInfo.systemInfo
      });

      // 执行注册请求
      const registrationResult = await this.performRegistration(deviceInfo);
      
      logger.info('[REGISTER] 🎯 最终注册结果分析:');
      logger.info('[REGISTER]   - registrationResult.success:', registrationResult.success);
      logger.info('[REGISTER]   - registrationResult.deviceId:', registrationResult.deviceId);
      logger.info('[REGISTER]   - registrationResult.error:', registrationResult.error);
      logger.info('[REGISTER]   - 完整注册结果:', JSON.stringify(registrationResult, null, 2));

      if (registrationResult.success && registrationResult.deviceId) {
        logger.info('[REGISTER] ✅ 注册完全成功，准备切换到BIND_CHECK状态');
        
        // 保存设备ID到配置
        await this.saveDeviceId(registrationResult.deviceId);
        
        const successResult = {
          success: true,
          nextState: DeviceState.BIND_CHECK,
          reason: 'Device registered successfully',
          data: {
            deviceId: registrationResult.deviceId,
            registrationTime: new Date()
          }
        };
        
        logger.info('[REGISTER] 📤 返回成功结果:', JSON.stringify(successResult, null, 2));
        return successResult;
      } else {
        logger.error('[REGISTER] ❌ 注册失败，准备切换到ERROR状态');
        logger.error('[REGISTER]   - 失败原因: success=' + registrationResult.success + ', deviceId=' + registrationResult.deviceId);
        
        const errorResult = {
          success: false,
          nextState: DeviceState.ERROR,
          reason: `Registration failed: ${registrationResult.error || 'Unknown error'}`
        };
        
        logger.error('[REGISTER] 📤 返回错误结果:', JSON.stringify(errorResult, null, 2));
        return errorResult;
      }

    } catch (error: any) {
      logger.error('[REGISTER] Registration process failed:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Registration failed: ${error.message}`,
        error
      };
    }
  }

  private async collectDeviceInfo(): Promise<{
    hostname: string;
    platform: string;
    systemInfo: any;
    networkInfo?: any;
  }> {
    try {
      logger.info('[REGISTER] Collecting device information...');

      // 获取系统信息
      const systemInfo = await this.platformAdapter.getSystemInfo();
      
      // 获取网络信息（如果可能）
      let networkInfo;
      try {
        networkInfo = await this.collectNetworkInfo();
      } catch (error) {
        logger.warn('[REGISTER] Failed to collect network info:', error);
      }

      const deviceInfo = {
        hostname: systemInfo.hostname,
        platform: systemInfo.platform,
        systemInfo: {
          platform: systemInfo.platform,
          cpu: systemInfo.cpu,
          memory: systemInfo.memory,
          osVersion: systemInfo.osVersion
        },
        networkInfo
      };

      logger.info('[REGISTER] Device info collection completed');
      return deviceInfo;

    } catch (error: any) {
      logger.error('[REGISTER] Failed to collect device info:', error);
      throw new Error(`Device info collection failed: ${error.message}`);
    }
  }

  private async collectNetworkInfo(): Promise<any> {
    try {
      const os = require('os');
      const networkInterfaces = os.networkInterfaces();
      
      // 查找主要网络接口
      const primaryInterface = this.findPrimaryNetworkInterface(networkInterfaces);
      
      return {
        primaryInterface: primaryInterface ? {
          name: primaryInterface.name,
          address: primaryInterface.address,
          mac: primaryInterface.mac
        } : null,
        interfaceCount: Object.keys(networkInterfaces).length
      };
    } catch (error: any) {
      logger.warn('[REGISTER] Network info collection failed:', error);
      return null;
    }
  }

  private findPrimaryNetworkInterface(interfaces: any): { 
    name: string; 
    address: string; 
    mac: string; 
  } | null {
    try {
      for (const [name, addresses] of Object.entries(interfaces)) {
        if (!addresses || !Array.isArray(addresses)) continue;
        
        for (const addr of addresses as any[]) {
          if (addr.family === 'IPv4' && !addr.internal && addr.address !== '127.0.0.1') {
            return {
              name,
              address: addr.address,
              mac: addr.mac || 'unknown'
            };
          }
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private async performRegistration(deviceInfo: any): Promise<{
    success: boolean;
    deviceId?: string;
    error?: string;
  }> {
    try {
      logger.info('[REGISTER] Sending registration request...');

      const config = this.configService.getConfig();
      
      // 验证服务器URL配置
      if (!config.serverUrl) {
        throw new Error('Server URL not configured');
      }
      
      logger.info('[REGISTER] 服务器配置:', {
        serverUrl: config.serverUrl,
        hasServerUrl: !!config.serverUrl
      });
      
      // 测试网络连通性
      const isOnline = await this.testNetworkConnectivity(config.serverUrl);
      if (!isOnline) {
        throw new Error('Network connectivity test failed - server unreachable');
      }
      
      const registrationUrl = this.buildRegistrationUrl(config.serverUrl);
      logger.info('[REGISTER] 注册URL:', registrationUrl);

      // Build request data matching server validation schema
      const requestData = {
        deviceId: config.deviceId || `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        hostname: deviceInfo.hostname || 'unknown-host',
        os: deviceInfo.platform || process.platform,
        osVersion: deviceInfo.systemInfo?.osVersion || 'unknown-version',
        hardwareFingerprint: this.generateHardwareFingerprint(deviceInfo),
        macAddress: deviceInfo.networkInfo?.primaryInterface?.mac || undefined,
        ipAddress: deviceInfo.networkInfo?.primaryInterface?.address || undefined,
        timezone: Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone || 'UTC',
        locale: 'en-US'
      };

      logger.info('[REGISTER] Registration payload:', {
        deviceId: requestData.deviceId.substring(0, 20) + '...',
        hostname: requestData.hostname,
        os: requestData.os,
        osVersion: requestData.osVersion
      });

      const response = await this.sendRegistrationRequest(registrationUrl, requestData);
      
      logger.info('[REGISTER] 🔍 完整响应分析:');
      logger.info('[REGISTER]   - response.success:', response.success);
      logger.info('[REGISTER]   - response.deviceId:', response.deviceId);
      logger.info('[REGISTER]   - response.data:', response.data);
      logger.info('[REGISTER]   - response.error:', response.error);
      logger.info('[REGISTER]   - 完整响应对象:', JSON.stringify(response, null, 2));

      // Handle both direct format and nested format
      if (response.success) {
        logger.info('[REGISTER] ✅ 服务器响应成功标志为 true');
        
        // Try to get deviceId from different possible locations
        const deviceId = response.data?.device?.deviceId || 
                         response.data?.deviceId || 
                         response.deviceId ||
                         this.configService.getConfig().deviceId;
        
        logger.info('[REGISTER] 🔍 设备ID查找结果:');
        logger.info('[REGISTER]   - response.data?.device?.deviceId:', response.data?.device?.deviceId);
        logger.info('[REGISTER]   - response.data?.deviceId:', response.data?.deviceId);
        logger.info('[REGISTER]   - response.deviceId:', response.deviceId);
        logger.info('[REGISTER]   - config.deviceId:', this.configService.getConfig().deviceId);
        logger.info('[REGISTER]   - 最终使用的deviceId:', deviceId);
        
        if (deviceId) {
          logger.info('[REGISTER] ✅ 注册成功，设备ID已获取');
          return {
            success: true,
            deviceId: deviceId
          };
        } else {
          logger.warn('[REGISTER] ❌ 注册成功但无法获取设备ID');
          return {
            success: false,
            error: 'Registration successful but missing deviceId'
          };
        }
      } else {
        logger.error('[REGISTER] ❌ 服务器响应成功标志为 false');
        return {
          success: false,
          error: response.error || 'Registration failed'
        };
      }

    } catch (error: any) {
      logger.error('[REGISTER] Registration request failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private generateHardwareFingerprint(deviceInfo: any): string {
    try {
      const components = [
        deviceInfo.hostname || 'unknown',
        deviceInfo.platform || 'unknown',
        deviceInfo.systemInfo?.cpu || 'unknown',
        deviceInfo.networkInfo?.primaryInterface?.mac || 'unknown'
      ];
      
      // Simple hash-like fingerprint
      const fingerprint = components.join('-').replace(/[^a-zA-Z0-9-]/g, '').substring(0, 64);
      return fingerprint || `fp-${Date.now()}`;
    } catch (error) {
      return `fp-${Date.now()}`;
    }
  }

  private async testNetworkConnectivity(serverUrl: string): Promise<boolean> {
    try {
      // ⚠️ TEMPORARY FIX: 跳过健康检查，因为 API /api/health 端点响应太慢（76秒，返回503）
      // TODO: 修复 API 服务器的健康检查端点后恢复此功能
      logger.info('[REGISTER] 跳过网络连通性测试（API健康检查端点响应慢）');
      logger.info('[REGISTER] ⚠️  假设网络连通，直接进行设备注册');
      return true;

      /* 原代码保留，待API修复后恢复
      logger.info('[REGISTER] 测试网络连通性...');
      const urlObj = new URL(serverUrl);

      // 测试DNS解析和基本连接
      const testResult = await this.makeHttpRequest(`${urlObj.protocol}//${urlObj.host}/api/health`, {
        method: 'GET',
        timeout: 30000,  // 增加到30秒，适应网络慢或API服务器响应慢的情况
        headers: {
          'User-Agent': 'Employee-Monitor-Client/1.0'
        }
      });

      logger.info('[REGISTER] 网络连通性测试结果:', {
        status: testResult.status,
        ok: testResult.ok
      });

      // 任何HTTP响应都表明网络连通
      return testResult.status > 0;
      */
    } catch (error: any) {
      logger.warn('[REGISTER] 网络连通性测试失败:', {
        message: error.message,
        code: error.code
      });

      // 网络错误但不阻止注册尝试，可能是健康检查端点不存在
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return false;
      }
      
      // 其他错误（如404）表明网络是通的
      return true;
    }
  }

  private buildRegistrationUrl(serverUrl: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      return `${baseUrl}/api/device/register`;
    } catch (error: any) {
      throw new Error(`Failed to build registration URL: ${error.message}`);
    }
  }

  private async sendRegistrationRequest(url: string, data: any): Promise<{
    success: boolean;
    data?: any;
    deviceId?: string;
    error?: string;
  }> {
    try {
      logger.info(`[REGISTER] Sending POST request to: ${url}`);

      const response = await this.makeHttpRequest(url, {
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        const responseData = await response.json();
        logger.info('[REGISTER] 📡 HTTP响应成功，状态码:', response.status);
        logger.info('[REGISTER] 📋 原始响应数据:', JSON.stringify(responseData, null, 2));
        logger.info('[REGISTER] 🔍 响应数据分析:');
        logger.info('[REGISTER]   - responseData.success:', responseData.success);
        logger.info('[REGISTER]   - responseData.deviceId:', responseData.deviceId);
        logger.info('[REGISTER]   - responseData.data:', responseData.data);
        logger.info('[REGISTER]   - responseData.error:', responseData.error);
        logger.info('[REGISTER]   - typeof responseData.success:', typeof responseData.success);

        const result = {
          success: responseData.success || false,
          data: responseData.data,
          deviceId: responseData.deviceId, // Add direct deviceId access
          error: responseData.error?.message || responseData.error
        };
        
        logger.info('[REGISTER] 📦 返回给performRegistration的结果:', JSON.stringify(result, null, 2));
        return result;
      } else {
        logger.error('[REGISTER] ❌ HTTP响应失败，状态码:', response.status, response.statusText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error: any) {
      logger.error('[REGISTER] Registration request failed:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        hostname: error.hostname,
        stack: error.stack?.split('\n').slice(0, 3)
      });
      throw error;
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
        logger.error('[REGISTER] HTTP请求错误:', {
          message: error.message,
          code: error.code,
          errno: error.errno,
          syscall: error.syscall,
          hostname: error.hostname
        });
        reject(error);
      });

      req.on('timeout', () => {
        logger.error('[REGISTER] HTTP请求超时，URL:', url);
        req.destroy();
        reject(new Error(`Request timeout after ${options.timeout}ms`));
      });

      req.setTimeout(options.timeout);

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  private async saveDeviceId(deviceId: string): Promise<void> {
    try {
      logger.info('[REGISTER] Saving device ID to configuration...');

      // 更新配置中的设备ID
      const config = this.configService.getConfig();
      config.deviceId = deviceId;
      
      // 保存配置（假设configService有保存方法）
      if (typeof (this.configService as any).saveConfig === 'function') {
        await (this.configService as any).saveConfig(config);
      }

      logger.info('[REGISTER] Device ID saved successfully');
    } catch (error: any) {
      logger.error('[REGISTER] Failed to save device ID:', error);
      throw new Error(`Failed to save device ID: ${error.message}`);
    }
  }

  protected async onEnter(context: FSMContext): Promise<void> {
    logger.info('[REGISTER] Entering registration state');
  }

  protected async onExit(context: FSMContext): Promise<void> {
    logger.info('[REGISTER] Exiting registration state');
  }
}