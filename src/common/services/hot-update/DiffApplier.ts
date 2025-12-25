import * as path from 'path';
import * as fs from 'fs-extra';
import * as tar from 'tar';
import * as log from 'electron-log';
import { DiffManifest } from '../../types/hot-update.types';

/**
 * 差异包应用器
 *
 * 负责解压差异包、读取清单、应用差异到ASAR解包目录
 */
export class DiffApplier {
  /**
   * 解压差异包
   */
  async extractDiffPackage(diffPath: string, targetDir: string): Promise<void> {
    log.info('[DiffApplier] 开始解压差异包');
    await fs.ensureDir(targetDir);

    await tar.extract({
      file: diffPath,
      cwd: targetDir
    });

    log.info('[DiffApplier] 差异包解压完成');
  }

  /**
   * 读取差异清单
   *
   * 支持两种格式：
   * 1. 前端格式：manifest.json { version, changed, deleted }
   * 2. 后端格式：metadata.json { fromVersion, toVersion, changedFiles, deletedFiles }
   */
  async readManifest(diffDir: string): Promise<DiffManifest> {
    // 尝试读取清单文件（支持 manifest.json 或 metadata.json）
    const manifestPath = path.join(diffDir, 'manifest.json');
    const metadataPath = path.join(diffDir, 'metadata.json');

    let content: any;
    let fileName: string;

    if (fs.existsSync(manifestPath)) {
      fileName = 'manifest.json';
      content = await fs.readJson(manifestPath);
      log.debug('[DiffApplier] 读取清单文件: manifest.json');
    } else if (fs.existsSync(metadataPath)) {
      fileName = 'metadata.json';
      content = await fs.readJson(metadataPath);
      log.debug('[DiffApplier] 读取清单文件: metadata.json');
    } else {
      throw new Error('差异清单文件不存在（manifest.json 或 metadata.json）');
    }

    // 智能检测格式类型：通过字段结构判断，而不是文件名
    const hasNewBackendFormat = content.asar !== undefined; // 新后端格式（嵌套结构）
    const hasOldBackendFields = content.changedFiles !== undefined || content.deletedFiles !== undefined;
    const hasFrontendFields = content.changed !== undefined || content.deleted !== undefined;

    if (hasNewBackendFormat) {
      // 新后端格式：{ asar: { changedFiles, deletedFiles }, unpacked: {...}, frameworks: {...} }
      log.debug('[DiffApplier] 检测到新后端格式（基于嵌套asar结构）');

      // 验证新后端格式的必需字段
      if (!content.toVersion || !content.asar || content.asar.changedFiles === undefined) {
        log.error('[DiffApplier] 新后端格式缺少必需字段:', JSON.stringify(content, null, 2));
        throw new Error('差异清单格式无效（新后端格式）');
      }

      // 合并 asar、unpacked、frameworks 的变更文件
      const asarChanged = content.asar.changedFiles || [];
      const asarDeleted = content.asar.deletedFiles || [];
      const asarAdded = content.asar.addedFiles || [];

      // unpacked 和 frameworks 的文件也需要处理（如果有变化）
      const unpackedChanged = content.unpacked?.changedFiles || [];
      const unpackedDeleted = content.unpacked?.deletedFiles || [];
      const unpackedAdded = content.unpacked?.addedFiles || [];

      // 转换为统一格式
      const manifest: DiffManifest = {
        version: content.toVersion,
        fromVersion: content.fromVersion || '',
        toVersion: content.toVersion,
        added: [...asarAdded, ...unpackedAdded],
        changed: [...asarChanged, ...unpackedChanged],
        deleted: [...asarDeleted, ...unpackedDeleted],
        timestamp: content.timestamp || content.generatedAt || new Date().toISOString()
      };

      log.debug('[DiffApplier] 新后端格式转换完成:', {
        fileName,
        version: manifest.version,
        asarChangedCount: asarChanged.length,
        unpackedChangedCount: unpackedChanged.length,
        totalChangedCount: manifest.changed.length,
        deletedCount: manifest.deleted.length
      });

      return manifest;
    } else if (hasOldBackendFields) {
      // 旧后端格式：{ fromVersion, toVersion, changedFiles, deletedFiles }
      log.debug('[DiffApplier] 检测到旧后端格式（基于字段结构）');

      // 验证旧后端格式的必需字段
      if (!content.toVersion || content.changedFiles === undefined || content.deletedFiles === undefined) {
        log.error('[DiffApplier] 旧后端格式缺少必需字段:', JSON.stringify(content, null, 2));
        throw new Error('差异清单格式无效（旧后端格式）');
      }

      // 转换字段名
      const manifest: DiffManifest = {
        version: content.toVersion,
        fromVersion: content.fromVersion || '',
        toVersion: content.toVersion,
        added: content.addedFiles || [],
        changed: content.changedFiles || [],
        deleted: content.deletedFiles || [],
        timestamp: content.timestamp || content.generatedAt || new Date().toISOString()
      };

      log.debug('[DiffApplier] 旧后端格式转换完成:', {
        fileName,
        version: manifest.version,
        changedCount: manifest.changed.length,
        deletedCount: manifest.deleted.length
      });

      return manifest;
    } else if (hasFrontendFields) {
      // 前端格式：{ version, changed, deleted }
      log.debug('[DiffApplier] 检测到前端格式（基于字段结构）');

      // 验证前端格式的必需字段
      if (!content.version || content.changed === undefined || content.deleted === undefined) {
        log.error('[DiffApplier] 前端格式缺少必需字段:', JSON.stringify(content, null, 2));
        throw new Error('差异清单格式无效（前端格式）');
      }

      return content as DiffManifest;
    } else {
      // 未知格式
      log.error('[DiffApplier] 无法识别的清单格式:', JSON.stringify(content, null, 2));
      throw new Error('差异清单格式无效（既不是前端格式也不是后端格式）');
    }
  }

  /**
   * 应用差异到ASAR解包目录
   */
  async applyDiff(
    asarExtractDir: string,
    diffDir: string,
    manifest: DiffManifest
  ): Promise<void> {
    log.info('[DiffApplier] 开始应用差异');
    log.info(`[DiffApplier] 变更文件: ${manifest.changed.length}, 删除文件: ${manifest.deleted.length}`);

    // 1. 删除文件
    let deletedCount = 0;
    for (const filePath of manifest.deleted) {
      const targetPath = path.join(asarExtractDir, filePath);
      if (fs.existsSync(targetPath)) {
        await fs.remove(targetPath);
        deletedCount++;
        log.debug(`[DiffApplier] 已删除: ${filePath}`);
      } else {
        log.warn(`[DiffApplier] 删除目标不存在,跳过: ${filePath}`);
      }
    }
    log.info(`[DiffApplier] 删除完成: ${deletedCount}/${manifest.deleted.length}`);

    // 2. 添加/修改文件
    // 支持四种目录结构：
    // - 新后端格式：asar-changed/ (后端新格式，支持 unpacked 分离)
    // - 旧后端格式：changed/ (后端旧格式)
    // - 前端格式：files/
    // - 直接格式：直接从根目录读取（兼容后端直接打包的情况）
    const newBackendFilesDir = path.join(diffDir, 'asar-changed');
    const oldBackendFilesDir = path.join(diffDir, 'changed');
    const frontendFilesDir = path.join(diffDir, 'files');
    const rootDir = diffDir; // 兼容：直接从根目录读取

    let filesDir: string;
    if (fs.existsSync(newBackendFilesDir)) {
      filesDir = newBackendFilesDir;
      log.info(`[DiffApplier] 使用文件目录: ${filesDir} (新后端格式)`);
    } else if (fs.existsSync(oldBackendFilesDir)) {
      filesDir = oldBackendFilesDir;
      log.info(`[DiffApplier] 使用文件目录: ${filesDir} (旧后端格式)`);
    } else if (fs.existsSync(frontendFilesDir)) {
      filesDir = frontendFilesDir;
      log.info(`[DiffApplier] 使用文件目录: ${filesDir} (前端格式)`);
    } else {
      // 直接从根目录读取（兼容后端直接打包的情况）
      filesDir = rootDir;
      log.info(`[DiffApplier] 使用文件目录: ${filesDir} (根目录直接格式)`);
    }

    // 调试：列出差异包的实际内容
    try {
      const diffDirContents = await fs.readdir(diffDir);
      log.info(`[DiffApplier] 差异包根目录内容: ${JSON.stringify(diffDirContents)}`);

      if (filesDir !== rootDir && fs.existsSync(filesDir)) {
        const filesDirContents = await fs.readdir(filesDir);
        log.info(`[DiffApplier] 文件目录内容 (${path.basename(filesDir)}): ${JSON.stringify(filesDirContents)}`);
      }
    } catch (e) {
      log.error(`[DiffApplier] 无法列出目录内容:`, e);
    }

    // 合并新增和修改的文件列表
    const filesToCopy = [...(manifest.added || []), ...manifest.changed];
    let copiedCount = 0;

    for (const filePath of filesToCopy) {
      const sourcePath = path.join(filesDir, filePath);
      const targetPath = path.join(asarExtractDir, filePath);

      if (!fs.existsSync(sourcePath)) {
        log.warn(`[DiffApplier] 源文件不存在,跳过: ${filePath}`);
        continue;
      }

      await fs.ensureDir(path.dirname(targetPath));
      await fs.copy(sourcePath, targetPath, { overwrite: true });
      copiedCount++;
      log.debug(`[DiffApplier] 已复制: ${filePath}`);
    }
    log.info(`[DiffApplier] 复制完成: ${copiedCount}/${filesToCopy.length} (新增=${manifest.added?.length || 0}, 修改=${manifest.changed.length})`);

    log.info('[DiffApplier] 差异应用完成');
  }

  /**
   * 应用差异到解包目录（支持 ASAR + unpacked）
   * @param extractDir 解包根目录（包含 asar/ 和 unpacked/ 子目录）
   * @param diffDir 差异包目录
   * @param manifest 差异清单
   */
  async applyDiffWithUnpacked(
    extractDir: string,
    diffDir: string,
    manifest: DiffManifest
  ): Promise<void> {
    log.info('[DiffApplier] 开始应用差异（包含 unpacked）');

    // 1. 应用 ASAR 文件差异
    const asarExtractDir = path.join(extractDir, 'asar');
    await this.applyDiff(asarExtractDir, diffDir, manifest);

    // 2. 检查差异包是否包含 unpacked 文件
    const unpackedDiffDir = path.join(diffDir, 'unpacked');
    if (fs.existsSync(unpackedDiffDir)) {
      log.info('[DiffApplier] 检测到 unpacked 文件更新');

      const unpackedExtractDir = path.join(extractDir, 'unpacked');

      // 确保 unpacked 目录存在
      await fs.ensureDir(unpackedExtractDir);

      // 应用 unpacked 文件差异
      await this.applyUnpackedDiff(unpackedExtractDir, unpackedDiffDir);
    } else {
      log.info('[DiffApplier] 差异包不包含 unpacked 文件，跳过');
    }

    log.info('[DiffApplier] 差异应用完成（包含 unpacked）');
  }

  /**
   * 应用 unpacked 文件差异
   * 注意：unpacked 文件通常是完整替换，而不是增量更新
   * @param unpackedExtractDir 目标 unpacked 目录
   * @param unpackedDiffDir 差异包中的 unpacked 目录
   */
  private async applyUnpackedDiff(
    unpackedExtractDir: string,
    unpackedDiffDir: string
  ): Promise<void> {
    log.info('[DiffApplier] 开始应用 unpacked 文件差异');

    // 完整替换 unpacked 目录
    // 原因：原生模块通常是二进制文件，不适合增量更新
    log.info('[DiffApplier] 使用完整替换策略处理 unpacked 文件');

    // 清空目标目录
    if (fs.existsSync(unpackedExtractDir)) {
      await fs.remove(unpackedExtractDir);
      log.info('[DiffApplier] 已清空现有 unpacked 目录');
    }

    // 复制新的 unpacked 文件
    await fs.copy(unpackedDiffDir, unpackedExtractDir, { overwrite: true });

    // 统计文件数量
    const files = await this.countFiles(unpackedExtractDir);
    log.info(`[DiffApplier] unpacked 文件复制完成: ${files} 个文件`);
  }

  /**
   * 递归统计目录中的文件数量
   */
  private async countFiles(dir: string): Promise<number> {
    let count = 0;
    const items = await fs.readdir(dir);

    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stat = await fs.stat(itemPath);

      if (stat.isDirectory()) {
        count += await this.countFiles(itemPath);
      } else {
        count++;
      }
    }

    return count;
  }

  /**
   * 验证差异应用结果
   */
  async verify(asarExtractDir: string, manifest: DiffManifest): Promise<boolean> {
    log.info('[DiffApplier] 开始验证差异应用结果');

    try {
      // 验证删除的文件确实不存在
      for (const filePath of manifest.deleted) {
        const targetPath = path.join(asarExtractDir, filePath);
        if (fs.existsSync(targetPath)) {
          log.error(`[DiffApplier] 验证失败: 文件应该被删除但仍存在: ${filePath}`);
          return false;
        }
      }

      // 验证修改的文件存在
      for (const filePath of manifest.changed) {
        const targetPath = path.join(asarExtractDir, filePath);
        if (!fs.existsSync(targetPath)) {
          log.error(`[DiffApplier] 验证失败: 文件应该存在但不存在: ${filePath}`);
          return false;
        }
      }

      log.info('[DiffApplier] 验证通过');
      return true;
    } catch (error) {
      log.error('[DiffApplier] 验证过程出错:', error);
      return false;
    }
  }

  /**
   * 清理差异包临时文件
   */
  async cleanup(diffDir: string): Promise<void> {
    try {
      if (fs.existsSync(diffDir)) {
        await fs.remove(diffDir);
        log.info('[DiffApplier] 临时文件清理完成');
      }
    } catch (error) {
      log.warn('[DiffApplier] 清理临时文件失败:', error);
    }
  }
}
