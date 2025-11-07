# 正确的 UI Automation 可用性检查
# 直接测试能否加载，不依赖注册表检查

Write-Host "========================================="
Write-Host "UI Automation 可用性检查（改进版）"
Write-Host "========================================="
Write-Host ""

# 1. 直接测试加载 UI Automation 程序集（最准确的方法）
Write-Host "[1/2] 测试加载 UI Automation 程序集..."
$uiAutomationAvailable = $false

try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
    Write-Host "[OK] UIAutomationClient 程序集加载成功" -ForegroundColor Green
    Write-Host "[OK] UIAutomationTypes 程序集加载成功" -ForegroundColor Green
    $uiAutomationAvailable = $true
} catch {
    Write-Host "[ERROR] 无法加载 UI Automation 程序集" -ForegroundColor Red
    Write-Host "        错误: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "解决方案:"
    Write-Host "1. 安装 .NET Framework 4.5 或更高版本"
    Write-Host "2. 下载: https://dotnet.microsoft.com/download/dotnet-framework"
    exit 1
}

Write-Host ""

# 2. 测试 UI Automation 功能
Write-Host "[2/2] 测试 UI Automation 功能..."
try {
    $automation = [System.Windows.Automation.AutomationElement]
    $desktop = $automation::RootElement
    Write-Host "[OK] UI Automation 可以访问桌面元素" -ForegroundColor Green
    Write-Host "     桌面元素名称: $($desktop.Current.Name)"
} catch {
    Write-Host "[ERROR] UI Automation 无法访问桌面元素" -ForegroundColor Red
    Write-Host "        错误: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================="
Write-Host "✅ UI Automation 完全可用！" -ForegroundColor Green
Write-Host "========================================="
Write-Host ""

# 3. 尝试检查 .NET Framework 版本（可选，仅供参考）
Write-Host "附加信息: .NET Framework 版本检查"
Write-Host "----------------------------------------"
try {
    # 方法1: 检查注册表
    $dotNetVersions = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP' -Recurse -ErrorAction SilentlyContinue |
        Get-ItemProperty -Name Version -EA 0 |
        Where-Object { $_.PSChildName -match '^(?!S)\p{L}'} |
        Select-Object PSChildName, Version

    if ($dotNetVersions) {
        Write-Host "从注册表检测到的版本:" -ForegroundColor Yellow
        $dotNetVersions | ForEach-Object {
            Write-Host "  - $($_.PSChildName): $($_.Version)"
        }
    }

    # 方法2: 检查 PowerShell 运行时版本
    $psVersion = $PSVersionTable.CLRVersion
    Write-Host "PowerShell CLR 版本: $psVersion" -ForegroundColor Yellow

    # 方法3: 检查 Release 值（.NET 4.5+）
    $release = Get-ItemPropertyValue -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction SilentlyContinue
    if ($release) {
        Write-Host ".NET Framework 4.5+ Release: $release" -ForegroundColor Yellow

        # 根据 Release 值判断具体版本
        if ($release -ge 528040) {
            Write-Host "  → .NET Framework 4.8 或更高" -ForegroundColor Green
        } elseif ($release -ge 461808) {
            Write-Host "  → .NET Framework 4.7.2" -ForegroundColor Green
        } elseif ($release -ge 460798) {
            Write-Host "  → .NET Framework 4.7" -ForegroundColor Green
        } elseif ($release -ge 394802) {
            Write-Host "  → .NET Framework 4.6.2" -ForegroundColor Green
        } elseif ($release -ge 393295) {
            Write-Host "  → .NET Framework 4.6" -ForegroundColor Green
        } elseif ($release -ge 379893) {
            Write-Host "  → .NET Framework 4.5.2" -ForegroundColor Green
        } elseif ($release -ge 378675) {
            Write-Host "  → .NET Framework 4.5.1" -ForegroundColor Green
        } elseif ($release -ge 378389) {
            Write-Host "  → .NET Framework 4.5" -ForegroundColor Green
        }
    }

} catch {
    Write-Host "注册表检查失败（但不影响使用）" -ForegroundColor Yellow
    Write-Host "错误: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ 结论: 您的系统完全支持 UI Automation" -ForegroundColor Green
Write-Host "   可以正常使用浏览器 URL 采集功能" -ForegroundColor Green
Write-Host ""
