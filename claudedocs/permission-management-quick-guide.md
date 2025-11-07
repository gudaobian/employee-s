# Permission Management Quick Reference Guide

## For Developers

### Quick Commands

```bash
# Check permission status
npm run check-permissions

# Open macOS Accessibility settings
npm run open-accessibility-settings

# Test application startup with permission check
npm run dev

# Compile and verify code
npm run compile && npm run typecheck
```

### Architecture Overview

```
Permission Management Flow:
┌─────────────────────────────────────────────────┐
│ Application Startup (main/index.ts)            │
│ ├─ checkMacOSPermissions()                     │
│ └─ Logs permission status + guidance           │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ App Initialization (main/app.ts)                │
│ ├─ initializePermissionMonitoring()             │
│ └─ Start PermissionMonitorService (60s)        │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Permission Monitor Service                      │
│ ├─ Check every 60 seconds                      │
│ ├─ Emit 'permission-granted' event             │
│ └─ Emit 'permission-revoked' event             │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ MacOS Adapter (platforms/macos/)                │
│ ├─ 60-second permission cache                  │
│ ├─ refreshPermissionStatus() method            │
│ └─ getActiveURL() uses cached permission       │
└─────────────────────────────────────────────────┘
```

### Code Usage Examples

#### 1. Check Permission Status (CLI)

```typescript
// main/cli.ts
program
  .command('check-permissions')
  .action(async () => {
    const { MacOSPermissionChecker } = await import('../platforms/macos/permission-checker');
    const checker = new MacOSPermissionChecker();
    const result = await checker.checkAccessibilityPermission();

    if (result.granted) {
      console.log('✅ Permission granted');
    } else {
      console.log('❌ Permission not granted');
      console.log(result.message); // Detailed guidance
    }
  });
```

#### 2. Application Startup Check

```typescript
// main/index.ts
async function checkMacOSPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return;

  const { MacOSPermissionChecker } = await import('../platforms/macos/permission-checker');
  const checker = new MacOSPermissionChecker();
  const result = await checker.checkAccessibilityPermission();

  if (!result.granted) {
    logger.warn('⚠️ Permission not granted');
    logger.info('Run: npm run check-permissions');
  } else {
    logger.info('✅ Permission granted');
  }
}
```

#### 3. Runtime Monitoring

```typescript
// main/app.ts
private async initializePermissionMonitoring(): Promise<void> {
  this.permissionMonitorService = new PermissionMonitorService();

  this.permissionMonitorService.on('permission-revoked', (result) => {
    logger.warn('⚠️ Permission revoked!');
    this.platformAdapter?.refreshPermissionStatus?.();
  });

  this.permissionMonitorService.on('permission-granted', (result) => {
    logger.info('✅ Permission granted!');
    this.platformAdapter?.refreshPermissionStatus?.();
  });

  await this.permissionMonitorService.start(60000); // 60 seconds
}
```

#### 4. Using Permission Monitor Service Directly

```typescript
import { PermissionMonitorService } from '../common/services/permission-monitor-service';

// Create and start monitoring
const monitor = new PermissionMonitorService();

monitor.on('permission-revoked', (result) => {
  console.log('Permission was revoked:', result.message);
});

monitor.on('permission-granted', (result) => {
  console.log('Permission was granted:', result.message);
});

await monitor.start(60000); // Check every 60 seconds

// Force immediate check
await monitor.forceCheck();

// Get current state
const isGranted = monitor.getCurrentState();

// Stop monitoring
monitor.stop();
```

### Integration Points

#### For New Features:

1. **Listen to Application Events**:
```typescript
app.on('permission-revoked', (result) => {
  // Handle permission revoked
  // E.g., disable URL collection, show user notification
});

app.on('permission-granted', (result) => {
  // Handle permission granted
  // E.g., re-enable URL collection, notify user
});
```

2. **Manual Permission Refresh**:
```typescript
const adapter = app.getPlatformAdapter();
if (adapter && 'refreshPermissionStatus' in adapter) {
  const hasPermission = await adapter.refreshPermissionStatus();
  console.log('Permission status:', hasPermission);
}
```

3. **Check Current Permission**:
```typescript
import { MacOSPermissionChecker } from '../platforms/macos/permission-checker';

const checker = new MacOSPermissionChecker();
const result = await checker.checkAccessibilityPermission();

if (!result.granted) {
  // Show guidance or disable feature
  console.log(result.message);
}
```

### Testing Scenarios

#### Manual Testing:

1. **Test Initial Permission Check**:
   ```bash
   npm run dev
   # Check startup logs for permission status
   ```

2. **Test Permission Revocation Detection**:
   ```bash
   npm run dev
   # Open System Preferences → Security & Privacy → Privacy → Accessibility
   # Uncheck the application
   # Wait up to 60 seconds
   # Check logs for permission revocation event
   ```

3. **Test Permission Grant Detection**:
   ```bash
   npm run dev
   # Open System Preferences → Security & Privacy → Privacy → Accessibility
   # Check the application
   # Wait up to 60 seconds
   # Check logs for permission granted event
   ```

4. **Test CLI Commands**:
   ```bash
   npm run compile
   npm run check-permissions
   npm run open-accessibility-settings
   ```

#### Automated Testing (Future):

```typescript
// Example unit test
describe('PermissionMonitorService', () => {
  it('should emit permission-revoked event when permission changes', async () => {
    const mockChecker = {
      checkAccessibilityPermission: jest.fn()
        .mockResolvedValueOnce({ granted: true, message: '' })
        .mockResolvedValueOnce({ granted: false, message: 'Not granted' })
    };

    const monitor = new PermissionMonitorService(mockChecker);

    const revokedPromise = new Promise((resolve) => {
      monitor.on('permission-revoked', resolve);
    });

    await monitor.start(100);
    await new Promise(resolve => setTimeout(resolve, 150));
    await revokedPromise;

    expect(mockChecker.checkAccessibilityPermission).toHaveBeenCalledTimes(2);
    monitor.stop();
  });
});
```

### Troubleshooting

#### Issue: Permission check fails at startup

**Solution**:
```bash
# Check if MacOSPermissionChecker exists
ls -la platforms/macos/permission-checker.ts

# Ensure TypeScript compilation
npm run compile

# Check logs
npm run dev 2>&1 | grep -i permission
```

#### Issue: Permission monitoring not starting

**Debug**:
```typescript
// Add debug logs
logger.setLevel('debug');

// Check if monitoring started
if (app.permissionMonitorService?.isActive()) {
  console.log('Monitoring is active');
} else {
  console.log('Monitoring is NOT active');
}
```

#### Issue: Permission events not firing

**Check**:
1. Platform is macOS: `process.platform === 'darwin'`
2. Monitoring is started: `monitor.isActive() === true`
3. Permission actually changed (not a false alarm)
4. Event listener is properly registered

### Performance Considerations

1. **Cache Timing**: 60-second cache balances responsiveness vs performance
2. **Monitoring Interval**: 60 seconds is conservative (can be reduced to 30s if needed)
3. **AppleScript Overhead**: Each check takes ~50-200ms (cached to minimize impact)
4. **Memory Usage**: PermissionMonitorService is lightweight (~1KB memory)

### Configuration

All configuration is in code (no config file needed):

```typescript
// Permission check interval (ms)
const PERMISSION_CHECK_INTERVAL = 60000; // 60 seconds

// Cache duration (ms)
const PERMISSION_CACHE_INTERVAL = 60000; // 60 seconds

// Adjust as needed:
await monitor.start(30000); // 30-second monitoring
```

### Best Practices

1. **Always check platform**: Wrap macOS-specific code in platform checks
2. **Handle errors gracefully**: Permission checks can fail, don't crash
3. **Provide guidance**: Always show users how to fix permission issues
4. **Log clearly**: Use descriptive log messages with context
5. **Test thoroughly**: Manual test permission changes on real macOS systems

### Quick Reference Table

| Component | File | Purpose |
|-----------|------|---------|
| CLI Command | `main/cli.ts` | User-facing permission check |
| Startup Check | `main/index.ts` | First-run permission verification |
| Permission Monitor | `common/services/permission-monitor-service.ts` | Runtime change detection |
| Permission Checker | `platforms/macos/permission-checker.ts` | AppleScript permission check |
| macOS Adapter | `platforms/macos/macos-adapter.ts` | Permission caching + URL collection |
| App Integration | `main/app.ts` | Service lifecycle management |

### Additional Resources

- **macOS Documentation**: [Accessibility API](https://developer.apple.com/documentation/applicationservices/1658396-axistrustedcheckoptionprompt)
- **System Preferences URL**: `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`
- **AppleScript Guide**: [System Events Scripting](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/introduction/ASLR_intro.html)

## For End Users

### How to Grant Permission

1. **Check current status**:
   ```bash
   npm run check-permissions
   ```

2. **If not granted, open settings**:
   ```bash
   npm run open-accessibility-settings
   ```

3. **Grant permission**:
   - Click the lock icon (bottom-left)
   - Enter your password
   - Find the application in the list
   - Check the checkbox next to it
   - Restart the application

### Verification

After granting permission:
```bash
npm run check-permissions
# Should show: ✅ 辅助功能权限已授予
```

Application logs should show:
```
[INFO] ✅ macOS辅助功能权限已授予
[INFO] 浏览器URL采集功能可正常使用
```

### Common Issues

**Q: Permission check fails even though I granted it**
- **A**: Restart the application after granting permission

**Q: Application doesn't appear in Accessibility list**
- **A**: Click the "+" button to manually add it

**Q: Permission keeps getting revoked**
- **A**: Check if security software is interfering (e.g., antivirus)
