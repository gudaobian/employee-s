/**
 * 资源管理工具 - 重构版本
 * 系统资源监控和管理
 */

export interface SystemResourceInfo {
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  cpu: {
    loadAverage: number[];
    usage: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  uptime: number;
  processInfo: {
    pid: number;
    memory: NodeJS.MemoryUsage;
    uptime: number;
    cpuUsage: NodeJS.CpuUsage;
  };
}

export interface ResourceThresholds {
  memoryWarning: number;    // 内存使用警告阈值（百分比）
  memoryCritical: number;   // 内存使用严重阈值（百分比）
  diskWarning: number;      // 磁盘使用警告阈值（百分比）
  diskCritical: number;     // 磁盘使用严重阈值（百分比）
  cpuWarning: number;       // CPU使用警告阈值（百分比）
  cpuCritical: number;      // CPU使用严重阈值（百分比）
}

export class ResourceManager {
  private static instance?: ResourceManager;
  private thresholds: ResourceThresholds;
  private monitoringTimer?: NodeJS.Timeout;
  private resourceHistory: SystemResourceInfo[] = [];
  private maxHistorySize = 100;
  private listeners: Set<(info: SystemResourceInfo) => void> = new Set();

  constructor(thresholds?: Partial<ResourceThresholds>) {
    this.thresholds = {
      memoryWarning: 70,
      memoryCritical: 85,
      diskWarning: 80,
      diskCritical: 90,
      cpuWarning: 80,
      cpuCritical: 90,
      ...thresholds
    };
  }

  static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager();
    }
    return ResourceManager.instance;
  }

  /**
   * 获取当前系统资源信息
   */
  async getSystemResourceInfo(): Promise<SystemResourceInfo> {
    const os = require('os');
    const fs = require('fs').promises;
    
    try {
      // 内存信息
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsagePercent = (usedMemory / totalMemory) * 100;

      // CPU信息
      const loadAverage = os.loadavg();
      const cpuUsage = await this.getCpuUsage();

      // 磁盘信息（简化版，实际环境中可能需要更复杂的实现）
      const diskInfo = await this.getDiskInfo();

      // 进程信息
      const processMemory = process.memoryUsage();
      const processUptime = process.uptime();
      const processCpuUsage = process.cpuUsage();

      const resourceInfo: SystemResourceInfo = {
        memory: {
          total: totalMemory,
          free: freeMemory,
          used: usedMemory,
          usagePercent: memoryUsagePercent
        },
        cpu: {
          loadAverage,
          usage: cpuUsage
        },
        disk: diskInfo,
        uptime: os.uptime(),
        processInfo: {
          pid: process.pid,
          memory: processMemory,
          uptime: processUptime,
          cpuUsage: processCpuUsage
        }
      };

      // 添加到历史记录
      this.addToHistory(resourceInfo);

      // 检查阈值
      this.checkThresholds(resourceInfo);

      // 通知监听器
      this.notifyListeners(resourceInfo);

      return resourceInfo;
    } catch (error) {
      console.error('[ResourceManager] Failed to get system resource info:', error);
      throw error;
    }
  }

  /**
   * 获取CPU使用率
   */
  private async getCpuUsage(): Promise<number> {
    const os = require('os');
    
    return new Promise((resolve) => {
      const startTime = process.hrtime();
      const startUsage = process.cpuUsage();

      setTimeout(() => {
        const currentUsage = process.cpuUsage(startUsage);
        const elapsedTime = process.hrtime(startTime);
        const elapsedUsage = currentUsage.user + currentUsage.system;
        const totalElapsed = elapsedTime[0] * 1000000 + elapsedTime[1] / 1000;
        const cpuPercent = (elapsedUsage / totalElapsed) * 100;
        
        resolve(Math.min(100, Math.max(0, cpuPercent)));
      }, 100);
    });
  }

  /**
   * 获取磁盘信息（简化实现）
   */
  private async getDiskInfo(): Promise<{
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  }> {
    try {
      const fs = require('fs').promises;
      const stats = await fs.statvfs ? fs.statvfs('.') : null;
      
      if (stats) {
        const total = stats.blocks * stats.frsize;
        const free = stats.bavail * stats.frsize;
        const used = total - free;
        const usagePercent = (used / total) * 100;
        
        return { total, free, used, usagePercent };
      } else {
        // 后备方案，返回模拟数据
        return {
          total: 100 * 1024 * 1024 * 1024, // 100GB
          free: 50 * 1024 * 1024 * 1024,   // 50GB
          used: 50 * 1024 * 1024 * 1024,   // 50GB
          usagePercent: 50
        };
      }
    } catch (error) {
      console.warn('[ResourceManager] Failed to get disk info, using defaults:', error);
      return {
        total: 100 * 1024 * 1024 * 1024,
        free: 50 * 1024 * 1024 * 1024,
        used: 50 * 1024 * 1024 * 1024,
        usagePercent: 50
      };
    }
  }

  /**
   * 检查资源使用阈值
   */
  private checkThresholds(info: SystemResourceInfo): void {
    // 检查内存使用
    if (info.memory.usagePercent >= this.thresholds.memoryCritical) {
      console.error(`[ResourceManager] CRITICAL: Memory usage at ${info.memory.usagePercent.toFixed(1)}%`);
    } else if (info.memory.usagePercent >= this.thresholds.memoryWarning) {
      console.warn(`[ResourceManager] WARNING: Memory usage at ${info.memory.usagePercent.toFixed(1)}%`);
    }

    // 检查磁盘使用
    if (info.disk.usagePercent >= this.thresholds.diskCritical) {
      console.error(`[ResourceManager] CRITICAL: Disk usage at ${info.disk.usagePercent.toFixed(1)}%`);
    } else if (info.disk.usagePercent >= this.thresholds.diskWarning) {
      console.warn(`[ResourceManager] WARNING: Disk usage at ${info.disk.usagePercent.toFixed(1)}%`);
    }

    // 检查CPU使用
    if (info.cpu.usage >= this.thresholds.cpuCritical) {
      console.error(`[ResourceManager] CRITICAL: CPU usage at ${info.cpu.usage.toFixed(1)}%`);
    } else if (info.cpu.usage >= this.thresholds.cpuWarning) {
      console.warn(`[ResourceManager] WARNING: CPU usage at ${info.cpu.usage.toFixed(1)}%`);
    }
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(info: SystemResourceInfo): void {
    this.resourceHistory.push(info);
    if (this.resourceHistory.length > this.maxHistorySize) {
      this.resourceHistory.shift();
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(info: SystemResourceInfo): void {
    this.listeners.forEach(listener => {
      try {
        listener(info);
      } catch (error) {
        console.error('[ResourceManager] Error in resource listener:', error);
      }
    });
  }

  /**
   * 开始资源监控
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringTimer) {
      this.stopMonitoring();
    }

    this.monitoringTimer = setInterval(async () => {
      try {
        await this.getSystemResourceInfo();
      } catch (error) {
        console.error('[ResourceManager] Error during monitoring:', error);
      }
    }, intervalMs);

    console.log(`[ResourceManager] Started resource monitoring (interval: ${intervalMs}ms)`);
  }

  /**
   * 停止资源监控
   */
  stopMonitoring(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
      console.log('[ResourceManager] Stopped resource monitoring');
    }
  }

  /**
   * 添加资源监听器
   */
  addListener(listener: (info: SystemResourceInfo) => void): void {
    this.listeners.add(listener);
  }

  /**
   * 移除资源监听器
   */
  removeListener(listener: (info: SystemResourceInfo) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * 获取资源历史记录
   */
  getResourceHistory(): SystemResourceInfo[] {
    return [...this.resourceHistory];
  }

  /**
   * 清理资源历史记录
   */
  clearHistory(): void {
    this.resourceHistory = [];
  }

  /**
   * 更新阈值配置
   */
  updateThresholds(updates: Partial<ResourceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...updates };
  }

  /**
   * 获取当前阈值配置
   */
  getThresholds(): ResourceThresholds {
    return { ...this.thresholds };
  }

  /**
   * 格式化字节数为可读格式
   */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * 释放资源
   */
  destroy(): void {
    this.stopMonitoring();
    this.listeners.clear();
    this.resourceHistory = [];
  }
}

// 导出默认实例
export const resourceManager = ResourceManager.getInstance();

export default ResourceManager;