/**
 * 错误处理工具 - 重构版本
 * 统一的错误处理和分类系统
 */

import { logger } from './logger';

export enum ErrorType {
  NETWORK = 'NETWORK',
  AUTH = 'AUTH',
  CONFIG = 'CONFIG',
  PERMISSION = 'PERMISSION',
  FILESYSTEM = 'FILESYSTEM',
  VALIDATION = 'VALIDATION',
  TIMEOUT = 'TIMEOUT',
  RESOURCE = 'RESOURCE',
  PLATFORM = 'PLATFORM',
  UNKNOWN = 'UNKNOWN'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface EnhancedError extends Error {
  type: ErrorType;
  severity: ErrorSeverity;
  code?: string;
  context?: any;
  timestamp: Date;
  recoverable: boolean;
  cause?: Error;
}

interface ErrorHandlerConfig {
  enableLogging: boolean;
  enableConsoleOutput: boolean;
  enableReporting: boolean;
  maxStackTrace: number;
}

export class ErrorHandler {
  private static instance?: ErrorHandler;
  private config: ErrorHandlerConfig;
  private errorCounts = new Map<ErrorType, number>();
  private lastErrors: EnhancedError[] = [];
  private maxLastErrors = 10;

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = {
      enableLogging: true,
      enableConsoleOutput: true,
      enableReporting: false,
      maxStackTrace: 10,
      ...config
    };

    // 设置全局错误处理器
    this.setupGlobalErrorHandlers();
  }

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * 创建增强错误对象
   */
  createError(
    message: string,
    type: ErrorType = ErrorType.UNKNOWN,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    options: {
      code?: string;
      cause?: Error;
      context?: any;
      recoverable?: boolean;
    } = {}
  ): EnhancedError {
    const error = new Error(message) as EnhancedError;
    
    error.type = type;
    error.severity = severity;
    error.code = options.code;
    error.context = options.context;
    error.timestamp = new Date();
    error.recoverable = options.recoverable ?? this.isRecoverableByType(type);

    if (options.cause) {
      error.cause = options.cause;
      error.stack = `${error.stack}\nCaused by: ${options.cause.stack}`;
    }

    return error;
  }

  /**
   * 处理错误
   */
  handleError(error: Error | EnhancedError, context?: any): EnhancedError {
    let enhancedError: EnhancedError;

    if (this.isEnhancedError(error)) {
      enhancedError = error;
      if (context) {
        enhancedError.context = { ...enhancedError.context, ...context };
      }
    } else {
      // 分类普通错误
      const classification = this.classifyError(error);
      enhancedError = this.createError(
        error.message,
        classification.type,
        classification.severity,
        {
          cause: error,
          context,
          recoverable: classification.recoverable
        }
      );
    }

    // 记录错误
    this.recordError(enhancedError);

    // 处理错误
    this.processError(enhancedError);

    return enhancedError;
  }

  /**
   * 分类错误
   */
  private classifyError(error: Error): {
    type: ErrorType;
    severity: ErrorSeverity;
    recoverable: boolean;
  } {
    const message = error.message.toLowerCase();
    const code = (error as any).code?.toLowerCase() || '';

    // 网络错误
    if (this.isNetworkError(message, code)) {
      return {
        type: ErrorType.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        recoverable: true
      };
    }

    // 认证错误
    if (this.isAuthError(message, code)) {
      return {
        type: ErrorType.AUTH,
        severity: ErrorSeverity.HIGH,
        recoverable: true
      };
    }

    // 配置错误
    if (this.isConfigError(message, code)) {
      return {
        type: ErrorType.CONFIG,
        severity: ErrorSeverity.HIGH,
        recoverable: false
      };
    }

    // 权限错误
    if (this.isPermissionError(message, code)) {
      return {
        type: ErrorType.PERMISSION,
        severity: ErrorSeverity.HIGH,
        recoverable: false
      };
    }

    // 文件系统错误
    if (this.isFilesystemError(message, code)) {
      return {
        type: ErrorType.FILESYSTEM,
        severity: ErrorSeverity.MEDIUM,
        recoverable: true
      };
    }

    // 超时错误
    if (this.isTimeoutError(message, code)) {
      return {
        type: ErrorType.TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
        recoverable: true
      };
    }

    // 验证错误
    if (this.isValidationError(message, code)) {
      return {
        type: ErrorType.VALIDATION,
        severity: ErrorSeverity.LOW,
        recoverable: true
      };
    }

    // 资源错误
    if (this.isResourceError(message, code)) {
      return {
        type: ErrorType.RESOURCE,
        severity: ErrorSeverity.HIGH,
        recoverable: false
      };
    }

    // 平台错误
    if (this.isPlatformError(message, code)) {
      return {
        type: ErrorType.PLATFORM,
        severity: ErrorSeverity.HIGH,
        recoverable: false
      };
    }

    // 默认未知错误
    return {
      type: ErrorType.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      recoverable: true
    };
  }

  private isNetworkError(message: string, code: string): boolean {
    const networkPatterns = [
      'network', 'connection', 'timeout', 'refused',
      'econnreset', 'econnrefused', 'etimedout', 'enotfound',
      'socket', 'dns', 'hostname', 'port'
    ];
    return networkPatterns.some(pattern => 
      message.includes(pattern) || code.includes(pattern)
    );
  }

  private isAuthError(message: string, code: string): boolean {
    const authPatterns = [
      'auth', 'unauthorized', 'forbidden', 'token',
      'login', 'credential', 'session', 'permission denied'
    ];
    return authPatterns.some(pattern => 
      message.includes(pattern) || code.includes(pattern)
    );
  }

  private isConfigError(message: string, code: string): boolean {
    const configPatterns = [
      'config', 'configuration', 'invalid url', 'missing',
      'not found', 'invalid format', 'parse error'
    ];
    return configPatterns.some(pattern => message.includes(pattern));
  }

  private isPermissionError(message: string, code: string): boolean {
    const permissionPatterns = [
      'permission', 'access denied', 'eperm', 'eacces',
      'privilege', 'not allowed', 'restricted'
    ];
    return permissionPatterns.some(pattern => 
      message.includes(pattern) || code.includes(pattern)
    );
  }

  private isFilesystemError(message: string, code: string): boolean {
    const fsPatterns = [
      'file', 'directory', 'path', 'enoent', 'eexist',
      'emfile', 'enfile', 'enospc', 'disk', 'storage'
    ];
    return fsPatterns.some(pattern => 
      message.includes(pattern) || code.includes(pattern)
    );
  }

  private isTimeoutError(message: string, code: string): boolean {
    const timeoutPatterns = ['timeout', 'etimedout', 'time out'];
    return timeoutPatterns.some(pattern => 
      message.includes(pattern) || code.includes(pattern)
    );
  }

  private isValidationError(message: string, code: string): boolean {
    const validationPatterns = [
      'validation', 'invalid', 'format', 'schema',
      'required', 'missing field', 'type error'
    ];
    return validationPatterns.some(pattern => message.includes(pattern));
  }

  private isResourceError(message: string, code: string): boolean {
    const resourcePatterns = [
      'memory', 'heap', 'out of', 'resource', 'limit',
      'enomem', 'insufficient', 'quota'
    ];
    return resourcePatterns.some(pattern => 
      message.includes(pattern) || code.includes(pattern)
    );
  }

  private isPlatformError(message: string, code: string): boolean {
    const platformPatterns = [
      'unsupported platform', 'not supported', 'platform',
      'operating system', 'incompatible'
    ];
    return platformPatterns.some(pattern => message.includes(pattern));
  }

  private isRecoverableByType(type: ErrorType): boolean {
    const recoverableTypes = [
      ErrorType.NETWORK,
      ErrorType.TIMEOUT,
      ErrorType.VALIDATION,
      ErrorType.AUTH,
      ErrorType.FILESYSTEM,
      ErrorType.UNKNOWN
    ];
    return recoverableTypes.includes(type);
  }

  private isEnhancedError(error: any): error is EnhancedError {
    return error && 
           typeof error.type === 'string' && 
           typeof error.severity === 'string' &&
           error.timestamp instanceof Date;
  }

  private recordError(error: EnhancedError): void {
    // 增加计数
    const count = this.errorCounts.get(error.type) || 0;
    this.errorCounts.set(error.type, count + 1);

    // 记录最近错误
    this.lastErrors.unshift(error);
    if (this.lastErrors.length > this.maxLastErrors) {
      this.lastErrors = this.lastErrors.slice(0, this.maxLastErrors);
    }
  }

  private processError(error: EnhancedError): void {
    // 控制台输出
    if (this.config.enableConsoleOutput) {
      this.outputToConsole(error);
    }

    // 日志记录
    if (this.config.enableLogging) {
      this.logError(error);
    }

    // 错误报告（如果启用）
    if (this.config.enableReporting) {
      this.reportError(error);
    }
  }

  private outputToConsole(error: EnhancedError): void {
    const prefix = `[${error.type}:${error.severity}]`;
    
    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        console.error(prefix, error.message);
        break;
      case ErrorSeverity.HIGH:
        console.error(prefix, error.message);
        break;
      case ErrorSeverity.MEDIUM:
        console.warn(prefix, error.message);
        break;
      case ErrorSeverity.LOW:
        console.log(prefix, error.message);
        break;
    }

    if (error.context) {
      console.log('Context:', error.context);
    }
  }

  private logError(error: EnhancedError): void {
    const logLevel = this.getSeverityLogLevel(error.severity);
    
    logger[logLevel](
      `${error.type} error: ${error.message}`,
      error,
      {
        type: error.type,
        severity: error.severity,
        code: error.code,
        context: error.context,
        recoverable: error.recoverable
      }
    );
  }

  private getSeverityLogLevel(severity: ErrorSeverity): 'debug' | 'info' | 'warn' | 'error' {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return 'error';
      case ErrorSeverity.HIGH:
        return 'error';
      case ErrorSeverity.MEDIUM:
        return 'warn';
      case ErrorSeverity.LOW:
        return 'info';
      default:
        return 'error';
    }
  }

  private reportError(error: EnhancedError): void {
    // 这里可以实现错误报告逻辑
    // 例如发送到错误监控服务
    console.debug('[ErrorHandler] Error reporting not implemented');
  }

  private setupGlobalErrorHandlers(): void {
    // 处理未捕获的异常
    process.on('uncaughtException', (error) => {
      const enhancedError = this.handleError(error, { global: true });
      console.error('[Global] Uncaught Exception:', enhancedError.message);
      
      if (enhancedError.severity === ErrorSeverity.CRITICAL) {
        process.exit(1);
      }
    });

    // 处理未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      const enhancedError = this.handleError(error, { 
        global: true, 
        promise: promise.toString() 
      });
      console.error('[Global] Unhandled Rejection:', enhancedError.message);
    });
  }

  // 公共方法

  /**
   * 获取错误统计
   */
  getErrorStats(): {
    totalErrors: number;
    errorsByType: Record<ErrorType, number>;
    recentErrors: EnhancedError[];
  } {
    const totalErrors = Array.from(this.errorCounts.values())
      .reduce((sum, count) => sum + count, 0);
    
    const errorsByType = {} as Record<ErrorType, number>;
    Object.values(ErrorType).forEach(type => {
      errorsByType[type] = this.errorCounts.get(type) || 0;
    });

    return {
      totalErrors,
      errorsByType,
      recentErrors: [...this.lastErrors]
    };
  }

  /**
   * 清空错误统计
   */
  clearStats(): void {
    this.errorCounts.clear();
    this.lastErrors = [];
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ErrorHandlerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// 导出默认实例
export const errorHandler = ErrorHandler.getInstance();

// 便捷函数
export const handleError = (error: Error, context?: any): EnhancedError => {
  return errorHandler.handleError(error, context);
};

export const createError = (
  message: string,
  type: ErrorType = ErrorType.UNKNOWN,
  severity: ErrorSeverity = ErrorSeverity.MEDIUM,
  options: any = {}
): EnhancedError => {
  return errorHandler.createError(message, type, severity, options);
};

export default ErrorHandler;