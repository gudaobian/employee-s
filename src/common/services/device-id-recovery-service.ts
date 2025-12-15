/**
 * 设备ID验证和恢复服务
 * 确保设备ID的持续有效性和可恢复性
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { StableHardwareIdentifier, StableDeviceIdentifier } from '../utils/stable-hardware-identifier';
import { IConfigService } from '../interfaces/service-interfaces';

export interface DeviceIdBackup {
  deviceId: string;
  identifier: StableDeviceIdentifier;
  hardwareFingerprint: string;
  createdAt: string;
  platform: string;
  hostname: string;
  backupVersion: string;
}

export interface RecoveryResult {
  success: boolean;
  recoveredDeviceId?: string;
  method: 'cache' | 'backup' | 'regeneration' | 'failed';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  previousDeviceId?: string;
}

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  recommendations: string[];
  needsRecovery: boolean;
}

export class DeviceIdRecoveryService extends EventEmitter {
  private configService: IConfigService;
  private stableHardwareIdentifier: StableHardwareIdentifier;
  private readonly BACKUP_DIR: string;
  private readonly MAX_BACKUPS = 5;
  private readonly RECOVERY_VERSION = '1.0';

  constructor(configService: IConfigService) {
    super();
    this.configService = configService;
    this.stableHardwareIdentifier = StableHardwareIdentifier.getInstance();
    this.BACKUP_DIR = this.getBackupDirectory();
  }

  /**
   * 验证当前设备ID的有效性
   */
  async validateCurrentDeviceId(): Promise<ValidationResult> {
    try {
      const config = this.configService.getConfig();
      const currentDeviceId = config.deviceId;

      if (!currentDeviceId) {
        return {
          isValid: false,
          confidence: 0,
          issues: ['No device ID found in configuration'],
          recommendations: ['Generate new device ID'],
          needsRecovery: true
        };
      }

      // 使用稳定硬件标识符验证
      const validation = await this.stableHardwareIdentifier.validateDeviceId(currentDeviceId);
      
      const issues: string[] = [];
      const recommendations: string[] = [];

      if (!validation.isValid) {
        issues.push(`Device ID validation failed: ${validation.reason}`);
        recommendations.push('Attempt device ID recovery');
      }

      if (validation.confidence < 0.8) {
        issues.push(`Low confidence level: ${validation.confidence}`);
        recommendations.push('Consider regenerating device ID');
      }

      // 检查设备ID格式
      if (!this.isValidDeviceIdFormat(currentDeviceId)) {
        issues.push('Invalid device ID format');
        recommendations.push('Regenerate device ID with correct format');
      }

      return {
        isValid: validation.isValid && validation.confidence >= 0.8,
        confidence: validation.confidence,
        issues,
        recommendations,
        needsRecovery: !validation.isValid || validation.confidence < 0.5
      };

    } catch (error: any) {
      return {
        isValid: false,
        confidence: 0,
        issues: [`Validation error: ${error.message}`],
        recommendations: ['Regenerate device ID'],
        needsRecovery: true
      };
    }
  }

  /**
   * 尝试恢复设备ID
   */
  async recoverDeviceId(): Promise<RecoveryResult> {
    try {
      console.log('[DEVICE_RECOVERY] Starting device ID recovery process...');

      const config = this.configService.getConfig();
      const currentDeviceId = config.deviceId;

      // 方法1: 尝试从稳定硬件标识符缓存恢复
      const cacheRecovery = await this.recoverFromCache();
      if (cacheRecovery.success) {
        await this.updateConfigDeviceId(cacheRecovery.recoveredDeviceId!);
        return {
          ...cacheRecovery,
          previousDeviceId: currentDeviceId
        };
      }

      // 方法2: 尝试从备份恢复
      const backupRecovery = await this.recoverFromBackup();
      if (backupRecovery.success) {
        await this.updateConfigDeviceId(backupRecovery.recoveredDeviceId!);
        return {
          ...backupRecovery,
          previousDeviceId: currentDeviceId
        };
      }

      // 方法3: 重新生成稳定的设备ID
      const regenerationResult = await this.regenerateStableDeviceId();
      if (regenerationResult.success) {
        await this.updateConfigDeviceId(regenerationResult.recoveredDeviceId!);
        return {
          ...regenerationResult,
          previousDeviceId: currentDeviceId
        };
      }

      return {
        success: false,
        method: 'failed',
        confidence: 'low',
        reason: 'All recovery methods failed',
        previousDeviceId: currentDeviceId
      };

    } catch (error: any) {
      console.error('[DEVICE_RECOVERY] Recovery process failed:', error);
      return {
        success: false,
        method: 'failed',
        confidence: 'low',
        reason: `Recovery error: ${error.message}`
      };
    }
  }

  /**
   * 创建设备ID备份
   */
  async createBackup(): Promise<boolean> {
    try {
      const config = this.configService.getConfig();
      const deviceId = config.deviceId;

      if (!deviceId) {
        console.warn('[DEVICE_RECOVERY] No device ID to backup');
        return false;
      }

      // 获取当前硬件标识符
      const identifier = await this.stableHardwareIdentifier.generateStableDeviceId();
      
      const backup: DeviceIdBackup = {
        deviceId,
        identifier,
        hardwareFingerprint: identifier.primaryFingerprint || identifier.secondaryFingerprint,
        createdAt: new Date().toISOString(),
        platform: os.platform(),
        hostname: os.hostname(),
        backupVersion: this.RECOVERY_VERSION
      };

      // 确保备份目录存在
      if (!fs.existsSync(this.BACKUP_DIR)) {
        fs.mkdirSync(this.BACKUP_DIR, { recursive: true });
      }

      // 生成备份文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.BACKUP_DIR, `device-id-backup-${timestamp}.json`);

      // 写入备份
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

      // 清理旧备份
      await this.cleanupOldBackups();

      console.log('[DEVICE_RECOVERY] Device ID backup created successfully:', backupPath);
      return true;

    } catch (error: any) {
      console.error('[DEVICE_RECOVERY] Failed to create backup:', error);
      return false;
    }
  }

  /**
   * 列出所有可用的备份
   */
  async listBackups(): Promise<DeviceIdBackup[]> {
    try {
      if (!fs.existsSync(this.BACKUP_DIR)) {
        return [];
      }

      const backupFiles = fs.readdirSync(this.BACKUP_DIR)
        .filter(file => file.startsWith('device-id-backup-') && file.endsWith('.json'))
        .sort()
        .reverse(); // 最新的在前

      const backups: DeviceIdBackup[] = [];

      for (const file of backupFiles) {
        try {
          const backupPath = path.join(this.BACKUP_DIR, file);
          const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
          
          // 验证备份格式
          if (this.isValidBackup(backupData)) {
            backups.push(backupData);
          }
        } catch (error) {
          console.warn('[DEVICE_RECOVERY] Invalid backup file:', file, error);
        }
      }

      return backups;

    } catch (error: any) {
      console.error('[DEVICE_RECOVERY] Failed to list backups:', error);
      return [];
    }
  }

  /**
   * 从特定备份恢复设备ID
   */
  async restoreFromBackup(backupId: string): Promise<RecoveryResult> {
    try {
      const backups = await this.listBackups();
      const backup = backups.find(b => b.createdAt === backupId || 
                                   b.deviceId === backupId);

      if (!backup) {
        return {
          success: false,
          method: 'backup',
          confidence: 'low',
          reason: 'Backup not found'
        };
      }

      // 验证备份的硬件指纹是否仍然匹配
      const currentIdentifier = await this.stableHardwareIdentifier.generateStableDeviceId();
      const fingerprintMatch = this.compareFingerprints(
        backup.hardwareFingerprint,
        currentIdentifier.primaryFingerprint || currentIdentifier.secondaryFingerprint
      );

      if (!fingerprintMatch.isMatch) {
        return {
          success: false,
          method: 'backup',
          confidence: 'low',
          reason: `Hardware fingerprint mismatch: ${fingerprintMatch.reason}`
        };
      }

      // 更新配置
      await this.updateConfigDeviceId(backup.deviceId);

      return {
        success: true,
        recoveredDeviceId: backup.deviceId,
        method: 'backup',
        confidence: fingerprintMatch.confidence,
        reason: `Restored from backup created at ${backup.createdAt}`
      };

    } catch (error: any) {
      return {
        success: false,
        method: 'backup',
        confidence: 'low',
        reason: `Restore error: ${error.message}`
      };
    }
  }

  /**
   * 获取设备ID健康状态
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    deviceId: string | null;
    validation: ValidationResult;
    backupCount: number;
    lastBackup: string | null;
    recommendations: string[];
  }> {
    try {
      const config = this.configService.getConfig();
      const validation = await this.validateCurrentDeviceId();
      const backups = await this.listBackups();

      let status: 'healthy' | 'warning' | 'critical';
      const recommendations: string[] = [];

      if (!validation.isValid) {
        status = 'critical';
        recommendations.push('Immediate device ID recovery required');
      } else if (validation.confidence < 0.8 || validation.issues.length > 0) {
        status = 'warning';
        recommendations.push('Consider creating backup');
        recommendations.push('Monitor device ID stability');
      } else {
        status = 'healthy';
        if (backups.length === 0) {
          recommendations.push('Create initial backup');
        }
      }

      recommendations.push(...validation.recommendations);

      return {
        status,
        deviceId: config.deviceId || null,
        validation,
        backupCount: backups.length,
        lastBackup: backups.length > 0 ? backups[0].createdAt : null,
        recommendations: [...new Set(recommendations)] // 去重
      };

    } catch (error: any) {
      return {
        status: 'critical',
        deviceId: null,
        validation: {
          isValid: false,
          confidence: 0,
          issues: [`Health check error: ${error.message}`],
          recommendations: ['Regenerate device ID'],
          needsRecovery: true
        },
        backupCount: 0,
        lastBackup: null,
        recommendations: ['Regenerate device ID', 'Create backup']
      };
    }
  }

  // 私有方法

  /**
   * 从缓存恢复设备ID
   */
  private async recoverFromCache(): Promise<RecoveryResult> {
    try {
      console.log('[DEVICE_RECOVERY] Attempting cache recovery...');
      
      const identifier = await this.stableHardwareIdentifier.generateStableDeviceId();
      
      if (identifier.confidence === 'absolute' || identifier.confidence === 'high') {
        return {
          success: true,
          recoveredDeviceId: identifier.deviceId,
          method: 'cache',
          confidence: identifier.confidence === 'absolute' ? 'high' : 'medium',
          reason: 'Recovered from stable hardware identifier cache'
        };
      }

      return {
        success: false,
        method: 'cache',
        confidence: 'low',
        reason: 'Cache recovery not available or low confidence'
      };

    } catch (error: any) {
      return {
        success: false,
        method: 'cache',
        confidence: 'low',
        reason: `Cache recovery failed: ${error.message}`
      };
    }
  }

  /**
   * 从备份恢复设备ID
   */
  private async recoverFromBackup(): Promise<RecoveryResult> {
    try {
      console.log('[DEVICE_RECOVERY] Attempting backup recovery...');
      
      const backups = await this.listBackups();
      
      if (backups.length === 0) {
        return {
          success: false,
          method: 'backup',
          confidence: 'low',
          reason: 'No backups available'
        };
      }

      // 尝试使用最新的备份
      const latestBackup = backups[0];
      const recoveryResult = await this.restoreFromBackup(latestBackup.createdAt);
      
      return recoveryResult;

    } catch (error: any) {
      return {
        success: false,
        method: 'backup',
        confidence: 'low',
        reason: `Backup recovery failed: ${error.message}`
      };
    }
  }

  /**
   * 重新生成稳定的设备ID
   */
  private async regenerateStableDeviceId(): Promise<RecoveryResult> {
    try {
      console.log('[DEVICE_RECOVERY] Regenerating stable device ID...');
      
      // 清除缓存以强制重新生成
      this.stableHardwareIdentifier.clearCache();
      
      const identifier = await this.stableHardwareIdentifier.generateStableDeviceId();
      
      return {
        success: true,
        recoveredDeviceId: identifier.deviceId,
        method: 'regeneration',
        confidence: identifier.confidence === 'absolute' ? 'high' : 
                   identifier.confidence === 'high' ? 'medium' : 'low',
        reason: `Regenerated stable device ID with ${identifier.confidence} confidence`
      };

    } catch (error: any) {
      return {
        success: false,
        method: 'regeneration',
        confidence: 'low',
        reason: `Regeneration failed: ${error.message}`
      };
    }
  }

  /**
   * 更新配置中的设备ID
   */
  private async updateConfigDeviceId(deviceId: string): Promise<void> {
    await this.configService.updateConfig({ deviceId });
    this.emit('device-id-updated', { deviceId });
    console.log('[DEVICE_RECOVERY] Device ID updated in configuration');
  }

  /**
   * 获取备份目录路径
   */
  private getBackupDirectory(): string {
    const platform = os.platform();
    
    switch (platform) {
      case 'win32':
        return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'EmployeeMonitor', 'backups');
      case 'darwin':
        return '/Library/Application Support/EmployeeMonitor/backups';
      case 'linux':
        return '/var/lib/employee-monitor/backups';
      default:
        return path.join(os.homedir(), '.employee-monitor-backups');
    }
  }

  /**
   * 清理旧备份
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const backups = await this.listBackups();
      
      if (backups.length > this.MAX_BACKUPS) {
        const backupsToDelete = backups.slice(this.MAX_BACKUPS);
        
        for (const backup of backupsToDelete) {
          try {
            const backupFiles = fs.readdirSync(this.BACKUP_DIR)
              .filter(file => file.includes(backup.createdAt.replace(/[:.]/g, '-')));
            
            for (const file of backupFiles) {
              fs.unlinkSync(path.join(this.BACKUP_DIR, file));
            }
          } catch (error) {
            console.warn('[DEVICE_RECOVERY] Failed to delete old backup:', error);
          }
        }
        
        console.log(`[DEVICE_RECOVERY] Cleaned up ${backupsToDelete.length} old backups`);
      }

    } catch (error: any) {
      console.warn('[DEVICE_RECOVERY] Failed to cleanup old backups:', error);
    }
  }

  /**
   * 验证设备ID格式
   */
  private isValidDeviceIdFormat(deviceId: string): boolean {
    // 验证设备ID格式：device_xxx 或 device_fallback_xxx 或 device_random_xxx
    const patterns = [
      /^device_[a-f0-9]{16}$/,           // 标准格式
      /^device_fallback_[a-f0-9]{12}$/,  // 降级格式
      /^device_random_[a-f0-9]{12}$/     // 随机格式
    ];
    
    return patterns.some(pattern => pattern.test(deviceId));
  }

  /**
   * 验证备份格式
   */
  private isValidBackup(backup: any): boolean {
    return backup && 
           typeof backup.deviceId === 'string' &&
           typeof backup.hardwareFingerprint === 'string' &&
           typeof backup.createdAt === 'string' &&
           typeof backup.platform === 'string' &&
           backup.identifier &&
           backup.backupVersion;
  }

  /**
   * 比较硬件指纹
   */
  private compareFingerprints(fingerprint1: string, fingerprint2: string): {
    isMatch: boolean;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
  } {
    if (!fingerprint1 || !fingerprint2) {
      return {
        isMatch: false,
        confidence: 'low',
        reason: 'Missing fingerprint data'
      };
    }

    if (fingerprint1 === fingerprint2) {
      return {
        isMatch: true,
        confidence: 'high',
        reason: 'Exact fingerprint match'
      };
    }

    // 可以添加更复杂的相似度比较逻辑
    // 例如：部分匹配、模糊匹配等

    return {
      isMatch: false,
      confidence: 'low',
      reason: 'Fingerprint mismatch'
    };
  }
}

export default DeviceIdRecoveryService;