/**
 * Windows Native Event Adapter (JavaScript version)
 * Wrapper for the native C++ event monitor module
 * This file is used in production builds (TypeScript sources are excluded from packaging)
 */

const path = require('path');
const fs = require('fs');

class WindowsNativeEventAdapter {
  constructor() {
    this.nativeModule = null;
    this.nativeModuleRef = null;

    try {
      // Load the native module with proper path resolution for both dev and production
      let modulePath;

      // Check if running in Electron packaged app
      if (process.resourcesPath) {
        // Production: Electron packaged app
        // Native modules are in app.asar.unpacked
        modulePath = path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'native-event-monitor-win',
          'build',
          'Release',
          'event_monitor.node'
        );

        console.log('[NativeEventAdapter] Production mode, loading from:', modulePath);
        console.log('[NativeEventAdapter] File exists:', fs.existsSync(modulePath));

        if (!fs.existsSync(modulePath)) {
          // Try alternative path without app.asar.unpacked prefix
          const altPath = path.join(
            path.dirname(process.resourcesPath),
            'app.asar.unpacked',
            'native-event-monitor-win',
            'build',
            'Release',
            'event_monitor.node'
          );
          console.log('[NativeEventAdapter] Trying alternative path:', altPath);
          console.log('[NativeEventAdapter] Alternative exists:', fs.existsSync(altPath));

          if (fs.existsSync(altPath)) {
            modulePath = altPath;
          } else {
            throw new Error(`Native module not found at: ${modulePath} or ${altPath}`);
          }
        }
      } else {
        // Development: Use the native module loader from index.js
        // which handles both local build and precompiled modules
        console.log('[NativeEventAdapter] Development mode, loading via index.js');
        const nativeModule = require('./index.js');
        if (nativeModule && typeof nativeModule.start === 'function') {
          this.nativeModule = nativeModule;
          this.nativeModuleRef = nativeModule;
          console.log('[NativeEventAdapter] ✅ Native module loaded via index.js (development mode)');
          return;
        } else {
          throw new Error('index.js did not return a valid native module');
        }
      }

      console.log('[NativeEventAdapter] Requiring native module...');
      this.nativeModule = require(modulePath);
      this.nativeModuleRef = this.nativeModule;
      console.log('[NativeEventAdapter] ✅ Native module loaded successfully');
    } catch (error) {
      console.error('[NativeEventAdapter] ❌ Failed to load native module:', error);
      console.error('[NativeEventAdapter] Error stack:', error.stack);
      console.error('[NativeEventAdapter] process.resourcesPath:', process.resourcesPath);
      console.error('[NativeEventAdapter] __dirname:', __dirname);
      throw new Error('Native event monitor module not available');
    }
  }

  /**
   * Check if the native module is available
   */
  isAvailable() {
    return this.nativeModule !== null && typeof this.nativeModule.start === 'function';
  }

  /**
   * Get hardware ID
   */
  getHardwareId() {
    try {
      if (this.nativeModule && this.nativeModule.getHardwareId) {
        return this.nativeModule.getHardwareId();
      }
      throw new Error('getHardwareId not available');
    } catch (error) {
      console.error('Failed to get hardware ID:', error);
      throw error;
    }
  }

  /**
   * Get active window information
   */
  getActiveWindow() {
    try {
      if (this.nativeModule && this.nativeModule.getActiveWindow) {
        return this.nativeModule.getActiveWindow();
      }
      return { title: '', processName: '' };
    } catch (error) {
      console.error('Failed to get active window:', error);
      return { title: '', processName: '' };
    }
  }

  /**
   * Get idle time in seconds
   */
  getIdleTime() {
    try {
      if (this.nativeModule && this.nativeModule.getIdleTime) {
        return this.nativeModule.getIdleTime();
      }
      return 0;
    } catch (error) {
      console.error('Failed to get idle time:', error);
      return 0;
    }
  }

  /**
   * Start monitoring events
   */
  async startMonitoring() {
    try {
      if (this.nativeModule && this.nativeModule.start) {
        console.log('[NativeEventAdapter] Calling native start()...');
        this.nativeModule.start();

        // Verify hooks were installed successfully
        const counts = this.nativeModule.getCounts ? this.nativeModule.getCounts() : null;
        if (counts) {
          console.log('[NativeEventAdapter] Hook status:', {
            keyboardHook: counts.keyboardHookInstalled ? '✅' : '❌',
            mouseHook: counts.mouseHookInstalled ? '✅' : '❌',
            isMonitoring: counts.isMonitoring
          });

          if (!counts.keyboardHookInstalled || !counts.mouseHookInstalled) {
            console.error('[NativeEventAdapter] ⚠️ Hook 安装失败 - 可能需要管理员权限');
            console.error('[NativeEventAdapter] 解决方案: 请右键以管理员身份运行应用程序');
            return false;
          }
        }

        console.log('[NativeEventAdapter] ✅ Native monitoring started successfully');
        return true;
      }
      console.warn('[NativeEventAdapter] start method not available');
      return false;
    } catch (error) {
      console.error('[NativeEventAdapter] ❌ Failed to start monitoring:', error);
      console.error('[NativeEventAdapter] 错误详情:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error('[NativeEventAdapter] 堆栈跟踪:', error.stack);
      }
      return false;
    }
  }

  /**
   * Stop monitoring events
   */
  async stopMonitoring() {
    try {
      if (this.nativeModule && this.nativeModule.stop) {
        this.nativeModule.stop();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to stop monitoring:', error);
      return false;
    }
  }

  /**
   * Get event counts
   */
  getEventCounts() {
    try {
      if (this.nativeModule && this.nativeModule.getCounts) {
        return this.nativeModule.getCounts();
      }
      return { keyboard: 0, mouseClicks: 0, idleTime: 0, isMonitoring: false };
    } catch (error) {
      console.error('Failed to get event counts:', error);
      return { keyboard: 0, mouseClicks: 0, idleTime: 0, isMonitoring: false };
    }
  }

  /**
   * Get detailed status (compatibility method)
   */
  async getDetailedStatus() {
    const counts = this.getEventCounts();
    return {
      isMonitoring: counts.isMonitoring || false,
      keyboard: counts.keyboard || 0,
      mouseClicks: counts.mouseClicks || 0,
      idleTime: counts.idleTime || 0
    };
  }

  /**
   * Get event rates (compatibility method)
   */
  async getEventRates() {
    // This would require tracking over time, simplified for now
    return {
      keyboardRate: 0,
      mouseClickRate: 0
    };
  }

  /**
   * Cleanup
   */
  async cleanup() {
    try {
      await this.stopMonitoring();
      this.nativeModule = null;
      this.nativeModuleRef = null;
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

module.exports = WindowsNativeEventAdapter;
