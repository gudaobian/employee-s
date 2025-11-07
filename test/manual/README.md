# macOS URL Collection Testing Suite

Comprehensive testing tools for validating browser URL collection functionality on macOS.

---

## Quick Start

```bash
# 1. Ensure application is running
npm run dev

# 2. Run all tests (quick overview)
./test/manual/browser-compatibility-test.sh
./test/manual/privacy-protection-test.sh
./test/manual/performance-test.sh 2  # 2-hour quick test

# 3. View generated reports
ls -lh ../../doc/test-reports/
```

---

## Available Test Scripts

### 1. Browser Compatibility Test
**Script**: `browser-compatibility-test.sh`
**Duration**: ~100 minutes
**Purpose**: Verify URL collection success rates across browsers

```bash
./browser-compatibility-test.sh
```

**What it tests**:
- Safari: ≥95% success rate (19/20)
- Chrome: ≥90% success rate (18/20)
- Edge: ≥85% success rate (17/20)
- Firefox: ≥40% success rate (8/20) - Known limitation
- Brave: ≥85% success rate (17/20)

**Output**: `doc/test-reports/browser-compatibility-report_[timestamp].md`

---

### 2. Privacy Protection Test
**Script**: `privacy-protection-test.sh`
**Duration**: ~20 minutes
**Purpose**: Verify sensitive data filtering and redaction

```bash
./privacy-protection-test.sh
```

**What it tests**:
- Query parameter stripping (token, api_key, password)
- Sensitive domain redaction (email, banking, healthcare)
- Pattern-based filtering (credit cards, sessions)
- URL fragment removal
- Whitelist parameter preservation

**Output**: `doc/test-reports/privacy-protection-report_[timestamp].md`

---

### 3. Performance & Stability Test
**Script**: `performance-test.sh [hours]`
**Duration**: 8 hours (default), customizable
**Purpose**: Validate performance metrics and long-term stability

```bash
# Default 8-hour test
./performance-test.sh

# Custom duration (4 hours)
./performance-test.sh 4

# Extended test (24 hours)
./performance-test.sh 24
```

**What it tests**:
- Memory usage (≤50MB growth in 8 hours)
- Latency percentiles (P50≤60ms, P95≤250ms, P99≤1000ms)
- Error rates and failure patterns
- Application stability (no crashes)

**Output**: `doc/test-reports/performance-report_[timestamp].md`

---

## Prerequisites

### 1. Application Setup
```bash
# Start the application
cd employee-client
npm run dev

# Or use packaged app
open -a "Employee Monitor"

# Verify it's running
pgrep -f "employee-client"  # Should return a process ID
```

### 2. System Permissions
**macOS Accessibility Permission Required**

1. Open **System Preferences** → **Security & Privacy** → **Privacy** → **Accessibility**
2. Click lock icon to unlock
3. Add: `employee-client` or `Terminal.app`
4. Restart application

### 3. Browser Installation
Install browsers you want to test:
- Safari (pre-installed)
- [Chrome](https://www.google.com/chrome/)
- [Edge](https://www.microsoft.com/edge)
- [Firefox](https://www.mozilla.org/firefox/)
- [Brave](https://brave.com/)

### 4. Test Environment
```bash
# Create log directory
mkdir -p logs

# Create report directory
mkdir -p ../../doc/test-reports

# Ensure write permissions
chmod +x test/manual/*.sh
```

---

## Test Execution Guide

### Full Test Suite (Recommended)

```bash
# 1. Browser Compatibility (~100 min)
./browser-compatibility-test.sh

# 2. Privacy Protection (~20 min)
./privacy-protection-test.sh

# 3. Performance (8 hours, run overnight)
./performance-test.sh

# 4. Review all reports
ls -lh ../../doc/test-reports/
```

### Quick Validation (30 minutes)

```bash
# Quick browser test (5 iterations instead of 20)
# Edit browser-compatibility-test.sh: TEST_ITERATIONS=5

# Quick performance test (1 hour)
./performance-test.sh 1

# Privacy test (full, only 20 min)
./privacy-protection-test.sh
```

### Continuous Integration

```bash
# Automated daily testing
crontab -e

# Add daily test at 2 AM
0 2 * * * cd /path/to/employee-client && ./test/manual/performance-test.sh 8 >> logs/daily-test.log 2>&1
```

---

## Monitoring Tests in Progress

### Terminal 1: Test Script
```bash
./browser-compatibility-test.sh
```

### Terminal 2: Log Monitoring
```bash
tail -f logs/app.log | grep -E "(SUCCESS|FAIL|collected)"
```

### Terminal 3: Memory Monitoring
```bash
watch -n 60 "ps aux | grep employee-client | grep -v grep | awk '{print \$6 \" KB\"}'"
```

### Terminal 4: Latency Monitoring
```bash
watch -n 10 "grep 'URL collected in' logs/app.log | tail -10"
```

---

## Understanding Test Results

### Success Criteria

#### Browser Compatibility
- **Pass**: All browsers meet or exceed target success rates
- **Warning**: 1-2 browsers slightly below target (within 5%)
- **Fail**: Any browser >10% below target (except Firefox)

#### Privacy Protection
- **Pass**: All sensitive data properly filtered/redacted
- **Warning**: Some edge cases need manual verification
- **Fail**: Sensitive data leaking through filters

#### Performance
- **Pass**: All metrics within targets (memory, latency, stability)
- **Warning**: 1 metric slightly over target (within 10%)
- **Fail**: Multiple metrics over target or critical issues

### Report Locations

All generated reports are saved to:
```
doc/test-reports/
├── browser-compatibility-report_YYYYMMDD_HHMMSS.md
├── privacy-protection-report_YYYYMMDD_HHMMSS.md
└── performance-report_YYYYMMDD_HHMMSS.md
```

### Report Contents

Each report includes:
- **Test Summary**: Pass/fail status and key metrics
- **Detailed Analysis**: Per-browser or per-case breakdown
- **Recommendations**: Suggested improvements
- **Raw Data**: Tables and statistics

---

## Troubleshooting

### Problem: Application Not Running
```bash
# Check if running
pgrep -f "employee-client"

# If not, start it
npm run dev

# Check logs for errors
tail -50 logs/app.log
```

### Problem: Permission Denied
```bash
# Verify Accessibility permission
osascript -e 'tell application "System Events" to get properties'

# If error, grant permission:
# System Preferences → Security & Privacy → Privacy → Accessibility
```

### Problem: Browser Not Installed
```bash
# Test will skip missing browsers
# Install from:
# - Chrome: https://www.google.com/chrome/
# - Edge: https://www.microsoft.com/edge
# - Firefox: https://www.mozilla.org/firefox/
# - Brave: https://brave.com/
```

### Problem: Tests Hanging
```bash
# Kill hung process
killall -9 Safari Chrome Firefox "Microsoft Edge" "Brave Browser"

# Restart test
./test/manual/[script-name].sh
```

### Problem: Low Success Rates
```bash
# Check system load
top -l 1 | head -10

# Check network
ping -c 5 google.com

# Review detailed logs
grep -E "(ERROR|WARN|FAIL)" logs/app.log

# Increase wait time (edit scripts)
# Change: WAIT_TIME=60 to WAIT_TIME=90
```

---

## Best Practices

### Before Testing
- [ ] Close unnecessary applications
- [ ] Disable VPN (may affect latency)
- [ ] Ensure stable internet connection
- [ ] Clear old logs: `rm logs/app.log`
- [ ] Verify permissions granted

### During Testing
- [ ] Keep Mac awake (System Preferences → Energy Saver)
- [ ] Don't interfere with test browsers
- [ ] Monitor logs for issues
- [ ] Note any system errors or warnings

### After Testing
- [ ] Review all generated reports
- [ ] Compare with previous test results
- [ ] Document any anomalies
- [ ] Archive reports with version info
- [ ] Update test baselines if needed

---

## Advanced Usage

### Custom Test Configurations

#### Modify Test Iterations
Edit `browser-compatibility-test.sh`:
```bash
TEST_ITERATIONS=20  # Change to 10 for quick test
```

#### Modify Privacy Test Cases
Edit `privacy-protection-test.sh`:
```bash
# Add custom test cases to PRIVACY_TESTS array
declare -A PRIVACY_TESTS=(
  ["Custom Test"]="https://custom-url.com?param=value"
)
```

#### Modify Performance Thresholds
Edit `performance-test.sh`:
```bash
P50_TARGET=60   # Change thresholds as needed
P95_TARGET=250
P99_TARGET=1000
MEMORY_THRESHOLD_MB=50
```

### Running Specific Browser Tests

Edit `browser-compatibility-test.sh` to test only specific browsers:
```bash
# Only test Safari and Chrome
for browser in "Safari" "Google Chrome"; do
  test_browser "$browser"
done
```

### Debugging Failed Tests

```bash
# Enable debug logging
export LOG_LEVEL=debug
npm run dev

# Run test with verbose output
bash -x ./test/manual/browser-compatibility-test.sh

# Analyze specific failure
grep "FAIL" logs/app.log | tail -20
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Browser URL Collection Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '16'
      - name: Install dependencies
        run: npm install
      - name: Run compatibility test
        run: ./test/manual/browser-compatibility-test.sh
      - name: Run privacy test
        run: ./test/manual/privacy-protection-test.sh
      - name: Upload reports
        uses: actions/upload-artifact@v3
        with:
          name: test-reports
          path: doc/test-reports/
```

---

## Appendix

### Quick Reference Commands

```bash
# Start application
npm run dev

# Run all tests (sequential)
./browser-compatibility-test.sh && \
./privacy-protection-test.sh && \
./performance-test.sh 2

# View latest reports
ls -lt ../../doc/test-reports/ | head -5

# Analyze logs
grep "SUCCESS\|FAIL" logs/app.log | wc -l

# Check memory usage
ps aux | grep employee-client | grep -v grep | awk '{print $6 " KB"}'

# Extract latency stats
grep "URL collected in" logs/app.log | \
  grep -oE "[0-9]+ms" | \
  sed 's/ms//' | \
  sort -n | \
  awk '{sum+=$1; if(NR%2==1){med=$1}} END{print "Avg:", sum/NR, "Median:", med}'
```

### Performance Targets Reference

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| Safari Success Rate | ≥95% | <90% |
| Chrome Success Rate | ≥90% | <85% |
| Edge Success Rate | ≥85% | <80% |
| Firefox Success Rate | ≥40% | <30% |
| Brave Success Rate | ≥85% | <80% |
| Memory Growth (8h) | ≤50MB | >100MB |
| P50 Latency | ≤60ms | >100ms |
| P95 Latency | ≤250ms | >500ms |
| P99 Latency | ≤1000ms | >2000ms |

### Related Documentation

- **Test Instructions**: `test-instructions.md` - Detailed step-by-step guide
- **Test Report Template**: `../../doc/测试报告模板_macOS_URL采集.md`
- **Privacy Config**: `../../common/config/privacy-config.ts`
- **URL Collector**: `../../platforms/darwin/url-collector.ts`
- **Permission Checker**: `../../platforms/macos/permission-checker.ts`

---

**Test Suite Version**: 1.0.0
**Last Updated**: 2025-11-03
**Maintainer**: Development Team
