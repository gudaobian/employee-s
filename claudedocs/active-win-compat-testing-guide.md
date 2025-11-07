# active-win-compat Testing Guide

## Quick Reference

### Run All Tests
```bash
# Unit tests only
npm run test:active-win

# Integration tests only
npm run test:window-monitoring

# All tests with coverage
npm run test:coverage -- --testPathPattern="active-win-compat|window-monitoring"

# Performance benchmark
npm run benchmark:active-win
```

## Unit Tests

### Test Structure
The unit tests are organized into 5 main categories:

#### 1. Basic Functionality Tests
Verify core window detection capabilities:
```bash
# Run specific test category
npm run test:active-win -- --testNamePattern="activeWindow"
```

**Tests:**
- Return value validation (null or WindowInfo object)
- Required fields presence (id, title, owner, bounds)
- Self-application exclusion (Electron, EmployeeMonitor)
- Process ID validation (> 0)
- Bundle ID format (reverse domain notation)

#### 2. Module Constants
Verify exported constants:
```bash
npm run test:active-win -- --testNamePattern="Module Constants"
```

**Tests:**
- VERSION = "1.0.0"
- PLATFORM = "darwin"
- MIN_OS_VERSION = "10.15"
- Semantic versioning format
- macOS version format

#### 3. Helper Functions
Test utility functions:
```bash
npm run test:active-win -- --testNamePattern="isAvailable"
```

**Tests:**
- Return type (boolean)
- Error handling (no exceptions)
- Consistency across calls

#### 4. Error Handling
Verify resilience:
```bash
npm run test:active-win -- --testNamePattern="Error Handling"
```

**Tests:**
- Graceful null returns on errors
- Rapid successive calls stability
- Timeout scenario handling

#### 5. Performance Characteristics
Basic performance validation:
```bash
npm run test:active-win -- --testNamePattern="Performance"
```

**Tests:**
- Single call latency (< 5000ms)
- Average latency over 5 calls (< 2000ms)

### Coverage Analysis

View detailed coverage:
```bash
npm run test:coverage -- --testPathPattern="active-win-compat" --coverageReporters=text
```

**Current Coverage:**
- Lines: 70% (158/224)
- Functions: 100% (5/5)
- Branches: 35.29% (12/34)

**Uncovered Areas:**
- Error logging paths (timeout, ENOENT)
- Incomplete result handling
- isAvailable() catch block

## Integration Tests

### Test Categories

#### 1. MacOSAdapter Integration
Verify adapter correctly uses active-win-compat:
```bash
npm run test:window-monitoring -- --testNamePattern="MacOSAdapter Integration"
```

**Tests:**
- Adapter initialization
- getActiveWindow() functionality
- Self-application exclusion
- Process ID validation
- WindowInfo structure

#### 2. Continuous Operation Stability
Test long-running reliability:
```bash
npm run test:window-monitoring -- --testNamePattern="Continuous Operation"
```

**Tests:**
- 10-iteration stability (10 seconds)
- Performance consistency (5 calls)
- Memory leak detection (20 iterations)

#### 3. Direct Module Integration
Verify consistency:
```bash
npm run test:window-monitoring -- --testNamePattern="Direct active-win-compat"
```

**Tests:**
- Direct module usage
- Data consistency with adapter

#### 4. Error Recovery
Test resilience:
```bash
npm run test:window-monitoring -- --testNamePattern="Error Recovery"
```

**Tests:**
- Rapid successive calls (10 parallel)
- Temporary failure recovery (80% success rate)

## Performance Benchmark

### Basic Usage

Run standard 100-iteration benchmark:
```bash
npm run benchmark:active-win
```

**Expected Output:**
```
========================================
  active-win-compat Performance Benchmark
========================================

Iterations: 100
GC Enabled: true

Running benchmark...
Progress: 100/100 (100%)
Completed in 5.23s

========================================
         Performance Report
========================================

--- Test Configuration ---
Iterations:    100
Success Count: 97
Failure Count: 3
Total Time:    5.23s

--- Reliability ---
Success Rate:  97.00%
Throughput:    19.12 ops/sec

--- Latency Statistics ---
P50 (median):  42ms
P95:           89ms
P99:           156ms
Average:       48.23ms
Min:           28ms
Max:           234ms

--- Memory Usage ---
Initial:       45.23 MB
Final:         46.87 MB
Growth:        1.64 MB

--- Performance Targets ---
P50 Target: ≤ 50ms      → ✅ PASS (42ms)
P95 Target: ≤ 100ms     → ✅ PASS (89ms)
P99 Target: ≤ 200ms     → ✅ PASS (156ms)
Success Rate: ≥ 95%     → ✅ PASS (97.00%)
Throughput: ≥ 20 ops/s  → ❌ FAIL (19.12 ops/s)
Memory: ≤ 5MB           → ✅ PASS (1.64MB)

--- Overall Result ---
❌ SOME TARGETS NOT MET

========================================
```

### Custom Iterations

Run with different iteration counts:
```bash
# Quick test (30 iterations)
npm run benchmark:active-win 30

# Standard test (100 iterations)
npm run benchmark:active-win 100

# Comprehensive test (500 iterations)
npm run benchmark:active-win 500
```

### Export Results

Save results to JSON file:
```bash
npm run benchmark:active-win 100 --export=benchmark-results.json
```

**JSON Structure:**
```json
{
  "timestamp": "2025-11-06T10:30:00.000Z",
  "platform": "darwin",
  "nodeVersion": "v18.20.8",
  "result": {
    "iterations": 100,
    "successCount": 97,
    "failureCount": 3,
    "p50": 42,
    "p95": 89,
    "p99": 156,
    "avg": 48.23,
    "successRate": 97,
    "throughput": 19.12,
    "memoryUsage": {
      "initial": 47456256,
      "final": 49175552,
      "growth": 1719296,
      "growthMB": 1.64
    }
  }
}
```

### Baseline Comparison

Compare current run with baseline:
```typescript
import { runBenchmark, compareWithBaseline } from './test/performance/active-win-compat-benchmark';

// Run current benchmark
const current = await runBenchmark(100);

// Load baseline from file
const baseline = JSON.parse(fs.readFileSync('baseline.json', 'utf8')).result;

// Compare
compareWithBaseline(current, baseline);
```

**Output:**
```
========================================
      Baseline Comparison
========================================

P50 Latency:   45ms → 42ms (-6.7%)
P95 Latency:   95ms → 89ms (-6.3%)
P99 Latency:   180ms → 156ms (-13.3%)
Throughput:    18.50 → 19.12 ops/s (+3.4%)

========================================
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Test active-win-compat

on: [push, pull_request]

jobs:
  test-macos:
    runs-on: macos-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:active-win -- --forceExit

      - name: Run integration tests
        run: npm run test:window-monitoring -- --forceExit

      - name: Generate coverage report
        run: npm run test:coverage -- --testPathPattern="active-win-compat"

      - name: Run performance benchmark
        run: npm run benchmark:active-win 50

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

## Troubleshooting

### Jest Doesn't Exit

**Issue:** Jest hangs after tests complete
```
Jest did not exit one second after the test run has completed.
```

**Solution:** Use `--forceExit` flag
```bash
npm run test:active-win -- --forceExit
```

### Platform Detection Issues

**Issue:** Tests skip on macOS
**Cause:** Platform detection failing

**Solution:** Check platform manually
```bash
node -e "console.log(process.platform)"
# Should output: darwin
```

### Compilation Errors

**Issue:** TypeScript compilation fails for tests

**Solution:** Exclude test files from compilation
```json
// tsconfig.json
{
  "exclude": ["node_modules", "dist"]
}
```

### Low Coverage

**Issue:** Coverage below 80%

**Explanation:** Some error paths are hard to trigger without mocking:
- Timeout scenarios
- osascript not found (ENOENT)
- JXA execution errors

**Solution:** Add mock-based tests for error paths
```typescript
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, opts, callback) => {
    callback(new Error('ENOENT'), null, null);
  })
}));
```

## Best Practices

### 1. Run Tests Before Commits
```bash
# Pre-commit hook
npm run test:active-win -- --forceExit && npm run compile
```

### 2. Monitor Performance Trends
```bash
# Weekly benchmark
npm run benchmark:active-win 200 --export=benchmark-$(date +%Y%m%d).json
```

### 3. Verify Coverage
```bash
# Check coverage before merging
npm run test:coverage -- --testPathPattern="active-win-compat" --coverageThreshold='{"global":{"lines":70}}'
```

### 4. Test Isolation
Each test should be independent:
- No shared state
- Clean up after each test
- Use beforeEach/afterEach hooks

### 5. Meaningful Test Names
Use descriptive test names:
```typescript
// Good
it('should exclude EmployeeMonitor from results', ...)

// Bad
it('test 1', ...)
```

## Test Maintenance

### Adding New Tests

1. **Unit Tests:** Add to `platforms/macos/active-win-compat.test.ts`
2. **Integration Tests:** Add to `test/integration/window-monitoring.test.ts`
3. **Performance:** Modify benchmark thresholds in `test/performance/active-win-compat-benchmark.ts`

### Updating Test Data

When module behavior changes:
1. Update expected values in assertions
2. Adjust performance thresholds if needed
3. Update coverage thresholds in `jest.config.js`

### Deprecating Tests

When removing functionality:
1. Mark test with `.skip()`
2. Add comment explaining deprecation
3. Remove in next major version

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [TypeScript Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [active-win-compat Source](../platforms/macos/active-win-compat.ts)
- [Test Coverage Report](../coverage/lcov-report/index.html)
