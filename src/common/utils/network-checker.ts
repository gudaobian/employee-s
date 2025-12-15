/**
 * 网络检查工具 - 重构版本
 * 网络连通性监控和检查
 */

import { EventEmitter } from 'events';

export interface NetworkStatus {
  isOnline: boolean;
  latency: number; // 延迟（毫秒）
  speed: number;   // 速度估算（KB/s）
  timestamp: Date;
  error?: string;
}

export interface NetworkCheckConfig {
  checkInterval: number;    // 检查间隔（毫秒）
  timeout: number;          // 请求超时（毫秒）
  testUrls: string[];       // 测试URL列表
  maxRetries: number;       // 最大重试次数
  retryDelay: number;       // 重试延迟（毫秒）
}

export class NetworkChecker extends EventEmitter {
  private static instance?: NetworkChecker;
  private config: NetworkCheckConfig;
  private currentStatus: NetworkStatus;
  private checkTimer?: NodeJS.Timeout;
  private statusHistory: NetworkStatus[] = [];
  private maxHistorySize = 50;
  private isChecking = false;
  private consecutiveFailures = 0;

  constructor(config?: Partial<NetworkCheckConfig>) {
    super();
    
    this.config = {
      checkInterval: 30000,     // 30秒
      timeout: 5000,           // 5秒
      testUrls: [
        'https://www.google.com/generate_204',
        'https://www.baidu.com',
        'https://8.8.8.8',
        'https://1.1.1.1'
      ],
      maxRetries: 3,
      retryDelay: 1000,
      ...config
    };

    // 初始化状态
    this.currentStatus = {
      isOnline: false,
      latency: -1,
      speed: -1,
      timestamp: new Date(),
      error: 'Not checked yet'
    };
  }

  static getInstance(config?: Partial<NetworkCheckConfig>): NetworkChecker {
    if (!NetworkChecker.instance) {
      NetworkChecker.instance = new NetworkChecker(config);
    }
    return NetworkChecker.instance;
  }

  /**
   * 开始网络监控
   */
  startMonitoring(): void {
    if (this.checkTimer) {
      this.stopMonitoring();
    }

    // 立即执行一次检查
    this.performNetworkCheck();

    // 设置定时检查
    this.checkTimer = setInterval(() => {
      if (!this.isChecking) {
        this.performNetworkCheck();
      }
    }, this.config.checkInterval);

    console.log(`[NetworkChecker] Started monitoring (interval: ${this.config.checkInterval}ms)`);
  }

  /**
   * 停止网络监控
   */
  stopMonitoring(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
      console.log('[NetworkChecker] Stopped monitoring');
    }
  }

  /**
   * 手动执行网络检查
   */
  async checkNetwork(): Promise<NetworkStatus> {
    return this.performNetworkCheck();
  }

  /**
   * 获取当前网络状态
   */
  getCurrentStatus(): NetworkStatus {
    return { ...this.currentStatus };
  }

  /**
   * 获取网络状态历史
   */
  getStatusHistory(): NetworkStatus[] {
    return [...this.statusHistory];
  }

  /**
   * 检查是否在线
   */
  isOnline(): boolean {
    return this.currentStatus.isOnline;
  }

  /**
   * 获取平均延迟
   */
  getAverageLatency(): number {
    const validLatencies = this.statusHistory
      .filter(status => status.isOnline && status.latency > 0)
      .map(status => status.latency);
    
    if (validLatencies.length === 0) {
      return -1;
    }
    
    return validLatencies.reduce((sum, latency) => sum + latency, 0) / validLatencies.length;
  }

  /**
   * 获取网络稳定性评分（0-100）
   */
  getStabilityScore(): number {
    if (this.statusHistory.length < 10) {
      return -1; // 数据不足
    }

    const recent = this.statusHistory.slice(-20); // 最近20次检查
    const onlineCount = recent.filter(status => status.isOnline).length;
    
    return Math.round((onlineCount / recent.length) * 100);
  }

  /**
   * 执行网络检查
   */
  private async performNetworkCheck(): Promise<NetworkStatus> {
    if (this.isChecking) {
      return this.currentStatus;
    }

    this.isChecking = true;
    const startTime = Date.now();
    
    try {
      // 尝试多个URL
      const results = await Promise.allSettled(
        this.config.testUrls.map(url => this.testUrl(url))
      );
      
      // 分析结果
      const successfulResults = results
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<{ latency: number; speed: number }>).value);
      
      if (successfulResults.length === 0) {
        // 所有测试失败
        throw new Error('All network tests failed');
      }
      
      // 计算平均延迟和速度
      const avgLatency = successfulResults.reduce((sum, result) => sum + result.latency, 0) / successfulResults.length;
      const avgSpeed = successfulResults.reduce((sum, result) => sum + result.speed, 0) / successfulResults.length;
      
      const newStatus: NetworkStatus = {
        isOnline: true,
        latency: Math.round(avgLatency),
        speed: Math.round(avgSpeed),
        timestamp: new Date()
      };
      
      this.updateStatus(newStatus);
      this.consecutiveFailures = 0;
      
      return newStatus;
      
    } catch (error) {
      const newStatus: NetworkStatus = {
        isOnline: false,
        latency: -1,
        speed: -1,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error)
      };
      
      this.updateStatus(newStatus);
      this.consecutiveFailures++;
      
      // 如果连续失败，发出警告
      if (this.consecutiveFailures >= 3) {
        this.emit('networkDown', {
          consecutiveFailures: this.consecutiveFailures,
          lastError: newStatus.error
        });
      }
      
      return newStatus;
      
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 测试单个URL
   */
  private async testUrl(url: string): Promise<{ latency: number; speed: number }> {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? require('https') : require('http');
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        timeout: this.config.timeout,
        headers: {
          'User-Agent': 'NetworkChecker/1.0'
        }
      };
      
      const req = httpModule.request(options, (res: any) => {
        const endTime = Date.now();
        const latency = endTime - startTime;
        
        // 简单的速度估算（基于延迟）
        const speed = latency > 0 ? Math.max(1, Math.round(1000 / latency * 10)) : 1;
        
        resolve({ latency, speed });
      });
      
      req.on('error', (error: any) => {
        reject(new Error(`${url}: ${error.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`${url}: Timeout`));
      });
      
      req.setTimeout(this.config.timeout);
      req.end();
    });
  }

  /**
   * 更新网络状态
   */
  private updateStatus(newStatus: NetworkStatus): void {
    const wasOnline = this.currentStatus.isOnline;
    const isNowOnline = newStatus.isOnline;
    
    // 更新当前状态
    this.currentStatus = newStatus;
    
    // 添加到历史
    this.statusHistory.push(newStatus);
    if (this.statusHistory.length > this.maxHistorySize) {
      this.statusHistory.shift();
    }
    
    // 发出事件
    this.emit('statusUpdate', newStatus);
    
    // 网络状态改变时发出专门事件
    if (wasOnline !== isNowOnline) {
      if (isNowOnline) {
        this.emit('networkUp', newStatus);
        console.log('[NetworkChecker] Network connection restored');
      } else {
        this.emit('networkDown', newStatus);
        console.warn('[NetworkChecker] Network connection lost');
      }
    }
  }

  /**
   * 等待网络连通
   */
  async waitForConnection(timeout?: number): Promise<NetworkStatus> {
    if (this.currentStatus.isOnline) {
      return this.currentStatus;
    }
    
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;
      
      // 设置超时
      if (timeout) {
        timeoutId = setTimeout(() => {
          this.off('networkUp', onNetworkUp);
          reject(new Error(`Network connection timeout after ${timeout}ms`));
        }, timeout);
      }
      
      // 网络连通监听器
      const onNetworkUp = (status: NetworkStatus) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(status);
      };
      
      this.once('networkUp', onNetworkUp);
    });
  }

  /**
   * 获取网络诈断信息
   */
  getDiagnostics(): {
    currentStatus: NetworkStatus;
    averageLatency: number;
    stabilityScore: number;
    consecutiveFailures: number;
    totalChecks: number;
    config: NetworkCheckConfig;
  } {
    return {
      currentStatus: { ...this.currentStatus },
      averageLatency: this.getAverageLatency(),
      stabilityScore: this.getStabilityScore(),
      consecutiveFailures: this.consecutiveFailures,
      totalChecks: this.statusHistory.length,
      config: { ...this.config }
    };
  }

  /**
   * 重置统计数据
   */
  resetStats(): void {
    this.statusHistory = [];
    this.consecutiveFailures = 0;
    console.log('[NetworkChecker] Statistics reset');
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<NetworkCheckConfig>): void {
    const wasMonitoring = !!this.checkTimer;
    
    if (wasMonitoring) {
      this.stopMonitoring();
    }
    
    this.config = { ...this.config, ...updates };
    
    if (wasMonitoring) {
      this.startMonitoring();
    }
    
    console.log('[NetworkChecker] Configuration updated');
  }

  /**
   * 释放资源
   */
  destroy(): void {
    this.stopMonitoring();
    this.removeAllListeners();
    this.statusHistory = [];
    console.log('[NetworkChecker] Destroyed');
  }
}

// 导出默认实例
export const networkChecker = NetworkChecker.getInstance();

// 便捷函数
export const isOnline = (): boolean => {
  return networkChecker.isOnline();
};

export const checkNetwork = (): Promise<NetworkStatus> => {
  return networkChecker.checkNetwork();
};

export const waitForConnection = (timeout?: number): Promise<NetworkStatus> => {
  return networkChecker.waitForConnection(timeout);
};

export const startNetworkMonitoring = (): void => {
  networkChecker.startMonitoring();
};

export const stopNetworkMonitoring = (): void => {
  networkChecker.stopMonitoring();
};

export default NetworkChecker;