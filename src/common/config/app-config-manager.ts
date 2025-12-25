/**
 * 应用配置管理器
 *
 * 设计原则：
 * - 首次安装时，将所有默认配置写入配置文件
 * - 配置文件完整可见，用户可直接编辑
 * - 版本升级时，自动补充新增的配置项
 * - 所有配置从配置文件读取，无运行时defaults机制
 * - 配置变更时触发事件，支持热更新
 */

import Store from 'electron-store';
import { app } from 'electron';
import { EventEmitter } from 'events';

interface AppConfiguration {
  // 服务器配置（前端UI配置后才写入，可选）
  baseUrl?: string;

  // 更新配置
  updateEnabled: boolean;
  updateCheckInterval: number;
  updateChannel: 'stable' | 'beta' | 'dev';
  updateAutoDownload: boolean;
  updateAutoInstall: boolean;

  // 热更新配置
  hotUpdateEnabled: boolean;
  hotUpdateFallbackTimeout: number;
  hotUpdateRetryCount: number;

  // 日志配置
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}

const DEFAULT_CONFIG: AppConfiguration = {
  // 默认服务器地址（可通过前端UI修改）
  baseUrl: 'http://23.95.207.162:3000',
  updateEnabled: true,
  updateCheckInterval: 2 * 60 * 1000, // 2分钟
  updateChannel: 'stable',
  updateAutoDownload: true,
  updateAutoInstall: true,
  // 热更新配置
  hotUpdateEnabled: true,
  hotUpdateFallbackTimeout: 120000, // 2分钟
  hotUpdateRetryCount: 2,
  logLevel: 'WARN'
};

export class AppConfigManager extends EventEmitter {
  private store: Store<AppConfiguration>;
  private static instance?: AppConfigManager;

  constructor() {
    super();
    this.store = new Store<AppConfiguration>({
      name: 'app-config', // 配置文件名
      cwd: app.getPath('userData') // 配置文件目录
    });

    // 首次安装时，将默认值写入配置文件
    this.ensureDefaultConfig();
  }

  /**
   * 确保配置文件包含所有默认值
   * 首次安装时写入完整配置，便于用户查看和修改
   */
  private ensureDefaultConfig(): void {
    // 检查配置文件是否为空或缺少配置项
    const currentConfig = this.store.store;
    const hasConfig = Object.keys(currentConfig).length > 0;

    if (!hasConfig) {
      // 首次安装，写入所有默认值
      console.log('[AppConfig] 首次安装，写入默认配置');
      this.store.store = DEFAULT_CONFIG;
    } else {
      // 已有配置，补充缺失的默认值（处理版本升级情况）
      let needUpdate = false;
      const mergedConfig: AppConfiguration = { ...DEFAULT_CONFIG };

      for (const key in DEFAULT_CONFIG) {
        const configKey = key as keyof AppConfiguration;
        if (currentConfig[configKey] !== undefined) {
          (mergedConfig as any)[configKey] = currentConfig[configKey];
        } else {
          needUpdate = true;
        }
      }

      if (needUpdate) {
        console.log('[AppConfig] 补充缺失的配置项');
        this.store.store = mergedConfig;
      }
    }
  }

  static getInstance(): AppConfigManager {
    if (!AppConfigManager.instance) {
      AppConfigManager.instance = new AppConfigManager();
    }
    return AppConfigManager.instance;
  }

  /**
   * 获取配置项
   * 首次安装时已写入配置文件，直接读取即可
   */
  get<K extends keyof AppConfiguration>(key: K): AppConfiguration[K] {
    return this.store.get(key);
  }

  /**
   * 设置配置项（写入配置文件）
   * 注意：baseUrl 变更请使用 setBaseUrl() 以触发热更新事件
   */
  set<K extends keyof AppConfiguration>(key: K, value: AppConfiguration[K]): void {
    this.store.set(key, value);

    // 如果是 baseUrl 变更，触发事件（虽然建议用 setBaseUrl）
    if (key === 'baseUrl') {
      this.emit('config-updated', {
        baseUrl: value,
        serverUrl: value
      });
    }
  }

  /**
   * 批量设置配置
   */
  setMultiple(config: Partial<AppConfiguration>): void {
    Object.entries(config).forEach(([key, value]) => {
      this.store.set(key as keyof AppConfiguration, value);
    });
  }

  /**
   * 获取所有配置（合并后的最终值）
   */
  getAll(): AppConfiguration {
    const config: any = {};

    for (const key in DEFAULT_CONFIG) {
      config[key] = this.get(key as keyof AppConfiguration);
    }

    return config as AppConfiguration;
  }

  /**
   * 重置为默认值
   */
  reset(): void {
    this.store.clear();
  }

  /**
   * 获取配置文件路径
   */
  getConfigFilePath(): string {
    return this.store.path;
  }


  /**
   * 导出配置到文件（用于备份/迁移）
   */
  exportConfig(): AppConfiguration {
    return this.getAll();
  }

  /**
   * 从导出的配置导入（用于还原/迁移）
   */
  importConfig(config: Partial<AppConfiguration>): void {
    this.setMultiple(config);
  }

  /**
   * 获取基础服务器地址
   * 未配置时返回 undefined
   */
  getBaseUrl(): string | undefined {
    return this.store.get('baseUrl');
  }

  /**
   * 设置基础服务器地址
   * 前端UI配置时调用，写入配置文件并触发热更新事件
   */
  setBaseUrl(url: string): void {
    // 移除末尾的斜杠
    const cleanUrl = url.replace(/\/$/, '');
    const oldUrl = this.store.get('baseUrl');

    this.store.set('baseUrl', cleanUrl);

    // 触发配置变更事件（支持热更新）
    if (oldUrl !== cleanUrl) {
      console.log('[AppConfig] baseUrl changed, triggering hot reload', {
        oldUrl,
        newUrl: cleanUrl
      });

      this.emit('config-updated', {
        baseUrl: cleanUrl,
        serverUrl: cleanUrl  // 兼容旧事件监听代码
      });
    }
  }

  /**
   * 获取更新服务器地址
   * 自动拼接：baseUrl + /api/updates
   * 未配置 baseUrl 时返回 undefined
   */
  getUpdateServerUrl(): string | undefined {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return undefined;
    return `${baseUrl}/api/updates`;
  }

  /**
   * 获取数据上报地址
   * 自动拼接：baseUrl + /api/data
   * 未配置 baseUrl 时返回 undefined
   */
  getDataApiUrl(): string | undefined {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return undefined;
    return `${baseUrl}/api/data`;
  }

  /**
   * 获取认证接口地址
   * 自动拼接：baseUrl + /api/auth
   * 未配置 baseUrl 时返回 undefined
   */
  getAuthApiUrl(): string | undefined {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return undefined;
    return `${baseUrl}/api/auth`;
  }

  /**
   * 获取截图上传地址
   * 自动拼接：baseUrl + /api/screenshot
   * 未配置 baseUrl 时返回 undefined
   */
  getScreenshotApiUrl(): string | undefined {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return undefined;
    return `${baseUrl}/api/screenshot`;
  }

  /**
   * 获取WebSocket连接地址
   * 自动转换：http → ws, https → wss
   * 未配置 baseUrl 时返回 undefined
   * 设备客户端连接到 /client namespace（不需要JWT token，只需deviceId）
   */
  getWebSocketUrl(): string | undefined {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return undefined;
    const wsUrl = baseUrl.replace(/^http/, 'ws');
    return `${wsUrl}/client`;  // 连接到客户端专用namespace
  }

  /**
   * 获取所有API地址（调试用）
   */
  getAllUrls(): {
    base: string | undefined;
    update: string | undefined;
    data: string | undefined;
    auth: string | undefined;
    screenshot: string | undefined;
    websocket: string | undefined;
  } {
    return {
      base: this.getBaseUrl(),
      update: this.getUpdateServerUrl(),
      data: this.getDataApiUrl(),
      auth: this.getAuthApiUrl(),
      screenshot: this.getScreenshotApiUrl(),
      websocket: this.getWebSocketUrl()
    };
  }

  /**
   * 验证URL格式
   */
  validateUrl(url: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);

      // 只允许 http 和 https
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          valid: false,
          error: '只支持 http:// 或 https:// 协议'
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: 'URL格式不正确，请输入完整地址（如 http://server.com:3000）'
      };
    }
  }

  /**
   * 验证配置有效性
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = this.getAll();

    // 验证 baseUrl（如果已配置）
    if (config.baseUrl) {
      const urlValidation = this.validateUrl(config.baseUrl);
      if (!urlValidation.valid) {
        errors.push(`Invalid baseUrl: ${urlValidation.error}`);
      }
    }

    // 验证时间间隔
    if (config.updateCheckInterval < 60000) { // 最小1分钟
      errors.push('updateCheckInterval must be at least 60000ms (1 minute)');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// 导出单例
export const appConfig = AppConfigManager.getInstance();

// 便捷函数
export function getConfig<K extends keyof AppConfiguration>(key: K): AppConfiguration[K] {
  return appConfig.get(key);
}

export function setConfig<K extends keyof AppConfiguration>(key: K, value: AppConfiguration[K]): void {
  appConfig.set(key, value);
}

export function getAllConfig(): AppConfiguration {
  return appConfig.getAll();
}
