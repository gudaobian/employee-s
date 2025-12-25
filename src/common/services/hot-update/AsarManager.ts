import * as path from 'path';
import * as fs from 'fs-extra';
import { app } from 'electron';
import * as log from 'electron-log';

// 使用 original-fs 绕过 Electron 的 ASAR 协议拦截
const originalFs = (process as any).electronBinding?.('fs') || require('original-fs');

/**
 * ASAR文件管理器
 *
 * 负责ASAR文件的备份、解包、打包和验证操作
 * 支持处理 app.asar.unpacked 目录（原生模块）
 */
export class AsarManager {
  private readonly asarPath: string;
  private readonly backupPath: string;
  private readonly unpackedPath: string;
  private readonly unpackedBackupPath: string;
  private asarModule: any = null;

  constructor() {
    if (!app.isPackaged) {
      throw new Error('AsarManager只能在打包环境下使用');
    }

    this.asarPath = path.join(process.resourcesPath, 'app.asar');
    this.backupPath = `${this.asarPath}.backup`;
    this.unpackedPath = `${this.asarPath}.unpacked`;
    this.unpackedBackupPath = `${this.asarPath}.unpacked.backup`;
  }

  /**
   * 动态加载 @electron/asar 模块（ESM兼容）
   * 使用 eval 避免 TypeScript 编译器将 import() 转换为 require()
   */
  private async loadAsarModule(): Promise<any> {
    if (!this.asarModule) {
      // ✅ 使用 eval 绕过 TypeScript 编译器转换
      // TypeScript 的 module: commonjs 会将 import() 转换为 require()
      // 而 @electron/asar 是 ES Module，必须用动态 import() 加载
      const mod = await eval('import("@electron/asar")');
      this.asarModule = mod;
    }
    return this.asarModule;
  }

  /**
   * 获取ASAR路径
   */
  getAsarPath(): string {
    return this.asarPath;
  }

  /**
   * 获取备份路径
   */
  getBackupPath(): string {
    return this.backupPath;
  }

  /**
   * 创建备份
   * 使用 original-fs 绕过 Electron ASAR 协议
   */
  async createBackup(): Promise<void> {
    if (!fs.existsSync(this.asarPath)) {
      throw new Error('ASAR文件不存在');
    }

    // 使用 original-fs.copyFileSync 而不是 fs-extra.copy
    // 避免 Electron ASAR 协议干扰导致创建目录而不是复制文件
    originalFs.copyFileSync(this.asarPath, this.backupPath);
  }

  /**
   * 从备份恢复
   * 使用 original-fs 绕过 Electron ASAR 协议
   */
  async restoreFromBackup(): Promise<void> {
    if (!fs.existsSync(this.backupPath)) {
      throw new Error('备份文件不存在');
    }

    // 使用 original-fs.copyFileSync 确保正确恢复
    originalFs.copyFileSync(this.backupPath, this.asarPath);
  }

  /**
   * 删除备份
   */
  async removeBackup(): Promise<void> {
    if (fs.existsSync(this.backupPath)) {
      await fs.remove(this.backupPath);
    }
  }

  /**
   * 解包ASAR到临时目录
   * 使用 @electron/asar API 而非 CLI（修复打包后路径不可用问题）
   */
  async extract(targetDir: string): Promise<void> {
    await fs.ensureDir(targetDir);

    // ✅ 使用 API 而非 CLI，避免 ERR_PACKAGE_PATH_NOT_EXPORTED 错误
    // @electron/asar 的 package.json 未导出 './bin/asar.mjs' 路径
    const asar = await this.loadAsarModule();

    try {
      // 使用 extractAll API 提取整个 ASAR 包
      await asar.extractAll(this.asarPath, targetDir);
    } catch (error: any) {
      throw new Error(`ASAR解压失败: ${error.message}`);
    }
  }

  /**
   * 打包目录为ASAR
   */
  async pack(sourceDir: string, targetPath?: string): Promise<void> {
    const asar = await this.loadAsarModule();
    const target = targetPath || this.asarPath;
    await asar.createPackage(sourceDir, target);
  }

  /**
   * 验证ASAR完整性
   */
  async verify(): Promise<boolean> {
    try {
      const asar = await this.loadAsarModule();
      // 尝试读取package.json
      const packageJson = asar.extractFile(this.asarPath, 'package.json');
      const parsed = JSON.parse(packageJson.toString());
      return !!parsed.name && !!parsed.version;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取ASAR中的版本号
   */
  async getVersion(): Promise<string | null> {
    return this.getVersionFromFile(this.asarPath);
  }

  /**
   * 获取指定ASAR文件中的版本号
   */
  async getVersionFromFile(asarPath: string): Promise<string | null> {
    try {
      const asar = await this.loadAsarModule();
      const packageJson = asar.extractFile(asarPath, 'package.json');
      const parsed = JSON.parse(packageJson.toString());
      return parsed.version || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 检查ASAR文件是否存在
   */
  exists(): boolean {
    return fs.existsSync(this.asarPath);
  }

  /**
   * 检查备份文件是否存在
   */
  backupExists(): boolean {
    return fs.existsSync(this.backupPath);
  }

  /**
   * 获取ASAR文件大小
   */
  async getSize(): Promise<number> {
    if (!this.exists()) {
      throw new Error('ASAR文件不存在');
    }
    const stats = await fs.stat(this.asarPath);
    return stats.size;
  }

  /**
   * 检查 unpacked 目录是否存在
   */
  unpackedExists(): boolean {
    return fs.existsSync(this.unpackedPath);
  }

  /**
   * 获取 unpacked 目录路径
   */
  getUnpackedPath(): string {
    return this.unpackedPath;
  }

  /**
   * 备份 unpacked 目录
   */
  async backupUnpacked(): Promise<void> {
    if (!this.unpackedExists()) {
      log.info('[AsarManager] unpacked 目录不存在，跳过备份');
      return;
    }

    log.info('[AsarManager] 开始备份 unpacked 目录');
    await fs.copy(this.unpackedPath, this.unpackedBackupPath, { overwrite: true });
    log.info('[AsarManager] unpacked 目录备份完成');
  }

  /**
   * 从备份恢复 unpacked 目录
   */
  async restoreUnpackedFromBackup(): Promise<void> {
    if (!fs.existsSync(this.unpackedBackupPath)) {
      log.warn('[AsarManager] unpacked 备份不存在，跳过恢复');
      return;
    }

    log.info('[AsarManager] 开始恢复 unpacked 目录');

    // 先删除现有 unpacked 目录
    if (this.unpackedExists()) {
      await fs.remove(this.unpackedPath);
    }

    // 从备份恢复
    await fs.copy(this.unpackedBackupPath, this.unpackedPath, { overwrite: true });
    log.info('[AsarManager] unpacked 目录恢复完成');
  }

  /**
   * 删除 unpacked 备份
   */
  async removeUnpackedBackup(): Promise<void> {
    if (fs.existsSync(this.unpackedBackupPath)) {
      await fs.remove(this.unpackedBackupPath);
      log.info('[AsarManager] unpacked 备份已删除');
    }
  }

  /**
   * 提取 ASAR 和 unpacked 目录到临时目录
   * @param targetDir 目标目录
   */
  async extractWithUnpacked(targetDir: string): Promise<void> {
    await fs.ensureDir(targetDir);

    // 1. 提取 ASAR
    const asarExtractDir = path.join(targetDir, 'asar');
    await this.extract(asarExtractDir);
    log.info('[AsarManager] ASAR 提取完成');

    // 2. 复制 unpacked 目录（如果存在）
    if (this.unpackedExists()) {
      const unpackedExtractDir = path.join(targetDir, 'unpacked');
      await fs.copy(this.unpackedPath, unpackedExtractDir, { overwrite: true });
      log.info('[AsarManager] unpacked 目录复制完成');
    } else {
      log.info('[AsarManager] unpacked 目录不存在，跳过');
    }
  }

  /**
   * 打包目录为 ASAR 并处理 unpacked 文件
   * @param sourceDir 源目录（包含 asar/ 和 unpacked/ 子目录）
   * @param targetAsarPath 目标 ASAR 文件路径
   */
  async packWithUnpacked(sourceDir: string, targetAsarPath?: string): Promise<void> {
    const target = targetAsarPath || this.asarPath;
    const asarSourceDir = path.join(sourceDir, 'asar');
    const unpackedSourceDir = path.join(sourceDir, 'unpacked');

    // 1. 打包 ASAR
    if (!fs.existsSync(asarSourceDir)) {
      throw new Error(`ASAR 源目录不存在: ${asarSourceDir}`);
    }

    await this.pack(asarSourceDir, target);
    log.info('[AsarManager] ASAR 打包完成');

    // 2. 处理 unpacked 文件
    const targetUnpackedPath = `${target}.unpacked`;

    if (fs.existsSync(unpackedSourceDir)) {
      // 如果差异包包含 unpacked 文件，复制到目标位置
      log.info('[AsarManager] 开始处理 unpacked 文件');

      // 先删除旧的 unpacked 目录
      if (fs.existsSync(targetUnpackedPath)) {
        await fs.remove(targetUnpackedPath);
      }

      // 复制新的 unpacked 文件
      await fs.copy(unpackedSourceDir, targetUnpackedPath, { overwrite: true });
      log.info('[AsarManager] unpacked 文件处理完成');
    } else {
      log.info('[AsarManager] 差异包不包含 unpacked 文件，跳过');

      // 如果没有 unpacked 更新，但目标位置有旧的 unpacked，需要保留
      if (this.unpackedExists() && target === this.asarPath) {
        log.info('[AsarManager] 保留现有 unpacked 目录');
      }
    }
  }

  /**
   * 创建完整备份（ASAR + unpacked）
   */
  async createFullBackup(): Promise<void> {
    await this.createBackup();
    await this.backupUnpacked();
    log.info('[AsarManager] 完整备份创建完成');
  }

  /**
   * 从完整备份恢复（ASAR + unpacked）
   */
  async restoreFromFullBackup(): Promise<void> {
    await this.restoreFromBackup();
    await this.restoreUnpackedFromBackup();
    log.info('[AsarManager] 完整备份恢复完成');
  }

  /**
   * 删除完整备份（ASAR + unpacked）
   */
  async removeFullBackup(): Promise<void> {
    await this.removeBackup();
    await this.removeUnpackedBackup();
    log.info('[AsarManager] 完整备份删除完成');
  }
}
