/**
 * Linux 平台适配器
 * 实现 Linux 特定的功能
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import {
  PlatformAdapterBase,
  SystemInfo,
  ProcessInfo,
  NetworkInfo,
  ScreenshotOptions,
  ScreenshotResult,
  PermissionResult,
  ActivityData
} from '../interfaces/platform-interface';
import { logger } from '../../common/utils';

const execAsync = promisify(exec);

/**
 * Interface for native event counts from LinuxEventMonitor
 */
interface NativeEventCounts {
  keyboard: number;
  mouse: number;
  scrolls: number;
  isMonitoring: boolean;
}

/**
 * Interface for native permission status
 */
interface NativePermissionStatus {
  hasInputAccess: boolean;
  hasX11Access: boolean;
  currentBackend: 'libinput' | 'x11' | 'none';
  missingPermissions: string[];
}

/**
 * Interface for the native LinuxEventMonitor class
 */
interface LinuxEventMonitorInterface extends EventEmitter {
  start(): boolean;
  stop(): boolean;
  getCounts(): NativeEventCounts;
  resetCounts(): boolean;
  isMonitoring(): boolean;
  getBackendType(): string;
  checkPermissions(): NativePermissionStatus;
  isAvailable(): boolean;
  startPolling(intervalMs?: number): void;
  stopPolling(): void;
}

export class LinuxAdapter extends PlatformAdapterBase {
  private activityMonitorTimer?: NodeJS.Timeout;
  private lastActivityData: ActivityData | null = null;
  private desktopEnvironment: string = 'unknown';
  private hasX11 = false;
  private hasWayland = false;

  // Native event monitor instance
  private nativeEventMonitor: LinuxEventMonitorInterface | null = null;
  private nativeModuleLoaded = false;
  private nativeModuleLoadError: string | null = null;

  // Activity counters for current period
  private currentPeriodKeystrokes = 0;
  private currentPeriodMouseClicks = 0;
  private currentPeriodMouseScrolls = 0;
  private lastNativeKeystrokes = 0;
  private lastNativeMouseClicks = 0;
  private lastNativeMouseScrolls = 0;

  protected async performInitialization(): Promise<void> {
    logger.info('Initializing Linux platform adapter');

    try {
      // 检测桌面环境
      await this.detectDesktopEnvironment();

      // 检查必需的系统工具
      await this.checkSystemTools();

      // 加载原生事件监控模块
      await this.loadNativeEventMonitor();

      // 检查权限
      await this.checkInitialPermissions();

      logger.info('Linux platform adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Linux adapter', error);
      throw error;
    }
  }

  /**
   * Load the native Linux event monitor module
   * Tries multiple strategies: development path, packaged path, fallback
   */
  private async loadNativeEventMonitor(): Promise<void> {
    logger.info('[LINUX] Loading native event monitor module...');

    // Get Electron app paths for debugging
    const resourcesPath = (process as any).resourcesPath || '';
    const isPackaged = resourcesPath && resourcesPath.includes('resources');

    logger.info('[LINUX] Environment detection:', {
      resourcesPath,
      isPackaged,
      __dirname,
      cwd: process.cwd()
    });

    const strategies = [
      // Strategy 1: AppImage/electron-builder unpacked path (PRIORITY for packaged apps)
      {
        name: 'appimage-unpacked',
        path: path.join(resourcesPath, 'app.asar.unpacked', 'native-event-monitor-linux')
      },
      // Strategy 2: AppImage/electron-builder direct resources path
      {
        name: 'appimage-resources',
        path: path.join(resourcesPath, 'native-event-monitor-linux')
      },
      // Strategy 3: Development path (TypeScript compiled)
      {
        name: 'development',
        path: path.join(__dirname, '../../native-event-monitor-linux/lib/index')
      },
      // Strategy 4: Development path (JavaScript entry)
      {
        name: 'development-js',
        path: path.join(__dirname, '../../native-event-monitor-linux/index')
      },
      // Strategy 5: Packaged Electron app path (legacy)
      {
        name: 'packaged',
        path: path.join(resourcesPath, 'native-event-monitor-linux')
      },
      // Strategy 6: Relative to app path
      {
        name: 'app-relative',
        path: path.join(process.cwd(), 'native-event-monitor-linux')
      },
      // Strategy 7: __dirname based for compiled dist
      {
        name: 'dist-relative',
        path: path.join(__dirname, '../../../native-event-monitor-linux')
      }
    ];

    for (const strategy of strategies) {
      try {
        logger.info(`[LINUX] Trying native module strategy: ${strategy.name} at ${strategy.path}`);

        // Check if module file exists
        const modulePath = strategy.path;
        let moduleExists = false;

        try {
          // Try to resolve the module path
          require.resolve(modulePath);
          moduleExists = true;
        } catch {
          // Module doesn't exist at this path
          moduleExists = false;
        }

        if (!moduleExists) {
          logger.info(`[LINUX] Module not found at: ${strategy.path}`);
          continue;
        }

        // Try to load the module
        const NativeModule = require(modulePath);
        const LinuxEventMonitor = NativeModule.LinuxEventMonitor || NativeModule.default || NativeModule;

        if (typeof LinuxEventMonitor !== 'function') {
          logger.warn(`[LINUX] Invalid module export at ${strategy.path}`);
          continue;
        }

        // Create monitor instance
        const monitor = new LinuxEventMonitor() as LinuxEventMonitorInterface;

        // Verify the monitor has required methods
        if (typeof monitor.start !== 'function' ||
            typeof monitor.stop !== 'function' ||
            typeof monitor.getCounts !== 'function') {
          logger.warn(`[LINUX] Native module missing required methods`);
          continue;
        }

        // Check if native module is available
        if (monitor.isAvailable && !monitor.isAvailable()) {
          logger.warn(`[LINUX] Native module loaded but not available (binary not found)`);
          this.nativeModuleLoadError = 'Native binary not found. Run npm run build:native in native-event-monitor-linux';
          continue;
        }

        this.nativeEventMonitor = monitor;
        this.nativeModuleLoaded = true;
        logger.info(`[LINUX] Native event monitor loaded successfully via ${strategy.name}`);

        // Check permissions
        const perms = monitor.checkPermissions();
        logger.info(`[LINUX] Native module permissions:`, {
          hasInputAccess: perms.hasInputAccess,
          hasX11Access: perms.hasX11Access,
          backend: perms.currentBackend
        });

        return;
      } catch (error) {
        logger.info(`[LINUX] Failed to load native module via ${strategy.name}:`, error);
      }
    }

    // No strategy succeeded
    this.nativeModuleLoaded = false;
    this.nativeModuleLoadError = 'Failed to load native event monitor from any location';
    logger.warn('[LINUX] Native event monitor not available - activity monitoring will be limited');
    logger.warn('[LINUX] To enable full activity monitoring:');
    logger.warn('[LINUX]   1. Install dependencies: sudo apt install libinput-dev libudev-dev libx11-dev libxtst-dev');
    logger.warn('[LINUX]   2. Build native module: cd native-event-monitor-linux && npm run build:native');
    logger.warn('[LINUX]   3. Add user to input group: sudo usermod -aG input $USER');
  }

  protected async performCleanup(): Promise<void> {
    logger.info('Cleaning up Linux platform adapter');

    // Stop activity monitor timer
    if (this.activityMonitorTimer) {
      clearInterval(this.activityMonitorTimer);
      this.activityMonitorTimer = undefined;
    }

    // Clean up native event monitor
    if (this.nativeEventMonitor) {
      try {
        logger.info('[LINUX] Stopping native event monitor...');
        this.nativeEventMonitor.stopPolling();
        this.nativeEventMonitor.stop();
        this.nativeEventMonitor = null;
        logger.info('[LINUX] Native event monitor stopped');
      } catch (error) {
        logger.error('[LINUX] Error stopping native event monitor:', error);
      }
    }

    // Reset counters
    this.lastActivityData = null;
    this.currentPeriodKeystrokes = 0;
    this.currentPeriodMouseClicks = 0;
    this.currentPeriodMouseScrolls = 0;
    this.lastNativeKeystrokes = 0;
    this.lastNativeMouseClicks = 0;
    this.lastNativeMouseScrolls = 0;
    this.nativeModuleLoaded = false;
  }

  async getSystemInfo(): Promise<SystemInfo> {
    this.ensureInitialized();
    
    try {
      const systemVersion = await this.getSystemVersion();
      const memoryInfo = await this.getMemoryInfo();
      const cpuInfo = await this.getCpuInfo();
      const diskInfo = await this.getDiskInfo();
      
      return {
        platform: 'Linux',
        architecture: os.arch(),
        version: systemVersion,
        hostname: os.hostname(),
        username: os.userInfo().username,
        memory: memoryInfo,
        cpu: cpuInfo,
        disk: diskInfo
      };
    } catch (error) {
      logger.error('Failed to get system info', error);
      throw error;
    }
  }

  async getRunningProcesses(): Promise<ProcessInfo[]> {
    this.ensureInitialized();
    
    try {
      const { stdout } = await execAsync('ps -eo pid,comm,etime,pmem,pcpu,args --no-headers');
      const lines = stdout.split('\n');
      const processes: ProcessInfo[] = [];
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        
        const pid = parseInt(parts[0]);
        const name = parts[1];
        const etime = parts[2];
        const memoryUsage = parseFloat(parts[3]);
        const cpuUsage = parseFloat(parts[4]);
        const commandLine = parts.slice(5).join(' ');
        
        processes.push({
          pid,
          name: path.basename(name),
          executablePath: this.getExecutablePath(pid),
          commandLine,
          memoryUsage,
          cpuUsage,
          startTime: this.parseEtimeToDate(etime)
        });
      }
      
      return processes;
    } catch (error) {
      logger.error('Failed to get running processes', error);
      return [];
    }
  }

  async getActiveWindow(): Promise<{ title: string; application: string; pid: number } | null> {
    this.ensureInitialized();
    
    try {
      if (this.hasX11) {
        return await this.getActiveWindowX11();
      } else if (this.hasWayland) {
        return await this.getActiveWindowWayland();
      } else {
        logger.warn('No supported display server found');
        return null;
      }
    } catch (error) {
      logger.error('Failed to get active window', error);
      return null;
    }
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    this.ensureInitialized();
    
    try {
      const interfaces = this.getNetworkInterfaces();
      const connections = await this.getNetworkConnections();
      
      return {
        interfaces,
        activeConnections: connections
      };
    } catch (error) {
      logger.error('Failed to get network info', error);
      return {
        interfaces: [],
        activeConnections: []
      };
    }
  }

  async checkScreenshotPermission(): Promise<PermissionResult> {
    if (this.hasX11) {
      // X11 环境下通常不需要特殊权限
      return {
        granted: true,
        canRequest: false
      };
    } else if (this.hasWayland) {
      // Wayland 需要检查是否有 portal 支持
      try {
        await execAsync('which xdg-desktop-portal');
        return {
          granted: true,
          canRequest: false
        };
      } catch {
        return {
          granted: false,
          canRequest: false,
          error: 'xdg-desktop-portal required for Wayland screenshots'
        };
      }
    } else {
      return {
        granted: false,
        canRequest: false,
        error: 'No supported display server found'
      };
    }
  }

  async requestScreenshotPermission(): Promise<PermissionResult> {
    return await this.checkScreenshotPermission();
  }

  async takeScreenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    this.ensureInitialized();
    
    try {
      const format = options.format || 'png';
      const tempPath = `/tmp/screenshot-${Date.now()}.${format}`;
      
      if (this.hasX11) {
        // 使用 ImageMagick 或 scrot
        try {
          await execAsync(`scrot "${tempPath}"`);
        } catch {
          try {
            await execAsync(`import -window root "${tempPath}"`);
          } catch {
            throw new Error('Neither scrot nor ImageMagick available');
          }
        }
      } else if (this.hasWayland) {
        // 使用 grim 或 gnome-screenshot
        try {
          await execAsync(`grim "${tempPath}"`);
        } catch {
          try {
            await execAsync(`gnome-screenshot -f "${tempPath}"`);
          } catch {
            throw new Error('No Wayland screenshot tool available');
          }
        }
      } else {
        throw new Error('No supported display server found');
      }
      
      if (fs.existsSync(tempPath)) {
        const data = await fs.promises.readFile(tempPath);
        await fs.promises.unlink(tempPath); // 清理临时文件
        
        return {
          success: true,
          data
        };
      } else {
        return {
          success: false,
          error: 'Screenshot file not created'
        };
      }
    } catch (error) {
      logger.error('Failed to take screenshot', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async startActivityMonitoring(): Promise<void> {
    this.ensureInitialized();
    
    if (this.monitoringActive) {
      return;
    }
    
    this.monitoringActive = true;
    
    // 每5秒采集一次活动数据
    this.activityMonitorTimer = setInterval(async () => {
      try {
        this.lastActivityData = await this.collectActivityData();
      } catch (error) {
        logger.error('Failed to collect activity data', error);
      }
    }, 5000);
    
    logger.info('Activity monitoring started');
  }

  async stopActivityMonitoring(): Promise<void> {
    if (!this.monitoringActive) {
      return;
    }
    
    this.monitoringActive = false;
    
    if (this.activityMonitorTimer) {
      clearInterval(this.activityMonitorTimer);
      this.activityMonitorTimer = undefined;
    }
    
    logger.info('Activity monitoring stopped');
  }

  async getActivityData(): Promise<ActivityData> {
    this.ensureInitialized();
    
    if (this.lastActivityData) {
      return { ...this.lastActivityData };
    }
    
    return await this.collectActivityData();
  }

  async checkAccessibilityPermission(): Promise<PermissionResult> {
    // Linux 上的辅助功能主要依赖桌面环境
    if (this.desktopEnvironment === 'gnome') {
      try {
        // 检查 GNOME 辅助技术
        const { stdout } = await execAsync('gsettings get org.gnome.desktop.interface toolkit-accessibility');
        const enabled = stdout.trim() === 'true';
        
        return {
          granted: enabled,
          canRequest: !enabled
        };
      } catch {
        return {
          granted: false,
          canRequest: true,
          error: 'Cannot check GNOME accessibility settings'
        };
      }
    } else {
      // 其他桌面环境通常不需要特殊配置
      return {
        granted: true,
        canRequest: false
      };
    }
  }

  async requestAccessibilityPermission(): Promise<PermissionResult> {
    if (this.desktopEnvironment === 'gnome') {
      try {
        await execAsync('gsettings set org.gnome.desktop.interface toolkit-accessibility true');
        return {
          granted: true,
          canRequest: false
        };
      } catch (error) {
        return {
          granted: false,
          canRequest: false,
          error: `Failed to enable accessibility: ${error}`
        };
      }
    } else {
      return {
        granted: true,
        canRequest: false
      };
    }
  }

  async isAutoStartEnabled(): Promise<boolean> {
    try {
      const autostartDir = path.join(os.homedir(), '.config/autostart');
      const desktopFile = path.join(autostartDir, 'employee-monitor.desktop');
      
      return fs.existsSync(desktopFile);
    } catch (error) {
      logger.error('Failed to check auto start status', error);
      return false;
    }
  }

  async enableAutoStart(): Promise<boolean> {
    try {
      const autostartDir = path.join(os.homedir(), '.config/autostart');
      const desktopFile = path.join(autostartDir, 'employee-monitor.desktop');
      const executablePath = process.execPath;
      const workingDirectory = process.cwd();
      
      // 确保目录存在
      await fs.promises.mkdir(autostartDir, { recursive: true });
      
      // 创建 .desktop 文件
      const desktopContent = `[Desktop Entry]
Type=Application
Name=Employee Monitor
Exec=${executablePath} --start-minimized
Path=${workingDirectory}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
      
      await fs.promises.writeFile(desktopFile, desktopContent);
      
      logger.info('Auto start enabled successfully');
      return true;
    } catch (error) {
      logger.error('Failed to enable auto start', error);
      return false;
    }
  }

  async disableAutoStart(): Promise<boolean> {
    try {
      const autostartDir = path.join(os.homedir(), '.config/autostart');
      const desktopFile = path.join(autostartDir, 'employee-monitor.desktop');
      
      if (fs.existsSync(desktopFile)) {
        await fs.promises.unlink(desktopFile);
      }
      
      logger.info('Auto start disabled successfully');
      return true;
    } catch (error) {
      logger.error('Failed to disable auto start', error);
      return false;
    }
  }

  getPlatformCapabilities(): string[] {
    const capabilities = [
      'process_monitoring',
      'network_monitoring',
      'auto_start',
      'systemd_support'
    ];
    
    if (this.hasX11) {
      capabilities.push('screenshot', 'window_tracking', 'x11_support');
    }
    
    if (this.hasWayland) {
      capabilities.push('wayland_support');
      if (this.hasWayland) {
        capabilities.push('screenshot');
      }
    }
    
    if (this.desktopEnvironment === 'gnome') {
      capabilities.push('gnome_integration', 'accessibility_control');
    }
    
    return capabilities;
  }

  async executePlatformSpecificOperation(operation: string, params?: any): Promise<any> {
    switch (operation) {
      case 'execute_shell':
        return await this.executeShell(params.command);
      
      case 'check_systemd':
        return await this.checkSystemdStatus();
      
      case 'get_desktop_info':
        return await this.getDesktopInfo();
      
      case 'monitor_dbus':
        return await this.monitorDBus(params.service);
      
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }

  // === Private Methods ===

  private async detectDesktopEnvironment(): Promise<void> {
    try {
      // 检查 X11
      if (process.env.DISPLAY) {
        this.hasX11 = true;
      }
      
      // 检查 Wayland
      if (process.env.WAYLAND_DISPLAY) {
        this.hasWayland = true;
      }
      
      // 检测桌面环境
      const xdgCurrentDesktop = process.env.XDG_CURRENT_DESKTOP?.toLowerCase();
      const desktopSession = process.env.DESKTOP_SESSION?.toLowerCase();
      
      if (xdgCurrentDesktop?.includes('gnome') || desktopSession?.includes('gnome')) {
        this.desktopEnvironment = 'gnome';
      } else if (xdgCurrentDesktop?.includes('kde') || desktopSession?.includes('kde')) {
        this.desktopEnvironment = 'kde';
      } else if (xdgCurrentDesktop?.includes('xfce') || desktopSession?.includes('xfce')) {
        this.desktopEnvironment = 'xfce';
      } else {
        this.desktopEnvironment = 'unknown';
      }
      
      logger.info(`Desktop environment detected: ${this.desktopEnvironment}, X11: ${this.hasX11}, Wayland: ${this.hasWayland}`);
    } catch (error) {
      logger.warn('Failed to detect desktop environment', error);
    }
  }

  private async checkSystemTools(): Promise<void> {
    const requiredTools = ['ps', 'netstat'];
    const optionalTools = ['scrot', 'import', 'grim', 'gnome-screenshot'];
    
    for (const tool of requiredTools) {
      try {
        await execAsync(`which ${tool}`);
      } catch {
        throw new Error(`Required system tool not found: ${tool}`);
      }
    }
    
    // 检查可选工具
    for (const tool of optionalTools) {
      try {
        await execAsync(`which ${tool}`);
        logger.info(`Optional tool available: ${tool}`);
      } catch {
        // 可选工具不存在不阻断初始化
      }
    }
  }

  private async checkInitialPermissions(): Promise<void> {
    const accessibilityResult = await this.checkAccessibilityPermission();
    const screenshotResult = await this.checkScreenshotPermission();
    
    logger.info('Permission status:', {
      accessibility: accessibilityResult.granted,
      screenshot: screenshotResult.granted
    });
  }

  private async getSystemVersion(): Promise<string> {
    try {
      // 尝试获取发行版信息
      if (fs.existsSync('/etc/os-release')) {
        const content = await fs.promises.readFile('/etc/os-release', 'utf8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('PRETTY_NAME=')) {
            return line.split('=')[1].replace(/"/g, '');
          }
        }
      }
      
      // 后备方案
      const { stdout } = await execAsync('uname -sr');
      return stdout.trim();
    } catch {
      return os.release();
    }
  }

  private async getMemoryInfo(): Promise<{ total: number; free: number; used: number }> {
    try {
      const content = await fs.promises.readFile('/proc/meminfo', 'utf8');
      const lines = content.split('\n');
      
      let total = 0, free = 0, available = 0;
      
      for (const line of lines) {
        if (line.startsWith('MemTotal:')) {
          total = parseInt(line.split(/\s+/)[1]) * 1024; // KB to bytes
        } else if (line.startsWith('MemFree:')) {
          free = parseInt(line.split(/\s+/)[1]) * 1024;
        } else if (line.startsWith('MemAvailable:')) {
          available = parseInt(line.split(/\s+/)[1]) * 1024;
        }
      }
      
      const used = total - (available || free);
      return { total, free: available || free, used };
    } catch {
      // 后备方案
      const total = os.totalmem();
      const free = os.freemem();
      const used = total - free;
      return { total, free, used };
    }
  }

  private async getCpuInfo(): Promise<{ model: string; cores: number; usage: number }> {
    const cpus = os.cpus();
    const model = cpus[0]?.model || 'Unknown';
    const cores = cpus.length;
    
    // 获取 CPU 使用率
    let usage = 0;
    try {
      const { stdout } = await execAsync('top -bn1 | grep "Cpu(s)"');
      const match = stdout.match(/(\d+\.\d+)%us/);
      if (match) {
        usage = parseFloat(match[1]);
      }
    } catch {}
    
    return { model, cores, usage };
  }

  private async getDiskInfo(): Promise<{ total: number; free: number; used: number }> {
    try {
      const { stdout } = await execAsync('df -B1 /');
      const lines = stdout.split('\n');
      const diskLine = lines[1];
      const parts = diskLine.split(/\s+/);
      
      const total = parseInt(parts[1]);
      const used = parseInt(parts[2]);
      const free = parseInt(parts[3]);
      
      return { total, free, used };
    } catch {
      return { total: 0, free: 0, used: 0 };
    }
  }

  private getExecutablePath(pid: number): string {
    try {
      return fs.readlinkSync(`/proc/${pid}/exe`);
    } catch {
      return '';
    }
  }

  private parseEtimeToDate(etime: string): Date {
    // 简化实现，实际中需要更复杂的解析
    const now = new Date();
    return new Date(now.getTime() - 60000); // 1分钟前
  }

  private async getActiveWindowX11(): Promise<{ title: string; application: string; pid: number } | null> {
    try {
      // 使用 xdotool 或 xprop
      const { stdout: windowId } = await execAsync('xdotool getactivewindow');
      const { stdout: windowInfo } = await execAsync(`xprop -id ${windowId.trim()} WM_NAME _NET_WM_PID`);
      
      let title = '';
      let pid = 0;
      
      const lines = windowInfo.split('\n');
      for (const line of lines) {
        if (line.includes('WM_NAME')) {
          const match = line.match(/"(.+)"/);
          if (match) title = match[1];
        } else if (line.includes('_NET_WM_PID')) {
          const match = line.match(/= (\d+)/);
          if (match) pid = parseInt(match[1]);
        }
      }
      
      let application = 'Unknown';
      if (pid > 0) {
        try {
          const { stdout } = await execAsync(`ps -p ${pid} -o comm=`);
          application = stdout.trim();
        } catch {}
      }
      
      return { title, application, pid };
    } catch {
      return null;
    }
  }

  private async getActiveWindowWayland(): Promise<{ title: string; application: string; pid: number } | null> {
    try {
      // Wayland 下的窗口信息获取相对困难
      // 这里提供一个基本实现
      if (this.desktopEnvironment === 'gnome') {
        // GNOME 可能支持通过 gdbus 获取
        const { stdout } = await execAsync('gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "global.display.focus_window.get_title()"');
        
        const match = stdout.match(/\('(.+)'\)/);
        if (match) {
          return {
            title: match[1],
            application: 'Unknown',
            pid: 0
          };
        }
      }
      
      return null;
    } catch {
      return null;
    }
  }

  private getNetworkInterfaces(): Array<{ name: string; ip: string; mac: string; type: string }> {
    const interfaces = os.networkInterfaces();
    const result: Array<{ name: string; ip: string; mac: string; type: string }> = [];
    
    Object.entries(interfaces).forEach(([name, addrs]) => {
      if (addrs && Array.isArray(addrs)) {
        addrs.forEach((addr: any) => {
          if (!addr.internal && addr.family === 'IPv4') {
            result.push({
              name,
              ip: addr.address,
              mac: addr.mac,
              type: name.startsWith('eth') ? 'ethernet' : 
                    name.startsWith('wl') ? 'wifi' : 'other'
            });
          }
        });
      }
    });
    
    return result;
  }

  private async getNetworkConnections(): Promise<Array<{
    protocol: string;
    localAddress: string;
    localPort: number;
    remoteAddress?: string;
    remotePort?: number;
    state: string;
  }>> {
    try {
      const { stdout } = await execAsync('netstat -an');
      const lines = stdout.split('\n');
      const connections: Array<any> = [];
      
      for (const line of lines) {
        if (line.includes('LISTEN') || line.includes('ESTABLISHED')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 4) {
            const protocol = parts[0];
            const local = parts[3].split(':');
            const localPort = parseInt(local[local.length - 1]);
            const localAddress = local.slice(0, -1).join(':');
            
            connections.push({
              protocol,
              localAddress,
              localPort,
              state: parts[parts.length - 1]
            });
          }
        }
      }
      
      return connections;
    } catch {
      return [];
    }
  }

  private async collectActivityData(): Promise<ActivityData> {
    const timestamp = new Date();
    const activeWindow = await this.getActiveWindow();

    let keystrokes = 0;
    let mouseClicks = 0;
    let mouseScrolls = 0;

    // Get activity data from native event monitor if available
    if (this.nativeEventMonitor && this.nativeEventMonitor.isMonitoring()) {
      try {
        const counts = this.nativeEventMonitor.getCounts();

        // Calculate delta since last collection
        const deltaKeystrokes = counts.keyboard - this.lastNativeKeystrokes;
        const deltaMouseClicks = counts.mouse - this.lastNativeMouseClicks;
        const deltaMouseScrolls = counts.scrolls - this.lastNativeMouseScrolls;

        // Add delta to current period counters
        if (deltaKeystrokes > 0) {
          this.currentPeriodKeystrokes += deltaKeystrokes;
        }
        if (deltaMouseClicks > 0) {
          this.currentPeriodMouseClicks += deltaMouseClicks;
        }
        if (deltaMouseScrolls > 0) {
          this.currentPeriodMouseScrolls += deltaMouseScrolls;
        }

        // Update last known values
        this.lastNativeKeystrokes = counts.keyboard;
        this.lastNativeMouseClicks = counts.mouse;
        this.lastNativeMouseScrolls = counts.scrolls;

        // Use current period values
        keystrokes = this.currentPeriodKeystrokes;
        mouseClicks = this.currentPeriodMouseClicks;
        mouseScrolls = this.currentPeriodMouseScrolls;

        logger.debug(`[LINUX] Activity data (native): keyboard=${keystrokes}, mouse=${mouseClicks}, scrolls=${mouseScrolls}`);
      } catch (error) {
        logger.error('[LINUX] Error getting native event counts:', error);
      }
    } else if (this.nativeModuleLoaded && this.nativeEventMonitor) {
      // Native module loaded but not monitoring - try to start
      logger.debug('[LINUX] Native monitor not running, using cached values');
      keystrokes = this.currentPeriodKeystrokes;
      mouseClicks = this.currentPeriodMouseClicks;
      mouseScrolls = this.currentPeriodMouseScrolls;
    } else {
      // 🔧 FALLBACK: Use interrupt-based activity estimation
      const fallbackData = this.getFallbackActivityData();
      keystrokes = fallbackData.keystrokes;
      mouseClicks = fallbackData.mouseClicks;
      mouseScrolls = fallbackData.scrolls;

      if (keystrokes > 0 || mouseClicks > 0) {
        logger.debug(`[LINUX] Activity data (fallback): keyboard=${keystrokes}, mouse=${mouseClicks}, scrolls=${mouseScrolls}`);
      }
    }

    return {
      timestamp,
      activeWindow: activeWindow || undefined,
      keystrokes,
      mouseClicks,
      mouseMovements: 0, // Not tracked
      mouseScrolls,
      idleTime: await this.getIdleTime()
    };
  }

  private async getIdleTime(): Promise<number> {
    if (this.hasX11) {
      try {
        const { stdout } = await execAsync('xprintidle');
        return parseInt(stdout.trim());
      } catch {}
    }
    
    return 0;
  }

  private async executeShell(command: string): Promise<any> {
    try {
      const { stdout } = await execAsync(command);
      return stdout.trim();
    } catch (error) {
      throw new Error(`Shell execution failed: ${error}`);
    }
  }

  private async checkSystemdStatus(): Promise<any> {
    try {
      const { stdout } = await execAsync('systemctl --user is-system-running');
      return {
        running: true,
        status: stdout.trim()
      };
    } catch (error) {
      return {
        running: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async getDesktopInfo(): Promise<any> {
    return {
      environment: this.desktopEnvironment,
      hasX11: this.hasX11,
      hasWayland: this.hasWayland,
      display: process.env.DISPLAY,
      waylandDisplay: process.env.WAYLAND_DISPLAY,
      xdgCurrentDesktop: process.env.XDG_CURRENT_DESKTOP,
      desktopSession: process.env.DESKTOP_SESSION
    };
  }

  private async monitorDBus(service: string): Promise<any> {
    try {
      const { stdout } = await execAsync(`dbus-monitor --session "sender='${service}'"`);
      return {
        monitoring: true,
        output: stdout
      };
    } catch (error) {
      throw new Error(`D-Bus monitoring failed: ${error}`);
    }
  }

  // === Public Methods for ActivityCollectorService ===

  /**
   * Create an event listener for keyboard, mouse, and idle events
   * Used by ActivityCollectorService for real-time event monitoring
   */
  async createEventListener(options: {
    keyboard?: boolean;
    mouse?: boolean;
    idle?: boolean;
  }): Promise<EventEmitter | null> {
    logger.info('[LINUX] Creating event listener', options);

    const eventEmitter = new EventEmitter();

    // Check if native module is available
    if (!this.nativeEventMonitor) {
      logger.warn('[LINUX] Native event monitor not available for event listener');

      if (this.nativeModuleLoadError) {
        logger.warn(`[LINUX] Native module error: ${this.nativeModuleLoadError}`);
      }

      // 🔧 FALLBACK: Use shell-based activity monitoring when native module is unavailable
      logger.info('[LINUX] Attempting shell-based fallback for activity monitoring...');
      return await this.createFallbackEventListener(eventEmitter, options);
    }

    // Check permissions
    const perms = this.nativeEventMonitor.checkPermissions();
    if (!perms.hasInputAccess && !perms.hasX11Access) {
      logger.warn('[LINUX] No event monitoring backend available');
      logger.warn(`[LINUX] Missing permissions: ${perms.missingPermissions.join(', ')}`);

      // Emit permission-required event for UI notification
      eventEmitter.emit('permission-required', {
        hasInputAccess: perms.hasInputAccess,
        hasX11Access: perms.hasX11Access,
        missingPermissions: perms.missingPermissions,
        message: 'Add user to input group: sudo usermod -aG input $USER'
      });

      return null;
    }

    // Start native monitoring if not already running
    if (!this.nativeEventMonitor.isMonitoring()) {
      logger.info('[LINUX] Starting native event monitor...');
      const started = this.nativeEventMonitor.start();
      if (!started) {
        logger.error('[LINUX] Failed to start native event monitor');
        return null;
      }
      logger.info(`[LINUX] Native event monitor started using backend: ${this.nativeEventMonitor.getBackendType()}`);
    }

    // Start activity monitoring to collect data
    if (!this.monitoringActive) {
      await this.startActivityMonitoring();
    }

    // Set up polling interval to emit events
    const pollingInterval = setInterval(async () => {
      try {
        const activityData = await this.getActivityData();

        if (options.keyboard && activityData.keystrokes && activityData.keystrokes > 0) {
          eventEmitter.emit('keyboard', { count: activityData.keystrokes });
        }

        if (options.mouse) {
          if (activityData.mouseClicks && activityData.mouseClicks > 0) {
            eventEmitter.emit('mouse', {
              type: 'click',
              count: activityData.mouseClicks
            });
          }

          if (activityData.mouseScrolls && activityData.mouseScrolls > 0) {
            eventEmitter.emit('mouse', {
              type: 'scroll',
              count: activityData.mouseScrolls
            });
          }
        }

        if (options.idle && activityData.idleTime !== undefined) {
          eventEmitter.emit('idle', { time: activityData.idleTime });
        }
      } catch (error) {
        logger.error('[LINUX] Error in event listener polling:', error);
      }
    }, 1000);

    // Add stop method to the emitter for cleanup
    (eventEmitter as any).stop = async () => {
      logger.info('[LINUX] Stopping event listener');
      clearInterval(pollingInterval);

      // Don't stop native monitor here - it may be used by other consumers
      // Native monitor cleanup is handled in performCleanup
    };

    // Store reference for cleanup
    (eventEmitter as any).pollingInterval = pollingInterval;

    logger.info('[LINUX] Event listener created successfully');
    return eventEmitter;
  }

  /**
   * Called when data is successfully uploaded to the server
   * Resets activity counters for the next collection period
   */
  public onDataUploadSuccess(): void {
    logger.info('[LINUX] Data upload successful, resetting activity counters');

    try {
      // Reset native event counters
      if (this.nativeEventMonitor && this.nativeEventMonitor.isMonitoring()) {
        const result = this.nativeEventMonitor.resetCounts();
        if (result) {
          logger.debug('[LINUX] Native event counters reset successfully');
        } else {
          logger.warn('[LINUX] Failed to reset native event counters');
        }
      }

      // Reset local period counters
      this.currentPeriodKeystrokes = 0;
      this.currentPeriodMouseClicks = 0;
      this.currentPeriodMouseScrolls = 0;
      this.lastNativeKeystrokes = 0;
      this.lastNativeMouseClicks = 0;
      this.lastNativeMouseScrolls = 0;

      // Reset fallback counters
      this.resetFallbackActivityCounters();

      // Reset last activity data
      this.lastActivityData = null;

      logger.info('[LINUX] Activity counters reset complete');
    } catch (error) {
      logger.error('[LINUX] Error resetting activity counters:', error);
    }
  }

  /**
   * Check all permissions including native module input monitoring
   * Returns comprehensive permission status for all monitoring capabilities
   */
  async checkAllPermissions(): Promise<{
    screenshot: PermissionResult;
    accessibility: PermissionResult;
    inputMonitoring: PermissionResult;
  }> {
    const screenshotPerm = await this.checkScreenshotPermission();
    const accessibilityPerm = await this.checkAccessibilityPermission();

    // Check input monitoring permission via native module
    let inputPerm: PermissionResult = {
      granted: false,
      canRequest: false,
      error: 'Native event monitor not loaded'
    };

    if (this.nativeEventMonitor) {
      try {
        const status = this.nativeEventMonitor.checkPermissions();
        const hasAccess = status.hasInputAccess || status.hasX11Access;

        inputPerm = {
          granted: hasAccess,
          canRequest: !hasAccess, // Can request if not granted
          error: hasAccess
            ? undefined
            : `Missing permissions: ${status.missingPermissions.join(', ')}. ` +
              'To fix: sudo usermod -aG input $USER && reboot'
        };

        logger.debug('[LINUX] Input monitoring permission check:', {
          granted: inputPerm.granted,
          backend: status.currentBackend,
          hasInputAccess: status.hasInputAccess,
          hasX11Access: status.hasX11Access
        });
      } catch (error) {
        inputPerm = {
          granted: false,
          canRequest: false,
          error: `Permission check failed: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    } else if (this.nativeModuleLoadError) {
      inputPerm = {
        granted: false,
        canRequest: false,
        error: this.nativeModuleLoadError
      };
    }

    return {
      screenshot: screenshotPerm,
      accessibility: accessibilityPerm,
      inputMonitoring: inputPerm
    };
  }

  /**
   * Get the current native event monitor status
   * Useful for debugging and status reporting
   */
  getNativeMonitorStatus(): {
    loaded: boolean;
    available: boolean;
    monitoring: boolean;
    backend: string;
    error: string | null;
    counts: NativeEventCounts | null;
  } {
    if (!this.nativeEventMonitor) {
      return {
        loaded: this.nativeModuleLoaded,
        available: false,
        monitoring: false,
        backend: 'none',
        error: this.nativeModuleLoadError,
        counts: null
      };
    }

    try {
      return {
        loaded: true,
        available: this.nativeEventMonitor.isAvailable ? this.nativeEventMonitor.isAvailable() : true,
        monitoring: this.nativeEventMonitor.isMonitoring(),
        backend: this.nativeEventMonitor.getBackendType(),
        error: null,
        counts: this.nativeEventMonitor.getCounts()
      };
    } catch (error) {
      return {
        loaded: true,
        available: false,
        monitoring: false,
        backend: 'none',
        error: error instanceof Error ? error.message : String(error),
        counts: null
      };
    }
  }

  /**
   * Reset activity counters (helper method)
   */
  private resetActivityCounters(): void {
    this.currentPeriodKeystrokes = 0;
    this.currentPeriodMouseClicks = 0;
    this.currentPeriodMouseScrolls = 0;
    this.lastNativeKeystrokes = 0;
    this.lastNativeMouseClicks = 0;
    this.lastNativeMouseScrolls = 0;
  }

  // === Fallback Activity Monitoring ===

  // Variables for fallback monitoring
  private fallbackLastInterrupts: { keyboard: number; mouse: number } | null = null;
  private fallbackLastIdleTime: number = 0;
  private fallbackLastActiveWindow: string | null = null;
  private fallbackActivityEstimate: { keystrokes: number; mouseClicks: number; scrolls: number } = {
    keystrokes: 0,
    mouseClicks: 0,
    scrolls: 0
  };

  /**
   * Create a fallback event listener using shell commands
   * Used when native module is not available
   */
  private async createFallbackEventListener(
    eventEmitter: EventEmitter,
    options: { keyboard?: boolean; mouse?: boolean; idle?: boolean }
  ): Promise<EventEmitter | null> {
    logger.info('[LINUX] Creating fallback event listener using shell commands...');

    // Check available tools
    const hasXprintidle = await this.checkToolExists('xprintidle');
    const hasXdotool = await this.checkToolExists('xdotool');
    const hasProcInterrupts = fs.existsSync('/proc/interrupts');

    logger.info('[LINUX] Fallback tools availability:', {
      xprintidle: hasXprintidle,
      xdotool: hasXdotool,
      procInterrupts: hasProcInterrupts,
      hasX11: this.hasX11,
      hasWayland: this.hasWayland
    });

    // Need at least some capability
    if (!hasProcInterrupts && !hasXprintidle && !hasXdotool) {
      logger.warn('[LINUX] No fallback tools available. Activity monitoring will not work.');
      logger.warn('[LINUX] To enable fallback monitoring, install: sudo apt install xdotool xprintidle');
      return null;
    }

    // Initialize interrupt counters
    if (hasProcInterrupts) {
      this.fallbackLastInterrupts = await this.readInterruptCounts();
    }

    // Start activity monitoring (internal timer-based collection)
    if (!this.monitoringActive) {
      await this.startActivityMonitoring();
    }

    // Set up polling interval to emit events based on fallback methods
    const pollingInterval = setInterval(async () => {
      try {
        // Method 1: Use /proc/interrupts to estimate keyboard/mouse activity
        if (hasProcInterrupts && this.fallbackLastInterrupts) {
          const currentInterrupts = await this.readInterruptCounts();
          if (currentInterrupts) {
            const keyboardDelta = Math.max(0, currentInterrupts.keyboard - this.fallbackLastInterrupts.keyboard);
            const mouseDelta = Math.max(0, currentInterrupts.mouse - this.fallbackLastInterrupts.mouse);

            // Interrupts don't map 1:1 to keystrokes/clicks, but they indicate activity
            // We use a scaling factor to estimate actual events
            if (keyboardDelta > 0) {
              const estimatedKeystrokes = Math.ceil(keyboardDelta / 2); // Rough estimate
              this.fallbackActivityEstimate.keystrokes += estimatedKeystrokes;
              if (options.keyboard) {
                eventEmitter.emit('keyboard', { count: estimatedKeystrokes });
              }
            }

            if (mouseDelta > 0) {
              const estimatedClicks = Math.ceil(mouseDelta / 10); // Mouse generates many interrupts
              this.fallbackActivityEstimate.mouseClicks += estimatedClicks;
              if (options.mouse) {
                eventEmitter.emit('mouse', { type: 'click', count: estimatedClicks });
              }
            }

            this.fallbackLastInterrupts = currentInterrupts;
          }
        }

        // Method 2: Use idle time to detect activity
        if (hasXprintidle && options.idle) {
          const idleTime = await this.getIdleTime();
          eventEmitter.emit('idle', { time: idleTime });

          // If idle time decreased, user became active
          if (idleTime < this.fallbackLastIdleTime && this.fallbackLastIdleTime > 1000) {
            // Activity detected through idle time decrease
            logger.debug('[LINUX] Activity detected via idle time decrease');
          }
          this.fallbackLastIdleTime = idleTime;
        }

        // Method 3: Detect window changes as activity proxy
        if (hasXdotool && this.hasX11) {
          try {
            const activeWindow = await this.getActiveWindow();
            if (activeWindow && activeWindow.title !== this.fallbackLastActiveWindow) {
              // Window changed - indicates user activity
              this.fallbackLastActiveWindow = activeWindow.title;
              logger.debug('[LINUX] Activity detected via window change');
            }
          } catch {
            // Ignore xdotool errors
          }
        }
      } catch (error) {
        logger.error('[LINUX] Error in fallback event listener polling:', error);
      }
    }, 1000);

    // Add stop method to the emitter for cleanup
    (eventEmitter as any).stop = async () => {
      logger.info('[LINUX] Stopping fallback event listener');
      clearInterval(pollingInterval);
    };

    (eventEmitter as any).pollingInterval = pollingInterval;
    (eventEmitter as any).isFallback = true;

    logger.info('[LINUX] ✅ Fallback event listener created successfully');
    logger.info('[LINUX] Note: Fallback monitoring provides estimated activity counts based on system interrupts and idle time');
    return eventEmitter;
  }

  /**
   * Check if a shell tool exists
   */
  private async checkToolExists(tool: string): Promise<boolean> {
    try {
      await execAsync(`which ${tool}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read keyboard and mouse interrupt counts from /proc/interrupts
   * This provides a rough estimate of hardware-level input activity
   */
  private async readInterruptCounts(): Promise<{ keyboard: number; mouse: number } | null> {
    try {
      const content = await fs.promises.readFile('/proc/interrupts', 'utf8');
      const lines = content.split('\n');

      let keyboardCount = 0;
      let mouseCount = 0;

      for (const line of lines) {
        const lowerLine = line.toLowerCase();

        // Look for keyboard-related interrupts (i8042, keyboard, AT keyboard)
        if (lowerLine.includes('keyboard') || lowerLine.includes('i8042') || lowerLine.includes('at keyboard')) {
          const numbers = line.match(/\d+/g);
          if (numbers && numbers.length > 1) {
            // Sum all CPU columns (skip first which might be IRQ number)
            for (let i = 1; i < Math.min(numbers.length, 9); i++) {
              keyboardCount += parseInt(numbers[i]) || 0;
            }
          }
        }

        // Look for mouse-related interrupts (mouse, PS/2, i8042)
        if (lowerLine.includes('mouse') || lowerLine.includes('ps/2') ||
            (lowerLine.includes('i8042') && !lowerLine.includes('keyboard'))) {
          const numbers = line.match(/\d+/g);
          if (numbers && numbers.length > 1) {
            for (let i = 1; i < Math.min(numbers.length, 9); i++) {
              mouseCount += parseInt(numbers[i]) || 0;
            }
          }
        }
      }

      return { keyboard: keyboardCount, mouse: mouseCount };
    } catch (error) {
      logger.debug('[LINUX] Failed to read /proc/interrupts:', error);
      return null;
    }
  }

  /**
   * Get fallback activity data when native module is unavailable
   * Returns estimated counts from interrupt-based monitoring
   */
  public getFallbackActivityData(): { keystrokes: number; mouseClicks: number; scrolls: number } {
    return { ...this.fallbackActivityEstimate };
  }

  /**
   * Reset fallback activity counters
   */
  public resetFallbackActivityCounters(): void {
    this.fallbackActivityEstimate = { keystrokes: 0, mouseClicks: 0, scrolls: 0 };
    logger.info('[LINUX] Fallback activity counters reset');
  }
}

export default LinuxAdapter;