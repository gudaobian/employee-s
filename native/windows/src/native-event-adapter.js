"use strict";
/**
 * Windows Native Event Adapter
 * TypeScript wrapper for the native C++ event monitor module
 */
Object.defineProperty(exports, "__esModule", { value: true });
class WindowsNativeEventAdapter {
    constructor() {
        try {
            // Load the native module with proper path resolution for both dev and production
            const path = require('path');
            // In production (Electron packaged app), native modules are in app.asar.unpacked
            // In development, they are in the project directory
            let modulePath;
            // Use type assertion for Electron-specific process.resourcesPath
            const electronProcess = process;
            if (electronProcess.resourcesPath) {
                // Production: Electron packaged app
                modulePath = path.join(electronProcess.resourcesPath, 'app.asar.unpacked', 'native-event-monitor-win', 'build', 'Release', 'event_monitor.node');
            }
            else {
                // Development: relative path from compiled location
                modulePath = path.join(__dirname, '../../build/Release/event_monitor.node');
            }
            console.log('[NativeEventAdapter] Loading native module from:', modulePath);
            console.log('[NativeEventAdapter] __dirname:', __dirname);
            console.log('[NativeEventAdapter] process.resourcesPath:', process.resourcesPath);
            console.log('[NativeEventAdapter] Checking file exists...');
            const fs = require('fs');
            const fileExists = fs.existsSync(modulePath);
            console.log('[NativeEventAdapter] File exists:', fileExists);
            if (!fileExists) {
                console.error('[NativeEventAdapter] ❌ File not found at path:', modulePath);
                console.error('[NativeEventAdapter] Listing parent directory:');
                try {
                    const parentDir = path.dirname(modulePath);
                    const files = fs.readdirSync(parentDir);
                    console.error('[NativeEventAdapter] Files in parent dir:', files);
                }
                catch (e) {
                    console.error('[NativeEventAdapter] Cannot list parent directory:', e);
                }
                throw new Error(`Native module not found at: ${modulePath}`);
            }
            this.nativeModule = require(modulePath);
            this.nativeModuleRef = this.nativeModule;
            console.log('[NativeEventAdapter] ✅ Native module loaded successfully');
        }
        catch (error) {
            console.error('[NativeEventAdapter] ❌ Failed to load native module:', error);
            console.error('[NativeEventAdapter] Error details:', error instanceof Error ? error.message : String(error));
            if (error instanceof Error && error.stack) {
                console.error('[NativeEventAdapter] Stack trace:', error.stack);
            }
            throw new Error('Native event monitor module not available');
        }
    }
    /**
     * Get hardware ID
     */
    getHardwareId() {
        try {
            return this.nativeModule.getHardwareId();
        }
        catch (error) {
            console.error('Failed to get hardware ID:', error);
            throw error;
        }
    }
    /**
     * Get active window information
     */
    getActiveWindow() {
        try {
            return this.nativeModule.getActiveWindow();
        }
        catch (error) {
            console.error('Failed to get active window:', error);
            return { title: '', processName: '' };
        }
    }
    /**
     * Get idle time in seconds
     */
    getIdleTime() {
        try {
            return this.nativeModule.getIdleTime();
        }
        catch (error) {
            console.error('Failed to get idle time:', error);
            return 0;
        }
    }
    /**
     * Start monitoring events
     */
    async startMonitoring() {
        try {
            // C++ 模块导出的方法名是 'start'，不是 'startMonitoring'
            if (this.nativeModule.start) {
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
        }
        catch (error) {
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
            // C++ 模块导出的方法名是 'stop'，不是 'stopMonitoring'
            if (this.nativeModule.stop) {
                this.nativeModule.stop();
                return true;
            }
            return false;
        }
        catch (error) {
            console.error('Failed to stop monitoring:', error);
            return false;
        }
    }
    /**
     * Reset event counts
     */
    async resetCounts() {
        try {
            if (this.nativeModule.resetCounts) {
                this.nativeModule.resetCounts();
                return true;
            }
            return false;
        }
        catch (error) {
            console.error('Failed to reset counts:', error);
            return false;
        }
    }
    /**
     * Get event counts
     */
    async getEventCounts() {
        try {
            // C++ 模块导出的方法名是 'getCounts'，不是 'getEventCounts'
            if (this.nativeModule.getCounts) {
                return this.nativeModule.getCounts();
            }
            return {
                keyboard: 0,
                mouse: 0,
                mouseClicks: 0,
                mouseScrolls: 0,
                idleTime: 0,
                isMonitoring: false,
                keyboardHookInstalled: false,
                mouseHookInstalled: false
            };
        }
        catch (error) {
            console.error('Failed to get event counts:', error);
            return {
                keyboard: 0,
                mouse: 0,
                mouseClicks: 0,
                mouseScrolls: 0,
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
    async cleanup() {
        try {
            await this.stopMonitoring();
            if (this.nativeModule.cleanup) {
                this.nativeModule.cleanup();
            }
        }
        catch (error) {
            console.error('Failed to cleanup:', error);
        }
    }
    /**
     * Check if module is available
     */
    isAvailable() {
        return this.nativeModule !== null && this.nativeModule !== undefined;
    }
}
exports.default = WindowsNativeEventAdapter;
//# sourceMappingURL=native-event-adapter.js.map