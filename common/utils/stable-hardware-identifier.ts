/**
 * 稳定硬件标识符生成器 - v3.0 简化版
 *
 * 严格使用CPU ProcessorID + 主板序列号生成唯一设备ID
 * 不使用任何降级方案，确保100%硬件唯一性
 */

import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

export interface StableDeviceIdentifier {
  deviceId: string;
  uuid: string;  // v3.0: 单一来源 - 主板UUID
  generatedAt: string;
  version: string;

  // v3.0向后兼容字段（用于旧代码） - 已废弃
  primaryFingerprint?: string;  // @deprecated 使用uuid替代
  secondaryFingerprint?: string; // @deprecated 已移除
  cpuId?: string;  // @deprecated CPU ID不唯一
  baseboardSerial?: string;  // @deprecated 主板序列号经常为空
  confidence?: 'absolute' | 'high' | 'medium' | 'low';  // 固定为absolute
  stability?: 'permanent' | 'stable' | 'variable';  // 固定为permanent
  components?: string[];  // v3.0: ['mainboard-uuid']
}

export class StableHardwareIdentifier {
  private static instance: StableHardwareIdentifier;
  private readonly IDENTIFIER_VERSION = '3.0-native';
  private nativeModule: any = null;

  private constructor() {
    // 延迟加载原生模块，只在实际使用时加载
    // 这样在非Windows平台也能创建实例，不会在构造时失败
  }

  static getInstance(): StableHardwareIdentifier {
    if (!StableHardwareIdentifier.instance) {
      StableHardwareIdentifier.instance = new StableHardwareIdentifier();
    }
    return StableHardwareIdentifier.instance;
  }

  /**
   * 获取macOS硬件UUID
   */
  private getMacOSHardwareUUID(): string {
    try {
      const output = execSync(
        'system_profiler SPHardwareDataType | grep "Hardware UUID" | awk \'{print $3}\'',
        { encoding: 'utf-8' }
      );
      const uuid = output.trim();

      if (!uuid) {
        throw new Error('Failed to retrieve macOS Hardware UUID');
      }

      console.log('[STABLE_HARDWARE] ✅ macOS Hardware UUID obtained:', uuid);
      return uuid;
    } catch (error: any) {
      console.error('[STABLE_HARDWARE] ❌ Failed to get macOS Hardware UUID:', error);
      throw new Error(`macOS Hardware UUID retrieval failed: ${error.message}`);
    }
  }

  /**
   * 加载Windows原生模块（延迟加载）
   */
  private loadNativeModule(): void {
    // 如果已加载，直接返回
    if (this.nativeModule !== null) {
      return;
    }

    const platform = os.platform();

    // macOS平台不需要加载原生模块
    if (platform === 'darwin') {
      console.log('[STABLE_HARDWARE] macOS platform detected, using system_profiler instead of native module');
      return;
    }

    if (platform !== 'win32') {
      throw new Error(`Hardware ID generation is only supported on Windows and macOS. Current platform: ${platform}`);
    }

    try {
      // 获取正确的原生模块路径（处理 asar 打包）
      let nativeModulePath: string;

      // Electron的resourcesPath属性
      const resourcesPath = (process as any).resourcesPath as string | undefined;

      // 检查是否在 asar 打包环境中
      if (resourcesPath && __dirname.includes('app.asar')) {
        // 打包环境：直接加载 .node 文件（与 Windows 平台适配器一致）
        // resourcesPath 指向 app.asar 所在的 resources 目录
        nativeModulePath = path.join(
          resourcesPath,
          'app.asar.unpacked',
          'native-event-monitor-win',
          'build',
          'Release',
          'event_monitor.node'
        );
        console.log('[STABLE_HARDWARE] Loading native .node from:', nativeModulePath);
      } else {
        // 开发环境，使用 index.js (支持多种加载方式)
        nativeModulePath = path.resolve(__dirname, '../../native-event-monitor-win');
        console.log('[STABLE_HARDWARE] Loading native module (dev) from:', nativeModulePath);
      }

      this.nativeModule = require(nativeModulePath);
      console.log('[STABLE_HARDWARE] Native module loaded successfully');
    } catch (error) {
      console.error('[STABLE_HARDWARE] ❌ CRITICAL: Failed to load native module:', error);
      console.error('[STABLE_HARDWARE] __dirname:', __dirname);
      console.error('[STABLE_HARDWARE] resourcesPath:', (process as any).resourcesPath);
      throw new Error('Native module is required for Windows hardware ID generation');
    }
  }

  /**
   * 生成稳定的设备ID - v3.0 单一来源版本
   *
   * 严格基于：主板UUID (通过WMI Win32_ComputerSystemProduct.UUID获取)
   *
   * 不使用任何降级方案！获取失败则直接抛出异常
   * 公式: deviceId = SHA256(uuid)
   */
  async generateStableDeviceId(): Promise<StableDeviceIdentifier> {
    console.log('[STABLE_HARDWARE] v3.0: Generating device ID from mainboard UUID...');

    const platform = os.platform();
    let uuid: string;

    if (platform === 'darwin') {
      // macOS平台：使用system_profiler获取硬件UUID
      console.log('[STABLE_HARDWARE] Using macOS system_profiler for Hardware UUID');
      try {
        uuid = this.getMacOSHardwareUUID();
      } catch (error: any) {
        console.error('[STABLE_HARDWARE] ❌ CRITICAL: Failed to generate device ID:', error);
        throw new Error(`Cannot generate stable device ID on macOS: ${error.message}`);
      }
    } else {
      // Windows平台：使用原生模块
      this.loadNativeModule();

      if (!this.nativeModule) {
        throw new Error('Native module not loaded');
      }

      try {
        // 调用C++原生接口获取硬件信息
        const hardwareInfo = this.nativeModule.getHardwareInfo();

        if (!hardwareInfo.success) {
          throw new Error(`Hardware ID retrieval failed: ${hardwareInfo.error}`);
        }

        uuid = hardwareInfo.uuid;
      } catch (error: any) {
        console.error('[STABLE_HARDWARE] ❌ CRITICAL: Failed to generate device ID:', error);
        throw new Error(`Cannot generate stable device ID on Windows: ${error.message}`);
      }
    }

    // 验证UUID完整性
    if (!uuid) {
      throw new Error('Mainboard UUID is empty');
    }

    // ⚠️ 详细日志：完整打印主板UUID用于调试
    console.log('[STABLE_HARDWARE] ✅ Mainboard UUID obtained:');
    console.log('[STABLE_HARDWARE]   UUID (length=' + uuid.length + '):', uuid);

    // 生成确定性设备ID
    // 使用 主板UUID 生成SHA256哈希 (单一来源，无降级)
    const hash = crypto.createHash('sha256').update(uuid).digest('hex');
    const deviceId = `device_${hash.substring(0, 16)}`;

    // ⚠️ 详细日志：打印哈希计算过程
    console.log('[STABLE_HARDWARE] Device ID generation:');
    console.log('[STABLE_HARDWARE]   Source: Mainboard UUID');
    console.log('[STABLE_HARDWARE]   SHA256 hash:', hash);
    console.log('[STABLE_HARDWARE]   Final Device ID:', deviceId);

    const identifier: StableDeviceIdentifier = {
      deviceId,
      uuid,
      generatedAt: new Date().toISOString(),
      version: this.IDENTIFIER_VERSION,

      // v3.0向后兼容字段（已废弃）
      primaryFingerprint: uuid,  // 使用UUID作为主指纹
      secondaryFingerprint: undefined,  // 不再使用次指纹
      cpuId: undefined,  // CPU ID已废弃
      baseboardSerial: undefined,  // 主板序列号已废弃
      confidence: 'absolute',  // 主板UUID = 绝对唯一
      stability: 'permanent',  // 硬件级 = 永久稳定
      components: ['mainboard-uuid']  // v3.0: 单一来源
    };

    console.log('[STABLE_HARDWARE] ✅ Device ID generated successfully:', {
      deviceId,
      version: this.IDENTIFIER_VERSION,
      components: identifier.components
    });

    return identifier;
  }

  /**
   * 验证设备ID是否属于当前设备
   */
  async validateDeviceId(deviceId: string): Promise<{
    isValid: boolean;
    confidence: number;
    reason: string;
  }> {
    try {
      const currentIdentifier = await this.generateStableDeviceId();

      if (currentIdentifier.deviceId === deviceId) {
        return {
          isValid: true,
          confidence: 1.0,
          reason: 'Device ID matches current hardware signature'
        };
      }

      return {
        isValid: false,
        confidence: 0.0,
        reason: 'Device ID does not match current hardware signature'
      };

    } catch (error) {
      return {
        isValid: false,
        confidence: 0.0,
        reason: `Validation failed: ${error}`
      };
    }
  }

  /**
   * 清除缓存 (v3.0不使用缓存，保留接口兼容性)
   */
  clearCache(): void {
    console.log('[STABLE_HARDWARE] Cache cleared (v3.0 does not use cache)');
  }

  /**
   * 获取缓存的设备ID (v3.0不使用缓存，始终返回null)
   */
  async getCachedDeviceId(): Promise<string | null> {
    console.log('[STABLE_HARDWARE] v3.0 does not use cache, will generate from hardware');
    return null;
  }

  /**
   * 获取诊断信息 - v3.0 单一来源版本
   */
  async getDiagnosticInfo(): Promise<{
    platform: string;
    version: string;
    nativeModuleLoaded: boolean;
    hardwareInfo?: {
      uuid: string;
    };
  }> {
    const info: any = {
      platform: os.platform(),
      version: this.IDENTIFIER_VERSION,
      nativeModuleLoaded: this.nativeModule !== null
    };

    // 平台特定的硬件信息获取
    const platform = os.platform();

    if (platform === 'darwin') {
      // macOS平台：使用system_profiler获取硬件UUID
      try {
        const uuid = this.getMacOSHardwareUUID();
        info.hardwareInfo = {
          uuid
        };
      } catch (error) {
        console.error('[STABLE_HARDWARE] Failed to get macOS diagnostic info:', error);
      }
    } else if (platform === 'win32') {
      // Windows平台：使用原生模块
      try {
        this.loadNativeModule();
        if (this.nativeModule) {
          const hardwareInfo = this.nativeModule.getHardwareInfo();
          if (hardwareInfo.success) {
            info.hardwareInfo = {
              uuid: hardwareInfo.uuid
            };
          }
        }
      } catch (error) {
        console.error('[STABLE_HARDWARE] Failed to get Windows diagnostic info:', error);
      }
    }

    return info;
  }

  /**
   * 获取设备指纹摘要（v3.0兼容性方法）
   */
  async getDeviceFingerprintSummary(): Promise<{
    uuid: string;
    deviceId: string;
    // @deprecated 字段
    cpuId?: string;
    baseboardSerial?: string;
  }> {
    const identifier = await this.generateStableDeviceId();
    return {
      uuid: identifier.uuid,
      deviceId: identifier.deviceId,
      // 向后兼容（已废弃）
      cpuId: undefined,
      baseboardSerial: undefined
    };
  }
}
