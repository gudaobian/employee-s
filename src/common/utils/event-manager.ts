/**
 * 事件管理工具 - 重构版本
 * 统一管理事件监听和发布
 */

import { EventEmitter } from 'events';

type EventCallback = (...args: any[]) => void;

export interface EventListenerInfo {
  eventName: string;
  callback: EventCallback;
  once: boolean;
  addedAt: Date;
  callCount: number;
  lastCalledAt?: Date;
}

export class EventManager extends EventEmitter {
  private static instance?: EventManager;
  private eventListeners = new Map<string, Set<EventListenerInfo>>();
  private eventStats = new Map<string, {
    totalEmits: number;
    lastEmitAt?: Date;
    listenerCount: number;
  }>();

  constructor() {
    super();
    this.setMaxListeners(100); // 设置更高的监听器限制
  }

  static getInstance(): EventManager {
    if (!EventManager.instance) {
      EventManager.instance = new EventManager();
    }
    return EventManager.instance;
  }

  /**
   * 添加事件监听器（增强版）
   */
  addListener(eventName: string, callback: EventCallback): this {
    const listenerInfo: EventListenerInfo = {
      eventName,
      callback,
      once: false,
      addedAt: new Date(),
      callCount: 0
    };

    // 添加到跟踪集合
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName)!.add(listenerInfo);

    // 更新统计
    this.updateListenerStats(eventName);

    // 包装原始回调以跟踪调用
    const wrappedCallback = (...args: any[]) => {
      listenerInfo.callCount++;
      listenerInfo.lastCalledAt = new Date();
      
      try {
        callback.apply(this, args);
      } catch (error) {
        console.error(`[EventManager] Error in listener for '${eventName}':`, error);
      }
    };

    // 调用原始方法
    super.addListener(eventName, wrappedCallback);
    
    return this;
  }

  /**
   * 添加一次性事件监听器
   */
  once(eventName: string, callback: EventCallback): this {
    const listenerInfo: EventListenerInfo = {
      eventName,
      callback,
      once: true,
      addedAt: new Date(),
      callCount: 0
    };

    // 添加到跟踪集合
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName)!.add(listenerInfo);

    // 更新统计
    this.updateListenerStats(eventName);

    // 包装原始回调
    const wrappedCallback = (...args: any[]) => {
      listenerInfo.callCount++;
      listenerInfo.lastCalledAt = new Date();
      
      // 从跟踪集合中移除
      this.eventListeners.get(eventName)?.delete(listenerInfo);
      this.updateListenerStats(eventName);
      
      try {
        callback.apply(this, args);
      } catch (error) {
        console.error(`[EventManager] Error in once listener for '${eventName}':`, error);
      }
    };

    // 调用原始方法
    super.once(eventName, wrappedCallback);
    
    return this;
  }

  /**
   * on 方法（addListener 的别名）
   */
  on(eventName: string, callback: EventCallback): this {
    return this.addListener(eventName, callback);
  }

  /**
   * 移除事件监听器
   */
  removeListener(eventName: string, callback: EventCallback): this {
    // 从跟踪集合中移除
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      for (const listenerInfo of listeners) {
        if (listenerInfo.callback === callback) {
          listeners.delete(listenerInfo);
          break;
        }
      }
      this.updateListenerStats(eventName);
    }

    // 调用原始方法
    super.removeListener(eventName, callback);
    
    return this;
  }

  /**
   * off 方法（removeListener 的别名）
   */
  off(eventName: string, callback: EventCallback): this {
    return this.removeListener(eventName, callback);
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(eventName?: string): this {
    if (eventName) {
      // 移除指定事件的所有监听器
      this.eventListeners.delete(eventName);
      this.eventStats.delete(eventName);
    } else {
      // 移除所有事件的所有监听器
      this.eventListeners.clear();
      this.eventStats.clear();
    }

    // 调用原始方法
    super.removeAllListeners(eventName);
    
    return this;
  }

  /**
   * 发布事件（增强版）
   */
  emit(eventName: string, ...args: any[]): boolean {
    // 更新发布统计
    if (!this.eventStats.has(eventName)) {
      this.eventStats.set(eventName, {
        totalEmits: 0,
        listenerCount: 0
      });
    }
    
    const stats = this.eventStats.get(eventName)!;
    stats.totalEmits++;
    stats.lastEmitAt = new Date();

    // 调用原始方法
    const result = super.emit(eventName, ...args);
    
    // 如果没有监听器，记录警告
    if (!result && this.listenerCount(eventName) === 0) {
      console.debug(`[EventManager] Event '${eventName}' emitted but no listeners`);
    }
    
    return result;
  }

  /**
   * 安全发布事件（捕获监听器中的错误）
   */
  safeEmit(eventName: string, ...args: any[]): boolean {
    try {
      return this.emit(eventName, ...args);
    } catch (error) {
      console.error(`[EventManager] Error emitting event '${eventName}':`, error);
      return false;
    }
  }

  /**
   * 延迟发布事件
   */
  async emitAsync(eventName: string, ...args: any[]): Promise<boolean> {
    return new Promise((resolve) => {
      setImmediate(() => {
        const result = this.emit(eventName, ...args);
        resolve(result);
      });
    });
  }

  /**
   * 批量发布事件
   */
  emitBatch(events: Array<{ eventName: string; args: any[] }>): number {
    let successCount = 0;
    
    events.forEach(({ eventName, args }) => {
      if (this.emit(eventName, ...args)) {
        successCount++;
      }
    });
    
    return successCount;
  }

  /**
   * 创建事件Promise
   */
  waitForEvent(eventName: string, timeout?: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;
      
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };
      
      // 设置超时
      if (timeout) {
        timeoutId = setTimeout(() => {
          this.off(eventName, onEvent);
          reject(new Error(`Event '${eventName}' timeout after ${timeout}ms`));
        }, timeout);
      }
      
      // 事件监听器
      const onEvent = (...args: any[]) => {
        cleanup();
        resolve(args);
      };
      
      this.once(eventName, onEvent);
    });
  }

  /**
   * 创建事件过滤器
   */
  createFilter<T = any>(
    eventName: string,
    predicate: (...args: any[]) => boolean
  ): EventEmitter {
    const filteredEmitter = new EventEmitter();
    
    this.on(eventName, (...args: any[]) => {
      if (predicate(...args)) {
        filteredEmitter.emit('data', ...args);
      }
    });
    
    return filteredEmitter;
  }

  /**
   * 创建事件变换器
   */
  createTransformer<T = any, R = any>(
    eventName: string,
    transformer: (...args: any[]) => R
  ): EventEmitter {
    const transformedEmitter = new EventEmitter();
    
    this.on(eventName, (...args: any[]) => {
      try {
        const result = transformer(...args);
        transformedEmitter.emit('data', result);
      } catch (error) {
        transformedEmitter.emit('error', error);
      }
    });
    
    return transformedEmitter;
  }

  /**
   * 获取事件监听器信息
   */
  getListenerInfo(eventName: string): EventListenerInfo[] {
    const listeners = this.eventListeners.get(eventName);
    return listeners ? Array.from(listeners) : [];
  }

  /**
   * 获取事件统计信息
   */
  getEventStats(eventName?: string): any {
    if (eventName) {
      return this.eventStats.get(eventName) || null;
    }
    
    const stats: any = {};
    this.eventStats.forEach((value, key) => {
      stats[key] = { ...value };
    });
    return stats;
  }

  /**
   * 获取所有事件名称
   */
  getEventNames(): string[] {
    return Array.from(this.eventListeners.keys());
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalEvents: number;
    totalListeners: number;
    totalEmits: number;
    eventsByListenerCount: Array<{ eventName: string; listenerCount: number }>;
    recentEvents: Array<{ eventName: string; lastEmitAt: Date }>;
  } {
    let totalListeners = 0;
    let totalEmits = 0;
    const eventsByListenerCount: Array<{ eventName: string; listenerCount: number }> = [];
    const recentEvents: Array<{ eventName: string; lastEmitAt: Date }> = [];
    
    this.eventStats.forEach((stats, eventName) => {
      totalEmits += stats.totalEmits;
      totalListeners += stats.listenerCount;
      
      eventsByListenerCount.push({
        eventName,
        listenerCount: stats.listenerCount
      });
      
      if (stats.lastEmitAt) {
        recentEvents.push({
          eventName,
          lastEmitAt: stats.lastEmitAt
        });
      }
    });
    
    // 按监听器数量排序
    eventsByListenerCount.sort((a, b) => b.listenerCount - a.listenerCount);
    
    // 按时间排序
    recentEvents.sort((a, b) => b.lastEmitAt.getTime() - a.lastEmitAt.getTime());
    
    return {
      totalEvents: this.eventStats.size,
      totalListeners,
      totalEmits,
      eventsByListenerCount,
      recentEvents: recentEvents.slice(0, 10) // 只返回最近的10个
    };
  }

  /**
   * 清理无用的事件统计
   */
  cleanup(): void {
    // 移除没有监听器的事件统计
    this.eventStats.forEach((stats, eventName) => {
      if (this.listenerCount(eventName) === 0) {
        this.eventStats.delete(eventName);
        this.eventListeners.delete(eventName);
      }
    });
  }

  /**
   * 更新监听器统计
   */
  private updateListenerStats(eventName: string): void {
    const listenerCount = this.listenerCount(eventName);
    
    if (!this.eventStats.has(eventName)) {
      this.eventStats.set(eventName, {
        totalEmits: 0,
        listenerCount: 0
      });
    }
    
    const stats = this.eventStats.get(eventName)!;
    stats.listenerCount = listenerCount;
  }

  /**
   * 释放资源
   */
  destroy(): void {
    this.removeAllListeners();
    this.eventListeners.clear();
    this.eventStats.clear();
  }
}

// 导出默认实例
export const eventManager = EventManager.getInstance();

// 便捷函数
export const on = (eventName: string, callback: EventCallback): void => {
  eventManager.on(eventName, callback);
};

export const once = (eventName: string, callback: EventCallback): void => {
  eventManager.once(eventName, callback);
};

export const off = (eventName: string, callback: EventCallback): void => {
  eventManager.off(eventName, callback);
};

export const emit = (eventName: string, ...args: any[]): boolean => {
  return eventManager.emit(eventName, ...args);
};

export const safeEmit = (eventName: string, ...args: any[]): boolean => {
  return eventManager.safeEmit(eventName, ...args);
};

export const waitForEvent = (eventName: string, timeout?: number): Promise<any[]> => {
  return eventManager.waitForEvent(eventName, timeout);
};

export default EventManager;