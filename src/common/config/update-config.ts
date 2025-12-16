/**
 * Update Configuration Service
 *
 * 配置优先级（从高到低）：
 * 1. 配置文件（electron-store）- 用户/管理员/安装时写入
 * 2. 注册表/Plist（企业部署）
 * 3. 默认值（硬编码）
 *
 * 不再使用环境变量，改用专业的企业部署方案
 */

import Store from 'electron-store';
import { app } from 'electron';

export interface UpdateConfig {
  enabled: boolean;
  checkInterval: number;
  updateServerUrl: string;
  channel: 'stable' | 'beta' | 'dev';
  autoDownload: boolean;
  autoInstallOnQuit: boolean;
}

// 默认配置
const DEFAULT_CONFIG: UpdateConfig = {
  enabled: true,
  checkInterval: 2 * 60 * 1000, // 2分钟
  updateServerUrl: 'http://23.95.193.155:3000/api/updates',
  channel: 'stable',
  autoDownload: true,
  autoInstallOnQuit: true
};

export class UpdateConfigService {
  private store: Store<UpdateConfig>;
  private config: UpdateConfig;

  constructor() {
    // 初始化配置存储
    this.store = new Store<UpdateConfig>({
      name: 'update-config',
      defaults: DEFAULT_CONFIG,
      cwd: app.getPath('userData')
    });

    this.config = this.loadConfig();
  }

  /**
   * 加载配置
   * 优先级：配置文件 > 注册表/Plist > 默认值
   */
  private loadConfig(): UpdateConfig {
    const config: UpdateConfig = {
      enabled: this.getConfigValue('enabled'),
      checkInterval: this.getConfigValue('checkInterval'),
      updateServerUrl: this.getConfigValue('updateServerUrl'),
      channel: this.getConfigValue('channel'),
      autoDownload: this.getConfigValue('autoDownload'),
      autoInstallOnQuit: this.getConfigValue('autoInstallOnQuit')
    };

    return config;
  }

  /**
   * 获取配置项
   * 优先级：配置文件 > 注册表 > 默认值
   */
  private getConfigValue<K extends keyof UpdateConfig>(key: K): UpdateConfig[K] {
    // 1. 从配置文件读取
    const fileValue = this.store.get(key);
    if (fileValue !== undefined) {
      return fileValue;
    }

    // 2. 从注册表/Plist读取（企业部署）
    const registryValue = this.getFromRegistry(key);
    if (registryValue !== undefined) {
      return registryValue;
    }

    // 3. 使用默认值
    return DEFAULT_CONFIG[key];
  }

  /**
   * 从注册表/Plist读取配置（企业部署支持）
   * Windows: HKLM\SOFTWARE\EmployeeMonitor
   * macOS: /Library/Preferences/com.employee-monitor.plist
   */
  private getFromRegistry<K extends keyof UpdateConfig>(key: K): UpdateConfig[K] | undefined {
    try {
      if (process.platform === 'win32') {
        // Windows 注册表读取
        const { execSync } = require('child_process');
        const keyMap: Record<string, string> = {
          updateServerUrl: 'UpdateServerUrl',
          channel: 'Channel',
          enabled: 'Enabled',
          checkInterval: 'CheckInterval',
          autoDownload: 'AutoDownload',
          autoInstallOnQuit: 'AutoInstallOnQuit'
        };

        const regKey = keyMap[key];
        if (!regKey) return undefined;

        const cmd = `reg query "HKLM\\SOFTWARE\\EmployeeMonitor" /v ${regKey}`;
        const output = execSync(cmd, { encoding: 'utf-8' });

        // 解析注册表输出
        const match = output.match(/REG_SZ\s+(.+)/);
        if (match && match[1]) {
          return this.parseValue(key, match[1].trim());
        }
      } else if (process.platform === 'darwin') {
        // macOS Plist 读取
        const { execSync } = require('child_process');
        const plistPath = '/Library/Preferences/com.employee-monitor.plist';

        try {
          const cmd = `defaults read ${plistPath} ${key}`;
          const output = execSync(cmd, { encoding: 'utf-8' }).trim();
          return this.parseValue(key, output);
        } catch {
          // Plist key 不存在
          return undefined;
        }
      }
    } catch (error) {
      // 注册表/Plist 读取失败，忽略
      return undefined;
    }

    return undefined;
  }

  /**
   * 解析配置值
   */
  private parseValue<K extends keyof UpdateConfig>(key: K, value: string): UpdateConfig[K] {
    switch (key) {
      case 'enabled':
      case 'autoDownload':
      case 'autoInstallOnQuit':
        return (value === 'true' || value === '1') as UpdateConfig[K];

      case 'checkInterval':
        return parseInt(value, 10) as UpdateConfig[K];

      case 'channel':
        const channel = value.toLowerCase();
        if (channel === 'stable' || channel === 'beta' || channel === 'dev') {
          return channel as UpdateConfig[K];
        }
        return DEFAULT_CONFIG.channel as UpdateConfig[K];

      default:
        return value as UpdateConfig[K];
    }
  }

  /**
   * Parse boolean environment variable
   */
  private parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    return value === 'true' || value === '1';
  }

  /**
   * Parse number environment variable
   */
  private parseNumber(value: string | undefined, defaultValue: number): number {
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Parse update channel
   */
  private parseChannel(
    value: string | undefined,
    defaultValue: 'stable' | 'beta' | 'dev'
  ): 'stable' | 'beta' | 'dev' {
    if (!value) return defaultValue;

    const channel = value.toLowerCase();
    if (channel === 'stable' || channel === 'beta' || channel === 'dev') {
      return channel;
    }

    return defaultValue;
  }

  /**
   * Get current configuration
   */
  getConfig(): UpdateConfig {
    return { ...this.config };
  }

  /**
   * Update server URL
   */
  setUpdateServerUrl(url: string): void {
    this.config.updateServerUrl = url;
  }

  /**
   * Set update channel
   */
  setChannel(channel: 'stable' | 'beta' | 'dev'): void {
    this.config.channel = channel;
  }

  /**
   * Set auto-download preference
   */
  setAutoDownload(enabled: boolean): void {
    this.config.autoDownload = enabled;
  }

  /**
   * Set auto-install preference
   */
  setAutoInstallOnQuit(enabled: boolean): void {
    this.config.autoInstallOnQuit = enabled;
  }

  /**
   * Set check interval
   */
  setCheckInterval(intervalMs: number): void {
    if (intervalMs < 60000) {
      throw new Error('Check interval must be at least 1 minute (60000ms)');
    }
    this.config.checkInterval = intervalMs;
  }

  /**
   * Enable or disable updates
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}
