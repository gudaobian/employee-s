/**
 * URL采集服务 - 跨平台浏览器URL采集
 * 集成隐私保护、权限检测、多浏览器支持
 */

import { EventEmitter } from 'events';
import { logger } from '../utils';
import { sanitizeUrl } from '../utils/privacy-helper';
import type { PrivacyConfig } from '../utils/privacy-helper';
import { DEFAULT_PRIVACY_CONFIG } from '../config/privacy-config';
import { logURLCollected, logURLCollectFailed } from '../utils/url-collect-logger';

export interface URLInfo {
  url: string;
  browserName: string;
  timestamp: number;
  collectionMethod?: 'applescript' | 'window_title' | 'ui_automation' | 'history';
  quality?: 'full_url' | 'domain_only' | 'redacted';
  privacyLevel?: 'full' | 'domain_only' | 'redacted';
}

export class URLCollectorService extends EventEmitter {
  private platformAdapter: any; // 平台适配器
  private privacyConfig: PrivacyConfig;
  private isInitialized = false;

  constructor() {
    super();
    this.privacyConfig = DEFAULT_PRIVACY_CONFIG;
  }

  /**
   * 初始化服务
   */
  async initialize(platformAdapter: any): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[URLCollector] Already initialized');
      return;
    }

    this.platformAdapter = platformAdapter;
    this.isInitialized = true;
    logger.info('[URLCollector] Service initialized');
  }

  /**
   * 采集当前活动窗口的URL
   */
  async collectActiveURL(): Promise<URLInfo | null> {
    if (!this.isInitialized) {
      logger.error('[URLCollector] Service not initialized');
      return null;
    }

    try {
      // 1. 获取活动窗口信息
      const activeWindow = await this.platformAdapter.getActiveWindow();
      if (!activeWindow) {
        return null;
      }

      // 2. 检查是否为浏览器
      const browserName = this.detectBrowser(activeWindow.application);
      if (!browserName) {
        return null; // 不是浏览器，不采集
      }

      // 3. 获取原始URL
      const rawUrl = await this.platformAdapter.getActiveURL?.(browserName);
      if (!rawUrl) {
        logger.debug(`[URLCollector] Failed to get URL for ${browserName}`);
        logURLCollectFailed(browserName, 'Failed to get URL from platform adapter');
        return null;
      }

      // 4. 应用隐私保护
      const sanitizedUrl = sanitizeUrl(rawUrl, this.privacyConfig);

      // 5. 返回URL信息
      const urlInfo: URLInfo = {
        url: sanitizedUrl,
        browserName,
        timestamp: Date.now(),
        privacyLevel: this.getPrivacyLevel(sanitizedUrl)
      };

      // 6. 记录到URL采集日志
      logURLCollected(browserName, sanitizedUrl, {
        collectionMethod: urlInfo.collectionMethod,
        quality: urlInfo.quality,
        privacyLevel: urlInfo.privacyLevel
      });

      logger.debug(`[URLCollector] Collected URL: ${browserName} - ${sanitizedUrl}`);
      return urlInfo;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('[URLCollector] Error collecting URL:', error);

      // 记录采集失败
      const activeWindow = await this.platformAdapter.getActiveWindow?.();
      const browserName = activeWindow ? this.detectBrowser(activeWindow.application) : 'Unknown';
      if (browserName) {
        logURLCollectFailed(browserName, errorMsg);
      }

      return null;
    }
  }

  /**
   * 检测应用是否为浏览器
   */
  private detectBrowser(appName: string): string | null {
    if (!appName) return null;

    const lowerAppName = appName.toLowerCase();
    const browsers = [
      { names: ['safari'], browser: 'Safari' },
      { names: ['chrome', 'google chrome'], browser: 'Chrome' },
      { names: ['firefox'], browser: 'Firefox' },
      { names: ['edge', 'microsoft edge'], browser: 'Edge' },
      { names: ['brave'], browser: 'Brave' },
      { names: ['opera'], browser: 'Opera' }
    ];

    for (const { names, browser } of browsers) {
      if (names.some(name => lowerAppName.includes(name))) {
        return browser;
      }
    }

    return null;
  }

  /**
   * 获取隐私等级
   */
  private getPrivacyLevel(url: string): 'full' | 'domain_only' | 'redacted' {
    if (url.startsWith('[REDACTED')) return 'redacted';
    if (url.includes('?')) return 'domain_only';
    return 'full';
  }

  /**
   * 更新隐私配置
   */
  setPrivacyConfig(config: Partial<PrivacyConfig>): void {
    this.privacyConfig = { ...this.privacyConfig, ...config };
    logger.info('[URLCollector] Privacy config updated');
  }

  /**
   * 获取当前隐私配置
   */
  getPrivacyConfig(): PrivacyConfig {
    return { ...this.privacyConfig };
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    this.isInitialized = false;
    this.removeAllListeners();
    logger.info('[URLCollector] Service destroyed');
  }
}
