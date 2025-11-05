# ASAR Contents Verification Script
# Encoding: UTF-8 with BOM

Write-Host "========================================="
Write-Host "ASAR Contents Verification"
Write-Host "========================================="

$asarPath = "$env:LOCALAPPDATA\Programs\EmployeeSafety\resources\app.asar"
$extractPath = "temp-asar-check"

if (-not (Test-Path $asarPath)) {
    Write-Host "[ERROR] app.asar not found at: $asarPath"
    exit 1
}

# Clean up
if (Test-Path $extractPath) {
    Remove-Item $extractPath -Recurse -Force
}

# Extract asar
Write-Host "[INFO] Extracting app.asar..."
try {
    asar extract $asarPath $extractPath 2>&1 | Out-Null
    Write-Host "[OK] Extraction successful"
} catch {
    Write-Host "[ERROR] Failed to extract: $_"
    exit 1
}

Write-Host ""
Write-Host "Checking WindowsAdapter..."
Write-Host "----------------------------------------"

# Check WindowsAdapter
$adapterPath = "$extractPath\dist\platforms\windows\windows-adapter.js"

if (Test-Path $adapterPath) {
    $content = Get-Content $adapterPath -Raw -Encoding UTF8
    $size = (Get-Item $adapterPath).Length

    Write-Host "File size: $([math]::Round($size/1KB, 2)) KB"
    Write-Host ""

    # Check key content
    if ($content -match "getActiveURL\s*\(") {
        Write-Host "[OK] Contains getActiveURL method"
    } else {
        Write-Host "[ERROR] Missing getActiveURL method"
    }

    if ($content -match 'VERSION\s*=\s*[''"]([^''"]+)[''"]') {
        Write-Host "[OK] Contains VERSION: $($matches[1])"
    } else {
        Write-Host "[ERROR] Missing VERSION identifier"
    }

    if ($content -match "url-collector") {
        Write-Host "[OK] Contains url-collector reference"
    } else {
        Write-Host "[WARNING] No url-collector reference found"
    }

} else {
    Write-Host "[ERROR] windows-adapter.js not found in ASAR!"
}

Write-Host ""
Write-Host "Checking URLCollector..."
Write-Host "----------------------------------------"

# Check url-collector
$collectorPath = "$extractPath\dist\platforms\windows\url-collector.js"
if (Test-Path $collectorPath) {
    $size = (Get-Item $collectorPath).Length
    Write-Host "[OK] url-collector.js exists ($([math]::Round($size/1KB, 2)) KB)"
} else {
    Write-Host "[ERROR] url-collector.js missing from ASAR!"
}

Write-Host ""
Write-Host "Checking app.asar.unpacked..."
Write-Host "----------------------------------------"

$unpackedPath = "$env:LOCALAPPDATA\Programs\EmployeeSafety\resources\app.asar.unpacked"

if (Test-Path $unpackedPath) {
    Write-Host "[OK] app.asar.unpacked directory exists"

    $unpackedAdapter = "$unpackedPath\dist\platforms\windows\windows-adapter.js"
    if (Test-Path $unpackedAdapter) {
        Write-Host "[OK] WindowsAdapter is unpacked"
    } else {
        Write-Host "[INFO] WindowsAdapter is packed in asar (not unpacked)"
    }
} else {
    Write-Host "[INFO] No app.asar.unpacked directory (all files in asar)"
}

# Cleanup
Write-Host ""
Write-Host "[INFO] Cleaning up..."
Remove-Item $extractPath -Recurse -Force

Write-Host ""
Write-Host "========================================="
Write-Host "Verification Complete"
Write-Host "========================================="
