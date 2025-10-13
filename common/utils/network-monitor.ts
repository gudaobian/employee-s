/**
 * 网络监控工具类
 * 负责监控网络连接状态和服务器可用性
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { logger } from './index';

export interface NetworkStatus {
  isOnline: boolean;
  serverReachable: boolean;
  latency: number;
  lastCheck: number;
  error?: string;
}

export interface ServerHealthCheck {
  httpCheck: boolean;
  websocketCheck: boolean;
  latency: number;
  timestamp: number;
  error?: string;
}

export class NetworkMonitor extends EventEmitter {
  private isMonitoring = false;
  private checkInterval?: NodeJS.Timeout;
  private serverUrl: string = '';
  private currentStatus: NetworkStatus;
  private checkFrequency: number = 30000; // 30秒
  private timeoutMs: number = 5000; // 5秒超时
  private consecutiveFailures: number = 0;
  private maxConsecutiveFailures: number = 3;

  constructor() {
    super();
    this.currentStatus = {
      isOnline: true,
      serverReachable: false,
      latency: 0,
      lastCheck: 0
    };
  }

  /**
   * 开始网络监控
   */
  startMonitoring(serverUrl: string): void {
    if (this.isMonitoring) {
      logger.warn('[NETWORK_MONITOR] Already monitoring');
      return;
    }

    this.serverUrl = serverUrl;
    this.isMonitoring = true;

    logger.info(`[NETWORK_MONITOR] Started monitoring ${serverUrl}`);

    // 立即执行一次检查
    this.performCheck();

    // 设置定期检查
    this.checkInterval = setInterval(() => {
      this.performCheck();
    }, this.checkFrequency);

    // 监听系统网络事件（如果可用）
    this.setupSystemNetworkListeners();
  }

  /**
   * 停止网络监控
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    logger.info('[NETWORK_MONITOR] Stopped monitoring');
  }

  /**
   * 获取当前网络状态
   */
  getCurrentStatus(): NetworkStatus {
    return { ...this.currentStatus };
  }

  /**
   * 手动检查网络状态
   */
  async checkNow(): Promise<NetworkStatus> {
    return this.performCheck();
  }

  /**
   * 检查服务器健康状况
   */
  async checkServerHealth(serverUrl?: string): Promise<ServerHealthCheck> {
    const url = serverUrl || this.serverUrl;
    
    try {
      const startTime = Date.now();
      
      // HTTP健康检查
      const httpCheck = await this.httpHealthCheck(url);
      
      // WebSocket连接测试
      const websocketCheck = await this.websocketConnectionTest(url);
      
      const latency = Date.now() - startTime;
      
      return {
        httpCheck,
        websocketCheck,
        latency,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        httpCheck: false,
        websocketCheck: false,
        latency: 0,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 设置检查频率
   */
  setCheckFrequency(frequencyMs: number): void {
    if (frequencyMs < 5000) {
      logger.warn('[NETWORK_MONITOR] Check frequency too low, minimum is 5000ms');
      return;
    }

    this.checkFrequency = frequencyMs;
    
    if (this.isMonitoring) {
      this.stopMonitoring();
      this.startMonitoring(this.serverUrl);
    }
  }

  /**
   * 设置超时时间
   */
  setTimeout(timeoutMs: number): void {
    this.timeoutMs = Math.max(1000, Math.min(timeoutMs, 30000)); // 1-30秒范围
  }

  private async performCheck(): Promise<NetworkStatus> {
    try {
      const startTime = Date.now();
      
      // 首先检查基本网络连接
      const isOnline = await this.checkBasicConnectivity();
      
      // 如果基本网络可用，检查服务器
      let serverReachable = false;
      if (isOnline && this.serverUrl) {
        serverReachable = await this.checkServerReachability();
      }
      
      const latency = Date.now() - startTime;
      
      const newStatus: NetworkStatus = {
        isOnline,
        serverReachable,
        latency,
        lastCheck: Date.now()
      };

      this.updateStatus(newStatus);
      return newStatus;
      
    } catch (error) {
      const errorStatus: NetworkStatus = {
        isOnline: false,
        serverReachable: false,
        latency: 0,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.updateStatus(errorStatus);
      return errorStatus;
    }
  }

  private async checkBasicConnectivity(): Promise<boolean> {
    try {
      // 尝试连接到知名的DNS服务器
      return await this.pingHost('8.8.8.8', 53);
    } catch (error) {
      return false;
    }
  }

  private async checkServerReachability(): Promise<boolean> {
    try {
      const url = new URL(this.serverUrl);
      
      // 尝试HTTP连接
      const httpReachable = await this.httpHealthCheck(this.serverUrl);
      
      if (httpReachable) {
        return true;
      }

      // 如果HTTP失败，尝试TCP连接
      const defaultPort = url.protocol === 'https:' ? 443 : 80;
      const port = parseInt(url.port) || defaultPort;
      
      return await this.pingHost(url.hostname, port);
    } catch (error) {
      return false;
    }
  }

  private async httpHealthCheck(serverUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const url = new URL(serverUrl);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: '/health', // 尝试健康检查端点
          method: 'GET',
          timeout: this.timeoutMs,
          headers: {
            'User-Agent': 'EmployeeMonitor-NetworkCheck/1.0'
          }
        };

        const req = client.request(options, (res) => {
          // 任何HTTP响应都算作服务器可达
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        });

        req.on('error', () => {
          resolve(false);
        });

        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.end();
      } catch (error) {
        resolve(false);
      }
    });
  }

  private async websocketConnectionTest(serverUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // 使用动态导入避免在测试环境中的依赖问题
        const { io } = require('socket.io-client');
        
        const testSocket = io(serverUrl, {
          timeout: this.timeoutMs,
          forceNew: true,
          autoConnect: true
        });

        const timeout = setTimeout(() => {
          testSocket.disconnect();
          resolve(false);
        }, this.timeoutMs);

        testSocket.on('connect', () => {
          clearTimeout(timeout);
          testSocket.disconnect();
          resolve(true);
        });

        testSocket.on('error', () => {
          clearTimeout(timeout);
          testSocket.disconnect();
          resolve(false);
        });

        testSocket.on('connect_error', () => {
          clearTimeout(timeout);
          testSocket.disconnect();
          resolve(false);
        });
      } catch (error) {
        resolve(false);
      }
    });
  }

  private async pingHost(hostname: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();

      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, this.timeoutMs);

      socket.connect(port, hostname, () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(false);
      });
    });
  }

  private updateStatus(newStatus: NetworkStatus): void {
    const previousStatus = { ...this.currentStatus };
    this.currentStatus = newStatus;

    // 检查状态变化
    const statusChanged = 
      previousStatus.isOnline !== newStatus.isOnline ||
      previousStatus.serverReachable !== newStatus.serverReachable;

    if (statusChanged) {
      logger.info(`[NETWORK_MONITOR] Status changed: online=${newStatus.isOnline}, server=${newStatus.serverReachable}`);
      
      if (newStatus.isOnline && newStatus.serverReachable) {
        this.consecutiveFailures = 0;
        this.emit('online', newStatus);
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          this.emit('offline', newStatus);
        }
      }

      this.emit('status-changed', newStatus, previousStatus);
    }

    // 始终发射状态更新事件
    this.emit('status-updated', newStatus);
  }

  private setupSystemNetworkListeners(): void {
    try {
      // 在Node.js环境中，我们主要依赖定期检查
      // 但可以监听一些系统事件
      
      if (typeof process !== 'undefined') {
        // 监听进程事件
        process.on('online', () => {
          logger.debug('[NETWORK_MONITOR] Process online event detected');
          setTimeout(() => this.performCheck(), 1000);
        });
      }
    } catch (error) {
      logger.warn('[NETWORK_MONITOR] Failed to setup system network listeners:', error);
    }
  }

  /**
   * 检查是否为网络相关错误
   */
  static isNetworkError(error: any): boolean {
    if (!error) return false;
    
    const networkErrorCodes = [
      'ECONNREFUSED',
      'ECONNRESET', 
      'ETIMEDOUT',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ECONNABORTED'
    ];

    const networkErrorMessages = [
      'websocket error',
      'transport close',
      'connection refused',
      'network error',
      'timeout'
    ];

    // 检查错误码
    if (error.code && networkErrorCodes.includes(error.code)) {
      return true;
    }

    // 检查错误消息
    const errorMessage = (error.message || '').toLowerCase();
    return networkErrorMessages.some(msg => errorMessage.includes(msg));
  }
}