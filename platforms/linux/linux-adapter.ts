/**
 * Linux 平台适配器
 * 实现 Linux 特定的功能
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
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

export class LinuxAdapter extends PlatformAdapterBase {
  private activityMonitorTimer?: NodeJS.Timeout;
  private lastActivityData: ActivityData | null = null;
  private desktopEnvironment: string = 'unknown';
  private hasX11 = false;
  private hasWayland = false;

  protected async performInitialization(): Promise<void> {
    logger.info('Initializing Linux platform adapter');
    
    try {
      // 检测桌面环境
      await this.detectDesktopEnvironment();
      
      // 检查必需的系统工具
      await this.checkSystemTools();
      
      // 检查权限
      await this.checkInitialPermissions();
      
      logger.info('Linux platform adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Linux adapter', error);
      throw error;
    }
  }

  protected async performCleanup(): Promise<void> {
    logger.info('Cleaning up Linux platform adapter');
    
    if (this.activityMonitorTimer) {
      clearInterval(this.activityMonitorTimer);
      this.activityMonitorTimer = undefined;
    }
    
    this.lastActivityData = null;
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
    
    // Linux 上的活动监控实现困难，需要依赖具体的桌面环境
    return {
      timestamp,
      activeWindow: activeWindow || undefined,
      keystrokes: 0, // 需要特殊工具或库
      mouseClicks: 0, // 需要特殊工具或库
      mouseMovements: 0, // 需要特殊工具或库
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
}

export default LinuxAdapter;