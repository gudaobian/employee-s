/**
 * 设备信息服务 - 重构版本
 * 负责收集和管理设备信息
 */

import { EventEmitter } from 'events';
import { IConfigService, IDeviceInfoService, DeviceInfo, HardwareInfo, SystemInfo, NetworkInfo } from '../interfaces/service-interfaces';
import { IPlatformAdapter } from '../interfaces/platform-interface';
import { HardwareIdentifier, DeviceIdentifier } from '../utils/hardware-identifier';


export class DeviceInfoService extends EventEmitter implements IDeviceInfoService {
  private configService: IConfigService;
  private platformAdapter: IPlatformAdapter;
  private deviceInfo?: DeviceInfo;
  private updateInterval?: NodeJS.Timeout;
  private isRunning = false;
  private updateIntervalMs = 300000; // 5分钟更新一次
  private hardwareIdentifier: HardwareIdentifier;
  private deviceIdentifier?: DeviceIdentifier;

  constructor(configService: IConfigService, platformAdapter: IPlatformAdapter) {
    super();
    this.configService = configService;
    this.platformAdapter = platformAdapter;
    this.hardwareIdentifier = HardwareIdentifier.getInstance();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[DEVICE_INFO] Service already running');
      return;
    }

    try {
      console.log('[DEVICE_INFO] Starting device info service...');

      this.isRunning = true;

      // 立即收集设备信息
      await this.collectDeviceInfo();

      // 启动定期更新
      this.startUpdateInterval();

      this.emit('service-started');
      console.log('[DEVICE_INFO] Device info service started successfully');

    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to start service:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[DEVICE_INFO] Stopping device info service...');

      this.isRunning = false;

      // 停止定期更新
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = undefined;
      }

      this.emit('service-stopped');
      console.log('[DEVICE_INFO] Device info service stopped');

    } catch (error: any) {
      console.error('[DEVICE_INFO] Error stopping service:', error);
    }
  }

  async getDeviceInfo(level?: 'basic' | 'full'): Promise<DeviceInfo> {
    if (!this.deviceInfo) {
      await this.collectDeviceInfo();
    }

    return this.deviceInfo!;
  }

  async refreshDeviceInfo(): Promise<DeviceInfo> {
    console.log('[DEVICE_INFO] Refreshing device information...');
    await this.collectDeviceInfo();
    return this.deviceInfo!;
  }

  async getHardwareInfo(): Promise<HardwareInfo> {
    try {
      const systemInfo = await this.platformAdapter.getSystemInfo();
      const networkInfo = await this.collectNetworkInfo();
      const os = require('os');
      
      return {
        cpuModel: systemInfo.cpu || os.cpus()[0]?.model || 'Unknown',
        cpuCores: os.cpus().length || 1,
        totalMemory: systemInfo.memory || os.totalmem(),
        diskSpace: 0, // TODO: Implement disk space detection
        screenResolution: '1920x1080', // TODO: Get from platform adapter
        macAddress: networkInfo.interfaces.map(i => i.mac).filter(Boolean),
        biosSerial: undefined // TODO: Platform-specific implementation
      };
    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to get hardware info:', error);
      throw error;
    }
  }

  async getSystemInfo(): Promise<SystemInfo> {
    try {
      const systemInfo = await this.platformAdapter.getSystemInfo();
      const os = require('os');
      
      return {
        hostname: systemInfo.hostname,
        platform: systemInfo.platform,
        platformVersion: systemInfo.osVersion,
        arch: os.arch(),
        username: systemInfo.username,
        userDirectory: os.homedir(),
        systemUptime: os.uptime()
      };
    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to get system info:', error);
      throw error;
    }
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    try {
      const networkInfo = await this.collectNetworkInfo();
      
      return {
        ipAddress: networkInfo.interfaces.filter(i => !i.internal).map(i => i.address),
        networkInterfaces: networkInfo.interfaces,
        defaultGateway: '0.0.0.0', // TODO: Get actual default gateway
        dnsServers: [], // TODO: Get DNS servers from system
        isConnected: networkInfo.interfaces.some(i => !i.internal)
      };
    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to get network info:', error);
      throw error;
    }
  }

  getDeviceId(): string {
    if (this.deviceIdentifier) {
      return this.deviceIdentifier.deviceId;
    }
    
    // 从配置文件获取已存储的设备ID
    const config = this.configService.getConfig();
    return config.deviceId || '';
  }

  /**
   * 获取稳定的硬件设备ID
   */
  async getStableDeviceId(): Promise<string> {
    if (!this.deviceIdentifier) {
      this.deviceIdentifier = await this.hardwareIdentifier.generateDeviceId();
      
      // 如果配置中的设备ID与硬件ID不同，更新配置
      const config = this.configService.getConfig();
      if (config.deviceId !== this.deviceIdentifier.deviceId) {
        console.log('[DEVICE_INFO] Updating device ID to hardware-based ID');
        await this.configService.updateConfig({ deviceId: this.deviceIdentifier.deviceId });
      }
    }
    
    return this.deviceIdentifier.deviceId;
  }

  /**
   * 获取设备标识符详细信息
   */
  async getDeviceIdentifier(): Promise<DeviceIdentifier> {
    if (!this.deviceIdentifier) {
      this.deviceIdentifier = await this.hardwareIdentifier.generateDeviceId();
    }
    return this.deviceIdentifier;
  }

  /**
   * 验证设备ID是否有效
   */
  async validateDeviceId(deviceId: string): Promise<boolean> {
    return await this.hardwareIdentifier.validateDeviceId(deviceId);
  }

  // 私有方法

  private startUpdateInterval(): void {
    this.updateInterval = setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.collectDeviceInfo();
        } catch (error) {
          console.error('[DEVICE_INFO] Update interval error:', error);
        }
      }
    }, this.updateIntervalMs);
  }

  private async collectDeviceInfo(): Promise<void> {
    try {
      console.log('[DEVICE_INFO] Collecting device information...');

      // 获取基础系统信息
      const systemInfo = await this.platformAdapter.getSystemInfo();
      
      // 获取配置信息
      const config = this.configService.getConfig();

      // 获取网络信息
      const networkInfo = await this.collectNetworkInfo();

      // 获取稳定的设备ID
      const stableDeviceId = await this.getStableDeviceId();

      // 构建设备信息
      const deviceInfo: DeviceInfo = {
        deviceId: stableDeviceId,
        hostname: systemInfo.hostname,
        platform: systemInfo.platform,
        platformVersion: systemInfo.osVersion,
        username: systemInfo.username,
        cpuModel: systemInfo.cpu,
        totalMemory: systemInfo.memory,
        macAddress: networkInfo.primaryMacAddress,
        ipAddress: networkInfo.primaryIpAddress
      };

      // 检查是否有变化
      const hasChanged = this.hasDeviceInfoChanged(deviceInfo);

      this.deviceInfo = deviceInfo;

      if (hasChanged) {
        console.log('[DEVICE_INFO] Device information updated');
        this.emit('device-info-updated', deviceInfo);
      }

      console.log('[DEVICE_INFO] Device information collected successfully', {
        deviceId: deviceInfo.deviceId.substring(0, 8) + '...',
        hostname: deviceInfo.hostname,
        platform: deviceInfo.platform
      });

    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to collect device info:', error);
      throw error;
    }
  }

  private async collectNetworkInfo(): Promise<{
    primaryMacAddress?: string;
    primaryIpAddress?: string;
    interfaces: any[];
  }> {
    try {
      const os = require('os');
      const networkInterfaces = os.networkInterfaces();
      
      const interfaces: any[] = [];
      let primaryMacAddress: string | undefined;
      let primaryIpAddress: string | undefined;

      for (const [name, addresses] of Object.entries(networkInterfaces)) {
        if (!addresses || !Array.isArray(addresses)) continue;

        for (const addr of addresses as any[]) {
          interfaces.push({
            name,
            address: addr.address,
            family: addr.family,
            mac: addr.mac,
            internal: addr.internal,
            cidr: addr.cidr
          });

          // 查找主要网络接口（非回环、IPv4）
          if (addr.family === 'IPv4' && !addr.internal && !primaryIpAddress) {
            primaryIpAddress = addr.address;
            primaryMacAddress = addr.mac;
          }
        }
      }

      return {
        primaryMacAddress,
        primaryIpAddress,
        interfaces: interfaces.slice(0, 10) // 限制接口数量
      };

    } catch (error: any) {
      console.warn('[DEVICE_INFO] Failed to collect network info:', error);
      return { interfaces: [] };
    }
  }

  private hasDeviceInfoChanged(newInfo: DeviceInfo): boolean {
    if (!this.deviceInfo) {
      return true;
    }

    // 检查关键字段是否有变化
    const keyFields = [
      'hostname',
      'platform',
      'architecture',
      'cpuCount',
      'totalMemory',
      'osVersion',
      'macAddress',
      'ipAddress'
    ];

    return keyFields.some(field => 
      (this.deviceInfo as any)[field] !== (newInfo as any)[field]
    );
  }

  /**
   * @deprecated 使用 getStableDeviceId() 替代
   * 保留此方法以防向后兼容问题
   */
  private generateDeviceId(): string {
    console.warn('[DEVICE_INFO] generateDeviceId() is deprecated, use getStableDeviceId() instead');
    try {
      const os = require('os');
      const crypto = require('crypto');
      
      // 使用系统信息生成唯一ID
      const identifier = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.cpus()[0]?.model || 'unknown',
        Date.now().toString()
      ].join('|');

      const hash = crypto.createHash('sha256').update(identifier).digest('hex');
      return `device_${hash.substring(0, 16)}`;

    } catch (error: any) {
      console.warn('[DEVICE_INFO] Failed to generate device ID, using fallback:', error);
      return `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  private getClientVersion(): string {
    try {
      // 尝试从package.json读取版本
      const path = require('path');
      const fs = require('fs');
      
      const packagePath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return packageJson.version || '1.0.0';
      }
    } catch (error) {
      console.warn('[DEVICE_INFO] Failed to read client version:', error);
    }

    return '1.0.0';
  }

  // 公共方法：获取特定信息

  async getSystemMetrics(): Promise<{
    cpuUsage: NodeJS.CpuUsage;
    memoryUsage: NodeJS.MemoryUsage;
    uptime: number;
    loadAverage: number[];
  }> {
    try {
      const os = require('os');
      
      return {
        cpuUsage: process.cpuUsage(),
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        loadAverage: os.loadavg()
      };

    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to get system metrics:', error);
      throw error;
    }
  }

  async getDiskInfo(): Promise<{
    available: boolean;
    usage?: any;
  }> {
    try {
      // 尝试获取磁盘信息（如果平台支持）
      const fs = require('fs');
      const path = require('path');
      
      const stats = fs.statSync(process.cwd());
      
      return {
        available: true,
        usage: {
          total: 'unknown',
          used: 'unknown',
          free: 'unknown'
        }
      };

    } catch (error: any) {
      console.warn('[DEVICE_INFO] Disk info not available:', error);
      return {
        available: false
      };
    }
  }

  async getEnvironmentInfo(): Promise<{
    nodeVersion: string;
    platform: string;
    arch: string;
    environment: string;
    workingDirectory: string;
    executablePath: string;
  }> {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      environment: 'production',
      workingDirectory: process.cwd(),
      executablePath: process.execPath
    };
  }

  // 导出设备信息为JSON
  async exportDeviceInfo(): Promise<string> {
    try {
      const deviceInfo = await this.getDeviceInfo();
      const systemMetrics = await this.getSystemMetrics();
      const diskInfo = await this.getDiskInfo();
      const environmentInfo = await this.getEnvironmentInfo();

      const exportData = {
        deviceInfo,
        systemMetrics,
        diskInfo,
        environmentInfo,
        exportTime: new Date().toISOString()
      };

      return JSON.stringify(exportData, null, 2);

    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to export device info:', error);
      throw error;
    }
  }

  // 健康检查
  healthCheck(): {
    healthy: boolean;
    details: {
      isRunning: boolean;
      hasDeviceInfo: boolean;
      lastUpdated?: Date;
      deviceId?: string;
    };
  } {
    return {
      healthy: this.isRunning && !!this.deviceInfo,
      details: {
        isRunning: this.isRunning,
        hasDeviceInfo: !!this.deviceInfo,
        deviceId: this.deviceInfo?.deviceId?.substring(0, 8) + '...'
      }
    };
  }

  /**
   * 获取硬件信息摘要（用于调试和验证）
   */
  async getHardwareInfoSummary(): Promise<{
    platform: string;
    availableComponents: string[];
    deviceIdentifier: DeviceIdentifier;
    hardwareFingerprint: string;
    confidence: string;
  }> {
    const summary = await this.hardwareIdentifier.getHardwareInfoSummary();
    const deviceIdentifier = await this.getDeviceIdentifier();
    
    return {
      platform: summary.platform,
      availableComponents: summary.availableComponents,
      deviceIdentifier,
      hardwareFingerprint: deviceIdentifier.hardwareFingerprint,
      confidence: deviceIdentifier.confidence
    };
  }

  /**
   * 迁移旧的设备ID到新的硬件标识符
   */
  async migrateDeviceId(): Promise<{
    migrated: boolean;
    oldDeviceId?: string;
    newDeviceId: string;
    reason: string;
  }> {
    try {
      const config = this.configService.getConfig();
      const oldDeviceId = config.deviceId;
      
      // 生成新的硬件设备ID
      const newDeviceIdentifier = await this.hardwareIdentifier.generateDeviceId();
      const newDeviceId = newDeviceIdentifier.deviceId;

      // 检查是否需要迁移
      if (!oldDeviceId) {
        // 没有旧ID，直接使用新ID
        await this.configService.updateConfig({ deviceId: newDeviceId });
        return {
          migrated: true,
          newDeviceId,
          reason: 'No existing device ID found, using hardware-based ID'
        };
      }

      if (oldDeviceId === newDeviceId) {
        // ID相同，无需迁移
        return {
          migrated: false,
          oldDeviceId,
          newDeviceId,
          reason: 'Device ID already matches hardware-based ID'
        };
      }

      // 检查旧ID是否为时间戳类型（需要迁移）
      const isTimestampBased = oldDeviceId.includes('_') && 
        (oldDeviceId.includes(Date.now().toString().substring(0, 8)) ||
         /device_\d+_/.test(oldDeviceId));

      if (isTimestampBased || newDeviceIdentifier.confidence === 'high') {
        // 迁移到新的硬件ID
        await this.configService.updateConfig({ deviceId: newDeviceId });
        
        console.log('[DEVICE_INFO] Migrated device ID', {
          oldId: oldDeviceId.substring(0, 12) + '...',
          newId: newDeviceId.substring(0, 12) + '...',
          confidence: newDeviceIdentifier.confidence
        });

        return {
          migrated: true,
          oldDeviceId,
          newDeviceId,
          reason: `Migrated ${isTimestampBased ? 'timestamp-based' : 'low-confidence'} ID to hardware-based ID (confidence: ${newDeviceIdentifier.confidence})`
        };
      }

      // 保持现有ID
      return {
        migrated: false,
        oldDeviceId,
        newDeviceId: oldDeviceId,
        reason: `Keeping existing stable device ID (new confidence: ${newDeviceIdentifier.confidence})`
      };

    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to migrate device ID:', error);
      throw error;
    }
  }

  /**
   * 强制重新生成设备ID
   */
  async regenerateDeviceId(): Promise<string> {
    try {
      // 清除缓存
      this.hardwareIdentifier.clearCache();
      this.deviceIdentifier = undefined;

      // 生成新的设备ID
      const newDeviceId = await this.getStableDeviceId();
      
      console.log('[DEVICE_INFO] Device ID regenerated:', {
        newId: newDeviceId.substring(0, 12) + '...'
      });

      return newDeviceId;

    } catch (error: any) {
      console.error('[DEVICE_INFO] Failed to regenerate device ID:', error);
      throw error;
    }
  }
}