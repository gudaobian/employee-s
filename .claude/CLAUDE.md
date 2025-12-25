# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the Employee Client component.

## Project Overview

Employee Monitoring System **Employee Client** - A cross-platform desktop application (Windows/macOS) built with Electron that monitors employee activities, captures screenshots, and communicates with the API server in real-time.

## User Environment & Workflow

**IMPORTANT**: The user ALWAYS downloads and installs the latest version immediately after each build completes.

- **Version Management**: Do NOT repeatedly suggest checking version or updating the application
- **Build Pipeline**: User uses `/build-client` command (GitHub Actions) for production builds
- **Installation Practice**: User downloads the latest installer from GitHub releases as soon as it's available
- **Assumption**: When troubleshooting, assume the user is running the most recent released version unless explicitly stated otherwise

This workflow means version-related suggestions should focus on:
1. Whether a NEW build is needed (e.g., due to code changes)
2. Whether the current build pipeline is working correctly
3. NOT on whether the user should update their installed version

## Development Commands

```bash
# Development
npm run dev                # CLI development mode
npm run dev:cli            # CLI with TypeScript hot reload
npm run electron:dev       # Electron development mode

# Building
npm run build              # Full build process
npm run compile            # TypeScript compilation only
npm run clean              # Clean dist directory

# Electron Packaging
npm run pack:win           # Windows executable
npm run pack:mac           # macOS application  
npm run pack:all           # All platforms

# Native Module Building
npm run build:native:win   # Windows native modules
npm run build:native:mac   # macOS native modules

# Testing & Utilities
npm run test:health        # Health check CLI command
npm run device-id:info     # Device ID information
npm run device-id:validate # Validate device ID system

# Code Quality
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix ESLint issues
npm run typecheck          # TypeScript type checking
npm test                   # Jest tests
```

## Architecture - Three-Layer Design

The client follows a strict three-layer architecture:

```
main/                      # Application entry and platform factory
├── cli.ts                 # CLI interface and commands
├── index.ts               # Main application entry  
├── platform-factory.ts   # Platform-specific adapter factory
└── platform-adapter-bridge.ts  # Bridge to platform implementations

common/                    # Cross-platform shared components
├── config/               # Configuration management
├── interfaces/           # TypeScript interface definitions
├── services/            # Core business logic services
│   ├── fsm/             # Finite State Machine implementation
│   ├── auth-service.ts  # Authentication service
│   ├── data-sync-service.ts  # Data synchronization
│   └── websocket-service.ts  # WebSocket communication
├── types/               # Shared type definitions
└── utils/               # Utility functions and helpers

platforms/               # Platform-specific implementations
├── common/              # Base platform adapter
├── macos/              # macOS-specific implementations
├── windows/            # Windows-specific implementations  
└── platform-factory.ts # Platform detection and instantiation
```

### FSM (Finite State Machine) System

The client uses a sophisticated FSM to manage the device lifecycle:

**States**: `INIT → HEARTBEAT → REGISTER → BIND_CHECK → WS_CHECK → CONFIG_FETCH → DATA_COLLECT`

**Key FSM Features**:
- Automatic error recovery and state transitions
- Network disconnection handling (`DISCONNECT` state)
- Unbound device management (`UNBOUND` state)
- Comprehensive state history tracking
- Smart retry mechanisms with exponential backoff

### Technology Stack
- **Runtime**: Node.js ≥16.0.0
- **Language**: TypeScript with relaxed configuration
- **Desktop Framework**: Electron for cross-platform GUI
- **CLI Framework**: Commander.js for command-line interface
- **Path Aliases**: `@main/*`, `@common/*`, `@platforms/*`

### Native Module Handling
The Employee Client includes platform-specific native modules:
- **Windows**: `native-event-monitor-win/` (C++ event monitoring)
- **macOS**: `native-event-monitor/` (Objective-C event monitoring)
- Build scripts handle compilation and precompiled fallbacks

## Common Development Tasks

### Adding New CLI Commands
1. Add command definition in `main/cli.ts`
2. Implement command logic in appropriate service
3. Add help documentation and examples
4. Test command functionality

### Extending FSM States
1. Add state to `DeviceState` enum
2. Create state handler class implementing `StateHandler`
3. Register handler in FSM service
4. Update state transition logic

### Platform-Specific Features
1. Define interface in `common/interfaces/`
2. Implement service in `common/services/`
3. Add platform-specific code in `platforms/[platform]/`
4. Register in platform factory

This component focuses on cross-platform desktop application development with sophisticated state management and native system integration.

---

## Browser URL Collection System

### Overview

Recent enhancements (2025-11-03) added comprehensive browser URL collection with privacy protection, permission handling, and multi-browser support.

### Key Components

#### 1. Privacy Enhancement Module
- **File**: `common/utils/privacy-helper.ts`
- **Features**:
  - Query parameter stripping with whitelist support
  - Sensitive domain redaction (email, banking, healthcare)
  - Pattern-based filtering (tokens, passwords, API keys)
  - Configurable privacy levels (Minimal, Default, Strict)

```typescript
// Example usage
import { sanitizeUrl } from '@common/utils/privacy-helper';
import { DEFAULT_PRIVACY_CONFIG } from '@common/config/privacy-config';

const rawUrl = 'https://example.com/api?token=abc123&page=1';
const sanitized = sanitizeUrl(rawUrl, DEFAULT_PRIVACY_CONFIG);
// Output: 'https://example.com/api?page=1'
```

#### 2. Permission Detection
- **macOS**: `platforms/macos/permission-checker.ts`
  - Checks Accessibility permission
  - Provides user guidance for granting permission
  - Returns permission status for UI/logging

- **Windows**: `platforms/windows/permission-checker.ts`
  - Checks UI Automation service availability
  - Verifies service running status
  - Provides troubleshooting guidance

```typescript
// Example usage
const checker = new MacOSPermissionChecker();
const hasPermission = await checker.checkPermission();

if (!hasPermission) {
  console.log(checker.getPermissionGuidance());
}
```

#### 3. Firefox Multi-Level Fallback
- **File**: `platforms/darwin/url-collector.ts`
- **Strategy**:
  1. **Level 1**: AppleScript (30-50% success, best quality)
  2. **Level 2**: Window title extraction (40-60% success)
  3. **Level 3**: History fallback (planned, not implemented)

- **Expected Success Rate**: 40-60% combined
- **Performance**: <5 seconds total (including all fallbacks)

```typescript
// Fallback implementation (simplified)
async getFirefoxURL(): Promise<URLResult | null> {
  // Try AppleScript first
  const appleScriptResult = await this.tryAppleScript();
  if (appleScriptResult) return appleScriptResult;

  // Fallback to window title
  const windowTitleResult = await this.tryWindowTitle();
  if (windowTitleResult) return windowTitleResult;

  // All methods failed
  return null;
}
```

#### 4. Tamper Detection Service
- **File**: `common/services/tamper-detection-service.ts`
- **Features**:
  - Monitors permission status changes
  - Detects permission revocation at runtime
  - Alerts on security-relevant changes
  - Periodic health checks (every 60 seconds)

```typescript
// Example usage
const tamperDetection = new TamperDetectionService();

tamperDetection.on('permission-revoked', () => {
  console.error('Security Alert: Permission revoked!');
  // Handle gracefully
});

await tamperDetection.start();
```

### Testing Infrastructure

#### 1. Comprehensive Integration Tests
- **File**: `test/integration/browser-url-collection.test.ts`
- **Coverage**:
  - Cross-platform compatibility matrix
  - Browser-specific collection tests
  - Permission detection & handling
  - Privacy protection integration
  - Performance & reliability tests
  - Error recovery & fallbacks

```bash
# Run integration tests
npm test -- test/integration/browser-url-collection.test.ts

# Run Firefox-specific tests
npm test -- test/integration/firefox-collection.test.ts

# Run privacy tests
npm test -- test/unit/privacy-helper.test.ts
```

#### 2. Performance Benchmarks
- **File**: `test/performance/benchmark.ts`
- **Metrics**:
  - P50, P95, P99 latency percentiles
  - Throughput (operations per second)
  - Success rates by browser
  - Memory usage tracking

```bash
# Run all performance benchmarks
npm run test:performance

# Run specific benchmark
node test/performance/benchmark.ts Chrome
```

**Performance Targets**:
- P50: ≤ 60ms
- P95: ≤ 250ms
- P99: ≤ 1000ms
- Throughput: ≥ 20 ops/sec
- Success Rate: ≥ 70% (except Firefox: ≥40%)

#### 3. Accuracy Metrics System
- **File**: `common/metrics/accuracy-metrics.ts`
- **Features**:
  - Real-time metrics collection
  - Log parsing and analysis
  - Daily accuracy reports
  - Automatic alerting on degraded performance
  - Historical trend analysis

```bash
# Generate daily accuracy report
node common/metrics/accuracy-metrics.js

# Example output:
# Date: 2025-11-03
# Overall Success Rate: 82.5%
# Total Attempts: 1,234
# Critical Issues: None
```

### Platform Support & Success Rates

| Platform | Browser | Success Rate | Collection Method | Notes |
|----------|---------|--------------|-------------------|-------|
| macOS | Safari | 85-95% | AppleScript | Most reliable |
| macOS | Chrome | 80-90% | AppleScript | Highly reliable |
| macOS | Firefox | 40-60% | Multi-fallback | Best effort |
| macOS | Edge | 75-85% | AppleScript | Chromium-based |
| Windows | Chrome | 75-85% | UI Automation | Reliable |
| Windows | Edge | 75-85% | UI Automation | Native browser |
| Windows | Firefox | 50-70% | Multi-fallback | Best effort |

### Privacy Configuration

#### Default Configuration
```typescript
{
  stripQueryParams: true,
  queryParamWhitelist: ['page', 'lang', 'tab', 'view'],
  sensitivePatterns: [
    /token=/i,
    /api[_-]?key=/i,
    /password=/i,
    /secret=/i,
    /\d{13,19}/ // Credit cards
  ]
}
```

#### Custom Configuration
Edit `common/config/privacy-config.ts` to add:
- Corporate domain whitelist
- Custom query parameter whitelist
- Additional sensitive patterns
- Privacy level adjustments

### Deployment

#### macOS
1. Request Accessibility permission (System Preferences → Security & Privacy → Privacy → Accessibility)
2. Restart application after granting permission
3. Verify with `npm run test:health`

#### Windows
1. Enable UI Automation service (`services.msc` → "Interactive Services Detection")
2. Set service to Automatic startup
3. Verify with `npm run test:health`

### Troubleshooting

Common issues and solutions documented in:
- 📖 [Deployment Guide](../docs/deployment-guide.md)
- 🔧 [Troubleshooting Guide](../docs/troubleshooting.md)

Quick diagnostics:
```bash
# Health check
npm run test:health

# Performance check
npm run test:performance

# View recent logs (macOS)
tail -f ~/Library/Logs/employee-monitor/url-collection.log

# View recent logs (Windows)
Get-Content "$env:APPDATA\employee-monitor\logs\url-collection.log" -Tail 20 -Wait
```

### Known Limitations

1. **Firefox Collection**: 40-60% success rate is expected due to AppleScript instability
2. **Private/Incognito Windows**: Cannot collect URLs from private browsing (browser security restriction)
3. **Performance**: P95 latency may exceed 250ms on slower systems or during high load
4. **Permissions**: User must manually grant system permissions (cannot be automated)

### Future Enhancements

- [ ] Browser extension for enterprise deployments (100% Firefox reliability)
- [ ] History-based fallback implementation (Level 3)
- [ ] Real-time metrics dashboard
- [ ] Automated permission request flows
- [ ] Support for additional browsers (Brave, Opera, Vivaldi)

---

## Native Module Hot Update Support

### Overview

Recent enhancements (2025-12-23) added full support for hot-updating native modules (`.node`, `.dylib`, `.dll`, `.so`) via the ASAR unpacked directory mechanism.

### Architecture

**ASAR Structure**:
```
EmployeeSafety.app/Contents/Resources/
├── app.asar              ← Compressed application code
└── app.asar.unpacked/    ← Native modules (uncompressed)
    └── node_modules/
        ├── @img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node
        └── @img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.2.dylib
```

**Hot Update Process**:
1. Extract both `app.asar` and `app.asar.unpacked` directories
2. Apply differential updates to both packed (JS) and unpacked (native) files
3. Repack `app.asar` and replace `app.asar.unpacked` directory
4. Restart application to load updated native modules

### Key Components

#### 1. AsarManager Extensions

**File**: `src/common/services/hot-update/AsarManager.ts`

**New Methods**:
- `extractWithUnpacked(targetDir)` - Extract ASAR + unpacked to `targetDir/asar/` and `targetDir/unpacked/`
- `packWithUnpacked(sourceDir, targetPath)` - Pack ASAR + unpacked from source directory
- `createFullBackup()` - Backup both ASAR and unpacked directories
- `restoreFromFullBackup()` - Restore both from backup
- `removeFullBackup()` - Clean up both backups

```typescript
// Example usage
const asarManager = new AsarManager();

// Extract with native modules
await asarManager.extractWithUnpacked('/tmp/extract');
// Creates:
//   /tmp/extract/asar/       ← Extracted ASAR contents
//   /tmp/extract/unpacked/   ← Copy of app.asar.unpacked

// Pack with native modules
await asarManager.packWithUnpacked('/tmp/extract', '/tmp/app.asar.new');
// Creates:
//   /tmp/app.asar.new          ← Packed ASAR
//   /tmp/app.asar.new.unpacked ← Native modules directory
```

#### 2. DiffApplier Extensions

**File**: `src/common/services/hot-update/DiffApplier.ts`

**New Methods**:
- `applyDiffWithUnpacked(extractDir, diffDir, manifest)` - Apply differential updates to both packed and unpacked files
- `applyUnpackedDiff(unpackedExtractDir, unpackedDiffDir)` - Apply unpacked file updates (complete replacement strategy)

**Unpacked File Strategy**:
- **Complete Replacement**: Native modules are replaced entirely, not incrementally
- **Reason**: Binary files don't support incremental patching; ABI compatibility requires exact versions

```typescript
// Diff package structure for native module updates
diff-package.tar.gz
├── manifest.json         ← Metadata (version, changed files, etc.)
├── changed/             ← Changed ASAR files (incremental)
│   ├── electron/
│   ├── out/dist/
│   └── package.json
└── unpacked/            ← Native modules (complete replacement)
    └── node_modules/
        └── @img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node
```

#### 3. HotUpdateService Integration

**File**: `src/common/services/hot-update/HotUpdateService.ts`

**Updated Flow**:
```typescript
async applyDiffPackage() {
  // 1. Extract current app (ASAR + unpacked)
  await asarManager.extractWithUnpacked(tempExtractDir);

  // 2. Extract diff package
  await diffApplier.extractDiffPackage(diffPath, tempDiffDir);

  // 3. Apply diff (handles both packed and unpacked)
  await diffApplier.applyDiffWithUnpacked(tempExtractDir, tempDiffDir, manifest);

  // 4. Repack (ASAR + unpacked)
  await asarManager.packWithUnpacked(tempExtractDir, newAsarPath);

  // 5. Replace app.asar and app.asar.unpacked on restart
}
```

### Backend Integration Requirements

**Diff Package Generation (Backend)**:

The backend DiffPackageGenerator must include native module changes in differential packages:

```typescript
// Backend: Generate diff package with unpacked support
{
  "manifest": {
    "version": "1.0.3",
    "changedFiles": ["out/dist/main/app/index.js", "package.json"],
    "hasUnpackedChanges": true  // NEW: Indicates unpacked directory changes
  },
  "structure": {
    "changed/": "Incremental ASAR file updates",
    "unpacked/": "Complete native modules directory"  // NEW
  }
}
```

**Backend Detection Logic**:
```typescript
// Check if unpacked directory has changes
const unpackedPath = `${buildDir}/node_modules`;
const hasUnpackedChanges = await detectNativeModuleChanges(
  previousBuild,
  currentBuild,
  unpackedPath
);

if (hasUnpackedChanges) {
  // Include entire node_modules/@img directory in diff package
  await copyUnpackedFiles(currentBuild, diffPackageDir);
}
```

### Important Considerations

#### 1. macOS Code Signing

**Development Environment** (Current Setup):
- Code signing is **disabled** (`osxSign: false` in build config)
- Native module updates work without signing issues
- Application runs unsigned (acceptable for development)

**Production Environment** (Future Consideration):
- ⚠️ **Code Signing Limitations**: If application is signed with Developer ID or App Store certificate:
  - Updating `.dylib` files **invalidates** the application signature
  - macOS Gatekeeper/taskgated **will reject** the modified application
  - Application will **crash on startup** with `SIGKILL (Code Signature Invalid)`

**Production Solutions**:
1. **Disable Hot Update for Native Modules**: Use full installer for native changes
2. **Re-sign After Update**: Implement automatic codesigning in hot update process (requires Developer certificate)
3. **Distribute Unsigned**: Deploy unsigned builds (loses macOS Gatekeeper protection)

#### 2. Performance Impact

| Update Type | Diff Package Size | Update Time | Network Usage |
|-------------|------------------|-------------|---------------|
| **UI Only** (no native) | 5-50 KB | <5s | Minimal |
| **Business Logic** (no native) | 100-500 KB | 5-10s | Low |
| **With Native Modules** | **3-10 MB** | 15-30s | High |

**Optimization Strategies**:
- Only include changed native modules (filter by hash)
- Compress unpacked directory before packaging
- Implement progressive download for large binaries

#### 3. Native Module Compatibility

**ABI Compatibility Matrix**:
| Scenario | Compatible | Risk |
|----------|-----------|------|
| Same Electron version | ✅ Yes | Low |
| Electron minor upgrade (28.2 → 28.3) | ✅ Usually | Medium |
| Electron major upgrade (28 → 29) | ❌ No | High |
| Node.js version change | ❌ No | Critical |

**Best Practices**:
- ⚠️ **Never hot-update native modules across Electron major versions**
- Test native module updates on all supported platforms
- Implement fallback to full installer if native update fails

#### 4. Error Recovery

**Automatic Rollback**:
```typescript
try {
  await asarManager.createFullBackup();  // Backup ASAR + unpacked
  await applyDiffPackage();
  await verifyNativeModules();  // Critical: Verify native modules load
} catch (error) {
  await asarManager.restoreFromFullBackup();  // Restore both
  throw error;
}
```

**Verification**:
```typescript
// Verify native modules after update
async function verifyNativeModules() {
  try {
    const sharp = require('sharp');
    await sharp(Buffer.from(...)).metadata();  // Test sharp works
    return true;
  } catch (error) {
    throw new Error(`Native module verification failed: ${error.message}`);
  }
}
```

### Testing

**Manual Testing Workflow**:
```bash
# 1. Build current version (e.g., 1.0.2)
npm run pack:mac

# 2. Modify native module dependency (e.g., upgrade sharp)
npm install sharp@0.33.5

# 3. Build new version (e.g., 1.0.3)
npm version patch
npm run pack:mac

# 4. Backend generates diff package including unpacked changes
# (Backend task - verify unpacked/ directory exists in diff package)

# 5. Install 1.0.2, trigger hot update to 1.0.3
# Verify:
#   - Hot update succeeds
#   - Native modules load without errors
#   - Sharp functionality works (screenshot compression)
```

**Automated Testing**:
```typescript
describe('Native Module Hot Update', () => {
  it('should update sharp native module successfully', async () => {
    // Test implementation
    const diffPackage = await generateDiffWithNativeModules();
    expect(diffPackage).toHaveProperty('unpacked');

    await hotUpdateService.applyUpdate(diffPackage);

    const sharp = require('sharp');
    const metadata = await sharp(testImage).metadata();
    expect(metadata.format).toBe('jpeg');
  });
});
```

### Known Limitations

1. **No Incremental Updates for Native Modules**: Unpacked files are replaced entirely (diff size increases)
2. **Platform-Specific Binaries**: Different binaries for macOS ARM64, macOS x64, Windows x64 (backend must provide correct variant)
3. **Restart Required**: Native module updates always require application restart (cannot hot-swap .dylib in memory)
4. **Code Signing Incompatibility**: Production signed apps cannot hot-update native modules without re-signing

### Future Enhancements

- [ ] Implement per-module differential updates (reduce diff size)
- [ ] Add automatic re-signing support for production builds
- [ ] Implement native module version compatibility checking
- [ ] Add native module verification before applying update
- [ ] Support for partial unpacked directory updates (module-level granularity)

---

## Critical Issues & Solutions

### Issue: "启动失败" (Startup Failed) - Native Dependencies Not Packaged

**Severity**: CRITICAL
**Versions Affected**: v1.0.137-142
**Fixed In**: v1.0.143+

#### Symptoms

When running the packaged application (`pack:mac` or `pack:win`):
- UI displays "启动失败" (Startup Failed) when clicking "启动" button
- Application appears to start but monitoring features are disabled
- Error in logs: `Could not load the "sharp" module using the darwin-arm64 runtime`
- Error in logs: `Library not loaded: @rpath/libvips-cpp.8.17.2.dylib`
- Error in logs: `Failed to load main application: Could not load EmployeeMonitorApp`

#### Root Cause

The `sharp` image processing module requires native dynamic libraries (`libvips-cpp.8.17.2.dylib` on macOS, `.dll` on Windows) that **cannot be loaded from within ASAR archives**.

When `electron-packager` was configured with:
```javascript
asar: {
  unpackDir: 'native'  // ❌ Only unpacks ./native directory
}
```

The `sharp` module's native dependencies in `node_modules/` were compressed into `app.asar`, causing the macOS/Windows dynamic linker (dyld/LoadLibrary) to fail loading them at runtime.

**Error Chain**:
```
1. App starts → Loads electron/main-minimal.js
2. Attempts to load EmployeeMonitorApp class
3. EmployeeMonitorApp imports 'sharp' for screenshot compression
4. sharp tries to load libvips-cpp.8.17.2.dylib
5. dyld searches for .dylib in app.asar (compressed)
6. ❌ dyld cannot load libraries from compressed archives
7. sharp module fails to initialize
8. EmployeeMonitorApp load fails
9. app_instance = null
10. Application enters "simulation mode" (all monitoring disabled)
11. Click "启动" → Returns {success: false}
12. UI shows "启动失败"
```

#### Why Previous Fixes Didn't Work

Versions v1.0.137-142 attempted to fix the issue by:
- Improving state detection logic (OR/AND conditions)
- Adding complete state lists (missing FSM states)
- Implementing button locking mechanisms
- Enhancing duplicate start detection

**None of these worked** because:
```javascript
if (app_instance) {
    // All the fixes were here...
    // But app_instance was null, so this code never executed
}
```

The real problem was that `app_instance` never initialized successfully due to the missing native dependencies.

#### Solution

**Step 1**: Update ASAR packaging configuration to unpack `sharp` and its native dependencies.

Edit `scripts/build/pack-mac-universal.js`:
```javascript
asar: {
  unpackDir: '{native,node_modules/sharp,node_modules/@img}'  // ✅ Unpack sharp + native deps
}
```

**Step 2**: Fix type safety issue in state detection (v1.0.144).

Edit `electron/main-minimal.js`:
```javascript
// Before (v1.0.142)
if (monitoringState && activeStates.includes(monitoringState.toLowerCase())) {
  // ❌ TypeError if monitoringState is not a string
}

// After (v1.0.144)
const stateStr = monitoringState ? String(monitoringState).toLowerCase() : null;
if (stateStr && activeStates.includes(stateStr)) {
  // ✅ Safe type conversion
}
```

#### Verification

After applying the fix:
```bash
# 1. Rebuild the application
pnpm run pack:mac

# 2. Verify sharp is unpacked
ls -la release/EmployeeSafety-darwin-arm64/EmployeeSafety.app/Contents/Resources/app.asar.unpacked/node_modules/sharp
ls -la release/EmployeeSafety-darwin-arm64/EmployeeSafety.app/Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64/lib/

# 3. Check logs for successful initialization
# Should see: [LOG_MANAGER] Initialized successfully
# Should NOT see: Failed to load main application
```

#### Prevention

**For Future Native Dependencies**:

When adding any npm package that includes native binaries (`.node`, `.dylib`, `.dll`, `.so`):

1. **Check if it needs unpacking**: Native modules typically require unpacking from ASAR
2. **Update packager config**: Add the module path to `unpackDir`
3. **Test packaged build**: Always test the packaged application, not just development mode
4. **Common modules requiring unpacking**:
   - `sharp` (image processing)
   - `sqlite3` (database)
   - `node-gyp` compiled modules
   - Any module with `prebuilds/` or `build/Release/` directories

**Testing Checklist**:
```bash
# ✅ Test development mode (always works)
npm run electron:dev

# ✅ Test packaged application (may fail if native deps not unpacked)
npm run pack:mac
open release/EmployeeSafety-darwin-arm64/EmployeeSafety.app

# ✅ Check for native module errors in logs
grep -E "Could not load|ERR_DLOPEN_FAILED|Library not loaded" /tmp/app-console.log
```

#### Related Files

- `scripts/build/pack-mac-universal.js` - ASAR packaging configuration
- `electron/main-minimal.js` - Main process initialization and error handling
- `package.json` - Dependencies and native module declarations

#### References

- [Electron ASAR Archive Documentation](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [sharp Installation - Electron](https://sharp.pixelplumbing.com/install#electron)
- [electron-packager API - ASAR Options](https://electron.github.io/packager/main/interfaces/Options.html#asar)