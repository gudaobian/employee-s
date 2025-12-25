/**
 * 版本工具函数
 *
 * 提供版本比较、解析和格式化功能
 */

import type { VersionChangeType } from '../types/hot-update.types';

/**
 * 版本号元组 [major, minor, patch]
 */
type VersionTuple = [number, number, number];

/**
 * 解析版本字符串
 * @param version 版本字符串 (e.g., "1.0.147")
 * @returns 版本号元组
 */
export function parseVersion(version: string): VersionTuple {
  const parts = version.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * 比较两个版本
 * @param v1 版本1
 * @param v2 版本2
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const version1 = parseVersion(v1);
  const version2 = parseVersion(v2);

  for (let i = 0; i < 3; i++) {
    if (version1[i] > version2[i]) return 1;
    if (version1[i] < version2[i]) return -1;
  }

  return 0;
}

/**
 * 判断版本变更类型
 * @param fromVersion 源版本
 * @param toVersion 目标版本
 * @returns 版本变更类型
 */
export function getVersionChangeType(fromVersion: string, toVersion: string): VersionChangeType {
  const from = parseVersion(fromVersion);
  const to = parseVersion(toVersion);

  if (from[0] !== to[0]) return 'major';  // 主版本号不同
  if (from[1] !== to[1]) return 'minor';  // 次版本号不同
  return 'patch';                          // 补丁版本号不同
}

/**
 * 检查是否满足最低版本要求
 * @param currentVersion 当前版本
 * @param minVersion 最低版本要求
 * @returns true if current >= min, false otherwise
 */
export function meetsMinVersion(currentVersion: string, minVersion: string | null | undefined): boolean {
  if (!minVersion) {
    return true; // 没有最低版本要求
  }

  try {
    return compareVersions(currentVersion, minVersion) >= 0;
  } catch (error) {
    console.error('Failed to compare versions:', { currentVersion, minVersion }, error);
    return true; // 比较失败时假设满足要求
  }
}

/**
 * 格式化版本变更描述
 * @param fromVersion 源版本
 * @param toVersion 目标版本
 * @param changeType 变更类型
 * @returns 格式化的变更描述
 */
export function formatVersionChange(
  fromVersion: string,
  toVersion: string,
  changeType: VersionChangeType
): string {
  const changeTypeMap: Record<VersionChangeType, string> = {
    major: '重大版本升级',
    minor: '功能更新',
    patch: '补丁更新'
  };

  return `${changeTypeMap[changeType]}: ${fromVersion} → ${toVersion}`;
}

/**
 * 获取版本变更类型的Emoji图标
 */
export function getVersionChangeIcon(changeType: VersionChangeType): string {
  const iconMap: Record<VersionChangeType, string> = {
    major: '🎉',
    minor: '✨',
    patch: '🔧'
  };

  return iconMap[changeType];
}

/**
 * 获取版本变更类型的标题
 */
export function getVersionChangeTitle(changeType: VersionChangeType, isForceUpdate: boolean = false): string {
  if (isForceUpdate) {
    return '⚠️ 强制更新';
  }

  const titleMap: Record<VersionChangeType, string> = {
    major: '🎉 重要版本更新',
    minor: '✨ 功能更新',
    patch: '🔧 补丁更新'
  };

  return titleMap[changeType];
}

/**
 * 获取版本变更类型的详细说明
 */
export function getVersionChangeDetail(
  changeType: VersionChangeType,
  isForceUpdate: boolean = false
): string {
  if (isForceUpdate) {
    return '此更新为必须安装的重要更新，必须重启应用才能继续使用';
  }

  const detailMap: Record<VersionChangeType, string> = {
    major: '此更新包含重要新功能和改进，建议立即重启应用',
    minor: '此更新包含新功能和优化，重启后即可使用',
    patch: '此更新修复了已知问题，重启后生效'
  };

  return detailMap[changeType];
}
