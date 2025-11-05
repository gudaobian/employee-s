# Employee Safety Version Diagnostic Tool
# Encoding: UTF-8 with BOM
# This script verifies the installed version of Employee Safety application

Write-Host "========================================="
Write-Host "Employee Safety Version Diagnostic Tool"
Write-Host "========================================="

$installPath = "$env:LOCALAPPDATA\Programs\EmployeeSafety"
$asarPath = "$installPath\resources\app.asar"

if (-not (Test-Path $asarPath)) {
    Write-Host "[ERROR] Application not found at: $installPath"
    Write-Host ""
    Write-Host "Please make sure Employee Safety is installed."
    exit 1
}

Write-Host "[INFO] Application path: $installPath"
Write-Host ""

# Check if asar is installed
$asarInstalled = $false
try {
    $asarVersion = npm list -g asar --depth=0 2>&1
    if ($asarVersion -match "asar@") {
        $asarInstalled = $true
        Write-Host "[OK] asar tool is already installed"
    }
} catch {
    # asar not installed
}

if (-not $asarInstalled) {
    Write-Host "[INFO] Installing asar tool..."
    npm install -g asar 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] asar tool installed successfully"
    } else {
        Write-Host "[ERROR] Failed to install asar tool"
        Write-Host "Please run: npm install -g asar"
        exit 1
    }
}

Write-Host ""
Write-Host "[INFO] Extracting app.asar..."
$extractPath = "temp-diagnostic-extract"

# Clean up if exists
if (Test-Path $extractPath) {
    Remove-Item $extractPath -Recurse -Force
}

# Extract asar
try {
    asar extract $asarPath $extractPath 2>&1 | Out-Null
    if (-not $?) {
        throw "Extraction failed"
    }
    Write-Host "[OK] app.asar extracted successfully"
} catch {
    Write-Host "[ERROR] Failed to extract app.asar: $_"
    exit 1
}

Write-Host ""
Write-Host "----------------------------------------"
Write-Host "Checking WindowsAdapter..."
Write-Host "----------------------------------------"

$adapterPath = "$extractPath\dist\platforms\windows\windows-adapter.js"

if (-not (Test-Path $adapterPath)) {
    Write-Host "[ERROR] WindowsAdapter file not found at: $adapterPath"
    Write-Host ""
    Write-Host "Available files:"
    if (Test-Path $extractPath) {
        Get-ChildItem $extractPath -Recurse | Select-Object -First 20 | Format-Table Name, Length
    }
    Remove-Item $extractPath -Recurse -Force
    exit 1
}

$adapterContent = Get-Content $adapterPath -Raw -Encoding UTF8

# Check VERSION
Write-Host ""
if ($adapterContent -match 'VERSION\s*=\s*[''"]([^''"]+)[''"]') {
    $version = $matches[1]
    Write-Host "[FOUND] WindowsAdapter VERSION: $version"

    if ($version -match "with-url-collection" -or $version -match "1\.0\.7[8-9]" -or $version -match "1\.0\.8[0-9]") {
        Write-Host "[OK] Version is CORRECT! Includes URL collection feature"
    } else {
        Write-Host "[WARNING] Version is OLD! Does not include URL collection"
        Write-Host "          Please download the latest version from GitHub"
    }
} else {
    Write-Host "[ERROR] VERSION identifier not found"
    Write-Host "        This is a VERY OLD version!"
}

# Check getActiveURL method
Write-Host ""
if ($adapterContent -match "getActiveURL\s*\(") {
    Write-Host "[OK] getActiveURL method EXISTS"
    Write-Host "     URL collection feature is available"
} else {
    Write-Host "[ERROR] getActiveURL method NOT FOUND"
    Write-Host "        URL collection feature is NOT available"
    Write-Host ""
    Write-Host "ACTION REQUIRED:"
    Write-Host "1. Uninstall current version completely"
    Write-Host "2. Restart your computer"
    Write-Host "3. Download latest version from:"
    Write-Host "   https://github.com/zhangxiaoyu2000/employee-s/releases/latest"
    Write-Host "4. Install as Administrator"
}

# Check PlatformAdapterBridge (CRITICAL: 2025-11-05 bug fix)
Write-Host ""
Write-Host "----------------------------------------"
Write-Host "Checking PlatformAdapterBridge..."
Write-Host "----------------------------------------"

$bridgePath = "$extractPath\dist\main\platform-adapter-bridge.js"

if (-not (Test-Path $bridgePath)) {
    Write-Host "[WARNING] PlatformAdapterBridge file not found"
    Write-Host "            This may cause URL collection to fail at runtime!"
} else {
    $bridgeContent = Get-Content $bridgePath -Raw -Encoding UTF8
    Write-Host ""

    if ($bridgeContent -match "getActiveURL\s*\(") {
        Write-Host "[OK] PlatformAdapterBridge includes getActiveURL forwarding"
        Write-Host "     Bridge layer will correctly forward URL collection requests"
    } else {
        Write-Host "[ERROR] PlatformAdapterBridge MISSING getActiveURL forwarding"
        Write-Host "        This is the ROOT CAUSE of 'method not found' runtime error!"
        Write-Host ""
        Write-Host "CRITICAL ISSUE DETECTED:"
        Write-Host "- WindowsAdapter HAS getActiveURL ✓"
        Write-Host "- But Bridge layer does NOT forward it ✗"
        Write-Host "- Result: Method exists in code but unavailable at runtime"
        Write-Host ""
        Write-Host "ACTION REQUIRED:"
        Write-Host "1. This is a CODE BUG, not a version issue"
        Write-Host "2. The fix has been applied in source code"
        Write-Host "3. Need to rebuild with: /build-windows"
        Write-Host "4. Download and install the NEW build"
    }
}

# Additional checks
Write-Host ""
Write-Host "----------------------------------------"
Write-Host "Additional Information"
Write-Host "----------------------------------------"

# Check file size
$adapterFile = Get-Item $adapterPath
Write-Host "[INFO] WindowsAdapter file size: $([math]::Round($adapterFile.Length / 1KB, 2)) KB"

# Check if URLCollector exists
$collectorPath = "$extractPath\dist\platforms\windows\url-collector.js"
if (Test-Path $collectorPath) {
    Write-Host "[OK] URLCollector module found"
} else {
    Write-Host "[WARNING] URLCollector module NOT found"
}

# Check permission-checker
$permissionPath = "$extractPath\dist\platforms\windows\permission-checker.js"
if (Test-Path $permissionPath) {
    Write-Host "[OK] PermissionChecker module found"
} else {
    Write-Host "[WARNING] PermissionChecker module NOT found"
}

# Cleanup
Write-Host ""
Write-Host "[INFO] Cleaning up temporary files..."
Remove-Item $extractPath -Recurse -Force

Write-Host ""
Write-Host "========================================="
Write-Host "Diagnostic Complete"
Write-Host "========================================="
Write-Host ""
Write-Host "If you see any [ERROR] or [WARNING] messages above,"
Write-Host "please follow the instructions to resolve the issues."
Write-Host ""
