/**
 * Windows 权限检查器
 * 检测 UI Automation 服务可用性
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../common/utils';

const execAsync = promisify(exec);

export interface PermissionCheckResult {
  available: boolean;
  message: string;
}

export class WindowsPermissionChecker {
  /**
   * 检查 UI Automation 是否可用
   * 正确方法：检查 .NET Framework 和 UI Automation 程序集
   * 注意：UI Automation 不需要任何 Windows 服务！
   */
  async checkUIAutomationAvailability(): Promise<PermissionCheckResult> {
    try {
      logger.info('[Windows Permission] 检查 UI Automation 可用性...');

      // PowerShell 脚本：尝试加载 UI Automation 程序集
      // UI Automation 只需要 .NET Framework 4.0+，不需要任何服务
      const script = `
        try {
          Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
          Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
          $automation = [System.Windows.Automation.AutomationElement]
          $desktop = $automation::RootElement
          if ($desktop) {
            "AVAILABLE"
          } else {
            "UNAVAILABLE"
          }
        } catch {
          Write-Error $_.Exception.Message
          "UNAVAILABLE"
        }
      `;

      const { stdout, stderr } = await execAsync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, {
        timeout: 5000
      });
      const result = stdout.trim();

      // 记录详细输出用于调试（使用 INFO 级别确保显示）
      logger.info('[Windows Permission] PowerShell 执行完成');
      logger.info('[Windows Permission] stdout 长度:', stdout.length);
      logger.info('[Windows Permission] stdout 内容:', JSON.stringify(stdout));
      logger.info('[Windows Permission] stdout.trim():', JSON.stringify(result));
      logger.info('[Windows Permission] 是否等于 AVAILABLE:', result === 'AVAILABLE');
      if (stderr) {
        logger.info('[Windows Permission] stderr 内容:', JSON.stringify(stderr));
      } else {
        logger.info('[Windows Permission] stderr: (无)');
      }

      if (result === 'AVAILABLE') {
        logger.info('[Windows Permission] ✅ UI Automation 可用（.NET Framework 正常）');
        return {
          available: true,
          message: 'UI Automation 可用'
        };
      }

      logger.warn('[Windows Permission] ⚠️ UI Automation 不可用（.NET Framework 缺失或损坏）');
      logger.warn('[Windows Permission] PowerShell 返回结果不是 AVAILABLE，而是:', JSON.stringify(result));
      return {
        available: false,
        message: this.getUIASetupGuide()
      };
    } catch (error: any) {
      logger.error('[Windows Permission] ❌ 检查 UI Automation 时出错:', error.message);
      if (error.stderr) {
        logger.error('[Windows Permission] PowerShell 错误:', error.stderr);
      }

      return {
        available: false,
        message: this.getUIASetupGuide()
      };
    }
  }

  /**
   * 获取 UI Automation 设置指南
   * 返回详细的解决步骤
   */
  private getUIASetupGuide(): string {
    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔐 UI Automation 不可用
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  为了监控浏览器活动窗口和 URL，本应用需要 UI Automation API。

  ⚠️ 原因：.NET Framework 缺失或损坏

  UI Automation 是通过 .NET Framework 提供的，不需要任何 Windows 服务。

  📋 解决方案：

  1️⃣  下载并安装 .NET Framework 4.5 或更高版本
      下载地址: https://dotnet.microsoft.com/download/dotnet-framework

  2️⃣  推荐版本：
      - .NET Framework 4.8 (最新稳定版)
      - Windows 10/11 通常已预装

  3️⃣  安装后重启应用程序

  ⚡ PowerShell 快速检查命令：

  # 检查 .NET Framework 版本
  Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP' -Recurse |
    Get-ItemProperty -Name Version -EA 0 |
    Where-Object { $_.PSChildName -match '^(?!S)\\p{L}'} |
    Select-Object PSChildName, Version

  # 测试 UI Automation
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  [System.Windows.Automation.AutomationElement]::RootElement

  💡 提示：

  - 不需要启用任何 Windows 服务
  - 不需要管理员权限（安装 .NET Framework 时除外）
  - Windows 10/11 通常已经包含 .NET Framework 4.x

  📝 降级模式：

  如果无法安装 .NET Framework，应用将使用窗口标题采集（仅获取页面标题）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
  }

  /**
   * 尝试打开服务管理器
   */
  async openServicesManager(): Promise<boolean> {
    try {
      logger.info('[Windows Permission] 打开服务管理器...');

      await execAsync('services.msc');

      logger.info('[Windows Permission] ✅ 已打开服务管理器');
      return true;
    } catch (error: any) {
      logger.error('[Windows Permission] ❌ 无法打开服务管理器:', error.message);
      return false;
    }
  }

  /**
   * 检查是否有管理员权限
   * Windows 某些操作需要管理员权限
   */
  async checkAdminPrivileges(): Promise<boolean> {
    try {
      const script = `
        $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
      `;

      const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
      const isAdmin = stdout.trim().toLowerCase() === 'true';

      if (isAdmin) {
        logger.info('[Windows Permission] ✅ 当前具有管理员权限');
      } else {
        logger.warn('[Windows Permission] ⚠️ 当前没有管理员权限');
      }

      return isAdmin;
    } catch (error: any) {
      logger.error('[Windows Permission] ❌ 检查管理员权限时出错:', error.message);
      return false;
    }
  }
}

export default WindowsPermissionChecker;
