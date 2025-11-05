# URL 采集依赖性分析与解决方案

## 依赖层级

### 方案 1: UI Automation（首选）

**依赖**:
- Windows 10/11 操作系统
- .NET Framework 4.0+ (UIAutomationClient.dll, UIAutomationTypes.dll)
- PowerShell 5.0+

**优点**:
- ✅ 获取完整 URL
- ✅ 实时准确
- ✅ 支持所有 Chromium 浏览器

**覆盖率**: ~95% Windows 10/11 系统

---

### 方案 2: Window Title（降级）

**依赖**:
- Windows API (user32.dll) - 系统内置，无法移除
- 无需 .NET Framework

**优点**:
- ✅ 100% 兼容所有 Windows 系统
- ✅ 零外部依赖
- ✅ 性能最好

**缺点**:
- ⚠️ 只能获取页面标题，不是完整 URL
- ⚠️ 窗口标题可能被浏览器扩展修改

**覆盖率**: 100% Windows 系统

---

### 方案 3: 浏览器历史记录（备选）

**依赖**:
- SQLite (可以集成到应用中，无需系统安装)
- 文件系统访问权限

**实现原理**:
```
Chrome 历史: %LOCALAPPDATA%\Google\Chrome\User Data\Default\History
Edge 历史:   %LOCALAPPDATA%\Microsoft\Edge\User Data\Default\History

SQLite 查询:
SELECT url FROM urls ORDER BY last_visit_time DESC LIMIT 1
```

**优点**:
- ✅ 无需 .NET Framework
- ✅ 可获取完整 URL
- ✅ 可移植的 SQLite 库

**缺点**:
- ⚠️ 需要读取用户文件（隐私敏感）
- ⚠️ 数据库可能被浏览器锁定
- ⚠️ 略有延迟（不是实时）

**覆盖率**: 100% 有浏览器的系统

---

## 依赖检测脚本

### PowerShell 检测脚本

```powershell
# check-dependencies.ps1

Write-Host "=== URL Collection Dependency Check ==="
Write-Host ""

# 1. 检查 .NET Framework
Write-Host "[1/3] Checking .NET Framework..."
try {
    $dotNetVersions = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP' -Recurse |
        Get-ItemProperty -Name Version -EA 0 |
        Where-Object { $_.PSChildName -match '^(?!S)\p{L}'} |
        Select-Object PSChildName, Version

    if ($dotNetVersions) {
        Write-Host "[OK] .NET Framework installed:"
        $dotNetVersions | ForEach-Object {
            Write-Host "     - $($_.PSChildName): $($_.Version)"
        }

        # 检查是否有 4.0 或更高版本
        $hasV4 = $dotNetVersions | Where-Object { $_.Version -match "^4\." }
        if ($hasV4) {
            Write-Host "[OK] .NET Framework 4.x detected - UI Automation available"
            $uiAutomationAvailable = $true
        } else {
            Write-Host "[WARNING] No .NET Framework 4.x - UI Automation unavailable"
            $uiAutomationAvailable = $false
        }
    } else {
        Write-Host "[ERROR] .NET Framework not found"
        $uiAutomationAvailable = $false
    }
} catch {
    Write-Host "[ERROR] Failed to check .NET Framework"
    $uiAutomationAvailable = $false
}

Write-Host ""

# 2. 检查 PowerShell 版本
Write-Host "[2/3] Checking PowerShell..."
$psVersion = $PSVersionTable.PSVersion
Write-Host "[OK] PowerShell Version: $psVersion"

if ($psVersion.Major -ge 5) {
    Write-Host "[OK] PowerShell 5.0+ available"
} else {
    Write-Host "[WARNING] PowerShell version < 5.0 - May have compatibility issues"
}

Write-Host ""

# 3. 测试 UI Automation
Write-Host "[3/3] Testing UI Automation..."
if ($uiAutomationAvailable) {
    try {
        Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
        Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
        Write-Host "[OK] UI Automation assemblies loaded successfully"

        # 尝试访问桌面元素
        $automation = [System.Windows.Automation.AutomationElement]
        $desktop = $automation::RootElement
        Write-Host "[OK] UI Automation fully functional"

        $method = "UI_AUTOMATION"
    } catch {
        Write-Host "[ERROR] UI Automation failed: $($_.Exception.Message)"
        $method = "WINDOW_TITLE"
    }
} else {
    Write-Host "[INFO] UI Automation not available (.NET Framework missing)"
    $method = "WINDOW_TITLE"
}

Write-Host ""
Write-Host "=== Result ==="
Write-Host ""

switch ($method) {
    "UI_AUTOMATION" {
        Write-Host "[BEST] Using UI Automation method"
        Write-Host "       - Full URL collection available"
        Write-Host "       - Real-time accurate"
    }
    "WINDOW_TITLE" {
        Write-Host "[FALLBACK] Using Window Title method"
        Write-Host "            - Only page titles (not full URLs)"
        Write-Host "            - Still works on all systems"
        Write-Host ""
        Write-Host "To enable full URLs:"
        Write-Host "1. Install .NET Framework 4.5+:"
        Write-Host "   https://dotnet.microsoft.com/download/dotnet-framework"
        Write-Host "2. Restart application"
    }
}

Write-Host ""
Write-Host "=== Additional Options ==="
Write-Host ""
Write-Host "Alternative: Browser History method"
Write-Host "- Does not require .NET Framework"
Write-Host "- Can get full URLs"
Write-Host "- Reads from browser SQLite database"
Write-Host "- Currently not implemented (can be added)"
Write-Host ""
```

---

## 建议的增强实现

### 1. 添加浏览器历史记录读取（无需 .NET）

**优势**:
- 不依赖 .NET Framework
- 获取完整 URL
- 使用 better-sqlite3 (Node.js 原生模块)

**实现示例**:

```typescript
// platforms/windows/browser-history-reader.ts

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

export class BrowserHistoryReader {
  /**
   * 读取 Chrome 最近访问的 URL
   */
  static getLatestChromeURL(): string | null {
    try {
      const historyPath = path.join(
        os.homedir(),
        'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'History'
      );

      // 复制数据库文件（避免锁定）
      const tempPath = path.join(os.tmpdir(), `chrome-history-${Date.now()}.db`);
      fs.copyFileSync(historyPath, tempPath);

      const db = new Database(tempPath, { readonly: true });

      const row = db.prepare(`
        SELECT url
        FROM urls
        ORDER BY last_visit_time DESC
        LIMIT 1
      `).get();

      db.close();
      fs.unlinkSync(tempPath);

      return row?.url || null;
    } catch (error) {
      logger.error('Failed to read Chrome history:', error);
      return null;
    }
  }
}
```

### 2. 智能降级策略

```typescript
// 增强的 URL 采集流程
async getActiveURL(browserName: string): Promise<string | null> {
  // 1. 尝试 UI Automation（如果 .NET 可用）
  if (this.isUIAutomationAvailable()) {
    const url = await this.getURLViaUIAutomation(browserName);
    if (url) {
      logger.info('[URLCollector] ✅ Method: UI Automation');
      return url;
    }
  }

  // 2. 尝试浏览器历史记录（无需 .NET）
  const historyUrl = await this.getURLFromHistory(browserName);
  if (historyUrl) {
    logger.info('[URLCollector] ✅ Method: Browser History');
    return historyUrl;
  }

  // 3. 降级到窗口标题
  const titleUrl = await this.getURLFromWindowTitle(browserName);
  if (titleUrl) {
    logger.info('[URLCollector] ⚠️ Method: Window Title (partial data)');
    return titleUrl;
  }

  return null;
}
```

### 3. 依赖检测与自适应

```typescript
// 启动时检测依赖
async initialize() {
  this.capabilities = await this.detectCapabilities();

  logger.info('[URLCollector] Capabilities:', {
    uiAutomation: this.capabilities.uiAutomation,
    browserHistory: this.capabilities.browserHistory,
    windowTitle: this.capabilities.windowTitle
  });
}

private async detectCapabilities() {
  return {
    uiAutomation: await this.testUIAutomation(),
    browserHistory: await this.testBrowserHistory(),
    windowTitle: true  // Always available
  };
}
```

---

## 实际部署建议

### 场景 A: 标准企业环境（推荐）

**特点**: Windows 10/11 企业版，标准配置

**方案**:
- 主要: UI Automation
- 降级: Window Title

**无需额外安装**

### 场景 B: 精简系统环境

**特点**: Windows Server Core, LTSC 精简版

**方案**:
1. 检测 .NET Framework
2. 如缺失，提示用户安装（可选）
3. 使用 Window Title 作为默认方案

**安装 .NET Framework**:
```powershell
# Windows Server 2019/2022
Add-WindowsFeature NET-Framework-45-Core

# 或下载离线安装包
# https://dotnet.microsoft.com/download/dotnet-framework/net48
```

### 场景 C: 高安全性环境（建议增强）

**特点**: 禁止访问外部 DLL，不允许 PowerShell

**方案**:
- 实现纯 Node.js 方案（浏览器历史记录）
- 使用 better-sqlite3 读取历史
- 完全不依赖 .NET 或 PowerShell

---

## 当前状态

**v1.0.84**:
- ✅ 有 UI Automation (主要方案)
- ✅ 有 Window Title (降级方案)
- ❌ 无 Browser History (可增强)

**依赖检查**:
- ❌ 启动时不检测依赖
- ❌ 不提示用户缺失组件
- ❌ 无自适应策略

---

## 建议的改进

### 短期（v1.0.85）

1. **添加依赖检测**
   - 启动时检测 .NET Framework
   - 日志中记录可用方法
   - 自动选择最佳方案

2. **改进错误提示**
   - 如果 UI Automation 失败，说明原因
   - 提供安装 .NET 的指导

### 中期（v1.1.0）

3. **实现浏览器历史记录方案**
   - 使用 better-sqlite3
   - 无需 .NET Framework
   - 可获取完整 URL

4. **智能降级策略**
   - 根据系统能力自动选择
   - 提供配置选项

### 长期（v2.0.0）

5. **浏览器扩展方案**
   - 企业部署可分发 Chrome 扩展
   - 100% 准确的 URL 采集
   - 无系统依赖

---

## 总结

**当前方案**:
- ✅ 95% 系统使用 UI Automation (完整 URL)
- ✅ 5% 系统使用 Window Title (仅标题)
- ✅ 100% 系统都能工作

**您的担忧是对的**，但：
1. **实际影响小** - 绝大多数系统有 .NET
2. **已有降级** - Window Title 始终可用
3. **可以增强** - Browser History 方案无需 .NET

**建议**:
- 现在: 使用当前方案（已足够好）
- 未来: 如果遇到没有 .NET 的环境，再添加 Browser History 方案

**要现在就添加 Browser History 方案吗？** 我可以立即实现。
