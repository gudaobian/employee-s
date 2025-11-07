# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the Employee Client component.

## Project Overview

Employee Monitoring System **Employee Client** - A cross-platform desktop application (Windows/macOS) built with Electron that monitors employee activities, captures screenshots, and communicates with the API server in real-time.

## User Environment & Workflow

**IMPORTANT**: The user ALWAYS downloads and installs the latest version immediately after each build completes.

- **Version Management**: Do NOT repeatedly suggest checking version or updating the application
- **Build Pipeline**: User uses `/build-windows` command (GitHub Actions) for production builds
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