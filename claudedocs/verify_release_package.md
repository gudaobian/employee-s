# 验证v1.0.69发布包的完整性

## 关键问题

**用户报告**: v1.0.69安装后仍显示 "UNKNOWN (old version)" 和 "getActiveURL不存在"

**理论分析**:
1. ✅ GitHub Actions构建日志显示成功
2. ✅ 所有验证步骤都通过了
3. ❌ 但用户运行的确实是旧代码

**结论**: 需要验证v1.0.69的**最终安装包**是否包含正确的代码

---

## 验证方法

### 方法1: 下载并解压验证（本地测试）

```powershell
# 1. 下载v1.0.69安装包
$url = "https://github.com/gudaobian/employee-s/releases/download/v1.0.69/EmployeeSafety-Setup-1.0.69.exe"
$installer = "$env:TEMP\EmployeeSafety-Setup-1.0.69.exe"
Invoke-WebRequest -Uri $url -OutFile $installer

# 2. 使用7zip解压NSIS安装包
$extractDir = "$env:TEMP\verify-v1.0.69"
& "C:\Program Files\7-Zip\7z.exe" x $installer -o"$extractDir" -y

# 3. 找到app-64.7z并解压
$app7z = Get-ChildItem "$extractDir" -Recurse -Filter "app-64.7z" | Select-Object -First 1
$appDir = "$env:TEMP\verify-app"
& "C:\Program Files\7-Zip\7z.exe" x $app7z.FullName -o"$appDir" -y

# 4. 找到app.asar并提取
$asar = Get-ChildItem "$appDir" -Recurse -Filter "app.asar" | Select-Object -First 1
$asarExtracted = "$env:TEMP\verify-asar"
npm install -g asar
asar extract $asar.FullName $asarExtracted

# 5. 检查WindowsAdapter代码
$adapter = "$asarExtracted\dist\platforms\windows\windows-adapter.js"
if (Test-Path $adapter) {
    $content = Get-Content $adapter -Raw

    Write-Host "=== 验证结果 ==="

    # 检查VERSION
    if ($content -match 'VERSION\s*=\s*[''"]([^''"]+)[''"]') {
        Write-Host "VERSION: $($matches[1])"
        if ($matches[1] -match "1\.0\.69") {
            Write-Host "✅ VERSION正确" -ForegroundColor Green
        } else {
            Write-Host "❌ VERSION错误！" -ForegroundColor Red
        }
    }

    # 检查getActiveURL
    if ($content -match "getActiveURL\s*\(") {
        Write-Host "✅ getActiveURL方法存在" -ForegroundColor Green
    } else {
        Write-Host "❌ getActiveURL方法不存在！" -ForegroundColor Red
        Write-Host "🚨 这是安装包的问题，不是用户安装问题！" -ForegroundColor Red
    }

    # 检查native module
    $nativeModule = "$asarExtracted\native-event-monitor-win\build\Release\event_monitor.node"
    if (Test-Path $nativeModule) {
        $module = Get-Item $nativeModule
        Write-Host "Native module大小: $([math]::Round($module.Length / 1KB, 2)) KB"
        Write-Host "Native module修改时间: $($module.LastWriteTime)"
    } else {
        Write-Host "⚠️ Native module不在asar中（可能在app.asar.unpacked）"
    }
}

# 6. 清理
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $appDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $asarExtracted -Recurse -Force -ErrorAction SilentlyContinue
```

### 方法2: 检查GitHub Actions构建日志

需要查看v1.0.69构建的完整日志，特别是：

1. **"Rebuild Windows native module for Electron 28"步骤**
   - 是否成功执行？
   - electron-rebuild是否真的运行了？
   - 输出了什么信息？

2. **"Verify compiled WindowsAdapter has getActiveURL"步骤**
   - 检查结果如何？
   - VERSION是什么？

3. **"Verify NSIS installer contains getActiveURL"步骤**
   - 是否真的解压了NSIS安装包？
   - 验证结果如何？

---

## 可能的根本原因

### 假设1: electron-builder使用了缓存的旧app.asar（可能性60%）

即使我们：
- ✅ 清理了dist/目录
- ✅ 重新编译了TypeScript
- ✅ 重新编译了native module

但electron-builder在打包时可能：
- ❌ 从某个缓存位置拉取了旧的app.asar
- ❌ 或者在创建NSIS时使用了之前的文件

**证据**:
- v1.0.65-v1.0.68都有相同问题
- 说明某个环节一直在使用缓存

**解决方案**:
在electron-builder打包前，验证dist/内容并强制清理所有缓存：

```yaml
- name: Verify dist before packaging
  run: |
    # 验证dist/内容
    $adapter = "dist/platforms/windows/windows-adapter.js"
    $content = Get-Content $adapter -Raw

    if ($content -notmatch "getActiveURL") {
      Write-Host "❌ dist/包含旧代码！abort！"
      exit 1
    }

    # 计算hash
    $hash = (Get-FileHash $adapter -Algorithm SHA256).Hash
    Write-Host "dist/ WindowsAdapter SHA256: $hash"

    # 保存hash供后续验证
    $hash | Out-File "dist-hash.txt"

- name: Create application bundle
  run: |
    npm run pack:win
  env:
    # 强制禁用所有缓存
    ELECTRON_BUILDER_CACHE: "false"
    USE_HARD_LINKS: "false"

- name: Verify packaged app.asar
  run: |
    # 提取app.asar并计算hash
    # 与dist-hash.txt对比
    # 如果不匹配，说明electron-builder使用了其他源
```

### 假设2: NSIS打包过程有独立缓存（可能性30%）

electron-builder → win-unpacked → NSIS .exe

可能在"win-unpacked → NSIS"这一步使用了缓存。

**验证**:
```yaml
- name: Verify win-unpacked before NSIS
  run: |
    $asarInUnpacked = "release/win-unpacked/resources/app.asar"
    # 提取并验证
    # 记录hash

- name: Wait for NSIS creation
  # electron-builder创建NSIS

- name: Verify NSIS after creation
  run: |
    # 解压NSIS，提取app.asar
    # 对比hash
    # 如果不同，说明NSIS打包时替换了文件
```

### 假设3: 验证步骤本身有问题（可能性10%）

验证步骤可能检查了错误的文件：
- 检查了dist/的文件（正确）
- 但打包时使用了其他位置的文件

---

## 立即行动

### 行动1: 本地验证v1.0.69安装包（最重要）

**我需要**在Windows机器上：
1. 下载v1.0.69安装包
2. 解压并检查app.asar内容
3. 确认是否包含getActiveURL

如果安装包包含旧代码 → 说明构建有问题，需要修复workflow
如果安装包包含新代码 → 说明是用户安装/缓存问题

### 行动2: 让用户临时验证

请用户执行：
```powershell
# 提取当前安装的app.asar
$asarPath = "$env:LOCALAPPDATA\Programs\EmployeeSafety\resources\app.asar"
asar extract $asarPath "$env:TEMP\check-asar"

# 检查WindowsAdapter
Get-Content "$env:TEMP\check-asar\dist\platforms\windows\windows-adapter.js" |
  Select-String -Pattern "getActiveURL|VERSION"

# 清理
Remove-Item "$env:TEMP\check-asar" -Recurse -Force
```

如果找到了getActiveURL → 说明安装包是正确的，但Electron运行时加载了旧代码（缓存问题）
如果没有找到getActiveURL → 说明安装包本身就是旧的

---

## 结论

需要先确定**v1.0.69安装包本身是否正确**。

如果安装包正确：
- 问题在用户端（缓存/残留）
- 解决方案：完全重新安装 + 清理缓存

如果安装包错误：
- 问题在构建流程
- 需要修复workflow并重新发布v1.0.70

---

**文档版本**: v1.0
**下一步**: 验证v1.0.69安装包内容
