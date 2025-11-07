# Quick Start: macOS URL Collection Testing

**5-Minute Setup** → **Run Tests** → **View Reports**

---

## Prerequisites (2 minutes)

```bash
# 1. Grant Accessibility Permission
# System Preferences → Security & Privacy → Privacy → Accessibility
# Add: Terminal or employee-client

# 2. Start Application
cd employee-client
npm run dev

# 3. Verify Running
pgrep -f "employee-client"  # Should return a process ID
```

---

## Run All Tests (Sequential)

### Option 1: Full Test Suite (~8+ hours)

```bash
# Run all tests sequentially
./test/manual/browser-compatibility-test.sh && \
./test/manual/privacy-protection-test.sh && \
./test/manual/performance-test.sh
```

### Option 2: Quick Validation (~30 minutes)

```bash
# 1. Edit browser test (reduce iterations)
# In browser-compatibility-test.sh, change: TEST_ITERATIONS=5

# 2. Run quick tests
./test/manual/browser-compatibility-test.sh && \
./test/manual/privacy-protection-test.sh && \
./test/manual/performance-test.sh 1
```

### Option 3: Individual Tests

```bash
# Browser compatibility (~100 min)
./test/manual/browser-compatibility-test.sh

# Privacy protection (~20 min)
./test/manual/privacy-protection-test.sh

# Performance (custom hours)
./test/manual/performance-test.sh 2  # 2 hours
```

---

## View Results

```bash
# List all generated reports
ls -lh ../../doc/test-reports/

# View latest compatibility report
cat ../../doc/test-reports/browser-compatibility-report_*.md | less

# View latest privacy report
cat ../../doc/test-reports/privacy-protection-report_*.md | less

# View latest performance report
cat ../../doc/test-reports/performance-report_*.md | less
```

---

## Interpret Results

### ✅ All Tests Pass

```
Browser Compatibility:
  Safari: 19/20 (95%) ✅
  Chrome: 18/20 (90%) ✅
  Edge: 17/20 (85%) ✅
  Firefox: 8/20 (40%) ✅ (known limitation)
  Brave: 17/20 (85%) ✅

Privacy Protection:
  All sensitive data filtered ✅

Performance:
  Memory growth: 35MB (≤50MB) ✅
  P50: 45ms (≤60ms) ✅
  P95: 180ms (≤250ms) ✅
  P99: 800ms (≤1000ms) ✅
```

**Action**: ✅ Ready for release

---

### ⚠️ Some Tests Fail

```
Browser Compatibility:
  Chrome: 15/20 (75%) ❌ (target: 90%)

Performance:
  Memory growth: 65MB ❌ (target: ≤50MB)
```

**Action**:
1. Review detailed report for failure reasons
2. Check logs: `grep ERROR logs/app.log`
3. Investigate and fix issues
4. Re-run tests

---

### ❌ Critical Failures

```
Privacy Protection:
  Sensitive data leaking ❌

Performance:
  Application crashed after 2 hours ❌
```

**Action**:
1. **DO NOT RELEASE**
2. File critical bug
3. Debug with: `export LOG_LEVEL=debug && npm run dev`
4. Fix issues before re-testing

---

## Troubleshooting

### Application Won't Start

```bash
# Check Node.js version
node --version  # Should be ≥16.0.0

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check for errors
npm run dev 2>&1 | tee startup.log
```

### Permission Denied

```bash
# Verify permission
osascript -e 'tell application "System Events" to get properties'

# If error, grant permission:
# System Preferences → Security & Privacy → Privacy → Accessibility
# Add Terminal or employee-client, then restart app
```

### Firefox Success Rate Low (<40%)

```
This is EXPECTED. Firefox AppleScript support is limited.
Target is 40%, not 85% like other browsers.

If <30%, check:
- Firefox is latest version
- Fallback mechanisms are working
- Check logs: grep "Firefox" logs/app.log
```

### Tests Hanging

```bash
# Kill hung browsers
killall Safari Chrome Firefox "Microsoft Edge" "Brave Browser"

# Restart application
npm run dev

# Re-run test
./test/manual/[script-name].sh
```

---

## Next Steps

**For Development**:
- Read: [test-instructions.md](test-instructions.md) - Detailed guide
- Read: [README.md](README.md) - Complete documentation
- Read: [../../doc/测试指南_macOS_URL采集.md](../../doc/测试指南_macOS_URL采集.md) - Chinese guide

**For Reporting**:
- Use: [../../doc/测试报告模板_macOS_URL采集.md](../../doc/测试报告模板_macOS_URL采集.md) - Report template
- Archive: Save reports in `doc/test-reports/`
- Compare: Track performance across versions

**For CI/CD**:
- Set up automated daily tests
- Monitor performance trends
- Alert on regression

---

## Support

**Documentation**:
- Full testing guide: `test-instructions.md`
- Script documentation: `README.md`
- Project docs: `../../docs/`

**Issues**:
- Check logs: `logs/app.log`
- System logs: `log show --predicate 'process == "employee-client"' --last 1h`
- GitHub Issues: [project repository]

---

**Quick Reference Card**

| Command | Duration | Purpose |
|---------|----------|---------|
| `./browser-compatibility-test.sh` | 100 min | Test all browsers |
| `./privacy-protection-test.sh` | 20 min | Test privacy filters |
| `./performance-test.sh` | 8 hours | Test stability |
| `./performance-test.sh 2` | 2 hours | Quick performance |
| `ls ../../doc/test-reports/` | - | View reports |
| `pgrep -f "employee-client"` | - | Check if running |
| `grep ERROR logs/app.log` | - | Find errors |
| `chmod +x test/manual/*.sh` | - | Make executable |

---

**Last Updated**: 2025-11-03
