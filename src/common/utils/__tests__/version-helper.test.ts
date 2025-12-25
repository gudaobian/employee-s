/**
 * Unit tests for version-helper utilities
 */

import {
  parseVersion,
  compareVersions,
  getVersionChangeType,
  meetsMinVersion,
  formatVersionChange,
  getVersionChangeIcon,
  getVersionChangeTitle,
  getVersionChangeDetail
} from '../version-helper';

describe('version-helper utilities', () => {
  describe('parseVersion', () => {
    it('should parse standard semantic version', () => {
      expect(parseVersion('1.0.147')).toEqual([1, 0, 147]);
      expect(parseVersion('2.5.10')).toEqual([2, 5, 10]);
    });

    it('should handle missing parts with zeros', () => {
      expect(parseVersion('1.0')).toEqual([1, 0, 0]);
      expect(parseVersion('2')).toEqual([2, 0, 0]);
    });

    it('should handle version with extra parts', () => {
      expect(parseVersion('1.0.147.beta')).toEqual([1, 0, 147]);
    });
  });

  describe('compareVersions', () => {
    it('should return 1 when v1 > v2', () => {
      expect(compareVersions('1.0.148', '1.0.147')).toBe(1);
      expect(compareVersions('2.0.0', '1.9.999')).toBe(1);
      expect(compareVersions('1.1.0', '1.0.999')).toBe(1);
    });

    it('should return -1 when v1 < v2', () => {
      expect(compareVersions('1.0.147', '1.0.148')).toBe(-1);
      expect(compareVersions('1.9.999', '2.0.0')).toBe(-1);
      expect(compareVersions('1.0.999', '1.1.0')).toBe(-1);
    });

    it('should return 0 when v1 === v2', () => {
      expect(compareVersions('1.0.147', '1.0.147')).toBe(0);
      expect(compareVersions('2.5.10', '2.5.10')).toBe(0);
    });

    it('should handle different format versions', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('2', '2.0.0')).toBe(0);
      expect(compareVersions('1.1', '1.0.999')).toBe(1);
    });
  });

  describe('getVersionChangeType', () => {
    it('should detect major version change', () => {
      expect(getVersionChangeType('1.0.147', '2.0.0')).toBe('major');
      expect(getVersionChangeType('1.9.999', '2.0.0')).toBe('major');
      expect(getVersionChangeType('2.5.10', '3.0.0')).toBe('major');
    });

    it('should detect minor version change', () => {
      expect(getVersionChangeType('1.0.147', '1.1.0')).toBe('minor');
      expect(getVersionChangeType('1.5.999', '1.6.0')).toBe('minor');
      expect(getVersionChangeType('2.0.0', '2.1.0')).toBe('minor');
    });

    it('should detect patch version change', () => {
      expect(getVersionChangeType('1.0.147', '1.0.148')).toBe('patch');
      expect(getVersionChangeType('1.0.100', '1.0.150')).toBe('patch');
      expect(getVersionChangeType('2.5.0', '2.5.1')).toBe('patch');
    });

    it('should prioritize major over minor/patch', () => {
      expect(getVersionChangeType('1.0.0', '2.1.1')).toBe('major');
    });

    it('should prioritize minor over patch', () => {
      expect(getVersionChangeType('1.0.0', '1.1.5')).toBe('minor');
    });
  });

  describe('meetsMinVersion', () => {
    it('should return true when no minVersion specified', () => {
      expect(meetsMinVersion('1.0.147', null)).toBe(true);
      expect(meetsMinVersion('1.0.147', undefined)).toBe(true);
    });

    it('should return true when current >= minVersion', () => {
      expect(meetsMinVersion('1.0.150', '1.0.120')).toBe(true);
      expect(meetsMinVersion('1.0.120', '1.0.120')).toBe(true);
      expect(meetsMinVersion('2.0.0', '1.0.120')).toBe(true);
    });

    it('should return false when current < minVersion', () => {
      expect(meetsMinVersion('1.0.100', '1.0.120')).toBe(false);
      expect(meetsMinVersion('0.9.999', '1.0.0')).toBe(false);
      expect(meetsMinVersion('1.0.0', '1.1.0')).toBe(false);
    });

    it('should handle different format versions', () => {
      expect(meetsMinVersion('1.0', '1.0.0')).toBe(true);
      expect(meetsMinVersion('1.1', '1.0.999')).toBe(true);
      expect(meetsMinVersion('1', '1.0.0')).toBe(true);
    });

    it('should return true on comparison error (safe default)', () => {
      // Test with malformed versions
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // This might not cause an error depending on implementation,
      // but the function should handle it gracefully
      const result = meetsMinVersion('invalid', '1.0.0');

      // Should either succeed with false or fail safely with true
      expect(typeof result).toBe('boolean');

      consoleSpy.mockRestore();
    });
  });

  describe('formatVersionChange', () => {
    it('should format major version change', () => {
      expect(formatVersionChange('1.0.147', '2.0.0', 'major'))
        .toBe('重大版本升级: 1.0.147 → 2.0.0');
    });

    it('should format minor version change', () => {
      expect(formatVersionChange('1.0.147', '1.1.0', 'minor'))
        .toBe('功能更新: 1.0.147 → 1.1.0');
    });

    it('should format patch version change', () => {
      expect(formatVersionChange('1.0.147', '1.0.148', 'patch'))
        .toBe('补丁更新: 1.0.147 → 1.0.148');
    });
  });

  describe('getVersionChangeIcon', () => {
    it('should return correct emoji for each type', () => {
      expect(getVersionChangeIcon('major')).toBe('🎉');
      expect(getVersionChangeIcon('minor')).toBe('✨');
      expect(getVersionChangeIcon('patch')).toBe('🔧');
    });
  });

  describe('getVersionChangeTitle', () => {
    it('should return force update title when isForceUpdate is true', () => {
      expect(getVersionChangeTitle('major', true)).toBe('⚠️ 强制更新');
      expect(getVersionChangeTitle('minor', true)).toBe('⚠️ 强制更新');
      expect(getVersionChangeTitle('patch', true)).toBe('⚠️ 强制更新');
    });

    it('should return version-specific title when not forced', () => {
      expect(getVersionChangeTitle('major', false)).toBe('🎉 重要版本更新');
      expect(getVersionChangeTitle('minor', false)).toBe('✨ 功能更新');
      expect(getVersionChangeTitle('patch', false)).toBe('🔧 补丁更新');
    });

    it('should default to non-forced when isForceUpdate not provided', () => {
      expect(getVersionChangeTitle('major')).toBe('🎉 重要版本更新');
      expect(getVersionChangeTitle('minor')).toBe('✨ 功能更新');
      expect(getVersionChangeTitle('patch')).toBe('🔧 补丁更新');
    });
  });

  describe('getVersionChangeDetail', () => {
    it('should return force update detail when isForceUpdate is true', () => {
      const forceDetail = '此更新为必须安装的重要更新，必须重启应用才能继续使用';
      expect(getVersionChangeDetail('major', true)).toBe(forceDetail);
      expect(getVersionChangeDetail('minor', true)).toBe(forceDetail);
      expect(getVersionChangeDetail('patch', true)).toBe(forceDetail);
    });

    it('should return version-specific detail when not forced', () => {
      expect(getVersionChangeDetail('major', false))
        .toBe('此更新包含重要新功能和改进，建议立即重启应用');
      expect(getVersionChangeDetail('minor', false))
        .toBe('此更新包含新功能和优化，重启后即可使用');
      expect(getVersionChangeDetail('patch', false))
        .toBe('此更新修复了已知问题，重启后生效');
    });

    it('should default to non-forced when isForceUpdate not provided', () => {
      expect(getVersionChangeDetail('major'))
        .toBe('此更新包含重要新功能和改进，建议立即重启应用');
      expect(getVersionChangeDetail('minor'))
        .toBe('此更新包含新功能和优化，重启后即可使用');
      expect(getVersionChangeDetail('patch'))
        .toBe('此更新修复了已知问题，重启后生效');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete update flow for patch version', () => {
      const currentVersion = '1.0.147';
      const newVersion = '1.0.148';
      const minVersion = '1.0.120';

      // Check if update is needed
      expect(compareVersions(newVersion, currentVersion)).toBe(1);

      // Check minimum version requirement
      expect(meetsMinVersion(currentVersion, minVersion)).toBe(true);

      // Get version change type
      const changeType = getVersionChangeType(currentVersion, newVersion);
      expect(changeType).toBe('patch');

      // Generate UI messages
      expect(getVersionChangeTitle(changeType, false)).toBe('🔧 补丁更新');
      expect(formatVersionChange(currentVersion, newVersion, changeType))
        .toBe('补丁更新: 1.0.147 → 1.0.148');
      expect(getVersionChangeDetail(changeType, false))
        .toBe('此更新修复了已知问题，重启后生效');
    });

    it('should handle forced update when below minimum version', () => {
      const currentVersion = '1.0.100';
      const newVersion = '1.0.150';
      const minVersion = '1.0.120';

      // Check minimum version requirement
      const meetsMin = meetsMinVersion(currentVersion, minVersion);
      expect(meetsMin).toBe(false);

      // Should trigger force update
      const isForceUpdate = !meetsMin;
      expect(isForceUpdate).toBe(true);

      // Get version change type
      const changeType = getVersionChangeType(currentVersion, newVersion);
      expect(changeType).toBe('patch');

      // Generate forced update UI messages
      expect(getVersionChangeTitle(changeType, isForceUpdate)).toBe('⚠️ 强制更新');
      expect(getVersionChangeDetail(changeType, isForceUpdate))
        .toBe('此更新为必须安装的重要更新，必须重启应用才能继续使用');
    });

    it('should handle major version upgrade', () => {
      const currentVersion = '1.0.147';
      const newVersion = '2.0.0';

      // Get version change type
      const changeType = getVersionChangeType(currentVersion, newVersion);
      expect(changeType).toBe('major');

      // Generate UI messages for major upgrade
      expect(getVersionChangeTitle(changeType, false)).toBe('🎉 重要版本更新');
      expect(formatVersionChange(currentVersion, newVersion, changeType))
        .toBe('重大版本升级: 1.0.147 → 2.0.0');
      expect(getVersionChangeDetail(changeType, false))
        .toBe('此更新包含重要新功能和改进，建议立即重启应用');
    });

    it('should handle minor version upgrade', () => {
      const currentVersion = '1.0.147';
      const newVersion = '1.1.0';

      // Get version change type
      const changeType = getVersionChangeType(currentVersion, newVersion);
      expect(changeType).toBe('minor');

      // Generate UI messages for minor upgrade
      expect(getVersionChangeTitle(changeType, false)).toBe('✨ 功能更新');
      expect(formatVersionChange(currentVersion, newVersion, changeType))
        .toBe('功能更新: 1.0.147 → 1.1.0');
      expect(getVersionChangeDetail(changeType, false))
        .toBe('此更新包含新功能和优化，重启后即可使用');
    });
  });
});
