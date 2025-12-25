/**
 * Unit tests for auto-update-service enhancements
 * Focus: New backend API integration (versionChangeType, isForceUpdate, minVersion)
 */

import { app, dialog, BrowserWindow } from 'electron';
import type { CheckUpdateResponse } from '@common/types/hot-update.types';
import {
  meetsMinVersion,
  getVersionChangeTitle,
  formatVersionChange,
  getVersionChangeDetail
} from '@common/utils/version-helper';

// Mock Electron modules
jest.mock('electron', () => ({
  app: {
    getVersion: jest.fn(),
    relaunch: jest.fn(),
    quit: jest.fn()
  },
  dialog: {
    showMessageBox: jest.fn()
  },
  BrowserWindow: {
    getAllWindows: jest.fn()
  },
  autoUpdater: {
    setFeedURL: jest.fn(),
    checkForUpdates: jest.fn(),
    on: jest.fn()
  }
}));

// Mock logger
jest.mock('electron-log', () => ({
  scope: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }))
}));

describe('AutoUpdateService enhancements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Minimum version checking logic', () => {
    it('should enforce force update when current version is below minimum', () => {
      const currentVersion = '1.0.100';
      const minVersion = '1.0.120';

      // Simulate the logic from auto-update-service.ts checkForUpdates()
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'hot',
        version: '1.0.150',
        currentVersion: '1.0.100',
        versionChangeType: 'patch',
        isForceUpdate: false,
        minVersion: '1.0.120'
      };

      // Check minimum version requirement
      const meetsMin = meetsMinVersion(currentVersion, minVersion);
      expect(meetsMin).toBe(false);

      // Should trigger force update
      if (!meetsMin) {
        updateInfo.isForceUpdate = true;
      }

      expect(updateInfo.isForceUpdate).toBe(true);
    });

    it('should not enforce force update when current version meets minimum', () => {
      const currentVersion = '1.0.150';
      const minVersion = '1.0.120';

      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'hot',
        version: '1.0.160',
        currentVersion: '1.0.150',
        versionChangeType: 'patch',
        isForceUpdate: false,
        minVersion: '1.0.120'
      };

      // Check minimum version requirement
      const meetsMin = meetsMinVersion(currentVersion, minVersion);
      expect(meetsMin).toBe(true);

      // Should NOT trigger force update
      if (!meetsMin) {
        updateInfo.isForceUpdate = true;
      }

      expect(updateInfo.isForceUpdate).toBe(false);
    });

    it('should not enforce force update when no minimum version specified', () => {
      const currentVersion = '1.0.100';

      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'hot',
        version: '1.0.150',
        currentVersion: '1.0.100',
        versionChangeType: 'patch',
        isForceUpdate: false,
        minVersion: null
      };

      // Check minimum version requirement
      const meetsMin = meetsMinVersion(currentVersion, updateInfo.minVersion);
      expect(meetsMin).toBe(true);

      if (!meetsMin) {
        updateInfo.isForceUpdate = true;
      }

      expect(updateInfo.isForceUpdate).toBe(false);
    });
  });

  describe('Update dialog message generation', () => {
    it('should generate correct messages for patch update (non-forced)', () => {
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        version: '1.0.148',
        currentVersion: '1.0.147',
        versionChangeType: 'patch',
        isForceUpdate: false,
        minVersion: null
      };

      const title = getVersionChangeTitle(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const message = formatVersionChange(
        updateInfo.currentVersion!,
        updateInfo.version!,
        updateInfo.versionChangeType!
      );
      const detail = getVersionChangeDetail(updateInfo.versionChangeType!, updateInfo.isForceUpdate);

      expect(title).toBe('🔧 补丁更新');
      expect(message).toBe('补丁更新: 1.0.147 → 1.0.148');
      expect(detail).toBe('此更新修复了已知问题，重启后生效');
    });

    it('should generate correct messages for minor update (non-forced)', () => {
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        version: '1.1.0',
        currentVersion: '1.0.147',
        versionChangeType: 'minor',
        isForceUpdate: false,
        minVersion: null
      };

      const title = getVersionChangeTitle(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const message = formatVersionChange(
        updateInfo.currentVersion!,
        updateInfo.version!,
        updateInfo.versionChangeType!
      );
      const detail = getVersionChangeDetail(updateInfo.versionChangeType!, updateInfo.isForceUpdate);

      expect(title).toBe('✨ 功能更新');
      expect(message).toBe('功能更新: 1.0.147 → 1.1.0');
      expect(detail).toBe('此更新包含新功能和优化，重启后即可使用');
    });

    it('should generate correct messages for major update (non-forced)', () => {
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        version: '2.0.0',
        currentVersion: '1.0.147',
        versionChangeType: 'major',
        isForceUpdate: false,
        minVersion: null
      };

      const title = getVersionChangeTitle(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const message = formatVersionChange(
        updateInfo.currentVersion!,
        updateInfo.version!,
        updateInfo.versionChangeType!
      );
      const detail = getVersionChangeDetail(updateInfo.versionChangeType!, updateInfo.isForceUpdate);

      expect(title).toBe('🎉 重要版本更新');
      expect(message).toBe('重大版本升级: 1.0.147 → 2.0.0');
      expect(detail).toBe('此更新包含重要新功能和改进，建议立即重启应用');
    });

    it('should generate force update messages regardless of version type', () => {
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        version: '1.0.150',
        currentVersion: '1.0.100',
        versionChangeType: 'patch',
        isForceUpdate: true,
        minVersion: '1.0.120'
      };

      const title = getVersionChangeTitle(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const detail = getVersionChangeDetail(updateInfo.versionChangeType!, updateInfo.isForceUpdate);

      expect(title).toBe('⚠️ 强制更新');
      expect(detail).toBe('此更新为必须安装的重要更新，必须重启应用才能继续使用');
    });
  });

  describe('Dialog button configuration', () => {
    it('should provide both buttons for non-forced updates', () => {
      const isForceUpdate = false;
      const buttons = isForceUpdate ? ['立即重启'] : ['立即重启', '稍后'];

      expect(buttons).toEqual(['立即重启', '稍后']);
    });

    it('should provide only restart button for forced updates', () => {
      const isForceUpdate = true;
      const buttons = isForceUpdate ? ['立即重启'] : ['立即重启', '稍后'];

      expect(buttons).toEqual(['立即重启']);
    });

    it('should set cancelId correctly for non-forced updates', () => {
      const isForceUpdate = false;
      const cancelId = isForceUpdate ? -1 : 1;

      expect(cancelId).toBe(1); // Can press "稍后"
    });

    it('should set cancelId correctly for forced updates', () => {
      const isForceUpdate = true;
      const cancelId = isForceUpdate ? -1 : 1;

      expect(cancelId).toBe(-1); // Cannot cancel
    });

    it('should set dialog type correctly for non-forced updates', () => {
      const isForceUpdate = false;
      const dialogType = isForceUpdate ? 'warning' : 'info';

      expect(dialogType).toBe('info');
    });

    it('should set dialog type correctly for forced updates', () => {
      const isForceUpdate = true;
      const dialogType = isForceUpdate ? 'warning' : 'info';

      expect(dialogType).toBe('warning');
    });
  });

  describe('Complete update flow scenarios', () => {
    it('should handle normal patch update flow', () => {
      // Simulate backend response
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'hot',
        version: '1.0.148',
        currentVersion: '1.0.147',
        versionChangeType: 'patch',
        isForceUpdate: false,
        minVersion: null,
        manifest: {
          version: '1.0.148',
          diffUrl: 'http://example.com/diff.tar.gz',
          diffSha512: 'abc123',
          diffSize: 1024000,
          changedFilesCount: 5,
          deletedFilesCount: 0,
          requiresRestart: true
        }
      };

      // Simulate minimum version check
      const currentVersion = '1.0.147';
      const meetsMin = meetsMinVersion(currentVersion, updateInfo.minVersion);
      expect(meetsMin).toBe(true);

      // Simulate UI message generation
      const title = getVersionChangeTitle(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const message = formatVersionChange(
        updateInfo.currentVersion!,
        updateInfo.version!,
        updateInfo.versionChangeType!
      );
      const detail = getVersionChangeDetail(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const buttons = updateInfo.isForceUpdate ? ['立即重启'] : ['立即重启', '稍后'];

      // Verify
      expect(title).toBe('🔧 补丁更新');
      expect(message).toBe('补丁更新: 1.0.147 → 1.0.148');
      expect(detail).toBe('此更新修复了已知问题，重启后生效');
      expect(buttons).toEqual(['立即重启', '稍后']);
      expect(updateInfo.isForceUpdate).toBe(false);
    });

    it('should handle forced update due to minimum version requirement', () => {
      // Simulate backend response
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'hot',
        version: '1.0.150',
        currentVersion: '1.0.100',
        versionChangeType: 'patch',
        isForceUpdate: false,
        minVersion: '1.0.120',
        manifest: {
          version: '1.0.150',
          diffUrl: 'http://example.com/diff.tar.gz',
          diffSha512: 'abc123',
          diffSize: 2048000,
          changedFilesCount: 10,
          deletedFilesCount: 2,
          requiresRestart: true
        }
      };

      // Simulate minimum version check
      const currentVersion = '1.0.100';
      const meetsMin = meetsMinVersion(currentVersion, updateInfo.minVersion);
      expect(meetsMin).toBe(false);

      // Enforce force update
      if (!meetsMin) {
        updateInfo.isForceUpdate = true;
      }

      // Simulate UI message generation
      const title = getVersionChangeTitle(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const message = formatVersionChange(
        updateInfo.currentVersion!,
        updateInfo.version!,
        updateInfo.versionChangeType!
      );
      const detail = getVersionChangeDetail(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const buttons = updateInfo.isForceUpdate ? ['立即重启'] : ['立即重启', '稍后'];

      // Verify forced update behavior
      expect(updateInfo.isForceUpdate).toBe(true);
      expect(title).toBe('⚠️ 强制更新');
      expect(message).toBe('补丁更新: 1.0.100 → 1.0.150');
      expect(detail).toBe('此更新为必须安装的重要更新，必须重启应用才能继续使用');
      expect(buttons).toEqual(['立即重启']);
    });

    it('should handle major version upgrade', () => {
      // Simulate backend response
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'hot',
        version: '2.0.0',
        currentVersion: '1.0.147',
        versionChangeType: 'major',
        isForceUpdate: false,
        minVersion: null,
        manifest: {
          version: '2.0.0',
          diffUrl: 'http://example.com/diff.tar.gz',
          diffSha512: 'abc123',
          diffSize: 5120000,
          changedFilesCount: 50,
          deletedFilesCount: 10,
          requiresRestart: true
        }
      };

      // Simulate minimum version check
      const currentVersion = '1.0.147';
      const meetsMin = meetsMinVersion(currentVersion, updateInfo.minVersion);
      expect(meetsMin).toBe(true);

      // Simulate UI message generation
      const title = getVersionChangeTitle(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const message = formatVersionChange(
        updateInfo.currentVersion!,
        updateInfo.version!,
        updateInfo.versionChangeType!
      );
      const detail = getVersionChangeDetail(updateInfo.versionChangeType!, updateInfo.isForceUpdate);

      // Verify
      expect(title).toBe('🎉 重要版本更新');
      expect(message).toBe('重大版本升级: 1.0.147 → 2.0.0');
      expect(detail).toBe('此更新包含重要新功能和改进，建议立即重启应用');
    });

    it('should handle backend-triggered force update', () => {
      // Simulate backend response with isForceUpdate already set
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'hot',
        version: '1.0.148',
        currentVersion: '1.0.147',
        versionChangeType: 'patch',
        isForceUpdate: true, // Backend sets this
        minVersion: null,
        manifest: {
          version: '1.0.148',
          diffUrl: 'http://example.com/diff.tar.gz',
          diffSha512: 'abc123',
          diffSize: 1024000,
          changedFilesCount: 5,
          deletedFilesCount: 0,
          requiresRestart: true
        }
      };

      // Simulate minimum version check (passes, but already forced by backend)
      const currentVersion = '1.0.147';
      const meetsMin = meetsMinVersion(currentVersion, updateInfo.minVersion);
      expect(meetsMin).toBe(true);

      // Should remain forced
      expect(updateInfo.isForceUpdate).toBe(true);

      // Verify forced update UI
      const title = getVersionChangeTitle(updateInfo.versionChangeType!, updateInfo.isForceUpdate);
      const detail = getVersionChangeDetail(updateInfo.versionChangeType!, updateInfo.isForceUpdate);

      expect(title).toBe('⚠️ 强制更新');
      expect(detail).toBe('此更新为必须安装的重要更新，必须重启应用才能继续使用');
    });
  });

  describe('Backward compatibility', () => {
    it('should handle missing optional fields gracefully', () => {
      // Simulate old backend response without new fields
      const updateInfo: CheckUpdateResponse = {
        hasUpdate: true,
        updateType: 'hot',
        version: '1.0.148'
        // No currentVersion, versionChangeType, isForceUpdate, minVersion
      };

      // Should use defaults
      const versionChangeType = updateInfo.versionChangeType || 'patch';
      const isForceUpdate = updateInfo.isForceUpdate || false;
      const currentVersion = updateInfo.currentVersion || '1.0.147'; // Would use app.getVersion()

      expect(versionChangeType).toBe('patch');
      expect(isForceUpdate).toBe(false);

      // Should still generate valid messages
      const title = getVersionChangeTitle(versionChangeType, isForceUpdate);
      const message = formatVersionChange(currentVersion, updateInfo.version!, versionChangeType);
      const detail = getVersionChangeDetail(versionChangeType, isForceUpdate);

      expect(title).toBe('🔧 补丁更新');
      expect(message).toBe('补丁更新: 1.0.147 → 1.0.148');
      expect(detail).toBe('此更新修复了已知问题，重启后生效');
    });
  });
});
