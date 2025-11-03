/**
 * macOS 权限检查器
 * 检测辅助功能权限（Accessibility Permission）
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../common/utils';

const execAsync = promisify(exec);

export interface PermissionCheckResult {
  granted: boolean;
  message: string;
}

export class MacOSPermissionChecker {
  /**
   * 检查辅助功能权限
   * 使用 AppleScript 测试是否能访问 System Events
   */
  async checkAccessibilityPermission(): Promise<PermissionCheckResult> {
    try {
      logger.info('[macOS Permission] 检查辅助功能权限...');

      // 使用 AppleScript 测试辅助功能权限
      // 如果有权限，能够获取进程名称；否则会抛出错误
      const script = `tell application "System Events" to return name of first process`;

      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);

      if (stdout && stdout.trim().length > 0) {
        logger.info('[macOS Permission] ✅ 辅助功能权限已授权');
        return {
          granted: true,
          message: '辅助功能权限已授权'
        };
      }

      // 理论上不应该到达这里，但作为保险
      return {
        granted: false,
        message: this.getPermissionGuide()
      };
    } catch (error: any) {
      // 如果执行失败，说明没有辅助功能权限
      logger.warn('[macOS Permission] ❌ 辅助功能权限未授权');
      logger.debug('[macOS Permission] 错误详情:', error.message);

      return {
        granted: false,
        message: this.getPermissionGuide()
      };
    }
  }

  /**
   * 获取权限设置指南
   * 返回详细的中文步骤和快捷命令
   */
  private getPermissionGuide(): string {
    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔐 macOS 辅助功能权限未授权
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  为了监控浏览器活动窗口和 URL，本应用需要辅助功能权限。

  📋 授权步骤：

  1️⃣  打开"系统偏好设置"
  2️⃣  进入"安全性与隐私"
  3️⃣  选择"隐私"标签页
  4️⃣  在左侧列表中选择"辅助功能"
  5️⃣  点击左下角的锁图标，输入密码解锁
  6️⃣  在右侧列表中找到本应用并勾选
  7️⃣  重启本应用

  ⚡ 快捷命令（自动打开设置页面）：

  运行以下命令可直接打开辅助功能设置页面：

    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"

  💡 提示：

  - 授权后可能需要重启应用程序才能生效
  - 如果列表中没有本应用，可以点击"+"手动添加
  - 某些版本的 macOS 可能界面略有不同

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
  }

  /**
   * 尝试打开系统偏好设置到辅助功能页面
   * 注意：这个方法只是打开设置，无法自动授权
   */
  async openAccessibilitySettings(): Promise<boolean> {
    try {
      logger.info('[macOS Permission] 打开辅助功能设置页面...');

      await execAsync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');

      logger.info('[macOS Permission] ✅ 已打开系统偏好设置');
      return true;
    } catch (error: any) {
      logger.error('[macOS Permission] ❌ 无法打开系统偏好设置:', error.message);
      return false;
    }
  }
}

export default MacOSPermissionChecker;
