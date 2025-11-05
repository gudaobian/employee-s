# 正确的 UI Automation 可用性检查
# UI Automation 不需要任何 Windows 服务，只需要 .NET Framework

Write-Host "========================================="
Write-Host "UI Automation 真正的依赖检查"
Write-Host "========================================="
Write-Host ""

# 1. 检查 .NET Framework 版本
Write-Host "[1/3] 检查 .NET Framework..."
try {
    $dotNetVersions = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP' -Recurse |
        Get-ItemProperty -Name Version -EA 0 |
        Where-Object { $_.PSChildName -match '^(?!S)\p{L}'} |
        Select-Object PSChildName, Version

    if ($dotNetVersions) {
        Write-Host "[OK] .NET Framework 已安装:" -ForegroundColor Green
        $dotNetVersions | ForEach-Object {
            Write-Host "     - $($_.PSChildName): $($_.Version)"
        }

        $hasV4 = $dotNetVersions | Where-Object { $_.Version -match "^4\." }
        if ($hasV4) {
            Write-Host "[OK] .NET Framework 4.x 已检测到 - UI Automation 可用" -ForegroundColor Green
        } else {
            Write-Host "[ERROR] 没有 .NET Framework 4.x - UI Automation 不可用" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "[ERROR] 未找到 .NET Framework" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "[ERROR] 检查 .NET Framework 失败" -ForegroundColor Red
    exit 1
}

Write-Host ""

# 2. 测试加载 UI Automation 程序集
Write-Host "[2/3] 测试加载 UI Automation 程序集..."
try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
    Write-Host "[OK] UI Automation 程序集加载成功" -ForegroundColor Green
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

# 3. 测试 UI Automation 功能
Write-Host "[3/3] 测试 UI Automation 功能..."
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
Write-Host "✅ UI Automation 完全可用" -ForegroundColor Green
Write-Host "========================================="
Write-Host ""
Write-Host "注意: UI Automation 不需要任何 Windows 服务运行。"
Write-Host "      只要有 .NET Framework 4.0+，UI Automation 就能工作。"
Write-Host ""
