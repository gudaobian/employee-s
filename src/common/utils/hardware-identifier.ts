/**
 * 硬件标识符生成器
 * 基于硬件特征生成唯一不变的设备ID
 */

import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './index';

const execAsync = promisify(exec);

export interface HardwareInfo {
  macAddress?: string;
  cpuId?: string;
  motherboardSerial?: string;
  systemSerial?: string;
  machineId?: string;
  biosSerial?: string;
  diskSerial?: string;
}

export interface DeviceIdentifier {
  deviceId: string;
  hardwareFingerprint: string;
  platform: string;
  confidence: 'high' | 'medium' | 'low';
  components: string[];
  generatedAt: string;
}

export class HardwareIdentifier {
  private static instance: HardwareIdentifier;
  private hardwareInfo?: HardwareInfo;
  private cachedDeviceId?: DeviceIdentifier;

  private constructor() {}

  static getInstance(): HardwareIdentifier {
    if (!HardwareIdentifier.instance) {
      HardwareIdentifier.instance = new HardwareIdentifier();
    }
    return HardwareIdentifier.instance;
  }

  /**
   * 生成稳定的设备ID
   */
  async generateDeviceId(): Promise<DeviceIdentifier> {
    if (this.cachedDeviceId) {
      return this.cachedDeviceId;
    }

    try {
      logger.info('[HARDWARE] Collecting hardware information...');

      // 收集硬件信息
      const hardwareInfo = await this.collectHardwareInfo();
      this.hardwareInfo = hardwareInfo;

      // 生成设备标识符
      const identifier = this.buildIdentifier(hardwareInfo);

      this.cachedDeviceId = identifier;

      logger.info('[HARDWARE] Device ID generated successfully', {
        deviceId: identifier.deviceId.substring(0, 12) + '...',
        confidence: identifier.confidence,
        components: identifier.components
      });

      return identifier;

    } catch (error: any) {
      logger.error('[HARDWARE] Failed to generate device ID:', error);

      // 降级到基础标识符
      const fallbackId = this.generateFallbackId();
      this.cachedDeviceId = fallbackId;
      return fallbackId;
    }
  }

  /**
   * 验证设备ID是否属于当前设备
   */
  async validateDeviceId(deviceId: string): Promise<boolean> {
    try {
      const currentIdentifier = await this.generateDeviceId();
      return currentIdentifier.deviceId === deviceId;
    } catch (error) {
      logger.warn('[HARDWARE] Failed to validate device ID:', error);
      return false;
    }
  }

  /**
   * 获取硬件指纹用于设备识别
   */
  async getHardwareFingerprint(): Promise<string> {
    const identifier = await this.generateDeviceId();
    return identifier.hardwareFingerprint;
  }

  // 私有方法

  /**
   * 收集硬件信息
   */
  private async collectHardwareInfo(): Promise<HardwareInfo> {
    const platform = os.platform();
    const hardwareInfo: HardwareInfo = {};

    // 获取主网卡MAC地址
    hardwareInfo.macAddress = await this.getPrimaryMacAddress();

    // 根据平台获取特定硬件信息，添加超时保护
    const hardwareCollectionPromise = (async () => {
      switch (platform) {
        case 'darwin':
          await this.collectMacOSHardwareInfo(hardwareInfo);
          break;
        case 'win32':
          await this.collectWindowsHardwareInfo(hardwareInfo);
          break;
        case 'linux':
          await this.collectLinuxHardwareInfo(hardwareInfo);
          break;
        default:
          logger.warn('[HARDWARE] Unsupported platform:', platform);
      }
    })();

    // 5秒超时保护 - 如果硬件信息收集超时，继续使用已有信息
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.warn('[HARDWARE] Hardware collection timeout after 5 seconds, continuing with available data');
        resolve();
      }, 5000);
    });

    await Promise.race([hardwareCollectionPromise, timeoutPromise]);

    return hardwareInfo;
  }

  /**
   * 获取主网卡MAC地址
   */
  private async getPrimaryMacAddress(): Promise<string | undefined> {
    try {
      const networkInterfaces = os.networkInterfaces();
      
      // 查找主要的有线或无线网卡
      const priorities = ['eth0', 'en0', 'wlan0', 'WiFi', 'Ethernet'];
      
      for (const name of priorities) {
        const iface = networkInterfaces[name];
        if (iface) {
          const macAddr = iface.find(addr => !addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00');
          if (macAddr && macAddr.mac) {
            return macAddr.mac.replace(/[:-]/g, '').toLowerCase();
          }
        }
      }

      // 如果没找到，遍历所有接口找第一个有效的
      for (const [name, addresses] of Object.entries(networkInterfaces)) {
        if (!addresses || !Array.isArray(addresses)) continue;
        
        for (const addr of addresses) {
          if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
            return addr.mac.replace(/[:-]/g, '').toLowerCase();
          }
        }
      }

      return undefined;
    } catch (error) {
      logger.warn('[HARDWARE] Failed to get MAC address:', error);
      return undefined;
    }
  }

  /**
   * 收集macOS硬件信息
   */
  private async collectMacOSHardwareInfo(hardwareInfo: HardwareInfo): Promise<void> {
    try {
      // 获取系统序列号
      try {
        const { stdout } = await execAsync('system_profiler SPHardwareDataType | grep "Serial Number" | cut -d ":" -f2 | xargs');
        hardwareInfo.systemSerial = stdout.trim();
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get macOS serial number:', error);
      }

      // 获取硬件UUID
      try {
        const { stdout } = await execAsync('system_profiler SPHardwareDataType | grep "Hardware UUID" | cut -d ":" -f2 | xargs');
        hardwareInfo.machineId = stdout.trim();
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get macOS hardware UUID:', error);
      }

      // 获取CPU信息
      try {
        const { stdout } = await execAsync('sysctl -n machdep.cpu.brand_string');
        hardwareInfo.cpuId = crypto.createHash('md5').update(stdout.trim()).digest('hex');
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get macOS CPU info:', error);
      }

    } catch (error) {
      logger.warn('[HARDWARE] Error collecting macOS hardware info:', error);
    }
  }

  /**
   * 收集Windows硬件信息
   */
  private async collectWindowsHardwareInfo(hardwareInfo: HardwareInfo): Promise<void> {
    try {
      // 获取主板序列号
      try {
        const { stdout } = await execAsync('wmic baseboard get serialnumber /value | findstr "="');
        const match = stdout.match(/SerialNumber=(.+)/);
        if (match && match[1] && match[1].trim() !== 'To be filled by O.E.M.') {
          hardwareInfo.motherboardSerial = match[1].trim();
        }
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get Windows motherboard serial:', error);
      }

      // 获取CPU序列号
      try {
        const { stdout } = await execAsync('wmic cpu get processorid /value | findstr "="');
        const match = stdout.match(/ProcessorId=(.+)/);
        if (match && match[1]) {
          hardwareInfo.cpuId = match[1].trim();
        }
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get Windows CPU ID:', error);
      }

      // 获取BIOS序列号
      try {
        const { stdout } = await execAsync('wmic bios get serialnumber /value | findstr "="');
        const match = stdout.match(/SerialNumber=(.+)/);
        if (match && match[1] && match[1].trim() !== 'To be filled by O.E.M.') {
          hardwareInfo.biosSerial = match[1].trim();
        }
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get Windows BIOS serial:', error);
      }

      // 获取硬盘序列号 - 使用 PowerShell 替代 head 命令
      try {
        const { stdout } = await execAsync('powershell -Command "wmic diskdrive get serialnumber /value | findstr \\"=\\" | Select-Object -First 1"');
        const match = stdout.match(/SerialNumber=(.+)/);
        if (match && match[1]) {
          hardwareInfo.diskSerial = match[1].trim();
        }
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get Windows disk serial:', error);
      }

    } catch (error) {
      logger.warn('[HARDWARE] Error collecting Windows hardware info:', error);
    }
  }

  /**
   * 收集Linux硬件信息
   */
  private async collectLinuxHardwareInfo(hardwareInfo: HardwareInfo): Promise<void> {
    try {
      // 获取machine-id
      try {
        if (fs.existsSync('/etc/machine-id')) {
          hardwareInfo.machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
        } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
          hardwareInfo.machineId = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
        }
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get Linux machine-id:', error);
      }

      // 获取DMI信息
      try {
        const { stdout } = await execAsync('sudo dmidecode -s system-serial-number 2>/dev/null || echo ""');
        const serial = stdout.trim();
        if (serial && serial !== 'To be filled by O.E.M.' && serial !== 'Not Specified') {
          hardwareInfo.systemSerial = serial;
        }
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get Linux system serial:', error);
      }

      // 获取CPU信息
      try {
        if (fs.existsSync('/proc/cpuinfo')) {
          const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
          const match = cpuInfo.match(/model name\s*:\s*(.+)/);
          if (match) {
            hardwareInfo.cpuId = crypto.createHash('md5').update(match[1].trim()).digest('hex');
          }
        }
      } catch (error) {
        logger.warn('[HARDWARE] Failed to get Linux CPU info:', error);
      }

    } catch (error) {
      logger.warn('[HARDWARE] Error collecting Linux hardware info:', error);
    }
  }

  /**
   * 构建设备标识符
   */
  private buildIdentifier(hardwareInfo: HardwareInfo): DeviceIdentifier {
    const components: string[] = [];
    const identifierParts: string[] = [];

    // 按优先级添加硬件特征
    if (hardwareInfo.machineId) {
      identifierParts.push(`machine:${hardwareInfo.machineId}`);
      components.push('machine-id');
    }

    if (hardwareInfo.systemSerial) {
      identifierParts.push(`system:${hardwareInfo.systemSerial}`);
      components.push('system-serial');
    }

    if (hardwareInfo.motherboardSerial) {
      identifierParts.push(`board:${hardwareInfo.motherboardSerial}`);
      components.push('motherboard-serial');
    }

    if (hardwareInfo.biosSerial) {
      identifierParts.push(`bios:${hardwareInfo.biosSerial}`);
      components.push('bios-serial');
    }

    if (hardwareInfo.macAddress) {
      identifierParts.push(`mac:${hardwareInfo.macAddress}`);
      components.push('mac-address');
    }

    if (hardwareInfo.cpuId) {
      identifierParts.push(`cpu:${hardwareInfo.cpuId}`);
      components.push('cpu-id');
    }

    if (hardwareInfo.diskSerial) {
      identifierParts.push(`disk:${hardwareInfo.diskSerial}`);
      components.push('disk-serial');
    }

    // 添加稳定的系统信息
    identifierParts.push(`platform:${os.platform()}`);
    identifierParts.push(`arch:${os.arch()}`);
    identifierParts.push(`hostname:${os.hostname()}`);
    components.push('system-info');

    // 生成最终标识符
    const combinedIdentifier = identifierParts.join('|');
    const hash = crypto.createHash('sha256').update(combinedIdentifier).digest('hex');
    const deviceId = `device_${hash.substring(0, 16)}`;

    // 生成硬件指纹
    const hardwareFingerprint = crypto.createHash('md5').update(combinedIdentifier).digest('hex');

    // 判断可信度
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (components.length >= 4 && (hardwareInfo.machineId || hardwareInfo.systemSerial || hardwareInfo.motherboardSerial)) {
      confidence = 'high';
    } else if (components.length >= 2 && hardwareInfo.macAddress) {
      confidence = 'medium';
    }

    return {
      deviceId,
      hardwareFingerprint,
      platform: os.platform(),
      confidence,
      components,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 生成降级标识符
   */
  private generateFallbackId(): DeviceIdentifier {
    logger.warn('[HARDWARE] Using fallback device ID generation');
    
    try {
      // 基于基础系统信息生成
      const baseInfo = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.userInfo().username
      ].join('|');

      const hash = crypto.createHash('sha256').update(baseInfo).digest('hex');
      const deviceId = `device_fallback_${hash.substring(0, 12)}`;

      return {
        deviceId,
        hardwareFingerprint: crypto.createHash('md5').update(baseInfo).digest('hex'),
        platform: os.platform(),
        confidence: 'low',
        components: ['fallback'],
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      // 最后的降级方案
      const randomId = `device_random_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
      
      return {
        deviceId: randomId,
        hardwareFingerprint: crypto.createHash('md5').update(randomId).digest('hex'),
        platform: os.platform(),
        confidence: 'low',
        components: ['random'],
        generatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * 获取硬件信息摘要（用于调试）
   */
  async getHardwareInfoSummary(): Promise<{
    platform: string;
    availableComponents: string[];
    hardwareInfo: HardwareInfo;
    deviceIdentifier?: DeviceIdentifier;
  }> {
    const hardwareInfo = await this.collectHardwareInfo();
    const deviceIdentifier = await this.generateDeviceId();

    return {
      platform: os.platform(),
      availableComponents: Object.keys(hardwareInfo).filter(key => hardwareInfo[key as keyof HardwareInfo]),
      hardwareInfo,
      deviceIdentifier
    };
  }

  /**
   * 清除缓存，强制重新生成
   */
  clearCache(): void {
    this.cachedDeviceId = undefined;
    this.hardwareInfo = undefined;
  }
}

export default HardwareIdentifier;