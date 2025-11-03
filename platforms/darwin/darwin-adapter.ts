/**
 * macOS 平台适配器 - 纯净版本
 * 只实现真实的键鼠事件监听，删除所有推断代码
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as si from 'systeminformation';
import sharp from 'sharp';

import { PlatformAdapterBase } from '../interfaces/platform-interface';
import { logger } from '../../common/utils';
import { NativeEventAdapter } from './native-event-adapter';

const execAsync = promisify(exec);

export class DarwinAdapter extends PlatformAdapterBase {
  private lastActivityData: any = null;
  private keystrokeCount = 0;
  private mouseClickCount = 0;
  private lastResetTime = Date.now();
  
  // 当前周期计数器
  private currentPeriodKeystrokes = 0;
  private currentPeriodMouseClicks = 0;
  
  // 事件监听引用
  private eventMonitorProcess: any = null;
  private activityMonitorTimer?: NodeJS.Timeout;
  private nativeEventAdapter: NativeEventAdapter | null = null;

  // === 初始化方法 ===

  protected async performInitialization(): Promise<void> {
    logger.info('Initializing macOS platform adapter');
    
    try {
      await this.checkSystemTools();
      await this.checkInitialPermissions();
      
      // 初始化原生事件适配器 - 增强错误处理
      try {
        console.log('[DARWIN_INIT] 🚀 开始初始化原生事件适配器');
        console.log('[DARWIN_INIT] 📁 当前工作目录:', process.cwd());
        console.log('[DARWIN_INIT] 📍 __dirname:', __dirname);
        console.log('[DARWIN_INIT] 🔍 process.argv0:', process.argv0);
        console.log('[DARWIN_INIT] 🔍 process.execPath:', process.execPath);
        console.log('[DARWIN_INIT] 🔍 require.main.filename:', require.main?.filename);
        
        this.nativeEventAdapter = new NativeEventAdapter();
        console.log('[DARWIN_INIT] ✅ NativeEventAdapter 实例已创建');
        
        const initResult = await this.nativeEventAdapter.initialize();
        console.log('[DARWIN_INIT] 🎯 初始化结果:', initResult);
        
        if (initResult) {
          console.log('[DARWIN_INIT] 🔧 设置事件监听器...');
          
          // 设置事件监听器
          this.nativeEventAdapter.on('keyboard-events', (count: number) => {
            this.currentPeriodKeystrokes += count;
            console.log(`[DARWIN] ✅ 原生模块检测到${count}个键盘事件 (总计: ${this.currentPeriodKeystrokes})`);
          });
          
          this.nativeEventAdapter.on('mouse-events', (count: number) => {
            this.currentPeriodMouseClicks += count;
            console.log(`[DARWIN] ✅ 原生模块检测到${count}个鼠标事件 (总计: ${this.currentPeriodMouseClicks})`);
          });
          
          this.nativeEventAdapter.on('permission-required', () => {
            logger.warn('原生事件监听需要辅助功能权限');
            console.log('[DARWIN] ⚠️  需要授权辅助功能权限');
            console.log(this.nativeEventAdapter?.getPermissionInstructions());
          });
          
          console.log('[DARWIN_INIT] ✅ 原生事件适配器完全初始化成功');
          logger.info('✅ 原生事件适配器设置完成');
        } else {
          console.log('[DARWIN_INIT] ❌ 原生事件适配器初始化返回 false');
          logger.warn('原生事件适配器初始化失败，将使用回退方案');
          this.nativeEventAdapter = null;
        }
      } catch (nativeAdapterError) {
        console.log('[DARWIN_INIT] ❌ 原生事件适配器初始化异常:', nativeAdapterError);
        console.log('[DARWIN_INIT] 📋 错误堆栈:', nativeAdapterError.stack);
        logger.error('原生事件适配器初始化异常:', nativeAdapterError);
        this.nativeEventAdapter = null;
      }
      
      logger.info('macOS platform adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize macOS adapter', error);
      throw error;
    }
  }

  protected async performCleanup(): Promise<void> {
    logger.info('Cleaning up macOS platform adapter');
    
    if (this.activityMonitorTimer) {
      clearInterval(this.activityMonitorTimer);
      this.activityMonitorTimer = undefined;
    }
    
    // 清理原生事件适配器
    if (this.nativeEventAdapter) {
      await this.nativeEventAdapter.cleanup();
      this.nativeEventAdapter = null;
    }
    
    // 停止事件监控
    if (this.eventMonitorProcess) {
      this.eventMonitorProcess.kill();
      this.eventMonitorProcess = null;
    }
    
    
    this.lastActivityData = null;
  }

  // === 计数器方法 ===

  private async getKeystrokeCount(): Promise<number> {
    // 检查原生事件适配器状态
    const nativeStatus = this.nativeEventAdapter ? {
      isMonitoring: this.nativeEventAdapter.isMonitoring(),
      counts: this.nativeEventAdapter.getCurrentCounts()
    } : { isMonitoring: false, counts: { keyboardCount: 0, mouseCount: 0, scrollCount: 0 } };

    console.log(`[DARWIN_DEBUG] 键盘计数详情:`);
    console.log(`  - 当前周期计数: ${this.currentPeriodKeystrokes}`);
    console.log(`  - 原生模块状态: ${nativeStatus.isMonitoring ? '运行中' : '未运行'}`);
    console.log(`  - 原生模块键盘计数: ${nativeStatus.counts.keyboardCount}`);

    // 🔧 新增：如果原生模块有计数但当前周期为0，说明事件没有同步
    if (nativeStatus.isMonitoring && nativeStatus.counts.keyboardCount > 0 && this.currentPeriodKeystrokes === 0) {
      console.log(`[DARWIN_DEBUG] ⚠️ 检测到计数不同步问题！`);
      console.log(`[DARWIN_DEBUG] 原生模块有${nativeStatus.counts.keyboardCount}个事件，但当前周期为0`);
      console.log(`[DARWIN_DEBUG] 💡 可能原因：定期检查未启动，直接使用原生计数`);

      // 直接使用原生模块的累计计数
      return nativeStatus.counts.keyboardCount;
    }

    if (!nativeStatus.isMonitoring && this.nativeEventAdapter) {
      console.log(`[DARWIN_DEBUG] ⚠️ 原生事件监听未运行，尝试重新启动...`);
      try {
        const startResult = await this.nativeEventAdapter.start();
        console.log(`[DARWIN_DEBUG] 重新启动结果: ${startResult}`);
      } catch (error) {
        console.log(`[DARWIN_DEBUG] ❌ 重新启动失败:`, error);
      }
    }

    return this.currentPeriodKeystrokes;
  }

  private async getMouseClickCount(): Promise<number> {
    // 检查原生事件适配器状态
    const nativeStatus = this.nativeEventAdapter ? {
      isMonitoring: this.nativeEventAdapter.isMonitoring(),
      counts: this.nativeEventAdapter.getCurrentCounts()
    } : { isMonitoring: false, counts: { keyboardCount: 0, mouseCount: 0, scrollCount: 0 } };

    console.log(`[DARWIN_DEBUG] 返回鼠标计数: ${this.currentPeriodMouseClicks} (当前周期)`);

    // 🔧 新增：如果原生模块有计数但当前周期为0，说明事件没有同步
    if (nativeStatus.isMonitoring && nativeStatus.counts.mouseCount > 0 && this.currentPeriodMouseClicks === 0) {
      console.log(`[DARWIN_DEBUG] ⚠️ 鼠标计数不同步！原生模块: ${nativeStatus.counts.mouseCount}, 当前周期: 0`);
      console.log(`[DARWIN_DEBUG] 💡 直接使用原生计数`);
      return nativeStatus.counts.mouseCount;
    }

    return this.currentPeriodMouseClicks;
  }

  private async getMouseScrollCount(): Promise<number> {
    // 检查原生事件适配器状态
    if (this.nativeEventAdapter) {
      const counts = this.nativeEventAdapter.getCurrentCounts() as { keyboardCount: number; mouseCount: number; scrollCount: number };
      const scrollCount = counts.scrollCount || 0;
      console.log(`[DARWIN_DEBUG] 返回鼠标滚动计数: ${scrollCount} (原生模块)`);

      if (this.nativeEventAdapter.isMonitoring() && scrollCount > 0) {
        return scrollCount;
      }
    }

    return 0;
  }

  // 重置计数器 - 在数据上传成功后调用
  public resetActivityCounters(): void {
    console.log(`[DARWIN_DEBUG] 数据上传成功后重置计数器: 键盘 ${this.currentPeriodKeystrokes} → 0, 鼠标 ${this.currentPeriodMouseClicks} → 0`);
    this.currentPeriodKeystrokes = 0;
    this.currentPeriodMouseClicks = 0;
    
    // 同时重置原生模块的计数器
    if (this.nativeEventAdapter) {
      this.nativeEventAdapter.resetCounts();
    }
  }
  
  // 新增：手动重置方法，供外部在数据上传成功后调用
  public onDataUploadSuccess(): void {
    console.log('[DARWIN] 收到数据上传成功通知，重置活动计数器');
    this.resetActivityCounters();
  }

  // 检查监控状态
  private checkMonitoringStatus(): void {
    console.log('[DARWIN] 🔍 检查键盘鼠标监控状态...');
    
    if (this.nativeEventAdapter) {
      const isMonitoring = this.nativeEventAdapter.isMonitoring();
      const counts = this.nativeEventAdapter.getCurrentCounts();
      
      console.log('[DARWIN] 监控状态详情:');
      console.log(`  - 原生模块运行状态: ${isMonitoring ? '✅ 运行中' : '❌ 未运行'}`);
      console.log(`  - 键盘事件计数: ${counts.keyboardCount}`);
      console.log(`  - 鼠标事件计数: ${counts.mouseCount}`);
      console.log(`  - 当前周期键盘: ${this.currentPeriodKeystrokes}`);
      console.log(`  - 当前周期鼠标: ${this.currentPeriodMouseClicks}`);
      
      if (!isMonitoring) {
        console.log('[DARWIN] ⚠️ 原生事件监听未运行！');
        console.log('[DARWIN] 💡 可能原因:');
        console.log('  1. 辅助功能权限未授权');
        console.log('  2. 原生模块编译问题');
        console.log('  3. 系统安全策略限制');
        console.log('[DARWIN] 🔧 建议解决方案:');
        console.log('  1. 打开"系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能"');
        console.log('  2. 确保应用程序已添加并勾选');
        console.log('  3. 重启应用程序');
      } else {
        console.log('[DARWIN] ✅ 键盘鼠标监控正常运行');
      }
    } else {
      console.log('[DARWIN] ❌ 原生事件适配器未初始化');
      console.log('[DARWIN] 🔧 尝试重新初始化原生事件适配器...');
      this.initializeNativeEventAdapter();
    }
  }

  // 单独的原生事件适配器初始化方法
  private async initializeNativeEventAdapter(): Promise<void> {
    try {
      console.log('[DARWIN] 🔧 重新初始化原生事件适配器...');
      this.nativeEventAdapter = new NativeEventAdapter();
      const initResult = await this.nativeEventAdapter.initialize();
      
      if (initResult) {
        console.log('[DARWIN] ✅ 原生事件适配器重新初始化成功');
        
        // 设置事件监听器
        this.nativeEventAdapter.on('keyboard-events', (count: number) => {
          this.currentPeriodKeystrokes += count;
          console.log(`[DARWIN] ✅ 检测到${count}个键盘事件 (总计: ${this.currentPeriodKeystrokes})`);
        });
        
        this.nativeEventAdapter.on('mouse-events', (count: number) => {
          this.currentPeriodMouseClicks += count;
          console.log(`[DARWIN] ✅ 检测到${count}个鼠标事件 (总计: ${this.currentPeriodMouseClicks})`);
        });
        
        this.nativeEventAdapter.on('permission-required', () => {
          console.log('[DARWIN] ⚠️ 需要授权辅助功能权限');
          console.log(this.nativeEventAdapter?.getPermissionInstructions());
        });
        
        // 尝试启动
        const startResult = await this.nativeEventAdapter.start();
        if (startResult) {
          console.log('[DARWIN] ✅ 原生事件监听启动成功');
        } else {
          console.log('[DARWIN] ❌ 原生事件监听启动失败');
        }
      } else {
        console.log('[DARWIN] ❌ 原生事件适配器重新初始化失败');
      }
    } catch (error) {
      console.error('[DARWIN] ❌ 重新初始化原生事件适配器异常:', error);
    }
  }

  // === 真实事件监听系统 ===

  async startActivityMonitoring(): Promise<void> {
    this.ensureInitialized();
    
    if (this.monitoringActive) {
      return;
    }
    
    this.monitoringActive = true;
    
    // 启动真实事件监控
    console.log('[DARWIN] 🚀 启动真实事件监控...');
    await this.startRealEventMonitoring();
    
    // 检查监控状态
    setTimeout(() => {
      this.checkMonitoringStatus();
    }, 2000); // 2秒后检查状态
    
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
    
    // 停止真实事件监控
    await this.stopRealEventMonitoring();
    
    if (this.activityMonitorTimer) {
      clearInterval(this.activityMonitorTimer);
      this.activityMonitorTimer = undefined;
    }
    
    logger.info('Activity monitoring stopped');
  }

  async getActivityData(): Promise<any> {
    this.ensureInitialized();
    
    if (this.lastActivityData) {
      return { ...this.lastActivityData };
    }
    
    return await this.collectActivityData();
  }

  private async collectActivityData(): Promise<any> {
    const timestamp = new Date();
    const activeWindow = await this.getActiveWindow();

    // 获取系统空闲时间
    const idleTime = await this.getSystemIdleTime();

    // 获取键盘和鼠标活动
    const keystrokes = await this.getKeystrokeCount();
    const mouseClicks = await this.getMouseClickCount();
    const mouseScrolls = await this.getMouseScrollCount();

    // 创建活动数据
    const activityData = {
      timestamp,
      activeWindow: activeWindow || undefined,
      keystrokes,
      mouseClicks,
      mouseScrolls, // 鼠标滚轮滚动次数
      mouseMovements: 0, // TODO: 实现鼠标移动监控
      idleTime
    };

    // 注意：不在这里重置计数器！应该等数据上传成功后再重置
    // this.resetActivityCounters(); // 移除错误的重置时机

    return activityData;
  }

  // === 真实事件监听实现 ===

  private async startRealEventMonitoring(): Promise<void> {
    try {
      console.log('[DARWIN] 🔄 启动真实键鼠事件监听');
      console.log('[DARWIN] 🔍 调试信息: nativeEventAdapter 状态:', this.nativeEventAdapter ? '已初始化' : '未初始化');
      console.log('[DARWIN] 🔍 调试信息: nativeEventAdapter 类型:', typeof this.nativeEventAdapter);
      
      // 使用原生模块
      if (this.nativeEventAdapter) {
        console.log('[DARWIN] 尝试启动原生CGEvent模块...');
        console.log('[DARWIN] 🔍 调试信息: 调用 nativeEventAdapter.start()...');
        try {
          const startResult = await this.nativeEventAdapter.start();
          console.log('[DARWIN] 🔍 调试信息: start() 返回结果:', startResult);
          if (startResult) {
            console.log('[DARWIN] ✅ 原生CGEvent模块启动成功');
            return;
          } else {
            console.log('[DARWIN] ⚠️  原生CGEvent模块启动失败');
          }
        } catch (startError) {
          console.log('[DARWIN] ❌ 原生CGEvent模块启动出现异常:', startError);
        }
      } else {
        console.log('[DARWIN] ⚠️  原生事件适配器未初始化，尝试重新初始化...');
        console.log('[DARWIN] 🔍 调试信息: this.nativeEventAdapter =', this.nativeEventAdapter);
        
        // 尝试重新初始化原生事件适配器
        try {
          console.log('[DARWIN] 🔧 重新创建原生事件适配器...');
          this.nativeEventAdapter = new NativeEventAdapter();
          const reinitResult = await this.nativeEventAdapter.initialize();
          console.log('[DARWIN] 🔍 重新初始化结果:', reinitResult);
          
          if (reinitResult) {
            console.log('[DARWIN] ✅ 原生事件适配器重新初始化成功，重新尝试启动...');
            
            // 设置事件监听器
            this.nativeEventAdapter.on('keyboard-events', (count: number) => {
              this.currentPeriodKeystrokes += count;
              console.log(`[DARWIN] ✅ 原生模块检测到${count}个键盘事件 (总计: ${this.currentPeriodKeystrokes})`);
            });
            
            this.nativeEventAdapter.on('mouse-events', (count: number) => {
              this.currentPeriodMouseClicks += count;
              console.log(`[DARWIN] ✅ 原生模块检测到${count}个鼠标事件 (总计: ${this.currentPeriodMouseClicks})`);
            });
            
            this.nativeEventAdapter.on('permission-required', () => {
              logger.warn('原生事件监听需要辅助功能权限');
              console.log('[DARWIN] ⚠️  需要授权辅助功能权限');
            });
            
            // 重新尝试启动
            const startResult = await this.nativeEventAdapter.start();
            if (startResult) {
              console.log('[DARWIN] ✅ 重新初始化后原生CGEvent模块启动成功');
              return;
            } else {
              console.log('[DARWIN] ❌ 重新初始化后启动仍然失败');
            }
          } else {
            console.log('[DARWIN] ❌ 原生事件适配器重新初始化失败');
          }
        } catch (reinitError) {
          console.log('[DARWIN] ❌ 重新初始化过程中发生异常:', reinitError);
        }
      }
      
      // 如果原生模块无法启动，显示警告但不使用回退方案
      console.log('[DARWIN] ⚠️  原生事件监听模块无法启动');
      console.log('[DARWIN] 💡 提示: 可能需要在系统偏好设置中授权辅助功能权限');
      console.log('[DARWIN] 键盘鼠标计数将保持为0，直到权限问题解决');
      
      logger.info('Real event monitoring attempted but native module not available');
    } catch (error) {
      logger.error('Failed to start real event monitoring:', error);
    }
  }

  private async stopRealEventMonitoring(): Promise<void> {
    try {
      // 停止原生事件适配器
      if (this.nativeEventAdapter) {
        console.log('[DARWIN] 停止原生事件监听');
        await this.nativeEventAdapter.stop();
      }
      
      
      // 停止其他监控进程
      if (this.eventMonitorProcess) {
        this.eventMonitorProcess.kill();
        this.eventMonitorProcess = null;
      }
      
      logger.info('Real event monitoring stopped');
    } catch (error) {
      logger.error('Failed to stop real event monitoring:', error);
    }
  }

  // 创建事件监听器（用于ActivityCollectorService）
  async createEventListener(options: { keyboard?: boolean; mouse?: boolean; idle?: boolean }): Promise<any> {
    logger.info('[DARWIN] 创建事件监听器', options);

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
        logger.error('[DARWIN] 事件监听器轮询错误:', error);
      }
    }, 1000); // 每秒轮询一次

    // 添加stop方法用于清理
    (eventEmitter as any).stop = () => {
      clearInterval(pollingInterval);
      logger.info('[DARWIN] 事件监听器已停止');
    };

    logger.info('[DARWIN] ✅ 事件监听器已创建');
    return eventEmitter;
  }

  // === 系统信息方法 (保留现有实现) ===

  async getSystemInfo(): Promise<any> {
    this.ensureInitialized();
    
    try {
      const systemVersion = await this.getSystemVersion();
      const memoryInfo = await this.getMemoryInfo();
      const cpuInfo = await this.getCpuInfo();
      const diskInfo = await this.getDiskInfo();
      
      // 添加进程信息到系统信息中
      const processes = await this.getRunningProcesses();
      
      // 获取macOS计算机名称（而不是网络主机名）
      let hostname = os.hostname();
      try {
        const computerName = execSync('scutil --get ComputerName', { encoding: 'utf-8' }).trim();
        if (computerName) {
          hostname = computerName;
        }
      } catch (error) {
        logger.warn('Failed to get ComputerName, using os.hostname() instead', error);
      }

      return {
        platform: 'macOS',
        architecture: os.arch(),
        version: systemVersion,
        hostname: hostname,
        username: os.userInfo().username,
        memory: memoryInfo,
        cpu: cpuInfo,
        disk: diskInfo,
        processes: processes // 添加进程列表
      };
    } catch (error) {
      logger.error('Failed to get system info', error);
      throw error;
    }
  }

  async getRunningProcesses(): Promise<any[]> {
    this.ensureInitialized();
    
    try {
      // 使用 systeminformation 库获取更详细的进程信息
      const processes = await si.processes();
      
      return processes.list.map(proc => ({
        pid: proc.pid,
        name: proc.name,
        executablePath: proc.command || proc.name,
        commandLine: proc.params || '',
        memoryUsage: proc.mem || 0,
        cpuUsage: proc.cpu || 0,
        startTime: proc.started ? new Date(proc.started) : new Date()
      }));
    } catch (error) {
      logger.error('Failed to get running processes', error);
      
      // 备用方案：使用 ps 命令
      try {
        const { stdout } = await execAsync('ps -eo pid,comm,etime,pmem,pcpu,args');
        const lines = stdout.split('\n').slice(1);
        const processes: any[] = [];
        
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
            executablePath: name,
            commandLine,
            memoryUsage,
            cpuUsage,
            startTime: this.parseEtimeToDate(etime)
          });
        }
        
        return processes;
      } catch (fallbackError) {
        logger.error('Fallback process list failed', fallbackError);
        return [];
      }
    }
  }

  async getActiveWindow(): Promise<any> {
    this.ensureInitialized();
    
    try {
      // 动态导入 active-win 库
      const { activeWindow } = require('../../active-win-compat');
      const activeWin = await activeWindow();
      
      if (activeWin) {
        return {
          title: activeWin.title || '',
          application: activeWin.owner?.name || '',
          pid: (activeWin.owner as any)?.pid || 0
        };
      }
      
      return null;
    } catch (error) {
      // 备用方案：使用 AppleScript
      try {
        const script = `
          tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set appName to name of frontApp
            set appPID to unix id of frontApp
            try
              set windowTitle to name of first window of frontApp
            on error
              set windowTitle to ""
            end try
            return appName & "|" & appPID & "|" & windowTitle
          end tell
        `;
        
        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
        const parts = stdout.trim().split('|');
        
        if (parts.length >= 3) {
          return {
            application: parts[0],
            pid: parseInt(parts[1]),
            title: parts[2] || ''
          };
        }
      } catch (appleScriptError) {
        logger.error('Failed to get active window with AppleScript', appleScriptError);
      }
      
      logger.error('Failed to get active window', error);
      return null;
    }
  }

  // === 权限检查方法 ===

  async requestAccessibilityPermission(): Promise<any> {
    try {
      // 在macOS上，我们无法直接请求辅助功能权限
      // 用户需要手动在系统偏好设置中授权
      return {
        granted: false,
        canRequest: false,
        error: '请在"系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能"中手动授权该应用'
      };
    } catch (error) {
      return {
        granted: false,
        canRequest: false,
        error: `无法请求辅助功能权限: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async requestScreenshotPermission(): Promise<any> {
    try {
      // 在macOS上，我们无法直接请求屏幕录制权限
      // 用户需要手动在系统偏好设置中授权
      return {
        granted: false,
        canRequest: false,
        error: '请在"系统偏好设置 > 安全性与隐私 > 隐私 > 屏幕录制"中手动授权该应用'
      };
    } catch (error) {
      return {
        granted: false,
        canRequest: false,
        error: `无法请求屏幕录制权限: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async checkAccessibilityPermission(): Promise<any> {
    try {
      // 检查辅助功能权限
      const script = `
        tell application "System Events"
          return true
        end tell
      `;
      
      await execAsync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
      
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

  async checkScreenshotPermission(): Promise<any> {
    try {
      // 优化权限检测：首先尝试实际截图测试
      try {
        // 使用screencapture命令测试是否有屏幕录制权限
        const tempPath = `/tmp/.screenshot_permission_test_${Date.now()}.png`;
        await execAsync(`screencapture -t png -x "${tempPath}" 2>/dev/null`);
        
        // 检查文件是否创建成功
        if (fs.existsSync(tempPath)) {
          const stats = fs.statSync(tempPath);
          
          // 清理测试文件
          try {
            fs.unlinkSync(tempPath);
          } catch (e) {
            // 忽略清理错误
          }
          
          // 如果文件大小大于0，说明截图成功
          if (stats.size > 0) {
            return {
              granted: true,
              canRequest: true
            };
          }
        }
      } catch (error) {
        // screencapture失败，继续其他检查方法
        console.log('[DARWIN] Screenshot test failed:', error);
      }
      
      // 如果所有检查都失败，假设没有权限（保守方法）
      return {
        granted: false,
        canRequest: true,
        error: '无法确定屏幕录制权限状态，建议在系统偏好设置 > 安全性与隐私 > 隐私 > 屏幕录制 中检查并授权'
      };
    } catch (error) {
      return {
        granted: false,
        canRequest: true,
        error: `屏幕录制权限检查失败: ${error.message}`
      };
    }
  }

  // === 系统监控方法 ===

  private async getSystemIdleTime(): Promise<number> {
    try {
      // 使用 ioreg 命令获取系统空闲时间
      const { stdout } = await execAsync('ioreg -c IOHIDSystem | grep HIDIdleTime');
      const match = stdout.match(/HIDIdleTime"=(\d+)/);
      if (match) {
        // 转换纳秒到秒
        const nanoseconds = parseInt(match[1]);
        return Math.floor(nanoseconds / 1000000000);
      }
      return 0;
    } catch (error) {
      logger.error('Failed to get system idle time', error);
      return 0;
    }
  }

  // === 系统工具方法 ===

  private async checkSystemTools(): Promise<void> {
    const requiredTools = ['screencapture', 'osascript', 'ps', 'launchctl'];
    
    for (const tool of requiredTools) {
      try {
        await execAsync(`which ${tool}`);
      } catch {
        throw new Error(`Required system tool not found: ${tool}`);
      }
    }
  }

  private async checkInitialPermissions(): Promise<void> {
    // 检查基本权限，但不阻断初始化
    const accessibilityResult = await this.checkAccessibilityPermission();
    const screenshotResult = await this.checkScreenshotPermission();
    
    logger.info('Permission status:', {
      accessibility: accessibilityResult.granted,
      screenshot: screenshotResult.granted
    });
  }

  private async getSystemVersion(): Promise<string> {
    try {
      const { stdout } = await execAsync('sw_vers -productVersion');
      return stdout.trim();
    } catch {
      return os.release();
    }
  }

  private async getMemoryInfo(): Promise<any> {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return { total, free, used };
  }

  private async getCpuInfo(): Promise<any> {
    const cpus = os.cpus();
    const model = cpus[0]?.model || 'Unknown';
    const cores = cpus.length;
    
    // 简单的 CPU 使用率获取
    const usage = await this.getCpuUsage();
    
    return { model, cores, usage };
  }

  private async getDiskInfo(): Promise<any> {
    try {
      const { stdout } = await execAsync('df -k /');
      const lines = stdout.split('\n');
      const diskLine = lines[1];
      const parts = diskLine.split(/\s+/);
      
      const total = parseInt(parts[1]) * 1024; // KB to bytes
      const used = parseInt(parts[2]) * 1024;
      const free = parseInt(parts[3]) * 1024;
      
      return { total, free, used };
    } catch {
      return { total: 0, free: 0, used: 0 };
    }
  }

  private async getCpuUsage(): Promise<number> {
    try {
      const { stdout } = await execAsync('top -l 1 -n 0 | grep "CPU usage"');
      const match = stdout.match(/(\d+\.\d+)% user/);
      return match ? parseFloat(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  private parseEtimeToDate(etime: string): Date {
    // 简化实现，实际中需要更复杂的解析
    const now = new Date();
    return new Date(now.getTime() - 60000); // 1分钟前
  }

  // === 其他必需方法 ===

  async getNetworkInfo(): Promise<any> {
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

  private getNetworkInterfaces(): any[] {
    const interfaces = os.networkInterfaces();
    const result: any[] = [];
    
    Object.entries(interfaces).forEach(([name, addrs]) => {
      if (addrs && Array.isArray(addrs)) {
        addrs.forEach((addr) => {
          if (!addr.internal && addr.family === 'IPv4') {
            result.push({
              name,
              ip: addr.address,
              mac: addr.mac,
              type: name.startsWith('en') ? 'ethernet' : 'other'
            });
          }
        });
      }
    });
    
    return result;
  }

  private async getNetworkConnections(): Promise<any[]> {
    try {
      const { stdout } = await execAsync('netstat -an');
      const lines = stdout.split('\n');
      const connections: any[] = [];
      
      for (const line of lines) {
        if (line.includes('LISTEN') || line.includes('ESTABLISHED')) {
          const parts = line.split(/\s+/);
          if (parts.length >= 4) {
            const protocol = parts[0];
            const local = parts[3].split('.');
            const localPort = parseInt(local[local.length - 1]);
            const localAddress = local.slice(0, -1).join('.');
            
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

  async takeScreenshot(options: any = {}): Promise<any> {
    this.ensureInitialized();

    try {
      const quality = options.quality || 80;
      const format = options.format || 'jpg';
      const timestamp = Date.now();

      // 步骤1: 先用 PNG 格式捕获原始截图（保证质量）
      const tempPngPath = `/tmp/screenshot-original-${timestamp}.png`;

      // -x: 禁用截图声音
      // -t png: 指定输出格式为 PNG
      let command = `screencapture -x -t png "${tempPngPath}"`;
      if (options.displayId !== undefined) {
        command += ` -D ${options.displayId}`;
      }

      await execAsync(command);

      if (!fs.existsSync(tempPngPath)) {
        return {
          success: false,
          error: 'Screenshot file not created'
        };
      }

      // 步骤2: 使用 sharp 进行分辨率缩放和压缩
      const tempJpgPath = `/tmp/screenshot-compressed-${timestamp}.${format}`;

      try {
        // 获取原始图片尺寸
        const metadata = await sharp(tempPngPath).metadata();
        logger.info(`[DARWIN] Original screenshot size: ${metadata.width}x${metadata.height}`);

        // 创建 sharp 实例
        let image = sharp(tempPngPath);

        // 如果设置了分辨率控制，进行缩放
        const maxWidth = options.maxWidth || 1920;
        const maxHeight = options.maxHeight || 1080;

        if (metadata.width && metadata.height && (metadata.width > maxWidth || metadata.height > maxHeight)) {
          image = image.resize(maxWidth, maxHeight, {
            fit: 'inside',              // 保持比例，不超过目标
            withoutEnlargement: true    // 不放大小图
          });
          logger.info(`[DARWIN] Resizing screenshot to max ${maxWidth}x${maxHeight}`);
        }

        // 转换为 JPEG 并压缩
        await image
          .jpeg({
            quality: quality,
            mozjpeg: true              // 使用 mozjpeg 引擎获得更好的压缩
          })
          .toFile(tempJpgPath);

        logger.info(`[DARWIN] Screenshot compressed with quality ${quality}, mozjpeg enabled`);

      } catch (sharpError: any) {
        logger.error(`[DARWIN] sharp compression failed: ${sharpError.message}`);
        // 如果 sharp 失败，直接使用原始 PNG
        fs.copyFileSync(tempPngPath, tempJpgPath);
      }

      // 步骤3: 读取压缩后的图片数据
      const data = await fs.promises.readFile(tempJpgPath);

      // 步骤4: 清理临时文件
      await fs.promises.unlink(tempPngPath);
      await fs.promises.unlink(tempJpgPath);

      // 记录压缩效果
      const originalStats = await fs.promises.stat(tempPngPath).catch(() => null);
      const compressedSize = data.length;

      logger.info(`Screenshot captured and compressed: ${compressedSize} bytes (quality: ${quality})`);

      return {
        success: true,
        data,
        format: format,
        size: compressedSize
      };

    } catch (error) {
      logger.error('Failed to take screenshot', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // === 自启动管理 ===

  async isAutoStartEnabled(): Promise<boolean> {
    try {
      // 使用 Electron 的原生 API 检查自启动状态
      const { app } = require('electron');
      
      if (app) {
        const loginItemSettings = app.getLoginItemSettings();
        logger.debug('Current login item settings:', loginItemSettings);
        return loginItemSettings.openAtLogin;
      } else {
        // 如果没有 Electron app 实例，回退到手动检查
        logger.warn('No Electron app instance available, checking manual plist file');
        const launchAgentPath = `${os.homedir()}/Library/LaunchAgents/com.company.employee-monitor.plist`;
        return fs.existsSync(launchAgentPath);
      }
    } catch (error) {
      logger.error('Failed to check auto start status', error);
      return false;
    }
  }

  async enableAutoStart(): Promise<boolean> {
    try {
      // 使用 Electron 的原生 API 而不是手动创建 plist 文件
      const { app } = require('electron');
      
      if (app) {
        // 设置登录项，隐藏启动
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: true,
          name: '企业安全',
          path: process.execPath
        });
        
        logger.info('Auto start enabled successfully using Electron API');
        return true;
      } else {
        // 如果没有 Electron app 实例，回退到手动方法
        logger.warn('No Electron app instance available, using manual plist method');
        return await this.enableAutoStartManual();
      }
    } catch (error) {
      logger.error('Failed to enable auto start with Electron API, trying manual method', error);
      // 如果 Electron API 失败，尝试手动方法
      return await this.enableAutoStartManual();
    }
  }

  // 手动创建 plist 文件的备用方法
  private async enableAutoStartManual(): Promise<boolean> {
    try {
      const launchAgentPath = `${os.homedir()}/Library/LaunchAgents/com.company.employee-monitor.plist`;
      const executablePath = process.execPath;
      
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.company.employee-monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>${executablePath}</string>
        <string>--start-minimized</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>`;

      // 确保目录存在
      const launchAgentDir = path.dirname(launchAgentPath);
      if (!fs.existsSync(launchAgentDir)) {
        fs.mkdirSync(launchAgentDir, { recursive: true });
      }

      // 写入plist文件
      await fs.promises.writeFile(launchAgentPath, plistContent);

      // 加载LaunchAgent
      await execAsync(`launchctl load "${launchAgentPath}"`);

      logger.info('Auto start enabled successfully using manual plist method');
      return true;
    } catch (error) {
      logger.error('Failed to enable auto start with manual method', error);
      return false;
    }
  }

  async disableAutoStart(): Promise<boolean> {
    try {
      // 使用 Electron 的原生 API 禁用自启动
      const { app } = require('electron');
      
      if (app) {
        // 禁用登录项
        app.setLoginItemSettings({
          openAtLogin: false,
          openAsHidden: false,
          name: '企业安全',
          path: process.execPath
        });
        
        logger.info('Auto start disabled successfully using Electron API');
      }
      
      // 同时清理可能存在的手动创建的 plist 文件
      await this.disableAutoStartManual();
      
      return true;
    } catch (error) {
      logger.error('Failed to disable auto start with Electron API, trying manual method', error);
      // 如果 Electron API 失败，尝试手动方法
      return await this.disableAutoStartManual();
    }
  }

  // 手动清理 plist 文件的备用方法
  private async disableAutoStartManual(): Promise<boolean> {
    try {
      const launchAgentPath = `${os.homedir()}/Library/LaunchAgents/com.company.employee-monitor.plist`;
      
      if (fs.existsSync(launchAgentPath)) {
        // 卸载LaunchAgent
        try {
          await execAsync(`launchctl unload "${launchAgentPath}"`);
        } catch (error) {
          // 忽略卸载错误，继续删除文件
          logger.warn('Failed to unload launch agent, continuing with file removal');
        }

        // 删除plist文件
        await fs.promises.unlink(launchAgentPath);
        logger.info('Manual plist file removed successfully');
      }

      return true;
    } catch (error) {
      logger.error('Failed to disable auto start with manual method', error);
      return false;
    }
  }

  // === 平台能力 ===

  getPlatformCapabilities(): string[] {
    return [
      'screenshot',
      'activity_monitoring',
      'window_tracking',
      'process_monitoring',
      'network_monitoring',
      'real_event_monitoring', // 新增：真实事件监听能力
      'accessibility_check',
      'native_permissions'
    ];
  }

  async executePlatformSpecificOperation(operation: string, params: any): Promise<any> {
    throw new Error(`Unsupported operation: ${operation}`);
  }
}

export default DarwinAdapter;