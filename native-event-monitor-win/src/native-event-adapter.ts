/**
 * Windows Native Event Adapter
 * TypeScript wrapper for the native C++ event monitor module
 */

export interface NativeEventData {
  type: 'keyboard' | 'mouse' | 'idle';
  timestamp: number;
  details?: any;
}

export interface HardwareIdResult {
  id: string;
  components: string[];
}

class WindowsNativeEventAdapter {
  private nativeModule: any;
  public nativeModuleRef: any; // Exposed for direct access if needed

  constructor() {
    try {
      // Load the native module with proper path resolution for both dev and production
      const path = require('path');

      // In production (Electron packaged app), native modules are in app.asar.unpacked
      // In development, they are in the project directory
      let modulePath: string;

      // Use type assertion for Electron-specific process.resourcesPath
      const electronProcess = process as any;
      if (electronProcess.resourcesPath) {
        // Production: Electron packaged app
        modulePath = path.join(
          electronProcess.resourcesPath,
          'app.asar.unpacked',
          'native-event-monitor-win',
          'build',
          'Release',
          'event_monitor.node'
        );
      } else {
        // Development: relative path from compiled location
        modulePath = path.join(__dirname, '../../build/Release/event_monitor.node');
      }

      console.log('[NativeEventAdapter] Loading native module from:', modulePath);
      this.nativeModule = require(modulePath);
      this.nativeModuleRef = this.nativeModule;
      console.log('[NativeEventAdapter] ✅ Native module loaded successfully');
    } catch (error) {
      console.error('[NativeEventAdapter] ❌ Failed to load native module:', error);
      throw new Error('Native event monitor module not available');
    }
  }

  /**
   * Get hardware ID
   */
  getHardwareId(): HardwareIdResult {
    try {
      return this.nativeModule.getHardwareId();
    } catch (error) {
      console.error('Failed to get hardware ID:', error);
      throw error;
    }
  }

  /**
   * Get active window information
   */
  getActiveWindow(): { title: string; processName: string } {
    try {
      return this.nativeModule.getActiveWindow();
    } catch (error) {
      console.error('Failed to get active window:', error);
      return { title: '', processName: '' };
    }
  }

  /**
   * Get idle time in seconds
   */
  getIdleTime(): number {
    try {
      return this.nativeModule.getIdleTime();
    } catch (error) {
      console.error('Failed to get idle time:', error);
      return 0;
    }
  }

  /**
   * Start monitoring events
   */
  async startMonitoring(): Promise<boolean> {
    try {
      if (this.nativeModule.startMonitoring) {
        console.log('[NativeEventAdapter] Calling native startMonitoring()...');
        this.nativeModule.startMonitoring();

        // Verify hooks were installed successfully
        const counts = this.nativeModule.getEventCounts ? this.nativeModule.getEventCounts() : null;
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
      console.warn('[NativeEventAdapter] startMonitoring method not available');
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
  async stopMonitoring(): Promise<boolean> {
    try {
      if (this.nativeModule.stopMonitoring) {
        this.nativeModule.stopMonitoring();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to stop monitoring:', error);
      return false;
    }
  }

  /**
   * Reset event counts
   */
  async resetCounts(): Promise<boolean> {
    try {
      if (this.nativeModule.resetCounts) {
        this.nativeModule.resetCounts();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to reset counts:', error);
      return false;
    }
  }

  /**
   * Get event counts
   */
  async getEventCounts(): Promise<{
    keyboard: number;
    mouse: number;
    mouseClicks: number;
    idleTime: number;
    isMonitoring: boolean;
    keyboardHookInstalled: boolean;
    mouseHookInstalled: boolean;
  }> {
    try {
      if (this.nativeModule.getEventCounts) {
        return this.nativeModule.getEventCounts();
      }
      return {
        keyboard: 0,
        mouse: 0,
        mouseClicks: 0,
        idleTime: 0,
        isMonitoring: false,
        keyboardHookInstalled: false,
        mouseHookInstalled: false
      };
    } catch (error) {
      console.error('Failed to get event counts:', error);
      return {
        keyboard: 0,
        mouse: 0,
        mouseClicks: 0,
        idleTime: 0,
        isMonitoring: false,
        keyboardHookInstalled: false,
        mouseHookInstalled: false
      };
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      await this.stopMonitoring();
      if (this.nativeModule.cleanup) {
        this.nativeModule.cleanup();
      }
    } catch (error) {
      console.error('Failed to cleanup:', error);
    }
  }

  /**
   * Check if module is available
   */
  isAvailable(): boolean {
    return this.nativeModule !== null && this.nativeModule !== undefined;
  }
}

export default WindowsNativeEventAdapter;
