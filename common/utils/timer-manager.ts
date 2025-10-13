/**
 * 定时器管理工具 - 重构版本
 * 统一管理定时器和间隔器
 */

export interface TimerInfo {
  id: string;
  type: 'timeout' | 'interval';
  callback: Function;
  delay: number;
  startTime: Date;
  isActive: boolean;
  description?: string;
}

export class TimerManager {
  private static instance?: TimerManager;
  private timers = new Map<string, {
    timer: NodeJS.Timeout;
    info: TimerInfo;
  }>();
  private nextId = 1;

  static getInstance(): TimerManager {
    if (!TimerManager.instance) {
      TimerManager.instance = new TimerManager();
    }
    return TimerManager.instance;
  }

  /**
   * 创建一个管理的定时器
   */
  setTimeout(
    callback: Function,
    delay: number,
    description?: string
  ): string {
    const id = this.generateId();
    
    const timer = setTimeout(() => {
      try {
        callback();
      } catch (error) {
        console.error(`[TimerManager] Error in timeout ${id}:`, error);
      } finally {
        this.clearTimeout(id);
      }
    }, delay);

    const info: TimerInfo = {
      id,
      type: 'timeout',
      callback,
      delay,
      startTime: new Date(),
      isActive: true,
      description
    };

    this.timers.set(id, { timer, info });
    return id;
  }

  /**
   * 创建一个管理的间隔器
   */
  setInterval(
    callback: Function,
    interval: number,
    description?: string
  ): string {
    const id = this.generateId();
    
    const timer = setInterval(() => {
      try {
        callback();
      } catch (error) {
        console.error(`[TimerManager] Error in interval ${id}:`, error);
      }
    }, interval);

    const info: TimerInfo = {
      id,
      type: 'interval',
      callback,
      delay: interval,
      startTime: new Date(),
      isActive: true,
      description
    };

    this.timers.set(id, { timer, info });
    return id;
  }

  /**
   * 清除指定的定时器
   */
  clearTimeout(id: string): boolean {
    const timerEntry = this.timers.get(id);
    if (!timerEntry) {
      return false;
    }

    clearTimeout(timerEntry.timer);
    this.timers.delete(id);
    return true;
  }

  /**
   * 清除指定的间隔器
   */
  clearInterval(id: string): boolean {
    const timerEntry = this.timers.get(id);
    if (!timerEntry) {
      return false;
    }

    clearInterval(timerEntry.timer);
    this.timers.delete(id);
    return true;
  }

  /**
   * 清除指定的定时器（通用方法）
   */
  clear(id: string): boolean {
    const timerEntry = this.timers.get(id);
    if (!timerEntry) {
      return false;
    }

    if (timerEntry.info.type === 'timeout') {
      clearTimeout(timerEntry.timer);
    } else {
      clearInterval(timerEntry.timer);
    }

    this.timers.delete(id);
    return true;
  }

  /**
   * 清除所有定时器
   */
  clearAll(): number {
    const count = this.timers.size;
    
    this.timers.forEach((timerEntry, id) => {
      if (timerEntry.info.type === 'timeout') {
        clearTimeout(timerEntry.timer);
      } else {
        clearInterval(timerEntry.timer);
      }
    });

    this.timers.clear();
    return count;
  }

  /**
   * 清除指定类型的定时器
   */
  clearByType(type: 'timeout' | 'interval'): number {
    let count = 0;
    const toRemove: string[] = [];

    this.timers.forEach((timerEntry, id) => {
      if (timerEntry.info.type === type) {
        if (type === 'timeout') {
          clearTimeout(timerEntry.timer);
        } else {
          clearInterval(timerEntry.timer);
        }
        toRemove.push(id);
        count++;
      }
    });

    toRemove.forEach(id => this.timers.delete(id));
    return count;
  }

  /**
   * 清除匹配描述的定时器
   */
  clearByDescription(description: string): number {
    let count = 0;
    const toRemove: string[] = [];

    this.timers.forEach((timerEntry, id) => {
      if (timerEntry.info.description === description) {
        if (timerEntry.info.type === 'timeout') {
          clearTimeout(timerEntry.timer);
        } else {
          clearInterval(timerEntry.timer);
        }
        toRemove.push(id);
        count++;
      }
    });

    toRemove.forEach(id => this.timers.delete(id));
    return count;
  }

  /**
   * 获取定时器信息
   */
  getTimerInfo(id: string): TimerInfo | null {
    const timerEntry = this.timers.get(id);
    return timerEntry ? { ...timerEntry.info } : null;
  }

  /**
   * 获取所有活跃定时器信息
   */
  getAllTimers(): TimerInfo[] {
    return Array.from(this.timers.values()).map(entry => ({ ...entry.info }));
  }

  /**
   * 获取指定类型的定时器数量
   */
  getTimerCount(type?: 'timeout' | 'interval'): number {
    if (!type) {
      return this.timers.size;
    }

    let count = 0;
    this.timers.forEach(entry => {
      if (entry.info.type === type) {
        count++;
      }
    });
    return count;
  }

  /**
   * 检查定时器是否存在
   */
  exists(id: string): boolean {
    return this.timers.has(id);
  }

  /**
   * 获取定时器统计信息
   */
  getStats(): {
    total: number;
    timeouts: number;
    intervals: number;
    oldestTimer: Date | null;
  } {
    let timeouts = 0;
    let intervals = 0;
    let oldestTimer: Date | null = null;

    this.timers.forEach(entry => {
      if (entry.info.type === 'timeout') {
        timeouts++;
      } else {
        intervals++;
      }

      if (!oldestTimer || entry.info.startTime < oldestTimer) {
        oldestTimer = entry.info.startTime;
      }
    });

    return {
      total: this.timers.size,
      timeouts,
      intervals,
      oldestTimer
    };
  }

  /**
   * 创建延迟Promise
   */
  delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.setTimeout(() => resolve(), ms, `delay-${ms}ms`);
    });
  }

  /**
   * 创建可取消的延迟Promise
   */
  cancellableDelay(ms: number): {
    promise: Promise<void>;
    cancel: () => boolean;
  } {
    let timerId: string;
    
    const promise = new Promise<void>(resolve => {
      timerId = this.setTimeout(() => resolve(), ms, `cancellable-delay-${ms}ms`);
    });

    const cancel = () => this.clear(timerId);

    return { promise, cancel };
  }

  /**
   * 创建重试定时器
   */
  retry(
    callback: () => Promise<boolean> | boolean,
    maxAttempts: number,
    delayMs: number,
    backoffMultiplier: number = 1.5
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let attempts = 0;
      let currentDelay = delayMs;

      const attempt = async () => {
        attempts++;
        
        try {
          const result = await callback();
          if (result) {
            resolve(true);
            return;
          }
        } catch (error) {
          console.warn(`[TimerManager] Retry attempt ${attempts} failed:`, error);
        }

        if (attempts >= maxAttempts) {
          resolve(false);
          return;
        }

        this.setTimeout(
          attempt,
          currentDelay,
          `retry-attempt-${attempts + 1}`
        );
        currentDelay *= backoffMultiplier;
      };

      attempt();
    });
  }

  /**
   * 创建定期清理器
   */
  startPeriodicCleanup(intervalMs: number = 300000): string {
    return this.setInterval(
      () => {
        const stats = this.getStats();
        console.debug(`[TimerManager] Cleanup check - Active timers: ${stats.total} (${stats.timeouts} timeouts, ${stats.intervals} intervals)`);
        
        // 这里可以添加清理逻辑，比如清理过期的定时器等
      },
      intervalMs,
      'periodic-cleanup'
    );
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `timer_${Date.now()}_${this.nextId++}`;
  }

  /**
   * 释放资源
   */
  destroy(): void {
    const count = this.clearAll();
    console.log(`[TimerManager] Destroyed - Cleared ${count} timers`);
  }
}

// 导出默认实例
export const timerManager = TimerManager.getInstance();

// 便捷函数
export const managedSetTimeout = (callback: Function, delay: number, description?: string): string => {
  return timerManager.setTimeout(callback, delay, description);
};

export const managedSetInterval = (callback: Function, interval: number, description?: string): string => {
  return timerManager.setInterval(callback, interval, description);
};

export const managedClear = (id: string): boolean => {
  return timerManager.clear(id);
};

export const delay = (ms: number): Promise<void> => {
  return timerManager.delay(ms);
};

export default TimerManager;