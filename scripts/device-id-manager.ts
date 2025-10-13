#!/usr/bin/env ts-node

/**
 * 设备ID管理工具
 * 用于查看、验证、迁移和重新生成设备ID
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigServiceCLI } from '../common/config/config-service-cli';
import { DeviceInfoService } from '../common/services/device-info-service';
import { HardwareIdentifier } from '../common/utils/hardware-identifier';

class DeviceIdManager {
  private configService: ConfigServiceCLI;
  private deviceInfoService?: DeviceInfoService;
  private hardwareIdentifier: HardwareIdentifier;

  constructor() {
    this.configService = ConfigServiceCLI.getInstance();
    this.hardwareIdentifier = HardwareIdentifier.getInstance();
  }

  async initialize(): Promise<void> {
    try {
      await this.configService.initialize();
      console.log('✅ Device ID Manager initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Device ID Manager:', error);
      throw error;
    }
  }

  /**
   * 显示当前设备ID信息
   */
  async showInfo(): Promise<void> {
    try {
      console.log('\n📋 Current Device ID Information\n');
      
      // 显示配置中的设备ID
      const config = this.configService.getConfig();
      console.log(`Config Device ID: ${config.deviceId}`);
      
      // 显示硬件设备ID信息
      const deviceIdInfo = await this.configService.getDeviceIdInfo();
      console.log(`Hardware Device ID: ${deviceIdInfo.deviceId}`);
      console.log(`Hardware Fingerprint: ${deviceIdInfo.hardwareFingerprint}`);
      console.log(`Confidence Level: ${deviceIdInfo.confidence}`);
      console.log(`Platform: ${deviceIdInfo.platform}`);
      console.log(`Components: ${deviceIdInfo.components.join(', ')}`);
      
      // 验证ID是否匹配
      const validation = await this.configService.validateCurrentDeviceId();
      console.log(`\n✅ Validation: ${validation.isValid ? 'VALID' : 'INVALID'}`);
      console.log(`Reason: ${validation.reason}`);
      
      if (!validation.isValid && validation.expectedId) {
        console.log(`Expected ID: ${validation.expectedId}`);
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
      console.log('\n🔍 Validating Device ID...\n');
      
      const validation = await this.configService.validateCurrentDeviceId();
      
      if (validation.isValid) {
        console.log('✅ Device ID is VALID');
        console.log(`Current ID: ${validation.currentId}`);
        console.log(`Reason: ${validation.reason}`);
      } else {
        console.log('❌ Device ID is INVALID');
        console.log(`Current ID: ${validation.currentId}`);
        console.log(`Reason: ${validation.reason}`);
        
        if (validation.expectedId) {
          console.log(`Expected ID: ${validation.expectedId}`);
          console.log('\n💡 Run "device-id-manager migrate" to fix this issue');
        }
      }

    } catch (error) {
      console.error('❌ Failed to validate device ID:', error);
      process.exit(1);
    }
  }

  /**
   * 迁移设备ID
   */
  async migrate(): Promise<void> {
    try {
      console.log('\n🔄 Migrating Device ID...\n');
      
      // 使用DeviceInfoService进行迁移
      if (!this.deviceInfoService) {
        // 创建一个简化的平台适配器，只用于迁移操作
        const simplePlatformAdapter = {
          async cleanup() {},
          async takeScreenshot() { 
            throw new Error('Not implemented for migration'); 
          },
          async captureWindow() { 
            throw new Error('Not implemented for migration'); 
          },
          async checkPermissions() { 
            return { 
              screenshot: false, 
              accessibility: false, 
              systemInfo: true 
            };
          },
          async requestPermissions() { 
            return { 
              screenshot: false, 
              accessibility: false, 
              systemInfo: true 
            };
          },
          async getSystemInfo() {
            const os = require('os');
            return {
              hostname: os.hostname(),
              platform: os.platform(),
              osVersion: os.release(),
              username: os.userInfo().username,
              cpu: os.cpus()[0]?.model || 'Unknown',
              memory: os.totalmem(),
              deviceId: ''  // 将由设备ID服务填充
            };
          },
          async getProcessList() { return []; },
          async getActiveWindow() { 
            return {
              id: '',
              title: '',
              processName: '',
              processId: 0,
              bounds: { x: 0, y: 0, width: 0, height: 0 },
              isVisible: false
            };
          },
          startWindowMonitoring() {},
          stopWindowMonitoring() {},
          async collectMonitoringData() { return {}; },
          getPlatformSpecificCapabilities() {
            return {
              supportsScreenshot: false,
              supportsWindowMonitoring: false,
              supportsSystemInfo: true,
              nativePermissionRequired: false,
              supportedScreenshotFormats: [],
              hasNativeAPI: false
            };
          }
        };
        
        this.deviceInfoService = new DeviceInfoService(this.configService, simplePlatformAdapter);
      }

      const result = await this.deviceInfoService.migrateDeviceId();
      
      if (result.migrated) {
        console.log('✅ Device ID migrated successfully');
        console.log(`Old ID: ${result.oldDeviceId || 'None'}`);
        console.log(`New ID: ${result.newDeviceId}`);
        console.log(`Reason: ${result.reason}`);
      } else {
        console.log('ℹ️  No migration needed');
        console.log(`Current ID: ${result.newDeviceId}`);
        console.log(`Reason: ${result.reason}`);
      }

    } catch (error) {
      console.error('❌ Failed to migrate device ID:', error);
      process.exit(1);
    }
  }

  /**
   * 重新生成设备ID
   */
  async regenerate(): Promise<void> {
    try {
      console.log('\n🔄 Regenerating Device ID...\n');
      
      const oldConfig = this.configService.getConfig();
      const oldDeviceId = oldConfig.deviceId;
      
      console.log(`Old Device ID: ${oldDeviceId}`);
      
      const newDeviceId = await this.configService.regenerateDeviceId();
      
      console.log(`New Device ID: ${newDeviceId}`);
      console.log('\n✅ Device ID regenerated successfully');
      
      // 显示新的设备信息
      const deviceIdInfo = await this.configService.getDeviceIdInfo();
      console.log(`Confidence: ${deviceIdInfo.confidence}`);
      console.log(`Components: ${deviceIdInfo.components.join(', ')}`);

    } catch (error) {
      console.error('❌ Failed to regenerate device ID:', error);
      process.exit(1);
    }
  }

  /**
   * 显示硬件信息摘要
   */
  async showHardware(): Promise<void> {
    try {
      console.log('\n🖥️  Hardware Information Summary\n');
      
      const summary = await this.hardwareIdentifier.getHardwareInfoSummary();
      
      console.log(`Platform: ${summary.platform}`);
      console.log(`Available Components: ${summary.availableComponents.join(', ')}`);
      
      if (summary.deviceIdentifier) {
        console.log(`\nDevice Identifier:`);
        console.log(`  ID: ${summary.deviceIdentifier.deviceId}`);
        console.log(`  Fingerprint: ${summary.deviceIdentifier.hardwareFingerprint}`);
        console.log(`  Confidence: ${summary.deviceIdentifier.confidence}`);
        console.log(`  Components: ${summary.deviceIdentifier.components.join(', ')}`);
        console.log(`  Generated: ${summary.deviceIdentifier.generatedAt}`);
      }
      
      if (summary.hardwareInfo) {
        console.log(`\nHardware Details:`);
        Object.entries(summary.hardwareInfo).forEach(([key, value]) => {
          if (value) {
            console.log(`  ${key}: ${value}`);
          }
        });
      }

    } catch (error) {
      console.error('❌ Failed to show hardware info:', error);
      process.exit(1);
    }
  }

  /**
   * 备份当前配置
   */
  async backup(): Promise<void> {
    try {
      console.log('\n💾 Creating Device ID Backup...\n');
      
      const config = this.configService.getConfig();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(process.cwd(), `device-id-backup-${timestamp}.json`);
      
      const backupData = {
        timestamp: new Date().toISOString(),
        deviceId: config.deviceId,
        serverUrl: config.serverUrl,
        websocketUrl: config.websocketUrl,
        platform: process.platform,
        hostname: require('os').hostname(),
        hardwareInfo: await this.configService.getDeviceIdInfo()
      };
      
      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
      
      console.log(`✅ Backup created: ${backupPath}`);
      console.log(`Device ID: ${config.deviceId}`);

    } catch (error) {
      console.error('❌ Failed to create backup:', error);
      process.exit(1);
    }
  }

  /**
   * 从备份恢复设备ID
   */
  async restore(backupPath: string): Promise<void> {
    try {
      console.log(`\n📂 Restoring Device ID from ${backupPath}...\n`);
      
      if (!fs.existsSync(backupPath)) {
        console.error(`❌ Backup file not found: ${backupPath}`);
        process.exit(1);
      }
      
      const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      
      if (!backupData.deviceId) {
        console.error('❌ Invalid backup file: no device ID found');
        process.exit(1);
      }
      
      console.log(`Backup Date: ${backupData.timestamp}`);
      console.log(`Backup Device ID: ${backupData.deviceId}`);
      console.log(`Backup Platform: ${backupData.platform}`);
      
      // 更新配置
      await this.configService.updateConfig({ 
        deviceId: backupData.deviceId 
      });
      
      console.log('\n✅ Device ID restored successfully');
      
      // 验证恢复的ID
      const validation = await this.configService.validateCurrentDeviceId();
      console.log(`Validation: ${validation.isValid ? 'VALID' : 'INVALID'}`);
      console.log(`Reason: ${validation.reason}`);

    } catch (error) {
      console.error('❌ Failed to restore device ID:', error);
      process.exit(1);
    }
  }
}

// CLI程序
async function main() {
  const program = new Command();
  const manager = new DeviceIdManager();

  program
    .name('device-id-manager')
    .description('Device ID management tool for Employee Monitoring Client')
    .version('1.0.0');

  program
    .command('info')
    .description('Show current device ID information')
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
    .command('migrate')
    .description('Migrate device ID to hardware-based identifier')
    .action(async () => {
      await manager.initialize();
      await manager.migrate();
    });

  program
    .command('regenerate')
    .description('Force regenerate device ID')
    .action(async () => {
      await manager.initialize();
      await manager.regenerate();
    });

  program
    .command('hardware')
    .description('Show hardware information summary')
    .action(async () => {
      await manager.initialize();
      await manager.showHardware();
    });

  program
    .command('backup')
    .description('Create device ID backup')
    .action(async () => {
      await manager.initialize();
      await manager.backup();
    });

  program
    .command('restore')
    .description('Restore device ID from backup')
    .argument('<backup-file>', 'Path to backup file')
    .action(async (backupFile) => {
      await manager.initialize();
      await manager.restore(backupFile);
    });

  await program.parseAsync();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Application error:', error);
    process.exit(1);
  });
}

export { DeviceIdManager };