/**
 * Windows 平台适配器
 * 实现 Windows 特定的功能
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

export class Win32Adapter extends PlatformAdapterBase {
  private activityMonitorTimer?: NodeJS.Timeout;
  private lastActivityData: ActivityData | null = null;
  private powerShellAvailable = false;

  protected async performInitialization(): Promise<void> {
    logger.info('Initializing Windows platform adapter');
    
    try {
      // 检查 PowerShell 可用性
      await this.checkPowerShellAvailability();
      
      // 检查必需的系统工具
      await this.checkSystemTools();
      
      // 检查权限
      await this.checkInitialPermissions();
      
      logger.info('Windows platform adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Windows adapter', error);
      throw error;
    }
  }

  protected async performCleanup(): Promise<void> {
    logger.info('Cleaning up Windows platform adapter');
    
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
        platform: 'Windows',
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
      const command = this.powerShellAvailable 
        ? 'powershell "Get-Process | Select-Object Id,Name,Path,StartTime,WorkingSet,CPU | ConvertTo-Json"'
        : 'tasklist /FO CSV';
      
      const { stdout } = await execAsync(command);
      
      if (this.powerShellAvailable) {
        return this.parseProcessesFromPowerShell(stdout);
      } else {
        return this.parseProcessesFromTasklist(stdout);
      }
    } catch (error) {
      logger.error('Failed to get running processes', error);
      return [];
    }
  }

  async getActiveWindow(): Promise<{ title: string; application: string; pid: number } | null> {
    this.ensureInitialized();
    
    try {
      if (this.powerShellAvailable) {
        // 使用更简单的单行 PowerShell 命令避免复杂的脚本解析
        const command = `powershell -ExecutionPolicy Bypass -NoProfile -Command "try { $p = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1; if ($p) { @{ title = $p.MainWindowTitle; application = $p.ProcessName; pid = $p.Id } | ConvertTo-Json -Compress } else { '{\\\"title\\\":\\\"Unknown Window\\\",\\\"application\\\":\\\"Unknown Application\\\",\\\"pid\\\":0}' } } catch { '{\\\"title\\\":\\\"Unknown Window\\\",\\\"application\\\":\\\"Unknown Application\\\",\\\"pid\\\":0}' }"`;
        
        let stdout = '';
        let stderr = '';
        
        try {
          const result = await execAsync(command, { timeout: 5000 });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (execError: any) {
          logger.warn('[WIN32] PowerShell execution failed, using tasklist fallback', {
            error: execError.message,
            stderr: execError.stderr?.substring(0, 200)
          });
          
          // 直接使用 tasklist 后备方案
          return await this.getActiveWindowFallback();
        }
        
        // 安全解析 JSON，处理空输出或格式错误
        try {
          const trimmedOutput = stdout.trim();
          if (!trimmedOutput) {
            throw new Error('Empty PowerShell output');
          }
          
          const result = JSON.parse(trimmedOutput);
          return {
            title: result.title || 'Unknown Window',
            application: result.application || 'Unknown Application',
            pid: result.pid || 0
          };
        } catch (parseError) {
          logger.warn('[WIN32] Failed to parse PowerShell output, using fallback', { 
            stdout: stdout.substring(0, 100),
            stderr: stderr.substring(0, 100),
            error: parseError instanceof Error ? parseError.message : 'Unknown error'
          });
          
          return await this.getActiveWindowFallback();
        }
      } else {
        return await this.getActiveWindowFallback();
      }
    } catch (error) {
      logger.error('Failed to get active window', error);
      return await this.getActiveWindowFallback();
    }
  }

  private async getActiveWindowFallback(): Promise<{ title: string; application: string; pid: number }> {
    try {
      // 使用 tasklist 获取第一个运行中的进程
      const { stdout } = await execAsync('tasklist /FI "STATUS eq running" /FO CSV', { timeout: 3000 });
      const lines = stdout.split('\n').slice(1);
      
      if (lines.length > 0) {
        const firstProcess = lines[0].split(',');
        return {
          title: 'Unknown Window',
          application: firstProcess[0]?.replace(/"/g, '') || 'Unknown Application',
          pid: parseInt(firstProcess[1]?.replace(/"/g, '') || '0')
        };
      }
    } catch (error) {
      logger.warn('[WIN32] Tasklist fallback also failed', error);
    }
    
    // 最终后备方案
    return {
      title: 'Unknown Window',
      application: 'Unknown Application',
      pid: 0
    };
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
    // Windows 上通常不需要特殊权限来截屏
    return {
      granted: true,
      canRequest: false
    };
  }

  async requestScreenshotPermission(): Promise<PermissionResult> {
    return {
      granted: true,
      canRequest: false
    };
  }

  async takeScreenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    this.ensureInitialized();
    
    try {
      const format = options.format || 'png';
      const tempPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.${format}`);
      
      if (this.powerShellAvailable) {
        // 使用单行 PowerShell 命令避免多行脚本解析问题
        const escapedPath = tempPath.replace(/\\/g, '\\\\');
        const command = `powershell -ExecutionPolicy Bypass -NoProfile -Command "try { Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = [Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object Drawing.Bitmap $b.width, $b.height; $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.size); $bmp.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); Write-Output 'OK' } catch { Write-Error $_.Exception.Message; exit 1 }"`;
        
        try {
          const result = await execAsync(command, { timeout: 10000 });
          logger.info('[WIN32] PowerShell screenshot completed:', result.stdout);
        } catch (execError: any) {
          logger.error('[WIN32] PowerShell screenshot failed', {
            error: execError.message,
            stderr: execError.stderr?.substring(0, 200),
            stdout: execError.stdout?.substring(0, 200)
          });
          
          // 如果 PowerShell 失败，返回错误而不是尝试其他库
          return {
            success: false,
            error: `PowerShell screenshot failed: ${execError.message || 'Unknown error'}`
          };
        }
      } else {
        // PowerShell 不可用时直接返回错误
        return {
          success: false,
          error: 'Screenshot requires PowerShell which is not available'
        };
      }
      
      // 检查文件是否创建成功
      if (fs.existsSync(tempPath)) {
        const stats = await fs.promises.stat(tempPath);
        if (stats.size > 0) {
          const data = await fs.promises.readFile(tempPath);
          await fs.promises.unlink(tempPath); // 清理临时文件
          
          logger.info(`[WIN32] Screenshot captured successfully, size: ${stats.size} bytes`);
          return {
            success: true,
            data
          };
        } else {
          await fs.promises.unlink(tempPath); // 清理空文件
          logger.error('[WIN32] Screenshot file created but is empty');
          return {
            success: false,
            error: 'Screenshot file is empty'
          };
        }
      } else {
        logger.error('[WIN32] Screenshot file not created');
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
    // Windows 上通常不需要特殊的辅助功能权限
    return {
      granted: true,
      canRequest: false
    };
  }

  async requestAccessibilityPermission(): Promise<PermissionResult> {
    return {
      granted: true,
      canRequest: false
    };
  }

  async isAutoStartEnabled(): Promise<boolean> {
    try {
      const registryKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
      const appName = 'EmployeeMonitor';
      
      const { stdout } = await execAsync(`reg query "${registryKey}" /v "${appName}"`);
      return stdout.includes(appName);
    } catch (error) {
      return false;
    }
  }

  async enableAutoStart(): Promise<boolean> {
    try {
      const registryKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
      const appName = 'EmployeeMonitor';
      const executablePath = `"${process.execPath}" --start-minimized`;
      
      await execAsync(`reg add "${registryKey}" /v "${appName}" /t REG_SZ /d "${executablePath}" /f`);
      
      logger.info('Auto start enabled successfully');
      return true;
    } catch (error) {
      logger.error('Failed to enable auto start', error);
      return false;
    }
  }

  async disableAutoStart(): Promise<boolean> {
    try {
      const registryKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
      const appName = 'EmployeeMonitor';
      
      await execAsync(`reg delete "${registryKey}" /v "${appName}" /f`);
      
      logger.info('Auto start disabled successfully');
      return true;
    } catch (error) {
      logger.error('Failed to disable auto start', error);
      return false;
    }
  }

  getPlatformCapabilities(): string[] {
    return [
      'screenshot',
      'activity_monitoring',
      'window_tracking',
      'process_monitoring',
      'network_monitoring',
      'auto_start',
      'registry_access',
      'powershell_support',
      'wmi_support'
    ];
  }

  async executePlatformSpecificOperation(operation: string, params?: any): Promise<any> {
    switch (operation) {
      case 'execute_powershell':
        return await this.executePowerShell(params.script);
      
      case 'query_registry':
        return await this.queryRegistry(params.key, params.value);
      
      case 'get_service_info':
        return await this.getServiceInfo(params.serviceName);
      
      case 'check_process_privileges':
        return await this.checkProcessPrivileges();
      
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }

  // === Private Methods ===

  private async checkPowerShellAvailability(): Promise<void> {
    try {
      // 测试 PowerShell 是否可以执行并且支持我们需要的功能
      const testCommand = 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Get-Host | ConvertTo-Json -Compress"';
      const result = await execAsync(testCommand, { timeout: 5000 });
      
      if (result.stdout && result.stdout.trim()) {
        this.powerShellAvailable = true;
        logger.info('[WIN32] PowerShell is available and functional');
        
        // 测试截图相关的 .NET 程序集是否可用
        try {
          const assemblyTest = 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; Write-Output \\"OK\\""';
          await execAsync(assemblyTest, { timeout: 3000 });
          logger.info('[WIN32] PowerShell screenshot assemblies are available');
        } catch {
          logger.warn('[WIN32] PowerShell screenshot assemblies may not be available');
        }
      } else {
        throw new Error('PowerShell returned empty output');
      }
    } catch (error) {
      this.powerShellAvailable = false;
      logger.warn('[WIN32] PowerShell is not available or not functional, using fallback methods', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async checkSystemTools(): Promise<void> {
    const requiredTools = ['tasklist', 'netstat'];
    
    for (const tool of requiredTools) {
      try {
        await execAsync(`where ${tool}`);
      } catch {
        throw new Error(`Required system tool not found: ${tool}`);
      }
    }
  }

  private async checkInitialPermissions(): Promise<void> {
    // Windows 上的权限检查相对简单
    logger.info('Permission status: All required permissions available on Windows');
  }

  private async getSystemVersion(): Promise<string> {
    try {
      if (this.powerShellAvailable) {
        const { stdout } = await execAsync('powershell "(Get-WmiObject Win32_OperatingSystem).Version"');
        return stdout.trim();
      } else {
        return os.release();
      }
    } catch {
      return os.release();
    }
  }

  private async getMemoryInfo(): Promise<{ total: number; free: number; used: number }> {
    if (this.powerShellAvailable) {
      try {
        const script = `
          $os = Get-WmiObject Win32_OperatingSystem
          @{
            total = $os.TotalVisibleMemorySize * 1024
            free = $os.FreePhysicalMemory * 1024
          } | ConvertTo-Json
        `;
        
        const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '`"')}"`);
        const result = JSON.parse(stdout);
        const total = result.total;
        const free = result.free;
        const used = total - free;
        
        return { total, free, used };
      } catch {}
    }
    
    // 后备方案
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return { total, free, used };
  }

  private async getCpuInfo(): Promise<{ model: string; cores: number; usage: number }> {
    const cpus = os.cpus();
    const model = cpus[0]?.model || 'Unknown';
    const cores = cpus.length;
    
    let usage = 0;
    if (this.powerShellAvailable) {
      try {
        const { stdout } = await execAsync('powershell "Get-Counter \\"\\Processor(_Total)\\% Processor Time\\" | Select-Object -ExpandProperty CounterSamples | Select-Object -ExpandProperty CookedValue"');
        usage = 100 - parseFloat(stdout.trim());
      } catch {}
    }
    
    return { model, cores, usage };
  }

  private async getDiskInfo(): Promise<{ total: number; free: number; used: number }> {
    if (this.powerShellAvailable) {
      try {
        const script = `
          $disk = Get-WmiObject Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -First 1
          @{
            total = $disk.Size
            free = $disk.FreeSpace
          } | ConvertTo-Json
        `;
        
        const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '`"')}"`);
        const result = JSON.parse(stdout);
        const total = result.total;
        const free = result.free;
        const used = total - free;
        
        return { total, free, used };
      } catch {}
    }
    
    // 后备方案
    return { total: 0, free: 0, used: 0 };
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
              type: name.toLowerCase().includes('ethernet') ? 'ethernet' : 'wifi'
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
        if (line.includes('LISTENING') || line.includes('ESTABLISHED')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 4) {
            const protocol = parts[0];
            const localEndpoint = parts[1].split(':');
            const localPort = parseInt(localEndpoint[localEndpoint.length - 1]);
            const localAddress = localEndpoint.slice(0, -1).join(':');
            
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

  private parseProcessesFromPowerShell(stdout: string): ProcessInfo[] {
    try {
      const processes = JSON.parse(stdout);
      
      return processes.map((proc: any) => ({
        pid: proc.Id || 0,
        name: proc.Name || 'Unknown',
        executablePath: proc.Path || '',
        commandLine: proc.Path || '',
        memoryUsage: proc.WorkingSet || 0,
        cpuUsage: proc.CPU || 0,
        startTime: proc.StartTime ? new Date(proc.StartTime) : new Date()
      }));
    } catch {
      return [];
    }
  }

  private parseProcessesFromTasklist(stdout: string): ProcessInfo[] {
    try {
      const lines = stdout.split('\n').slice(1); // 跳过标题行
      const processes: ProcessInfo[] = [];
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.split(',').map(part => part.replace(/"/g, '').trim());
        if (parts.length >= 5) {
          processes.push({
            pid: parseInt(parts[1]) || 0,
            name: parts[0] || 'Unknown',
            executablePath: parts[0] || '',
            commandLine: parts[0] || '',
            memoryUsage: this.parseMemoryString(parts[4]) || 0,
            cpuUsage: 0,
            startTime: new Date()
          });
        }
      }
      
      return processes;
    } catch {
      return [];
    }
  }

  private parseMemoryString(memStr: string): number {
    // 解析内存字符串，如 "1,234 K"
    const cleaned = memStr.replace(/[^\d]/g, '');
    return parseInt(cleaned) * 1024 || 0;
  }

  private async collectActivityData(): Promise<ActivityData> {
    const timestamp = new Date();
    const activeWindow = await this.getActiveWindow();
    
    // Windows 上的活动监控实现相对复杂，需要使用 Win32 API
    // 这里提供基本的实现
    return {
      timestamp,
      activeWindow: activeWindow || undefined,
      keystrokes: 0, // 需要 Win32 API 或三方库
      mouseClicks: 0, // 需要 Win32 API 或三方库
      mouseMovements: 0, // 需要 Win32 API 或三方库
      idleTime: 0 // 可以通过 GetLastInputInfo 获取
    };
  }

  private async executePowerShell(script: string): Promise<any> {
    if (!this.powerShellAvailable) {
      throw new Error('PowerShell is not available');
    }
    
    try {
      const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '`"')}"`);
      return stdout.trim();
    } catch (error) {
      throw new Error(`PowerShell execution failed: ${error}`);
    }
  }

  private async queryRegistry(key: string, value?: string): Promise<any> {
    try {
      const command = value 
        ? `reg query "${key}" /v "${value}"`
        : `reg query "${key}"`;
      
      const { stdout } = await execAsync(command);
      return stdout;
    } catch (error) {
      throw new Error(`Registry query failed: ${error}`);
    }
  }

  private async getServiceInfo(serviceName: string): Promise<any> {
    if (this.powerShellAvailable) {
      try {
        const script = `Get-Service "${serviceName}" | ConvertTo-Json`;
        const { stdout } = await execAsync(`powershell -Command "${script}"`);
        return JSON.parse(stdout);
      } catch (error) {
        throw new Error(`Failed to get service info: ${error}`);
      }
    } else {
      throw new Error('Service info requires PowerShell');
    }
  }

  private async checkProcessPrivileges(): Promise<any> {
    if (this.powerShellAvailable) {
      try {
        const script = `
          $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
          $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
          $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
          @{
            isAdmin = $isAdmin
            user = $currentUser.Name
          } | ConvertTo-Json
        `;
        
        const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '`"')}"`);
        return JSON.parse(stdout);
      } catch (error) {
        throw new Error(`Failed to check privileges: ${error}`);
      }
    } else {
      return {
        isAdmin: false,
        user: os.userInfo().username
      };
    }
  }
}

export default Win32Adapter;