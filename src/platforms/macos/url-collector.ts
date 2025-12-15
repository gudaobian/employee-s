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
  collectionMethod: 'applescript' | 'applescript_title_match' | 'applescript_visible_window' | 'window_title' | 'history' | 'failed';
  quality: 'full_url' | 'domain_only' | 'redacted';
}

/**
 * macOS URL Collector with browser-specific strategies
 */
export class DarwinURLCollector {
  private permissionChecked = false;

  /**
   * Get active URL from browser with intelligent fallbacks
   * CRITICAL: windowTitle used for accurate tab matching in multi-window browsers
   *
   * @param browserName - Browser name (Chrome, Safari, Firefox, etc.)
   * @param windowTitle - Window title from getActiveWindow() for tab matching
   * @returns URLInfo if successful, null if failed
   */
  async getActiveURL(browserName: string, windowTitle?: string): Promise<URLInfo | null> {
    logger.debug(`[URLCollector] Collecting URL from ${browserName}${windowTitle ? ' with title: ' + windowTitle : ''}`);

    try {
      // Firefox-specific handling with multi-level fallback
      if (browserName.toLowerCase() === 'firefox') {
        return await this.getFirefoxURL(browserName);
      }

      // Chrome/Chromium-based browsers
      if (this.isChromiumBrowser(browserName)) {
        return await this.getChromiumURL(browserName, windowTitle);
      }

      // Safari
      if (browserName.toLowerCase() === 'safari') {
        return await this.getSafariURL(browserName);
      }

      // Edge
      if (browserName.toLowerCase().includes('edge')) {
        return await this.getEdgeURL(browserName, windowTitle);
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
   * CRITICAL: Use window title to match the correct Chrome window
   * Chrome may have multiple windows, "front window" may not be the user's active window
   */
  private async getChromiumURL(browserName: string, windowTitle?: string): Promise<URLInfo | null> {
    try {
      const processName = this.getBrowserProcessName(browserName);

      // 调试日志：查看收到的 windowTitle 参数
      logger.info(`[${browserName}] getChromiumURL called with windowTitle: "${windowTitle}"`);

      // 新策略：遍历所有窗口，匹配active tab的标题与系统窗口标题
      // 这样可以准确获取用户正在查看的窗口的URL，避免多窗口混淆
      if (windowTitle && windowTitle.trim() !== '') {
        const cleanTitle = windowTitle.replace(/ - (Google Chrome|Brave|Microsoft Edge)$/, '').trim();
        logger.info(`[${browserName}] Cleaned window title: "${cleanTitle}"`);

        if (cleanTitle !== '') {
          logger.info(`[${browserName}] Using window-match strategy with title: "${cleanTitle}"`);

          // 遍历所有窗口，找到active tab标题匹配的窗口
          const script = `
            tell application "${processName}"
              set targetTitle to "${cleanTitle.replace(/"/g, '\\"')}"
              set foundURL to ""
              set debugInfo to ""

              repeat with w in windows
                try
                  set tabCount to count of tabs of w

                  -- 遍历当前窗口的所有标签页(使用索引)
                  repeat with i from 1 to tabCount
                    try
                      set currentTab to tab i of w
                      set tabTitle to title of currentTab

                      -- 记录每个tab的标题用于调试
                      if debugInfo is "" then
                        set debugInfo to "TAB_TITLES:" & tabTitle
                      else
                        set debugInfo to debugInfo & "|" & tabTitle
                      end if

                      -- 检查标题是否匹配（双向包含检查）
                      if tabTitle contains targetTitle or targetTitle contains tabTitle then
                        set foundURL to URL of currentTab & "|||MATCHED:" & tabTitle
                        exit repeat
                      end if
                    on error tabErr
                      -- 某些标签页可能无法访问,记录错误但继续
                      set debugInfo to debugInfo & "|TAB_ERROR"
                    end try
                  end repeat

                  -- 如果找到了匹配的URL,退出窗口循环
                  if foundURL is not "" then
                    exit repeat
                  end if
                on error errMsg
                  -- 记录窗口级别错误
                  if debugInfo is "" then
                    set debugInfo to "WINDOW_ERROR:" & errMsg
                  else
                    set debugInfo to debugInfo & "|WINDOW_ERROR:" & errMsg
                  end if
                end try
              end repeat

              if foundURL is "" then
                return debugInfo
              else
                return foundURL
              end if
            end tell
          `;

          const { stdout } = await execAsync(
            `osascript -e '${script.replace(/'/g, "\\'")}'`,
            { timeout: APPLESCRIPT_TIMEOUT }
          );

          const result = stdout.trim();

          // 解析调试信息或URL
          if (result.includes('|||MATCHED:')) {
            const [url, matchInfo] = result.split('|||MATCHED:');
            logger.info(`[${browserName}] ✅ Found matching window, matched tab title: "${matchInfo}", URL: ${url}`);
            return {
              url,
              browserName,
              timestamp: Date.now(),
              collectionMethod: 'applescript_title_match',
              quality: 'full_url'
            };
          } else if (result.startsWith('TAB_TITLES:')) {
            // 记录所有找到的tab标题
            const titles = result.replace('TAB_TITLES:', '').split('|');
            logger.warn(`[${browserName}] ⚠️  No window matched title "${cleanTitle}"`);
            logger.info(`[${browserName}] Found ${titles.length} tabs with titles: ${titles.join(', ')}`);
          } else if (result.startsWith('ERROR:')) {
            logger.error(`[${browserName}] ❌ AppleScript errors: ${result}`);
          }

          logger.warn(`[${browserName}] Falling back to visible window strategy...`);
        }
      }

      // 回退策略：获取第一个可见窗口的active tab
      logger.warn(`[${browserName}] Using visible window fallback strategy`);
      const script = `
        tell application "${processName}"
          set visibleWindows to (every window whose visible is true)
          if (count of visibleWindows) > 0 then
            set firstVisibleWindow to item 1 of visibleWindows
            return URL of active tab of firstVisibleWindow
          end if
          return ""
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
        collectionMethod: 'applescript_visible_window',
        quality: 'full_url'
      };

    } catch (error: any) {
      logger.debug(`[${browserName}] AppleScript failed:`, error.message);

      // 最终回退：从窗口标题提取URL
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
   * CRITICAL: Use visible windows strategy to avoid "front window" trap
   */
  private async getSafariURL(browserName: string): Promise<URLInfo | null> {
    try {
      const script = `
        tell application "Safari"
          set visibleWindows to (every window whose visible is true)
          if (count of visibleWindows) > 0 then
            set firstVisibleWindow to item 1 of visibleWindows
            return URL of current tab of firstVisibleWindow
          end if
          return ""
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
        collectionMethod: 'applescript_visible_window',
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
  private async getEdgeURL(browserName: string, windowTitle?: string): Promise<URLInfo | null> {
    // Edge uses Chromium engine, try Chromium method first
    return await this.getChromiumURL(browserName, windowTitle);
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
