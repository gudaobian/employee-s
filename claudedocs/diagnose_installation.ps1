# Employee Safety v1.0.69 安装诊断脚本
# 用于诊断为什么用户收到旧版本代码

Write-Host "========================================="
Write-Host "Employee Safety v1.0.69 安装诊断"
Write-Host "========================================="
Write-Host ""

# 检查app.asar文件
$asarPath = "$env:LOCALAPPDATA\Programs\EmployeeSafety\resources\app.asar"

Write-Host "=== 1. 检查app.asar文件 ==="
if (Test-Path $asarPath) {
    $file = Get-Item $asarPath
    Write-Host "文件路径: $($file.FullName)"
    Write-Host "文件大小: $([math]::Round($file.Length / 1MB, 2)) MB"
    Write-Host "创建时间: $($file.CreationTime)"
    Write-Host "修改时间: $($file.LastWriteTime)"
    Write-Host ""

    # v1.0.69发布时间: 2025-11-04 14:04 (UTC+8)
    $releaseTime = Get-Date "2025-11-04 14:00:00"
    if ($file.LastWriteTime -lt $releaseTime) {
        Write-Host "❌ 警告: 这是旧版本的文件！" -ForegroundColor Red
        Write-Host "   文件修改时间: $($file.LastWriteTime)"
        Write-Host "   v1.0.69发布时间: $releaseTime"
        Write-Host "   结论: 您运行的是旧版本" -ForegroundColor Red
    } else {
        Write-Host "✅ 文件时间正确" -ForegroundColor Green
    }
} else {
    Write-Host "❌ 未找到app.asar文件" -ForegroundColor Red
    Write-Host "   预期路径: $asarPath"
    exit 1
}

Write-Host ""
Write-Host "=== 2. 提取并检查app.asar内容 ==="

# 检查是否安装了asar
$asarCmd = Get-Command asar -ErrorAction SilentlyContinue
if (-not $asarCmd) {
    Write-Host "⚠️  asar工具未安装，正在安装..." -ForegroundColor Yellow
    npm install -g asar
}

# 提取app.asar到临时目录
$tempDir = "$env:TEMP\verify-app-asar-$(Get-Date -Format 'yyyyMMddHHmmss')"
Write-Host "提取app.asar到: $tempDir"
asar extract $asarPath $tempDir

# 检查WindowsAdapter
$adapterPath = "$tempDir\dist\platforms\windows\windows-adapter.js"
if (Test-Path $adapterPath) {
    Write-Host ""
    Write-Host "=== 3. 检查WindowsAdapter代码 ==="

    $content = Get-Content $adapterPath -Raw

    # 检查VERSION
    if ($content -match 'VERSION\s*=\s*[''"]([^''"]+)[''"]') {
        $version = $matches[1]
        Write-Host "VERSION字段: $version"

        if ($version -match "1\.0\.69") {
            Write-Host "✅ VERSION包含1.0.69" -ForegroundColor Green
        } else {
            Write-Host "❌ VERSION不正确: $version" -ForegroundColor Red
            Write-Host "   预期包含: 1.0.69"
        }
    } else {
        Write-Host "❌ 未找到VERSION字段" -ForegroundColor Red
    }

    # 检查getActiveURL方法
    if ($content -match "getActiveURL\s*\(") {
        Write-Host "✅ getActiveURL方法存在" -ForegroundColor Green
    } else {
        Write-Host "❌ getActiveURL方法不存在" -ForegroundColor Red
    }

    # 统计所有方法
    $methodMatches = [regex]::Matches($content, '(\w+)\s*\([^)]*\)\s*\{')
    Write-Host ""
    Write-Host "检测到的方法数量: $($methodMatches.Count)"

} else {
    Write-Host "❌ WindowsAdapter文件不存在" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 4. 检查native模块 ==="

# app.asar.unpacked中的native module
$nativeInUnpacked = "$env:LOCALAPPDATA\Programs\EmployeeSafety\resources\app.asar.unpacked\native-event-monitor-win\build\Release\event_monitor.node"

if (Test-Path $nativeInUnpacked) {
    $module = Get-Item $nativeInUnpacked
    Write-Host "Native模块路径: $($module.FullName)"
    Write-Host "文件大小: $([math]::Round($module.Length / 1KB, 2)) KB"
    Write-Host "修改时间: $($module.LastWriteTime)"

    if ($module.LastWriteTime -lt (Get-Date "2025-11-04 14:00:00")) {
        Write-Host "❌ 警告: 原生模块是旧版本！" -ForegroundColor Red
    } else {
        Write-Host "✅ 原生模块时间正确" -ForegroundColor Green
    }
} else {
    Write-Host "⚠️  app.asar.unpacked中未找到原生模块"

    # 检查提取的临时目录中的native module
    $nativeInExtracted = "$tempDir\native-event-monitor-win\build\Release\event_monitor.node"
    if (Test-Path $nativeInExtracted) {
        $module = Get-Item $nativeInExtracted
        Write-Host "提取的native模块路径: $($module.FullName)"
        Write-Host "文件大小: $([math]::Round($module.Length / 1KB, 2)) KB"
        Write-Host "修改时间: $($module.LastWriteTime)"
    } else {
        Write-Host "❌ 提取的目录中也未找到原生模块" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== 5. 检查安装信息 ==="

# 检查卸载注册表
$uninstallPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
$employeeSafetyInstall = Get-ItemProperty $uninstallPath -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "*Employee*Safety*" }

if ($employeeSafetyInstall) {
    Write-Host "安装显示名称: $($employeeSafetyInstall.DisplayName)"
    Write-Host "安装版本: $($employeeSafetyInstall.DisplayVersion)"
    Write-Host "安装位置: $($employeeSafetyInstall.InstallLocation)"
    Write-Host "安装日期: $($employeeSafetyInstall.InstallDate)"
} else {
    Write-Host "⚠️  未在注册表中找到安装信息"
}

Write-Host ""
Write-Host "=== 6. 搜索所有EmployeeSafety.exe ==="
Write-Host "搜索中（可能需要几分钟）..."

$exeFiles = @()
try {
    $exeFiles = Get-ChildItem "C:\Users\$env:USERNAME" -Recurse -Filter "EmployeeSafety.exe" -ErrorAction SilentlyContinue |
        Select-Object FullName, Length, LastWriteTime
} catch {
    Write-Host "⚠️  搜索过程中出现错误: $($_.Exception.Message)"
}

if ($exeFiles.Count -gt 0) {
    Write-Host "找到 $($exeFiles.Count) 个EmployeeSafety.exe:"
    foreach ($exe in $exeFiles) {
        Write-Host "  - $($exe.FullName)"
        Write-Host "    大小: $([math]::Round($exe.Length / 1MB, 2)) MB, 修改时间: $($exe.LastWriteTime)"
    }

    if ($exeFiles.Count -gt 1) {
        Write-Host ""
        Write-Host "⚠️  警告: 发现多个安装！可能导致版本混乱" -ForegroundColor Yellow
    }
} else {
    Write-Host "未找到其他EmployeeSafety.exe"
}

Write-Host ""
Write-Host "=== 诊断总结 ==="
Write-Host ""

# 判断结论
$asarFile = Get-Item $asarPath -ErrorAction SilentlyContinue
$isOldFile = $asarFile -and ($asarFile.LastWriteTime -lt (Get-Date "2025-11-04 14:00:00"))

if ($isOldFile) {
    Write-Host "🔴 结论: 您运行的是旧版本！" -ForegroundColor Red
    Write-Host ""
    Write-Host "建议操作："
    Write-Host "1. 完全卸载当前版本"
    Write-Host "2. 手动删除目录: $env:LOCALAPPDATA\Programs\EmployeeSafety"
    Write-Host "3. 重新下载并安装 v1.0.69"
    Write-Host "   下载地址: https://github.com/gudaobian/employee-s/releases/download/v1.0.69/EmployeeSafety-Setup-1.0.69.exe"
} else {
    # 检查代码是否正确
    if (Test-Path $adapterPath) {
        $content = Get-Content $adapterPath -Raw
        $hasGetActiveURL = $content -match "getActiveURL\s*\("
        $hasCorrectVersion = $content -match 'VERSION\s*=\s*[''"].*1\.0\.69.*[''"]'

        if ($hasGetActiveURL -and $hasCorrectVersion) {
            Write-Host "🟢 结论: app.asar包含正确的代码！" -ForegroundColor Green
            Write-Host ""
            Write-Host "但运行时仍显示旧版本，可能原因："
            Write-Host "1. 程序使用了缓存的旧代码"
            Write-Host "2. 需要重启电脑"
            Write-Host "3. Electron的app缓存未清理"
            Write-Host ""
            Write-Host "建议操作："
            Write-Host "1. 完全退出程序"
            Write-Host "2. 删除用户数据: $env:APPDATA\employee-safety-client"
            Write-Host "3. 删除本地数据: $env:LOCALAPPDATA\employee-safety-client"
            Write-Host "4. 重启电脑"
            Write-Host "5. 重新运行程序"
        } else {
            Write-Host "🔴 结论: app.asar包含旧代码！" -ForegroundColor Red
            Write-Host ""
            Write-Host "这是安装包本身的问题，需要开发者重新构建。"
            Write-Host "请报告此问题并等待v1.0.70。"
        }
    }
}

Write-Host ""
Write-Host "=== 清理临时文件 ==="
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✅ 已清理临时文件"
}

Write-Host ""
Write-Host "========================================="
Write-Host "诊断完成！"
Write-Host "========================================="
Write-Host ""
Write-Host "请将以上输出截图或复制给开发者。"
Write-Host ""
Read-Host "按回车键退出"
