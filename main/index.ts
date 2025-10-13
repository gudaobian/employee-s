/**
 * 主入口文件
 * 应用程序的主入口点
 */

import { EmployeeMonitorApp } from './app';
import { logger } from '../common/utils';
import { getPlatformInfo } from '../platforms';

/**
 * 应用程序主入口
 */
async function main(): Promise<void> {
  let app: EmployeeMonitorApp | null = null;
  
  try {
    // 记录启动信息
    const platformInfo = getPlatformInfo();
    logger.info('Employee Monitor starting...', {
      platform: platformInfo.name,
      version: platformInfo.version,
      architecture: platformInfo.architecture,
      processId: process.pid,
      nodeVersion: process.version
    });
    
    // 检查平台支持
    if (!platformInfo.isSupported) {
      throw new Error(`Unsupported platform: ${platformInfo.name}`);
    }
    
    // 创建应用程序实例
    app = new EmployeeMonitorApp();
    
    // 启动应用程序
    await app.start();
    
    logger.info('Employee Monitor started successfully');
    
    // 设置信号处理
    setupSignalHandlers(app);
    
    // 保持进程运行
    process.stdin.resume();
    
  } catch (error) {
    logger.error('Failed to start Employee Monitor', error);
    
    if (app) {
      try {
        await app.stop();
      } catch (shutdownError) {
        logger.error('Error during shutdown', shutdownError);
      }
    }
    
    process.exit(1);
  }
}

/**
 * 设置信号处理器
 */
function setupSignalHandlers(app: EmployeeMonitorApp): void {
  const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'] as const;
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        await app.stop();
        logger.info('Employee Monitor stopped successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown', error);
        process.exit(1);
      }
    });
  });
  
  // 处理未捕获的异常
  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception', error);
    
    try {
      await app.stop();
    } catch (shutdownError) {
      logger.error('Error during emergency shutdown', shutdownError);
    }
    
    process.exit(1);
  });
  
  // 处理未处理的Promise拒绝
  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled Rejection at Promise', { reason, promise });
    
    try {
      await app.stop();
    } catch (shutdownError) {
      logger.error('Error during emergency shutdown', shutdownError);
    }
    
    process.exit(1);
  });
}

// 直接运行时执行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main };
export default main;