/**
 * CONFIG_FETCH状态处理器 - 重构版本
 * 负责从服务器获取配置信息
 */

import { BaseStateHandler } from '../base-state-handler';
import { 
  DeviceState, 
  FSMContext, 
  StateHandlerResult 
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';

export class ConfigFetchStateHandler extends BaseStateHandler {
  private configService: IConfigService;

  constructor(configService: IConfigService) {
    super('ConfigFetchStateHandler', [DeviceState.CONFIG_FETCH]);
    this.configService = configService;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      console.log('[CONFIG_FETCH] Starting configuration fetch...');
      
      this.validateContext(context);

      const config = this.configService.getConfig();
      if (!config.deviceId) {
        return {
          success: false,
          nextState: DeviceState.REGISTER,
          reason: 'Device ID not found'
        };
      }

      // 从服务器获取配置
      const configResult = await this.fetchConfigurationFromServer(config.serverUrl, config.deviceId);

      if (configResult.success && configResult.configuration) {
        console.log('[CONFIG_FETCH] Configuration fetched successfully');

        // 应用新配置
        const applyResult = await this.applyNewConfiguration(configResult.configuration);

        if (applyResult.success) {
          return {
            success: true,
            nextState: DeviceState.DATA_COLLECT,
            reason: 'Configuration fetched and applied successfully',
            data: {
              configVersion: configResult.configuration.version,
              appliedAt: new Date()
            }
          };
        } else {
          return {
            success: false,
            nextState: DeviceState.ERROR,
            reason: `Failed to apply configuration: ${applyResult.error}`
          };
        }
      } else {
        // 如果无法获取配置，使用默认配置继续运行
        console.log('[CONFIG_FETCH] Failed to fetch server config, using default configuration');
        const defaultConfigResult = await this.applyDefaultConfiguration();
        
        if (defaultConfigResult.success) {
          return {
            success: true,
            nextState: DeviceState.DATA_COLLECT,
            reason: 'Using default configuration (server config unavailable)',
            data: {
              configVersion: 'default',
              appliedAt: new Date()
            }
          };
        } else {
          return {
            success: false,
            nextState: DeviceState.ERROR,
            reason: `Failed to apply default configuration: ${defaultConfigResult.error}`
          };
        }
      }

    } catch (error: any) {
      console.error('[CONFIG_FETCH] Configuration fetch failed:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Configuration fetch failed: ${error.message}`,
        error
      };
    }
  }

  private async fetchConfigurationFromServer(serverUrl: string, deviceId: string): Promise<{
    success: boolean;
    configuration?: any;
    error?: string;
  }> {
    try {
      console.log(`[CONFIG_FETCH] Fetching configuration for device: ${deviceId.substring(0, 8)}...`);

      const configUrl = this.buildConfigurationUrl(serverUrl, deviceId);
      const response = await this.sendConfigurationRequest(configUrl);

      if (response.success && response.data) {
        const configuration = response.data; // 服务器直接在data字段返回配置
        console.log('[CONFIG_FETCH] Raw configuration received:', JSON.stringify(configuration));
        
        // 验证配置格式
        const validationResult = this.validateConfiguration(configuration);
        if (!validationResult.valid) {
          return {
            success: false,
            error: `Invalid configuration format: ${validationResult.error}`
          };
        }

        console.log('[CONFIG_FETCH] Configuration validation passed');
        return {
          success: true,
          configuration
        };
      } else {
        return {
          success: false,
          error: response.error || 'Failed to fetch configuration'
        };
      }

    } catch (error: any) {
      console.error('[CONFIG_FETCH] Failed to fetch configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private buildConfigurationUrl(serverUrl: string, deviceId: string): string {
    try {
      const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
      // 使用正确的客户端监控配置端点
      return `${baseUrl}/api/system-config/client/monitoring`;
    } catch (error: any) {
      throw new Error(`Failed to build configuration URL: ${error.message}`);
    }
  }

  private async sendConfigurationRequest(url: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      console.log(`[CONFIG_FETCH] Sending request to: ${url}`);

      const response = await this.makeHttpRequest(url, {
        method: 'GET',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Employee-Monitor-Client/1.0'
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[CONFIG_FETCH] Server response:', JSON.stringify(data));
        return {
          success: true,
          data: data.data || data // 服务器返回 { success: true, data: clientConfig }
        };
      } else if (response.status === 404) {
        return {
          success: false,
          error: 'Device configuration not found'
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error: any) {
      console.error('[CONFIG_FETCH] Configuration request failed:', error);
      throw error;
    }
  }

  private validateConfiguration(config: any): {
    valid: boolean;
    error?: string;
  } {
    try {
      console.log('[CONFIG_FETCH] Validating configuration...');

      if (!config || typeof config !== 'object') {
        return {
          valid: false,
          error: 'Configuration must be an object'
        };
      }

      // 服务器返回的配置格式是扁平的，不是嵌套在monitoring对象中
      // 检查基本配置字段
      const basicFields = ['screenshotInterval', 'activityInterval', 'processScanInterval'];
      for (const field of basicFields) {
        if (!(field in config)) {
          console.warn(`[CONFIG_FETCH] Missing optional field: ${field}`);
        }
      }

      // 验证监控间隔配置
      if (config.screenshotInterval && (typeof config.screenshotInterval !== 'number' || config.screenshotInterval < 1000)) {
        return {
          valid: false,
          error: 'Screenshot interval must be a number >= 1000ms'
        };
      }

      if (config.activityInterval && (typeof config.activityInterval !== 'number' || config.activityInterval < 1000)) {
        return {
          valid: false,
          error: 'Activity interval must be a number >= 1000ms'
        };
      }

      // 验证监控开关
      const enableFields = ['enableScreenshot', 'enableActivity', 'enableProcess'];
      for (const field of enableFields) {
        if (config[field] !== undefined && typeof config[field] !== 'boolean') {
          return {
            valid: false,
            error: `${field} must be a boolean`
          };
        }
      }

      // 验证其他配置字段
      if (config.websocket && !this.validateWebSocketConfig(config.websocket)) {
        return {
          valid: false,
          error: 'Invalid WebSocket configuration'
        };
      }

      console.log('[CONFIG_FETCH] Configuration validation successful');
      return { valid: true };

    } catch (error: any) {
      return {
        valid: false,
        error: `Configuration validation error: ${error.message}`
      };
    }
  }

  private validateMonitoringConfig(monitoring: any): {
    valid: boolean;
    error?: string;
  } {
    try {
      if (typeof monitoring !== 'object') {
        return {
          valid: false,
          error: 'Monitoring config must be an object'
        };
      }

      // 检查监控间隔
      if (monitoring.interval && (typeof monitoring.interval !== 'number' || monitoring.interval < 1000)) {
        return {
          valid: false,
          error: 'Monitoring interval must be a number >= 1000ms'
        };
      }

      // 检查截图配置
      if (monitoring.screenshot) {
        if (typeof monitoring.screenshot !== 'object') {
          return {
            valid: false,
            error: 'Screenshot config must be an object'
          };
        }

        if (monitoring.screenshot.enabled !== undefined && typeof monitoring.screenshot.enabled !== 'boolean') {
          return {
            valid: false,
            error: 'Screenshot enabled flag must be a boolean'
          };
        }
      }

      return { valid: true };

    } catch (error: any) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  private validateWebSocketConfig(websocket: any): boolean {
    try {
      if (typeof websocket !== 'object') return false;
      
      if (websocket.url && typeof websocket.url !== 'string') return false;
      if (websocket.reconnectInterval && typeof websocket.reconnectInterval !== 'number') return false;
      
      return true;
    } catch {
      return false;
    }
  }

  private async applyNewConfiguration(newConfig: any): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      console.log('[CONFIG_FETCH] Applying new configuration...');
      console.log('[CONFIG_FETCH] Server config received:', JSON.stringify(newConfig, null, 2));

      // 获取当前配置
      const currentConfig = this.configService.getConfig();

      // 合并配置（保留设备特定的配置项）
      const mergedConfig = {
        ...currentConfig,
        ...newConfig,
        // 保留本地设置
        deviceId: currentConfig.deviceId,
        serverUrl: currentConfig.serverUrl
      };

      console.log('[CONFIG_FETCH] Merged config:', JSON.stringify({
        enableScreenshot: mergedConfig.enableScreenshot,
        enableActivity: mergedConfig.enableActivity,
        enableProcess: mergedConfig.enableProcess,
        screenshotInterval: mergedConfig.screenshotInterval,
        activityInterval: mergedConfig.activityInterval,
        processInterval: mergedConfig.processInterval
      }, null, 2));

      // 验证合并后的配置
      const validationResult = this.validateConfiguration(mergedConfig);
      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.error
        };
      }

      // 保存配置
      if (typeof (this.configService as any).updateConfig === 'function') {
        await (this.configService as any).updateConfig(mergedConfig);
      } else if (typeof (this.configService as any).saveConfig === 'function') {
        await (this.configService as any).saveConfig(mergedConfig);
      }

      console.log('[CONFIG_FETCH] New configuration applied successfully');
      return { success: true };

    } catch (error: any) {
      console.error('[CONFIG_FETCH] Failed to apply configuration:', error);
      return {
        success: false,
        error: error.message
      };
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

  protected async onEnter(context: FSMContext): Promise<void> {
    console.log('[CONFIG_FETCH] Entering configuration fetch state');
  }

  protected async onExit(context: FSMContext): Promise<void> {
    console.log('[CONFIG_FETCH] Exiting configuration fetch state');
  }

  /**
   * 应用默认配置，当无法从服务器获取配置时使用
   */
  private async applyDefaultConfiguration(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      console.log('[CONFIG_FETCH] Applying default configuration...');
      
      // 默认监控配置
      const defaultConfig = {
        monitoring: {
          interval: 30000, // 30秒监控间隔
          screenshot: {
            enabled: true,
            interval: 60000, // 1分钟截图间隔
            quality: 80
          },
          activity: {
            enabled: true,
            interval: 5000 // 5秒活动检测间隔
          },
          processes: {
            enabled: true,
            interval: 30000 // 30秒进程检测间隔
          }
        },
        websocket: {
          reconnectDelay: 5000,
          maxReconnectAttempts: 10,
          heartbeatInterval: 30000
        },
        upload: {
          batchSize: 10,
          maxRetries: 3,
          retryDelay: 2000
        }
      };

      // 这里可以将默认配置应用到系统中
      // 由于这是配置获取阶段，我们主要是通知系统使用默认值
      console.log('[CONFIG_FETCH] Default configuration applied successfully', {
        monitoringInterval: defaultConfig.monitoring.interval,
        screenshotEnabled: defaultConfig.monitoring.screenshot.enabled,
        websocketReconnectDelay: defaultConfig.websocket.reconnectDelay
      });

      return {
        success: true
      };

    } catch (error: any) {
      console.error('[CONFIG_FETCH] Failed to apply default configuration:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}