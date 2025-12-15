# Employee Safety Client - Installation Cleanup Script
# This script runs before installation to clean up old versions

param(
    [string]$AppName = "EmployeeSafety",
    [string]$ProcessName = "EmployeeSafety.exe"
)

Write-Host "========================================="
Write-Host "Employee Safety 安装前清理"
Write-Host "========================================="

# Function to stop process
function Stop-AppProcess {
    param([string]$Name)

    Write-Host "正在检查运行中的进程: $Name"

    $processes = Get-Process -Name $Name.Replace('.exe', '') -ErrorAction SilentlyContinue

    if ($processes) {
        Write-Host "发现 $($processes.Count) 个运行中的进程"

        foreach ($proc in $processes) {
            try {
                Write-Host "停止进程 (PID: $($proc.Id))..."
                Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                Write-Host "✅ 进程已停止"
            }
            catch {
                Write-Warning "⚠️ 无法停止进程: $_"
            }
        }

        # Wait for processes to fully terminate
        Start-Sleep -Seconds 2
    }
    else {
        Write-Host "✅ 没有发现运行中的进程"
    }
}

# Function to uninstall old version
function Uninstall-OldVersion {
    Write-Host ""
    Write-Host "检查已安装的旧版本..."

    # Check uninstall registry
    $uninstallPaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    foreach ($path in $uninstallPaths) {
        $apps = Get-ItemProperty $path -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayName -like "*Employee*Safety*" }

        foreach ($app in $apps) {
            Write-Host "发现已安装版本: $($app.DisplayName) v$($app.DisplayVersion)"

            if ($app.UninstallString) {
                Write-Host "正在卸载旧版本..."

                try {
                    $uninstallCmd = $app.UninstallString

                    # Handle NSIS uninstaller with silent flag
                    if ($uninstallCmd -match "uninst.exe") {
                        $uninstallCmd += " /S"  # Silent uninstall
                    }

                    Write-Host "执行: $uninstallCmd"
                    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $uninstallCmd" -Wait -NoNewWindow
                    Write-Host "✅ 旧版本已卸载"

                    # Wait for uninstaller to complete
                    Start-Sleep -Seconds 3
                }
                catch {
                    Write-Warning "⚠️ 卸载失败: $_"
                }
            }
        }
    }
}

# Function to clean log files
function Remove-LogFiles {
    Write-Host ""
    Write-Host "清理日志文件..."

    $logPaths = @(
        "$env:APPDATA\employee-safety-client\logs",
        "$env:LOCALAPPDATA\employee-safety-client\logs",
        "$env:USERPROFILE\.employee-safety\logs"
    )

    foreach ($path in $logPaths) {
        if (Test-Path $path) {
            try {
                Write-Host "删除日志目录: $path"
                Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
                Write-Host "✅ 日志已删除"
            }
            catch {
                Write-Warning "⚠️ 无法删除日志: $_"
            }
        }
    }

    # Clean temp files
    Write-Host "清理临时文件..."
    $tempFiles = Get-ChildItem -Path $env:TEMP -Filter "employee-safety-*" -ErrorAction SilentlyContinue

    if ($tempFiles) {
        foreach ($file in $tempFiles) {
            try {
                Remove-Item -Path $file.FullName -Recurse -Force -ErrorAction Stop
            }
            catch {
                Write-Warning "⚠️ 无法删除临时文件: $($file.Name)"
            }
        }
        Write-Host "✅ 临时文件已清理"
    }
}

# Function to clean application data
function Remove-AppData {
    param([bool]$IncludeConfig = $false)

    Write-Host ""
    Write-Host "清理应用程序数据..."

    $appDataPaths = @(
        "$env:APPDATA\employee-safety-client",
        "$env:LOCALAPPDATA\employee-safety-client"
    )

    foreach ($path in $appDataPaths) {
        if (Test-Path $path) {
            if ($IncludeConfig) {
                try {
                    Write-Host "删除应用数据: $path"
                    Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
                    Write-Host "✅ 应用数据已删除"
                }
                catch {
                    Write-Warning "⚠️ 无法删除应用数据: $_"
                }
            }
            else {
                # Keep config files, only remove cache and temp
                $cachePaths = @(
                    "$path\Cache",
                    "$path\Code Cache",
                    "$path\GPUCache",
                    "$path\logs"
                )

                foreach ($cache in $cachePaths) {
                    if (Test-Path $cache) {
                        try {
                            Remove-Item -Path $cache -Recurse -Force -ErrorAction Stop
                            Write-Host "✅ 缓存已删除: $cache"
                        }
                        catch {
                            Write-Warning "⚠️ 无法删除缓存: $_"
                        }
                    }
                }
            }
        }
    }
}

# Main execution
try {
    # Step 1: Stop all running processes
    Stop-AppProcess -Name $ProcessName
    Stop-AppProcess -Name "electron"

    # Step 2: Uninstall old version (optional - comment out if not needed)
    # Uninstall-OldVersion

    # Step 3: Clean log files
    Remove-LogFiles

    # Step 4: Clean app data (preserves config by default)
    Remove-AppData -IncludeConfig $false

    Write-Host ""
    Write-Host "========================================="
    Write-Host "✅ 清理完成"
    Write-Host "========================================="
    Write-Host ""

    exit 0
}
catch {
    Write-Error "清理过程出错: $_"
    exit 1
}
