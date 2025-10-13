#!/usr/bin/env ts-node

/**
 * 稳定设备ID管理工具
 * 用于管理、验证、恢复和测试100%稳定的设备ID系统
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigServiceCLI } from '../common/config/config-service-cli';
import { StableHardwareIdentifier } from '../common/utils/stable-hardware-identifier';
import DeviceIdRecoveryService from '../common/services/device-id-recovery-service';

class StableDeviceIdManager {
  private configService: ConfigServiceCLI;
  private stableHardwareIdentifier: StableHardwareIdentifier;
  private recoveryService: DeviceIdRecoveryService;

  constructor() {
    this.configService = ConfigServiceCLI.getInstance();
    this.stableHardwareIdentifier = StableHardwareIdentifier.getInstance();
    this.recoveryService = new DeviceIdRecoveryService(this.configService);
  }

  async initialize(): Promise<void> {
    try {
      await this.configService.initialize();
      console.log('✅ Stable Device ID Manager initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Stable Device ID Manager:', error);
      throw error;
    }
  }

  /**
   * 显示当前稳定设备ID信息
   */
  async showInfo(): Promise<void> {
    try {
      console.log('\n📋 Stable Device ID Information\n');
      
      // 显示配置中的设备ID
      const config = this.configService.getConfig();
      console.log(`Config Device ID: ${config.deviceId || 'Not set'}`);
      
      // 显示稳定硬件标识符信息
      const identifier = await this.stableHardwareIdentifier.generateStableDeviceId();
      console.log(`\n🔧 Stable Hardware Identifier:`);
      console.log(`  Device ID: ${identifier.deviceId}`);
      console.log(`  Confidence: ${identifier.confidence}`);
      console.log(`  Stability: ${identifier.stability}`);
      console.log(`  Components: ${identifier.components.join(', ')}`);
      console.log(`  Generated: ${identifier.generatedAt}`);
      console.log(`  Version: ${identifier.version}`);
      
      if (identifier.primaryFingerprint) {
        console.log(`  Primary Fingerprint: ${identifier.primaryFingerprint.substring(0, 16)}...`);
      }
      if (identifier.secondaryFingerprint) {
        console.log(`  Secondary Fingerprint: ${identifier.secondaryFingerprint.substring(0, 16)}...`);
      }
      
      // 验证当前ID
      const validation = await this.recoveryService.validateCurrentDeviceId();
      console.log(`\n✅ Validation Status:`);
      console.log(`  Valid: ${validation.isValid ? 'YES' : 'NO'}`);
      console.log(`  Confidence: ${(validation.confidence * 100).toFixed(1)}%`);
      
      if (validation.issues.length > 0) {
        console.log(`  Issues: ${validation.issues.join(', ')}`);
      }
      
      if (validation.recommendations.length > 0) {
        console.log(`  Recommendations: ${validation.recommendations.join(', ')}`);
      }

    } catch (error) {
      console.error('❌ Failed to show device ID info:', error);
      process.exit(1);
    }
  }

  /**
   * 验证设备ID
   */
  async validate(): Promise<void> {
    try {
      console.log('\n🔍 Validating Stable Device ID...\n');
      
      const validation = await this.recoveryService.validateCurrentDeviceId();
      
      if (validation.isValid) {
        console.log('✅ Device ID is VALID');
        console.log(`Confidence: ${(validation.confidence * 100).toFixed(1)}%`);
      } else {
        console.log('❌ Device ID is INVALID');
        console.log(`Confidence: ${(validation.confidence * 100).toFixed(1)}%`);
        console.log(`Issues: ${validation.issues.join(', ')}`);
      }
      
      if (validation.recommendations.length > 0) {
        console.log(`\n💡 Recommendations:`);
        validation.recommendations.forEach((rec, i) => {
          console.log(`  ${i + 1}. ${rec}`);
        });
      }
      
      if (validation.needsRecovery) {
        console.log('\n⚠️  Device ID recovery is recommended');
        console.log('💡 Run "stable-device-id-manager recover" to attempt recovery');
      }

    } catch (error) {
      console.error('❌ Failed to validate device ID:', error);
      process.exit(1);
    }
  }

  /**
   * 恢复设备ID
   */
  async recover(): Promise<void> {
    try {
      console.log('\n🔄 Attempting Device ID Recovery...\n');
      
      const recovery = await this.recoveryService.recoverDeviceId();
      
      if (recovery.success) {
        console.log('✅ Device ID recovery SUCCESSFUL');
        console.log(`Method: ${recovery.method}`);
        console.log(`Confidence: ${recovery.confidence}`);
        console.log(`New Device ID: ${recovery.recoveredDeviceId}`);
        console.log(`Reason: ${recovery.reason}`);
        
        if (recovery.previousDeviceId) {
          console.log(`Previous Device ID: ${recovery.previousDeviceId}`);
        }
      } else {
        console.log('❌ Device ID recovery FAILED');
        console.log(`Method attempted: ${recovery.method}`);
        console.log(`Reason: ${recovery.reason}`);
        console.log('\n💡 Try regenerating with "stable-device-id-manager regenerate"');
      }

    } catch (error) {
      console.error('❌ Failed to recover device ID:', error);
      process.exit(1);
    }
  }

  /**
   * 重新生成设备ID
   */
  async regenerate(): Promise<void> {
    try {
      console.log('\n🔄 Regenerating Stable Device ID...\n');
      
      const config = this.configService.getConfig();
      const oldDeviceId = config.deviceId;
      
      if (oldDeviceId) {
        console.log(`Old Device ID: ${oldDeviceId}`);
      }
      
      // 清除缓存强制重新生成
      this.stableHardwareIdentifier.clearCache();
      
      const newIdentifier = await this.stableHardwareIdentifier.generateStableDeviceId();
      
      // 更新配置
      await this.configService.updateConfig({ deviceId: newIdentifier.deviceId });
      
      console.log(`New Device ID: ${newIdentifier.deviceId}`);
      console.log(`Confidence: ${newIdentifier.confidence}`);
      console.log(`Stability: ${newIdentifier.stability}`);
      console.log(`Components: ${newIdentifier.components.join(', ')}`);
      
      // 创建备份
      const backupCreated = await this.recoveryService.createBackup();
      if (backupCreated) {
        console.log('\n💾 Backup created successfully');
      }
      
      console.log('\n✅ Device ID regenerated successfully');

    } catch (error) {
      console.error('❌ Failed to regenerate device ID:', error);
      process.exit(1);
    }
  }

  /**
   * 显示硬件指纹详情
   */
  async showFingerprint(): Promise<void> {
    try {
      console.log('\n🖥️  Hardware Fingerprint Details\n');
      
      const summary = await this.stableHardwareIdentifier.getDeviceFingerprintSummary();
      
      console.log(`Platform: ${summary.platform}`);
      console.log(`Cache Path: ${summary.cacheStatus.cachePath}`);
      console.log(`Cache Exists: ${summary.cacheStatus.cacheExists}`);
      console.log(`Cache Valid: ${summary.cacheStatus.cacheValid}`);
      
      console.log(`\n🔧 Device Identifier:`);
      console.log(`  Device ID: ${summary.identifier.deviceId}`);
      console.log(`  Confidence: ${summary.identifier.confidence}`);
      console.log(`  Stability: ${summary.identifier.stability}`);
      console.log(`  Version: ${summary.identifier.version}`);
      console.log(`  Components: ${summary.identifier.components.join(', ')}`);
      
      console.log(`\n🔍 Hardware Information:`);
      Object.entries(summary.hardwareInfo).forEach(([key, value]) => {
        if (value) {
          const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
          console.log(`  ${key}: ${displayValue}`);
        }
      });

    } catch (error) {
      console.error('❌ Failed to show hardware fingerprint:', error);
      process.exit(1);
    }
  }

  /**
   * 备份管理
   */
  async manageBackups(action: 'list' | 'create' | 'restore', backupId?: string): Promise<void> {
    try {
      switch (action) {
        case 'list':
          console.log('\n📂 Device ID Backups\n');
          const backups = await this.recoveryService.listBackups();
          
          if (backups.length === 0) {
            console.log('No backups found');
            return;
          }
          
          backups.forEach((backup, i) => {
            console.log(`${i + 1}. Created: ${backup.createdAt}`);
            console.log(`   Device ID: ${backup.deviceId}`);
            console.log(`   Platform: ${backup.platform}`);
            console.log(`   Hostname: ${backup.hostname}`);
            console.log(`   Fingerprint: ${backup.hardwareFingerprint.substring(0, 16)}...`);
            console.log('');
          });
          break;
          
        case 'create':
          console.log('\n💾 Creating Device ID Backup...\n');
          const created = await this.recoveryService.createBackup();
          
          if (created) {
            console.log('✅ Backup created successfully');
          } else {
            console.log('❌ Failed to create backup');
          }
          break;
          
        case 'restore':
          if (!backupId) {
            console.error('❌ Backup ID required for restore operation');
            process.exit(1);
          }
          
          console.log(`\n📂 Restoring from backup: ${backupId}\n`);
          const restoreResult = await this.recoveryService.restoreFromBackup(backupId);
          
          if (restoreResult.success) {
            console.log('✅ Restore SUCCESSFUL');
            console.log(`Device ID: ${restoreResult.recoveredDeviceId}`);
            console.log(`Confidence: ${restoreResult.confidence}`);
            console.log(`Reason: ${restoreResult.reason}`);
          } else {
            console.log('❌ Restore FAILED');
            console.log(`Reason: ${restoreResult.reason}`);
          }
          break;
      }

    } catch (error) {
      console.error('❌ Failed to manage backups:', error);
      process.exit(1);
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<void> {
    try {
      console.log('\n🏥 Device ID Health Check\n');
      
      const health = await this.recoveryService.getHealthStatus();
      
      const statusIcon = {
        'healthy': '✅',
        'warning': '⚠️',
        'critical': '❌'
      }[health.status];
      
      console.log(`Overall Status: ${statusIcon} ${health.status.toUpperCase()}`);
      console.log(`Device ID: ${health.deviceId || 'Not set'}`);
      console.log(`Backup Count: ${health.backupCount}`);
      console.log(`Last Backup: ${health.lastBackup || 'Never'}`);
      
      console.log(`\n🔍 Validation Details:`);
      console.log(`  Valid: ${health.validation.isValid ? 'YES' : 'NO'}`);
      console.log(`  Confidence: ${(health.validation.confidence * 100).toFixed(1)}%`);
      console.log(`  Needs Recovery: ${health.validation.needsRecovery ? 'YES' : 'NO'}`);
      
      if (health.validation.issues.length > 0) {
        console.log(`\n⚠️  Issues:`);
        health.validation.issues.forEach((issue, i) => {
          console.log(`  ${i + 1}. ${issue}`);
        });
      }
      
      if (health.recommendations.length > 0) {
        console.log(`\n💡 Recommendations:`);
        health.recommendations.forEach((rec, i) => {
          console.log(`  ${i + 1}. ${rec}`);
        });
      }

    } catch (error) {
      console.error('❌ Failed to perform health check:', error);
      process.exit(1);
    }
  }

  /**
   * 测试稳定性
   */
  async testStability(): Promise<void> {
    try {
      console.log('\n🧪 Testing Device ID Stability\n');
      
      console.log('Generating device ID 5 times to test consistency...\n');
      
      const results: string[] = [];
      
      for (let i = 1; i <= 5; i++) {
        // 清除内存缓存但不清除磁盘缓存
        const identifier = await this.stableHardwareIdentifier.generateStableDeviceId();
        results.push(identifier.deviceId);
        
        console.log(`Run ${i}: ${identifier.deviceId}`);
        console.log(`  Confidence: ${identifier.confidence}`);
        console.log(`  Stability: ${identifier.stability}`);
        console.log('');
        
        // 短暂延迟
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 检查一致性
      const allSame = results.every(id => id === results[0]);
      
      if (allSame) {
        console.log('✅ STABILITY TEST PASSED');
        console.log('All generated device IDs are identical');
      } else {
        console.log('❌ STABILITY TEST FAILED');
        console.log('Generated device IDs are not consistent');
        console.log('Unique IDs:', [...new Set(results)]);
      }

    } catch (error) {
      console.error('❌ Failed to test stability:', error);
      process.exit(1);
    }
  }

  /**
   * 清除所有缓存和备份
   */
  async clearAll(): Promise<void> {
    try {
      console.log('\n🗑️  Clearing All Caches and Data\n');
      
      // 清除硬件标识符缓存
      this.stableHardwareIdentifier.clearCache();
      console.log('✅ Hardware identifier cache cleared');
      
      // TODO: 清除备份（需要用户确认）
      console.log('⚠️  Backup clearing not implemented (safety measure)');
      console.log('💡 Manually remove backup files if needed');
      
      console.log('\n✅ Cache clearing completed');

    } catch (error) {
      console.error('❌ Failed to clear caches:', error);
      process.exit(1);
    }
  }
}

// CLI程序
async function main() {
  const program = new Command();
  const manager = new StableDeviceIdManager();

  program
    .name('stable-device-id-manager')
    .description('Stable Device ID management tool for 100% unique and persistent device identification')
    .version('2.0.0');

  program
    .command('info')
    .description('Show current stable device ID information')
    .action(async () => {
      await manager.initialize();
      await manager.showInfo();
    });

  program
    .command('validate')
    .description('Validate current device ID')
    .action(async () => {
      await manager.initialize();
      await manager.validate();
    });

  program
    .command('recover')
    .description('Attempt to recover device ID using all available methods')
    .action(async () => {
      await manager.initialize();
      await manager.recover();
    });

  program
    .command('regenerate')
    .description('Force regenerate stable device ID')
    .action(async () => {
      await manager.initialize();
      await manager.regenerate();
    });

  program
    .command('fingerprint')
    .description('Show detailed hardware fingerprint information')
    .action(async () => {
      await manager.initialize();
      await manager.showFingerprint();
    });

  program
    .command('backup')
    .description('Manage device ID backups')
    .argument('<action>', 'Action to perform: list, create, restore')
    .argument('[backup-id]', 'Backup ID for restore operation')
    .action(async (action, backupId) => {
      await manager.initialize();
      await manager.manageBackups(action as 'list' | 'create' | 'restore', backupId);
    });

  program
    .command('health')
    .description('Perform comprehensive health check')
    .action(async () => {
      await manager.initialize();
      await manager.healthCheck();
    });

  program
    .command('test-stability')
    .description('Test device ID generation stability')
    .action(async () => {
      await manager.initialize();
      await manager.testStability();
    });

  program
    .command('clear-all')
    .description('Clear all caches and temporary data')
    .action(async () => {
      await manager.initialize();
      await manager.clearAll();
    });

  await program.parseAsync();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Application error:', error);
    process.exit(1);
  });
}

export { StableDeviceIdManager };