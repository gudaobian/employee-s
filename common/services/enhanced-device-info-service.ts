/**
 * 增强的设备信息服务
 * 集成稳定硬件标识符和恢复机制，确保100%唯一和稳定的设备ID
 */

import { EventEmitter } from 'events';
import { IConfigService, IDeviceInfoService, DeviceInfo, HardwareInfo, SystemInfo, NetworkInfo } from '../interfaces/service-interfaces';
import { IPlatformAdapter } from '../interfaces/platform-interface';
import { StableHardwareIdentifier, StableDeviceIdentifier } from '../utils/stable-hardware-identifier';
import DeviceIdRecoveryService, { ValidationResult, RecoveryResult } from './device-id-recovery-service';

export class EnhancedDeviceInfoService extends EventEmitter implements IDeviceInfoService {
  private configService: IConfigService;
  private platformAdapter: IPlatformAdapter;
  private deviceInfo?: DeviceInfo;
  private updateInterval?: NodeJS.Timeout;
  private isRunning = false;
  private updateIntervalMs = 300000; // 5分钟更新一次
  
  // 增强功能
  private stableHardwareIdentifier: StableHardwareIdentifier;
  private recoveryService: DeviceIdRecoveryService;
  private deviceIdentifier?: StableDeviceIdentifier;
  private lastValidationTime?: Date;
  private validationIntervalMs = 3600000; // 1小时验证一次

  constructor(configService: IConfigService, platformAdapter: IPlatformAdapter) {
    super();
    this.configService = configService;
    this.platformAdapter = platformAdapter;
    this.stableHardwareIdentifier = StableHardwareIdentifier.getInstance();
    this.recoveryService = new DeviceIdRecoveryService(configService);
    
    // 监听恢复服务事件
    this.recoveryService.on('device-id-updated', (data) => {
      this.emit('device-id-updated', data);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[ENHANCED_DEVICE_INFO] Service already running');
      return;
    }

    try {
      console.log('[ENHANCED_DEVICE_INFO] Starting enhanced device info service...');

      this.isRunning = true;

      // 1. 验证和恢复设备ID
      await this.ensureValidDeviceId();

      // 2. 立即收集设备信息
      await this.collectDeviceInfo();

      // 3. 创建初始备份
      await this.recoveryService.createBackup();

      // 4. 启动定期更新和验证
      this.startUpdateInterval();
      this.startValidationInterval();

      this.emit('service-started');
      console.log('[ENHANCED_DEVICE_INFO] Enhanced device info service started successfully');

    } catch (error: any) {
      console.error('[ENHANCED_DEVICE_INFO] Failed to start service:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[ENHANCED_DEVICE_INFO] Stopping enhanced device info service...');

      this.isRunning = false;

      // 停止定期任务
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = undefined;
      }

      this.emit('service-stopped');
      console.log('[ENHANCED_DEVICE_INFO] Enhanced device info service stopped');

    } catch (error: any) {
      console.error('[ENHANCED_DEVICE_INFO] Error stopping service:', error);
    }
  }

  async getDeviceInfo(level?: 'basic' | 'full'): Promise<DeviceInfo> {
    if (!this.deviceInfo) {
      await this.collectDeviceInfo();
    }
    return this.deviceInfo!;
  }

  async refreshDeviceInfo(): Promise<DeviceInfo> {
    console.log('[ENHANCED_DEVICE_INFO] Refreshing device information...');
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
      console.error('[ENHANCED_DEVICE_INFO] Failed to get hardware info:', error);
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
      console.error('[ENHANCED_DEVICE_INFO] Failed to get system info:', error);
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
      console.error('[ENHANCED_DEVICE_INFO] Failed to get network info:', error);
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
   * 获取100%稳定的设备ID
   */
  async getStableDeviceId(): Promise<string> {
    if (!this.deviceIdentifier) {
      this.deviceIdentifier = await this.stableHardwareIdentifier.generateStableDeviceId();
      
      // 确保配置同步
      await this.syncDeviceIdToConfig();
    }
    
    return this.deviceIdentifier.deviceId;
  }

  /**
   * 获取设备标识符详细信息
   */
  async getStableDeviceIdentifier(): Promise<StableDeviceIdentifier> {
    if (!this.deviceIdentifier) {
      this.deviceIdentifier = await this.stableHardwareIdentifier.generateStableDeviceId();
      await this.syncDeviceIdToConfig();
    }
    return this.deviceIdentifier;
  }

  /**
   * 验证当前设备ID
   */
  async validateCurrentDeviceId(): Promise<ValidationResult> {
    return await this.recoveryService.validateCurrentDeviceId();
  }

  /**
   * 恢复设备ID
   */
  async recoverDeviceId(): Promise<RecoveryResult> {
    const result = await this.recoveryService.recoverDeviceId();
    
    if (result.success) {
      // 清除缓存，强制重新收集设备信息
      this.deviceIdentifier = undefined;
      this.deviceInfo = undefined;
      
      await this.collectDeviceInfo();
      this.emit('device-id-recovered', result);
    }
    
    return result;
  }

  /**
   * 创建设备ID备份
   */
  async createBackup(): Promise<boolean> {
    return await this.recoveryService.createBackup();
  }

  /**
   * 获取设备健康状态
   */
  async getDeviceHealthStatus() {
    return await this.recoveryService.getHealthStatus();
  }

  /**
   * 强制重新生成设备ID
   */
  async regenerateDeviceId(): Promise<string> {
    try {
      console.log('[ENHANCED_DEVICE_INFO] Force regenerating device ID...');
      
      // 清除所有缓存
      this.stableHardwareIdentifier.clearCache();
      this.deviceIdentifier = undefined;

      // 生成新的设备ID
      const newDeviceId = await this.getStableDeviceId();
      
      // 创建备份
      await this.recoveryService.createBackup();
      
      console.log('[ENHANCED_DEVICE_INFO] Device ID regenerated:', {
        newId: newDeviceId.substring(0, 16) + '...'
      });

      this.emit('device-id-regenerated', { deviceId: newDeviceId });
      return newDeviceId;

    } catch (error: any) {
      console.error('[ENHANCED_DEVICE_INFO] Failed to regenerate device ID:', error);
      throw error;
    }
  }

  /**
   * 迁移设备ID（兼容性方法）
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
      
      // 获取新的稳定设备ID
      const newDeviceId = await this.getStableDeviceId();

      // 检查是否需要迁移
      if (!oldDeviceId) {
        return {
          migrated: true,
          newDeviceId,
          reason: 'No existing device ID found, using stable hardware-based ID'
        };
      }

      if (oldDeviceId === newDeviceId) {
        return {
          migrated: false,
          oldDeviceId,
          newDeviceId,
          reason: 'Device ID already uses stable hardware identifier'
        };
      }

      // 验证旧ID的有效性
      const validation = await this.validateCurrentDeviceId();
      
      if (!validation.isValid || validation.confidence < 0.8) {
        // 需要迁移到新的稳定ID
        await this.configService.updateConfig({ deviceId: newDeviceId });
        
        console.log('[ENHANCED_DEVICE_INFO] Migrated device ID', {
          oldId: oldDeviceId.substring(0, 16) + '...',
          newId: newDeviceId.substring(0, 16) + '...',
          reason: validation.issues.join(', ')
        });

        return {
          migrated: true,
          oldDeviceId,
          newDeviceId,
          reason: `Migrated due to validation issues: ${validation.issues.join(', ')}`
        };
      }

      // 保持现有ID
      return {
        migrated: false,
        oldDeviceId,
        newDeviceId: oldDeviceId,
        reason: 'Existing device ID is valid and stable'
      };

    } catch (error: any) {
      console.error('[ENHANCED_DEVICE_INFO] Failed to migrate device ID:', error);
      throw error;
    }
  }

  // 私有方法

  /**
   * 确保设备ID有效
   */
  private async ensureValidDeviceId(): Promise<void> {
    try {
      console.log('[ENHANCED_DEVICE_INFO] Ensuring valid device ID...');

      // 验证当前设备ID
      const validation = await this.validateCurrentDeviceId();
      
      if (!validation.isValid || validation.needsRecovery) {
        console.log('[ENHANCED_DEVICE_INFO] Device ID validation failed, attempting recovery...');
        
        const recovery = await this.recoverDeviceId();
        
        if (!recovery.success) {
          throw new Error(`Device ID recovery failed: ${recovery.reason}`);
        }
        
        console.log('[ENHANCED_DEVICE_INFO] Device ID recovered successfully:', {
          method: recovery.method,
          confidence: recovery.confidence
        });
      } else {
        console.log('[ENHANCED_DEVICE_INFO] Device ID validation passed');
      }

    } catch (error: any) {
      console.error('[ENHANCED_DEVICE_INFO] Failed to ensure valid device ID:', error);
      throw error;
    }
  }

  /**
   * 同步设备ID到配置
   */
  private async syncDeviceIdToConfig(): Promise<void> {
    if (!this.deviceIdentifier) return;

    const config = this.configService.getConfig();
    if (config.deviceId !== this.deviceIdentifier.deviceId) {
      console.log('[ENHANCED_DEVICE_INFO] Syncing device ID to configuration');
      await this.configService.updateConfig({ deviceId: this.deviceIdentifier.deviceId });
    }
  }

  /**
   * 收集设备信息
   */
  private async collectDeviceInfo(): Promise<void> {
    try {
      console.log('[ENHANCED_DEVICE_INFO] Collecting enhanced device information...');

      // 获取基础系统信息
      const systemInfo = await this.platformAdapter.getSystemInfo();
      
      // 获取稳定的设备ID
      const stableDeviceId = await this.getStableDeviceId();

      // 获取网络信息
      const networkInfo = await this.collectNetworkInfo();

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
        console.log('[ENHANCED_DEVICE_INFO] Device information updated');
        this.emit('device-info-updated', deviceInfo);
      }

      console.log('[ENHANCED_DEVICE_INFO] Device information collected successfully', {
        deviceId: deviceInfo.deviceId.substring(0, 16) + '...',
        hostname: deviceInfo.hostname,
        platform: deviceInfo.platform,
        stability: this.deviceIdentifier?.stability
      });

    } catch (error: any) {
      console.error('[ENHANCED_DEVICE_INFO] Failed to collect device info:', error);
      throw error;
    }
  }

  /**
   * 收集网络信息
   */
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
      console.warn('[ENHANCED_DEVICE_INFO] Failed to collect network info:', error);
      return { interfaces: [] };
    }
  }

  /**
   * 检查设备信息是否有变化
   */
  private hasDeviceInfoChanged(newInfo: DeviceInfo): boolean {
    if (!this.deviceInfo) {
      return true;
    }

    // 检查关键字段是否有变化
    const keyFields = [
      'deviceId',
      'hostname',
      'platform',
      'platformVersion',
      'cpuModel',
      'totalMemory',
      'macAddress',
      'ipAddress'
    ];

    return keyFields.some(field => 
      (this.deviceInfo as any)[field] !== (newInfo as any)[field]
    );
  }

  /**
   * 启动更新间隔
   */
  private startUpdateInterval(): void {
    this.updateInterval = setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.collectDeviceInfo();
        } catch (error) {
          console.error('[ENHANCED_DEVICE_INFO] Update interval error:', error);
        }
      }
    }, this.updateIntervalMs);
  }

  /**
   * 启动验证间隔
   */
  private startValidationInterval(): void {
    setInterval(async () => {
      if (this.isRunning) {
        try {
          await this.performScheduledValidation();
        } catch (error) {
          console.error('[ENHANCED_DEVICE_INFO] Validation interval error:', error);
        }
      }
    }, this.validationIntervalMs);
  }

  /**
   * 执行定期验证
   */
  private async performScheduledValidation(): Promise<void> {
    try {
      const now = new Date();
      
      // 避免过于频繁的验证
      if (this.lastValidationTime && 
          (now.getTime() - this.lastValidationTime.getTime()) < this.validationIntervalMs) {
        return;
      }

      console.log('[ENHANCED_DEVICE_INFO] Performing scheduled validation...');
      
      const validation = await this.validateCurrentDeviceId();
      this.lastValidationTime = now;

      if (!validation.isValid) {
        console.warn('[ENHANCED_DEVICE_INFO] Scheduled validation failed:', validation.issues);
        this.emit('validation-failed', validation);
        
        // 自动尝试恢复
        const recovery = await this.recoverDeviceId();
        if (recovery.success) {
          console.log('[ENHANCED_DEVICE_INFO] Automatic recovery successful');
          this.emit('automatic-recovery', recovery);
        }
      } else {
        console.log('[ENHANCED_DEVICE_INFO] Scheduled validation passed');
      }

      // 定期创建备份
      if (validation.isValid && Math.random() < 0.1) { // 10%概率创建备份
        await this.recoveryService.createBackup();
      }

    } catch (error: any) {
      console.error('[ENHANCED_DEVICE_INFO] Scheduled validation error:', error);
    }
  }

  /**
   * 健康检查
   */
  healthCheck(): {
    healthy: boolean;
    details: {
      isRunning: boolean;
      hasDeviceInfo: boolean;
      hasStableDeviceId: boolean;
      lastValidated?: Date;
      deviceId?: string;
      stability?: string;
      confidence?: string;
    };
  } {
    return {
      healthy: this.isRunning && !!this.deviceInfo && !!this.deviceIdentifier,
      details: {
        isRunning: this.isRunning,
        hasDeviceInfo: !!this.deviceInfo,
        hasStableDeviceId: !!this.deviceIdentifier,
        lastValidated: this.lastValidationTime,
        deviceId: this.deviceInfo?.deviceId?.substring(0, 16) + '...',
        stability: this.deviceIdentifier?.stability,
        confidence: this.deviceIdentifier?.confidence
      }
    };
  }

  /**
   * 获取设备指纹摘要（用于调试）
   */
  async getDeviceFingerprintSummary() {
    return await this.stableHardwareIdentifier.getDeviceFingerprintSummary();
  }
}

export default EnhancedDeviceInfoService;