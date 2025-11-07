/**
 * Windows URL 采集器 - 使用 UI Automation
 * 通过 PowerShell 调用 UI Automation API 获取浏览器地址栏 URL
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../common/utils';

const execAsync = promisify(exec);

export interface WindowsURLInfo {
  url: string;
  browserName: string;
  timestamp: number;
  collectionMethod: 'ui_automation' | 'window_title' | 'fallback';
  quality: 'full_url' | 'domain_only' | 'title_only';
}

/**
 * Windows URL 采集器
 * 使用 UI Automation API 读取浏览器地址栏
 */
export class WindowsURLCollector {
  private static readonly UI_AUTOMATION_TIMEOUT = 10000; // 10秒超时（UI Automation 较慢）
  private static readonly WINDOW_TITLE_TIMEOUT = 8000;   // 8秒超时（Window Title 中等速度）
  private static readonly BROWSER_CONFIG = {
    'chrome.exe': {
      className: 'Chrome_WidgetWin_1',
      addressBarNames: [
        'Address and search bar',  // English
        '地址和搜索栏',            // Chinese Simplified
        '位址與搜尋列',            // Chinese Traditional
        'アドレスと検索バー',      // Japanese
        'Adress- und Suchleiste',  // German
        'Barre d\'adresse et de recherche', // French
        'Barra de direcciones y búsqueda'   // Spanish
      ],
      automationId: null
    },
    'msedge.exe': {
      className: 'Chrome_WidgetWin_1',
      addressBarNames: [
        'Address and search bar',
        '地址和搜索栏',
        '位址與搜尋列'
      ],
      automationId: null
    },
    'brave.exe': {
      className: 'Chrome_WidgetWin_1',
      addressBarNames: [
        'Address and search bar',
        '地址和搜索栏'
      ],
      automationId: null
    },
    'firefox.exe': {
      className: 'MozillaWindowClass',
      addressBarNames: [
        'Search with Google or enter address',
        '使用 Google 搜索或输入地址',
        'Search or enter address'
      ],
      automationId: null
    },
    'opera.exe': {
      className: 'Chrome_WidgetWin_1',
      addressBarNames: [
        'Address field',
        '地址字段'
      ],
      automationId: null
    }
  };

  /**
   * 获取活动浏览器的 URL
   * @param browserName 浏览器进程名（如 chrome.exe）
   * @returns URL 信息对象，失败返回 null
   */
  async getActiveURL(browserName: string): Promise<WindowsURLInfo | null> {
    try {
      const normalizedName = browserName.toLowerCase();
      logger.info(`[WindowsURLCollector] Attempting URL collection for: ${normalizedName}`);

      // 尝试 UI Automation 方法
      logger.info(`[WindowsURLCollector] Trying UI Automation method...`);
      const urlFromAutomation = await this.getURLViaUIAutomation(normalizedName);
      if (urlFromAutomation) {
        return {
          url: urlFromAutomation,
          browserName,
          timestamp: Date.now(),
          collectionMethod: 'ui_automation',
          quality: 'full_url'
        };
      }

      // 降级到窗口标题方法
      logger.info(`[WindowsURLCollector] UI Automation failed, trying window title fallback...`);
      const urlFromTitle = await this.getURLFromWindowTitle(normalizedName);
      if (urlFromTitle) {
        return {
          url: urlFromTitle,
          browserName,
          timestamp: Date.now(),
          collectionMethod: 'window_title',
          quality: 'title_only'
        };
      }

      return null;

    } catch (error) {
      logger.error(`[WindowsURLCollector] Failed to get URL for ${browserName}:`, error);
      return null;
    }
  }

  /**
   * 使用 UI Automation API 获取 URL
   * 通过 PowerShell 调用 .NET Framework 的 UI Automation
   */
  private async getURLViaUIAutomation(browserName: string): Promise<string | null> {
    try {
      const config = WindowsURLCollector.BROWSER_CONFIG[browserName];
      if (!config) {
        logger.info(`[WindowsURLCollector] No config for browser: ${browserName}`);
        return null;
      }

      // PowerShell 脚本：使用 UI Automation 获取地址栏内容
      const script = this.generateUIAutomationScript(config.className, config.addressBarNames);

      // 执行 PowerShell 脚本
      const { stdout, stderr } = await this.executePowerShell(script, WindowsURLCollector.UI_AUTOMATION_TIMEOUT);

      // 详细日志记录（调试 UI Automation）
      logger.info(`[WindowsURLCollector] PowerShell 执行完成`);
      logger.info(`[WindowsURLCollector] stdout 长度: ${stdout.length}`);
      logger.info(`[WindowsURLCollector] stdout 内容:`, JSON.stringify(stdout));
      if (stderr) {
        logger.info(`[WindowsURLCollector] stderr 内容:`, JSON.stringify(stderr));
      } else {
        logger.info(`[WindowsURLCollector] stderr: (无)`);
      }

      const url = stdout.trim();
      logger.info(`[WindowsURLCollector] URL after trim:`, JSON.stringify(url));

      // 验证 URL 格式
      if (url && this.isValidURL(url)) {
        // 规范化 URL（添加缺失的协议）
        const normalizedURL = this.normalizeURL(url);
        logger.info(`[WindowsURLCollector] ✅ Got URL via UI Automation: ${normalizedURL}`);
        return normalizedURL;
      }

      logger.info(`[WindowsURLCollector] Invalid or empty URL from UI Automation`);
      logger.info(`[WindowsURLCollector] isValidURL result: ${this.isValidURL(url)}`);
      return null;

    } catch (error) {
      logger.error(`[WindowsURLCollector] UI Automation failed:`, error);
      return null;
    }
  }

  /**
   * 生成 PowerShell UI Automation 脚本（支持多语言地址栏名称）
   */
  private generateUIAutomationScript(className: string, addressBarNames: string[]): string {
    // 生成多个地址栏名称的数组字符串
    const namesArray = addressBarNames.map(name => `"${name.replace(/"/g, '""')}"`).join(',');

    return `
# 设置输出编码为 UTF-8（解决中文乱码）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

try {
    # 创建 UI Automation 实例
    $automation = [System.Windows.Automation.AutomationElement]

    # 获取桌面根元素
    $desktop = $automation::RootElement

    # 查找浏览器窗口
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty,
        "${className}"
    )

    $browserWindow = $desktop.FindFirst(
        [System.Windows.Automation.TreeScope]::Children,
        $condition
    )

    if ($null -eq $browserWindow) {
        Write-Error "Browser window not found"
        exit 1
    }

    # 尝试多个可能的地址栏名称（支持多语言）
    $addressBarNames = @(${namesArray})
    $addressBar = $null

    foreach ($name in $addressBarNames) {
        $addressBarCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $name
        )

        $addressBar = $browserWindow.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $addressBarCondition
        )

        if ($null -ne $addressBar) {
            break
        }
    }

    if ($null -eq $addressBar) {
        Write-Error "Address bar not found (tried all language variants)"
        exit 1
    }

    # 获取地址栏的值（使用 Value Pattern）
    $valuePattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $url = $valuePattern.Current.Value

    if ($url) {
        Write-Output $url
    } else {
        Write-Error "URL is empty"
        exit 1
    }

} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`.trim();
  }

  /**
   * 执行 PowerShell 脚本
   */
  private async executePowerShell(script: string, timeout: number): Promise<{ stdout: string; stderr: string }> {
    // 在脚本前添加进度抑制设置
    const fullScript = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
${script}
`;

    // 将脚本编码为 Base64（避免引号转义问题）
    const scriptBase64 = Buffer.from(fullScript, 'utf16le').toString('base64');

    // 使用 -EncodedCommand 参数执行，添加 OutputFormat Text 避免 CLIXML
    // UTF-8 编码已在脚本内部设置，无需 chcp（避免额外延迟）
    const command = `powershell.exe -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand ${scriptBase64}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('PowerShell execution timeout'));
      }, timeout);

      exec(command, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        windowsHide: true  // 隐藏命令窗口
      }, (error, stdout, stderr) => {
        clearTimeout(timer);

        if (error) {
          // 即使有错误，也返回 stdout 和 stderr（可能包含有用信息）
          resolve({ stdout: stdout || '', stderr: stderr || error.message });
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * 从窗口标题提取 URL（降级方法）
   */
  private async getURLFromWindowTitle(browserName: string): Promise<string | null> {
    try {
      // 使用 PowerShell 获取活动窗口标题
      const script = `
# 设置输出编码为 UTF-8（解决中文乱码）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WindowHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

    public static string GetActiveWindowTitle() {
        IntPtr handle = GetForegroundWindow();
        System.Text.StringBuilder title = new System.Text.StringBuilder(256);
        GetWindowText(handle, title, 256);
        return title.ToString();
    }
}
"@

[WindowHelper]::GetActiveWindowTitle()
`.trim();

      const { stdout } = await this.executePowerShell(script, WindowsURLCollector.WINDOW_TITLE_TIMEOUT);
      const title = stdout.trim();

      if (title) {
        logger.info(`[WindowsURLCollector] Window title: ${title}`);
        return `[Title] ${title}`;
      }

      return null;

    } catch (error) {
      logger.error(`[WindowsURLCollector] Failed to get window title:`, error);
      return null;
    }
  }

  /**
   * 验证并规范化 URL 格式
   * Chrome 地址栏可能返回没有协议的 URL，需要自动添加
   */
  private isValidURL(url: string): boolean {
    if (!url || url.length < 3) {
      return false;
    }

    // 检查是否已经有协议
    const hasProtocol = /^(https?:\/\/|chrome:\/\/|edge:\/\/|about:|file:\/\/)/i.test(url);

    // 如果没有协议，检查是否像域名（包含点或 localhost）
    if (!hasProtocol) {
      // 看起来像域名：包含点，或者是 localhost
      const looksLikeDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+/i.test(url) ||
                              url.startsWith('localhost');
      return looksLikeDomain;
    }

    // 已经有协议，只要长度足够就认为有效
    return url.length > 10;
  }

  /**
   * 规范化 URL（添加缺失的协议，并只保留域名）
   * 例如：https://www.baidu.com/s?wd=test → https://www.baidu.com/
   */
  private normalizeURL(url: string): string {
    if (!url) {
      return url;
    }

    let fullUrl = url;

    // 如果没有协议，添加 https://
    if (!/^(https?|chrome|edge|about|file):\/?\/?/i.test(url)) {
      fullUrl = `https://${url}`;
    }

    // 解析 URL，只保留协议和域名
    try {
      const urlObj = new URL(fullUrl);
      // 返回协议 + 域名，例如 https://www.baidu.com/
      return `${urlObj.protocol}//${urlObj.hostname}/`;
    } catch (error) {
      // 如果解析失败，返回原始 URL（可能是特殊协议如 chrome://）
      logger.warn(`[WindowsURLCollector] Failed to parse URL: ${fullUrl}`);
      return fullUrl;
    }
  }
}

export default WindowsURLCollector;
