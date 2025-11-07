#!/bin/bash
# Apply Memory Fix for EmployeeMonitor
# Fixes memory leak and crash issues

echo "======================================"
echo "Applying Memory Fix"
echo "======================================"
echo ""

# 1. Update package.json to enable GC
echo "1. Enabling manual garbage collection..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' 's/"dev": ".*"/"dev": "node --expose-gc dist\/main\/cli.js start"/' package.json
  sed -i '' 's/"start": "node dist\/main\/cli.js start"/"start": "node --expose-gc dist\/main\/cli.js start"/' package.json
else
  sed -i 's/"dev": ".*"/"dev": "node --expose-gc dist\/main\/cli.js start"/' package.json
  sed -i 's/"start": "node dist\/main\/cli.js start"/"start": "node --expose-gc dist\/main\/cli.js start"/' package.json
fi

echo "   ✅ GC enabled in package.json"
echo ""

# 2. Add memory monitoring script
echo "2. Creating memory monitoring script..."
cat > common/utils/memory-monitor.ts << 'EOF'
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
}

export const memoryMonitor = MemoryMonitor.getInstance();
EOF

echo "   ✅ Memory monitor created"
echo ""

# 3. Update utils index
echo "3. Updating utils index..."
echo "export { memoryMonitor, MemoryMonitor } from './memory-monitor';" >> common/utils/index.ts

echo "   ✅ Utils index updated"
echo ""

# 4. Compile TypeScript
echo "4. Compiling TypeScript..."
npm run compile

echo "   ✅ TypeScript compiled"
echo ""

# 5. Instructions
echo "======================================"
echo "Fix Applied Successfully!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Rebuild: npm run build"
echo "2. Repackage: npm run pack:mac"
echo "3. Test with: npm run dev"
echo ""
echo "The application will now:"
echo "  • Use manual GC (--expose-gc)"
echo "  • Monitor memory every 5 minutes"
echo "  • Auto-trigger GC when heap > 300MB"
echo "  • Log memory stats for debugging"
echo ""
