/**
 * 电源事件管理服务
 * 监听系统休眠/唤醒事件，提供电源状态管理
 */

import { EventEmitter } from 'events';
import { powerMonitor } from 'electron';
import logger from '../utils/logger';

export interface PowerEventData {
  timestamp: number;
}

export interface ResumeEventData extends PowerEventData {
  suspendDuration: number;
}

/**
 * 电源事件服务
 *
 * 发出以下事件:
 * - 'system-suspend': 系统即将休眠
 * - 'system-resume': 系统已唤醒
 *
 * @example
 * const powerService = new PowerEventService();
 *
 * powerService.on('system-suspend', (event) => {
 *   console.log('System suspending at:', new Date(event.timestamp));
 * });
 *
 * powerService.on('system-resume', (event) => {
 *   console.log('System resumed after', event.suspendDuration, 'ms');
 * });
 */
export class PowerEventService extends EventEmitter {
  private isSystemSuspended: boolean = false;
  private suspendTime: number = 0;

  constructor() {
    super();
    this.setupEventListeners();
  }

  /**
   * 设置电源事件监听器
   */
  private setupEventListeners(): void {
    if (!powerMonitor) {
      logger.warn('[POWER_EVENT] powerMonitor not available - not running in Electron environment');
      return;
    }

    // 系统即将休眠
    powerMonitor.on('suspend', () => {
      this.handleSuspend();
    });

    // 系统已唤醒
    powerMonitor.on('resume', () => {
      this.handleResume();
    });

    // 系统锁定/解锁
    powerMonitor.on('lock-screen', () => {
      logger.info('[POWER_EVENT] 🔒 Screen locked');
    });

    powerMonitor.on('unlock-screen', () => {
      logger.info('[POWER_EVENT] 🔓 Screen unlocked');
    });

    logger.info('[POWER_EVENT] Event listeners initialized successfully');
  }

  /**
   * 处理系统休眠事件
   */
  private handleSuspend(): void {
    this.isSystemSuspended = true;
    this.suspendTime = Date.now();

    logger.info('[POWER_EVENT] 🌙 System suspending');

    this.emit('system-suspend', {
      timestamp: this.suspendTime
    } as PowerEventData);
  }

  /**
   * 处理系统唤醒事件
   */
  private handleResume(): void {
    const resumeTime = Date.now();
    const suspendDuration = this.isSystemSuspended
      ? resumeTime - this.suspendTime
      : 0;

    logger.info('[POWER_EVENT] 🌅 System resumed from sleep', {
      suspendDuration: `${Math.round(suspendDuration / 1000)}s`
    });

    this.isSystemSuspended = false;

    this.emit('system-resume', {
      timestamp: resumeTime,
      suspendDuration
    } as ResumeEventData);
  }

  /**
   * 获取当前系统是否处于休眠状态
   */
  public isSystemSuspendedNow(): boolean {
    return this.isSystemSuspended;
  }

  /**
   * 获取上次休眠的持续时间
   * 如果当前系统正在运行，返回上次休眠的总时长
   */
  public getLastSuspendDuration(): number {
    if (!this.isSystemSuspended && this.suspendTime > 0) {
      return Date.now() - this.suspendTime;
    }
    return 0;
  }
}

export default PowerEventService;
