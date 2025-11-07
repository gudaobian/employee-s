#!/usr/bin/env node

/**
 * Employee Monitor CLI - 重构版本
 * 新的三层架构实现
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { EmployeeMonitorApp, AppConfig, AppState } from './app';
import { createPlatformAdapter, getPlatformInfo } from '../platforms';
import { logger, urlCollectStats } from '../common/utils';
import * as path from 'path';
import * as fs from 'fs';

// 初始化命令行程序
const program = new Command();

// 动态解析 package.json
function findPackageJson() {
  const possiblePaths = [
    '../package.json',
    './package.json',
    path.join(__dirname, '../package.json'),
    path.join(__dirname, '../../package.json'),
  ];
  
  for (const pkgPath of possiblePaths) {
    try {
      if (fs.existsSync(path.resolve(__dirname, pkgPath))) {
        return require(path.resolve(__dirname, pkgPath));
      }
    } catch (error) {
      // 继续尝试下一个路径
    }
  }
  
  return { version: '2.0.0', name: 'employee-monitoring-client-new' };
}

const packageInfo = findPackageJson();

async function initializePlatform() {
  try {
    // 获取平台信息
    const platformInfo = getPlatformInfo();
    console.log(chalk.green(`✅ Platform: ${platformInfo.name} (${platformInfo.type}) - ${platformInfo.isSupported ? 'Supported' : 'Not Supported'}`));
    
    if (!platformInfo.isSupported) {
      throw new Error(`Unsupported platform: ${platformInfo.name}`);
    }
    
    // 创建平台适配器
    const platformAdapter = await createPlatformAdapter();
    
    return platformAdapter;
  } catch (error: any) {
    console.error(chalk.red('❌ Platform initialization failed:'), error.message);
    throw error;
  }
}

function createAppConfig(): Partial<AppConfig> {
  return {
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    deviceId: process.env.DEVICE_ID,
    enableMonitoring: process.env.ENABLE_MONITORING !== 'false',
    monitoringInterval: parseInt(process.env.MONITORING_INTERVAL || '30000'),
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    autoStart: process.env.AUTO_START === 'true',
    minimized: process.env.MINIMIZED === 'true'
  };
}

// CLI 命令定义

program
  .name('employee-monitor-new')
  .description('Employee Monitoring Client - New Architecture')
  .version(packageInfo.version);

// Start 命令
program
  .command('start')
  .description('启动监控客户端')
  .option('-d, --daemon', '后台守护进程模式')
  .option('-i, --interactive', '交互模式（默认）')
  .action(async (options) => {
    console.log(chalk.blue('🚀 Employee Monitor - New Architecture'));
    console.log(chalk.blue('📍 基于三层架构：main/ + common/ + platforms/'));
    console.log('');

    try {
      // 创建配置
      const config = createAppConfig();
      console.log(chalk.cyan('🔧 Configuration loaded:'));
      console.log(`   🔗 Server: ${config.serverUrl}`);
      console.log(`   🆔 Device ID: ${config.deviceId?.substring(0, 8) || 'auto-generated'}...`);
      
      // 创建应用实例
      const app = new EmployeeMonitorApp(config);
      
      // 设置事件监听
      app.on('started', () => {
        console.log(chalk.green('✅ Employee Monitor started successfully!'));
        console.log('');
        console.log(chalk.blue('📋 Available commands:'));
        console.log('   employee-monitor-new status    - 查看运行状态');
        console.log('   employee-monitor-new stop      - 停止监控');
        console.log('   employee-monitor-new restart   - 重启监控');
        console.log('');
        console.log(chalk.gray('Press Ctrl+C to stop'));
      });
      
      app.on('error', (error) => {
        console.error(chalk.red('❌ Application error:'), error.message);
      });
      
      app.on('deviceStateChanged', (data) => {
        console.log(chalk.blue(`🔄 Device state: ${data.from} → ${data.to}`));
      });
      
      // 启动应用
      console.log(chalk.cyan('🚀 Starting Employee Monitor application...'));
      await app.start();
      
      // 信号处理
      const gracefulShutdown = async (signal: string) => {
        console.log(`\n${chalk.yellow(`📡 Received ${signal}, shutting down gracefully...`)}`);
        try {
          await app.stop();
          console.log(chalk.green('✅ Employee Monitor stopped successfully'));
          process.exit(0);
        } catch (error: any) {
          console.error(chalk.red('❌ Error during shutdown:'), error.message);
          process.exit(1);
        }
      };
      
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
      
      // 保持进程运行
      if (!options.daemon) {
        process.stdin.resume();
      }
      
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to start Employee Monitor:'), error.message);
      logger.error('CLI start command failed', error);
      process.exit(1);
    }
  });

// Status 命令
program
  .command('status')
  .description('查看监控客户端状态')
  .action(async () => {
    console.log(chalk.blue('📊 Employee Monitor Status - New Architecture'));
    console.log('═'.repeat(60));
    
    try {
      // 检查平台支持
      const platformInfo = getPlatformInfo();
      console.log(`🖥️  Platform: ${platformInfo.name} (${platformInfo.type})`);
      console.log(`📋 Supported: ${platformInfo.isSupported ? '✅' : '❌'}`);
      console.log(`🔌 Architecture: ${platformInfo.architecture}`);
      console.log(`📦 Capabilities: ${platformInfo.capabilities.join(', ')}`);
      
      if (platformInfo.isSupported) {
        try {
          const platformAdapter = await createPlatformAdapter();
          
          // 检查权限
          const screenshotPermission = await platformAdapter.checkScreenshotPermission();
          const accessibilityPermission = await platformAdapter.checkAccessibilityPermission();
          
          console.log('🔐 Permissions:');
          console.log(`   📸 Screenshot: ${screenshotPermission.granted ? '✅' : '❌'}`);
          console.log(`   ♿ Accessibility: ${accessibilityPermission.granted ? '✅' : '❌'}`);
          
          // 获取系统信息
          const systemInfo = await platformAdapter.getSystemInfo();
          console.log('💻 System Information:');
          console.log(`   🏷️  Hostname: ${systemInfo.hostname}`);
          console.log(`   👤 Username: ${systemInfo.username}`);
          console.log(`   🔧 CPU: ${systemInfo.cpu.model} (${systemInfo.cpu.cores} cores)`);
          console.log(`   💾 Memory: ${(systemInfo.memory.total / (1024**3)).toFixed(2)}GB total, ${(systemInfo.memory.free / (1024**3)).toFixed(2)}GB free`);
          
          // 获取活跃窗口（如果有权限）
          if (accessibilityPermission.granted) {
            try {
              const activeWindow = await platformAdapter.getActiveWindow();
              if (activeWindow) {
                console.log(`🔍 Active Window: ${activeWindow.title} (${activeWindow.application})`);
              } else {
                console.log('🔍 Active Window: No active window detected');
              }
            } catch (error) {
              console.log('🔍 Active Window: Unable to detect');
            }
          }
          
          await platformAdapter.cleanup();
          console.log(chalk.green('\n✅ Overall status: Healthy'));
          
        } catch (adapterError: any) {
          console.error(chalk.yellow(`⚠️ Platform adapter error: ${adapterError.message}`));
        }
      } else {
        console.log(chalk.red('❌ Platform not supported'));
      }
      
    } catch (error: any) {
      console.error(chalk.red('❌ Status check failed:'), error.message);
      logger.error('CLI status command failed', error);
      process.exit(1);
    }
  });

// Config 命令
program
  .command('config')
  .description('显示当前配置')
  .action(async () => {
    try {
      const config = createAppConfig();
      
      console.log(chalk.blue('⚙️  Current Configuration'));
      console.log('─'.repeat(50));
      console.log(chalk.cyan('Environment Variables:'));
      console.log(`   SERVER_URL: ${process.env.SERVER_URL || 'http://localhost:3000'}`);
      console.log(`   DEVICE_ID: ${process.env.DEVICE_ID || 'auto-generated'}`);
      console.log(`   ENABLE_MONITORING: ${process.env.ENABLE_MONITORING || 'true'}`);
      console.log(`   MONITORING_INTERVAL: ${process.env.MONITORING_INTERVAL || '30000'}`);
      console.log(`   LOG_LEVEL: ${process.env.LOG_LEVEL || 'info'}`);
      console.log(`   AUTO_START: ${process.env.AUTO_START || 'false'}`);
      console.log(`   MINIMIZED: ${process.env.MINIMIZED || 'false'}`);
      console.log('');
      console.log(chalk.cyan('Resolved Configuration:'));
      console.log(JSON.stringify(config, null, 2));
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to show configuration:'), error.message);
      logger.error('CLI config command failed', error);
      process.exit(1);
    }
  });

// Device 命令
program
  .command('device')
  .description('显示设备信息')
  .option('--json', '以JSON格式输出')
  .action(async (options) => {
    try {
      const platformAdapter = await initializePlatform();
      const systemInfo = await platformAdapter.getSystemInfo();
      
      if (options.json) {
        console.log(JSON.stringify(systemInfo, null, 2));
      } else {
        console.log(chalk.blue('📱 Device Information'));
        console.log('─'.repeat(50));
        console.log(`🖥️  Hostname: ${systemInfo.hostname}`);
        console.log(`💻 Platform: ${systemInfo.platform} ${systemInfo.version}`);
        console.log(`🏗️  Architecture: ${systemInfo.architecture}`);
        console.log(`👤 User: ${systemInfo.username}`);
        console.log(`🔧 CPU: ${systemInfo.cpu.model} (${systemInfo.cpu.cores} cores, ${systemInfo.cpu.usage}% usage)`);
        console.log(`💾 Memory: ${(systemInfo.memory.total / (1024**3)).toFixed(2)}GB total, ${(systemInfo.memory.used / (1024**3)).toFixed(2)}GB used`);
        console.log(`💿 Disk: ${(systemInfo.disk.total / (1024**3)).toFixed(2)}GB total, ${(systemInfo.disk.used / (1024**3)).toFixed(2)}GB used`);
      }
      
      await platformAdapter.cleanup();
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get device information:'), error.message);
      logger.error('CLI device command failed', error);
      process.exit(1);
    }
  });

// Screenshot 命令
program
  .command('screenshot')
  .description('拍摄屏幕截图')
  .option('-f, --format <format>', '图片格式 (png/jpg)', 'png')
  .option('-o, --output <file>', '输出文件路径')
  .action(async (options) => {
    try {
      const platformAdapter = await initializePlatform();
      
      // 检查截图权限
      const screenshotPermission = await platformAdapter.checkScreenshotPermission();
      if (!screenshotPermission.granted) {
        console.log(chalk.yellow('⚠️  Requesting screenshot permission...'));
        const requestedPermission = await platformAdapter.requestScreenshotPermission();
        if (!requestedPermission.granted) {
          console.log(chalk.red(`❌ Screenshot permission denied: ${requestedPermission.error || 'Unknown error'}`));
          return;
        }
      }
      
      console.log(chalk.cyan('📸 Taking screenshot...'));
      const screenshotResult = await platformAdapter.takeScreenshot({
        format: options.format as 'png' | 'jpg'
      });
      
      if (screenshotResult.success && screenshotResult.data) {
        const outputFile = options.output || `screenshot-${Date.now()}.${options.format}`;
        fs.writeFileSync(outputFile, screenshotResult.data);
        
        console.log(chalk.green(`✅ Screenshot saved: ${outputFile}`));
        console.log(`   💾 File size: ${(screenshotResult.data.length / 1024).toFixed(2)}KB`);
      } else {
        console.log(chalk.red(`❌ Screenshot failed: ${screenshotResult.error || 'Unknown error'}`));
      }
      
      await platformAdapter.cleanup();
    } catch (error: any) {
      console.error(chalk.red('❌ Screenshot failed:'), error.message);
      logger.error('CLI screenshot command failed', error);
      process.exit(1);
    }
  });

// Check Permissions 命令
program
  .command('check-permissions')
  .description('检查macOS辅助功能权限状态')
  .action(async () => {
    try {
      if (process.platform !== 'darwin') {
        console.log(chalk.yellow('⚠️  This command is only available on macOS'));
        return;
      }

      const { MacOSPermissionChecker } = await import('../platforms/macos/permission-checker');
      const checker = new MacOSPermissionChecker();
      const result = await checker.checkAccessibilityPermission();

      if (result.granted) {
        console.log(chalk.green('✅ 辅助功能权限已授予'));
        console.log('浏览器URL采集功能可正常使用');
      } else {
        console.log(chalk.red('❌ 辅助功能权限未授予'));
        console.log('\n' + result.message);
        console.log(chalk.yellow('\n如需自动打开系统设置，请运行:'));
        console.log(chalk.cyan('  npm run open-accessibility-settings'));
      }
    } catch (error: any) {
      console.error(chalk.red('❌ 权限检查失败:'), error.message);
      logger.error('CLI check-permissions command failed', error);
      process.exit(1);
    }
  });

// Stats 命令
program
  .command('stats')
  .description('显示URL采集统计信息')
  .option('--reset', '重置统计数据')
  .option('--json', '以JSON格式输出')
  .action((options) => {
    try {
      if (options.reset) {
        urlCollectStats.reset();
        console.log(chalk.green('✅ 统计数据已重置'));
        return;
      }

      if (options.json) {
        const metricsData = urlCollectStats.exportJSON();
        console.log(JSON.stringify(metricsData, null, 2));
      } else {
        // Display formatted report
        console.log(urlCollectStats.getReport());

        // Additional health summary
        const metrics = urlCollectStats.getMetrics();
        if (metrics.byBrowser.size > 0) {
          console.log(chalk.blue('Browser Health Status:'));
          console.log('─'.repeat(50));

          for (const [browser, _] of metrics.byBrowser.entries()) {
            const health = urlCollectStats.getBrowserHealth(browser);
            const successRate = urlCollectStats.getBrowserSuccessRate(browser);

            let healthIcon = '';
            let healthColor: any = chalk.white;

            switch (health) {
              case 'healthy':
                healthIcon = '✅';
                healthColor = chalk.green;
                break;
              case 'degraded':
                healthIcon = '⚠️';
                healthColor = chalk.yellow;
                break;
              case 'failing':
                healthIcon = '❌';
                healthColor = chalk.red;
                break;
              case 'unknown':
                healthIcon = '❓';
                healthColor = chalk.gray;
                break;
            }

            console.log(`  ${healthIcon} ${healthColor(browser)}: ${health} (${successRate.toFixed(1)}% success rate)`);
          }
          console.log('');
        }
      }
    } catch (error: any) {
      console.error(chalk.red('❌ 统计命令失败:'), error.message);
      logger.error('CLI stats command failed', error);
      process.exit(1);
    }
  });

// Health 命令
program
  .command('health')
  .description('健康检查')
  .action(async () => {
    console.log(chalk.blue('🏥 System Health Check'));
    console.log('─'.repeat(50));
    
    const checks = [];
    let overallHealth = true;
    
    try {
      // 检查平台支持
      const platformInfo = getPlatformInfo();
      const platformOK = platformInfo.isSupported;
      checks.push({ name: 'Platform Support', status: platformOK });
      if (!platformOK) overallHealth = false;
      
      if (platformOK) {
        // 检查平台适配器
        try {
          const platformAdapter = await createPlatformAdapter();
          checks.push({ name: 'Platform Adapter', status: true });
          
          // 检查权限
          const screenshotPermission = await platformAdapter.checkScreenshotPermission();
          const accessibilityPermission = await platformAdapter.checkAccessibilityPermission();
          
          checks.push({ name: 'Screenshot Permission', status: screenshotPermission.granted });
          checks.push({ name: 'Accessibility Permission', status: accessibilityPermission.granted });
          
          // 检查系统信息
          try {
            await platformAdapter.getSystemInfo();
            checks.push({ name: 'System Information', status: true });
          } catch {
            checks.push({ name: 'System Information', status: false });
            overallHealth = false;
          }
          
          await platformAdapter.cleanup();
        } catch {
          checks.push({ name: 'Platform Adapter', status: false });
          overallHealth = false;
        }
      }
      
      // 检查依赖
      const dependencies = ['chalk', 'commander'];
      for (const dep of dependencies) {
        try {
          require.resolve(dep);
          checks.push({ name: `Dependency: ${dep}`, status: true });
        } catch {
          checks.push({ name: `Dependency: ${dep}`, status: false });
          overallHealth = false;
        }
      }
      
    } catch (error: any) {
      console.error(chalk.red('❌ Health check failed:'), error.message);
      overallHealth = false;
    }
    
    // 显示结果
    checks.forEach(check => {
      const icon = check.status ? chalk.green('✅') : chalk.red('❌');
      console.log(`${icon} ${check.name}: ${check.status ? 'OK' : 'Failed'}`);
    });
    
    console.log('');
    const healthIcon = overallHealth ? chalk.green('✅') : chalk.red('❌');
    const healthStatus = overallHealth ? 'Good' : 'Issues Detected';
    console.log(`${healthIcon} Overall health: ${healthStatus}`);
    
    if (!overallHealth) {
      process.exit(1);
    }
  });

// 错误处理
program.exitOverride((err) => {
  if (err.code === 'commander.help') {
    process.exit(0);
  }
  if (err.code === 'commander.version') {
    process.exit(0);
  }
  
  console.error(chalk.red('❌ Command execution failed:'), err.message);
  process.exit(1);
});

// 如果没有参数，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

// 解析参数
program.parse();

// 导出用于测试
export { program };