/**
 * 平台工厂类
 * 根据当前平台自动选择相应的适配器实现
 */

import { IPlatformAdapter } from '../common/interfaces/platform-interface';

export class PlatformFactory {
  /**
   * 创建平台适配器实例
   * @returns 平台特定的适配器实例
   */
  static createAdapter(): IPlatformAdapter {
    switch (process.platform) {
      case 'darwin':
        const { MacOSAdapter } = require('../platforms/macos/macos-adapter');
        return new MacOSAdapter();
      case 'win32':
        const { WindowsAdapter } = require('../platforms/windows/windows-adapter');
        return new WindowsAdapter();
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  /**
   * 获取支持的平台列表
   * @returns 支持的平台数组
   */
  static getSupportedPlatforms(): string[] {
    return ['darwin', 'win32'];
  }

  /**
   * 检查平台是否受支持
   * @param platform 平台标识，默认为当前平台
   * @returns 是否受支持
   */
  static isPlatformSupported(platform: string = process.platform): boolean {
    return this.getSupportedPlatforms().includes(platform);
  }

  /**
   * 获取当前平台信息
   * @returns 当前平台的详细信息
   */
  static getCurrentPlatformInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      supported: this.isPlatformSupported(),
      adapterAvailable: this.isAdapterAvailable()
    };
  }

  /**
   * 检查适配器是否可用
   * @returns 适配器是否可用
   */
  private static isAdapterAvailable(): boolean {
    try {
      this.createAdapter();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 验证平台兼容性
   * @returns 兼容性检查结果
   */
  static validatePlatformCompatibility() {
    const info = this.getCurrentPlatformInfo();
    
    if (!info.supported) {
      throw new Error(`Platform ${info.platform} is not supported. Supported platforms: ${this.getSupportedPlatforms().join(', ')}`);
    }

    if (!info.adapterAvailable) {
      throw new Error(`Platform adapter for ${info.platform} is not available`);
    }

    return {
      valid: true,
      platform: info.platform,
      message: `Platform ${info.platform} is supported and adapter is available`
    };
  }
}