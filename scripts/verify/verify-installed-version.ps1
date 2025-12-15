#!/usr/bin/env pwsh
<#
.SYNOPSIS
    验证已安装的 EmployeeSafety 客户端版本
.DESCRIPTION
    提取并检查已安装应用的实际代码版本，诊断为什么显示旧版本
#>

param(
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   EmployeeSafety 版本诊断工具" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# 1. 查找安装路径
# ============================================
Write-Host "[1/8] 查找安装路径..." -ForegroundColor Yellow

$possiblePaths = @(
    "$env:LOCALAPPDATA\Programs\EmployeeSafety",
    "$env:ProgramFiles\EmployeeSafety",
    "${env:ProgramFiles(x86)}\EmployeeSafety"
)

$installPath = $null
foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        $installPath = $path
        break
    }
}

if (-not $installPath) {
    Write-Host "❌ 未找到安装目录！尝试的路径:" -ForegroundColor Red
    $possiblePaths | ForEach-Object { Write-Host "   - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "✅ 找到安装路径: $installPath" -ForegroundColor Green
Write-Host ""

# ============================================
# 2. 检查 app.asar
# ============================================
Write-Host "[2/8] 检查 app.asar 文件..." -ForegroundColor Yellow

$asarPath = Join-Path $installPath "resources\app.asar"
if (-not (Test-Path $asarPath)) {
    Write-Host "❌ app.asar 不存在: $asarPath" -ForegroundColor Red
    exit 1
}

$asarInfo = Get-Item $asarPath
Write-Host "✅ app.asar 存在" -ForegroundColor Green
Write-Host "   大小: $([math]::Round($asarInfo.Length / 1MB, 2)) MB" -ForegroundColor Gray
Write-Host "   修改时间: $($asarInfo.LastWriteTime)" -ForegroundColor Gray
Write-Host ""

# ============================================
# 3. 确保 asar 工具可用
# ============================================
Write-Host "[3/8] 检查 asar 工具..." -ForegroundColor Yellow

try {
    $asarVersion = (asar --version 2>&1) | Out-String
    Write-Host "✅ asar 已安装: $($asarVersion.Trim())" -ForegroundColor Green
} catch {
    Write-Host "📦 asar 未安装，正在安装..." -ForegroundColor Yellow
    npm install -g asar | Out-Null
    Write-Host "✅ asar 安装完成" -ForegroundColor Green
}
Write-Host ""

# ============================================
# 4. 提取 app.asar
# ============================================
Write-Host "[4/8] 提取 app.asar..." -ForegroundColor Yellow

$extractPath = Join-Path $env:TEMP "employee-safety-diagnostic-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (Test-Path $extractPath) {
    Remove-Item $extractPath -Recurse -Force
}

asar extract $asarPath $extractPath | Out-Null
Write-Host "✅ 提取完成: $extractPath" -ForegroundColor Green
Write-Host ""

# ============================================
# 5. 检查 WindowsAdapter
# ============================================
Write-Host "[5/8] 检查 WindowsAdapter..." -ForegroundColor Yellow

$adapterPath = Join-Path $extractPath "dist\platforms\windows\windows-adapter.js"
if (-not (Test-Path $adapterPath)) {
    Write-Host "❌ WindowsAdapter 不存在: $adapterPath" -ForegroundColor Red
    Remove-Item $extractPath -Recurse -Force
    exit 1
}

$adapterContent = Get-Content $adapterPath -Raw
$adapterInfo = Get-Item $adapterPath

Write-Host "✅ WindowsAdapter 存在" -ForegroundColor Green
Write-Host "   大小: $([math]::Round($adapterInfo.Length / 1KB, 2)) KB" -ForegroundColor Gray
Write-Host ""

# 检查 VERSION
Write-Host "   🔍 VERSION 字段:" -ForegroundColor Cyan
if ($adapterContent -match 'VERSION\s*=\s*[''"]([^''"]+)[''"]') {
    $installedVersion = $matches[1]
    Write-Host "      已安装版本: $installedVersion" -ForegroundColor White

    if ($installedVersion -match '1\.0\.77') {
        Write-Host "      ✅ 版本正确 (期望: 1.0.77-fixed-tsconfig)" -ForegroundColor Green
    } else {
        Write-Host "      ❌ 版本不对！应该是 1.0.77-fixed-tsconfig" -ForegroundColor Red
        Write-Host "      🚨 这说明你安装的不是最新版本！" -ForegroundColor Red
    }
} else {
    Write-Host "      ❌ 未找到 VERSION 字段" -ForegroundColor Red
}
Write-Host ""

# 检查 getActiveURL 方法
Write-Host "   🔍 getActiveURL 方法:" -ForegroundColor Cyan
$getActiveURLMatches = [regex]::Matches($adapterContent, 'getActiveURL')
Write-Host "      找到 $($getActiveURLMatches.Count) 处 'getActiveURL' 引用" -ForegroundColor White

if ($adapterContent -match 'async\s+getActiveURL\s*\(') {
    Write-Host "      ✅ getActiveURL 方法存在" -ForegroundColor Green
} else {
    Write-Host "      ❌ getActiveURL 方法不存在" -ForegroundColor Red
    Write-Host "      🚨 这是关键问题！代码中缺少此方法！" -ForegroundColor Red
}
Write-Host ""

# ============================================
# 6. 检查 native-event-adapter
# ============================================
Write-Host "[6/8] 检查 native-event-adapter.js..." -ForegroundColor Yellow

$nativeAdapterPath = Join-Path $extractPath "dist\native-event-monitor-win\src\native-event-adapter.js"
if (Test-Path $nativeAdapterPath) {
    $nativeInfo = Get-Item $nativeAdapterPath
    Write-Host "✅ native-event-adapter.js 存在" -ForegroundColor Green
    Write-Host "   大小: $([math]::Round($nativeInfo.Length / 1KB, 2)) KB" -ForegroundColor Gray
    Write-Host "   修改时间: $($nativeInfo.LastWriteTime)" -ForegroundColor Gray
} else {
    Write-Host "❌ native-event-adapter.js 不存在！" -ForegroundColor Red
    Write-Host "   期望路径: $nativeAdapterPath" -ForegroundColor Red
    Write-Host "   🚨 这是关键问题！tsconfig.json 没有包含 native-event-monitor-win！" -ForegroundColor Red
}
Write-Host ""

# ============================================
# 7. 检查导入语句
# ============================================
Write-Host "[7/8] 检查模块导入..." -ForegroundColor Yellow

if ($adapterContent -match 'require\([''"]([^''"]*native-event-adapter)[^''"]*[''"]\)') {
    $importPath = $matches[1]
    Write-Host "✅ 找到导入语句: $importPath" -ForegroundColor Green

    # 验证导入路径是否正确
    if ($importPath -match '\.\.\/\.\.\/native-event-monitor-win\/src\/native-event-adapter') {
        Write-Host "   ✅ 导入路径格式正确" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️ 导入路径可能有问题: $importPath" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ 未找到 native-event-adapter 导入语句" -ForegroundColor Red
}
Write-Host ""

# ============================================
# 8. 列出所有方法（可选）
# ============================================
if ($Verbose) {
    Write-Host "[8/8] WindowsAdapter 所有方法:" -ForegroundColor Yellow
    $methods = [regex]::Matches($adapterContent, '(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{') |
        ForEach-Object { $_.Groups[1].Value } |
        Where-Object { $_ -notmatch '^(if|for|while|switch|catch)$' } |
        Sort-Object -Unique

    $methods | ForEach-Object {
        if ($_ -eq 'getActiveURL') {
            Write-Host "   ✅ $_" -ForegroundColor Green
        } else {
            Write-Host "   - $_" -ForegroundColor Gray
        }
    }
    Write-Host ""
}

# ============================================
# 9. 生成诊断报告
# ============================================
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   诊断报告" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$hasVersion = $installedVersion -match '1\.0\.77'
$hasGetActiveURL = $adapterContent -match 'async\s+getActiveURL\s*\('
$hasNativeAdapter = Test-Path $nativeAdapterPath

Write-Host "📊 检查结果摘要:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   VERSION 字段:              $(if($hasVersion){'✅ 正确'}else{'❌ 错误'})" -ForegroundColor $(if($hasVersion){'Green'}else{'Red'})
Write-Host "   getActiveURL 方法:          $(if($hasGetActiveURL){'✅ 存在'}else{'❌ 缺失'})" -ForegroundColor $(if($hasGetActiveURL){'Green'}else{'Red'})
Write-Host "   native-event-adapter.js:   $(if($hasNativeAdapter){'✅ 存在'}else{'❌ 缺失'})" -ForegroundColor $(if($hasNativeAdapter){'Green'}else{'Red'})
Write-Host ""

if ($hasVersion -and $hasGetActiveURL -and $hasNativeAdapter) {
    Write-Host "✅ 诊断结果: 安装包代码正确" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 可能的原因:" -ForegroundColor Yellow
    Write-Host "   1. Electron 缓存问题 - 清除缓存后重启应用" -ForegroundColor White
    Write-Host "   2. 多个实例运行 - 完全退出后重新启动" -ForegroundColor White
    Write-Host "   3. 权限问题 - 以管理员身份运行应用" -ForegroundColor White
    Write-Host ""
    Write-Host "💡 建议操作:" -ForegroundColor Yellow
    Write-Host "   1. 完全卸载应用（使用控制面板）" -ForegroundColor White
    Write-Host "   2. 删除以下目录:" -ForegroundColor White
    Write-Host "      - $env:LOCALAPPDATA\Programs\EmployeeSafety" -ForegroundColor Gray
    Write-Host "      - $env:APPDATA\EmployeeSafety" -ForegroundColor Gray
    Write-Host "   3. 重新安装 v1.0.77" -ForegroundColor White
    Write-Host "   4. 以管理员身份运行应用" -ForegroundColor White
} elseif (-not $hasVersion) {
    Write-Host "❌ 诊断结果: 安装的不是 v1.0.77" -ForegroundColor Red
    Write-Host ""
    Write-Host "🚨 当前安装版本: $installedVersion" -ForegroundColor Red
    Write-Host "🎯 期望版本: 1.0.77-fixed-tsconfig" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "💡 解决方案:" -ForegroundColor Yellow
    Write-Host "   1. 前往 GitHub Releases 下载最新版本" -ForegroundColor White
    Write-Host "      https://github.com/gudaobian/employee-s/releases/tag/v1.0.77" -ForegroundColor Gray
    Write-Host "   2. 确认下载的文件名包含 '1.0.77'" -ForegroundColor White
    Write-Host "   3. 卸载当前版本后重新安装" -ForegroundColor White
} elseif (-not $hasGetActiveURL) {
    Write-Host "❌ 诊断结果: 代码中缺少 getActiveURL 方法" -ForegroundColor Red
    Write-Host ""
    Write-Host "🚨 这说明安装包是用旧代码构建的！" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 解决方案:" -ForegroundColor Yellow
    Write-Host "   1. 检查 GitHub Actions 构建日志，确认 v1.0.77 构建成功" -ForegroundColor White
    Write-Host "   2. 确认 'Verify compiled WindowsAdapter has getActiveURL' 步骤通过" -ForegroundColor White
    Write-Host "   3. 等待几分钟后重新下载（可能是缓存问题）" -ForegroundColor White
    Write-Host "   4. 清除浏览器缓存后重新下载" -ForegroundColor White
} elseif (-not $hasNativeAdapter) {
    Write-Host "❌ 诊断结果: 缺少 native-event-adapter.js" -ForegroundColor Red
    Write-Host ""
    Write-Host "🚨 这说明 TypeScript 编译时没有包含 native-event-monitor-win！" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 解决方案:" -ForegroundColor Yellow
    Write-Host "   1. 这是构建配置问题，需要等待新版本发布" -ForegroundColor White
    Write-Host "   2. 检查 GitHub Actions 是否使用了最新的 tsconfig.json" -ForegroundColor White
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# 清理临时文件
# ============================================
Write-Host "🧹 清理临时文件..." -ForegroundColor Yellow
Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "✅ 清理完成" -ForegroundColor Green
Write-Host ""

# 提示如何查看详细信息
if (-not $Verbose) {
    Write-Host "💡 使用 -Verbose 参数可查看所有方法列表" -ForegroundColor Gray
    Write-Host "   例如: .\verify-installed-version.ps1 -Verbose" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
