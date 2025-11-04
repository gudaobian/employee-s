# Firefox URL Collection - Testing Guide

Quick reference for testing Firefox URL collection implementation.

## 🧪 Quick Tests

### Test 1: AppleScript Direct Test

```bash
# Open Firefox and navigate to any website, then run:
osascript -e 'tell application "Firefox" to get URL of active tab of front window'
```

**Expected Results**:
- ✅ Success: Returns URL like `https://github.com`
- ⚠️ Timeout: Takes >2 seconds (expected for some Firefox versions)
- ❌ Error: `execution error: Firefox got an error: ...` (expected ~50-70% of time)

### Test 2: Window Title Test

```bash
# With Firefox active, run:
osascript -e 'tell application "System Events" to tell process "Firefox" to get name of front window'
```

**Expected Results**:
- ✅ Returns: `"GitHub - github.com - Mozilla Firefox"` or similar
- ✅ Should contain domain or URL

### Test 3: Full Collector Test

```typescript
import { DarwinURLCollector } from './platforms/darwin/url-collector';

const collector = new DarwinURLCollector();

// Test Firefox
const firefoxResult = await collector.getActiveURL('Firefox');
console.log('Firefox:', firefoxResult);

// Test Chrome
const chromeResult = await collector.getActiveURL('Chrome');
console.log('Chrome:', chromeResult);

// Test Safari
const safariResult = await collector.getActiveURL('Safari');
console.log('Safari:', safariResult);
```

## 🎯 Success Rate Testing

### Test Scenarios

| Scenario | Setup | Expected Result |
|----------|-------|-----------------|
| **Firefox running** | Open Firefox with active tab | 60-70% success |
| **Chrome running** | Open Chrome with active tab | 80-85% success |
| **Safari running** | Open Safari with active tab | 85-90% success |
| **No browser** | Close all browsers | null result |
| **Multiple tabs** | Firefox with 10+ tabs | Same success rate |

### Measuring Success Rate

```bash
# Run 100 times and measure
for i in {1..100}; do
  node -e "
    const { DarwinURLCollector } = require('./dist/platforms/darwin/url-collector');
    const collector = new DarwinURLCollector();
    collector.getActiveURL('Firefox').then(r => console.log(r ? 'SUCCESS' : 'FAIL'));
  "
  sleep 2
done | sort | uniq -c
```

## 🐛 Troubleshooting

### Issue: Always Returns Null

**Check**:
1. Is Firefox actually running? `ps aux | grep -i firefox`
2. Is there an active tab? Click on Firefox window
3. Accessibility permission granted? Check System Preferences
4. Test AppleScript manually (see Test 1 above)

### Issue: Window Title Pattern Not Matching

**Check**:
```bash
# Get actual title
osascript -e 'tell application "System Events" to tell process "Firefox" to get name of front window'

# Test regex patterns manually
node -e "
  const title = 'YOUR_ACTUAL_TITLE_HERE';
  const patterns = [
    /https?:\/\/[^\s\-]+/i,
    /\-\s+([a-z0-9\-\.]+\.[a-z]{2,})/i,
    /^([a-z0-9\-\.]+\.[a-z]{2,})/i
  ];
  patterns.forEach((p, i) => {
    console.log(\`Pattern \${i+1}:\`, p.test(title));
  });
"
```

### Issue: Performance Too Slow

**Check**:
```typescript
const start = Date.now();
const result = await collector.getActiveURL('Firefox');
const duration = Date.now() - start;
console.log(`Duration: ${duration}ms`);
```

Expected: <5000ms

## 📊 Manual Testing Checklist

### Pre-deployment Testing

- [ ] Test Firefox 115 ESR (AppleScript ~30-40% success)
- [ ] Test Firefox Latest (AppleScript ~40-50% success)
- [ ] Test Chrome (AppleScript ~80-85% success)
- [ ] Test Safari (AppleScript ~85-90% success)
- [ ] Test Edge (AppleScript ~80-85% success)
- [ ] Test with no browser running (returns null)
- [ ] Test timeout protection (<5s total)
- [ ] Test window title fallback (Firefox)
- [ ] Test quality indicators (full_url vs domain_only)
- [ ] Verify no crashes on any error

### Production Monitoring

- [ ] Monitor success rates per browser
- [ ] Track method usage (AppleScript vs window title)
- [ ] Alert if success rate <50%
- [ ] Monitor average response time
- [ ] Log timeout frequency

## 🔍 Debug Mode

Enable debug logging:

```typescript
import { logger } from './common/utils';

// Set debug level
logger.setLevel('debug');

// Run collection
const result = await collector.getActiveURL('Firefox');

// Check logs for:
// [Firefox] Level 1: Trying AppleScript...
// [Firefox] AppleScript call failed: ...
// [Firefox] Level 2: Trying window title...
// [URLExtract] Pattern 2 matched (domain + protocol)
// [Firefox] ⚠️  Window title extraction succeeded
```

## 🎓 Understanding Test Results

### Firefox Result Examples

**Success Case 1 (AppleScript)**:
```json
{
  "url": "https://github.com/username/repo",
  "browserName": "Firefox",
  "timestamp": 1698789123456,
  "collectionMethod": "applescript",
  "quality": "full_url"
}
```

**Success Case 2 (Window Title)**:
```json
{
  "url": "https://github.com",
  "browserName": "Firefox",
  "timestamp": 1698789123456,
  "collectionMethod": "window_title",
  "quality": "domain_only"
}
```

**Failure Case**:
```json
null
```

## 🚀 Running Integration Tests

```bash
# Run all tests
npm test -- firefox-collection.test.ts

# Run specific suite
npm test -- -t "Window Title Extraction"

# Run with coverage
npm test -- --coverage firefox-collection.test.ts

# Watch mode
npm test -- --watch firefox-collection.test.ts
```

## 📝 Test Reporting Template

```markdown
## Firefox URL Collection Test Report

**Date**: YYYY-MM-DD
**Firefox Version**: X.Y.Z
**macOS Version**: X.Y

### Test Results

| Method | Attempts | Successes | Rate | Avg Time |
|--------|----------|-----------|------|----------|
| AppleScript | 100 | 42 | 42% | 1.2s |
| Window Title | 58 | 35 | 60% | 0.8s |
| **Combined** | **100** | **77** | **77%** | **1.0s** |

### Issues Found
- None / List issues here

### Recommendations
- None / List recommendations here
```

---

**Quick Start**: Run Test 1, Test 2, then Test 3 above to verify implementation works.
