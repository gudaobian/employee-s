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
      // Load the native module
      this.nativeModule = require('../../build/Release/event_monitor.node');
      this.nativeModuleRef = this.nativeModule;
    } catch (error) {
      console.error('Failed to load native module:', error);
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
        this.nativeModule.startMonitoring();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to start monitoring:', error);
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
