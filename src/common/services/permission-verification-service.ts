/**
 * Permission Verification Service
 *
 * CRITICAL: Verifies macOS permissions after updates to ensure they are preserved
 * Checks:
 * - Accessibility permission
 * - Screen Recording permission
 * - Bundle ID correctness (must be com.company.employee-safety)
 */

import { app, systemPreferences, desktopCapturer } from 'electron';
import { updateLogger } from '@common/utils/update-logger';

export interface PermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
  allGranted: boolean;
  bundleIdCorrect: boolean;
  issues: string[];
}

const EXPECTED_BUNDLE_ID = 'com.company.employee-safety';

export class PermissionVerificationService {
  /**
   * Verify all permissions after update
   */
  async verifyPermissionsAfterUpdate(): Promise<PermissionStatus> {
    updateLogger.info('Verifying permissions after update...');

    const status: PermissionStatus = {
      accessibility: false,
      screenRecording: false,
      allGranted: false,
      bundleIdCorrect: false,
      issues: []
    };

    if (process.platform !== 'darwin') {
      // Permission verification only applies to macOS
      status.accessibility = true;
      status.screenRecording = true;
      status.bundleIdCorrect = true;
      status.allGranted = true;
      updateLogger.info('Permission verification skipped (not macOS)');
      return status;
    }

    // Check Bundle ID first - most critical
    status.bundleIdCorrect = await this.verifyBundleId();
    if (!status.bundleIdCorrect) {
      status.issues.push('Bundle ID mismatch - permissions may be lost');
    }

    // Check Accessibility permission
    status.accessibility = this.checkAccessibilityPermission();
    if (!status.accessibility) {
      status.issues.push('Accessibility permission not granted');
    }

    // Check Screen Recording permission
    status.screenRecording = await this.checkScreenRecordingPermission();
    if (!status.screenRecording) {
      status.issues.push('Screen Recording permission not granted');
    }

    status.allGranted =
      status.accessibility && status.screenRecording && status.bundleIdCorrect;

    if (status.allGranted) {
      updateLogger.info('✅ All permissions verified successfully');
    } else {
      updateLogger.error('❌ Permission verification failed', {
        accessibility: status.accessibility,
        screenRecording: status.screenRecording,
        bundleIdCorrect: status.bundleIdCorrect,
        issues: status.issues
      });
    }

    return status;
  }

  /**
   * Check accessibility permission
   */
  private checkAccessibilityPermission(): boolean {
    try {
      const hasPermission = systemPreferences.isTrustedAccessibilityClient(false);
      updateLogger.debug('Accessibility permission check', { hasPermission });
      return hasPermission;
    } catch (error: any) {
      updateLogger.error('Failed to check accessibility permission', error);
      return false;
    }
  }

  /**
   * Check screen recording permission
   */
  private async checkScreenRecordingPermission(): Promise<boolean> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 }
      });

      const hasPermission = sources.length > 0;
      updateLogger.debug('Screen recording permission check', { hasPermission });
      return hasPermission;
    } catch (error: any) {
      updateLogger.error('Failed to check screen recording permission', error);
      return false;
    }
  }

  /**
   * Verify Bundle ID
   * CRITICAL: This must match EXPECTED_BUNDLE_ID to preserve permissions
   */
  private async verifyBundleId(): Promise<boolean> {
    try {
      // Get the app name which contains the bundle ID
      const appName = app.getName();
      const bundleId = app.isPackaged ? this.extractBundleId() : EXPECTED_BUNDLE_ID;

      updateLogger.info('Bundle ID verification', {
        expected: EXPECTED_BUNDLE_ID,
        actual: bundleId,
        appName: appName
      });

      const isCorrect = bundleId === EXPECTED_BUNDLE_ID;

      if (!isCorrect) {
        updateLogger.error('CRITICAL: Bundle ID mismatch!', {
          expected: EXPECTED_BUNDLE_ID,
          actual: bundleId,
          impact: 'Permissions will be lost'
        });
      }

      return isCorrect;
    } catch (error: any) {
      updateLogger.error('Failed to verify Bundle ID', error);
      return false;
    }
  }

  /**
   * Extract Bundle ID from app path (macOS only)
   */
  private extractBundleId(): string {
    try {
      const plist = require('plist');
      const fs = require('fs');
      const path = require('path');

      // Get the app bundle path
      const appPath = app.getAppPath();
      const bundlePath = appPath.includes('.app')
        ? appPath.split('.app')[0] + '.app'
        : appPath;

      const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');

      if (fs.existsSync(plistPath)) {
        const plistContent = plist.parse(fs.readFileSync(plistPath, 'utf8'));
        return plistContent.CFBundleIdentifier || '';
      }

      return '';
    } catch (error: any) {
      updateLogger.error('Failed to extract Bundle ID from plist', error);
      return '';
    }
  }

  /**
   * Get permission recovery guidance
   */
  getPermissionRecoveryGuidance(status: PermissionStatus): string {
    if (status.allGranted) {
      return 'All permissions are granted.';
    }

    const guidance: string[] = ['Please grant the following permissions:'];

    if (!status.accessibility) {
      guidance.push(
        '\n1. Accessibility Permission:',
        '   - Open System Preferences > Security & Privacy > Privacy > Accessibility',
        '   - Find "EmployeeSafety" in the list',
        '   - Check the box to enable it'
      );
    }

    if (!status.screenRecording) {
      guidance.push(
        '\n2. Screen Recording Permission:',
        '   - Open System Preferences > Security & Privacy > Privacy > Screen Recording',
        '   - Find "EmployeeSafety" in the list',
        '   - Check the box to enable it'
      );
    }

    if (!status.bundleIdCorrect) {
      guidance.push(
        '\n3. CRITICAL - Bundle ID Issue:',
        '   - Contact technical support immediately',
        `   - Expected Bundle ID: ${EXPECTED_BUNDLE_ID}`,
        '   - This may require reinstalling the application'
      );
    }

    guidance.push('\nAfter granting permissions, please restart the application.');

    return guidance.join('\n');
  }

  /**
   * Request permissions (will open System Preferences)
   */
  async requestPermissions(): Promise<void> {
    updateLogger.info('Requesting permissions...');

    if (process.platform !== 'darwin') {
      updateLogger.info('Permission request skipped (not macOS)');
      return;
    }

    try {
      // Request accessibility permission (will prompt user if not granted)
      systemPreferences.isTrustedAccessibilityClient(true);

      // For screen recording, we can only check, not request
      // The first call to desktopCapturer will trigger the system prompt
      await this.checkScreenRecordingPermission();

      updateLogger.info('Permission request completed');
    } catch (error: any) {
      updateLogger.error('Failed to request permissions', error);
      throw error;
    }
  }
}
