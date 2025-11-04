# Permission Check Implementation - Usage Examples

## Overview

This document provides usage examples for the platform-specific permission detection and friendly error message system.

## Components Created

### 1. macOS Permission Checker

**File**: `platforms/macos/permission-checker.ts`

**Purpose**: Detects macOS Accessibility permission using AppleScript

**Key Methods**:
- `checkAccessibilityPermission()`: Tests if accessibility permission is granted
- `getPermissionGuide()`: Returns detailed setup instructions in Chinese
- `openAccessibilitySettings()`: Opens System Preferences to the Accessibility pane

### 2. Windows Permission Checker

**File**: `platforms/windows/permission-checker.ts`

**Purpose**: Detects Windows UI Automation service availability

**Key Methods**:
- `checkUIAutomationAvailability()`: Checks if UI Automation service is running
- `getUIASetupGuide()`: Returns detailed setup instructions
- `openServicesManager()`: Opens Windows Service Manager
- `checkAdminPrivileges()`: Checks if running with admin rights

### 3. Platform Adapter Integration

**Files**:
- `platforms/darwin/darwin-adapter.ts`
- `platforms/windows/windows-adapter.ts`

**Added Methods**:
- `ensureAccessibilityPermission()` (macOS) / `ensureUIAutomationAvailable()` (Windows)
- `getPermissionGuide()` / `getUIAutomationGuide()`
- `openPermissionSettings()` / `openServicesManager()`
- `checkAdminPrivileges()` (Windows only)

## Usage Examples

### Example 1: URL Collection with Permission Check (macOS)

```typescript
import { DarwinAdapter } from './platforms/darwin/darwin-adapter';

class BrowserURLCollector {
  private platformAdapter: DarwinAdapter;

  constructor() {
    this.platformAdapter = new DarwinAdapter();
  }

  async getActiveURL(browserName: string): Promise<string | null> {
    try {
      // Check permission before attempting URL collection
      await this.platformAdapter.ensureAccessibilityPermission();

      // Continue with URL collection logic
      // (Use AppleScript to get active tab URL from browser)
      const script = `
        tell application "${browserName}"
          if (count of windows) > 0 then
            return URL of active tab of front window
          end if
        end tell
      `;

      // Execute script and return URL
      // ...

    } catch (error: any) {
      if (error.message === 'ACCESSIBILITY_PERMISSION_REQUIRED') {
        console.error('Accessibility permission not granted');
        console.log(error.permissionGuide);

        // Optionally open settings
        await this.platformAdapter.openPermissionSettings();

        return null;
      }

      throw error;
    }
  }
}
```

### Example 2: URL Collection with Permission Check (Windows)

```typescript
import { WindowsAdapter } from './platforms/windows/windows-adapter';

class BrowserURLCollector {
  private platformAdapter: WindowsAdapter;

  constructor() {
    this.platformAdapter = new WindowsAdapter();
  }

  async getActiveURL(browserName: string): Promise<string | null> {
    try {
      // Check UI Automation service before attempting URL collection
      await this.platformAdapter.ensureUIAutomationAvailable();

      // Continue with URL collection logic using UI Automation
      // ...

    } catch (error: any) {
      if (error.message === 'UI_AUTOMATION_UNAVAILABLE') {
        console.error('UI Automation service not available');
        console.log(error.setupGuide);

        // Check if admin privileges needed
        const isAdmin = await this.platformAdapter.checkAdminPrivileges();
        if (!isAdmin) {
          console.warn('Admin privileges may be required to enable UI Automation');
        }

        // Optionally open service manager
        await this.platformAdapter.openServicesManager();

        return null;
      }

      throw error;
    }
  }
}
```

### Example 3: Graceful Degradation

```typescript
class ActivityMonitor {
  async collectBrowserActivity(): Promise<any> {
    const platform = process.platform;
    let adapter;

    if (platform === 'darwin') {
      adapter = new DarwinAdapter();
    } else if (platform === 'win32') {
      adapter = new WindowsAdapter();
    }

    try {
      // Try to get URL with permission check
      if (platform === 'darwin') {
        await adapter.ensureAccessibilityPermission();
      } else if (platform === 'win32') {
        await adapter.ensureUIAutomationAvailable();
      }

      // Collect detailed browser activity including URL
      return await this.collectDetailedActivity(adapter);

    } catch (error: any) {
      if (error.message === 'ACCESSIBILITY_PERMISSION_REQUIRED' ||
          error.message === 'UI_AUTOMATION_UNAVAILABLE') {

        console.warn('Permission/service unavailable, using fallback mode');

        // Collect basic activity without URL
        return await this.collectBasicActivity(adapter);
      }

      throw error;
    }
  }

  private async collectDetailedActivity(adapter: any): Promise<any> {
    // Collect with URL information
    return {
      window: await adapter.getActiveWindow(),
      url: await this.getBrowserURL(adapter),
      timestamp: new Date()
    };
  }

  private async collectBasicActivity(adapter: any): Promise<any> {
    // Collect without URL information
    return {
      window: await adapter.getActiveWindow(),
      url: null,
      timestamp: new Date()
    };
  }
}
```

### Example 4: User-Friendly Error Display

```typescript
class PermissionErrorHandler {
  async handlePermissionError(platform: string): Promise<void> {
    let guide: string;

    if (platform === 'darwin') {
      const adapter = new DarwinAdapter();
      guide = await adapter.getPermissionGuide();

      // Show to user in UI
      this.displayUserMessage({
        title: '需要辅助功能权限',
        message: guide,
        actions: [
          {
            label: '打开系统偏好设置',
            callback: async () => {
              await adapter.openPermissionSettings();
            }
          },
          {
            label: '稍后提醒',
            callback: () => {
              // Schedule reminder
            }
          }
        ]
      });

    } else if (platform === 'win32') {
      const adapter = new WindowsAdapter();
      guide = await adapter.getUIAutomationGuide();

      // Check admin status
      const isAdmin = await adapter.checkAdminPrivileges();
      const adminWarning = isAdmin ? '' : '\n\n⚠️ 注意：可能需要管理员权限来配置服务。';

      this.displayUserMessage({
        title: 'UI Automation 服务不可用',
        message: guide + adminWarning,
        actions: [
          {
            label: '打开服务管理器',
            callback: async () => {
              await adapter.openServicesManager();
            }
          },
          {
            label: '检查管理员权限',
            callback: async () => {
              const hasAdmin = await adapter.checkAdminPrivileges();
              alert(hasAdmin ? '当前有管理员权限' : '需要以管理员身份运行');
            }
          }
        ]
      });
    }
  }

  private displayUserMessage(config: any): void {
    // Display message to user (implementation depends on your UI framework)
    console.log(`\n${config.title}\n${config.message}\n`);
    config.actions.forEach((action: any, index: number) => {
      console.log(`${index + 1}. ${action.label}`);
    });
  }
}
```

## Integration Tests

Integration tests are located in `test/integration/permission-check.test.ts` and cover:

1. **macOS Tests** (run only on Darwin platform):
   - Permission detection
   - Message structure validation
   - Graceful error handling
   - Settings opening capability

2. **Windows Tests** (run only on win32 platform):
   - UI Automation service detection
   - Message structure validation
   - Admin privilege checking
   - Service manager opening capability

3. **Cross-platform Tests**:
   - Import safety on all platforms
   - Fallback behavior on unsupported platforms

4. **Quality Checks**:
   - Error message actionability
   - Performance (<100ms for macOS, <3s for Windows)

### Running Tests

```bash
# Run all tests
npm test

# Run only integration tests
npm test -- test/integration/permission-check.test.ts

# Run with platform filter
npm test -- --testPathPattern=permission-check
```

## Error Messages

### macOS Accessibility Permission Denied

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔐 macOS 辅助功能权限未授权
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  为了监控浏览器活动窗口和 URL，本应用需要辅助功能权限。

  📋 授权步骤：

  1️⃣  打开"系统偏好设置"
  2️⃣  进入"安全性与隐私"
  3️⃣  选择"隐私"标签页
  4️⃣  在左侧列表中选择"辅助功能"
  5️⃣  点击左下角的锁图标，输入密码解锁
  6️⃣  在右侧列表中找到本应用并勾选
  7️⃣  重启本应用

  ⚡ 快捷命令（自动打开设置页面）：

  运行以下命令可直接打开辅助功能设置页面：

    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"

  💡 提示：

  - 授权后可能需要重启应用程序才能生效
  - 如果列表中没有本应用，可以点击"+"手动添加
  - 某些版本的 macOS 可能界面略有不同

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Windows UI Automation Service Unavailable

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔐 Windows UI Automation 服务不可用
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  为了监控浏览器活动窗口和 URL，本应用需要 UI Automation 服务。

  📋 检查服务状态：

  1️⃣  按 Win + R，输入 services.msc，按回车
  2️⃣  在服务列表中找到 "Interactive Services Detection"
  3️⃣  右键点击，选择"属性"
  4️⃣  检查"启动类型"，建议设置为"自动"
  5️⃣  点击"启动"按钮启动服务
  6️⃣  点击"确定"保存设置

  ⚙️ 如果服务被禁用（企业环境）：

  某些企业环境可能通过组策略禁用了 UI Automation 服务。
  请联系 IT 管理员请求启用以下服务：

  - Interactive Services Detection (UI0Detect)
  - Windows Management Instrumentation

  📝 注册表配置（仅供高级用户）：

  服务配置路径：
  HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\UI0Detect

  可能需要的配置：
  - Start = 2 (自动启动)
  - 确保服务未被禁用

  ⚡ PowerShell 快速检查命令：

  Get-Service -Name "UI0Detect" | Format-List

  💡 提示：

  - 在企业环境中，可能需要管理员权限修改服务设置
  - 某些安全策略可能阻止启用此服务
  - 如果无法启用服务，应用将使用降级模式（功能受限）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Design Considerations

### 1. User Experience
- **Actionable Error Messages**: Step-by-step instructions in appropriate language (Chinese for this project)
- **Quick Commands**: One-line commands to open system settings
- **Visual Indicators**: Emoji and Unicode box drawing for better readability

### 2. Performance
- **Permission Check Caching**: Check once per instance to avoid redundant checks (<100ms overhead)
- **Non-Blocking**: Permission checks are fast (<2s macOS, <3s Windows)
- **Graceful Degradation**: App continues with reduced functionality if permissions unavailable

### 3. Reliability
- **Error Handling**: All edge cases handled (service not found, script timeout, etc.)
- **Cross-Platform Safety**: Code doesn't crash when imported on wrong platform
- **Logging**: Comprehensive debug logging for troubleshooting

### 4. Maintainability
- **Clear Separation**: Permission checking logic separated from business logic
- **Consistent API**: Similar patterns across macOS and Windows
- **Documentation**: Inline JSDoc comments and usage examples

## Platform-Specific Notes

### macOS
- **AppleScript Permission Check**: Reliable across all recent macOS versions (10.14+)
- **System Prompt**: macOS shows permission prompt on first accessibility request
- **User Control**: Users can revoke permission anytime from System Preferences
- **Version Compatibility**: Handles both Catalina+ and earlier versions

### Windows
- **UI Automation Service**: May be disabled in enterprise environments via Group Policy
- **PowerShell Dependency**: Requires PowerShell to check service status
- **Admin Rights**: Some operations may require elevated privileges
- **Version Differences**: Handles Windows 10/11 differences

## Acceptance Criteria

✅ macOS permission checker detects accessibility permission correctly
✅ Windows permission checker detects UI Automation availability
✅ Error messages are clear, actionable, and in appropriate language
✅ Permission check integrated into platform adapters
✅ Integration tests pass on respective platforms
✅ TypeScript compiles without errors
✅ No crashes when permissions denied

## Testing on Target Platforms

### macOS Testing

```bash
# 1. Build the application
npm run build

# 2. Run integration tests
npm test -- test/integration/permission-check.test.ts

# 3. Test permission denial scenario
# - Revoke accessibility permission in System Preferences
# - Run the app and verify friendly error message appears
# - Click "Open Settings" and verify it opens correct preference pane

# 4. Test permission granted scenario
# - Grant accessibility permission
# - Verify app can access window information without errors
```

### Windows Testing

```bash
# 1. Build the application
npm run build

# 2. Run integration tests
npm test -- test/integration/permission-check.test.ts

# 3. Test service unavailable scenario
# - Stop "UI0Detect" service in services.msc
# - Run the app and verify friendly error message appears
# - Click "Open Service Manager" and verify it opens services.msc

# 4. Test admin privilege checking
# - Run app without admin rights
# - Verify admin privilege warning appears if service disabled
```

## Future Enhancements

1. **Auto-Recovery**: Automatically retry when permission is granted mid-session
2. **UI Integration**: Show permission requests in GUI with visual buttons
3. **Analytics**: Track permission grant rates for UX improvements
4. **Localization**: Support multiple languages (currently Chinese only)
5. **Batch Checking**: Check multiple permissions in one call
6. **Permission History**: Log when permissions were granted/revoked
