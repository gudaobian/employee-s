/**
 * Linux URL Collector
 * 使用多种方法获取浏览器当前 URL
 *
 * 方法优先级：
 * 1. AT-SPI (Accessibility) - 最可靠，直接读取地址栏
 * 2. xdotool + 剪贴板 - 备用方案，模拟 Ctrl+L, Ctrl+C
 * 3. 窗口标题解析 - 最后手段，某些浏览器会在标题中显示 URL
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../common/utils';

const execAsync = promisify(exec);

export interface LinuxURLInfo {
  url: string;
  browser: string;
  collectionMethod: 'atspi' | 'xdotool-clipboard' | 'window-title' | 'dbus';
  quality: 'high' | 'medium' | 'low';
  timestamp: number;
}

interface BrowserConfig {
  processNames: string[];
  addressBarRole: string[];  // AT-SPI role names for address bar
  addressBarName: string[];  // AT-SPI accessible name patterns
  supportsAtspi: boolean;
}

const BROWSER_CONFIGS: Record<string, BrowserConfig> = {
  'Chrome': {
    processNames: ['chrome', 'google-chrome', 'chromium', 'chromium-browser'],
    addressBarRole: ['entry', 'text'],
    addressBarName: ['Address and search bar', 'Address', '地址和搜索栏', '地址栏'],
    supportsAtspi: true
  },
  'Firefox': {
    processNames: ['firefox', 'firefox-esr'],
    addressBarRole: ['entry', 'text', 'combo box'],
    addressBarName: ['Search with Google or enter address', 'Search or enter address', '使用 Google 搜索或输入网址'],
    supportsAtspi: true
  },
  'Edge': {
    processNames: ['msedge', 'microsoft-edge', 'microsoft-edge-stable'],
    addressBarRole: ['entry', 'text'],
    addressBarName: ['Address and search bar', 'Address', '地址和搜索栏'],
    supportsAtspi: true
  },
  'Brave': {
    processNames: ['brave', 'brave-browser'],
    addressBarRole: ['entry', 'text'],
    addressBarName: ['Address and search bar', 'Address'],
    supportsAtspi: true
  },
  'Opera': {
    processNames: ['opera'],
    addressBarRole: ['entry', 'text'],
    addressBarName: ['Address and search bar', 'Address field'],
    supportsAtspi: true
  }
};

export class LinuxURLCollector {
  private atspiAvailable: boolean | null = null;
  private xdotoolAvailable: boolean | null = null;
  private xclipAvailable: boolean | null = null;
  private lastClipboardContent: string = '';

  constructor() {
    this.checkToolAvailability();
  }

  /**
   * 检查可用的工具
   */
  private async checkToolAvailability(): Promise<void> {
    // 检查 AT-SPI 工具
    try {
      await execAsync('which python3');
      // 检查 python3-atspi 是否可用
      const { stdout } = await execAsync('python3 -c "import gi; gi.require_version(\'Atspi\', \'2.0\')" 2>&1 || echo "not available"');
      this.atspiAvailable = !stdout.includes('not available') && !stdout.includes('Error');
      logger.info(`[LinuxURLCollector] AT-SPI available: ${this.atspiAvailable}`);
    } catch {
      this.atspiAvailable = false;
      logger.info('[LinuxURLCollector] AT-SPI not available');
    }

    // 检查 xdotool
    try {
      await execAsync('which xdotool');
      this.xdotoolAvailable = true;
    } catch {
      this.xdotoolAvailable = false;
    }

    // 检查 xclip
    try {
      await execAsync('which xclip');
      this.xclipAvailable = true;
    } catch {
      this.xclipAvailable = false;
    }

    logger.info(`[LinuxURLCollector] Tool availability: atspi=${this.atspiAvailable}, xdotool=${this.xdotoolAvailable}, xclip=${this.xclipAvailable}`);
  }

  /**
   * 获取浏览器当前 URL
   */
  async getActiveURL(browserName: string, windowTitle?: string): Promise<LinuxURLInfo | null> {
    const normalizedBrowser = this.normalizeBrowserName(browserName);
    if (!normalizedBrowser) {
      logger.debug(`[LinuxURLCollector] Unknown browser: ${browserName}`);
      return null;
    }

    logger.info(`[LinuxURLCollector] Getting URL for ${normalizedBrowser}, windowTitle: "${windowTitle || ''}"`);

    // 方法 1: AT-SPI (最可靠)
    if (this.atspiAvailable) {
      try {
        const url = await this.getURLViaAtspi(normalizedBrowser);
        if (url && this.isValidURL(url)) {
          logger.info(`[LinuxURLCollector] ✅ Got URL via AT-SPI: ${url}`);
          return {
            url,
            browser: normalizedBrowser,
            collectionMethod: 'atspi',
            quality: 'high',
            timestamp: Date.now()
          };
        }
      } catch (error) {
        logger.debug(`[LinuxURLCollector] AT-SPI failed:`, error);
      }
    }

    // 方法 2: xdotool + 剪贴板 (有副作用，但比较可靠)
    if (this.xdotoolAvailable && this.xclipAvailable && process.env.DISPLAY) {
      try {
        const url = await this.getURLViaClipboard(normalizedBrowser);
        if (url && this.isValidURL(url)) {
          logger.info(`[LinuxURLCollector] ✅ Got URL via clipboard: ${url}`);
          return {
            url,
            browser: normalizedBrowser,
            collectionMethod: 'xdotool-clipboard',
            quality: 'medium',
            timestamp: Date.now()
          };
        }
      } catch (error) {
        logger.debug(`[LinuxURLCollector] Clipboard method failed:`, error);
      }
    }

    // 方法 3: 窗口标题解析 (最后手段)
    if (windowTitle) {
      const url = this.extractURLFromTitle(windowTitle);
      if (url) {
        logger.info(`[LinuxURLCollector] ✅ Got URL from window title: ${url}`);
        return {
          url,
          browser: normalizedBrowser,
          collectionMethod: 'window-title',
          quality: 'low',
          timestamp: Date.now()
        };
      }
    }

    logger.debug(`[LinuxURLCollector] Failed to get URL for ${normalizedBrowser}`);
    return null;
  }

  /**
   * 使用 AT-SPI 获取 URL
   */
  private async getURLViaAtspi(browserName: string): Promise<string | null> {
    const config = BROWSER_CONFIGS[browserName];
    if (!config) return null;

    // Python 脚本通过 AT-SPI 获取地址栏内容
    const pythonScript = `
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
import sys

def find_address_bar(obj, depth=0, max_depth=15):
    """递归查找地址栏元素"""
    if depth > max_depth:
        return None

    try:
        role = obj.get_role_name()
        name = obj.get_name() or ''

        # 检查是否是地址栏
        if role in ['entry', 'text', 'combo box']:
            # 检查名称是否匹配
            address_bar_names = ${JSON.stringify(config.addressBarName)}
            for pattern in address_bar_names:
                if pattern.lower() in name.lower():
                    # 获取文本内容
                    try:
                        text_iface = obj.get_text()
                        if text_iface:
                            text = text_iface.get_text(0, text_iface.get_character_count())
                            if text and ('http' in text or 'www.' in text or '.' in text):
                                return text
                    except:
                        pass

        # 递归检查子元素
        for i in range(obj.get_child_count()):
            child = obj.get_child_at_index(i)
            if child:
                result = find_address_bar(child, depth + 1, max_depth)
                if result:
                    return result
    except Exception as e:
        pass

    return None

def main():
    # 获取桌面
    desktop = Atspi.get_desktop(0)

    # 查找浏览器窗口
    process_names = ${JSON.stringify(config.processNames)}

    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if not app:
            continue

        app_name = (app.get_name() or '').lower()

        # 检查是否是目标浏览器
        is_target = any(pn in app_name for pn in process_names)
        if not is_target:
            continue

        # 在浏览器窗口中查找地址栏
        result = find_address_bar(app)
        if result:
            print(result)
            return

    sys.exit(1)

if __name__ == '__main__':
    main()
`;

    try {
      const { stdout } = await execAsync(
        `python3 -c ${JSON.stringify(pythonScript)} 2>/dev/null`,
        { timeout: 5000 }
      );

      const url = stdout.trim();
      if (url && url.length > 0) {
        return this.normalizeURL(url);
      }
    } catch (error) {
      logger.debug(`[LinuxURLCollector] AT-SPI script error:`, error);
    }

    return null;
  }

  /**
   * 使用 xdotool + 剪贴板获取 URL
   * 注意：此方法有副作用，会修改剪贴板内容
   */
  private async getURLViaClipboard(browserName: string): Promise<string | null> {
    try {
      // 保存当前剪贴板内容
      try {
        const { stdout } = await execAsync('xclip -selection clipboard -o 2>/dev/null', { timeout: 1000 });
        this.lastClipboardContent = stdout;
      } catch {
        this.lastClipboardContent = '';
      }

      // 获取当前活动窗口
      const { stdout: windowId } = await execAsync('xdotool getactivewindow', { timeout: 2000 });
      if (!windowId.trim()) {
        return null;
      }

      // 发送 Ctrl+L (聚焦地址栏)
      await execAsync(`xdotool key --window ${windowId.trim()} ctrl+l`, { timeout: 2000 });
      await this.sleep(100);

      // 发送 Ctrl+C (复制)
      await execAsync(`xdotool key --window ${windowId.trim()} ctrl+c`, { timeout: 2000 });
      await this.sleep(100);

      // 读取剪贴板
      const { stdout: clipboardContent } = await execAsync('xclip -selection clipboard -o 2>/dev/null', { timeout: 1000 });
      const url = clipboardContent.trim();

      // 发送 Escape 取消选择
      await execAsync(`xdotool key --window ${windowId.trim()} Escape`, { timeout: 1000 });

      // 恢复原剪贴板内容
      if (this.lastClipboardContent) {
        try {
          await execAsync(`echo -n ${JSON.stringify(this.lastClipboardContent)} | xclip -selection clipboard`, { timeout: 1000 });
        } catch {
          // 忽略恢复失败
        }
      }

      if (url && this.isValidURL(url)) {
        return this.normalizeURL(url);
      }
    } catch (error) {
      logger.debug(`[LinuxURLCollector] Clipboard method error:`, error);
    }

    return null;
  }

  /**
   * 从窗口标题中提取 URL
   */
  private extractURLFromTitle(title: string): string | null {
    if (!title) return null;

    // 某些浏览器可能在标题中包含 URL
    // 例如：Firefox 可以配置显示 URL
    const urlPatterns = [
      // 完整 URL
      /(https?:\/\/[^\s]+)/i,
      // 带协议的域名
      /(https?:\/\/[\w.-]+(?::\d+)?(?:\/[^\s]*)?)/i,
      // 裸域名 (需要看起来像域名)
      /\b((?:www\.)?[\w-]+\.(?:com|org|net|io|dev|cn|co|edu|gov|info|biz|me|tv|cc|xyz)[^\s]*)/i
    ];

    for (const pattern of urlPatterns) {
      const match = title.match(pattern);
      if (match && match[1]) {
        let url = match[1];
        // 确保有协议
        if (!url.startsWith('http')) {
          url = 'https://' + url;
        }
        return url;
      }
    }

    return null;
  }

  /**
   * 标准化浏览器名称
   */
  private normalizeBrowserName(browserName: string): string | null {
    if (!browserName) return null;

    const lower = browserName.toLowerCase();

    for (const [name, config] of Object.entries(BROWSER_CONFIGS)) {
      if (config.processNames.some(pn => lower.includes(pn)) || lower.includes(name.toLowerCase())) {
        return name;
      }
    }

    // 通用匹配
    if (lower.includes('chrome') || lower.includes('chromium')) return 'Chrome';
    if (lower.includes('firefox')) return 'Firefox';
    if (lower.includes('edge')) return 'Edge';
    if (lower.includes('brave')) return 'Brave';
    if (lower.includes('opera')) return 'Opera';

    return null;
  }

  /**
   * 标准化 URL
   */
  private normalizeURL(url: string): string {
    let normalized = url.trim();

    // 移除末尾的特殊字符
    normalized = normalized.replace(/['"<>\s]+$/, '');

    // 确保有协议
    if (normalized && !normalized.startsWith('http') && !normalized.startsWith('file:')) {
      // 检查是否看起来像 URL
      if (normalized.includes('.') && !normalized.includes(' ')) {
        normalized = 'https://' + normalized;
      }
    }

    return normalized;
  }

  /**
   * 验证是否是有效的 URL
   */
  private isValidURL(url: string): boolean {
    if (!url || url.length < 4) return false;

    // 基本检查
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
      return true;
    }

    // 检查是否是域名格式
    const domainPattern = /^[\w.-]+\.[\w]{2,}(\/.*)?$/;
    return domainPattern.test(url);
  }

  /**
   * 辅助函数：睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 检查 AT-SPI 是否可用
   */
  async isAtspiAvailable(): Promise<boolean> {
    if (this.atspiAvailable === null) {
      await this.checkToolAvailability();
    }
    return this.atspiAvailable || false;
  }

  /**
   * 获取支持的浏览器列表
   */
  getSupportedBrowsers(): string[] {
    return Object.keys(BROWSER_CONFIGS);
  }
}

export default LinuxURLCollector;
