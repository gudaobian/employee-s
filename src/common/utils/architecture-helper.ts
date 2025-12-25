/**
 * CPU架构工具类
 *
 * 功能：获取设备的CPU架构信息，用于热更新匹配和版本选择
 */

import * as os from 'os';

/**
 * 支持的CPU架构类型
 */
export type Architecture = 'x64' | 'arm64' | 'ia32';

/**
 * 架构信息
 */
export interface ArchitectureInfo {
  /** 当前运行架构（实际架构） */
  arch: Architecture;

  /** 原始架构字符串 */
  raw: string;

  /** 是否为原生架构（非Rosetta 2等兼容层） */
  isNative: boolean;

  /** 平台 */
  platform: 'darwin' | 'win32';

  /** 描述信息 */
  description: string;
}

/**
 * 获取设备CPU架构
 */
export function getArchitecture(): ArchitectureInfo {
  const rawArch = process.arch;
  const platform = process.platform === 'darwin' ? 'darwin' : 'win32';

  // 规范化架构名称
  let arch: Architecture;
  switch (rawArch) {
    case 'arm64':
      arch = 'arm64';
      break;
    case 'x64':
      arch = 'x64';
      break;
    case 'ia32':
      arch = 'ia32';
      break;
    default:
      // 未知架构，默认为 x64
      console.warn(`[ArchitectureHelper] 未知架构: ${rawArch}，默认使用 x64`);
      arch = 'x64';
  }

  // 检测是否为原生架构
  const isNative = checkNativeArchitecture(arch, platform);

  // 生成描述信息
  const description = generateDescription(arch, platform, isNative);

  return {
    arch,
    raw: rawArch,
    isNative,
    platform,
    description
  };
}

/**
 * 检测是否为原生架构
 *
 * macOS: 检测是否在 Rosetta 2 下运行
 * Windows: 检测是否在 WOW64（32位应用在64位系统上运行）下运行
 */
function checkNativeArchitecture(arch: Architecture, platform: 'darwin' | 'win32'): boolean {
  if (platform === 'darwin') {
    // macOS: 检测是否在 Rosetta 2 下运行
    // 方法：对比 process.arch 和 os.arch()
    // - process.arch: 应用程序编译的架构
    // - os.arch(): 实际CPU架构

    const osArch = os.arch();

    // 如果应用是 x64，但系统是 arm64，说明在 Rosetta 2 下运行
    if (arch === 'x64' && osArch === 'arm64') {
      return false; // 非原生（Rosetta 2）
    }

    return true; // 原生运行

  } else {
    // Windows: 检测 WOW64
    // 方法：检查环境变量 PROCESSOR_ARCHITEW6432

    // 如果应用是 ia32，但存在此环境变量，说明在64位系统上运行32位应用
    if (arch === 'ia32' && process.env.PROCESSOR_ARCHITEW6432) {
      return false; // 非原生（WOW64）
    }

    return true; // 原生运行
  }
}

/**
 * 生成架构描述信息
 */
function generateDescription(arch: Architecture, platform: 'darwin' | 'win32', isNative: boolean): string {
  const archNames: Record<Architecture, string> = {
    'arm64': 'ARM 64-bit',
    'x64': 'Intel/AMD 64-bit',
    'ia32': 'Intel/AMD 32-bit'
  };

  const platformNames = {
    'darwin': 'macOS',
    'win32': 'Windows'
  };

  let desc = `${platformNames[platform]} ${archNames[arch]}`;

  if (!isNative) {
    if (platform === 'darwin') {
      desc += ' (Rosetta 2)';
    } else {
      desc += ' (WOW64)';
    }
  }

  return desc;
}

/**
 * 获取架构的简短标识符（用于文件名等）
 *
 * @example
 * getArchitectureIdentifier() // 'darwin-arm64' 或 'win32-x64'
 */
export function getArchitectureIdentifier(): string {
  const info = getArchitecture();
  return `${info.platform}-${info.arch}`;
}

/**
 * 检查当前架构是否匹配指定的架构列表
 *
 * @param supportedArchitectures - 支持的架构列表
 * @returns 是否匹配
 *
 * @example
 * isArchitectureSupported(['arm64', 'x64']) // true on Apple Silicon
 * isArchitectureSupported(['ia32']) // false on modern systems
 */
export function isArchitectureSupported(supportedArchitectures: Architecture[]): boolean {
  const currentArch = getArchitecture().arch;
  return supportedArchitectures.includes(currentArch);
}

/**
 * 获取推荐的下载架构
 *
 * 规则：
 * - macOS arm64: 优先 arm64，fallback x64（通过 Rosetta 2）
 * - macOS x64: 只支持 x64
 * - Windows x64: 优先 x64，fallback ia32
 * - Windows ia32: 只支持 ia32
 * - Windows arm64: 优先 arm64，fallback x64（通过兼容层）
 *
 * @returns 推荐架构列表（按优先级排序）
 */
export function getRecommendedArchitectures(): Architecture[] {
  const info = getArchitecture();

  if (info.platform === 'darwin') {
    if (info.arch === 'arm64') {
      return ['arm64', 'x64']; // Apple Silicon 可运行 x64（通过 Rosetta 2）
    } else {
      return ['x64']; // Intel Mac 只支持 x64
    }
  } else {
    // Windows
    if (info.arch === 'arm64') {
      return ['arm64', 'x64']; // ARM Windows 可运行 x64（通过兼容层）
    } else if (info.arch === 'x64') {
      return ['x64', 'ia32']; // x64 Windows 可运行 ia32
    } else {
      return ['ia32']; // ia32 Windows 只支持 ia32
    }
  }
}
