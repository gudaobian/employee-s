/**
 * Memory Monitor
 * Monitors and manages application memory usage
 */

import { logger } from './logger';

export class MemoryMonitor {
  private static instance?: MemoryMonitor;
  private monitorInterval?: NodeJS.Timeout;
  private readonly MEMORY_THRESHOLD_MB = 300;
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  start(): void {
    if (this.monitorInterval) {
      logger.warn('[MemoryMonitor] Already started');
      return;
    }

    this.monitorInterval = setInterval(() => {
      this.checkMemory();
    }, this.CHECK_INTERVAL_MS);

    logger.info('[MemoryMonitor] Started monitoring');
  }

  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
      logger.info('[MemoryMonitor] Stopped monitoring');
    }
  }

  private checkMemory(): void {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    const rssMB = Math.round(used.rss / 1024 / 1024);

    logger.debug(`[Memory] Heap: ${heapUsedMB}/${heapTotalMB}MB, RSS: ${rssMB}MB`);

    if (heapUsedMB > this.MEMORY_THRESHOLD_MB) {
      logger.warn(`[Memory] High heap usage: ${heapUsedMB}MB (threshold: ${this.MEMORY_THRESHOLD_MB}MB)`);

      // Trigger GC if available
      if (global.gc) {
        logger.info('[Memory] Triggering manual GC...');
        global.gc();

        // Log memory after GC
        const afterGC = process.memoryUsage();
        const heapAfterMB = Math.round(afterGC.heapUsed / 1024 / 1024);
        logger.info(`[Memory] After GC: ${heapAfterMB}MB (freed ${heapUsedMB - heapAfterMB}MB)`);
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

  // Static methods for backward compatibility
  static logMemoryUsage(label: string): void {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    const rssMB = Math.round(used.rss / 1024 / 1024);
    logger.debug(`[Memory] ${label}: Heap ${heapUsedMB}/${heapTotalMB}MB, RSS ${rssMB}MB`);
  }

  static checkMemoryThreshold(): 'normal' | 'warning' | 'critical' {
    const heapUsedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    if (heapUsedMB > 400) return 'critical';
    if (heapUsedMB > 300) return 'warning';
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
}

export const memoryMonitor = MemoryMonitor.getInstance();
