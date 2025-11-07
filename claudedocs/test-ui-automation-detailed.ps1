# UI Automation 详细测试脚本
# 用于诊断地址栏查找问题

param(
    [string]$BrowserName = "Chrome"
)

Write-Host "========================================="
Write-Host "UI Automation 详细测试"
Write-Host "========================================="
Write-Host ""
Write-Host "目标浏览器: $BrowserName"
Write-Host ""

# 设置输出编码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

try {
    # 加载程序集
    Write-Host "[Step 1] 加载 UI Automation 程序集..."
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Write-Host "[OK] 程序集加载成功"
    Write-Host ""

    # 获取桌面
    Write-Host "[Step 2] 获取桌面元素..."
    $automation = [System.Windows.Automation.AutomationElement]
    $desktop = $automation::RootElement
    Write-Host "[OK] 桌面元素: $($desktop.Current.Name)"
    Write-Host ""

    # 查找 Chrome 窗口
    Write-Host "[Step 3] 查找 Chrome 浏览器窗口..."
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty,
        "Chrome_WidgetWin_1"
    )

    $browserWindow = $desktop.FindFirst(
        [System.Windows.Automation.TreeScope]::Children,
        $condition
    )

    if ($null -eq $browserWindow) {
        Write-Host "[ERROR] 未找到 Chrome 窗口"
        Write-Host ""
        Write-Host "请确保:"
        Write-Host "1. Chrome 浏览器正在运行"
        Write-Host "2. Chrome 窗口不是最小化状态"
        Write-Host "3. 有至少一个标签页打开"
        exit 1
    }

    Write-Host "[OK] 找到 Chrome 窗口"
    Write-Host "     窗口名称: $($browserWindow.Current.Name)"
    Write-Host "     类名: $($browserWindow.Current.ClassName)"
    Write-Host "     AutomationId: $($browserWindow.Current.AutomationId)"
    Write-Host ""

    # 尝试所有可能的地址栏名称
    Write-Host "[Step 4] 尝试查找地址栏..."
    $addressBarNames = @(
        'Address and search bar',
        '地址和搜索栏',
        '位址與搜尋列',
        'アドレスと検索バー',
        'Adress- und Suchleiste'
    )

    $addressBar = $null
    $foundName = $null

    foreach ($name in $addressBarNames) {
        Write-Host "  [尝试] $name"

        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $name
        )

        $addressBar = $browserWindow.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $condition
        )

        if ($null -ne $addressBar) {
            $foundName = $name
            Write-Host "  [成功!] 找到地址栏: $name"
            break
        } else {
            Write-Host "  [失败] 未找到"
        }
    }

    Write-Host ""

    if ($null -eq $addressBar) {
        Write-Host "[ERROR] 所有尝试都失败，未找到地址栏"
        Write-Host ""
        Write-Host "让我们看看 Chrome 窗口里有什么元素..."
        Write-Host ""

        # 列出前30个子元素
        Write-Host "Chrome 窗口的子元素:"
        Write-Host "----------------------------------------"

        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $element = $walker.GetFirstChild($browserWindow)
        $count = 0
        $maxCount = 30

        while ($null -ne $element -and $count -lt $maxCount) {
            $count++
            $name = $element.Current.Name
            $className = $element.Current.ClassName
            $controlType = $element.Current.ControlType.ProgrammaticName
            $automationId = $element.Current.AutomationId

            Write-Host "[$count] $controlType"
            if ($name -and $name.Length -gt 0) {
                Write-Host "     Name: $name"
            }
            if ($className -and $className.Length -gt 0) {
                Write-Host "     ClassName: $className"
            }
            if ($automationId -and $automationId.Length -gt 0) {
                Write-Host "     AutomationId: $automationId"
            }

            # 如果是 Edit 控件，尝试读取值
            if ($controlType -match "Edit") {
                try {
                    $patterns = $element.GetSupportedPatterns()
                    Write-Host "     SupportedPatterns: $($patterns.Length)"

                    $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $value = $valuePattern.Current.Value
                    if ($value -and $value.Length -gt 0) {
                        Write-Host "     >>> VALUE: $value" -ForegroundColor Green
                    }
                } catch {
                    Write-Host "     (无法读取值)"
                }
            }

            Write-Host ""
            $element = $walker.GetNextSibling($element)
        }

        Write-Host "共显示 $count 个元素"
        Write-Host ""

        exit 1
    }

    # 找到地址栏，尝试读取值
    Write-Host "[Step 5] 读取地址栏内容..."
    Write-Host "  控件类型: $($addressBar.Current.ControlType.ProgrammaticName)"
    Write-Host "  控件名称: $($addressBar.Current.Name)"
    Write-Host ""

    # 检查支持的模式
    Write-Host "  检查支持的模式..."
    $patterns = $addressBar.GetSupportedPatterns()
    Write-Host "  支持 $($patterns.Length) 个模式:"
    foreach ($pattern in $patterns) {
        Write-Host "    - $($pattern.ProgrammaticName)"
    }
    Write-Host ""

    # 尝试获取值
    try {
        $valuePattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $url = $valuePattern.Current.Value

        if ($url -and $url.Length -gt 0) {
            Write-Host "[SUCCESS] 成功获取 URL!"
            Write-Host ""
            Write-Host "URL: $url"
            Write-Host ""
            Write-Host "========================================="
            Write-Host "测试完成 - 成功"
            Write-Host "========================================="
        } else {
            Write-Host "[ERROR] 地址栏值为空"
            Write-Host ""
            Write-Host "可能的原因:"
            Write-Host "1. 地址栏确实是空的（新标签页）"
            Write-Host "2. 需要管理员权限"
            Write-Host "3. Chrome 使用了特殊的渲染模式"
            Write-Host ""

            # 尝试其他属性
            Write-Host "尝试其他属性:"
            try {
                Write-Host "  HelpText: $($addressBar.Current.HelpText)"
                Write-Host "  ItemStatus: $($addressBar.Current.ItemStatus)"
                Write-Host "  IsEnabled: $($addressBar.Current.IsEnabled)"
                Write-Host "  IsOffscreen: $($addressBar.Current.IsOffscreen)"
            } catch {
                Write-Host "  (无法读取其他属性)"
            }
        }
    } catch {
        Write-Host "[ERROR] 无法获取值模式"
        Write-Host "错误: $($_.Exception.Message)"
    }

} catch {
    Write-Host "[FATAL ERROR] 发生异常"
    Write-Host "错误: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "堆栈跟踪:"
    Write-Host $_.Exception.StackTrace
}

Write-Host ""
Write-Host "========================================="
Write-Host "测试结束"
Write-Host "========================================="
