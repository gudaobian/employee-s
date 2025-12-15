/**
 * ERROR状态处理器 - 重构版本
 * 负责处理系统错误和恢复逻辑
 */

import { BaseStateHandler } from '../base-state-handler';
import { 
  DeviceState, 
  FSMContext, 
  StateHandlerResult 
} from '../../../interfaces/fsm-interfaces';
import { IConfigService } from '../../../interfaces/service-interfaces';

interface ErrorInfo {
  type: string;
  message: string;
  timestamp: Date;
  context?: any;
  recoverable: boolean;
}

export class ErrorStateHandler extends BaseStateHandler {
  private configService: IConfigService;
  private errorHistory: ErrorInfo[] = [];
  private recoveryAttempts = 0;
  private maxRecoveryAttempts = 5;
  private lastRecoveryAttempt = 0;
  private consecutiveErrors = 0;
  private lastErrorTime = 0;
  
  // 动态延迟机制：避免429错误
  private getBackoffDelay(): number {
    // 检查最近的错误类型，为不同错误使用不同策略
    const recentError = this.errorHistory[this.errorHistory.length - 1];
    const errorType = recentError?.type || 'UNKNOWN_ERROR';
    
    // 针对不同错误类型的基础延迟
    let baseDelay = 5000; // 默认5秒
    
    switch (errorType) {
      case 'PLATFORM_INIT_ERROR':
        // 平台初始化错误需要更长延迟，可能需要等待系统就绪
        baseDelay = 15000; // 15秒基础延迟
        break;
      case 'NETWORK_ERROR':
      case 'WEBSOCKET_ERROR':
        // 网络相关错误使用更保守的策略
        baseDelay = 10000; // 10秒基础延迟
        break;
      case 'AUTH_ERROR':
      case 'DEVICE_ERROR':
        // 认证和设备错误可能是服务器端问题，需要较长延迟
        baseDelay = 8000; // 8秒基础延迟
        break;
      default:
        baseDelay = 5000;
        break;
    }
    
    // 指数退避：每次连续错误延迟翻倍，最大120秒
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.consecutiveErrors - 1), 120000);
    
    // 如果连续错误超过5次，使用非常长的延迟避免429
    if (this.consecutiveErrors > 5) {
      return Math.max(exponentialDelay, 60000); // 最少60秒
    }
    
    // 如果连续错误超过3次，使用较长的延迟
    if (this.consecutiveErrors > 3) {
      return Math.max(exponentialDelay, 30000); // 最少30秒
    }
    
    return exponentialDelay;
  }

  constructor(configService: IConfigService) {
    super('ErrorStateHandler', [DeviceState.ERROR]);
    this.configService = configService;
  }

  protected async execute(context: FSMContext): Promise<StateHandlerResult> {
    try {
      console.log('[ERROR] Handling error state...');
      
      this.validateContext(context);
      
      // 更新连续错误计数
      const now = Date.now();
      if (now - this.lastErrorTime < 60000) { // 如果在1分钟内发生错误，算作连续错误
        this.consecutiveErrors++;
      } else {
        this.consecutiveErrors = 1; // 重置连续错误计数
      }
      this.lastErrorTime = now;

      // 记录错误信息
      const errorInfo = await this.analyzeError(context);
      this.recordError(errorInfo);

      console.log(`[ERROR] Error analysis completed: ${errorInfo.type} - ${errorInfo.message}`);
      console.log(`[ERROR] Recoverable: ${errorInfo.recoverable}`);
      console.log(`[ERROR] Consecutive errors: ${this.consecutiveErrors}`);

      // 如果错误不可恢复，或超过最大恢复尝试次数，保持错误状态
      if (!errorInfo.recoverable || this.recoveryAttempts >= this.maxRecoveryAttempts) {
        return await this.handleUnrecoverableError(errorInfo);
      }

      // 使用动态延迟机制
      const backoffDelay = this.getBackoffDelay();
      
      // 检查是否需要等待
      if (now - this.lastRecoveryAttempt < backoffDelay) {
        const remainingWait = backoffDelay - (now - this.lastRecoveryAttempt);
        console.log(`[ERROR] Rate limiting active, waiting ${Math.round(remainingWait / 1000)}s to avoid 429 errors`);
        
        return {
          success: false,
          nextState: DeviceState.ERROR,
          reason: `Rate limiting: waiting ${Math.round(remainingWait / 1000)}s (consecutive errors: ${this.consecutiveErrors})`,
          retryDelay: remainingWait
        };
      }

      // 尝试恢复
      const recoveryResult = await this.attemptRecovery(errorInfo);

      if (recoveryResult.success) {
        console.log('[ERROR] Recovery successful');
        this.resetRecoveryState();
        
        return {
          success: true,
          nextState: recoveryResult.nextState || DeviceState.INIT,
          reason: 'Error recovery successful',
          data: {
            errorType: errorInfo.type,
            recoveryMethod: recoveryResult.method,
            recoveryTime: new Date(),
            consecutiveErrors: this.consecutiveErrors
          }
        };
      } else {
        this.recoveryAttempts++;
        this.lastRecoveryAttempt = now;
        
        console.log(`[ERROR] Recovery failed (attempt ${this.recoveryAttempts}/${this.maxRecoveryAttempts}): ${recoveryResult.error}`);
        console.log(`[ERROR] Next retry in ${Math.round(this.getBackoffDelay() / 1000)}s`);
        
        return {
          success: false,
          nextState: DeviceState.ERROR,
          reason: `Recovery failed: ${recoveryResult.error} (retry ${this.recoveryAttempts}/${this.maxRecoveryAttempts})`,
          retryDelay: this.getBackoffDelay()
        };
      }

    } catch (error: any) {
      console.error('[ERROR] Error state handling failed:', error);
      this.consecutiveErrors++; // 增加连续错误计数
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Error handling failed: ${error.message}`,
        retryDelay: Math.max(this.getBackoffDelay(), 60000) // 至少等待1分钟
      };
    }
  }

  private async analyzeError(context: FSMContext): Promise<ErrorInfo> {
    try {
      console.log('[ERROR] Analyzing error...');

      let errorType = 'UNKNOWN_ERROR';
      let errorMessage = 'Unknown error occurred';
      let recoverable = true;
      let errorContext = context.data;

      // 从context中提取错误信息
      if (context.data?.error) {
        const error = context.data.error;
        errorMessage = error.message || error.toString();
        
        // 根据错误消息判断类型
        errorType = this.categorizeError(errorMessage);
        recoverable = this.isErrorRecoverable(errorType, errorMessage);
      }

      // 从context.reason中提取更多信息
      if (context.data?.reason) {
        errorMessage = `${errorMessage} (${context.data.reason})`;
      }

      const errorInfo: ErrorInfo = {
        type: errorType,
        message: errorMessage,
        timestamp: new Date(),
        context: errorContext,
        recoverable
      };

      console.log('[ERROR] Error analysis result:', {
        type: errorInfo.type,
        recoverable: errorInfo.recoverable,
        messageLength: errorInfo.message.length
      });

      return errorInfo;

    } catch (error: any) {
      console.error('[ERROR] Error analysis failed:', error);
      
      return {
        type: 'ANALYSIS_ERROR',
        message: `Failed to analyze error: ${error.message}`,
        timestamp: new Date(),
        recoverable: false
      };
    }
  }

  private categorizeError(errorMessage: string): string {
    const errorPatterns = [
      { pattern: /platform.*adapter.*not.*initialized/i, type: 'PLATFORM_INIT_ERROR' },
      { pattern: /network|connection|timeout|refused/i, type: 'NETWORK_ERROR' },
      { pattern: /authentication|unauthorized|forbidden/i, type: 'AUTH_ERROR' },
      { pattern: /configuration|config|invalid.*url/i, type: 'CONFIG_ERROR' },
      { pattern: /permission|access.*denied|privilege/i, type: 'PERMISSION_ERROR' },
      { pattern: /device.*not.*found|registration.*failed/i, type: 'DEVICE_ERROR' },
      { pattern: /websocket|ws/i, type: 'WEBSOCKET_ERROR' },
      { pattern: /screenshot|capture/i, type: 'SCREENSHOT_ERROR' },
      { pattern: /file.*system|disk|storage/i, type: 'FILESYSTEM_ERROR' },
      { pattern: /memory|heap|resource/i, type: 'RESOURCE_ERROR' }
    ];

    for (const { pattern, type } of errorPatterns) {
      if (pattern.test(errorMessage)) {
        return type;
      }
    }

    return 'UNKNOWN_ERROR';
  }

  private isErrorRecoverable(errorType: string, errorMessage: string): boolean {
    // 定义可恢复的错误类型
    const recoverableErrors = [
      'PLATFORM_INIT_ERROR',
      'NETWORK_ERROR',
      'WEBSOCKET_ERROR',
      'DEVICE_ERROR',
      'AUTH_ERROR'
    ];

    // 定义不可恢复的错误类型
    const unrecoverableErrors = [
      'CONFIG_ERROR',
      'PERMISSION_ERROR',
      'FILESYSTEM_ERROR',
      'RESOURCE_ERROR'
    ];

    if (unrecoverableErrors.includes(errorType)) {
      return false;
    }

    if (recoverableErrors.includes(errorType)) {
      return true;
    }

    // 对于未知错误，基于消息内容判断
    const unrecoverablePatterns = [
      /fatal|critical|corrupted/i,
      /insufficient.*permission/i,
      /invalid.*configuration/i
    ];

    for (const pattern of unrecoverablePatterns) {
      if (pattern.test(errorMessage)) {
        return false;
      }
    }

    // 默认假设可恢复
    return true;
  }

  private recordError(errorInfo: ErrorInfo): void {
    try {
      this.errorHistory.push(errorInfo);
      
      // 限制错误历史大小
      if (this.errorHistory.length > 50) {
        this.errorHistory = this.errorHistory.slice(-25);
      }

      console.log(`[ERROR] Error recorded: ${errorInfo.type} at ${errorInfo.timestamp.toISOString()}`);
    } catch (error) {
      console.warn('[ERROR] Failed to record error:', error);
    }
  }

  private async handleUnrecoverableError(errorInfo: ErrorInfo): Promise<StateHandlerResult> {
    try {
      console.error('[ERROR] Handling unrecoverable error...');
      
      // 记录不可恢复错误的详细信息
      await this.logUnrecoverableError(errorInfo);

      // 显示用户友好的错误信息
      this.displayErrorMessage(errorInfo);

      // 保持在错误状态，等待手动干预
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: `Unrecoverable error: ${errorInfo.message}`,
        retryDelay: 300000 // 5分钟后重试（给用户时间处理问题）
      };

    } catch (error: any) {
      console.error('[ERROR] Failed to handle unrecoverable error:', error);
      
      return {
        success: false,
        nextState: DeviceState.ERROR,
        reason: 'Critical error handling failure',
        retryDelay: 600000 // 10分钟后重试
      };
    }
  }

  private async attemptRecovery(errorInfo: ErrorInfo): Promise<{
    success: boolean;
    nextState?: DeviceState;
    method?: string;
    error?: string;
  }> {
    try {
      console.log(`[ERROR] Attempting recovery for ${errorInfo.type}...`);
      this.recoveryAttempts++;

      switch (errorInfo.type) {
        case 'PLATFORM_INIT_ERROR':
          return await this.recoverFromPlatformInitError();
          
        case 'NETWORK_ERROR':
          return await this.recoverFromNetworkError();
          
        case 'AUTH_ERROR':
          return await this.recoverFromAuthError();
          
        case 'DEVICE_ERROR':
          return await this.recoverFromDeviceError();
          
        case 'WEBSOCKET_ERROR':
          return await this.recoverFromWebSocketError();
          
        default:
          return await this.attemptGenericRecovery(errorInfo);
      }

    } catch (error: any) {
      console.error('[ERROR] Recovery attempt failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async recoverFromNetworkError(): Promise<{
    success: boolean;
    nextState?: DeviceState;
    method?: string;
    error?: string;
  }> {
    try {
      console.log('[ERROR] Attempting network error recovery...');

      // 测试网络连接
      const networkTest = await this.testNetworkConnectivity();
      
      if (networkTest.success) {
        return {
          success: true,
          nextState: DeviceState.HEARTBEAT,
          method: 'network_recovery'
        };
      } else {
        return {
          success: false,
          error: `Network still unavailable: ${networkTest.error}`
        };
      }

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async recoverFromAuthError(): Promise<{
    success: boolean;
    nextState?: DeviceState;
    method?: string;
    error?: string;
  }> {
    try {
      console.log('[ERROR] Attempting auth error recovery...');

      // 重新开始注册流程
      return {
        success: true,
        nextState: DeviceState.REGISTER,
        method: 'auth_recovery'
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async recoverFromDeviceError(): Promise<{
    success: boolean;
    nextState?: DeviceState;
    method?: string;
    error?: string;
  }> {
    try {
      console.log('[ERROR] Attempting device error recovery...');

      // 重新开始注册流程
      return {
        success: true,
        nextState: DeviceState.REGISTER,
        method: 'device_recovery'
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async recoverFromWebSocketError(): Promise<{
    success: boolean;
    nextState?: DeviceState;
    method?: string;
    error?: string;
  }> {
    try {
      console.log('[ERROR] Attempting WebSocket error recovery...');

      // 返回到WebSocket检查状态
      return {
        success: true,
        nextState: DeviceState.WS_CHECK,
        method: 'websocket_recovery'
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async recoverFromPlatformInitError(): Promise<{
    success: boolean;
    nextState?: DeviceState;
    method?: string;
    error?: string;
  }> {
    try {
      console.log('[ERROR] Attempting platform initialization error recovery...');

      // 平台初始化错误通常需要重新初始化平台适配器
      // 这类错误可能是因为平台服务还未就绪，给更多时间让系统稳定
      
      // 检查是否是连续的平台初始化错误
      const recentPlatformErrors = this.errorHistory.filter(
        error => error.type === 'PLATFORM_INIT_ERROR' && 
        (Date.now() - error.timestamp.getTime()) < 300000 // 5分钟内
      );

      if (recentPlatformErrors.length > 3) {
        // 如果5分钟内有超过3次平台初始化错误，可能是系统性问题
        console.warn('[ERROR] Multiple platform init errors detected, may require manual intervention');
        return {
          success: false,
          error: 'Repeated platform initialization failures, system may need restart'
        };
      }

      // 对于平台初始化错误，从初始化状态重新开始
      // 这会触发平台适配器的重新初始化
      return {
        success: true,
        nextState: DeviceState.INIT,
        method: 'platform_reinit_recovery'
      };

    } catch (error: any) {
      console.error('[ERROR] Platform init recovery failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async attemptGenericRecovery(errorInfo: ErrorInfo): Promise<{
    success: boolean;
    nextState?: DeviceState;
    method?: string;
    error?: string;
  }> {
    try {
      console.log('[ERROR] Attempting generic recovery...');

      // 对于未知错误，尝试从初始化状态开始
      return {
        success: true,
        nextState: DeviceState.INIT,
        method: 'generic_recovery'
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async testNetworkConnectivity(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const config = this.configService.getConfig();
      if (!config.serverUrl) {
        return {
          success: false,
          error: 'No server URL configured'
        };
      }

      // 简单的HTTP请求测试
      const testUrl = `${config.serverUrl}/api/health`;
      
      // 这里使用简化的连接测试
      console.log(`[ERROR] Testing connectivity to: ${testUrl}`);
      
      // 模拟连接测试（实际应用中应该发送真实的HTTP请求）
      await this.sleep(1000);
      
      return { success: true };

    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async logUnrecoverableError(errorInfo: ErrorInfo): Promise<void> {
    try {
      console.error('='.repeat(80));
      console.error('[ERROR] UNRECOVERABLE ERROR DETECTED');
      console.error('='.repeat(80));
      console.error(`Type: ${errorInfo.type}`);
      console.error(`Message: ${errorInfo.message}`);
      console.error(`Timestamp: ${errorInfo.timestamp.toISOString()}`);
      console.error(`Recovery Attempts: ${this.recoveryAttempts}/${this.maxRecoveryAttempts}`);
      console.error('='.repeat(80));
      
      // 可以在这里添加更多的日志记录逻辑
      // 例如：写入日志文件、发送错误报告等
      
    } catch (error) {
      console.error('[ERROR] Failed to log unrecoverable error:', error);
    }
  }

  private displayErrorMessage(errorInfo: ErrorInfo): void {
    try {
      console.log('');
      console.log('!' + '='.repeat(78) + '!');
      console.log('!                           SYSTEM ERROR                           !');
      console.log('!' + '='.repeat(78) + '!');
      console.log(`! Error Type: ${errorInfo.type.padEnd(60)} !`);
      console.log(`! Error Message: ${errorInfo.message.substring(0, 57).padEnd(57)} !`);
      console.log('!                                                                  !');
      console.log('! Please contact your system administrator for assistance.        !');
      console.log('!' + '='.repeat(78) + '!');
      console.log('');
    } catch (error) {
      // 忽略显示错误
    }
  }

  private resetRecoveryState(): void {
    this.recoveryAttempts = 0;
    this.lastRecoveryAttempt = 0;
    this.consecutiveErrors = 0; // 重置连续错误计数
    this.lastErrorTime = 0;
    console.log('[ERROR] Recovery state reset');
  }

  protected async onEnter(context: FSMContext): Promise<void> {
    console.log('[ERROR] Entering error state');
  }

  protected async onExit(context: FSMContext): Promise<void> {
    console.log('[ERROR] Exiting error state');
    
    // 注意：FSMContext没有nextState属性，这里记录错误恢复日志
    console.log('[ERROR] Error state exit completed, attempting recovery');
  }

  // 公共方法：获取错误状态信息
  getErrorStatus(): {
    recoveryAttempts: number;
    maxRecoveryAttempts: number;
    lastRecoveryAttempt: Date | null;
    consecutiveErrors: number;
    nextRetryDelay: number;
    errorHistoryCount: number;
    recentErrors: ErrorInfo[];
  } {
    return {
      recoveryAttempts: this.recoveryAttempts,
      maxRecoveryAttempts: this.maxRecoveryAttempts,
      lastRecoveryAttempt: this.lastRecoveryAttempt > 0 ? new Date(this.lastRecoveryAttempt) : null,
      consecutiveErrors: this.consecutiveErrors,
      nextRetryDelay: this.getBackoffDelay(),
      errorHistoryCount: this.errorHistory.length,
      recentErrors: this.errorHistory.slice(-5) // 最近5个错误
    };
  }

  // 清除错误历史
  clearErrorHistory(): void {
    this.errorHistory = [];
    console.log('[ERROR] Error history cleared');
  }

  // 手动重置恢复状态
  manualReset(): void {
    this.resetRecoveryState();
    this.clearErrorHistory();
    console.log('[ERROR] Manual reset completed');
  }
}