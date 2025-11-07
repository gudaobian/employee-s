/**
 * 版本检查工具
 * 检测并处理多版本共存问题
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { app, dialog } from 'electron';

export class VersionChecker {
  private readonly appName = 'EmployeeMonitor.app';
  private readonly bundleId = 'com.company.employee-monitor';

  /**
   * 检查是否存在多个版本
   */
  async checkMultipleVersions(): Promise<void> {
    if (process.platform !== 'darwin') {
      return; // 只在 macOS 上检查
    }

    try {
      const currentPath = app.getPath('exe');
      const currentVersion = app.getVersion();

      // 检查 /Applications 目录
      const appInApplications = `/Applications/${this.appName}`;

      if (fs.existsSync(appInApplications)) {
        const appInApplicationsPath = path.join(appInApplications, 'Contents/MacOS');

        // 如果当前运行的不是 /Applications 中的版本
        if (!currentPath.startsWith('/Applications/')) {
          await this.handleMultipleVersions(
            currentPath,
            appInApplications,
            currentVersion
          );
        }
      }

      // 使用 mdfind 查找所有同名应用
      const allInstances = this.findAllInstances();

      if (allInstances.length > 1) {
        console.warn('[VERSION_CHECKER] 检测到多个版本:', allInstances);
        await this.showMultipleVersionsWarning(allInstances, currentPath);
      }

    } catch (error) {
      console.error('[VERSION_CHECKER] 版本检查失败:', error);
    }
  }

  /**
   * 查找所有应用实例
   */
  private findAllInstances(): string[] {
    try {
      // 使用 mdfind (Spotlight) 查找所有同名应用
      const result = execSync(
        `mdfind "kMDItemKind == 'Application' && kMDItemFSName == '${this.appName}'"`,
        { encoding: 'utf-8' }
      );

      return result
        .trim()
        .split('\n')
        .filter(p => p && fs.existsSync(p));
    } catch (error) {
      console.error('[VERSION_CHECKER] 查找应用实例失败:', error);
      return [];
    }
  }

  /**
   * 处理多版本共存问题
   */
  private async handleMultipleVersions(
    currentPath: string,
    standardPath: string,
    currentVersion: string
  ): Promise<void> {
    const response = await dialog.showMessageBox({
      type: 'warning',
      title: '检测到多个版本',
      message: '系统中存在多个版本的 EmployeeMonitor',
      detail: `当前运行版本: ${currentVersion}\n` +
              `运行位置: ${currentPath}\n\n` +
              `标准安装位置: ${standardPath}\n\n` +
              `建议将应用移动到标准位置（/Applications），并删除其他版本以避免冲突。`,
      buttons: ['继续使用', '退出并手动处理', '了解更多'],
      defaultId: 1,
      cancelId: 0
    });

    if (response.response === 1) {
      // 用户选择退出
      app.quit();
    } else if (response.response === 2) {
      // 显示详细说明
      await this.showDetailedInstructions();
    }
  }

  /**
   * 显示多版本警告
   */
  private async showMultipleVersionsWarning(
    instances: string[],
    currentPath: string
  ): Promise<void> {
    const message = instances
      .map((p, i) => `${i + 1}. ${p}${p === currentPath ? ' (当前运行)' : ''}`)
      .join('\n');

    await dialog.showMessageBox({
      type: 'warning',
      title: '发现多个应用副本',
      message: '系统中发现多个 EmployeeMonitor 副本',
      detail: `这可能导致以下问题：\n` +
              `• 自启动配置冲突\n` +
              `• 数据同步问题\n` +
              `• 更新失败\n\n` +
              `发现的副本位置：\n${message}\n\n` +
              `建议操作：\n` +
              `1. 只保留 /Applications 中的版本\n` +
              `2. 删除其他位置的副本\n` +
              `3. 重启应用`,
      buttons: ['我知道了']
    });
  }

  /**
   * 显示详细说明
   */
  private async showDetailedInstructions(): Promise<void> {
    await dialog.showMessageBox({
      type: 'info',
      title: '如何正确安装',
      message: '推荐的安装方式',
      detail: `方法1: 使用 PKG 安装包（推荐）\n` +
              `• PKG 会自动覆盖旧版本\n` +
              `• 无需手动删除\n` +
              `• 安装更可靠\n\n` +
              `方法2: 手动安装 DMG\n` +
              `1. 如果已安装旧版本：\n` +
              `   - 打开 Finder\n` +
              `   - 进入「应用程序」文件夹\n` +
              `   - 将 EmployeeMonitor.app 拖到废纸篓\n` +
              `   - 清空废纸篓\n\n` +
              `2. 安装新版本：\n` +
              `   - 打开 DMG 文件\n` +
              `   - 将应用拖到「Applications」文件夹\n` +
              `   - 等待复制完成\n\n` +
              `3. 启动应用：\n` +
              `   - 从「应用程序」文件夹打开\n` +
              `   - 首次打开右键选择「打开」`,
      buttons: ['关闭']
    });
  }

  /**
   * 自动清理旧版本（需要用户确认）
   */
  async autoCleanup(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return false;
    }

    const instances = this.findAllInstances();
    const currentPath = app.getPath('exe');
    const standardPath = `/Applications/${this.appName}`;

    // 找出需要删除的版本
    const toDelete = instances.filter(p => {
      // 保留标准位置的版本
      if (p === standardPath) {
        return false;
      }
      // 保留当前运行的版本
      if (currentPath.startsWith(p)) {
        return false;
      }
      return true;
    });

    if (toDelete.length === 0) {
      return false;
    }

    const response = await dialog.showMessageBox({
      type: 'question',
      title: '自动清理旧版本',
      message: `发现 ${toDelete.length} 个旧版本副本`,
      detail: `即将删除以下位置的旧版本：\n\n` +
              toDelete.map((p, i) => `${i + 1}. ${p}`).join('\n') +
              `\n\n确认删除吗？`,
      buttons: ['删除', '保留', '稍后提醒'],
      defaultId: 0,
      cancelId: 1
    });

    if (response.response === 0) {
      // 用户确认删除
      for (const oldPath of toDelete) {
        try {
          execSync(`rm -rf "${oldPath}"`);
          console.log(`[VERSION_CHECKER] 已删除旧版本: ${oldPath}`);
        } catch (error) {
          console.error(`[VERSION_CHECKER] 删除失败: ${oldPath}`, error);
        }
      }
      return true;
    }

    return false;
  }
}

export const versionChecker = new VersionChecker();
