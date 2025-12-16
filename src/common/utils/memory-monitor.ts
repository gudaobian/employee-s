/**
 * Memory Monitor
 * Monitors and manages application memory usage
 *
 * ENHANCED: Added monitoring for off-heap memory (RSS) to detect
 * native module memory leaks (Sharp/libvips, native-event-monitor)
 *
 * TEACHING MODE: GC is only triggered when user is idle (60s+) to avoid
 * interfering with live teaching sessions (ClassIn, Zoom, etc.)
 */

import { EventEmitter } from 'events';
import { logger } from './logger';
import { TeachingModeService } from '../services/teaching-mode-service';

// 内存状态接口
interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  offHeapMB: number;  // RSS - heapTotal，表示堆外内存
}

// 内存趋势追踪
interface MemoryTrend {
  timestamp: number;
  rssMB: number;
  heapUsedMB: number;
}

export class MemoryMonitor extends EventEmitter {
  private static instance?: MemoryMonitor;
  private monitorInterval?: NodeJS.Timeout;

  // ENHANCED: 提高阈值，避免过度触发 GC
  private readonly HEAP_THRESHOLD_MB = 400;      // V8 堆内存阈值
  private readonly RSS_THRESHOLD_MB = 800;       // RSS 阈值 (检测堆外内存泄漏)
  private readonly RSS_CRITICAL_MB = 1200;       // RSS 临界阈值
  private readonly CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes (更频繁检查)

  // ENHANCED: 内存趋势追踪，检测渐进式内存增长
  private memoryTrend: MemoryTrend[] = [];
  private readonly TREND_WINDOW_SIZE = 30;       // 保留最近 30 次采样
  private readonly GROWTH_ALERT_THRESHOLD = 100; // 连续增长 100MB 时告警

  // 🎓 教学模式支持
  private teachingModeService?: TeachingModeService;
  private readonly GC_IDLE_THRESHOLD_MS = 60000; // 教学模式下，空闲 60 秒才触发 GC
  private lastGCTime = 0;
  private gcDelayedCount = 0;  // 记录延迟的 GC 次数
  private lastMemoryState: 'normal' | 'warning' | 'critical' = 'normal'; // 记录上次内存状态

  private constructor() {
    super();
  }

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  start(interval?: number): void {
    if (this.monitorInterval) {
      logger.warn('[MemoryMonitor] Already started');
      return;
    }

    const checkInterval = interval || this.CHECK_INTERVAL_MS;

    // 立即执行一次检查
    this.checkMemory();

    this.monitorInterval = setInterval(() => {
      this.checkMemory();
    }, checkInterval);

    logger.info(`[MemoryMonitor] Started monitoring (interval: ${checkInterval}ms, enhanced with RSS tracking and teaching mode support)`);
  }

  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
      logger.info('[MemoryMonitor] Stopped monitoring');
    }
  }

  /**
   * 设置教学模式服务引用
   * 用于在教学模式下延迟 GC
   */
  setTeachingModeService(service: TeachingModeService): void {
    this.teachingModeService = service;
    logger.info('[MemoryMonitor] Teaching mode service connected');
  }

  /**
   * 检查是否应该允许 GC
   * 教学模式下，只有空闲时才允许
   */
  private async shouldAllowGC(): Promise<{ allowed: boolean; reason: string }> {
    // 如果没有教学模式服务，默认允许
    if (!this.teachingModeService) {
      return { allowed: true, reason: 'No teaching mode service' };
    }

    // 检查是否处于教学模式
    const isTeachingMode = this.teachingModeService.isTeachingMode();
    if (!isTeachingMode) {
      return { allowed: true, reason: 'Normal mode' };
    }

    // 教学模式下，检查空闲时间
    const idleTime = await this.teachingModeService.getIdleTime();
    if (idleTime >= this.GC_IDLE_THRESHOLD_MS) {
      return { allowed: true, reason: `Teaching mode but idle (${Math.round(idleTime / 1000)}s)` };
    }

    // 教学模式且活跃中，不允许 GC
    this.gcDelayedCount++;
    return {
      allowed: false,
      reason: `Teaching mode active (idle: ${Math.round(idleTime / 1000)}s < ${this.GC_IDLE_THRESHOLD_MS / 1000}s threshold)`
    };
  }

  /**
   * 获取详细的内存统计信息
   */
  private getMemoryStats(): MemoryStats {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    const rssMB = Math.round(used.rss / 1024 / 1024);
    const externalMB = Math.round(used.external / 1024 / 1024);
    const arrayBuffersMB = Math.round((used.arrayBuffers || 0) / 1024 / 1024);

    // 堆外内存 = RSS - heapTotal (包含 C++ 库如 Sharp/libvips 分配的内存)
    const offHeapMB = Math.max(0, rssMB - heapTotalMB);

    return {
      heapUsedMB,
      heapTotalMB,
      rssMB,
      externalMB,
      arrayBuffersMB,
      offHeapMB
    };
  }

  /**
   * 记录内存趋势
   */
  private recordTrend(stats: MemoryStats): void {
    this.memoryTrend.push({
      timestamp: Date.now(),
      rssMB: stats.rssMB,
      heapUsedMB: stats.heapUsedMB
    });

    // 保持窗口大小
    if (this.memoryTrend.length > this.TREND_WINDOW_SIZE) {
      this.memoryTrend.shift();
    }
  }

  /**
   * 检测内存增长趋势
   */
  private checkMemoryGrowth(): { isGrowing: boolean; growthMB: number } {
    if (this.memoryTrend.length < 5) {
      return { isGrowing: false, growthMB: 0 };
    }

    const oldest = this.memoryTrend[0];
    const newest = this.memoryTrend[this.memoryTrend.length - 1];
    const growthMB = newest.rssMB - oldest.rssMB;

    // 检查是否持续增长（每次采样都比前一次高）
    let consecutiveGrowth = 0;
    for (let i = 1; i < this.memoryTrend.length; i++) {
      if (this.memoryTrend[i].rssMB > this.memoryTrend[i - 1].rssMB) {
        consecutiveGrowth++;
      } else {
        consecutiveGrowth = 0;
      }
    }

    // 如果连续 5 次以上增长，且总增长超过阈值，认为有泄漏
    const isGrowing = consecutiveGrowth >= 5 && growthMB > this.GROWTH_ALERT_THRESHOLD;

    return { isGrowing, growthMB };
  }

  private checkMemory(): void {
    // 使用异步包装器来处理教学模式检查
    this.checkMemoryAsync().catch(error => {
      logger.warn('[Memory] Async memory check failed:', error);
    });
  }

  private async checkMemoryAsync(): Promise<void> {
    const stats = this.getMemoryStats();
    this.recordTrend(stats);

    // 获取教学模式状态用于日志
    const isTeachingMode = this.teachingModeService?.isTeachingMode() || false;

    // 常规日志 (debug 级别)
    logger.debug(
      `[Memory] Heap: ${stats.heapUsedMB}/${stats.heapTotalMB}MB, ` +
      `RSS: ${stats.rssMB}MB, Off-heap: ${stats.offHeapMB}MB, ` +
      `External: ${stats.externalMB}MB, Teaching: ${isTeachingMode}`
    );

    // 检查堆外内存 (Sharp/libvips 泄漏检测)
    if (stats.offHeapMB > 200) {
      logger.warn(
        `[Memory] ⚠️ High off-heap memory: ${stats.offHeapMB}MB ` +
        `(may indicate Sharp/libvips memory leak)`
      );
    }

    // 确定当前内存状态
    let currentState: 'normal' | 'warning' | 'critical' = 'normal';

    // 检查 RSS 临界阈值
    if (stats.rssMB > this.RSS_CRITICAL_MB) {
      currentState = 'critical';
      logger.error(
        `[Memory] 🚨 CRITICAL: RSS ${stats.rssMB}MB exceeds ${this.RSS_CRITICAL_MB}MB! ` +
        `OOM risk detected. Off-heap: ${stats.offHeapMB}MB`
      );

      // 🎓 教学模式下的紧急 GC 策略
      const gcCheck = await this.shouldAllowGC();
      if (global.gc) {
        if (gcCheck.allowed) {
          logger.info(`[Memory] Triggering emergency GC... (${gcCheck.reason})`);
          global.gc();
          this.lastGCTime = Date.now();
        } else {
          logger.warn(`[Memory] 🎓 Emergency GC DELAYED: ${gcCheck.reason} (delayed ${this.gcDelayedCount} times)`);
          // 紧急情况下，如果已延迟超过 5 次，强制执行
          if (this.gcDelayedCount > 5) {
            logger.warn('[Memory] 🚨 Force triggering GC after 5 delays to prevent OOM');
            global.gc();
            this.lastGCTime = Date.now();
            this.gcDelayedCount = 0;
          }
        }
      }
    } else if (stats.rssMB > this.RSS_THRESHOLD_MB || stats.heapUsedMB > this.HEAP_THRESHOLD_MB) {
      currentState = 'warning';
      if (stats.rssMB > this.RSS_THRESHOLD_MB) {
        logger.warn(
          `[Memory] ⚠️ High RSS: ${stats.rssMB}MB (threshold: ${this.RSS_THRESHOLD_MB}MB). ` +
          `Off-heap: ${stats.offHeapMB}MB`
        );
      }
    }

    // 检查堆内存阈值
    if (stats.heapUsedMB > this.HEAP_THRESHOLD_MB && currentState === 'warning') {
      logger.warn(`[Memory] High heap usage: ${stats.heapUsedMB}MB (threshold: ${this.HEAP_THRESHOLD_MB}MB)`);

      // 🎓 教学模式感知的 GC 触发
      const gcCheck = await this.shouldAllowGC();
      if (global.gc) {
        if (gcCheck.allowed) {
          logger.info(`[Memory] Triggering manual GC... (${gcCheck.reason})`);
          global.gc();
          this.lastGCTime = Date.now();

          // Log memory after GC
          const afterGC = process.memoryUsage();
          const heapAfterMB = Math.round(afterGC.heapUsed / 1024 / 1024);
          logger.info(`[Memory] After GC: ${heapAfterMB}MB (freed ${stats.heapUsedMB - heapAfterMB}MB)`);
        } else {
          logger.info(`[Memory] 🎓 GC delayed: ${gcCheck.reason}`);
        }
      }
    }

    // 检查内存增长趋势
    const { isGrowing, growthMB } = this.checkMemoryGrowth();
    if (isGrowing) {
      logger.warn(
        `[Memory] 📈 Memory leak suspected! RSS grew ${growthMB}MB over last ${this.memoryTrend.length} samples. ` +
        `Current: ${stats.rssMB}MB, Off-heap: ${stats.offHeapMB}MB`
      );
    }

    // 触发内存状态事件 (仅当状态改变时)
    if (currentState !== this.lastMemoryState) {
      logger.info(`[Memory] State transition: ${this.lastMemoryState} → ${currentState}`);
      this.lastMemoryState = currentState;

      // 触发对应事件
      if (currentState === 'critical') {
        this.emit('critical', stats);
      } else if (currentState === 'warning') {
        this.emit('warning', stats);
      } else {
        this.emit('healthy', stats);
      }
    }
  }

  forceGC(): void {
    if (global.gc) {
      const before = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      global.gc();
      const after = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      logger.info(`[Memory] Manual GC: ${before}MB → ${after}MB (freed ${before - after}MB)`);
    } else {
      logger.warn('[Memory] GC not available (run with --expose-gc)');
    }
  }

  /**
   * 获取内存趋势报告
   */
  getMemoryReport(): string {
    const stats = this.getMemoryStats();
    const { isGrowing, growthMB } = this.checkMemoryGrowth();

    return `
Memory Report:
  Heap Used: ${stats.heapUsedMB}MB / ${stats.heapTotalMB}MB
  RSS: ${stats.rssMB}MB
  Off-heap (native): ${stats.offHeapMB}MB
  External: ${stats.externalMB}MB
  ArrayBuffers: ${stats.arrayBuffersMB}MB
  Trend: ${isGrowing ? `⚠️ Growing (+${growthMB}MB)` : '✅ Stable'}
  Samples: ${this.memoryTrend.length}
    `.trim();
  }

  // Static methods for backward compatibility
  static logMemoryUsage(label: string): void {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    const rssMB = Math.round(used.rss / 1024 / 1024);
    const offHeapMB = Math.max(0, rssMB - heapTotalMB);
    logger.debug(`[Memory] ${label}: Heap ${heapUsedMB}/${heapTotalMB}MB, RSS ${rssMB}MB, Off-heap ${offHeapMB}MB`);
  }

  static checkMemoryThreshold(): 'normal' | 'warning' | 'critical' {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const rssMB = Math.round(used.rss / 1024 / 1024);

    // 同时检查 heap 和 RSS
    if (heapUsedMB > 500 || rssMB > 1200) return 'critical';
    if (heapUsedMB > 400 || rssMB > 800) return 'warning';
    return 'normal';
  }

  static triggerGC(): void {
    if (global.gc) {
      const before = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      global.gc();
      const after = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      logger.info(`[Memory] GC triggered: ${before}MB → ${after}MB`);
    }
  }

  /**
   * ENHANCED: 获取详细内存统计 (静态方法)
   */
  static getDetailedStats(): MemoryStats {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    const rssMB = Math.round(used.rss / 1024 / 1024);
    const externalMB = Math.round(used.external / 1024 / 1024);
    const arrayBuffersMB = Math.round((used.arrayBuffers || 0) / 1024 / 1024);
    const offHeapMB = Math.max(0, rssMB - heapTotalMB);

    return {
      heapUsedMB,
      heapTotalMB,
      rssMB,
      externalMB,
      arrayBuffersMB,
      offHeapMB
    };
  }
}

export const memoryMonitor = MemoryMonitor.getInstance();
