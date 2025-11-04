# Browser URL Collection - Troubleshooting Guide

Comprehensive troubleshooting guide for common issues with browser URL collection.

## Table of Contents

- [Common Issues](#common-issues)
- [Platform-Specific Issues](#platform-specific-issues)
- [Browser-Specific Issues](#browser-specific-issues)
- [Performance Issues](#performance-issues)
- [Privacy & Security Issues](#privacy--security-issues)
- [Diagnostic Tools](#diagnostic-tools)
- [Log Analysis](#log-analysis)

---

## Common Issues

### 1. Firefox Collection Fails Frequently

**Symptom**: Firefox URLs not collected reliably, success rate <50%

**Expected Behavior**: This is normal! Firefox collection is best-effort with 40-60% success rate.

**Root Cause**:
- AppleScript support in Firefox is unstable
- Firefox's internal architecture differs from Safari/Chrome
- Multi-level fallback implemented but inherently limited

**Solution**:
1. **Accept the limitation**: 40-60% success rate is expected
2. **Monitor**: Use metrics to track if rate drops below 40%
3. **Enterprise Option**: Consider browser extension for critical environments

```bash
# Check current Firefox success rate
npm run test:performance

# Review Firefox-specific logs
grep "Firefox" logs/url-collection.log | tail -50
```

**When to Escalate**:
- Success rate drops below 30% (indicates system issue)
- Complete failure (0% success rate)
- Performance degradation (>5 second collection time)

---

### 2. Permission Denied Errors

#### macOS: Accessibility Permission Required

**Symptom**: Error message `ACCESSIBILITY_PERMISSION_REQUIRED` or `Permission denied`

**Diagnosis**:
```bash
npm run test:health

# Output showing issue:
# ❌ Accessibility: Denied
```

**Solution**:

1. **Open System Preferences**:
   ```bash
   open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
   ```

2. **Grant Permission**:
   - Navigate to Security & Privacy → Privacy → Accessibility
   - Click lock icon (enter password)
   - Find "Employee Monitor" in list
   - Check the checkbox
   - If not in list, click "+" and add the application

3. **Restart Application**:
   ```bash
   # Quit and restart
   pkill -f "employee-monitor"
   npm run dev
   ```

4. **Verify**:
   ```bash
   npm run test:health
   # Should show: ✅ Accessibility: Granted
   ```

**Still Not Working?**

- Ensure running latest macOS (10.14+)
- Check System Integrity Protection (SIP) status
- Try removing and re-adding permission
- Restart system (last resort)

#### Windows: UI Automation Unavailable

**Symptom**: Error message `UI Automation unavailable` or `Service not running`

**Diagnosis**:
```powershell
Get-Service -Name "UI0Detect"

# If Status = "Stopped", this is the issue
```

**Solution**:

1. **Start Service**:
   ```powershell
   # As Administrator
   Start-Service -Name "UI0Detect"
   ```

2. **Set to Automatic**:
   ```powershell
   Set-Service -Name "UI0Detect" -StartupType Automatic
   ```

3. **Verify**:
   ```powershell
   Get-Service -Name "UI0Detect"
   # Should show Status = "Running"
   ```

4. **Test Collection**:
   ```powershell
   npm run test:health
   # Should show: ✅ UI Automation: Available
   ```

**Still Not Working?**

- Check Windows Update status (ensure latest updates)
- Verify Group Policy settings (may be blocked)
- Check antivirus/security software (may block UI Automation)
- Try restarting Windows

---

### 3. URLs Redacted as [REDACTED_SENSITIVE]

**Symptom**: All or most URLs showing as `[REDACTED_SENSITIVE]`

**Root Cause**: Privacy protection is working correctly for sensitive domains

**Expected Domains to be Redacted**:
- Email services: `mail.google.com`, `outlook.office.com`, `mail.yahoo.com`
- Banking sites: `bankofamerica.com`, `chase.com`, `wellsfargo.com`
- Healthcare portals: Patient portals, medical records sites
- Financial services: Investment platforms, payment processors

**When This is Expected**: ✅ Normal behavior for privacy protection

**When This is a Problem**: If corporate/internal sites are being redacted

**Solution for Corporate Domains**:

Edit `common/config/privacy-config.ts`:

```typescript
export const CUSTOM_PRIVACY_CONFIG: PrivacyConfig = {
  stripQueryParams: true,
  queryParamWhitelist: ['page', 'lang'],

  // Add your corporate domains here
  domainWhitelist: [
    'internal.company.com',
    'intranet.company.com',
    'jira.company.com',
    'confluence.company.com'
  ],

  sensitivePatterns: [
    /token=/i,
    /password=/i,
    /api[_-]?key=/i
  ]
};
```

**Verify Configuration**:
```bash
# Test with sample URLs
node -e "
const { sanitizeUrl } = require('./common/utils/privacy-helper');
const { CUSTOM_PRIVACY_CONFIG } = require('./common/config/privacy-config');
console.log(sanitizeUrl('https://internal.company.com/page', CUSTOM_PRIVACY_CONFIG));
"
```

---

### 4. URLs Redacted as [REDACTED_PATTERN]

**Symptom**: URLs with query parameters showing as `[REDACTED_PATTERN]`

**Root Cause**: URL contains sensitive patterns (tokens, API keys, passwords)

**Expected Patterns to be Redacted**:
- `?token=...`
- `?api_key=...`
- `?password=...`
- `?secret=...`
- Credit card numbers (13-19 digits)

**Solution**: This is expected behavior for security

**If You Need to Whitelist Parameters**:

```typescript
// common/config/privacy-config.ts
export const CUSTOM_PRIVACY_CONFIG: PrivacyConfig = {
  stripQueryParams: true,

  // Whitelist safe parameters
  queryParamWhitelist: [
    'page',
    'lang',
    'tab',
    'view',
    'sort',
    'filter'
  ],

  // Remove or modify sensitive patterns if needed
  sensitivePatterns: [
    /password=/i,
    /secret=/i
    // Removed /token=/i to allow tokens
  ]
};
```

**⚠️ Security Warning**: Only whitelist parameters you're certain don't contain sensitive data

---

## Platform-Specific Issues

### macOS Issues

#### Issue: "Operation Not Permitted"

**Symptom**: Error in logs: `Operation not permitted` when accessing browser

**Cause**: Missing Accessibility permission or SIP restriction

**Solution**:
```bash
# 1. Check SIP status
csrutil status

# 2. Grant Accessibility permission (see section above)

# 3. If SIP disabled (not recommended), re-enable:
# Reboot to Recovery Mode (Cmd+R)
# Open Terminal
csrutil enable
# Reboot normally
```

#### Issue: AppleScript Timeout

**Symptom**: Browser collection takes >5 seconds, times out frequently

**Cause**: AppleScript performance degradation

**Solution**:
```bash
# 1. Check system load
top -l 1 | grep "CPU usage"

# 2. Restart affected browser
pkill Safari && open -a Safari

# 3. Clear system caches (if persistent)
sudo purge
```

#### Issue: Safari Specific Collection Failure

**Symptom**: Safari works but URL collection fails

**Cause**: Safari privacy settings

**Solution**:
1. Safari → Preferences → Privacy
2. Uncheck "Prevent cross-site tracking" (temporarily for testing)
3. Ensure JavaScript is enabled

### Windows Issues

#### Issue: UI Automation Blocked by Group Policy

**Symptom**: UI Automation service won't start, Group Policy error

**Cause**: Corporate Group Policy restricts UI Automation

**Solution**:
```powershell
# 1. Check Group Policy
gpresult /r | findstr "UI Automation"

# 2. Contact IT to enable via GPO:
# Computer Configuration → Administrative Templates → Windows Components
# → Desktop Window Manager → Enable UI Automation

# 3. Force Group Policy update
gpupdate /force
```

#### Issue: Antivirus Blocks UI Automation

**Symptom**: UI Automation works then stops, security alerts

**Cause**: Antivirus software detecting UI Automation as suspicious

**Solution**:
1. Add Employee Monitor to antivirus exceptions
2. Specifically whitelist UI Automation access
3. Contact IT/Security team for corporate exceptions

---

## Browser-Specific Issues

### Chrome Issues

#### Issue: Chrome URL Collection Intermittent

**Symptom**: Chrome works sometimes, fails other times (60-80% success)

**Diagnosis**:
```bash
# Check if Chrome is running
# macOS
ps aux | grep "Google Chrome"

# Windows
Get-Process | Where-Object {$_.ProcessName -like "*chrome*"}
```

**Solution**:
1. **Ensure Chrome is active window**
2. **Disable Chrome extensions** (some interfere with AppleScript/UI Automation)
3. **Update Chrome** to latest version
4. **Check permission** is granted

### Edge Issues

#### Issue: Edge Not Detected

**Symptom**: Edge is running but not detected by collector

**Cause**: Process name mismatch

**Solution**:
```typescript
// Check platforms/[platform]/url-collector.ts
// Ensure Edge process names are correct:
// - macOS: "Microsoft Edge"
// - Windows: "msedge.exe"
```

### Safari Issues

#### Issue: Safari Collection Stopped Working After macOS Update

**Symptom**: Safari worked before macOS update, now fails

**Cause**: macOS updates can reset Accessibility permissions

**Solution**:
1. Re-grant Accessibility permission
2. Restart Safari
3. Restart Employee Monitor

---

## Performance Issues

### Issue: Collection Takes >5 Seconds

**Symptom**: URL collection extremely slow (>5 seconds per attempt)

**Diagnosis**:
```bash
# Run performance benchmark
npm run test:performance

# Check P95 and P99 latencies
# Target: P95 <250ms, P99 <1000ms
```

**Causes**:
1. System overload (CPU/Memory)
2. Network latency (for remote automation)
3. Browser performance issues
4. Fallback chain exhaustion (Firefox)

**Solutions**:

1. **Reduce polling frequency**:
   ```typescript
   // Increase interval between collections
   const COLLECTION_INTERVAL = 60000; // 60 seconds instead of 30
   ```

2. **Optimize fallback timeouts**:
   ```typescript
   // platforms/darwin/url-collector.ts
   const APPLESCRIPT_TIMEOUT = 2000; // Reduce from 3000ms
   ```

3. **Check system resources**:
   ```bash
   # macOS
   top -l 1

   # Windows
   Get-Counter '\Processor(_Total)\% Processor Time'
   ```

4. **Disable unnecessary fallbacks** (if acceptable):
   ```typescript
   // Only use primary method, skip fallbacks for speed
   // (Reduces reliability for Firefox)
   ```

### Issue: High Memory Usage

**Symptom**: Memory usage grows over time, eventually crashes

**Diagnosis**:
```bash
# Check memory usage
node --expose-gc --trace-gc performance/benchmark.js

# Monitor over time
while true; do ps aux | grep employee-monitor | awk '{print $4"%"}'; sleep 60; done
```

**Solution**:
```typescript
// Implement proper cleanup
export class URLCollector {
  private cache: Map<string, any> = new Map();

  cleanup() {
    this.cache.clear();
    if (global.gc) global.gc(); // Force garbage collection
  }
}

// Call cleanup periodically
setInterval(() => collector.cleanup(), 300000); // Every 5 minutes
```

---

## Privacy & Security Issues

### Issue: Sensitive Data Exposure

**Symptom**: Logs contain sensitive URLs or tokens

**Immediate Action**:
1. Stop the service immediately
2. Rotate any exposed credentials
3. Delete log files containing sensitive data
4. Review privacy configuration

**Prevention**:
```typescript
// Ensure strict privacy config
import { STRICT_PRIVACY_CONFIG } from './common/config/privacy-config';

// Apply to all URLs
const sanitized = sanitizeUrl(url, STRICT_PRIVACY_CONFIG);
```

**Audit Logs**:
```bash
# Search for potential leaks
grep -E "(token|password|api_key)" logs/*.log

# If found, delete and rotate credentials
```

---

## Diagnostic Tools

### Built-in Health Check

```bash
# Comprehensive health check
npm run test:health

# Expected output:
# ✅ Platform: darwin
# ✅ Accessibility: Granted
# ✅ Browser Detection: 3 browsers found
# ✅ URL Collection: Safari ✅, Chrome ✅, Firefox ⚠️
# ✅ Privacy Protection: Enabled
# ✅ Tamper Detection: Active
```

### Performance Diagnostics

```bash
# Run performance benchmarks
npm run test:performance

# Output includes:
# - P50, P95, P99 latencies
# - Throughput (ops/sec)
# - Success rates by browser
```

### Integration Tests

```bash
# Run comprehensive integration tests
npm test -- test/integration/browser-url-collection.test.ts

# Test specific browser
npm test -- test/integration/firefox-collection.test.ts
```

### Manual Testing

```bash
# Test single URL collection
node -e "
const { DarwinURLCollector } = require('./platforms/darwin/url-collector');
const collector = new DarwinURLCollector();
collector.getActiveURL('Chrome').then(console.log);
"
```

---

## Log Analysis

### Log Locations

**macOS**:
```bash
~/Library/Logs/employee-monitor/url-collection.log
~/Library/Logs/employee-monitor/error.log
```

**Windows**:
```powershell
%APPDATA%\employee-monitor\logs\url-collection.log
%APPDATA%\employee-monitor\logs\error.log
```

**Fallback** (both platforms):
```bash
./logs/url-collection.log
./logs/error.log
```

### Common Log Patterns

#### Success Pattern
```
[2025-11-03T10:30:45.123Z] [INFO] URL Collection: Chrome - Success (125ms) - https://github.com
```

#### Permission Error
```
[2025-11-03T10:30:46.456Z] [ERROR] URL Collection: Safari - Failed: ACCESSIBILITY_PERMISSION_REQUIRED
```

#### Timeout Error
```
[2025-11-03T10:30:47.789Z] [ERROR] URL Collection: Firefox - Failed: AppleScript timeout after 3000ms
```

#### Privacy Redaction
```
[2025-11-03T10:30:48.012Z] [INFO] URL Collection: Chrome - Success (98ms) - [REDACTED_SENSITIVE]
```

### Log Analysis Commands

```bash
# Count successes vs failures
grep "Success" logs/url-collection.log | wc -l
grep "Failed" logs/url-collection.log | wc -l

# Success rate calculation
echo "scale=2; $(grep -c Success logs/url-collection.log) * 100 / $(wc -l < logs/url-collection.log)" | bc

# Average response time
grep "Success" logs/url-collection.log | grep -oE '\([0-9]+ms\)' | grep -oE '[0-9]+' | awk '{sum+=$1; n++} END {print sum/n "ms"}'

# Most common errors
grep "Failed:" logs/url-collection.log | cut -d':' -f4 | sort | uniq -c | sort -rn

# Firefox specific analysis
grep "Firefox" logs/url-collection.log | grep -oE '(applescript|window_title|history)' | sort | uniq -c
```

### Enable Debug Logging

```bash
# macOS/Linux
export DEBUG=url-collection:*
npm run dev

# Windows
set DEBUG=url-collection:*
npm run dev
```

---

## Support Escalation

### When to Escalate

Escalate to engineering team if:

1. **Critical Success Rate Drop**: Overall success rate <50% (excluding Firefox)
2. **System-Wide Failure**: All browsers failing simultaneously
3. **Permission Bugs**: Permission granted but still failing
4. **Performance Degradation**: P95 latency >5 seconds
5. **Security Concerns**: Potential data exposure
6. **New Browser/OS Issues**: Latest browser/OS update breaks functionality

### Information to Collect

When escalating, include:

```bash
# 1. System information
uname -a                    # macOS/Linux
Get-ComputerInfo           # Windows

# 2. Browser versions
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version  # macOS
Get-Package -Name "*Chrome*"                                            # Windows

# 3. Recent logs (last 100 lines)
tail -100 logs/url-collection.log
tail -100 logs/error.log

# 4. Health check output
npm run test:health > health-check.txt

# 5. Performance metrics
npm run test:performance > perf-metrics.txt

# 6. Integration test results
npm test > test-results.txt 2>&1
```

### Contact Information

- **Technical Support**: support@company.com
- **Documentation**: [deployment-guide.md](./deployment-guide.md)
- **GitHub Issues**: [github.com/company/employee-monitor/issues](https://github.com)

---

## FAQ

**Q: Why is Firefox collection so unreliable?**
A: Firefox's AppleScript support is inherently unstable. We use a multi-level fallback, but 40-60% success is the best achievable without a browser extension.

**Q: Can I disable privacy protection?**
A: Yes, but not recommended. Use `MINIMAL_PRIVACY_CONFIG` for development only.

**Q: How do I know if URL collection is working?**
A: Run `npm run test:health` - should show ✅ for all components.

**Q: What browsers are supported?**
A: Chrome, Safari, Edge (all platforms), Firefox (best-effort).

**Q: Is this GDPR compliant?**
A: Yes, with `STRICT_PRIVACY_CONFIG` and proper data handling policies.

**Q: Can I collect URLs from private/incognito windows?**
A: No, browser security prevents access to private browsing sessions.

**Q: Why are banking/email sites always [REDACTED]?**
A: Privacy protection. Use `domainWhitelist` only for corporate internal sites.

**Q: How can I improve Firefox success rate?**
A: Consider deploying a browser extension for enterprise environments requiring high reliability.
