/**
 * 工具模块统一导出
 * 重构版本 - 完整导出所有工具模块
 */

// 基础服务
export * from './base-service';

// 日志系统
export * from './logger';

// 定时器管理器
export * from './timer-manager';

// 事件管理器
export * from './event-manager';

// 网络检查器
export * from './network-checker';

// 环境检测器
export * from './environment-detector';

// 错误处理器
export * from './error-handler';

// HTTP客户端
export * from './http-client';

// 资源管理器
export * from './resource-manager';

// 路径助手
export * from './path-helper';

// 便捷导出 - 常用工具的实例
export { logger } from './logger';
export { timerManager, managedSetTimeout, managedSetInterval, managedClear, delay } from './timer-manager';
export { eventManager, on, once, off, emit, safeEmit, waitForEvent } from './event-manager';
export { networkChecker, isOnline, checkNetwork, waitForConnection, startNetworkMonitoring, stopNetworkMonitoring } from './network-checker';
export { environmentDetector, getEnvironmentInfo, getRuntimeCapabilities, hasCapability, isWindows, isMacOS, isLinux } from './environment-detector';
export { errorHandler, handleError, createError, ErrorType, ErrorSeverity } from './error-handler';
export { httpClient } from './http-client';
export { resourceManager } from './resource-manager';