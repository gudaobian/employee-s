/**
 * Performance Benchmark for active-win-compat Module
 *
 * Comprehensive performance testing with detailed metrics:
 * - Latency percentiles (P50, P95, P99)
 * - Throughput (operations per second)
 * - Success rate
 * - Memory usage
 *
 * Performance Targets:
 * - P50: ≤ 50ms
 * - P95: ≤ 100ms
 * - P99: ≤ 200ms
 * - Success Rate: ≥ 95%
 * - Throughput: ≥ 20 ops/sec
 *
 * @requires macOS 10.15+
 */

import { activeWindow } from '../../platforms/macos/active-win-compat';

/**
 * Benchmark result data structure
 */
interface BenchmarkResult {
  iterations: number;
  successCount: number;
  failureCount: number;
  latencies: number[];
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  successRate: number;
  throughput: number;
  totalTime: number;
  memoryUsage: {
    initial: number;
    final: number;
    growth: number;
    growthMB: number;
  };
}

/**
 * Performance targets for validation
 */
interface PerformanceTargets {
  p50: number;
  p95: number;
  p99: number;
  successRate: number;
  throughput: number;
  maxMemoryGrowthMB: number;
}

const DEFAULT_TARGETS: PerformanceTargets = {
  p50: 50,
  p95: 100,
  p99: 200,
  successRate: 95,
  throughput: 20,
  maxMemoryGrowthMB: 5
};

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArray: number[], p: number): number {
  const index = Math.ceil((sortedArray.length * p) / 100) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * Format number with thousands separator
 */
function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Run performance benchmark with specified iterations
 *
 * @param iterations - Number of test iterations (default: 100)
 * @param enableGC - Enable garbage collection between tests (default: true)
 * @returns Benchmark results with detailed metrics
 */
export async function runBenchmark(
  iterations: number = 100,
  enableGC: boolean = true
): Promise<BenchmarkResult> {
  console.log('\n========================================');
  console.log('  active-win-compat Performance Benchmark');
  console.log('========================================\n');
  console.log(`Iterations: ${iterations}`);
  console.log(`GC Enabled: ${enableGC}\n`);

  const latencies: number[] = [];
  let successCount = 0;
  let failureCount = 0;

  // Initial memory snapshot
  if (enableGC && global.gc) global.gc();
  const initialMemory = process.memoryUsage().heapUsed;

  console.log('Running benchmark...');
  const startTime = Date.now();

  for (let i = 0; i < iterations; i++) {
    const iterationStart = Date.now();

    try {
      const result = await activeWindow();
      const latency = Date.now() - iterationStart;
      latencies.push(latency);

      if (result !== null && result.owner && result.owner.name) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (error) {
      failureCount++;
      const latency = Date.now() - iterationStart;
      latencies.push(latency);
    }

    // Progress indicator
    if ((i + 1) % 10 === 0) {
      process.stdout.write(`\rProgress: ${i + 1}/${iterations} (${Math.floor(((i + 1) / iterations) * 100)}%)`);
    }

    // Periodic garbage collection
    if (enableGC && global.gc && i % 25 === 0) {
      global.gc();
    }
  }

  const totalTime = Date.now() - startTime;

  // Final memory snapshot
  if (enableGC && global.gc) global.gc();
  const finalMemory = process.memoryUsage().heapUsed;
  const memoryGrowth = finalMemory - initialMemory;
  const memoryGrowthMB = memoryGrowth / 1024 / 1024;

  console.log(`\nCompleted in ${formatNumber(totalTime / 1000, 2)}s\n`);

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const successRate = (successCount / iterations) * 100;
  const throughput = (iterations / totalTime) * 1000;

  return {
    iterations,
    successCount,
    failureCount,
    latencies,
    p50,
    p95,
    p99,
    avg,
    min,
    max,
    successRate,
    throughput,
    totalTime,
    memoryUsage: {
      initial: initialMemory,
      final: finalMemory,
      growth: memoryGrowth,
      growthMB: memoryGrowthMB
    }
  };
}

/**
 * Print detailed benchmark report
 */
export function printReport(result: BenchmarkResult, targets: PerformanceTargets = DEFAULT_TARGETS): void {
  console.log('========================================');
  console.log('         Performance Report');
  console.log('========================================\n');

  // Basic statistics
  console.log('--- Test Configuration ---');
  console.log(`Iterations:    ${result.iterations}`);
  console.log(`Success Count: ${result.successCount}`);
  console.log(`Failure Count: ${result.failureCount}`);
  console.log(`Total Time:    ${formatNumber(result.totalTime / 1000, 2)}s`);

  // Success rate
  console.log('\n--- Reliability ---');
  console.log(`Success Rate:  ${formatNumber(result.successRate, 2)}%`);
  console.log(`Throughput:    ${formatNumber(result.throughput, 2)} ops/sec`);

  // Latency statistics
  console.log('\n--- Latency Statistics ---');
  console.log(`P50 (median):  ${result.p50}ms`);
  console.log(`P95:           ${result.p95}ms`);
  console.log(`P99:           ${result.p99}ms`);
  console.log(`Average:       ${formatNumber(result.avg, 2)}ms`);
  console.log(`Min:           ${result.min}ms`);
  console.log(`Max:           ${result.max}ms`);

  // Memory usage
  console.log('\n--- Memory Usage ---');
  console.log(`Initial:       ${formatNumber(result.memoryUsage.initial / 1024 / 1024, 2)} MB`);
  console.log(`Final:         ${formatNumber(result.memoryUsage.final / 1024 / 1024, 2)} MB`);
  console.log(`Growth:        ${formatNumber(result.memoryUsage.growthMB, 2)} MB`);

  // Performance targets validation
  console.log('\n--- Performance Targets ---');
  const p50Pass = result.p50 <= targets.p50;
  const p95Pass = result.p95 <= targets.p95;
  const p99Pass = result.p99 <= targets.p99;
  const successRatePass = result.successRate >= targets.successRate;
  const throughputPass = result.throughput >= targets.throughput;
  const memoryPass = result.memoryUsage.growthMB <= targets.maxMemoryGrowthMB;

  console.log(`P50 Target: ≤ ${targets.p50}ms      → ${p50Pass ? '✅ PASS' : '❌ FAIL'} (${result.p50}ms)`);
  console.log(`P95 Target: ≤ ${targets.p95}ms     → ${p95Pass ? '✅ PASS' : '❌ FAIL'} (${result.p95}ms)`);
  console.log(`P99 Target: ≤ ${targets.p99}ms     → ${p99Pass ? '✅ PASS' : '❌ FAIL'} (${result.p99}ms)`);
  console.log(`Success Rate: ≥ ${targets.successRate}%   → ${successRatePass ? '✅ PASS' : '❌ FAIL'} (${formatNumber(result.successRate, 2)}%)`);
  console.log(`Throughput: ≥ ${targets.throughput} ops/s → ${throughputPass ? '✅ PASS' : '❌ FAIL'} (${formatNumber(result.throughput, 2)} ops/s)`);
  console.log(`Memory: ≤ ${targets.maxMemoryGrowthMB}MB     → ${memoryPass ? '✅ PASS' : '❌ FAIL'} (${formatNumber(result.memoryUsage.growthMB, 2)}MB)`);

  // Overall pass/fail
  const allPass = p50Pass && p95Pass && p99Pass && successRatePass && throughputPass && memoryPass;
  console.log('\n--- Overall Result ---');
  console.log(allPass ? '✅ ALL TARGETS MET' : '❌ SOME TARGETS NOT MET');

  console.log('\n========================================\n');
}

/**
 * Export raw benchmark data to JSON file
 */
export function exportResults(result: BenchmarkResult, filename: string): void {
  const fs = require('fs');
  const data = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    result
  };

  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`Results exported to: ${filename}`);
}

/**
 * Compare current benchmark with baseline
 */
export function compareWithBaseline(current: BenchmarkResult, baseline: BenchmarkResult): void {
  console.log('\n========================================');
  console.log('      Baseline Comparison');
  console.log('========================================\n');

  const p50Delta = ((current.p50 - baseline.p50) / baseline.p50) * 100;
  const p95Delta = ((current.p95 - baseline.p95) / baseline.p95) * 100;
  const p99Delta = ((current.p99 - baseline.p99) / baseline.p99) * 100;
  const throughputDelta = ((current.throughput - baseline.throughput) / baseline.throughput) * 100;

  console.log(`P50 Latency:   ${baseline.p50}ms → ${current.p50}ms (${p50Delta >= 0 ? '+' : ''}${formatNumber(p50Delta, 1)}%)`);
  console.log(`P95 Latency:   ${baseline.p95}ms → ${current.p95}ms (${p95Delta >= 0 ? '+' : ''}${formatNumber(p95Delta, 1)}%)`);
  console.log(`P99 Latency:   ${baseline.p99}ms → ${current.p99}ms (${p99Delta >= 0 ? '+' : ''}${formatNumber(p99Delta, 1)}%)`);
  console.log(`Throughput:    ${formatNumber(baseline.throughput, 2)} → ${formatNumber(current.throughput, 2)} ops/s (${throughputDelta >= 0 ? '+' : ''}${formatNumber(throughputDelta, 1)}%)`);

  console.log('\n========================================\n');
}

/**
 * Main execution when run directly
 */
async function main(): Promise<void> {
  // Check platform
  if (process.platform !== 'darwin') {
    console.error('Error: This benchmark requires macOS (darwin platform)');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  const iterations = args[0] ? parseInt(args[0], 10) : 100;
  const enableGC = !args.includes('--no-gc');
  const exportFile = args.find(arg => arg.startsWith('--export='))?.split('=')[1];

  // Run benchmark
  try {
    const result = await runBenchmark(iterations, enableGC);
    printReport(result);

    // Export if requested
    if (exportFile) {
      exportResults(result, exportFile);
    }

    // Exit with appropriate code
    const allTargetsMet =
      result.p50 <= DEFAULT_TARGETS.p50 &&
      result.p95 <= DEFAULT_TARGETS.p95 &&
      result.p99 <= DEFAULT_TARGETS.p99 &&
      result.successRate >= DEFAULT_TARGETS.successRate &&
      result.throughput >= DEFAULT_TARGETS.throughput &&
      result.memoryUsage.growthMB <= DEFAULT_TARGETS.maxMemoryGrowthMB;

    process.exit(allTargetsMet ? 0 : 1);
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

// Run main if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export functions for use in other scripts
export { PerformanceTargets, DEFAULT_TARGETS };
