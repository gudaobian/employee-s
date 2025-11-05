# UI Automation 诊断工具
# Encoding: UTF-8 with BOM

Write-Host "========================================="
Write-Host "UI Automation 诊断工具"
Write-Host "========================================="
Write-Host ""

# 1. 检查 .NET Framework
Write-Host "[1/5] 检查 .NET Framework..."
try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Write-Host "[OK] UIAutomationClient 程序集加载成功"
} catch {
    Write-Host "[ERROR] 无法加载 UIAutomationClient 程序集"
    Write-Host "        错误: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "解决方案:"
    Write-Host "1. 安装 .NET Framework 4.5 或更高版本"
    Write-Host "2. 下载: https://dotnet.microsoft.com/download/dotnet-framework"
    exit 1
}

try {
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
    Write-Host "[OK] UIAutomationTypes 程序集加载成功"
} catch {
    Write-Host "[ERROR] 无法加载 UIAutomationTypes 程序集"
    exit 1
}

Write-Host ""

# 2. 检查 UI Automation 基本功能
Write-Host "[2/5] 检查 UI Automation 基本功能..."
try {
    $automation = [System.Windows.Automation.AutomationElement]
    $desktop = $automation::RootElement
    Write-Host "[OK] UI Automation 可以访问桌面元素"
    Write-Host "     桌面元素名称: $($desktop.Current.Name)"
} catch {
    Write-Host "[ERROR] UI Automation 无法访问桌面元素"
    Write-Host "        错误: $($_.Exception.Message)"
    exit 1
}

Write-Host ""

# 3. 查找 Chrome 窗口
Write-Host "[3/5] 查找 Chrome 浏览器窗口..."
try {
    # 尝试多个可能的类名
    $classNames = @(
        "Chrome_WidgetWin_1",  # Chrome 标准类名
        "Chrome_WidgetWin_0",  # 某些 Chrome 版本
        "MozillaWindowClass",  # Firefox
        "ApplicationFrameWindow"  # Edge (UWP)
    )

    $foundWindow = $null
    $foundClassName = $null

    foreach ($className in $classNames) {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty,
            $className
        )
        $window = $desktop.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            $condition
        )

        if ($null -ne $window) {
            $foundWindow = $window
            $foundClassName = $className
            Write-Host "[OK] 找到浏览器窗口: $className"
            Write-Host "     窗口标题: $($window.Current.Name)"
            break
        }
    }

    if ($null -eq $foundWindow) {
        Write-Host "[WARNING] 未找到浏览器窗口"
        Write-Host "          请确保 Chrome/Edge 浏览器正在运行"
        Write-Host ""
        Write-Host "解决方案:"
        Write-Host "1. 打开 Chrome 或 Edge 浏览器"
        Write-Host "2. 访问任意网页（如 https://github.com）"
        Write-Host "3. 重新运行此脚本"
        exit 0
    }

} catch {
    Write-Host "[ERROR] 查找浏览器窗口时出错"
    Write-Host "        错误: $($_.Exception.Message)"
    exit 1
}

Write-Host ""

# 4. 查找地址栏
Write-Host "[4/5] 查找浏览器地址栏..."

# 尝试多种地址栏名称
$addressBarNames = @(
    "Address and search bar",  # Chrome 英文版
    "地址和搜索栏",             # Chrome 中文版
    "Address bar",
    "Search Box"
)

$addressBarFound = $false

foreach ($barName in $addressBarNames) {
    try {
        Write-Host "     尝试查找: $barName"

        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $barName
        )

        $addressBar = $foundWindow.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $condition
        )

        if ($null -ne $addressBar) {
            Write-Host "[OK] 找到地址栏: $barName"
            Write-Host "     控件类型: $($addressBar.Current.ControlType.ProgrammaticName)"

            try {
                $valuePattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $url = $valuePattern.Current.Value

                if ($url) {
                    Write-Host "[OK] 成功读取 URL: $url"
                    $addressBarFound = $true
                    break
                } else {
                    Write-Host "[WARNING] 地址栏为空"
                }
            } catch {
                Write-Host "[WARNING] 无法读取地址栏内容"
                Write-Host "           错误: $($_.Exception.Message)"
            }
        }
    } catch {
        Write-Host "[WARNING] 查找地址栏失败: $($_.Exception.Message)"
    }
}

if (-not $addressBarFound) {
    Write-Host ""
    Write-Host "[WARNING] 无法找到或读取地址栏"
    Write-Host ""
    Write-Host "可能的原因:"
    Write-Host "1. Chrome 版本太新，地址栏名称已改变"
    Write-Host "2. Chrome 语言设置与脚本不匹配（英文版 vs 中文版）"
    Write-Host "3. 需要提升权限（以管理员身份运行）"
    Write-Host "4. Chrome 使用了特殊的渲染模式"
    Write-Host ""
    Write-Host "继续进行元素树诊断..."
}

Write-Host ""

# 5. 显示 Chrome 窗口的元素树（前20个元素）
Write-Host "[5/5] 显示浏览器窗口元素树（诊断用）..."
Write-Host "----------------------------------------"

try {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $element = $walker.GetFirstChild($foundWindow)
    $count = 0
    $maxCount = 30

    while ($null -ne $element -and $count -lt $maxCount) {
        $count++
        $name = $element.Current.Name
        $className = $element.Current.ClassName
        $controlType = $element.Current.ControlType.ProgrammaticName
        $automationId = $element.Current.AutomationId

        Write-Host "[$count] $controlType"
        if ($name) { Write-Host "     Name: $name" }
        if ($className) { Write-Host "     ClassName: $className" }
        if ($automationId) { Write-Host "     AutomationId: $automationId" }
        Write-Host ""

        # 如果是 Edit 或 Document 控件，尝试读取内容
        if ($controlType -match "Edit|Document|Text") {
            try {
                $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $value = $valuePattern.Current.Value
                if ($value -and $value.Length -gt 0) {
                    Write-Host "     >>> 可能的 URL: $value"
                    Write-Host ""
                }
            } catch {
                # Ignore - 不是所有控件都支持 ValuePattern
            }
        }

        $element = $walker.GetNextSibling($element)
    }

    Write-Host "显示了前 $count 个元素"

} catch {
    Write-Host "[ERROR] 遍历元素树失败"
    Write-Host "        错误: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "========================================="
Write-Host "诊断完成"
Write-Host "========================================="
Write-Host ""
Write-Host "请将此输出截图或复制，以便进一步诊断。"
Write-Host ""
