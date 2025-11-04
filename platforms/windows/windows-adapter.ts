/**
 * Windows平台适配器
 * 实现Windows特定的功能
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
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
import WindowsNativeEventAdapter from '../../native-event-monitor-win/src/native-event-adapter';
import { WindowsPermissionChecker } from './permission-checker';

const execAsync = promisify(exec);

export class WindowsAdapter extends PlatformAdapterBase {
  // 版本标识 - 用于验证是否加载了最新代码
  public readonly VERSION = '1.0.62-with-getActiveURL';

  private activityMonitorTimer?: NodeJS.Timeout;
  private lastActivityData: ActivityData | null = null;
  private nativeEventAdapter: WindowsNativeEventAdapter;
  private permissionChecker: WindowsPermissionChecker;
  private permissionChecked = false;

  constructor() {
    super();
    this.permissionChecker = new WindowsPermissionChecker();
    logger.info(`[WindowsAdapter] Constructor called - VERSION: ${this.VERSION}`);
  }

  protected async performInitialization(): Promise<void> {
    logger.info('Initializing Windows platform adapter');

    try {
      // 初始化原生事件适配器
      this.nativeEventAdapter = new WindowsNativeEventAdapter();

      // 检查原生模块是否可用
      if (this.nativeEventAdapter.isAvailable()) {
        logger.info('✅ Windows原生事件监控模块已加载');
      } else {
        logger.warn('⚠️ Windows原生事件监控模块不可用，将使用推断模式');
      }

      // 使用降级策略进行系统检查 - 失败不阻止初始化
      try {
        logger.info('[INIT] 开始系统工具和权限检查...');
        await Promise.race([
          this.performSystemChecks(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('System checks timeout')), 5000)
          )
        ]);
        logger.info('[INIT] ✅ 系统检查完成');
      } catch (error) {
        logger.warn('[INIT] ⚠️ 系统检查超时或失败，使用降级模式继续:', error instanceof Error ? error.message : 'Unknown');
        // 不抛出错误，允许降级运行
      }

      logger.info('Windows platform adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Windows adapter', error);
      throw error;
    }
  }

  /**
   * 执行系统检查（可选的，失败不影响启动）
   */
  private async performSystemChecks(): Promise<void> {
    // 检查系统工具（非阻塞）
    await this.checkSystemTools().catch(error => {
      logger.warn('[INIT] System tools check failed:', error.message);
    });

    // 检查权限（非阻塞）
    await this.checkInitialPermissions().catch(error => {
      logger.warn('[INIT] Permission check failed:', error.message);
    });
  }

  protected async performCleanup(): Promise<void> {
    logger.info('Cleaning up Windows platform adapter');
    
    if (this.activityMonitorTimer) {
      clearInterval(this.activityMonitorTimer);
      this.activityMonitorTimer = undefined;
    }
    
    // 清理原生事件适配器
    if (this.nativeEventAdapter) {
      await this.nativeEventAdapter.cleanup();
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
      const { stdout } = await execAsync('powershell "Get-Process | Select-Object ProcessName,Id,CPU,WorkingSet,StartTime,Path | ConvertTo-Json"');
      const processes = JSON.parse(stdout);
      
      const processArray = Array.isArray(processes) ? processes : [processes];
      const result: ProcessInfo[] = [];
      
      for (const proc of processArray) {
        if (!proc || !proc.ProcessName) continue;
        
        result.push({
          pid: proc.Id || 0,
          name: proc.ProcessName,
          executablePath: proc.Path || '',
          commandLine: proc.ProcessName,
          memoryUsage: proc.WorkingSet ? Math.round(proc.WorkingSet / 1024 / 1024) : 0, // MB
          cpuUsage: proc.CPU || 0,
          startTime: proc.StartTime ? new Date(proc.StartTime) : new Date()
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to get running processes', error);
      return [];
    }
  }

  async getActiveWindow(): Promise<{ title: string; application: string; pid: number } | null> {
    this.ensureInitialized();

    try {
      // 优先使用原生模块获取活动窗口（企业级方案，无PowerShell依赖）
      if (this.nativeEventAdapter && this.nativeEventAdapter.isAvailable()) {
        const nativeModule = this.nativeEventAdapter.nativeModuleRef;
        if (nativeModule && typeof nativeModule.getActiveWindow === 'function') {
          logger.info('[WINDOWS] 使用原生C++模块获取活动窗口（零PowerShell依赖）');
          const windowInfo = nativeModule.getActiveWindow();

          if (windowInfo && windowInfo.isValid) {
            logger.debug(`[WINDOWS] 活动窗口: ${windowInfo.application} - ${windowInfo.title}`);
            return {
              title: windowInfo.title || 'Unknown',
              application: windowInfo.application || 'Unknown',
              pid: windowInfo.pid || 0
            };
          } else {
            logger.warn('[WINDOWS] 原生模块返回无效窗口信息');
          }
        }
      }

      // 降级方案：使用PowerShell（可能在某些环境被阻止）
      logger.warn('[WINDOWS] 原生模块不可用，降级使用PowerShell获取活动窗口');
      const script = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.Text;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
            [DllImport("user32.dll")]
            public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, IntPtr windowTitle);
          }
"@

        $hwnd = [Win32]::GetForegroundWindow()
        $title = New-Object System.Text.StringBuilder(256)
        [Win32]::GetWindowText($hwnd, $title, $title.Capacity)

        $processId = 0
        [Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId)

        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        $processName = if($process) { $process.ProcessName } else { "Unknown" }

        # 检测UWP应用（ApplicationFrameHost）
        if ($processName -eq "ApplicationFrameHost") {
          try {
            # 尝试通过子窗口获取真实的UWP应用
            $childWindow = [Win32]::FindWindowEx($hwnd, [IntPtr]::Zero, "Windows.UI.Core.CoreWindow", [IntPtr]::Zero)

            if ($childWindow -ne [IntPtr]::Zero) {
              $childPid = 0
              [Win32]::GetWindowThreadProcessId($childWindow, [ref]$childPid)

              if ($childPid -ne 0 -and $childPid -ne $processId) {
                $childProcess = Get-Process -Id $childPid -ErrorAction SilentlyContinue
                if ($childProcess) {
                  $processName = $childProcess.ProcessName
                  $processId = $childPid

                  # 获取UWP应用的真实标题
                  $childTitle = New-Object System.Text.StringBuilder(256)
                  [Win32]::GetWindowText($childWindow, $childTitle, $childTitle.Capacity)
                  if ($childTitle.Length -gt 0) {
                    $title = $childTitle
                  }
                }
              }
            }
          } catch {
            # 如果获取UWP子窗口失败，继续使用ApplicationFrameHost
          }
        }

        $result = @{
          Title = $title.ToString()
          ProcessName = $processName
          ProcessId = $processId
        }

        $result | ConvertTo-Json
      `;

      const { stdout } = await execAsync(`powershell "${script}"`);
      const result = JSON.parse(stdout);

      if (result && result.Title) {
        return {
          title: result.Title,
          application: result.ProcessName,
          pid: result.ProcessId
        };
      }

      return null;
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
    try {
      logger.info('[WINDOWS] 检查截图权限...');

      // Windows通常不需要特殊的截屏权限
      // 在 Electron 打包应用中，复杂的 PowerShell 脚本可能会卡住
      // 因此我们采用简化的检查策略：默认允许截图，实际截图时再验证

      logger.info('[WINDOWS] Windows 默认允许应用截图，跳过复杂检查');

      return {
        granted: true,
        canRequest: false
      };

    } catch (error) {
      logger.error('[WINDOWS] 截图权限检查异常:', error);
      return {
        granted: true, // 即使检查失败，也默认允许（实际截图时会验证）
        canRequest: false
      };
    }
  }

  async requestScreenshotPermission(): Promise<PermissionResult> {
    try {
      // Windows通常不需要显式请求截屏权限
      // 但如果遇到问题，可以指导用户
      const message = `
Windows 截屏权限指导：

大多数情况下，Windows应用可以直接进行截屏。如果遇到问题：

1. 检查是否安装了截屏阻止软件
2. 检查企业安全策略是否限制截屏
3. 确保应用程序没有被安全软件阻止
4. 如果需要，可以尝试以管理员权限运行应用程序

如果问题持续存在，请联系系统管理员。
`.trim();
      
      return {
        granted: true,
        canRequest: false,
        error: message
      };
    } catch (error) {
      return {
        granted: false,
        canRequest: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async takeScreenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    this.ensureInitialized();

    try {
      const quality = options.quality || 80;
      const format = options.format || 'jpg';
      logger.info(`[WINDOWS] 开始截图... (质量: ${quality}, 格式: ${format})`);

      // 尝试使用 Node.js screenshot-desktop 包（如果可用）
      try {
        const screenshot = require('screenshot-desktop');
        logger.info('[WINDOWS] 使用 screenshot-desktop 包进行截图');

        // 先捕获原始 PNG 格式截图
        const imgBuffer = await screenshot({ format: 'png' });
        const originalSize = imgBuffer.length;
        logger.info(`[WINDOWS] 原始截图大小: ${originalSize} bytes`);

        // 获取原始图片尺寸
        const metadata = await sharp(imgBuffer).metadata();
        logger.info(`[WINDOWS] Original screenshot size: ${metadata.width}x${metadata.height}`);

        // 创建 sharp 实例
        let image = sharp(imgBuffer);

        // 如果设置了分辨率控制，进行缩放
        const maxWidth = options.maxWidth || 1920;
        const maxHeight = options.maxHeight || 1080;

        if (metadata.width && metadata.height && (metadata.width > maxWidth || metadata.height > maxHeight)) {
          image = image.resize(maxWidth, maxHeight, {
            fit: 'inside',              // 保持比例，不超过目标
            withoutEnlargement: true    // 不放大小图
          });
          logger.info(`[WINDOWS] Resizing screenshot to max ${maxWidth}x${maxHeight}`);
        }

        // 使用 sharp 压缩图片
        const compressedBuffer = await image
          .jpeg({
            quality: quality,
            mozjpeg: true  // 使用 mozjpeg 引擎获得更好的压缩率
          })
          .toBuffer();

        const compressedSize = compressedBuffer.length;
        const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

        logger.info(`[WINDOWS] ✅ 截图已压缩: ${compressedSize} bytes (压缩率: ${compressionRatio}%)`);
        logger.info(`[WINDOWS] Screenshot compressed with quality ${quality}, mozjpeg enabled`);

        return {
          success: true,
          data: compressedBuffer,
          format: format,
          size: compressedSize
        };
      } catch (requireError) {
        logger.warn('[WINDOWS] screenshot-desktop 包不可用，使用降级方案');
      }

      // 降级方案1：使用 Electron 的 desktopCapturer（如果在 Electron 环境中）
      try {
        logger.info('[WINDOWS] 尝试使用 Electron desktopCapturer');
        const { desktopCapturer } = require('electron');
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1920, height: 1080 }
        });

        if (sources && sources.length > 0) {
          const thumbnail = sources[0].thumbnail;
          const data = thumbnail.toPNG();
          logger.info(`[WINDOWS] ✅ Electron 截图成功，大小: ${data.length} bytes`);
          return {
            success: true,
            data: Buffer.from(data)
          };
        }
      } catch (electronError) {
        logger.warn('[WINDOWS] Electron desktopCapturer 不可用:', electronError instanceof Error ? electronError.message : 'Unknown');
      }

      // 降级方案2：返回失败，让上层处理
      logger.warn('[WINDOWS] ⚠️ 所有截图方案均不可用');
      return {
        success: false,
        error: 'No screenshot method available - please install screenshot-desktop package'
      };

    } catch (error) {
      logger.error('[WINDOWS] 截图失败:', error);
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
    
    // 启动原生事件监控
    if (this.nativeEventAdapter && this.nativeEventAdapter.isAvailable()) {
      logger.info('🔄 正在启动 Windows 原生事件监控...');
      const started = await this.nativeEventAdapter.startMonitoring();
      if (started) {
        logger.info('✅ Windows原生事件监控已启动');
        // 验证监控状态
        const counts = await this.nativeEventAdapter.getEventCounts();
        logger.info(`📊 监控状态: 键盘Hook=${counts.keyboardHookInstalled ? '✅' : '❌'}, 鼠标Hook=${counts.mouseHookInstalled ? '✅' : '❌'}`);
      } else {
        logger.warn('⚠️ Windows原生事件监控启动失败');
        logger.warn('💡 可能的原因:');
        logger.warn('   1. 应用程序需要管理员权限 (Windows Hook 需要提升权限)');
        logger.warn('   2. 被杀毒软件拦截');
        logger.warn('   3. 系统安全策略限制');
        logger.warn('📝 解决方案: 请右键点击应用程序图标，选择"以管理员身份运行"');
        logger.warn('⚙️ 当前使用推断模式继续运行 (功能受限)');
      }
    } else {
      logger.warn('⚠️ Windows原生事件监控模块不可用，使用推断模式');
    }
    
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
    
    // 停止原生事件监控
    if (this.nativeEventAdapter && this.nativeEventAdapter.isAvailable()) {
      const stopped = await this.nativeEventAdapter.stopMonitoring();
      if (stopped) {
        logger.info('✅ Windows原生事件监控已停止');
      }
    }
    
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

  // 数据上传成功后重置计数器
  public onDataUploadSuccess(): void {
    logger.info('[WINDOWS] 收到数据上传成功通知，重置活动计数器');
    try {
      if (this.nativeEventAdapter && this.nativeEventAdapter.isAvailable()) {
        this.nativeEventAdapter.resetCounts().then(result => {
          if (result) {
            logger.info('[WINDOWS] ✅ 原生事件计数器已重置');
          } else {
            logger.warn('[WINDOWS] ⚠️ 原生事件计数器重置失败');
          }
        }).catch(error => {
          logger.error('[WINDOWS] ❌ 重置原生事件计数器时出错:', error);
        });
      } else {
        logger.warn('[WINDOWS] ⚠️ 原生事件适配器不可用，无法重置计数器');
      }
    } catch (error) {
      logger.error('[WINDOWS] 重置活动计数器时出错:', error);
    }
  }

  // 创建事件监听器（用于ActivityCollectorService）
  async createEventListener(options: { keyboard?: boolean; mouse?: boolean; idle?: boolean }): Promise<any> {
    logger.info('[WINDOWS] 创建事件监听器', options);

    // 创建一个EventEmitter来通知事件
    const { EventEmitter } = require('events');
    const eventEmitter = new EventEmitter();

    // 启动原生活动监控（如果尚未启动）
    if (!this.monitoringActive) {
      await this.startActivityMonitoring();
    }

    // 使用定时器轮询活动数据并发送事件
    const pollingInterval = setInterval(async () => {
      try {
        const activityData = await this.getActivityData();

        if (options.keyboard && activityData.keystrokes > 0) {
          eventEmitter.emit('keyboard', { count: activityData.keystrokes });
        }

        if (options.mouse && activityData.mouseClicks > 0) {
          eventEmitter.emit('mouse', {
            type: 'click',
            count: activityData.mouseClicks
          });
        }

        if (options.mouse && activityData.mouseScrolls > 0) {
          eventEmitter.emit('mouse', {
            type: 'scroll',
            count: activityData.mouseScrolls
          });
        }

        if (options.idle && activityData.idleTime > 0) {
          const isIdle = activityData.idleTime > 30000; // 30秒阈值
          eventEmitter.emit('idle', isIdle);
        }
      } catch (error) {
        logger.error('[WINDOWS] 事件监听器轮询错误:', error);
      }
    }, 1000); // 每秒轮询一次

    // 添加stop方法用于清理
    (eventEmitter as any).stop = () => {
      clearInterval(pollingInterval);
      logger.info('[WINDOWS] 事件监听器已停止');
    };

    logger.info('[WINDOWS] ✅ 事件监听器已创建');
    return eventEmitter;
  }

  // 统一权限检查方法（BasePlatformAdapter要求）
  async checkPermissions(): Promise<any> {
    try {
      logger.info('[WINDOWS] 检查系统权限...');

      const permissions = {
        screenshot: false,
        accessibility: false,
        systemInfo: true // Windows系统信息默认可用
      };

      // 检查截图权限
      try {
        const screenshotCheck = await this.checkScreenshotPermission();
        permissions.screenshot = screenshotCheck.granted;
        logger.info(`[WINDOWS] 截图权限: ${permissions.screenshot ? '✅' : '❌'}`);
      } catch (error) {
        logger.warn('[WINDOWS] 截图权限检查失败:', error);
      }

      // 检查辅助功能权限（用于活动监控）
      try {
        const accessibilityCheck = await this.checkAccessibilityPermission();
        permissions.accessibility = accessibilityCheck.granted;
        logger.info(`[WINDOWS] 辅助功能权限: ${permissions.accessibility ? '✅' : '❌'}`);
      } catch (error) {
        logger.warn('[WINDOWS] 辅助功能权限检查失败:', error);
      }

      logger.info('[WINDOWS] ✅ 权限检查完成', permissions);
      return permissions;
    } catch (error) {
      logger.error('[WINDOWS] 权限检查失败:', error);
      return {
        screenshot: false,
        accessibility: false,
        systemInfo: true
      };
    }
  }

  async checkAccessibilityPermission(): Promise<PermissionResult> {
    try {
      // Windows上的辅助功能权限检查
      // 尝试访问其他进程的窗口信息
      await execAsync('tasklist /fo csv | findstr /i "explorer"');

      return {
        granted: true,
        canRequest: false
      };
    } catch (error) {
      return {
        granted: false,
        canRequest: true,
        error: 'Accessibility permission required'
      };
    }
  }

  async requestAccessibilityPermission(): Promise<PermissionResult> {
    try {
      const message = `
Windows 辅助功能权限：

Windows上的辅助功能权限通常通过以下方式管理：

1. 确保应用程序有足够的权限访问其他进程信息
2. 某些功能可能需要管理员权限
3. 检查企业策略是否限制进程间访问

如需要更高权限，可以尝试以管理员身份运行应用程序。
`.trim();

      return {
        granted: false,
        canRequest: true,
        error: message
      };
    } catch (error) {
      return {
        granted: false,
        canRequest: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // 请求权限（BasePlatformAdapter要求）
  async requestPermissions(): Promise<any> {
    logger.info('[WINDOWS] 请求系统权限...');

    const permissions = {
      screenshot: true,  // Windows通常不需要特殊截图权限
      accessibility: false,
      systemInfo: true
    };

    // 尝试请求辅助功能权限
    try {
      const accessibilityResult = await this.requestAccessibilityPermission();
      permissions.accessibility = accessibilityResult.granted;
    } catch (error) {
      logger.warn('[WINDOWS] 请求辅助功能权限失败:', error);
    }

    return permissions;
  }

  // 捕获指定窗口（BasePlatformAdapter要求）
  async captureWindow(windowId: string): Promise<any> {
    logger.info(`[WINDOWS] 捕获窗口: ${windowId}`);
    // Windows实现：使用takeScreenshot的窗口模式
    return await this.takeScreenshot({ format: 'png' });
  }

  // 获取进程列表（BasePlatformAdapter要求 - 别名）
  async getProcessList(): Promise<any[]> {
    return await this.getRunningProcesses();
  }

  // 窗口监控（BasePlatformAdapter要求）
  private windowMonitoringCallback?: (window: any) => void;
  private windowMonitoringInterval?: NodeJS.Timeout;

  startWindowMonitoring(callback: (window: any) => void): void {
    logger.info('[WINDOWS] 启动窗口监控');
    this.windowMonitoringCallback = callback;

    // 每秒检查活动窗口
    this.windowMonitoringInterval = setInterval(async () => {
      try {
        const activeWindow = await this.getActiveWindow();
        if (activeWindow && this.windowMonitoringCallback) {
          this.windowMonitoringCallback(activeWindow);
        }
      } catch (error) {
        logger.error('[WINDOWS] 窗口监控错误:', error);
      }
    }, 1000);
  }

  stopWindowMonitoring(): void {
    logger.info('[WINDOWS] 停止窗口监控');
    if (this.windowMonitoringInterval) {
      clearInterval(this.windowMonitoringInterval);
      this.windowMonitoringInterval = undefined;
    }
    this.windowMonitoringCallback = undefined;
  }

  // 获取平台特定能力（BasePlatformAdapter要求）
  getPlatformSpecificCapabilities(): any {
    return {
      platform: 'windows',
      nativeEventMonitoring: this.nativeEventAdapter?.isAvailable() || false,
      screenshotSupport: true,
      processMonitoring: true,
      windowTracking: true,
      autoStart: true,
      systemTray: true
    };
  }

  async isAutoStartEnabled(): Promise<boolean> {
    try {
      const appName = 'EmployeeSafety';  // 更新应用名称
      const { stdout } = await execAsync(`reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ${appName}`);

      // 检查输出是否包含应用名称和REG_SZ类型
      // 注册表查询成功时输出格式: "EmployeeSafety    REG_SZ    "path\to\app.exe" --start-minimized"
      const isEnabled = stdout.includes(appName) && stdout.includes('REG_SZ');

      logger.info(`[AUTO_START] 自启动状态检查:`, {
        appName,
        isEnabled,
        output: stdout.substring(0, 200)
      });

      return isEnabled;
    } catch (error: any) {
      // 如果注册表键不存在，会抛出错误，说明自启动未启用
      logger.info(`[AUTO_START] 自启动未启用 (注册表键不存在):`, error.message);
      return false;
    }
  }

  async enableAutoStart(): Promise<boolean> {
    try {
      const appName = 'EmployeeSafety';  // 更新应用名称
      const executablePath = process.execPath;

      // 添加 --start-minimized 参数，实现后台启动并自动启动监控服务
      // 修复引号嵌套问题：使用转义引号
      const startCommand = `\\"${executablePath}\\" --start-minimized`;

      await execAsync(`reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ${appName} /t REG_SZ /d "${startCommand}" /f`);

      logger.info('✅ 自启动已启用：后台模式 + 自动启动监控服务');
      logger.info(`自启动命令: ${startCommand}`);
      return true;
    } catch (error) {
      logger.error('Failed to enable auto start', error);
      return false;
    }
  }

  async disableAutoStart(): Promise<boolean> {
    try {
      const appName = 'EmployeeSafety';  // 更新应用名称

      await execAsync(`reg delete "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v ${appName} /f`);

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
      'win32_api'
    ];
  }

  async executePlatformSpecificOperation(operation: string, params?: any): Promise<any> {
    switch (operation) {
      case 'execute_powershell':
        return await this.executePowerShell(params.script);
      
      case 'registry_read':
        return await this.readRegistry(params.key, params.value);
      
      case 'check_process':
        return await this.checkProcess(params.processName);
      
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }

  // === Private Methods ===

  private async checkSystemTools(): Promise<void> {
    const requiredTools = ['powershell', 'reg', 'tasklist'];

    for (const tool of requiredTools) {
      try {
        // 为每个工具检查添加2秒超时保护
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Tool check timeout: ${tool}`)), 2000);
        });

        await Promise.race([
          execAsync(`where ${tool}`),
          timeoutPromise
        ]);
      } catch (error) {
        // 如果工具不存在或超时，记录警告但不阻止启动
        logger.warn(`System tool check failed for ${tool}:`, error instanceof Error ? error.message : 'Unknown error');
        // 对于关键工具，抛出错误；对于可选工具，仅警告
        if (tool === 'powershell') {
          throw new Error(`Required system tool not found or not responding: ${tool}`);
        }
      }
    }
  }

  private async checkInitialPermissions(): Promise<void> {
    // 检查基本权限，但不阻断初始化
    try {
      // 为权限检查添加超时保护，避免阻塞启动流程
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Permission check timeout')), 3000);
      });

      const accessibilityResult = await Promise.race([
        this.checkAccessibilityPermission(),
        timeoutPromise
      ]).catch((error) => {
        logger.warn('Accessibility permission check failed or timed out:', error.message);
        return { granted: false, message: 'Check failed' };
      });

      const screenshotResult = await Promise.race([
        this.checkScreenshotPermission(),
        timeoutPromise
      ]).catch((error) => {
        logger.warn('Screenshot permission check failed or timed out:', error.message);
        return { granted: false, message: 'Check failed' };
      });

      logger.info('Permission status:', {
        accessibility: accessibilityResult.granted,
        screenshot: screenshotResult.granted
      });
    } catch (error) {
      // 权限检查失败不应该阻止初始化
      logger.warn('Permission check failed, continuing initialization:', error);
    }
  }

  private async getSystemVersion(): Promise<string> {
    try {
      const { stdout } = await execAsync('ver');
      return stdout.trim();
    } catch {
      return os.release();
    }
  }

  private async getMemoryInfo(): Promise<{ total: number; free: number; used: number }> {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    
    return { total, free, used };
  }

  private async getCpuInfo(): Promise<{ model: string; cores: number; usage: number }> {
    const cpus = os.cpus();
    const model = cpus[0]?.model || 'Unknown';
    const cores = cpus.length;
    
    // 简单的CPU使用率获取
    const usage = await this.getCpuUsage();
    
    return { model, cores, usage };
  }

  private async getDiskInfo(): Promise<{ total: number; free: number; used: number }> {
    try {
      const { stdout } = await execAsync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /value');
      const lines = stdout.split('\n');
      
      let total = 0;
      let free = 0;
      
      for (const line of lines) {
        if (line.includes('FreeSpace=')) {
          free = parseInt(line.split('=')[1]);
        } else if (line.includes('Size=')) {
          total = parseInt(line.split('=')[1]);
        }
      }
      
      const used = total - free;
      return { total, free, used };
    } catch {
      return { total: 0, free: 0, used: 0 };
    }
  }

  private async getCpuUsage(): Promise<number> {
    try {
      const { stdout } = await execAsync('wmic cpu get loadpercentage /value');
      const match = stdout.match(/LoadPercentage=(\d+)/);
      return match ? parseFloat(match[1]) : 0;
    } catch {
      return 0;
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
              type: name.includes('Ethernet') ? 'ethernet' : 'other'
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
            const local = parts[1].split(':');
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

    // 获取活动窗口信息（优先使用原生C++模块，降级到PowerShell）
    const activeWindow = await this.getActiveWindow();

    // 尝试使用原生事件监控获取真实数据
    if (this.nativeEventAdapter && this.nativeEventAdapter.isAvailable()) {
      const eventData = await this.nativeEventAdapter.getEventCounts();

      if (eventData) {
        // 详细记录活动数据，帮助诊断
        logger.info(`[WINDOWS] 📊 活动数据采集:`);
        logger.info(`[WINDOWS]   - 键盘事件: ${eventData.keyboard}`);
        logger.info(`[WINDOWS]   - 鼠标点击: ${eventData.mouseClicks}`);
        logger.info(`[WINDOWS]   - 鼠标滚动: ${eventData.mouseScrolls}`);
        logger.info(`[WINDOWS]   - 空闲时间: ${eventData.idleTime}ms`);
        logger.info(`[WINDOWS]   - 监控状态: ${eventData.isMonitoring ? '✅ 活跃' : '❌ 未激活'}`);
        logger.info(`[WINDOWS]   - Hook状态: 键盘=${eventData.keyboardHookInstalled ? '✅' : '❌'}, 鼠标=${eventData.mouseHookInstalled ? '✅' : '❌'}`);

        // 如果计数为0但Hook已安装，提示可能的原因
        if (eventData.keyboard === 0 && eventData.mouseClicks === 0 && eventData.mouseScrolls === 0 &&
            eventData.keyboardHookInstalled && eventData.mouseHookInstalled) {
          logger.info('[WINDOWS]   ℹ️  计数为0可能是正常的（用户没有操作）');
        }

        return {
          timestamp,
          activeWindow: activeWindow || undefined,
          keystrokes: eventData.keyboard,
          mouseClicks: eventData.mouseClicks,
          mouseScrolls: eventData.mouseScrolls || 0, // 鼠标滚轮滚动次数
          mouseMovements: 0, // 不监控鼠标移动以避免过多事件
          idleTime: eventData.idleTime
        };
      }
    }

    // 备用方案：使用推断模式（原有的需要特殊权限的注释）
    logger.warn('[WINDOWS] ⚠️ 使用推断模式，原生事件检测不可用');
    return {
      timestamp,
      activeWindow: activeWindow || undefined,
      keystrokes: 0, // 需要特殊权限
      mouseClicks: 0, // 需要特殊权限
      mouseScrolls: 0, // 需要特殊权限
      mouseMovements: 0, // 需要特殊权限
      idleTime: 0 // 需要特殊权限
    };
  }

  private async executePowerShell(script: string): Promise<any> {
    try {
      const { stdout } = await execAsync(`powershell "${script}"`);
      return stdout.trim();
    } catch (error) {
      throw new Error(`PowerShell execution failed: ${error}`);
    }
  }

  private async readRegistry(key: string, value: string): Promise<any> {
    try {
      const { stdout } = await execAsync(`reg query "${key}" /v ${value}`);
      return stdout.trim();
    } catch (error) {
      throw new Error(`Registry read failed: ${error}`);
    }
  }

  private async checkProcess(processName: string): Promise<boolean> {
    try {
      await execAsync(`tasklist /fi "imagename eq ${processName}" | find "${processName}"`);
      return true;
    } catch (error) {
      return false;
    }
  }

  // === 权限检查助手方法 ===

  /**
   * 检查并确保 UI Automation 服务可用
   * 在执行需要 UI Automation 的操作前调用此方法
   *
   * @throws {Error} 如果服务不可用，抛出包含详细指南的错误
   * @example
   * ```typescript
   * // 在URL收集或窗口信息获取前使用
   * async getActiveURL(browserName: string): Promise<string | null> {
   *   await this.ensureUIAutomationAvailable();
   *   // 继续执行需要UI Automation的操作
   * }
   * ```
   */
  async ensureUIAutomationAvailable(): Promise<void> {
    // 如果已经检查过，直接返回（避免重复检查）
    if (this.permissionChecked) {
      return;
    }

    logger.info('[Windows] 检查 UI Automation 服务状态...');
    const result = await this.permissionChecker.checkUIAutomationAvailability();
    this.permissionChecked = true;

    if (!result.available) {
      logger.warn('[Windows] UI Automation 服务不可用');
      logger.info(result.message);

      // 抛出特定的错误类型，便于上层处理
      const error = new Error('UI_AUTOMATION_UNAVAILABLE');
      (error as any).setupGuide = result.message;
      throw error;
    }

    logger.info('[Windows] ✅ UI Automation 服务检查通过');
  }

  /**
   * 获取 UI Automation 设置的详细指南
   * 可用于向用户显示设置说明
   */
  async getUIAutomationGuide(): Promise<string> {
    const result = await this.permissionChecker.checkUIAutomationAvailability();
    return result.message;
  }

  /**
   * 尝试打开服务管理器
   * 方便用户快速配置服务
   */
  async openServicesManager(): Promise<boolean> {
    return await this.permissionChecker.openServicesManager();
  }

  /**
   * 检查是否有管理员权限
   * 某些操作需要管理员权限
   */
  async checkAdminPrivileges(): Promise<boolean> {
    return await this.permissionChecker.checkAdminPrivileges();
  }

  // === 浏览器URL采集 ===

  /**
   * 获取活动浏览器的URL
   * @param browserName 浏览器名称 (Chrome, Firefox, Edge, Brave等)
   * @returns URL字符串，失败返回null
   */
  async getActiveURL(browserName: string): Promise<string | null> {
    try {
      logger.info(`[Windows] Starting URL collection for browser: ${browserName}`);

      // 动态导入 URL 采集器
      const { WindowsURLCollector } = await import('./url-collector');
      const collector = new WindowsURLCollector();

      // 将浏览器显示名转换为进程名
      const processName = this.browserNameToProcessName(browserName);
      logger.info(`[Windows] Browser process name: ${processName}`);

      // 采集 URL
      const urlInfo = await collector.getActiveURL(processName);

      if (urlInfo) {
        logger.info(`[Windows] ✅ URL collected via ${urlInfo.collectionMethod}: ${urlInfo.url}`);

        // 记录到 URL 采集日志
        const { logURLCollected } = await import('../../common/utils/url-collect-logger');
        logURLCollected(browserName, urlInfo.url, {
          collectionMethod: urlInfo.collectionMethod,
          quality: urlInfo.quality,
          privacyLevel: 'full'
        });

        return urlInfo.url;
      } else {
        logger.info(`[Windows] ❌ Failed to collect URL for ${browserName}`);

        // 记录失败
        const { logURLCollectFailed } = await import('../../common/utils/url-collect-logger');
        logURLCollectFailed(browserName, 'No URL found via UI Automation or window title');

        return null;
      }

    } catch (error) {
      logger.error('[Windows] Failed to get active URL:', error);

      // 记录失败
      try {
        const { logURLCollectFailed } = await import('../../common/utils/url-collect-logger');
        logURLCollectFailed(browserName, error instanceof Error ? error.message : 'Unknown error');
      } catch (logError) {
        // 忽略日志错误
      }

      return null;
    }
  }

  /**
   * 将浏览器显示名转换为进程名
   */
  private browserNameToProcessName(browserName: string): string {
    const mapping: Record<string, string> = {
      'chrome': 'chrome.exe',
      'google chrome': 'chrome.exe',
      'edge': 'msedge.exe',
      'microsoft edge': 'msedge.exe',
      'firefox': 'firefox.exe',
      'mozilla firefox': 'firefox.exe',
      'brave': 'brave.exe',
      'brave browser': 'brave.exe',
      'opera': 'opera.exe'
    };

    const normalized = browserName.toLowerCase();
    return mapping[normalized] || `${normalized}.exe`;
  }
}

export default WindowsAdapter;