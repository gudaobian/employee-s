/**
 * Browser URL Collection - Performance Benchmark Suite
 *
 * Measures and validates performance characteristics:
 * - Collection latency (P50, P95, P99)
 * - Resource utilization
 * - Throughput under load
 * - Concurrent collection handling
 *
 * Performance Targets:
 * - P50 latency: ≤ 60ms
 * - P95 latency: ≤ 250ms
 * - P99 latency: ≤ 1000ms
 * - Max latency: ≤ 5000ms
 * - Throughput: ≥ 20 collections/sec
 *
 * @module benchmark
 */

import { performance } from 'perf_hooks';
import * as os from 'os';
import { DarwinURLCollector } from '../../platforms/darwin/url-collector';
import { WindowsURLCollector } from '../../platforms/windows/url-collector';

/**
 * Performance Metrics Interface
 */
interface PerformanceMetrics {
  iterations: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  avg: number;
  stdDev: number;
  throughput: number;
  successRate: number;
  memoryUsed?: number;
}

/**
 * Benchmark Result Interface
 */
interface BenchmarkResult {
  name: string;
  platform: string;
  browser: string;
  metrics: PerformanceMetrics;
  timestamp: string;
  passed: boolean;
  notes?: string;
}

/**
 * Performance Targets
 */
const PERFORMANCE_TARGETS = {
  p50: 60,
  p95: 250,
  p99: 1000,
  max: 5000,
  minThroughput: 20,
  minSuccessRate: 0.7
};

/**
 * Helper: Create platform-specific collector
 */
function createCollector() {
  const platform = os.platform();
  if (platform === 'darwin') {
    return new DarwinURLCollector();
  } else if (platform === 'win32') {
    return new WindowsURLCollector();
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Helper: Calculate percentile
 */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Helper: Calculate standard deviation
 */
function stdDev(values: number[]): number {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Helper: Format metrics for display
 */
function formatMetrics(metrics: PerformanceMetrics): string {
  const lines = [
    `Iterations: ${metrics.iterations}`,
    `P50: ${metrics.p50.toFixed(2)}ms ${metrics.p50 <= PERFORMANCE_TARGETS.p50 ? '✅' : '❌'}`,
    `P95: ${metrics.p95.toFixed(2)}ms ${metrics.p95 <= PERFORMANCE_TARGETS.p95 ? '✅' : '❌'}`,
    `P99: ${metrics.p99.toFixed(2)}ms ${metrics.p99 <= PERFORMANCE_TARGETS.p99 ? '✅' : '❌'}`,
    `Max: ${metrics.max.toFixed(2)}ms ${metrics.max <= PERFORMANCE_TARGETS.max ? '✅' : '❌'}`,
    `Min: ${metrics.min.toFixed(2)}ms`,
    `Avg: ${metrics.avg.toFixed(2)}ms`,
    `StdDev: ${metrics.stdDev.toFixed(2)}ms`,
    `Throughput: ${metrics.throughput.toFixed(1)} ops/sec ${metrics.throughput >= PERFORMANCE_TARGETS.minThroughput ? '✅' : '❌'}`,
    `Success Rate: ${(metrics.successRate * 100).toFixed(1)}% ${metrics.successRate >= PERFORMANCE_TARGETS.minSuccessRate ? '✅' : '❌'}`
  ];

  if (metrics.memoryUsed) {
    lines.push(`Memory Used: ${(metrics.memoryUsed / 1024 / 1024).toFixed(2)} MB`);
  }

  return lines.join('\n  ');
}

/**
 * Benchmark 1: Basic Latency Test
 */
export async function benchmarkBasicLatency(
  browser: string = 'Chrome',
  iterations: number = 100
): Promise<BenchmarkResult> {
  console.log(`\n🔍 Benchmark: Basic Latency (${browser}, ${iterations} iterations)`);

  const collector = createCollector();
  const times: number[] = [];
  let successCount = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = await collector.getActiveURL(browser);
    const end = performance.now();

    const duration = end - start;
    times.push(duration);

    if (result && result.url) {
      successCount++;
    }

    // Small delay to prevent overwhelming the system
    if (i < iterations - 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  const metrics: PerformanceMetrics = {
    iterations,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: Math.max(...times),
    min: Math.min(...times),
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    stdDev: stdDev(times),
    throughput: 1000 / (times.reduce((a, b) => a + b, 0) / times.length),
    successRate: successCount / iterations
  };

  const passed =
    metrics.p50 <= PERFORMANCE_TARGETS.p50 &&
    metrics.p95 <= PERFORMANCE_TARGETS.p95 &&
    metrics.throughput >= PERFORMANCE_TARGETS.minThroughput &&
    metrics.successRate >= PERFORMANCE_TARGETS.minSuccessRate;

  const result: BenchmarkResult = {
    name: 'Basic Latency',
    platform: os.platform(),
    browser,
    metrics,
    timestamp: new Date().toISOString(),
    passed
  };

  console.log(`  ${formatMetrics(metrics)}`);
  console.log(`  Overall: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);

  return result;
}

/**
 * Benchmark 2: Concurrent Collection Test
 */
export async function benchmarkConcurrentCollection(
  browser: string = 'Chrome',
  concurrency: number = 10
): Promise<BenchmarkResult> {
  console.log(`\n🔍 Benchmark: Concurrent Collection (${browser}, ${concurrency} concurrent)`);

  const collector = createCollector();
  const times: number[] = [];
  let successCount = 0;

  const startOverall = performance.now();

  // Run concurrent collections
  const promises = Array(concurrency).fill(null).map(async () => {
    const start = performance.now();
    const result = await collector.getActiveURL(browser);
    const end = performance.now();

    const duration = end - start;
    times.push(duration);

    if (result && result.url) {
      successCount++;
    }

    return duration;
  });

  await Promise.all(promises);

  const endOverall = performance.now();
  const totalDuration = endOverall - startOverall;

  const metrics: PerformanceMetrics = {
    iterations: concurrency,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: Math.max(...times),
    min: Math.min(...times),
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    stdDev: stdDev(times),
    throughput: (concurrency / totalDuration) * 1000,
    successRate: successCount / concurrency
  };

  const passed =
    metrics.p95 <= PERFORMANCE_TARGETS.p95 * 1.5 && // Allow 50% slack for concurrent
    metrics.successRate >= PERFORMANCE_TARGETS.minSuccessRate * 0.8; // Allow 20% slack

  const result: BenchmarkResult = {
    name: 'Concurrent Collection',
    platform: os.platform(),
    browser,
    metrics,
    timestamp: new Date().toISOString(),
    passed,
    notes: `Total duration: ${totalDuration.toFixed(2)}ms for ${concurrency} concurrent operations`
  };

  console.log(`  ${formatMetrics(metrics)}`);
  if (result.notes) console.log(`  Note: ${result.notes}`);
  console.log(`  Overall: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);

  return result;
}

/**
 * Benchmark 3: Sustained Load Test
 */
export async function benchmarkSustainedLoad(
  browser: string = 'Chrome',
  duration: number = 30000 // 30 seconds
): Promise<BenchmarkResult> {
  console.log(`\n🔍 Benchmark: Sustained Load (${browser}, ${duration / 1000}s)`);

  const collector = createCollector();
  const times: number[] = [];
  let successCount = 0;
  let iterations = 0;

  const startOverall = performance.now();
  const memBefore = process.memoryUsage().heapUsed;

  while (performance.now() - startOverall < duration) {
    const start = performance.now();
    const result = await collector.getActiveURL(browser);
    const end = performance.now();

    const latency = end - start;
    times.push(latency);
    iterations++;

    if (result && result.url) {
      successCount++;
    }

    // Small delay between iterations
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  const memAfter = process.memoryUsage().heapUsed;
  const memoryUsed = memAfter - memBefore;

  const metrics: PerformanceMetrics = {
    iterations,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: Math.max(...times),
    min: Math.min(...times),
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    stdDev: stdDev(times),
    throughput: (iterations / duration) * 1000,
    successRate: successCount / iterations,
    memoryUsed
  };

  const passed =
    metrics.p95 <= PERFORMANCE_TARGETS.p95 &&
    metrics.successRate >= PERFORMANCE_TARGETS.minSuccessRate &&
    memoryUsed < 50 * 1024 * 1024; // Less than 50MB memory growth

  const result: BenchmarkResult = {
    name: 'Sustained Load',
    platform: os.platform(),
    browser,
    metrics,
    timestamp: new Date().toISOString(),
    passed,
    notes: `Completed ${iterations} collections in ${(duration / 1000).toFixed(1)}s`
  };

  console.log(`  ${formatMetrics(metrics)}`);
  if (result.notes) console.log(`  Note: ${result.notes}`);
  console.log(`  Overall: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);

  return result;
}

/**
 * Benchmark 4: Cold Start Performance
 */
export async function benchmarkColdStart(
  browser: string = 'Chrome'
): Promise<BenchmarkResult> {
  console.log(`\n🔍 Benchmark: Cold Start Performance (${browser})`);

  const times: number[] = [];
  let successCount = 0;
  const iterations = 10;

  for (let i = 0; i < iterations; i++) {
    // Create fresh collector for each iteration (cold start)
    const collector = createCollector();

    const start = performance.now();
    const result = await collector.getActiveURL(browser);
    const end = performance.now();

    const duration = end - start;
    times.push(duration);

    if (result && result.url) {
      successCount++;
    }

    // Delay between cold starts
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const metrics: PerformanceMetrics = {
    iterations,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: Math.max(...times),
    min: Math.min(...times),
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    stdDev: stdDev(times),
    throughput: 1000 / (times.reduce((a, b) => a + b, 0) / times.length),
    successRate: successCount / iterations
  };

  const passed =
    metrics.p95 <= PERFORMANCE_TARGETS.p95 * 1.2 && // Allow 20% slack for cold start
    metrics.successRate >= PERFORMANCE_TARGETS.minSuccessRate;

  const result: BenchmarkResult = {
    name: 'Cold Start',
    platform: os.platform(),
    browser,
    metrics,
    timestamp: new Date().toISOString(),
    passed,
    notes: 'Fresh collector instance for each iteration'
  };

  console.log(`  ${formatMetrics(metrics)}`);
  if (result.notes) console.log(`  Note: ${result.notes}`);
  console.log(`  Overall: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);

  return result;
}

/**
 * Run All Benchmarks
 */
export async function runAllBenchmarks(browser: string = 'Chrome'): Promise<BenchmarkResult[]> {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Browser URL Collection - Performance Benchmark Suite        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`\nPlatform: ${os.platform()}`);
  console.log(`Browser: ${browser}`);
  console.log(`Node Version: ${process.version}`);
  console.log(`\nPerformance Targets:`);
  console.log(`  P50: ≤ ${PERFORMANCE_TARGETS.p50}ms`);
  console.log(`  P95: ≤ ${PERFORMANCE_TARGETS.p95}ms`);
  console.log(`  P99: ≤ ${PERFORMANCE_TARGETS.p99}ms`);
  console.log(`  Throughput: ≥ ${PERFORMANCE_TARGETS.minThroughput} ops/sec`);
  console.log(`  Success Rate: ≥ ${(PERFORMANCE_TARGETS.minSuccessRate * 100).toFixed(0)}%`);

  const results: BenchmarkResult[] = [];

  try {
    // 1. Basic Latency
    results.push(await benchmarkBasicLatency(browser, 100));

    // 2. Concurrent Collection
    results.push(await benchmarkConcurrentCollection(browser, 10));

    // 3. Cold Start
    results.push(await benchmarkColdStart(browser));

    // 4. Sustained Load (shorter for testing)
    results.push(await benchmarkSustainedLoad(browser, 15000));

  } catch (error) {
    console.error('❌ Benchmark failed:', error);
  }

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Benchmark Summary                                            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  results.forEach(result => {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`  ${result.name.padEnd(25)} ${status}`);
  });

  console.log(`\n  Overall: ${passedCount}/${totalCount} benchmarks passed`);
  console.log(`  Success Rate: ${((passedCount / totalCount) * 100).toFixed(1)}%\n`);

  // Save results to file
  await saveResults(results);

  return results;
}

/**
 * Save benchmark results to file
 */
async function saveResults(results: BenchmarkResult[]): Promise<void> {
  const fs = require('fs').promises;
  const path = require('path');

  const resultsDir = path.join(__dirname, '../../benchmark-results');
  await fs.mkdir(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `benchmark-${timestamp}.json`;
  const filepath = path.join(resultsDir, filename);

  const report = {
    timestamp: new Date().toISOString(),
    platform: os.platform(),
    nodeVersion: process.version,
    results
  };

  await fs.writeFile(filepath, JSON.stringify(report, null, 2));

  console.log(`  📊 Results saved to: ${filepath}\n`);
}

/**
 * Main execution when run directly
 */
if (require.main === module) {
  const browser = process.argv[2] || 'Chrome';

  runAllBenchmarks(browser)
    .then(results => {
      const allPassed = results.every(r => r.passed);
      process.exit(allPassed ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
