/**
 * 路径帮助工具 - 重构版本
 * 跨平台路径处理工具
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class PathHelper {
  private static appName = 'employee-monitor';

  /**
   * 安全地连接路径组件
   */
  static join(...paths: string[]): string {
    // 过滤掉空字符串和undefined/null值
    const validPaths = paths.filter(p => p && typeof p === 'string' && p.trim());
    
    if (validPaths.length === 0) {
      return '';
    }
    
    return path.join(...validPaths);
  }

  /**
   * 解析相对路径为绝对路径
   */
  static resolve(relativePath: string): string {
    if (!relativePath || typeof relativePath !== 'string') {
      return process.cwd();
    }
    
    return path.resolve(relativePath);
  }

  /**
   * 规范化路径（处理 ../ 和 ./）
   */
  static normalize(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') {
      return '';
    }
    
    return path.normalize(inputPath);
  }

  /**
   * 获取文件的目录路径
   */
  static dirname(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      return '';
    }
    
    return path.dirname(filePath);
  }

  /**
   * 获取文件名（包含扩展名）
   */
  static basename(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      return '';
    }
    
    return path.basename(filePath);
  }

  /**
   * 获取文件扩展名
   */
  static extname(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      return '';
    }
    
    return path.extname(filePath);
  }

  /**
   * 检查路径是否为绝对路径
   */
  static isAbsolute(inputPath: string): boolean {
    if (!inputPath || typeof inputPath !== 'string') {
      return false;
    }
    
    return path.isAbsolute(inputPath);
  }

  /**
   * 获取配置目录路径
   */
  static getConfigDir(): string {
    try {
      let configDir: string;

      if (process.platform === 'win32') {
        configDir = this.join(process.env.APPDATA || os.homedir(), this.appName);
      } else if (process.platform === 'darwin') {
        configDir = this.join(os.homedir(), 'Library', 'Application Support', this.appName);
      } else {
        configDir = this.join(process.env.XDG_CONFIG_HOME || this.join(os.homedir(), '.config'), this.appName);
      }

      return configDir;
    } catch {
      // 后备选项：当前目录的config文件夹
      return this.join(process.cwd(), 'config');
    }
  }

  /**
   * 获取数据目录路径
   */
  static getDataDir(): string {
    try {
      let dataDir: string;

      if (process.platform === 'win32') {
        dataDir = this.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), this.appName);
      } else if (process.platform === 'darwin') {
        dataDir = this.join(os.homedir(), 'Library', 'Application Support', this.appName);
      } else {
        dataDir = this.join(process.env.XDG_DATA_HOME || this.join(os.homedir(), '.local', 'share'), this.appName);
      }

      return dataDir;
    } catch {
      // 后备选项：当前目录的data文件夹
      return this.join(process.cwd(), 'data');
    }
  }

  /**
   * 获取日志目录路径
   */
  static getLogDir(): string {
    try {
      let logDir: string;

      if (process.platform === 'win32') {
        logDir = this.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), this.appName, 'logs');
      } else if (process.platform === 'darwin') {
        logDir = this.join(os.homedir(), 'Library', 'Logs', this.appName);
      } else {
        logDir = this.join(process.env.XDG_STATE_HOME || this.join(os.homedir(), '.local', 'state'), this.appName, 'logs');
      }

      return logDir;
    } catch {
      // 后备选项：当前目录的logs文件夹
      return this.join(process.cwd(), 'logs');
    }
  }

  /**
   * 获取缓存目录路径
   */
  static getCacheDir(): string {
    try {
      let cacheDir: string;

      if (process.platform === 'win32') {
        cacheDir = this.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), this.appName, 'cache');
      } else if (process.platform === 'darwin') {
        cacheDir = this.join(os.homedir(), 'Library', 'Caches', this.appName);
      } else {
        cacheDir = this.join(process.env.XDG_CACHE_HOME || this.join(os.homedir(), '.cache'), this.appName);
      }

      return cacheDir;
    } catch {
      // 后备选项：当前目录的cache文件夹
      return this.join(process.cwd(), 'cache');
    }
  }

  /**
   * 获取临时目录路径
   */
  static getTempDir(): string {
    return this.join(os.tmpdir(), this.appName);
  }

  /**
   * 获取配置文件路径
   */
  static getConfigFilePath(filename: string = 'config.json'): string {
    return this.join(this.getConfigDir(), filename);
  }

  /**
   * 获取日志文件路径
   */
  static getLogFilePath(filename: string = 'app.log'): string {
    return this.join(this.getLogDir(), filename);
  }

  /**
   * 确保目录存在，如果不存在则创建
   */
  static ensureDir(dirPath: string): boolean {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      return true;
    } catch (error) {
      console.error(`[PathHelper] Failed to create directory: ${dirPath}`, error);
      return false;
    }
  }

  /**
   * 确保文件的目录存在
   */
  static ensureDirForFile(filePath: string): boolean {
    const dir = this.dirname(filePath);
    return this.ensureDir(dir);
  }

  /**
   * 检查文件是否存在
   */
  static fileExists(filePath: string): boolean {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * 检查目录是否存在
   */
  static dirExists(dirPath: string): boolean {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * 获取文件信息
   */
  static async getFileInfo(filePath: string): Promise<{
    exists: boolean;
    isFile: boolean;
    isDirectory: boolean;
    size: number;
    mtime: Date;
  } | null> {
    try {
      const stats = await fs.promises.stat(filePath);
      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtime
      };
    } catch {
      return {
        exists: false,
        isFile: false,
        isDirectory: false,
        size: 0,
        mtime: new Date(0)
      };
    }
  }

  /**
   * 删除文件或目录
   */
  static async remove(targetPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(targetPath);
      
      if (stats.isDirectory()) {
        await fs.promises.rmdir(targetPath, { recursive: true });
      } else {
        await fs.promises.unlink(targetPath);
      }
      
      return true;
    } catch (error) {
      console.error(`[PathHelper] Failed to remove: ${targetPath}`, error);
      return false;
    }
  }

  /**
   * 复制文件
   */
  static async copyFile(src: string, dest: string): Promise<boolean> {
    try {
      // 确保目标目录存在
      this.ensureDirForFile(dest);
      
      await fs.promises.copyFile(src, dest);
      return true;
    } catch (error) {
      console.error(`[PathHelper] Failed to copy file from ${src} to ${dest}`, error);
      return false;
    }
  }

  /**
   * 移动/重命名文件
   */
  static async moveFile(src: string, dest: string): Promise<boolean> {
    try {
      // 确保目标目录存在
      this.ensureDirForFile(dest);
      
      await fs.promises.rename(src, dest);
      return true;
    } catch (error) {
      console.error(`[PathHelper] Failed to move file from ${src} to ${dest}`, error);
      return false;
    }
  }

  /**
   * 获取相对路径
   */
  static relative(from: string, to: string): string {
    try {
      return path.relative(from, to);
    } catch {
      return to;
    }
  }

  /**
   * 设置应用程序名称（用于目录命名）
   */
  static setAppName(name: string): void {
    if (name && typeof name === 'string' && name.trim()) {
      this.appName = name.trim();
    }
  }

  /**
   * 获取当前应用程序名称
   */
  static getAppName(): string {
    return this.appName;
  }
}

export default PathHelper;