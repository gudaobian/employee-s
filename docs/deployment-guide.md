# Browser URL Collection - Deployment Guide

Comprehensive guide for deploying browser URL collection across macOS and Windows environments.

## Table of Contents

- [macOS Deployment](#macos-deployment)
- [Windows Deployment](#windows-deployment)
- [Privacy Configuration](#privacy-configuration)
- [Verification & Testing](#verification--testing)
- [Troubleshooting](#troubleshooting)

---

## macOS Deployment

### Prerequisites

- **macOS Version**: 10.14+ (Mojave or later)
- **Required Permission**: Accessibility permission
- **Supported Browsers**: Safari, Chrome, Firefox, Edge

### System Requirements

```bash
# Check macOS version
sw_vers

# Expected output:
# ProductName: macOS
# ProductVersion: 13.0 (or higher)
```

### Permission Configuration

#### Step 1: Request Accessibility Permission

On first run, the system will display a permission dialog. Users must:

1. Open **System Preferences** (System Settings on macOS 13+)
2. Select **Security & Privacy** → **Privacy**
3. Select **Accessibility** from the left sidebar
4. Click the lock icon and enter password
5. Find **Employee Monitor.app** in the list
6. Check the checkbox to grant permission
7. Restart the application

#### Step 2: Quick Permission Access

Use this command to open the permission dialog directly:

```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

#### Step 3: Programmatic Permission Check

```bash
# Run health check
npm run test:health

# Expected output:
# ✅ Accessibility: Granted
# ✅ Browser URL Collection: Available
```

### Browser-Specific Configuration

#### Safari
- **Method**: AppleScript
- **Expected Success Rate**: 85-95%
- **Requirement**: Accessibility permission
- **Notes**: Most reliable browser

#### Chrome
- **Method**: AppleScript
- **Expected Success Rate**: 80-90%
- **Requirement**: Accessibility permission
- **Notes**: Highly reliable

#### Firefox
- **Method**: Multi-fallback (AppleScript → Window Title → History)
- **Expected Success Rate**: 40-60%
- **Requirement**: Accessibility permission
- **Notes**: Best-effort collection, consider browser extension for enterprise

#### Edge
- **Method**: AppleScript (Chromium-based)
- **Expected Success Rate**: 75-85%
- **Requirement**: Accessibility permission

### Enterprise Deployment (macOS)

#### Using MDM (Mobile Device Management)

Create a configuration profile:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.TCC.configuration-profile-policy</string>
            <key>Services</key>
            <dict>
                <key>Accessibility</key>
                <array>
                    <dict>
                        <key>Identifier</key>
                        <string>com.company.employee-monitor</string>
                        <key>IdentifierType</key>
                        <string>bundleID</string>
                        <key>Allowed</key>
                        <true/>
                        <key>StaticCode</key>
                        <false/>
                    </dict>
                </array>
            </dict>
        </dict>
    </array>
</dict>
</plist>
```

Deploy via MDM:

```bash
# Jamf Pro
sudo jamf policy -event install-employee-monitor

# Intune
# Upload .pkg and configuration profile via Microsoft Endpoint Manager
```

### Verification (macOS)

```bash
# 1. Check permission status
npm run device-id:validate

# 2. Test URL collection
npm run dev

# 3. Verify logs
tail -f ~/Library/Logs/employee-monitor/url-collection.log
```

---

## Windows Deployment

### Prerequisites

- **Windows Version**: Windows 10/11
- **Required Service**: UI Automation service
- **Supported Browsers**: Chrome, Edge, Firefox

### System Requirements

```powershell
# Check Windows version
Get-ComputerInfo | Select WindowsProductName, WindowsVersion

# Expected output:
# WindowsProductName: Windows 10 Pro (or Windows 11)
```

### Service Configuration

#### Step 1: Verify UI Automation Service

1. Press **Win+R**, type `services.msc`, press Enter
2. Find **"Interactive Services Detection"** (or **"UI Automation Service"**)
3. Verify Status = **"Running"**
4. If not running:
   - Right-click → **Start**
   - Set Startup Type = **"Automatic"**

#### Step 2: Enable via Command Line

```powershell
# Start service
Start-Service -Name "UI0Detect"

# Set to automatic startup
Set-Service -Name "UI0Detect" -StartupType Automatic

# Verify status
Get-Service -Name "UI0Detect"
```

#### Step 3: Group Policy Configuration (Enterprise)

For domain-joined machines:

1. Open **Group Policy Management** (gpmc.msc)
2. Navigate to:
   ```
   Computer Configuration → Administrative Templates → Windows Components
   → Desktop Window Manager
   ```
3. Enable **"Enable UI Automation"**
4. Run `gpupdate /force` on client machines

### Browser-Specific Configuration

#### Chrome
- **Method**: UI Automation
- **Expected Success Rate**: 75-85%
- **Requirement**: UI Automation service
- **Notes**: Reliable collection

#### Edge (Chromium)
- **Method**: UI Automation
- **Expected Success Rate**: 75-85%
- **Requirement**: UI Automation service
- **Notes**: Native Windows browser, highly reliable

#### Firefox
- **Method**: Multi-fallback (UI Automation → Window Title → History)
- **Expected Success Rate**: 50-70%
- **Requirement**: UI Automation service
- **Notes**: Best-effort collection

### Enterprise Deployment (Windows)

#### Using Group Policy

Create and deploy via GPO:

```powershell
# Install silently
msiexec /i employee-monitor.msi /quiet /qn

# Configure service
Set-Service -Name "UI0Detect" -StartupType Automatic
Start-Service -Name "UI0Detect"

# Verify installation
Get-Package -Name "Employee Monitor"
```

#### Using SCCM/Intune

1. Package the `.msi` installer
2. Create deployment package
3. Deploy to target device collections
4. Include post-install script to enable UI Automation

Post-install script:

```powershell
# post-install.ps1
Start-Service -Name "UI0Detect" -ErrorAction SilentlyContinue
Set-Service -Name "UI0Detect" -StartupType Automatic
```

### Verification (Windows)

```powershell
# 1. Check service status
Get-Service -Name "UI0Detect"

# 2. Test URL collection
npm run dev

# 3. Verify logs
Get-Content "$env:APPDATA\employee-monitor\logs\url-collection.log" -Tail 20
```

---

## Privacy Configuration

### Default Privacy Settings

The default configuration provides balanced privacy:

```typescript
{
  stripQueryParams: true,
  queryParamWhitelist: ['page', 'lang', 'tab', 'view'],
  sensitivePatterns: [
    /token=/i,
    /api[_-]?key=/i,
    /password=/i,
    /secret=/i,
    /\b\d{13,19}\b/ // Credit cards
  ]
}
```

### Privacy Levels

#### Level 1: Minimal Privacy (Development)

```typescript
// common/config/privacy-config.ts
export const CUSTOM_PRIVACY_CONFIG = {
  stripQueryParams: false,
  sensitivePatterns: [
    /password=/i,
    /token=/i
  ]
};
```

#### Level 2: Default Privacy (Production)

Uses built-in `DEFAULT_PRIVACY_CONFIG`:
- Query parameters stripped (except whitelist)
- Sensitive domains redacted
- Pattern-based filtering

#### Level 3: Strict Privacy (GDPR/HIPAA)

```typescript
export const CUSTOM_PRIVACY_CONFIG = {
  stripQueryParams: true,
  queryParamWhitelist: [], // No whitelisted params
  domainWhitelist: ['internal.company.com'], // Only internal allowed
  sensitivePatterns: [
    /token=/i,
    /api[_-]?key=/i,
    /password=/i,
    /secret=/i,
    /session=/i,
    /auth=/i,
    /\b\d{13,19}\b/, // Credit cards
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ // Emails
  ]
};
```

### Custom Privacy Configuration

Edit `common/config/privacy-config.ts`:

```typescript
export const CUSTOM_PRIVACY_CONFIG: PrivacyConfig = {
  stripQueryParams: true,

  // Whitelist corporate-specific parameters
  queryParamWhitelist: ['page', 'lang', 'tab', 'view', 'project_id'],

  // Whitelist internal corporate domains
  domainWhitelist: [
    'internal.company.com',
    'intranet.company.com',
    'jira.company.com'
  ],

  // Add company-specific sensitive patterns
  sensitivePatterns: [
    /token=/i,
    /api[_-]?key=/i,
    /password=/i,
    /secret=/i,
    /employee[_-]?id=/i, // Company-specific
    /\b\d{13,19}\b/ // Credit cards
  ]
};
```

Apply configuration:

```typescript
// In your application initialization
import { CUSTOM_PRIVACY_CONFIG } from './common/config/privacy-config';
import { sanitizeUrl } from './common/utils/privacy-helper';

const url = collectedUrl;
const sanitized = sanitizeUrl(url, CUSTOM_PRIVACY_CONFIG);
```

---

## Verification & Testing

### Health Check

```bash
# Run comprehensive health check
npm run test:health

# Expected output:
# ✅ Platform: darwin
# ✅ Accessibility: Granted
# ✅ Browser URL Collection: Available
# ✅ Privacy Protection: Enabled
# ✅ Tamper Detection: Active
```

### Integration Testing

```bash
# Run full integration test suite
npm test -- test/integration/browser-url-collection.test.ts

# Run specific browser tests
npm test -- test/integration/firefox-collection.test.ts
```

### Performance Benchmarking

```bash
# Run performance benchmarks
npm run test:performance

# Expected output:
# 📊 Performance Benchmark Results:
#   P50: ~50ms ✅
#   P95: ~200ms ✅
#   P99: ~800ms ✅
#   Throughput: ~25 ops/sec ✅
```

### Manual Verification

1. **Start the application**:
   ```bash
   npm run dev
   ```

2. **Open a browser** (Chrome/Safari/Firefox)

3. **Navigate to a URL** (e.g., `https://github.com`)

4. **Check logs** for successful collection:
   ```bash
   # macOS
   tail -f ~/Library/Logs/employee-monitor/url-collection.log

   # Windows
   Get-Content "$env:APPDATA\employee-monitor\logs\url-collection.log" -Tail 20 -Wait
   ```

5. **Verify sanitization**:
   - URLs with tokens should show `[REDACTED_PATTERN]`
   - Sensitive domains should show `[REDACTED_SENSITIVE]`

---

## Deployment Checklist

### Pre-Deployment

- [ ] Verify OS version meets requirements
- [ ] Test on representative machines (1-2 per OS)
- [ ] Configure privacy settings for organization
- [ ] Prepare permission request guidance for users
- [ ] Create rollback plan

### macOS Deployment

- [ ] Package application as `.pkg` or `.dmg`
- [ ] Code sign application with Developer ID
- [ ] Notarize with Apple (for macOS 10.15+)
- [ ] Prepare MDM configuration profile (if applicable)
- [ ] Test Accessibility permission request flow
- [ ] Verify browser collection on all supported browsers

### Windows Deployment

- [ ] Package application as `.msi`
- [ ] Code sign with Authenticode certificate
- [ ] Configure UI Automation service startup
- [ ] Prepare Group Policy or SCCM package
- [ ] Test service enablement on fresh machines
- [ ] Verify browser collection on all supported browsers

### Post-Deployment

- [ ] Monitor accuracy metrics (first 7 days)
- [ ] Review error logs for common issues
- [ ] Collect user feedback on permission requests
- [ ] Adjust privacy configuration if needed
- [ ] Update documentation with lessons learned

---

## Support Contacts

### Technical Issues
- **Email**: support@company.com
- **Docs**: [docs/troubleshooting.md](./troubleshooting.md)
- **Logs**: `~/Library/Logs/employee-monitor/` (macOS) or `%APPDATA%/employee-monitor/logs/` (Windows)

### Permission Issues
- **macOS**: Refer users to System Preferences → Security & Privacy → Accessibility
- **Windows**: Verify UI Automation service via `services.msc`

### Privacy Concerns
- Review privacy configuration in `common/config/privacy-config.ts`
- All URLs are sanitized according to configurable policies
- GDPR/HIPAA-compliant configurations available
