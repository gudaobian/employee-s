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
export { MacOSAdapter } from './macos/macos-adapter';
export { WindowsAdapter } from './windows/windows-adapter';

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