/**
 * INIT状态处理器 - 重构版本
 * 负责系统初始化和基础验证
 */

import { BaseStateHandler } from '../base-state-handler';
import { 
  DeviceState, 
  FSMContext, 
  StateHandlerResult 
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';

export class InitStateHandler extends BaseStateHandler {
  private configService: IConfigService;

  constructor(configService: IConfigService) {
    super('InitStateHandler', [DeviceState.INIT]);
    this.configService = configService;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      console.log('[INIT] Starting system initialization...');
      
      // 验证上下文
      this.validateContext(context);

      // 执行初始化步骤
      await this.performInitializationSteps();

      console.log('[INIT] System initialization completed successfully');
      
      return {
        success: true,
        nextState: DeviceState.HEARTBEAT,
        reason: 'Initialization completed, starting heartbeat'
      };

    } catch (error: any) {
      console.error('[INIT] Initialization failed:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Initialization failed: ${error.message}`,
        error
      };
    }
  }

  private async performInitializationSteps(): Promise<void> {
    // 步骤1：加载和验证配置
    console.log('[INIT] Step 1: Loading and validating configuration...');
    await this.loadAndValidateConfig();
    console.log('[INIT] Step 1: Configuration validation completed');

    // 步骤2：验证设备ID
    console.log('[INIT] Step 2: Validating device ID...');
    await this.validateDeviceId();
    console.log('[INIT] Step 2: Device ID validation completed');

    // 步骤3：初始化基础服务
    console.log('[INIT] Step 3: Initializing basic services...');
    await this.initializeBasicServices();
    console.log('[INIT] Step 3: Basic services initialization completed');

    // 步骤4：系统环境检查
    console.log('[INIT] Step 4: Performing system checks...');
    await this.performSystemCheck();
    console.log('[INIT] Step 4: System checks completed');
  }

  private async loadAndValidateConfig(): Promise<void> {
    try {
      console.log('[INIT] Loading configuration...');
      
      const config = this.configService.getConfig();
      
      // 验证配置对象
      if (!config) {
        throw new Error('Configuration loading failed - config object is null');
      }

      // 验证必要的配置项
      if (!config.serverUrl || !config.serverUrl.trim()) {
        throw new Error('Server URL is not configured');
      }

      // 验证服务器URL格式
      try {
        new URL(config.serverUrl);
      } catch {
        throw new Error(`Invalid server URL format: ${config.serverUrl}`);
      }

      // 验证WebSocket URL（如果存在）
      if (config.websocketUrl) {
        try {
          const wsUrl = new URL(config.websocketUrl);
          if (!['ws:', 'wss:'].includes(wsUrl.protocol)) {
            throw new Error(`Invalid WebSocket URL protocol: ${wsUrl.protocol}`);
          }
        } catch {
          throw new Error(`Invalid WebSocket URL format: ${config.websocketUrl}`);
        }
      }

      // 验证其他配置
      if (!config.monitoring) {
        console.warn('[INIT] Monitoring configuration not found, using defaults');
      }

      if (!config.security) {
        console.warn('[INIT] Security configuration not found, using defaults');
      }

      console.log('[INIT] Configuration validation passed', {
        serverUrl: config.serverUrl,
        hasDeviceId: !!config.deviceId,
        hasMonitoringConfig: !!config.monitoring,
        hasSecurityConfig: !!config.security
      });

    } catch (error: any) {
      console.error('[INIT] Configuration validation failed:', error);
      throw new Error(`Configuration validation failed: ${error.message}`);
    }
  }

  private async validateDeviceId(): Promise<void> {
    try {
      console.log('[INIT] Validating device ID...');
      
      const config = this.configService.getConfig();
      let deviceId = config.deviceId;

      if (!deviceId || deviceId.trim() === '') {
        console.info('[INIT] Device ID not found, will be generated during registration');
        return;
      }

      // 基本格式验证
      if (deviceId.length < 10) {
        console.warn('[INIT] Device ID format may be incorrect - too short');
      }

      // 字符验证
      if (!/^[a-zA-Z0-9-_]+$/.test(deviceId)) {
        console.warn('[INIT] Device ID contains special characters, may need regeneration');
      }

      console.log('[INIT] Device ID validation completed', {
        deviceId: deviceId.substring(0, 8) + '...'
      });

    } catch (error: any) {
      console.error('[INIT] Device ID validation failed:', error);
      throw new Error(`Device ID validation failed: ${error.message}`);
    }
  }

  private async initializeBasicServices(): Promise<void> {
    try {
      console.log('[INIT] Initializing basic services...');
      
      // 检查平台兼容性
      const platform = process.platform;
      const supportedPlatforms = ['win32', 'darwin', 'linux'];
      
      if (!supportedPlatforms.includes(platform)) {
        throw new Error(`Unsupported operating system platform: ${platform}`);
      }

      console.log(`[INIT] Platform compatibility check passed: ${platform}`);

      // 检查Node.js版本
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.substring(1).split('.')[0]);
      
      if (majorVersion < 14) {
        console.warn(`[INIT] Node.js version is outdated (${nodeVersion}), recommend upgrading to 14 or higher`);
      }

      console.log(`[INIT] Node.js version check passed: ${nodeVersion}`);

      // 检查内存使用情况
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      
      console.log(`[INIT] Current memory usage: ${heapUsedMB}MB`);
      
      if (heapUsedMB > 200) {
        console.warn('[INIT] High memory usage detected, please monitor');
      }

      // 初始化配置服务（确保已初始化）
      if (!this.configService.validateConfig()) {
        throw new Error('Configuration service validation failed');
      }

      console.log('[INIT] Basic services initialization completed');

    } catch (error: any) {
      console.error('[INIT] Basic services initialization failed:', error);
      throw new Error(`Basic services initialization failed: ${error.message}`);
    }
  }

  private async performSystemCheck(): Promise<void> {
    try {
      console.log('[INIT] Performing system environment checks...');
      
      // 检查系统权限
      await this.checkSystemPermissions();
      
      // 检查网络连接能力
      await this.checkNetworkCapability();
      
      // 检查文件系统权限
      await this.checkFileSystemPermissions();

      console.log('[INIT] System environment checks completed');

    } catch (error: any) {
      console.error('[INIT] System environment checks failed:', error);
      throw new Error(`System environment checks failed: ${error.message}`);
    }
  }

  private async checkSystemPermissions(): Promise<void> {
    try {
      console.log('[INIT] Checking system permissions...');
      
      const os = require('os');
      
      // 获取基本系统信息
      const systemInfo = {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem()
      };

      console.log('[INIT] System information retrieved successfully', {
        platform: systemInfo.platform,
        arch: systemInfo.arch,
        hostname: systemInfo.hostname,
        cpus: systemInfo.cpus
      });

    } catch (error: any) {
      console.warn('[INIT] System permissions check partially failed:', error);
      // 权限检查失败不应该阻止初始化
    }
  }

  private async checkNetworkCapability(): Promise<void> {
    try {
      console.log('[INIT] Checking network connectivity...');
      
      // 简单的网络连接检查
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // 尝试ping一个可靠的服务器
      const testHosts = ['8.8.8.8', 'google.com', '1.1.1.1'];
      let connected = false;

      for (const host of testHosts) {
        try {
          const pingCommand = process.platform === 'win32' 
            ? `ping -n 1 -w 2000 ${host}`
            : `ping -c 1 -W 2 ${host}`;

          await execAsync(pingCommand);
          connected = true;
          console.log(`[INIT] Network connectivity check passed (${host})`);
          break;
        } catch {
          continue;
        }
      }

      if (!connected) {
        console.warn('[INIT] Network connectivity check failed - no internet connection');
      }

    } catch (error: any) {
      console.warn('[INIT] Network connectivity check failed:', error);
      // 网络检查失败时只记录警告，不阻止初始化
    }
  }

  private async checkFileSystemPermissions(): Promise<void> {
    try {
      console.log('[INIT] Checking file system permissions...');
      
      const fs = require('fs').promises;
      const path = require('path');
      const os = require('os');
      
      // 在临时目录进行读写测试
      const testDir = os.tmpdir();
      const testFile = path.join(testDir, `.permission-test-${Date.now()}`);
      
      try {
        // 测试写入
        await fs.writeFile(testFile, 'test');
        
        // 测试读取
        await fs.readFile(testFile);
        
        // 清理测试文件
        await fs.unlink(testFile);
        
        console.log('[INIT] File system read/write permissions are normal');
        
      } catch (error: any) {
        throw new Error(`Insufficient file system permissions: ${error.message}`);
      }

    } catch (error: any) {
      console.warn('[INIT] File system permissions check failed:', error);
      // 文件系统检查失败时只记录警告
    }
  }
}