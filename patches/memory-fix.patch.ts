/**
 * Memory Optimization Patch for EmployeeMonitor
 *
 * Fixes:
 * 1. Excessive logging causing memory buildup
 * 2. Missing memory cleanup in long-running processes
 * 3. Adds periodic garbage collection
 * 4. Limits statistics data retention
 */

// Apply this patch to platforms/macos/macos-adapter.ts

/**
 * Add these optimizations to MacOSAdapter:
 */

// 1. Reduce logging frequency
private lastLogTime: number = 0;
private readonly LOG_THROTTLE_MS = 5000; // Only log every 5 seconds

async getActiveURL(browserName: string, retryCount: number = 0): Promise<string | null> {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 500;

  try {
    return await this.doGetActiveURL(browserName);
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);

      // Throttle retry logs
      const now = Date.now();
      if (now - this.lastLogTime > this.LOG_THROTTLE_MS) {
        logger.warn(`[MacOSAdapter] Retry ${retryCount + 1}/${MAX_RETRIES} for ${browserName}`);
        this.lastLogTime = now;
      }

      await this.sleep(delay);
      return await this.getActiveURL(browserName, retryCount + 1);
    }

    // Only log final failure
    logger.error(`[MacOSAdapter] Failed after ${MAX_RETRIES} retries: ${browserName}`);
    urlCollectStats.recordFailure(browserName, 'Max retries exceeded');
    return null;
  }
}

private async doGetActiveURL(browserName: string): Promise<string | null> {
  return this.executeWithErrorHandling(
    async () => {
      const hasPermission = await this.ensureURLCollectorInitialized();
      if (!hasPermission) {
        throw new Error('Permission not granted');
      }

      const startTime = Date.now();
      const urlInfo = await this.urlCollector!.getActiveURL(browserName);
      const latency = Date.now() - startTime;

      if (urlInfo) {
        // Throttle success logs
        const now = Date.now();
        if (now - this.lastLogTime > this.LOG_THROTTLE_MS) {
          logger.info(`✅ URL collected in ${latency}ms: ${browserName}`);
          this.lastLogTime = now;
        }

        const method = urlInfo.collectionMethod || 'applescript';
        urlCollectStats.recordSuccess(browserName, method, latency);

        return urlInfo.url;
      }

      throw new Error('No URL returned from collector');
    },
    'get-active-url'
  );
}

// 2. Add periodic memory cleanup
private memoryCheckInterval?: NodeJS.Timeout;

async initialize(): Promise<void> {
  await super.initialize();

  // Start memory cleanup (every 30 minutes)
  this.memoryCheckInterval = setInterval(() => {
    this.checkMemoryUsage();
  }, 30 * 60 * 1000);
}

async destroy(): Promise<void> {
  if (this.memoryCheckInterval) {
    clearInterval(this.memoryCheckInterval);
  }
  await super.destroy();
}

private checkMemoryUsage(): void {
  if (global.gc) {
    global.gc();
    logger.debug('[MacOSAdapter] Manual GC triggered');
  }

  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);

  if (heapUsedMB > 200) { // Warn if heap > 200MB
    logger.warn(`[MacOSAdapter] High memory usage: ${heapUsedMB}MB`);
  }
}

/**
 * Apply this to common/utils/url-collect-stats.ts:
 */

// Add max data retention
private readonly MAX_RECORDS = 1000; // Limit total records

recordSuccess(browser: string, method: string, latency: number): void {
  // Check if we need to reset (prevent infinite growth)
  if (this.metrics.total >= this.MAX_RECORDS) {
    logger.info('[URLCollectStats] Max records reached, resetting stats');
    this.reset();
  }

  this.metrics.total++;
  this.metrics.success++;

  // ... rest of the code
}

/**
 * Apply this to common/services/permission-monitor-service.ts:
 */

// Add event listener cleanup
private maxListeners = 10;

constructor(permissionChecker?: PermissionChecker) {
  super();
  this.permissionChecker = permissionChecker;
  this.setMaxListeners(this.maxListeners); // Prevent memory leak warning
}

/**
 * Apply this to main/app.ts or main/index.ts:
 */

// Enable manual GC (add to package.json scripts)
// "dev": "node --expose-gc dist/main/cli.js start"
// "start": "node --expose-gc dist/main/cli.js start"

// Add global error handler
process.on('uncaughtException', (error) => {
  logger.error('[Process] Uncaught exception:', error);
  // Don't exit immediately, try to recover
  if (global.gc) global.gc();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Process] Unhandled rejection:', reason);
});

// Monitor memory every 5 minutes
setInterval(() => {
  const used = process.memoryUsage();
  logger.debug('[Memory] Heap:', Math.round(used.heapUsed / 1024 / 1024), 'MB');

  if (global.gc && used.heapUsed > 300 * 1024 * 1024) { // > 300MB
    logger.info('[Memory] Triggering GC (heap > 300MB)');
    global.gc();
  }
}, 5 * 60 * 1000);
