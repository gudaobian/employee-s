/**
 * 平台工厂类
 * 根据当前操作系统自动选择合适的平台适配器
 */

import * as os from 'os';
import { IPlatformAdapter } from './interfaces/platform-interface';
import DarwinAdapter from './darwin/darwin-adapter';
import { WindowsAdapter as Win32Adapter } from './windows/windows-adapter';
import LinuxAdapter from './linux/linux-adapter';
import { logger } from '../common/utils';

export type PlatformType = 'darwin' | 'win32' | 'linux' | 'unknown';

export interface PlatformInfo {
  type: PlatformType;
  name: string;
  version: string;
  architecture: string;
  isSupported: boolean;
  capabilities: string[];
}

export class PlatformFactory {
  private static instance?: PlatformFactory;
  private currentAdapter?: IPlatformAdapter;
  private platformInfo?: PlatformInfo;

  private constructor() {}

  static getInstance(): PlatformFactory {
    if (!PlatformFactory.instance) {
      PlatformFactory.instance = new PlatformFactory();
    }
    return PlatformFactory.instance;
  }

  /**
   * 获取平台信息
   */
  getPlatformInfo(): PlatformInfo {
    if (!this.platformInfo) {
      this.platformInfo = this.detectPlatform();
    }
    return this.platformInfo;
  }

  /**
   * 创建平台适配器
   */
  async createPlatformAdapter(): Promise<IPlatformAdapter> {
    if (this.currentAdapter) {
      return this.currentAdapter;
    }

    const platformInfo = this.getPlatformInfo();
    
    if (!platformInfo.isSupported) {
      throw new Error(`Unsupported platform: ${platformInfo.name}`);
    }

    logger.info(`Creating platform adapter for: ${platformInfo.name}`);

    switch (platformInfo.type) {
      case 'darwin':
        this.currentAdapter = new DarwinAdapter();
        break;
      
      case 'win32':
        this.currentAdapter = new Win32Adapter();
        break;
      
      case 'linux':
        this.currentAdapter = new LinuxAdapter();
        break;
      
      default:
        throw new Error(`No adapter available for platform: ${platformInfo.type}`);
    }

    // 初始化适配器
    await this.currentAdapter.initialize();
    
    logger.info('Platform adapter created and initialized successfully');
    return this.currentAdapter;
  }

  /**
   * 获取当前适配器
   */
  getCurrentAdapter(): IPlatformAdapter | undefined {
    return this.currentAdapter;
  }

  /**
   * 检查平台支持性
   */
  isPlatformSupported(platform?: PlatformType): boolean {
    const targetPlatform = platform || this.getPlatformInfo().type;
    return ['darwin', 'win32', 'linux'].includes(targetPlatform);
  }

  /**
   * 获取支持的平台列表
   */
  getSupportedPlatforms(): PlatformType[] {
    return ['darwin', 'win32', 'linux'];
  }

  /**
   * 检查特定功能支持
   */
  async isFeatureSupported(feature: string): Promise<boolean> {
    if (!this.currentAdapter) {
      await this.createPlatformAdapter();
    }
    
    const capabilities = this.currentAdapter!.getPlatformCapabilities();
    return capabilities.includes(feature);
  }

  /**
   * 获取平台功能列表
   */
  async getPlatformCapabilities(): Promise<string[]> {
    if (!this.currentAdapter) {
      await this.createPlatformAdapter();
    }
    
    return this.currentAdapter!.getPlatformCapabilities();
  }

  /**
   * 重置平台适配器
   */
  async resetAdapter(): Promise<void> {
    if (this.currentAdapter) {
      await this.currentAdapter.cleanup();
      this.currentAdapter = undefined;
    }
    
    logger.info('Platform adapter reset');
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.resetAdapter();
    this.platformInfo = undefined;
    PlatformFactory.instance = undefined;
    
    logger.info('Platform factory cleaned up');
  }

  /**
   * 检测平台信息
   */
  private detectPlatform(): PlatformInfo {
    const platform = os.platform();
    const arch = os.arch();
    const release = os.release();
    
    let platformType: PlatformType;
    let platformName: string;
    let isSupported: boolean;
    let capabilities: string[];
    
    switch (platform) {
      case 'darwin':
        platformType = 'darwin';
        platformName = 'macOS';
        isSupported = true;
        capabilities = this.getMacOSCapabilities();
        break;
      
      case 'win32':
        platformType = 'win32';
        platformName = 'Windows';
        isSupported = true;
        capabilities = this.getWindowsCapabilities();
        break;
      
      case 'linux':
        platformType = 'linux';
        platformName = 'Linux';
        isSupported = true;
        capabilities = this.getLinuxCapabilities();
        break;
      
      default:
        platformType = 'unknown';
        platformName = platform;
        isSupported = false;
        capabilities = [];
        break;
    }
    
    return {
      type: platformType,
      name: platformName,
      version: release,
      architecture: arch,
      isSupported,
      capabilities
    };
  }

  /**
   * 获取 macOS 可能的功能
   */
  private getMacOSCapabilities(): string[] {
    const baseCapabilities = [
      'screenshot',
      'activity_monitoring',
      'window_tracking',
      'process_monitoring',
      'network_monitoring',
      'auto_start',
      'accessibility_check',
      'applescript_support',
      'native_permissions'
    ];
    
    // 根据 macOS 版本添加特定功能
    const version = parseFloat(os.release());
    
    if (version >= 19) { // macOS 10.15+
      baseCapabilities.push('screen_recording_permission');
    }
    
    if (version >= 20) { // macOS 11.0+
      baseCapabilities.push('privacy_framework');
    }
    
    return baseCapabilities;
  }

  /**
   * 获取 Windows 可能的功能
   */
  private getWindowsCapabilities(): string[] {
    const baseCapabilities = [
      'screenshot',
      'activity_monitoring',
      'window_tracking',
      'process_monitoring',
      'network_monitoring',
      'auto_start',
      'registry_access',
      'wmi_support'
    ];
    
    // 检查 PowerShell 支持
    try {
      require('child_process').execSync('powershell -Command "Get-Host"', { stdio: 'ignore' });
      baseCapabilities.push('powershell_support');
    } catch {}
    
    // 根据 Windows 版本添加特定功能
    const version = os.release();
    if (version >= '10.0') {
      baseCapabilities.push('modern_windows_api');
    }
    
    return baseCapabilities;
  }

  /**
   * 获取 Linux 可能的功能
   */
  private getLinuxCapabilities(): string[] {
    const baseCapabilities = [
      'process_monitoring',
      'network_monitoring',
      'auto_start',
      'systemd_support'
    ];
    
    // 检查显示服务器支持
    if (process.env.DISPLAY) {
      baseCapabilities.push('x11_support', 'screenshot', 'window_tracking');
    }
    
    if (process.env.WAYLAND_DISPLAY) {
      baseCapabilities.push('wayland_support');
    }
    
    // 检查桌面环境
    const desktop = process.env.XDG_CURRENT_DESKTOP?.toLowerCase();
    if (desktop?.includes('gnome')) {
      baseCapabilities.push('gnome_integration', 'accessibility_control');
    } else if (desktop?.includes('kde')) {
      baseCapabilities.push('kde_integration');
    }
    
    return baseCapabilities;
  }

  /**
   * 获取平台特定配置
   */
  getPlatformSpecificConfig(): any {
    const platformInfo = this.getPlatformInfo();
    
    const baseConfig = {
      platform: platformInfo.type,
      name: platformInfo.name,
      version: platformInfo.version,
      architecture: platformInfo.architecture
    };
    
    switch (platformInfo.type) {
      case 'darwin':
        return {
          ...baseConfig,
          screenshotTool: 'screencapture',
          scriptingLanguage: 'applescript',
          autoStartMethod: 'launchagent',
          configDir: '~/Library/Application Support',
          logDir: '~/Library/Logs',
          permissionsRequired: ['accessibility', 'screen_recording']
        };
      
      case 'win32':
        return {
          ...baseConfig,
          screenshotMethod: 'powershell',
          scriptingLanguage: 'powershell',
          autoStartMethod: 'registry',
          configDir: '%APPDATA%',
          logDir: '%LOCALAPPDATA%/Logs',
          permissionsRequired: []
        };
      
      case 'linux':
        return {
          ...baseConfig,
          screenshotTool: process.env.DISPLAY ? 'scrot' : 'grim',
          displayServer: process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11',
          desktopEnvironment: process.env.XDG_CURRENT_DESKTOP,
          autoStartMethod: 'desktop-file',
          configDir: '~/.config',
          logDir: '~/.local/share/logs',
          permissionsRequired: []
        };
      
      default:
        return baseConfig;
    }
  }

  /**
   * 生成平台报告
   */
  generatePlatformReport(): string {
    const platformInfo = this.getPlatformInfo();
    const config = this.getPlatformSpecificConfig();
    
    const report = [
      '# Platform Report',
      '',
      '## Basic Information',
      `- Platform: ${platformInfo.name} (${platformInfo.type})`,
      `- Version: ${platformInfo.version}`,
      `- Architecture: ${platformInfo.architecture}`,
      `- Supported: ${platformInfo.isSupported ? '✓' : '✗'}`,
      '',
      '## Capabilities',
      ...platformInfo.capabilities.map(cap => `- ${cap}`),
      '',
      '## Configuration',
      ...Object.entries(config).map(([key, value]) => `- ${key}: ${value}`),
      ''
    ];
    
    return report.join('\n');
  }
}

// 导出默认实例
export const platformFactory = PlatformFactory.getInstance();

// 便捷函数
export const createPlatformAdapter = (): Promise<IPlatformAdapter> => {
  return platformFactory.createPlatformAdapter();
};

export const getPlatformInfo = (): PlatformInfo => {
  return platformFactory.getPlatformInfo();
};

export const isPlatformSupported = (platform?: PlatformType): boolean => {
  return platformFactory.isPlatformSupported(platform);
};

export const isFeatureSupported = (feature: string): Promise<boolean> => {
  return platformFactory.isFeatureSupported(feature);
};

export default PlatformFactory;