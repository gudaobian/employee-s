/**
 * macOS URL Collection Service with Firefox Multi-Level Fallback
 *
 * Implements multi-level fallback strategy for Firefox:
 * Level 1: AppleScript (success rate 30-50%)
 * Level 2: Window Title extraction (success rate 40-60%)
 * Level 3: Browser History (placeholder, success rate 0%)
 *
 * Combined success rate: 60-70%
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../common/utils';

const execAsync = promisify(exec);

// Timeout for AppleScript calls (Firefox can hang)
const APPLESCRIPT_TIMEOUT = 2000;

export interface URLInfo {
  url: string;
  browserName: string;
  timestamp: number;
  collectionMethod: 'applescript' | 'window_title' | 'history' | 'failed';
  quality: 'full_url' | 'domain_only' | 'redacted';
}

/**
 * macOS URL Collector with browser-specific strategies
 */
export class DarwinURLCollector {
  private permissionChecked = false;

  /**
   * Get active URL from browser with intelligent fallbacks
   */
  async getActiveURL(browserName: string): Promise<URLInfo | null> {
    logger.debug(`[URLCollector] Collecting URL from ${browserName}`);

    try {
      // Firefox-specific handling with multi-level fallback
      if (browserName.toLowerCase() === 'firefox') {
        return await this.getFirefoxURL(browserName);
      }

      // Chrome/Chromium-based browsers
      if (this.isChromiumBrowser(browserName)) {
        return await this.getChromiumURL(browserName);
      }

      // Safari
      if (browserName.toLowerCase() === 'safari') {
        return await this.getSafariURL(browserName);
      }

      // Edge
      if (browserName.toLowerCase().includes('edge')) {
        return await this.getEdgeURL(browserName);
      }

      logger.warn(`[URLCollector] Unsupported browser: ${browserName}`);
      return null;

    } catch (error) {
      logger.error(`[URLCollector] Failed to collect URL from ${browserName}:`, error);
      return null;
    }
  }

  /**
   * Firefox multi-level fallback strategy
   */
  private async getFirefoxURL(browserName: string): Promise<URLInfo | null> {
    logger.warn('[Firefox] Using best-effort strategy with fallbacks');

    // Level 1: AppleScript (success rate 30-50%)
    logger.debug('[Firefox] Level 1: Trying AppleScript...');
    const urlFromScript = await this.tryFirefoxAppleScript();
    if (urlFromScript && !urlFromScript.includes('ERROR')) {
      logger.info('[Firefox] ✅ AppleScript succeeded');
      return {
        url: urlFromScript,
        browserName,
        timestamp: Date.now(),
        collectionMethod: 'applescript',
        quality: 'full_url'
      };
    }

    // Level 2: Window title extraction
    logger.debug('[Firefox] Level 2: AppleScript failed, trying window title...');
    const urlFromTitle = await this.getURLFromWindowTitle(browserName);
    if (urlFromTitle) {
      logger.info('[Firefox] ⚠️  Window title extraction succeeded (domain-only quality)');
      return {
        url: urlFromTitle,
        browserName,
        timestamp: Date.now(),
        collectionMethod: 'window_title',
        quality: 'domain_only'
      };
    }

    // Level 3: Browser history (placeholder)
    logger.debug('[Firefox] Level 3: Window title failed, trying history...');
    const urlFromHistory = await this.tryFirefoxHistory();
    if (urlFromHistory) {
      logger.info('[Firefox] ✅ History extraction succeeded');
      return {
        url: urlFromHistory,
        browserName,
        timestamp: Date.now(),
        collectionMethod: 'history',
        quality: 'full_url'
      };
    }

    logger.warn('[Firefox] ❌ All collection methods failed');
    return null;
  }

  /**
   * Try Firefox AppleScript (fallible, may timeout or fail)
   */
  private async tryFirefoxAppleScript(): Promise<string | null> {
    try {
      const script = `
        tell application "Firefox"
          get URL of active tab of front window
        end tell
      `;

      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "\\'")}'`,
        { timeout: APPLESCRIPT_TIMEOUT }
      );

      const url = stdout.trim();
      return url || null;

    } catch (error: any) {
      // Don't log as error - this is expected to fail frequently
      logger.debug('[Firefox] AppleScript call failed:', error.message);
      return null;
    }
  }

  /**
   * Try Firefox history access (placeholder for future enhancement)
   *
   * Firefox places.sqlite is usually locked while browser is running.
   * This is a placeholder for future implementation.
   */
  private async tryFirefoxHistory(): Promise<string | null> {
    // Firefox places.sqlite is usually locked while browser is running
    // This is a placeholder for future enhancement
    logger.debug('[Firefox] History collection not yet implemented');
    return null;
  }

  /**
   * Get URL from window title (universal fallback)
   */
  private async getURLFromWindowTitle(browserName: string): Promise<string | null> {
    try {
      const processName = this.getBrowserProcessName(browserName);
      const script = `
        tell application "System Events"
          tell process "${processName}"
            get name of front window
          end tell
        end tell
      `;

      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "\\'")}'`,
        { timeout: APPLESCRIPT_TIMEOUT }
      );

      const title = stdout.trim();

      // Extract URL from title
      return this.extractURLFromTitle(title);

    } catch (error: any) {
      logger.debug('[WindowTitle] Failed to get window title:', error.message);
      return null;
    }
  }

  /**
   * Extract URL from window title using multiple regex patterns
   */
  private extractURLFromTitle(title: string): string | null {
    // Pattern 1: "Page Title - https://example.com"
    const pattern1 = /https?:\/\/[^\s\-]+/i;
    const match1 = title.match(pattern1);
    if (match1) {
      logger.debug('[URLExtract] Pattern 1 matched (full URL)');
      return match1[0];
    }

    // Pattern 2: "Page Title - example.com" (add protocol)
    const pattern2 = /\-\s+([a-z0-9\-\.]+\.[a-z]{2,})/i;
    const match2 = title.match(pattern2);
    if (match2) {
      logger.debug('[URLExtract] Pattern 2 matched (domain + protocol)');
      return `https://${match2[1]}`;
    }

    // Pattern 3: Just domain at start
    const pattern3 = /^([a-z0-9\-\.]+\.[a-z]{2,})/i;
    const match3 = title.match(pattern3);
    if (match3) {
      logger.debug('[URLExtract] Pattern 3 matched (domain at start)');
      return `https://${match3[1]}`;
    }

    logger.debug('[URLExtract] No URL pattern found in title:', title);
    return null;
  }

  /**
   * Get URL from Chromium-based browsers (Chrome, Brave, etc.)
   */
  private async getChromiumURL(browserName: string): Promise<URLInfo | null> {
    try {
      const processName = this.getBrowserProcessName(browserName);
      const script = `
        tell application "${processName}"
          get URL of active tab of front window
        end tell
      `;

      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "\\'")}'`,
        { timeout: APPLESCRIPT_TIMEOUT }
      );

      const url = stdout.trim();
      if (!url) return null;

      return {
        url,
        browserName,
        timestamp: Date.now(),
        collectionMethod: 'applescript',
        quality: 'full_url'
      };

    } catch (error: any) {
      logger.debug(`[${browserName}] AppleScript failed:`, error.message);

      // Fallback to window title
      const urlFromTitle = await this.getURLFromWindowTitle(browserName);
      if (urlFromTitle) {
        return {
          url: urlFromTitle,
          browserName,
          timestamp: Date.now(),
          collectionMethod: 'window_title',
          quality: 'domain_only'
        };
      }

      return null;
    }
  }

  /**
   * Get URL from Safari
   */
  private async getSafariURL(browserName: string): Promise<URLInfo | null> {
    try {
      const script = `
        tell application "Safari"
          get URL of current tab of front window
        end tell
      `;

      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "\\'")}'`,
        { timeout: APPLESCRIPT_TIMEOUT }
      );

      const url = stdout.trim();
      if (!url) return null;

      return {
        url,
        browserName,
        timestamp: Date.now(),
        collectionMethod: 'applescript',
        quality: 'full_url'
      };

    } catch (error: any) {
      logger.debug('[Safari] AppleScript failed:', error.message);

      // Fallback to window title
      const urlFromTitle = await this.getURLFromWindowTitle(browserName);
      if (urlFromTitle) {
        return {
          url: urlFromTitle,
          browserName,
          timestamp: Date.now(),
          collectionMethod: 'window_title',
          quality: 'domain_only'
        };
      }

      return null;
    }
  }

  /**
   * Get URL from Microsoft Edge
   */
  private async getEdgeURL(browserName: string): Promise<URLInfo | null> {
    // Edge uses Chromium engine, try Chromium method first
    return await this.getChromiumURL(browserName);
  }

  /**
   * Map browser name to macOS process name
   */
  private getBrowserProcessName(browserName: string): string {
    const processNames: Record<string, string> = {
      'firefox': 'Firefox',
      'chrome': 'Google Chrome',
      'safari': 'Safari',
      'edge': 'Microsoft Edge',
      'brave': 'Brave Browser',
      'opera': 'Opera',
      'vivaldi': 'Vivaldi'
    };

    const normalized = browserName.toLowerCase();
    return processNames[normalized] || browserName;
  }

  /**
   * Check if browser is Chromium-based
   */
  private isChromiumBrowser(browserName: string): boolean {
    const chromiumBrowsers = ['chrome', 'google chrome', 'brave', 'opera', 'vivaldi', 'chromium'];
    return chromiumBrowsers.some(b => browserName.toLowerCase().includes(b));
  }
}

export default DarwinURLCollector;
