/**
 * CLI配置服务 - 重构版本
 * 纯CLI环境的配置管理，不依赖Electron Store
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { IConfigService, Config, MonitoringConfig, SecurityConfig, LoggingConfig } from '../interfaces/service-interfaces';
import { StableHardwareIdentifier } from '../utils/stable-hardware-identifier';

export class ConfigServiceCLI extends EventEmitter implements IConfigService {
  private static instance: ConfigServiceCLI;
  private config: Config;
  private configPath: string;
  private isInitialized = false;
  private hardwareIdentifier: StableHardwareIdentifier;

  private constructor() {
    super();
    // 使用用户配置目录，避免打包后的应用只读问题
    const configDir = this.getConfigDirectory();
    this.configPath = path.join(configDir, 'employee-monitor-config.json');
    this.hardwareIdentifier = StableHardwareIdentifier.getInstance();
    this.config = this.loadConfig();
  }

  /**
   * 获取配置目录 - 支持不同操作系统
   */
  private getConfigDirectory(): string {
    const homeDir = os.homedir();
    
    switch (process.platform) {
      case 'darwin':
        // macOS: ~/Library/Application Support/EmployeeMonitor
        return path.join(homeDir, 'Library', 'Application Support', 'EmployeeMonitor');
      case 'win32':
        // Windows: %APPDATA%\EmployeeMonitor
        return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'EmployeeMonitor');
      case 'linux':
        // Linux: ~/.config/EmployeeMonitor
        return path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'EmployeeMonitor');
      default:
        // 其他平台使用 ~/.employee-monitor
        return path.join(homeDir, '.employee-monitor');
    }
  }

  static getInstance(): ConfigServiceCLI {
    if (!ConfigServiceCLI.instance) {
      ConfigServiceCLI.instance = new ConfigServiceCLI();
    }
    return ConfigServiceCLI.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      console.log('[CONFIG] Initializing CLI ConfigService...', {
        configPath: this.configPath,
        serverUrl: this.config.serverUrl,
        deviceId: this.config.deviceId
      });

      // v3.0: 严格生成硬件设备ID，不使用任何临时ID或缓存
      if (!this.config.deviceId) {
        console.log('[CONFIG] Generating stable hardware-based device ID...');
        try {
          const deviceIdentifier = await this.hardwareIdentifier.generateStableDeviceId();
          this.config.deviceId = deviceIdentifier.deviceId;
          console.log('[CONFIG] ✅ Device ID generated:', {
            deviceId: this.config.deviceId.substring(0, 20) + '...',
            version: deviceIdentifier.version
          });
        } catch (error: any) {
          console.error('[CONFIG] ❌ CRITICAL: Failed to generate device ID:', error);
          throw new Error(`Cannot initialize without valid device ID: ${error.message}`);
        }
      } else {
        // 验证现有设备ID是否仍然有效
        console.log('[CONFIG] Validating existing device ID...');
        try {
          const validation = await this.hardwareIdentifier.validateDeviceId(this.config.deviceId);
          if (!validation.isValid) {
            console.warn('[CONFIG] ⚠️ Existing device ID invalid, regenerating...');
            const deviceIdentifier = await this.hardwareIdentifier.generateStableDeviceId();
            this.config.deviceId = deviceIdentifier.deviceId;
            console.log('[CONFIG] ✅ Device ID regenerated');
          } else {
            console.log('[CONFIG] ✅ Existing device ID is valid');
          }
        } catch (error: any) {
          console.error('[CONFIG] Device ID validation failed:', error);
          // 验证失败时重新生成
          const deviceIdentifier = await this.hardwareIdentifier.generateStableDeviceId();
          this.config.deviceId = deviceIdentifier.deviceId;
        }
      }

      // 验证配置(临时ID也能通过验证)
      if (!this.config.serverUrl) {
        throw new Error('Server URL is required');
      }

      // 确保配置文件存在
      await this.saveConfig();

      this.isInitialized = true;
      this.emit('initialized');

      console.log('[CONFIG] CLI ConfigService initialized successfully');
    } catch (error: any) {
      console.error('[CONFIG] Failed to initialize CLI ConfigService:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // 保存当前配置
      await this.saveConfig();
      
      this.isInitialized = false;
      this.emit('cleanup');
      
      console.log('[CONFIG] CLI ConfigService cleaned up successfully');
    } catch (error: any) {
      console.error('[CONFIG] Failed to cleanup CLI ConfigService:', error);
    }
  }

  getConfig(): Config {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<Config>): Promise<void> {
    try {
      const newConfig = { ...this.config, ...updates };
      
      // 深度合并嵌套对象
      if (updates.monitoring) {
        newConfig.monitoring = { ...this.config.monitoring, ...updates.monitoring };
      }
      if (updates.security) {
        newConfig.security = { ...this.config.security, ...updates.security };
      }
      if (updates.logging) {
        newConfig.logging = { ...this.config.logging, ...updates.logging };
      }

      // 处理 websocketUrl 清除 - 如果设置为 undefined，则从配置中删除
      if (updates.hasOwnProperty('websocketUrl') && updates.websocketUrl === undefined) {
        delete newConfig.websocketUrl;
        console.log('[CONFIG] Cleared websocketUrl from configuration');
      }

      this.config = newConfig;
      await this.saveConfig();
      
      this.emit('config-updated', this.config);
      console.log('[CONFIG] Configuration updated successfully');
    } catch (error: any) {
      console.error('[CONFIG] Failed to update configuration:', error);
      throw error;
    }
  }

  getDeviceId(): string {
    return this.config.deviceId;
  }

  validateConfig(): boolean {
    try {
      if (!this.config.deviceId || !this.config.serverUrl) {
        return false;
      }

      if (!this.config.monitoring || !this.config.security || !this.config.logging) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // 私有方法

  private loadConfig(): Config {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const loadedConfig = JSON.parse(configData);
        
        // 合并默认配置以确保所有字段存在
        return this.mergeWithDefaults(loadedConfig);
      }
    } catch (error) {
      console.warn('[CONFIG] Failed to load existing config, using defaults:', error);
    }

    return this.createDefaultConfig();
  }

  private createDefaultConfig(): Config {
    const envConfig = this.loadEnvironmentConfig();

    return {
      serverUrl: envConfig.API_BASE_URL || 'http://23.95.193.155:3000',
      // 不再设置默认的 websocketUrl，让 WebSocket 服务从 serverUrl 自动构建
      ...(envConfig.WEBSOCKET_URL && { websocketUrl: envConfig.WEBSOCKET_URL }),
      apiVersion: 'v1',
      timeout: parseInt(envConfig.TIMEOUT || '30000'),
      retryAttempts: 3,
      deviceId: '',  // 将在ensureStableDeviceId中设置
      authToken: envConfig.AUTH_TOKEN,
      monitoring: {
        enableScreenshot: true,
        screenshotInterval: 60000,
        enableKeylogger: false,
        enableMouseTracking: true,
        enableAppUsage: true,
        workingHours: {
          start: '09:00',
          end: '18:00',
          timezone: 'Asia/Shanghai'
        },
        uploadBatchSize: 50,
        retentionDays: 30
      },
      security: {
        encryptData: true,
        allowedNetworks: [],
        restrictedApps: []
      },
      logging: {
        level: envConfig.NODE_ENV === 'development' ? 'debug' : 'info',
        enableFile: true,
        enableConsole: true,
        logFile: path.join(os.tmpdir(), 'employee-monitor.log'),
        maxFileSize: 10 * 1024 * 1024 // 10MB
      }
    };
  }

  private mergeWithDefaults(loadedConfig: any): Config {
    const defaults = this.createDefaultConfig();
    
    return {
      ...defaults,
      ...loadedConfig,
      monitoring: {
        ...defaults.monitoring,
        ...(loadedConfig.monitoring || {})
      },
      security: {
        ...defaults.security,
        ...(loadedConfig.security || {})
      },
      logging: {
        ...defaults.logging,
        ...(loadedConfig.logging || {})
      }
    };
  }

  private async saveConfig(): Promise<void> {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error: any) {
      console.error('[CONFIG] Failed to save configuration:', error);
      throw error;
    }
  }

  private loadEnvironmentConfig(): Record<string, string> {
    const envConfig: Record<string, string> = {};
    
    // 从环境变量加载配置
    const envKeys = [
      'API_BASE_URL',
      'WEBSOCKET_URL', 
      'AUTH_TOKEN',
      'TIMEOUT',
      'NODE_ENV'
    ];

    for (const key of envKeys) {
      if (process.env[key]) {
        envConfig[key] = process.env[key]!;
      }
    }

    return envConfig;
  }

  /**
   * @deprecated 使用 generateStableDeviceId() 替代
   */
  private generateDeviceId(): string {
    console.warn('[CONFIG] generateDeviceId() is deprecated, use generateStableDeviceId() instead');
    try {
      const hostname = os.hostname();
      const username = os.userInfo().username;
      const platform = os.platform();
      const arch = os.arch();
      
      const data = `${hostname}-${username}-${platform}-${arch}-${Date.now()}`;
      return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
    } catch (error) {
      // 降级到随机ID
      return crypto.randomUUID().replace(/-/g, '');
    }
  }

  /**
   * v3.0: 已移除 generateStableDeviceId 和 ensureStableDeviceId 方法
   * 设备ID生成逻辑已完全由 StableHardwareIdentifier 类处理
   * 不再使用任何降级方案或临时ID
   */

  // 配置验证方法

  private validateServerUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private validateWebSocketUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'ws:' || parsedUrl.protocol === 'wss:';
    } catch {
      return false;
    }
  }

  // 公共配置操作方法

  updateServerUrl(url: string): Promise<void> {
    if (!this.validateServerUrl(url)) {
      throw new Error('Invalid server URL format');
    }
    // 当更新 serverUrl 时，清除 websocketUrl 让 WebSocket 服务自动构建
    return this.updateConfig({ 
      serverUrl: url,
      websocketUrl: undefined // 清除 websocketUrl，让其从 serverUrl 自动构建
    });
  }

  updateWebSocketUrl(url: string): Promise<void> {
    if (!this.validateWebSocketUrl(url)) {
      throw new Error('Invalid WebSocket URL format');
    }
    return this.updateConfig({ websocketUrl: url });
  }

  updateAuthToken(token: string): Promise<void> {
    return this.updateConfig({ authToken: token });
  }

  updateMonitoringSettings(settings: Partial<MonitoringConfig>): Promise<void> {
    const currentMonitoring = this.config.monitoring;
    const newMonitoring = { ...currentMonitoring, ...settings };
    return this.updateConfig({ monitoring: newMonitoring });
  }

  updateSecuritySettings(settings: Partial<SecurityConfig>): Promise<void> {
    const currentSecurity = this.config.security;
    const newSecurity = { ...currentSecurity, ...settings };
    return this.updateConfig({ security: newSecurity });
  }

  updateLoggingSettings(settings: Partial<LoggingConfig>): Promise<void> {
    const currentLogging = this.config.logging;
    const newLogging = { ...currentLogging, ...settings };
    return this.updateConfig({ logging: newLogging });
  }

  // 重置配置
  async resetToDefaults(): Promise<void> {
    this.config = this.createDefaultConfig();
    // v3.0: 重新生成硬件设备ID
    const deviceIdentifier = await this.hardwareIdentifier.generateStableDeviceId();
    this.config.deviceId = deviceIdentifier.deviceId;
    await this.saveConfig();
    this.emit('config-reset');
    console.log('[CONFIG] Configuration reset to defaults');
  }

  /**
   * 获取硬件设备ID信息 - v3.0 单一来源版本
   */
  async getDeviceIdInfo(): Promise<{
    deviceId: string;
    uuid: string;
    version: string;
    platform: string;
    // @deprecated 字段
    cpuId?: string;
    baseboardSerial?: string;
  }> {
    try {
      const deviceIdentifier = await this.hardwareIdentifier.generateStableDeviceId();
      return {
        deviceId: deviceIdentifier.deviceId,
        uuid: deviceIdentifier.uuid,
        version: deviceIdentifier.version,
        platform: process.platform,
        // 向后兼容（已废弃）
        cpuId: undefined,
        baseboardSerial: undefined
      };
    } catch (error) {
      console.error('[CONFIG] Failed to get device ID info:', error);
      throw error;
    }
  }

  /**
   * 强制重新生成设备ID
   */
  async regenerateDeviceId(): Promise<string> {
    try {
      // 清除硬件标识符缓存
      this.hardwareIdentifier.clearCache();

      // v3.0: 生成新的设备ID
      const deviceIdentifier = await this.hardwareIdentifier.generateStableDeviceId();
      const newDeviceId = deviceIdentifier.deviceId;

      // 更新配置
      this.config.deviceId = newDeviceId;
      await this.saveConfig();

      this.emit('device-id-regenerated', newDeviceId);
      console.log('[CONFIG] Device ID regenerated:', {
        newId: newDeviceId.substring(0, 12) + '...'
      });

      return newDeviceId;
    } catch (error) {
      console.error('[CONFIG] Failed to regenerate device ID:', error);
      throw error;
    }
  }

  /**
   * 验证当前设备ID
   */
  async validateCurrentDeviceId(): Promise<{
    isValid: boolean;
    reason: string;
    currentId: string;
    expectedId?: string;
  }> {
    try {
      const currentId = this.config.deviceId;
      
      if (!currentId) {
        return {
          isValid: false,
          reason: 'No device ID configured',
          currentId: ''
        };
      }

      const isValid = await this.hardwareIdentifier.validateDeviceId(currentId);
      
      if (isValid) {
        return {
          isValid: true,
          reason: 'Device ID matches current hardware',
          currentId
        };
      } else {
        const expectedIdentifier = await this.hardwareIdentifier.generateStableDeviceId();
        return {
          isValid: false,
          reason: 'Device ID does not match current hardware',
          currentId,
          expectedId: expectedIdentifier.deviceId
        };
      }

    } catch (error) {
      console.error('[CONFIG] Failed to validate device ID:', error);
      return {
        isValid: false,
        reason: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        currentId: this.config.deviceId || ''
      };
    }
  }
}