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
   * 检查 UI Automation 服务可用性
   * 使用 PowerShell 检查 "UI0Detect" 服务状态
   */
  async checkUIAutomationAvailability(): Promise<PermissionCheckResult> {
    try {
      logger.info('[Windows Permission] 检查 UI Automation 服务状态...');

      // PowerShell 脚本检查 UI Automation 相关服务
      // Windows 的 UI Automation 依赖于多个服务，这里检查 UI0Detect 作为代表
      const script = `
        $uiaService = Get-Service -Name "UI0Detect" -ErrorAction SilentlyContinue
        if ($uiaService -and $uiaService.Status -eq "Running") {
          "AVAILABLE"
        } else {
          "UNAVAILABLE"
        }
      `;

      const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"')}"`);
      const result = stdout.trim();

      if (result === 'AVAILABLE') {
        logger.info('[Windows Permission] ✅ UI Automation 服务可用');
        return {
          available: true,
          message: 'UI Automation 服务正在运行'
        };
      }

      logger.warn('[Windows Permission] ⚠️ UI Automation 服务不可用');
      return {
        available: false,
        message: this.getUIASetupGuide()
      };
    } catch (error: any) {
      logger.error('[Windows Permission] ❌ 检查 UI Automation 服务时出错:', error.message);

      return {
        available: false,
        message: this.getUIASetupGuide()
      };
    }
  }

  /**
   * 获取 UI Automation 设置指南
   * 返回详细的设置步骤
   */
  private getUIASetupGuide(): string {
    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔐 Windows UI Automation 服务不可用
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  为了监控浏览器活动窗口和 URL，本应用需要 UI Automation 服务。

  📋 检查服务状态：

  1️⃣  按 Win + R，输入 services.msc，按回车
  2️⃣  在服务列表中找到 "Interactive Services Detection"
  3️⃣  右键点击，选择"属性"
  4️⃣  检查"启动类型"，建议设置为"自动"
  5️⃣  点击"启动"按钮启动服务
  6️⃣  点击"确定"保存设置

  ⚙️ 如果服务被禁用（企业环境）：

  某些企业环境可能通过组策略禁用了 UI Automation 服务。
  请联系 IT 管理员请求启用以下服务：

  - Interactive Services Detection (UI0Detect)
  - Windows Management Instrumentation

  📝 注册表配置（仅供高级用户）：

  服务配置路径：
  HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\UI0Detect

  可能需要的配置：
  - Start = 2 (自动启动)
  - 确保服务未被禁用

  ⚡ PowerShell 快速检查命令：

  Get-Service -Name "UI0Detect" | Format-List

  💡 提示：

  - 在企业环境中，可能需要管理员权限修改服务设置
  - 某些安全策略可能阻止启用此服务
  - 如果无法启用服务，应用将使用降级模式（功能受限）

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
