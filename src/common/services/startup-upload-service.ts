/**
 * 启动上传服务
 *
 * 职责：
 * 1. 检查本地是否有积压数据
 * 2. 压缩积压数据为ZIP文件
 * 3. 上传ZIP文件到服务器
 * 4. 删除本地原始文件和ZIP文件
 *
 * 调用时机：
 * - 应用启动时（WebSocket连接成功后）
 * - WebSocket重连成功后
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import archiver from 'archiver';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils';
import FormData from 'form-data';
import { glob } from 'glob';

interface StartupUploadConfig {
  apiEndpoint: string;      // 上传接口地址 (如: http://api.com/api/startup-upload)
  deviceId: string;         // 设备ID
  sessionId: string;        // 会话ID
  queueCacheDir: string;    // 队列缓存目录
}

interface CompressResult {
  type: 'screenshots' | 'activities' | 'processes';
  zipPath: string | null;
  fileCount: number;
  originalSize: number;
  compressedSize: number;
}

export class StartupUploadService {
  private config: StartupUploadConfig;

  constructor(config: StartupUploadConfig) {
    this.config = config;
  }

  /**
   * 主入口: 检查并上传积压数据
   * 在客户端启动/WebSocket重连时调用
   */
  async checkAndUpload(): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info('[STARTUP_UPLOAD] 开始检查本地积压数据', {
        queueCacheDir: this.config.queueCacheDir
      });

      // 1. 检查是否有积压数据
      const hasData = await this.hasBacklogData();

      if (!hasData) {
        logger.info('[STARTUP_UPLOAD] 无积压数据,跳过上传');
        return;
      }

      logger.info('[STARTUP_UPLOAD] 发现积压数据,开始处理...');

      // 2. 压缩各类数据
      const compressResults: CompressResult[] = [];

      // 2.1 压缩截图数据(需要合并JPEG和元数据)
      const screenshotResult = await this.compressScreenshots();
      if (screenshotResult) {
        compressResults.push(screenshotResult);
      }

      // 2.2 压缩活动数据
      const activityResult = await this.compressActivities();
      if (activityResult) {
        compressResults.push(activityResult);
      }

      // 2.3 压缩进程数据
      const processResult = await this.compressProcesses();
      if (processResult) {
        compressResults.push(processResult);
      }

      if (compressResults.length === 0) {
        logger.info('[STARTUP_UPLOAD] 无数据需要上传');
        return;
      }

      // 3. 删除原始文件(压缩成功后)
      await this.deleteOriginalFiles();

      // 4. 上传ZIP文件
      const uploadSuccess = await this.uploadZipFiles(compressResults);

      // 5. 清理
      if (uploadSuccess) {
        // 上传成功,删除ZIP文件
        for (const result of compressResults) {
          if (result.zipPath) {
            await fs.remove(result.zipPath);
          }
        }

        const duration = Date.now() - startTime;
        logger.info('[STARTUP_UPLOAD] ✅ 积压数据上传成功', {
          duration,
          filesUploaded: compressResults.length,
          totalOriginalSize: compressResults.reduce((sum, r) => sum + r.originalSize, 0),
          totalCompressedSize: compressResults.reduce((sum, r) => sum + r.compressedSize, 0)
        });
      } else {
        // 上传失败,保留ZIP文件供下次重试
        logger.error('[STARTUP_UPLOAD] ❌ 上传失败,ZIP文件已保留', {
          zipFiles: compressResults.map(r => r.zipPath)
        });
      }

    } catch (error: any) {
      logger.error('[STARTUP_UPLOAD] 处理失败', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * 检查是否有积压数据
   */
  private async hasBacklogData(): Promise<boolean> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');
    const processesDir = path.join(this.config.queueCacheDir, 'processes');

    // 递归统计JSON文件数量
    const screenshotCount = await this.countMetaFiles(screenshotsDir);
    const activityCount = await this.countJsonFiles(activitiesDir);
    const processCount = await this.countJsonFiles(processesDir);

    logger.info('[STARTUP_UPLOAD] 积压数据统计', {
      screenshots: screenshotCount,
      activities: activityCount,
      processes: processCount
    });

    return screenshotCount > 0 || activityCount > 0 || processCount > 0;
  }

  /**
   * 统计目录下.meta.json文件数量(截图)
   */
  private async countMetaFiles(dir: string): Promise<number> {
    if (!await fs.pathExists(dir)) {
      return 0;
    }

    const files = await glob('**/*.meta.json', {
      cwd: dir,
      absolute: false,
      nodir: true
    });

    return files.length;
  }

  /**
   * 统计目录下JSON文件数量(活动/进程)
   */
  private async countJsonFiles(dir: string): Promise<number> {
    if (!await fs.pathExists(dir)) {
      return 0;
    }

    const files = await glob('**/*.json', {
      cwd: dir,
      absolute: false,
      nodir: true
    });

    return files.length;
  }

  /**
   * 压缩截图数据
   * 需要将JPEG文件读取为Base64并合并到元数据JSON中
   */
  private async compressScreenshots(): Promise<CompressResult | null> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');

    if (!await fs.pathExists(screenshotsDir)) {
      return null;
    }

    // 收集所有元数据文件
    const metaFiles = await glob('**/*.meta.json', {
      cwd: screenshotsDir,
      absolute: true,
      nodir: true
    });

    if (metaFiles.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无截图数据需要压缩');
      return null;
    }

    const zipPath = path.join(
      this.config.queueCacheDir,
      `screenshots_${Date.now()}.zip`
    );

    logger.info('[STARTUP_UPLOAD] 开始压缩截图数据', {
      fileCount: metaFiles.length,
      zipPath
    });

    let originalSize = 0;

    // 创建ZIP
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 6 }  // 压缩级别6(平衡速度和压缩率)
    });

    archive.pipe(output);

    // 处理每个元数据文件
    for (const metaFilePath of metaFiles) {
      try {
        // 读取元数据
        const metadata = await fs.readJson(metaFilePath);

        // 读取对应的JPEG文件
        const jpegPath = metaFilePath.replace('.meta.json', '.jpg');

        if (!await fs.pathExists(jpegPath)) {
          logger.warn('[STARTUP_UPLOAD] JPEG文件不存在,跳过', {
            metaFile: metaFilePath,
            jpegPath
          });
          continue;
        }

        // 读取JPEG文件并转Base64
        const jpegBuffer = await fs.readFile(jpegPath);
        const base64Buffer = jpegBuffer.toString('base64');

        // 合并数据(ZIP内JSON格式)
        const zipData = {
          id: metadata.id,
          timestamp: metadata.timestamp,
          buffer: base64Buffer,  // Base64编码的JPEG数据
          fileSize: metadata.fileSize,
          format: 'jpg',
          quality: 75,
          resolution: {
            width: 1920,
            height: 1080
          },
          _metadata: {
            uploadStatus: 'pending',
            createdAt: metadata.createdAt || metadata.timestamp
          }
        };

        // 添加到ZIP(使用原始ID作为文件名)
        const jsonFileName = `${metadata.id}.json`;
        const zipDataStr = JSON.stringify(zipData);
        archive.append(zipDataStr, { name: jsonFileName });

        // 计算原始大小
        const metadataStr = JSON.stringify(metadata);
        originalSize += jpegBuffer.length + metadataStr.length;
      } catch (error: any) {
        logger.error('[STARTUP_UPLOAD] 处理截图文件失败', {
          metaFile: metaFilePath,
          error: error.message
        });
        // 继续处理下一个文件
      }
    }

    await archive.finalize();

    // 等待流关闭
    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const compressedSize = (await fs.stat(zipPath)).size;

    logger.info('[STARTUP_UPLOAD] 截图数据压缩完成', {
      fileCount: metaFiles.length,
      originalSize,
      compressedSize,
      compressionRatio: `${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`,
      zipPath
    });

    return {
      type: 'screenshots',
      zipPath,
      fileCount: metaFiles.length,
      originalSize,
      compressedSize
    };
  }

  /**
   * 压缩活动数据
   */
  private async compressActivities(): Promise<CompressResult | null> {
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');

    if (!await fs.pathExists(activitiesDir)) {
      return null;
    }

    const jsonFiles = await glob('**/*.json', {
      cwd: activitiesDir,
      absolute: true,
      nodir: true
    });

    if (jsonFiles.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无活动数据需要压缩');
      return null;
    }

    const zipPath = path.join(
      this.config.queueCacheDir,
      `activities_${Date.now()}.zip`
    );

    logger.info('[STARTUP_UPLOAD] 开始压缩活动数据', {
      fileCount: jsonFiles.length,
      zipPath
    });

    let originalSize = 0;

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(output);

    // 添加所有JSON文件到ZIP
    for (const filePath of jsonFiles) {
      const fileContent = await fs.readFile(filePath);
      const fileName = path.basename(filePath);

      archive.append(fileContent, { name: fileName });
      originalSize += fileContent.length;
    }

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const compressedSize = (await fs.stat(zipPath)).size;

    logger.info('[STARTUP_UPLOAD] 活动数据压缩完成', {
      fileCount: jsonFiles.length,
      originalSize,
      compressedSize,
      compressionRatio: `${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`,
      zipPath
    });

    return {
      type: 'activities',
      zipPath,
      fileCount: jsonFiles.length,
      originalSize,
      compressedSize
    };
  }

  /**
   * 压缩进程数据
   */
  private async compressProcesses(): Promise<CompressResult | null> {
    const processesDir = path.join(this.config.queueCacheDir, 'processes');

    if (!await fs.pathExists(processesDir)) {
      return null;
    }

    const jsonFiles = await glob('**/*.json', {
      cwd: processesDir,
      absolute: true,
      nodir: true
    });

    if (jsonFiles.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无进程数据需要压缩');
      return null;
    }

    const zipPath = path.join(
      this.config.queueCacheDir,
      `processes_${Date.now()}.zip`
    );

    logger.info('[STARTUP_UPLOAD] 开始压缩进程数据', {
      fileCount: jsonFiles.length,
      zipPath
    });

    let originalSize = 0;

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.pipe(output);

    for (const filePath of jsonFiles) {
      const fileContent = await fs.readFile(filePath);
      const fileName = path.basename(filePath);

      archive.append(fileContent, { name: fileName });
      originalSize += fileContent.length;
    }

    await archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', reject);
    });

    const compressedSize = (await fs.stat(zipPath)).size;

    logger.info('[STARTUP_UPLOAD] 进程数据压缩完成', {
      fileCount: jsonFiles.length,
      originalSize,
      compressedSize,
      compressionRatio: `${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`,
      zipPath
    });

    return {
      type: 'processes',
      zipPath,
      fileCount: jsonFiles.length,
      originalSize,
      compressedSize
    };
  }

  /**
   * 删除原始JSON和JPEG文件
   */
  private async deleteOriginalFiles(): Promise<void> {
    const screenshotsDir = path.join(this.config.queueCacheDir, 'screenshots');
    const activitiesDir = path.join(this.config.queueCacheDir, 'activities');
    const processesDir = path.join(this.config.queueCacheDir, 'processes');

    // 删除截图文件(.jpg + .meta.json)
    if (await fs.pathExists(screenshotsDir)) {
      await this.deleteFilesRecursive(screenshotsDir, ['.jpg', '.meta.json']);
    }

    // 删除活动JSON文件
    if (await fs.pathExists(activitiesDir)) {
      await this.deleteFilesRecursive(activitiesDir, ['.json']);
    }

    // 删除进程JSON文件
    if (await fs.pathExists(processesDir)) {
      await this.deleteFilesRecursive(processesDir, ['.json']);
    }

    logger.info('[STARTUP_UPLOAD] 原始文件已删除');
  }

  /**
   * 递归删除指定扩展名的文件
   */
  private async deleteFilesRecursive(dir: string, extensions: string[]): Promise<void> {
    if (!await fs.pathExists(dir)) {
      return;
    }

    const items = await fs.readdir(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // 递归删除子目录中的文件
        await this.deleteFilesRecursive(fullPath, extensions);

        // 如果目录为空,删除目录
        const remaining = await fs.readdir(fullPath);
        if (remaining.length === 0) {
          await fs.remove(fullPath);
        }
      } else {
        // 检查文件扩展名
        const ext = path.extname(item);
        if (extensions.includes(ext)) {
          await fs.remove(fullPath);
        }
      }
    }
  }

  /**
   * 上传ZIP文件
   */
  private async uploadZipFiles(compressResults: CompressResult[]): Promise<boolean> {
    const zipFilesWithPaths = compressResults.filter(r => r.zipPath !== null);

    if (zipFilesWithPaths.length === 0) {
      logger.info('[STARTUP_UPLOAD] 无ZIP文件需要上传');
      return true;
    }

    try {
      const uploadId = uuidv4();

      logger.info('[STARTUP_UPLOAD] 开始上传ZIP文件', {
        uploadId,
        fileCount: zipFilesWithPaths.length,
        files: zipFilesWithPaths.map(r => ({
          type: r.type,
          size: r.compressedSize
        }))
      });

      // 创建FormData
      const formData = new FormData();

      formData.append('deviceId', this.config.deviceId);
      formData.append('sessionId', this.config.sessionId);
      formData.append('uploadId', uploadId);

      // 添加ZIP文件
      for (const result of zipFilesWithPaths) {
        if (result.zipPath) {
          const fieldName = result.type === 'screenshots' ? 'screenshotZip' :
                           result.type === 'activities' ? 'activityZip' : 'processZip';
          formData.append(fieldName, fs.createReadStream(result.zipPath));
        }
      }

      // 上传
      const response = await axios.post(
        this.config.apiEndpoint,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 120000,  // 2分钟超时
          maxContentLength: 500 * 1024 * 1024,  // 500MB
          maxBodyLength: 500 * 1024 * 1024
        }
      );

      if (response.status === 200 && response.data.success) {
        logger.info('[STARTUP_UPLOAD] 上传成功', {
          uploadId,
          response: response.data
        });
        return true;
      }

      logger.error('[STARTUP_UPLOAD] 上传失败', {
        uploadId,
        status: response.status,
        data: response.data
      });
      return false;

    } catch (error: any) {
      logger.error('[STARTUP_UPLOAD] 上传异常', {
        error: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      return false;
    }
  }
}
