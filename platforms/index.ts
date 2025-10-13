/**
 * 平台模块统一导出
 * 提供平台特定功能的统一接口
 */

// 平台接口和基类
export {
  IPlatformAdapter,
  PlatformAdapterBase,
  SystemInfo,
  ProcessInfo,
  NetworkInfo,
  ScreenshotOptions,
  ScreenshotResult,
  PermissionResult,
  ActivityData
} from './interfaces/platform-interface';

// 平台具体实现
export { DarwinAdapter } from './darwin/darwin-adapter';
export { Win32Adapter } from './win32/win32-adapter';
export { LinuxAdapter } from './linux/linux-adapter';

// 平台工厂
export {
  PlatformFactory,
  PlatformType,
  PlatformInfo,
  platformFactory,
  createPlatformAdapter,
  getPlatformInfo,
  isPlatformSupported,
  isFeatureSupported
} from './platform-factory';

// 默认导出
export { platformFactory as default } from './platform-factory';