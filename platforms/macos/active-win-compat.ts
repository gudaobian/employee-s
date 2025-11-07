/**
 * Active Window Compatibility Layer for macOS
 *
 * Uses NSWorkspace API to obtain accurate frontmost application information,
 * avoiding AppleScript's unreliable `frontmost` property that may return "Electron".
 *
 * @module active-win-compat
 * @platform macOS 10.15+
 * @requires Accessibility Permission (for window title extraction)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '@common/utils/logger';

const execAsync = promisify(exec);
const JXA_TIMEOUT = 2000; // 2 seconds timeout
const EXCLUDED_APPS = ['EmployeeMonitor', 'Electron', 'employee-monitor'];

/**
 * Represents information about an active window
 */
export interface ActiveWindowResult {
  /** Window/Process ID */
  id: number;

  /** Window title (may be empty if Accessibility permission not granted) */
  title: string;

  /** Owner application information */
  owner: {
    /** Application name (e.g., "Google Chrome") */
    name: string;

    /** Process ID */
    processId: number;

    /** Bundle identifier (e.g., "com.google.Chrome") */
    bundleId: string;
  };

  /** Window bounds (currently not implemented, returns zeros) */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Internal result type from JXA script
 */
interface JXAResult {
  appName?: string;
  pid?: number;
  bundleID?: string;
  windowTitle?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  error?: string;
}

/**
 * Generates the JXA (JavaScript for Automation) script for querying NSWorkspace.
 *
 * This script:
 * 1. Imports AppKit and Foundation frameworks
 * 2. Calls NSWorkspace.sharedWorkspace.frontmostApplication
 * 3. Retrieves app name, process ID, and bundle ID
 * 4. Uses System Events to get window title (requires Accessibility permission)
 * 5. Excludes self-application (EmployeeMonitor, Electron)
 * 6. Returns JSON-formatted result
 *
 * @returns JXA script as a string
 */
function getJXAScript(): string {
  return `
    ObjC.import('AppKit');
    ObjC.import('Foundation');

    try {
      var workspace = $.NSWorkspace.sharedWorkspace;
      var activeApp = workspace.frontmostApplication;

      if (!activeApp) {
        JSON.stringify({ error: 'No frontmost application' });
      } else {
        var appName = ObjC.unwrap(activeApp.localizedName);
        var appPID = activeApp.processIdentifier;
        var bundleID = ObjC.unwrap(activeApp.bundleIdentifier);

        // Exclude self-application
        var excludedApps = ${JSON.stringify(EXCLUDED_APPS)};
        var isExcluded = excludedApps.some(function(excluded) {
          return appName.toLowerCase().indexOf(excluded.toLowerCase()) !== -1;
        });

        if (isExcluded) {
          JSON.stringify({ error: 'Self-application detected: ' + appName });
        } else {
          // Try to get window title using System Events (requires Accessibility permission)
          var windowTitle = '';
          try {
            var systemEvents = Application('System Events');
            systemEvents.includeStandardAdditions = true;
            var process = systemEvents.processes.whose({ bundleIdentifier: bundleID })[0];
            if (process && process.windows.length > 0) {
              windowTitle = process.windows[0].name();
            }
          } catch (e) {
            // Failed to get window title (likely no Accessibility permission)
            // This is not a critical error, continue without title
          }

          JSON.stringify({
            appName: appName,
            pid: appPID,
            bundleID: bundleID,
            windowTitle: windowTitle,
            bounds: { x: 0, y: 0, width: 0, height: 0 }
          });
        }
      }
    } catch (e) {
      JSON.stringify({ error: 'JXA execution error: ' + e.message });
    }
  `.trim();
}

/**
 * Retrieves information about the currently active (frontmost) window.
 *
 * This is the main entry point for the module. It executes a JXA script
 * via osascript to query NSWorkspace for accurate frontmost application information.
 *
 * Performance:
 * - P50: < 50ms
 * - P95: < 100ms
 * - P99: < 200ms
 * - Timeout: 2000ms
 *
 * Success Rate: ≥ 95% (with proper permissions)
 *
 * @returns Promise resolving to ActiveWindowResult or null
 *          - Returns null if: timeout, error, self-application, or no frontmost app
 *          - Returns ActiveWindowResult with populated fields on success
 *
 * @example
 * ```typescript
 * const window = await activeWindow();
 * if (window) {
 *   console.log(`Active app: ${window.owner.name}`);
 *   console.log(`Window title: ${window.title}`);
 * }
 * ```
 */
export async function activeWindow(): Promise<ActiveWindowResult | null> {
  const startTime = Date.now();

  try {
    const script = getJXAScript();

    // Escape single quotes for shell execution
    const escapedScript = script.replace(/'/g, "'\\''");

    logger.debug('[active-win-compat] Executing JXA script...');

    const { stdout } = await execAsync(
      `osascript -l JavaScript -e '${escapedScript}'`,
      {
        timeout: JXA_TIMEOUT,
        maxBuffer: 1024 * 1024 // 1MB buffer
      }
    );

    const elapsed = Date.now() - startTime;

    // Parse JSON result
    const result: JXAResult = JSON.parse(stdout.trim());

    if (result.error) {
      logger.debug(`[active-win-compat] JXA error (${elapsed}ms):`, result.error);
      return null;
    }

    // Validate required fields
    if (!result.appName || !result.pid || !result.bundleID) {
      logger.debug(`[active-win-compat] Incomplete result (${elapsed}ms):`, result);
      return null;
    }

    const windowInfo: ActiveWindowResult = {
      id: result.pid,
      title: result.windowTitle || '',
      owner: {
        name: result.appName,
        processId: result.pid,
        bundleId: result.bundleID
      },
      bounds: result.bounds || { x: 0, y: 0, width: 0, height: 0 }
    };

    logger.debug(`[active-win-compat] Got window (${elapsed}ms):`, {
      app: windowInfo.owner.name,
      pid: windowInfo.owner.processId,
      title: windowInfo.title ? `"${windowInfo.title}"` : '(no title)'
    });

    return windowInfo;

  } catch (error: any) {
    const elapsed = Date.now() - startTime;

    if (error.killed || error.signal === 'SIGTERM') {
      logger.debug(`[active-win-compat] Timeout (${elapsed}ms)`);
    } else if (error.code === 'ENOENT') {
      logger.warn('[active-win-compat] osascript not found (not macOS?)');
    } else {
      logger.debug(`[active-win-compat] Error (${elapsed}ms):`, error.message);
    }

    return null;
  }
}

/**
 * Checks if the active-win-compat module is available and working.
 *
 * This function attempts to call activeWindow() and verifies that it returns
 * a valid result. Useful for health checks and diagnostics.
 *
 * @returns Promise resolving to true if module is available, false otherwise
 *
 * @example
 * ```typescript
 * if (await isAvailable()) {
 *   console.log('active-win-compat is ready');
 * } else {
 *   console.log('falling back to AppleScript');
 * }
 * ```
 */
export async function isAvailable(): Promise<boolean> {
  try {
    // Quick availability check - just try to get window info
    const window = await activeWindow();
    return window !== null;
  } catch {
    return false;
  }
}

/**
 * Module version
 */
export const VERSION = '1.0.0';

/**
 * Supported platform
 */
export const PLATFORM = 'darwin';

/**
 * Minimum macOS version required
 */
export const MIN_OS_VERSION = '10.15';
