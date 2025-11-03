/**
 * macOS平台适配器
 * 实现macOS特定的系统功能
 */

import { BasePlatformAdapter } from '../common/base-platform-adapter';
import { 
  ScreenshotOptions, 
  ScreenshotResult, 
  PermissionStatus, 
  SystemInfo, 
  ProcessInfo, 
  WindowInfo, 
  PlatformCapabilities 
} from '../../common/interfaces/platform-interface';

export class MacOSAdapter extends BasePlatformAdapter {
  private windowMonitoringInterval?: NodeJS.Timeout;
  private windowMonitoringCallback?: (window: WindowInfo) => void;

  constructor() {
    super();
  }

  protected async doInitialize(): Promise<void> {
    // macOS特定的初始化逻辑
    this.logOperation('macos-adapter-initialize');
  }

  protected async doCleanup(): Promise<void> {
    // 清理监控
    this.stopWindowMonitoring();
    this.logOperation('macos-adapter-cleanup');
  }

  async takeScreenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    return this.executeWithErrorHandling(
      async () => {
        // 多层降级策略
        try {
          // 第一层：使用screenshot-desktop NPM包
          return await this.captureWithNPM(options);
        } catch (npmError) {
          try {
            // 第二层：使用macOS的screencapture命令
            return await this.captureWithScreencapture(options);
          } catch (cmdError) {
            // 第三层：使用AppleScript
            return await this.captureWithAppleScript(options);
          }
        }
      },
      'take-screenshot'
    );
  }

  async captureWindow(windowId: string): Promise<ScreenshotResult> {
    return this.executeWithErrorHandling(
      async () => {
        // 使用screencapture捕获指定窗口
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const fs = require('fs').promises;
        const path = require('path');
        const os = require('os');

        const tempFile = path.join(os.tmpdir(), `window-${windowId}-${Date.now()}.png`);
        
        // 使用windowID参数捕获指定窗口
        await execAsync(`screencapture -l ${windowId} -x "${tempFile}"`);
        
        const data = await fs.readFile(tempFile);
        await fs.unlink(tempFile); // 清理临时文件

        return {
          success: true,
          data,
          width: 0, // 需要从图像获取实际尺寸
          height: 0,
          format: 'png',
          timestamp: Date.now()
        };
      },
      'capture-window'
    );
  }

  async checkPermissions(): Promise<PermissionStatus> {
    return this.executeWithErrorHandling(
      async () => {
        const permissions: PermissionStatus = {
          screenshot: false,
          accessibility: false,
          systemInfo: true // 系统信息通常不需要特殊权限
        };

        try {
          // 检查屏幕录制权限
          const { systemPreferences } = require('electron');
          if (systemPreferences) {
            const screenStatus = systemPreferences.getMediaAccessStatus('screen');
            permissions.screenshot = screenStatus === 'granted';
            
            // 检查辅助功能权限
            permissions.accessibility = systemPreferences.isTrustedAccessibilityClient(false);
          } else {
            // 在没有Electron的环境中使用AppleScript检查
            permissions.screenshot = await this.checkScreenPermissionWithAppleScript();
            permissions.accessibility = await this.checkAccessibilityPermissionWithAppleScript();
          }
        } catch (error) {
          // 如果检查失败，假设没有权限
          console.warn('Permission check failed:', error);
        }

        return permissions;
      },
      'check-permissions'
    );
  }

  async requestPermissions(): Promise<PermissionStatus> {
    return this.executeWithErrorHandling(
      async () => {
        const currentPermissions = await this.checkPermissions();
        
        try {
          const { systemPreferences } = require('electron');
          if (systemPreferences) {
            // 请求屏幕录制权限
            if (!currentPermissions.screenshot) {
              await systemPreferences.askForMediaAccess('screen');
            }
          } else {
            // 在没有Electron的环境中，引导用户手动设置权限
            this.showPermissionInstructions();
          }
        } catch (error) {
          console.warn('Permission request failed:', error);
        }

        // 重新检查权限状态
        return await this.checkPermissions();
      },
      'request-permissions'
    );
  }

  async getSystemInfo(): Promise<SystemInfo> {
    return this.executeWithErrorHandling(
      async () => {
        const os = require('os');
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // 获取macOS版本信息
        let osVersion = '';
        try {
          const { stdout } = await execAsync('sw_vers -productVersion');
          osVersion = stdout.trim();
        } catch (error) {
          osVersion = os.release();
        }

        // 获取CPU信息
        let cpuModel = '';
        try {
          const { stdout } = await execAsync('sysctl -n machdep.cpu.brand_string');
          cpuModel = stdout.trim();
        } catch (error) {
          cpuModel = os.cpus()[0]?.model || 'Unknown';
        }

        // 生成设备ID（基于硬件UUID）
        let deviceId = '';
        try {
          const { stdout } = await execAsync('system_profiler SPHardwareDataType | grep "Hardware UUID" | awk \'{print $3}\'');
          deviceId = stdout.trim();
        } catch (error) {
          deviceId = require('crypto').randomUUID();
        }

        return {
          platform: process.platform,
          hostname: os.hostname(),
          username: os.userInfo().username,
          osVersion,
          memory: Math.round(os.totalmem() / 1024 / 1024 / 1024), // GB
          cpu: cpuModel,
          deviceId,
          ipAddress: this.getLocalIPAddress(),
          macAddress: this.getMACAddress()
        };
      },
      'get-system-info'
    );
  }

  async getProcessList(): Promise<ProcessInfo[]> {
    return this.executeWithErrorHandling(
      async () => {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
          const { stdout } = await execAsync('ps -eo pid,comm,%cpu,%mem,args');
          const lines = stdout.trim().split('\n').slice(1); // 跳过标题行

          return lines.map(line => {
            const parts = line.trim().split(/\s+/);
            return {
              pid: parseInt(parts[0]),
              name: parts[1],
              cpuUsage: parseFloat(parts[2]),
              memoryUsage: parseFloat(parts[3]),
              command: parts.slice(4).join(' ')
            };
          }).filter(proc => !isNaN(proc.pid));
        } catch (error) {
          return [];
        }
      },
      'get-process-list'
    );
  }

  async getActiveWindow(): Promise<WindowInfo> {
    return this.executeWithErrorHandling(
      async () => {
        try {
          // 使用兼容层
          const { activeWindow } = require('../../active-win-compat');
          const window = await activeWindow();
          
          if (window) {
            return {
              id: window.id.toString(),
              title: window.title,
              application: window.owner.name,
              processId: window.owner.processId,
              bounds: {
                x: window.bounds.x,
                y: window.bounds.y,
                width: window.bounds.width,
                height: window.bounds.height
              },
              isVisible: true
            };
          }
        } catch (error) {
          // 降级到AppleScript
          return await this.getActiveWindowWithAppleScript();
        }

        throw new Error('Unable to get active window');
      },
      'get-active-window'
    );
  }

  startWindowMonitoring(callback: (window: WindowInfo) => void): void {
    this.stopWindowMonitoring(); // 先停止现有的监控
    
    this.windowMonitoringCallback = callback;
    this.windowMonitoringInterval = setInterval(async () => {
      try {
        const activeWindow = await this.getActiveWindow();
        callback(activeWindow);
      } catch (error) {
        this.emit('window-monitoring-error', error);
      }
    }, 1000); // 每秒检查一次

    this.logOperation('start-window-monitoring');
  }

  stopWindowMonitoring(): void {
    if (this.windowMonitoringInterval) {
      clearInterval(this.windowMonitoringInterval);
      this.windowMonitoringInterval = undefined;
    }
    this.windowMonitoringCallback = undefined;
    this.logOperation('stop-window-monitoring');
  }

  getPlatformSpecificCapabilities(): PlatformCapabilities {
    return {
      supportsScreenshot: true,
      supportsWindowMonitoring: true,
      supportsSystemInfo: true,
      nativePermissionRequired: true,
      supportedScreenshotFormats: ['png', 'jpeg'],
      hasNativeAPI: true
    };
  }

  async collectMonitoringData(): Promise<any> {
    return this.executeWithErrorHandling(
      async () => {
        const systemInfo = await this.getSystemInfo();
        const processList = await this.getProcessList();
        const activeWindow = await this.getActiveWindow();
        const permissions = await this.checkPermissions();

        return {
          systemInfo,
          processList,
          activeWindow,
          permissions,
          timestamp: Date.now(),
          platform: 'darwin'
        };
      },
      'collect-monitoring-data'
    );
  }

  // 私有方法实现

  private async captureWithNPM(options: ScreenshotOptions): Promise<ScreenshotResult> {
    const screenshot = require('screenshot-desktop');
    
    const data = await screenshot({
      format: options.format || 'png',
      quality: options.quality || 100,
      screen: options.screen || 0
    });

    return {
      success: true,
      data,
      width: 0, // 需要从图像获取实际尺寸
      height: 0,
      format: options.format || 'png',
      timestamp: Date.now()
    };
  }

  private async captureWithScreencapture(options: ScreenshotOptions): Promise<ScreenshotResult> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs').promises;
    const path = require('path');
    const os = require('os');

    const tempFile = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);
    await execAsync(`screencapture -x "${tempFile}"`);
    
    const data = await fs.readFile(tempFile);
    await fs.unlink(tempFile); // 清理临时文件

    return {
      success: true,
      data,
      width: 0,
      height: 0,
      format: 'png',
      timestamp: Date.now()
    };
  }

  private async captureWithAppleScript(options: ScreenshotOptions): Promise<ScreenshotResult> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs').promises;
    const path = require('path');
    const os = require('os');

    const tempFile = path.join(os.tmpdir(), `screenshot-as-${Date.now()}.png`);
    const script = `do shell script "screencapture -x '${tempFile}'"`;
    
    await execAsync(`osascript -e "${script}"`);
    
    const data = await fs.readFile(tempFile);
    await fs.unlink(tempFile);

    return {
      success: true,
      data,
      width: 0,
      height: 0,
      format: 'png',
      timestamp: Date.now()
    };
  }

  private async checkScreenPermissionWithAppleScript(): Promise<boolean> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      await execAsync('osascript -e "do shell script \\"echo test\\""');
      return true;
    } catch (error) {
      return false;
    }
  }

  private async checkAccessibilityPermissionWithAppleScript(): Promise<boolean> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // 简单测试辅助功能权限
      await execAsync('osascript -e "tell application \\"System Events\\" to get name of first process"');
      return true;
    } catch (error) {
      return false;
    }
  }

  private async getActiveWindowWithAppleScript(): Promise<WindowInfo> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        set frontAppWindows to windows of application process frontApp
        if (count of frontAppWindows) > 0 then
          set frontWindow to item 1 of frontAppWindows
          set windowTitle to name of frontWindow
          set windowBounds to position of frontWindow
          return frontApp & "|" & windowTitle & "|" & (item 1 of windowBounds) & "|" & (item 2 of windowBounds)
        end if
      end tell
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const [appName, title, x, y] = stdout.trim().split('|');

      return {
        id: `${appName}-${title}`,
        title,
        application: appName,
        processId: 0, // AppleScript无法直接获取PID
        bounds: {
          x: parseInt(x) || 0,
          y: parseInt(y) || 0,
          width: 0,
          height: 0
        },
        isVisible: true
      };
    } catch (error) {
      throw new Error('Unable to get active window with AppleScript');
    }
  }

  private showPermissionInstructions(): void {
    console.log(`
🔐 macOS权限设置指南：

1. 屏幕录制权限：
   - 系统偏好设置 → 安全性与隐私 → 隐私 → 屏幕录制
   - 添加并勾选此应用程序

2. 辅助功能权限：
   - 系统偏好设置 → 安全性与隐私 → 隐私 → 辅助功能
   - 添加并勾选此应用程序

设置完成后请重启应用程序。
    `);
  }

  private getLocalIPAddress(): string {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    for (const interfaceName of Object.keys(interfaces)) {
      const addresses = interfaces[interfaceName];
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal) {
          return address.address;
        }
      }
    }
    
    return 'unknown';
  }

  private getMACAddress(): string {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    for (const interfaceName of Object.keys(interfaces)) {
      const addresses = interfaces[interfaceName];
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal && address.mac !== '00:00:00:00:00:00') {
          return address.mac;
        }
      }
    }
    
    return 'unknown';
  }
}