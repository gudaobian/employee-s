#!/usr/bin/env pwsh
# EmployeeSafety Installation Version Verification Script
# Diagnoses why the application shows old version

param(
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=========================================="
Write-Host "   EmployeeSafety Version Diagnostic Tool"
Write-Host "=========================================="
Write-Host ""

# Step 1: Find installation path
Write-Host "[1/8] Finding installation path..."

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
    Write-Host "ERROR: Installation directory not found! Tried:" -ForegroundColor Red
    $possiblePaths | ForEach-Object { Write-Host "   - $_" }
    exit 1
}

Write-Host "FOUND: $installPath" -ForegroundColor Green
Write-Host ""

# Step 2: Check app.asar
Write-Host "[2/8] Checking app.asar file..."

$asarPath = Join-Path $installPath "resources\app.asar"
if (-not (Test-Path $asarPath)) {
    Write-Host "ERROR: app.asar not found: $asarPath" -ForegroundColor Red
    exit 1
}

$asarInfo = Get-Item $asarPath
Write-Host "FOUND: app.asar" -ForegroundColor Green
Write-Host "   Size: $([math]::Round($asarInfo.Length / 1MB, 2)) MB"
Write-Host "   Modified: $($asarInfo.LastWriteTime)"
Write-Host ""

# Step 3: Ensure asar tool is available
Write-Host "[3/8] Checking asar tool..."

try {
    $asarVersion = (asar --version 2>&1) | Out-String
    Write-Host "FOUND: asar $($asarVersion.Trim())" -ForegroundColor Green
} catch {
    Write-Host "Installing asar..." -ForegroundColor Yellow
    npm install -g asar | Out-Null
    Write-Host "INSTALLED: asar" -ForegroundColor Green
}
Write-Host ""

# Step 4: Extract app.asar
Write-Host "[4/8] Extracting app.asar..."

$extractPath = Join-Path $env:TEMP "employee-safety-diagnostic-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (Test-Path $extractPath) {
    Remove-Item $extractPath -Recurse -Force
}

asar extract $asarPath $extractPath | Out-Null
Write-Host "EXTRACTED to: $extractPath" -ForegroundColor Green
Write-Host ""

# Step 5: Check WindowsAdapter
Write-Host "[5/8] Checking WindowsAdapter..."

$adapterPath = Join-Path $extractPath "dist\platforms\windows\windows-adapter.js"
if (-not (Test-Path $adapterPath)) {
    Write-Host "ERROR: WindowsAdapter not found: $adapterPath" -ForegroundColor Red
    Remove-Item $extractPath -Recurse -Force
    exit 1
}

$adapterContent = Get-Content $adapterPath -Raw
$adapterInfo = Get-Item $adapterPath

Write-Host "FOUND: WindowsAdapter" -ForegroundColor Green
Write-Host "   Size: $([math]::Round($adapterInfo.Length / 1KB, 2)) KB"
Write-Host ""

# Check VERSION field
Write-Host "   [VERSION Check]"
if ($adapterContent -match 'VERSION\s*=\s*[''"]([^''"]+)[''"]') {
    $installedVersion = $matches[1]
    Write-Host "      Installed: $installedVersion"

    if ($installedVersion -match '1\.0\.77') {
        Write-Host "      STATUS: CORRECT (expected: 1.0.77-fixed-tsconfig)" -ForegroundColor Green
    } else {
        Write-Host "      STATUS: WRONG! Should be 1.0.77-fixed-tsconfig" -ForegroundColor Red
        Write-Host "      ALERT: You are NOT running the latest version!" -ForegroundColor Red
    }
} else {
    Write-Host "      STATUS: VERSION field not found" -ForegroundColor Red
}
Write-Host ""

# Check getActiveURL method
Write-Host "   [getActiveURL Method Check]"
$getActiveURLMatches = [regex]::Matches($adapterContent, 'getActiveURL')
Write-Host "      Found $($getActiveURLMatches.Count) references to 'getActiveURL'"

if ($adapterContent -match 'async\s+getActiveURL\s*\(') {
    Write-Host "      STATUS: METHOD EXISTS" -ForegroundColor Green
} else {
    Write-Host "      STATUS: METHOD MISSING" -ForegroundColor Red
    Write-Host "      ALERT: This is the critical issue!" -ForegroundColor Red
}
Write-Host ""

# Step 6: Check native-event-adapter
Write-Host "[6/8] Checking native-event-adapter.js..."

$nativeAdapterPath = Join-Path $extractPath "dist\native-event-monitor-win\src\native-event-adapter.js"
if (Test-Path $nativeAdapterPath) {
    $nativeInfo = Get-Item $nativeAdapterPath
    Write-Host "FOUND: native-event-adapter.js" -ForegroundColor Green
    Write-Host "   Size: $([math]::Round($nativeInfo.Length / 1KB, 2)) KB"
    Write-Host "   Modified: $($nativeInfo.LastWriteTime)"
} else {
    Write-Host "MISSING: native-event-adapter.js" -ForegroundColor Red
    Write-Host "   Expected: $nativeAdapterPath"
    Write-Host "   ALERT: tsconfig.json did not include native-event-monitor-win!" -ForegroundColor Red
}
Write-Host ""

# Step 7: Check import statement
Write-Host "[7/8] Checking module imports..."

if ($adapterContent -match 'require\([''"]([^''"]*native-event-adapter)[^''"]*[''"]\)') {
    $importPath = $matches[1]
    Write-Host "FOUND: Import statement: $importPath" -ForegroundColor Green

    if ($importPath -match '\.\.\/\.\.\/native-event-monitor-win\/src\/native-event-adapter') {
        Write-Host "   STATUS: Import path is CORRECT" -ForegroundColor Green
    } else {
        Write-Host "   WARNING: Import path might be wrong: $importPath" -ForegroundColor Yellow
    }
} else {
    Write-Host "MISSING: native-event-adapter import statement" -ForegroundColor Red
}
Write-Host ""

# Step 8: List all methods (optional)
if ($Verbose) {
    Write-Host "[8/8] WindowsAdapter Methods:"
    $methods = [regex]::Matches($adapterContent, '(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{') |
        ForEach-Object { $_.Groups[1].Value } |
        Where-Object { $_ -notmatch '^(if|for|while|switch|catch)$' } |
        Sort-Object -Unique

    $methods | ForEach-Object {
        if ($_ -eq 'getActiveURL') {
            Write-Host "   OK: $_" -ForegroundColor Green
        } else {
            Write-Host "   - $_"
        }
    }
    Write-Host ""
}

# Step 9: Generate diagnostic report
Write-Host "=========================================="
Write-Host "   DIAGNOSTIC REPORT"
Write-Host "=========================================="
Write-Host ""

$hasVersion = $installedVersion -match '1\.0\.77'
$hasGetActiveURL = $adapterContent -match 'async\s+getActiveURL\s*\('
$hasNativeAdapter = Test-Path $nativeAdapterPath

Write-Host "Summary:"
Write-Host ""
Write-Host "   VERSION field:             $(if($hasVersion){'[OK] Correct'}else{'[FAIL] Wrong'})"
Write-Host "   getActiveURL method:       $(if($hasGetActiveURL){'[OK] Present'}else{'[FAIL] Missing'})"
Write-Host "   native-event-adapter.js:   $(if($hasNativeAdapter){'[OK] Present'}else{'[FAIL] Missing'})"
Write-Host ""

if ($hasVersion -and $hasGetActiveURL -and $hasNativeAdapter) {
    Write-Host "RESULT: Installation package code is CORRECT" -ForegroundColor Green
    Write-Host ""
    Write-Host "Possible causes for runtime errors:" -ForegroundColor Yellow
    Write-Host "   1. Electron cache issue - Clear cache and restart" -ForegroundColor White
    Write-Host "   2. Multiple instances running - Fully exit and restart" -ForegroundColor White
    Write-Host "   3. Permission issue - Run as administrator" -ForegroundColor White
    Write-Host ""
    Write-Host "Recommended actions:" -ForegroundColor Yellow
    Write-Host "   1. Fully uninstall the application (Control Panel)" -ForegroundColor White
    Write-Host "   2. Delete these directories:" -ForegroundColor White
    Write-Host "      - $env:LOCALAPPDATA\Programs\EmployeeSafety"
    Write-Host "      - $env:APPDATA\EmployeeSafety"
    Write-Host "   3. Reinstall v1.0.77" -ForegroundColor White
    Write-Host "   4. Run as administrator" -ForegroundColor White
} elseif (-not $hasVersion) {
    Write-Host "RESULT: Installed version is NOT v1.0.77" -ForegroundColor Red
    Write-Host ""
    Write-Host "Current version: $installedVersion" -ForegroundColor Red
    Write-Host "Expected version: 1.0.77-fixed-tsconfig" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Solution:" -ForegroundColor Yellow
    Write-Host "   1. Go to GitHub Releases and download the latest version" -ForegroundColor White
    Write-Host "      https://github.com/gudaobian/employee-s/releases/tag/v1.0.77" -ForegroundColor Gray
    Write-Host "   2. Verify the filename contains '1.0.77'" -ForegroundColor White
    Write-Host "   3. Uninstall current version and reinstall" -ForegroundColor White
} elseif (-not $hasGetActiveURL) {
    Write-Host "RESULT: Code is missing getActiveURL method" -ForegroundColor Red
    Write-Host ""
    Write-Host "This means the installation package was built with OLD code!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Solution:" -ForegroundColor Yellow
    Write-Host "   1. Check GitHub Actions build logs to confirm v1.0.77 built successfully" -ForegroundColor White
    Write-Host "   2. Verify 'Verify compiled WindowsAdapter has getActiveURL' step passed" -ForegroundColor White
    Write-Host "   3. Wait a few minutes and re-download (might be cache issue)" -ForegroundColor White
    Write-Host "   4. Clear browser cache before downloading" -ForegroundColor White
} elseif (-not $hasNativeAdapter) {
    Write-Host "RESULT: native-event-adapter.js is MISSING" -ForegroundColor Red
    Write-Host ""
    Write-Host "This means TypeScript compilation did not include native-event-monitor-win!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Solution:" -ForegroundColor Yellow
    Write-Host "   1. This is a build configuration issue, need to wait for new release" -ForegroundColor White
    Write-Host "   2. Check if GitHub Actions used the latest tsconfig.json" -ForegroundColor White
}

Write-Host ""
Write-Host "=========================================="
Write-Host ""

# Cleanup
Write-Host "Cleaning up temporary files..."
Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Cleanup complete" -ForegroundColor Green
Write-Host ""

if (-not $Verbose) {
    Write-Host "TIP: Use -Verbose parameter to see all methods list" -ForegroundColor Gray
    Write-Host "     Example: .\verify-installed-version-en.ps1 -Verbose" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
