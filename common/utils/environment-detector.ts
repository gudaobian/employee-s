/**
 * 环境检测工具 - 重构版本
 * 运行时环境和系统信息检测
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export interface EnvironmentInfo {
  platform: string;
  architecture: string;
  nodeVersion: string;
  osVersion: string;
  totalMemory: number;
  cpuCount: number;
  cpuModel: string;
  hostname: string;
  homeDirectory: string;
  currentWorkingDirectory: string;
  tempDirectory: string;
  isDocker: boolean;
  isCI: boolean;
  isDevelopment: boolean;
  isProduction: boolean;
  hasAdmin: boolean;
  networkInterfaces: Array<{
    name: string;
    ip: string;
    mac: string;
  }>;
}

export interface RuntimeCapabilities {
  canWriteFiles: boolean;
  canExecuteCommands: boolean;
  hasNetworkAccess: boolean;
  canAccessSystem: boolean;
  supportedFeatures: string[];
}

export class EnvironmentDetector {
  private static instance?: EnvironmentDetector;
  private cachedInfo?: EnvironmentInfo;
  private cachedCapabilities?: RuntimeCapabilities;

  static getInstance(): EnvironmentDetector {
    if (!EnvironmentDetector.instance) {
      EnvironmentDetector.instance = new EnvironmentDetector();
    }
    return EnvironmentDetector.instance;
  }

  /**
   * 获取环境信息
   */
  async getEnvironmentInfo(): Promise<EnvironmentInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    try {
      const info: EnvironmentInfo = {
        platform: os.platform(),
        architecture: os.arch(),
        nodeVersion: process.version,
        osVersion: os.release(),
        totalMemory: os.totalmem(),
        cpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || 'Unknown',
        hostname: os.hostname(),
        homeDirectory: os.homedir(),
        currentWorkingDirectory: process.cwd(),
        tempDirectory: os.tmpdir(),
        isDocker: await this.detectDocker(),
        isCI: this.detectCI(),
        isDevelopment: this.detectDevelopment(),
        isProduction: this.detectProduction(),
        hasAdmin: await this.detectAdminPrivileges(),
        networkInterfaces: this.getNetworkInterfaces()
      };

      this.cachedInfo = info;
      return info;
    } catch (error) {
      console.error('[EnvironmentDetector] Error getting environment info:', error);
      throw error;
    }
  }

  /**
   * 获取运行时能力
   */
  async getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
    if (this.cachedCapabilities) {
      return this.cachedCapabilities;
    }

    try {
      const capabilities: RuntimeCapabilities = {
        canWriteFiles: await this.testFileWriteCapability(),
        canExecuteCommands: await this.testCommandExecutionCapability(),
        hasNetworkAccess: await this.testNetworkCapability(),
        canAccessSystem: await this.testSystemAccessCapability(),
        supportedFeatures: await this.detectSupportedFeatures()
      };

      this.cachedCapabilities = capabilities;
      return capabilities;
    } catch (error) {
      console.error('[EnvironmentDetector] Error getting runtime capabilities:', error);
      throw error;
    }
  }

  /**
   * 检测是否在Docker环境中运行
   */
  private async detectDocker(): Promise<boolean> {
    try {
      // 检查 /.dockerenv 文件
      if (fs.existsSync('/.dockerenv')) {
        return true;
      }

      // 检查 /proc/1/cgroup 文件
      if (fs.existsSync('/proc/1/cgroup')) {
        const cgroupContent = await fs.promises.readFile('/proc/1/cgroup', 'utf8');
        return cgroupContent.includes('docker') || cgroupContent.includes('kubepods');
      }

      // 检查环境变量
      return !!(process.env.DOCKER_CONTAINER || process.env.KUBERNETES_SERVICE_HOST);
    } catch {
      return false;
    }
  }

  /**
   * 检测CI环境
   */
  private detectCI(): boolean {
    const ciEnvironments = [
      'CI', 'CONTINUOUS_INTEGRATION', 'BUILD_ID', 'BUILD_NUMBER',
      'JENKINS_URL', 'TRAVIS', 'CIRCLECI', 'APPVEYOR', 'GITLAB_CI',
      'BUILDKITE', 'DRONE', 'GITHUB_ACTIONS', 'TF_BUILD'
    ];

    return ciEnvironments.some(env => !!process.env[env]);
  }

  /**
   * 检测开发环境
   */
  private detectDevelopment(): boolean {
    return process.env.NODE_ENV === 'development' ||
           process.env.NODE_ENV === 'dev' ||
           !process.env.NODE_ENV ||
           !!process.env.DEBUG;
  }

  /**
   * 检测生产环境
   */
  private detectProduction(): boolean {
    return process.env.NODE_ENV === 'production' ||
           process.env.NODE_ENV === 'prod';
  }

  /**
   * 检测管理员权限
   */
  private async detectAdminPrivileges(): Promise<boolean> {
    try {
      const platform = os.platform();
      
      if (platform === 'win32') {
        // Windows: 检查是否可以写入系统目录
        const testPath = path.join(process.env.WINDIR || 'C:\\Windows', 'temp', 'admin-test.tmp');
        try {
          await fs.promises.writeFile(testPath, 'test');
          await fs.promises.unlink(testPath);
          return true;
        } catch {
          return false;
        }
      } else {
        // Unix-like: 检查UID
        return process.getuid ? process.getuid() === 0 : false;
      }
    } catch {
      return false;
    }
  }

  /**
   * 获取网络接口信息
   */
  private getNetworkInterfaces(): Array<{ name: string; ip: string; mac: string }> {
    try {
      const interfaces = os.networkInterfaces();
      const result: Array<{ name: string; ip: string; mac: string }> = [];

      Object.entries(interfaces).forEach(([name, addrs]) => {
        if (addrs && Array.isArray(addrs)) {
          addrs.forEach((addr: any) => {
            if (!addr.internal && addr.family === 'IPv4') {
              result.push({
                name,
                ip: addr.address,
                mac: addr.mac
              });
            }
          });
        }
      });

      return result;
    } catch (error) {
      console.warn('[EnvironmentDetector] Error getting network interfaces:', error);
      return [];
    }
  }

  /**
   * 测试文件写入能力
   */
  private async testFileWriteCapability(): Promise<boolean> {
    try {
      const testFile = path.join(os.tmpdir(), `env-test-${Date.now()}.tmp`);
      await fs.promises.writeFile(testFile, 'test');
      await fs.promises.unlink(testFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 测试命令执行能力
   */
  private async testCommandExecutionCapability(): Promise<boolean> {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      const command = os.platform() === 'win32' ? 'echo test' : 'echo test';
      const { stdout } = await execPromise(command);
      return stdout.trim() === 'test';
    } catch {
      return false;
    }
  }

  /**
   * 测试网络能力
   */
  private async testNetworkCapability(): Promise<boolean> {
    try {
      const https = require('https');
      return new Promise((resolve) => {
        const req = https.request({
          hostname: 'www.google.com',
          port: 443,
          path: '/generate_204',
          method: 'HEAD',
          timeout: 3000
        }, (res: any) => {
          resolve(res.statusCode === 204);
        });
        
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
        
        req.end();
      });
    } catch {
      return false;
    }
  }

  /**
   * 测试系统访问能力
   */
  private async testSystemAccessCapability(): Promise<boolean> {
    try {
      // 检查是否可以访问系统信息
      os.cpus();
      os.networkInterfaces();
      process.memoryUsage();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检测支持的特性
   */
  private async detectSupportedFeatures(): Promise<string[]> {
    const features: string[] = [];

    try {
      // 检测 Node.js 特性
      if (typeof require !== 'undefined') features.push('commonjs');
      if (typeof process !== 'undefined') features.push('process');
      if (typeof Buffer !== 'undefined') features.push('buffer');
      
      // 检测文件系统能力
      if (fs.existsSync) features.push('filesystem');
      
      // 检测网络能力
      try {
        require('http');
        features.push('http');
      } catch {}
      
      try {
        require('https');
        features.push('https');
      } catch {}
      
      // 检测加密能力
      try {
        require('crypto');
        features.push('crypto');
      } catch {}
      
      // 检测子进程能力
      try {
        require('child_process');
        features.push('child_process');
      } catch {}
      
      // 检测压缩能力
      try {
        require('zlib');
        features.push('compression');
      } catch {}
      
      // 检测流能力
      try {
        require('stream');
        features.push('streams');
      } catch {}
      
      return features;
    } catch (error) {
      console.warn('[EnvironmentDetector] Error detecting features:', error);
      return features;
    }
  }

  /**
   * 获取系统资源信息
   */
  async getSystemResources(): Promise<{
    memory: {
      total: number;
      free: number;
      used: number;
      usagePercent: number;
    };
    cpu: {
      count: number;
      model: string;
      loadAverage: number[];
    };
    uptime: number;
  }> {
    try {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      
      return {
        memory: {
          total: totalMemory,
          free: freeMemory,
          used: usedMemory,
          usagePercent: (usedMemory / totalMemory) * 100
        },
        cpu: {
          count: os.cpus().length,
          model: os.cpus()[0]?.model || 'Unknown',
          loadAverage: os.loadavg()
        },
        uptime: os.uptime()
      };
    } catch (error) {
      console.error('[EnvironmentDetector] Error getting system resources:', error);
      throw error;
    }
  }

  /**
   * 检查特定能力是否可用
   */
  async hasCapability(capability: string): Promise<boolean> {
    const capabilities = await this.getRuntimeCapabilities();
    
    switch (capability.toLowerCase()) {
      case 'files':
      case 'filesystem':
        return capabilities.canWriteFiles;
      case 'network':
        return capabilities.hasNetworkAccess;
      case 'commands':
      case 'exec':
        return capabilities.canExecuteCommands;
      case 'system':
        return capabilities.canAccessSystem;
      default:
        return capabilities.supportedFeatures.includes(capability);
    }
  }

  /**
   * 获取环境简要信息
   */
  getQuickInfo(): {
    platform: string;
    arch: string;
    node: string;
    isDev: boolean;
    isCI: boolean;
  } {
    return {
      platform: os.platform(),
      arch: os.arch(),
      node: process.version,
      isDev: this.detectDevelopment(),
      isCI: this.detectCI()
    };
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.cachedInfo = undefined;
    this.cachedCapabilities = undefined;
  }

  /**
   * 生成环境报告
   */
  async generateReport(): Promise<string> {
    const info = await this.getEnvironmentInfo();
    const capabilities = await this.getRuntimeCapabilities();
    const resources = await this.getSystemResources();
    
    const report = [
      '# Environment Report',
      '',
      '## System Information',
      `- Platform: ${info.platform} (${info.architecture})`,
      `- OS Version: ${info.osVersion}`,
      `- Node.js: ${info.nodeVersion}`,
      `- Hostname: ${info.hostname}`,
      `- Docker: ${info.isDocker ? 'Yes' : 'No'}`,
      `- CI Environment: ${info.isCI ? 'Yes' : 'No'}`,
      `- Admin Privileges: ${info.hasAdmin ? 'Yes' : 'No'}`,
      '',
      '## Resources',
      `- Total Memory: ${Math.round(resources.memory.total / 1024 / 1024 / 1024 * 100) / 100} GB`,
      `- Memory Usage: ${Math.round(resources.memory.usagePercent * 100) / 100}%`,
      `- CPU Cores: ${resources.cpu.count}`,
      `- CPU Model: ${resources.cpu.model}`,
      `- System Uptime: ${Math.round(resources.uptime / 3600 * 100) / 100} hours`,
      '',
      '## Capabilities',
      `- File System: ${capabilities.canWriteFiles ? '✓' : '✗'}`,
      `- Network Access: ${capabilities.hasNetworkAccess ? '✓' : '✗'}`,
      `- Command Execution: ${capabilities.canExecuteCommands ? '✓' : '✗'}`,
      `- System Access: ${capabilities.canAccessSystem ? '✓' : '✗'}`,
      '',
      '## Supported Features',
      ...capabilities.supportedFeatures.map(feature => `- ${feature}`),
      '',
      '## Network Interfaces',
      ...info.networkInterfaces.map(iface => `- ${iface.name}: ${iface.ip} (${iface.mac})`),
      ''
    ];
    
    return report.join('\n');
  }
}

// 导出默认实例
export const environmentDetector = EnvironmentDetector.getInstance();

// 便捷函数
export const getEnvironmentInfo = (): Promise<EnvironmentInfo> => {
  return environmentDetector.getEnvironmentInfo();
};

export const getRuntimeCapabilities = (): Promise<RuntimeCapabilities> => {
  return environmentDetector.getRuntimeCapabilities();
};

export const hasCapability = (capability: string): Promise<boolean> => {
  return environmentDetector.hasCapability(capability);
};

export const getQuickInfo = (): any => {
  return environmentDetector.getQuickInfo();
};

export const isPlatform = (platform: string): boolean => {
  return os.platform() === platform;
};

export const isWindows = (): boolean => isPlatform('win32');
export const isMacOS = (): boolean => isPlatform('darwin');
export const isLinux = (): boolean => isPlatform('linux');

export default EnvironmentDetector;