# 更新失败调试结果报告

**日期**: 2025-12-22 10:30
**分析版本**: v1.0.154 → v1.0.155
**严重程度**: 🚨 CRITICAL - 两个独立问题

---

## 执行摘要

通过日志分析发现了**两个独立的严重问题**，导致热更新和全量更新都无法成功：

1. **热更新失败**: `@electron/asar` 模块路径在打包后不可用
2. **全量更新无法安装**: 自动安装脚本未打包到应用中

**服务端配置正常** ✅: 差异包配置正确，API 返回 `updateType: 'hot'`

---

## 🔍 问题 1: 热更新失败 - ASAR CLI 路径问题

### 错误日志

```
[2025-12-22 10:21:42.733] [error] [HotUpdate] 热更新失败:
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './bin/asar.mjs'
is not defined by "exports" in
/Applications/EmployeeSafety.app/Contents/Resources/app.asar/node_modules/@electron/asar/package.json
    at AsarManager.extract (/Applications/EmployeeSafety.app/Contents/Resources/app.asar/out/dist/common/services/hot-update/AsarManager.js:109:33)
    at async HotUpdateService.applyDiffPackage (...)
```

### 根本原因

**代码位置**: `src/common/services/hot-update/AsarManager.ts:98-109`

```typescript
async extract(targetDir: string): Promise<void> {
  await fs.ensureDir(targetDir);

  // 使用 CLI 工具解压，绕过 ASAR 协议
  const { execSync } = require('child_process');
  const asarCli = require.resolve('@electron/asar/bin/asar.mjs'); // ❌ 打包后此路径不可用

  try {
    execSync(`node "${asarCli}" extract "${this.asarPath}" "${targetDir}"`, {
      stdio: 'pipe',
      encoding: 'utf8'
    });
  } catch (error: any) {
    throw new Error(`ASAR解压失败: ${error.message}`);
  }
}
```

**问题分析**:

1. **开发环境** ✅: `require.resolve('@electron/asar/bin/asar.mjs')` 可以正常工作
2. **打包后** ❌: `@electron/asar` 的 package.json 中 `exports` 字段未导出 `./bin/asar.mjs`
3. **Node.js 行为**: 当模块使用 `exports` 字段时，只有明确导出的路径可以被 `require.resolve()`
4. **`@electron/asar` 的 package.json**:
   ```json
   {
     "exports": {
       ".": {
         "import": "./lib/index.js",
         "require": "./lib/index.js"
       }
     }
   }
   ```
   **未包含** `"./bin/asar.mjs"`！

### 影响

- ✅ 热更新检测成功（API 调用正常）
- ✅ 差异包下载成功
- ✅ 备份创建成功（v1.0.154 的 original-fs 修复生效）
- ❌ **ASAR 解压失败** → 热更新中止
- ↓ 回退到全量更新

### 修复方案

**方案 A: 使用 @electron/asar 的 API（推荐）**

```typescript
async extract(targetDir: string): Promise<void> {
  await fs.ensureDir(targetDir);

  // ✅ 使用 API 而非 CLI
  const asar = await this.loadAsarModule();
  await asar.extractAll(this.asarPath, targetDir);
}
```

**优点**:
- 不依赖 CLI 路径
- API 稳定且有类型定义
- 性能更好（直接 API 调用）

**方案 B: 使用 original-fs 直接读取（备用）**

```typescript
async extract(targetDir: string): Promise<void> {
  await fs.ensureDir(targetDir);

  // ✅ 直接使用 API 提取所有文件
  const asar = await this.loadAsarModule();
  const files = asar.listPackage(this.asarPath);

  for (const file of files) {
    const content = asar.extractFile(this.asarPath, file);
    const targetPath = path.join(targetDir, file);
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);
  }
}
```

---

## 🔍 问题 2: 全量更新无法安装 - 安装脚本缺失

### 错误日志

```
[2025-12-22 10:21:43.105] [info]  [AUTO_UPDATE] macOS detected - attempting auto-install from cache
[2025-12-22 10:21:43.106] [info]  [AUTO_UPDATE] Found update zip: /Users/zhangxiaoyu/Library/Caches/employee-safety-client/pending/EmployeeSafety.zip
[2025-12-22 10:21:43.106] [error] [AUTO_UPDATE] Install script not found: /Applications/EmployeeSafety.app/Contents/Resources/installer-scripts/auto-install-update-macos.sh
```

### 根本原因

**代码位置**: `electron/auto-update-integration.js:474-484`

```javascript
// Get install script path (in Resources if packaged, in project if dev)
let scriptPath;
if (app.isPackaged) {
  scriptPath = path.join(process.resourcesPath, 'installer-scripts', 'auto-install-update-macos.sh');
} else {
  scriptPath = path.join(__dirname, '..', 'installer-scripts', 'auto-install-update-macos.sh');
}

if (!fs.existsSync(scriptPath)) {
  log.error('[AUTO_UPDATE] Install script not found:', scriptPath);
  return false; // ❌ 安装失败，静默返回
}
```

**问题分析**:

1. **脚本存在** ✅: `scripts/installer/macos/auto-install-update-macos.sh` 在项目中
2. **期望位置**: `/Applications/EmployeeSafety.app/Contents/Resources/installer-scripts/`
3. **实际情况** ❌: 打包时未将脚本复制到 Resources 目录
4. **打包配置缺失**: `scripts/build/pack-mac-universal.js` 未配置 extraResource

### 影响

- ✅ 全量更新下载成功（103.94 MB）
- ✅ 缓存识别成功
- ❌ **自动安装失败** → 静默返回 false
- ↓ 回退到显示"立即重启"对话框
- ❌ 点击"立即重启"调用 `quitAndInstall()`
- ❌ `quitAndInstall()` 依赖 Squirrel.Mac，可能因签名问题失败
- 🔄 应用未重启，更新未安装

### 修复方案

**方案 A: 修复打包配置（推荐）**

编辑 `scripts/build/pack-mac-universal.js`:

```javascript
const packagerOptions = {
  // ... 其他配置 ...

  // ✅ 添加 extraResource
  extraResource: [
    {
      from: path.join(__dirname, '../../scripts/installer/macos'),
      to: 'installer-scripts',
      filter: ['**/*.sh']
    }
  ]
};
```

或使用 electron-packager 的 `--extra-resource` 参数：

```javascript
extraResource: [
  path.join(__dirname, '../../scripts/installer/macos/auto-install-update-macos.sh')
]
```

**方案 B: 禁用自动安装，使用 Squirrel.Mac（临时）**

如果打包配置难以修改，可以临时禁用自动安装逻辑：

```javascript
// electron/auto-update-integration.js:770
if (os.platform() === 'darwin') {
  log.info('[AUTO_UPDATE] macOS detected - skipping auto-install (not configured)');
  // 直接显示重启对话框，使用 quitAndInstall
}

showUpdateReadyNotification(info);
```

然后修复 `quitAndInstall` 的重启问题（见问题3）。

---

## 🔍 问题 3: quitAndInstall 不重启（次要问题）

### 可能原因

从之前的分析报告 `UPDATE_RESTART_FAILURE_ANALYSIS.md` 中：

1. **Squirrel.Mac 签名验证**:
   - macOS 要求更新包签名匹配
   - 如果签名不一致，`quitAndInstall()` 会静默失败

2. **错误未捕获**:
   - `setTimeout` 中的错误无法被 try-catch 捕获
   - 失败时应用不退出，用户看不到任何反馈

### 建议修复

**src/common/services/auto-update-service.ts:455-476**:

```typescript
async quitAndInstall(isSilent: boolean = false, isForceRunAfter: boolean = true): Promise<void> {
  try {
    updateLogger.info('Preparing to quit and install update');

    await this.saveApplicationState();
    this.reportUpdateStatus(UpdateStatus.INSTALLING);

    // ✅ 添加备用重启机制
    try {
      updateLogger.info('Calling autoUpdater.quitAndInstall()...');
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter);

      // 5秒后强制重启（如果还没退出）
      setTimeout(() => {
        updateLogger.error('Application did not quit, forcing restart');
        app.relaunch();
        app.exit(0);
      }, 5000);

    } catch (quitError: any) {
      updateLogger.error('quitAndInstall failed, using fallback', quitError);
      // 直接强制重启
      app.relaunch();
      app.exit(0);
    }
  } catch (error: any) {
    updateLogger.error('Failed to quit and install', error);
    throw error;
  }
}
```

---

## ✅ 验证结果

### 1. 服务端配置 ✅

**检查结果**: 服务端配置正确

**证据**:
```
[2025-12-22 10:21:42.517] [info]  [UPDATE] [HotUpdate] Hot update available {
  version: '1.0.155',
  updateType: 'hot'  // ✅ 服务端明确返回热更新可用
}
```

**差异包下载成功**:
```
[2025-12-22 10:21:42.681] [info]  [HotUpdate] 下载完成,耗时: 164ms
[2025-12-22 10:21:42.682] [info]  [HotUpdate] 校验通过
```

**结论**: 服务端已正确配置 1.0.154 → 1.0.155 的差异包。

### 2. 客户端配置

**检查结果**: 配置文件不存在（使用默认配置）

**命令执行**:
```bash
$ cat ~/Library/Application\ Support/EmployeeSafety/config.json
配置文件不存在
```

**结论**:
- 应用使用代码中的默认配置
- `hotUpdateEnabled` 默认为 `true`（从 AutoUpdateService.ts:95-96 推断）
- 不影响热更新检测

### 3. 文件系统状态 ✅

**ASAR 备份修复成功**:
```bash
$ ls -lah /Applications/EmployeeSafety.app/Contents/Resources/ | grep asar
-rw-r--r--@  29M app.asar
-rw-r--r--@  29M app.asar.backup  # ✅ 是文件，不是目录！
drwxr-xr-x@  96B app.asar.unpacked
```

**v1.0.154 的 original-fs 修复生效** ✅

**安装脚本缺失** ❌:
```bash
$ find /Applications/EmployeeSafety.app -name "*install*"
(无输出)
```

---

## 📊 完整的更新流程追踪

### 时间线 (10:21:42 - 10:21:43)

```
10:21:42.517 → 检测到热更新可用 (v1.0.155, type: hot)
10:21:42.517 → 开始下载差异包
10:21:42.681 → 下载完成 (164ms)
10:21:42.682 → 校验通过 ✅
10:21:42.729 → 备份完成 ✅ (original-fs 修复生效)
10:21:42.733 → ❌ ASAR 解压失败 (ERR_PACKAGE_PATH_NOT_EXPORTED)
10:21:42.733 → 开始回滚
10:21:42.763 → 回滚成功
10:21:42.878 → 上报失败结果到服务端
10:21:42.879 → 回退到全量更新
10:21:43.102 → 发现全量更新 v1.0.155
10:21:43.103 → 检测到本地缓存 (103.94 MB)
10:21:43.105 → 跳过下载,使用缓存
10:21:43.105 → 尝试自动安装
10:21:43.106 → ❌ 安装脚本不存在
10:21:43.107 → 回退到 electron-updater 下载流程 (但实际有缓存)
            → 用户看到"立即重启"对话框
            → 点击后 quitAndInstall() 可能失败（签名问题）
            → 应用未重启，更新未安装
```

---

## 🔧 修复优先级

### P0 - 立即修复（阻塞热更新）

1. **修复 AsarManager.extract**
   - 文件: `src/common/services/hot-update/AsarManager.ts:98-109`
   - 方案: 使用 `asar.extractAll()` API 替代 CLI
   - 影响: 热更新功能完全恢复

### P1 - 高优先级（影响全量更新）

2. **添加安装脚本到打包**
   - 文件: `scripts/build/pack-mac-universal.js`
   - 方案: 配置 `extraResource` 包含安装脚本
   - 影响: 全量更新自动安装功能恢复

### P2 - 中优先级（改善用户体验）

3. **增强 quitAndInstall 错误处理**
   - 文件: `src/common/services/auto-update-service.ts:455-476`
   - 方案: 添加备用重启机制和超时
   - 影响: 避免重启失败时无反馈

---

## 📝 后续测试计划

### 修复后验证步骤

1. **验证热更新修复**:
   ```bash
   # 1. 应用 P0 修复
   # 2. 构建 v1.0.156
   # 3. 部署到服务端
   # 4. 从 v1.0.155 更新到 v1.0.156
   # 5. 检查日志应出现:
   #    [HotUpdate] ASAR解压成功
   #    [HotUpdate] 创建 app.asar.new 成功
   #    [PROMPT] User chose to restart
   # 6. 重启后验证版本 = 1.0.156
   ```

2. **验证全量更新修复**:
   ```bash
   # 1. 应用 P1 修复（添加安装脚本）
   # 2. 构建 v1.0.156
   # 3. 验证脚本已打包:
   ls /Applications/EmployeeSafety.app/Contents/Resources/installer-scripts/
   # 4. 禁用热更新测试全量更新流程
   # 5. 检查日志应出现:
   #    [AUTO_UPDATE] Install script found
   #    [AUTO_UPDATE] Install script launched successfully
   # 6. 应用应自动重启并安装
   ```

3. **验证 quitAndInstall 备用机制**:
   ```bash
   # 1. 应用 P2 修复
   # 2. 模拟 quitAndInstall 失败
   # 3. 检查5秒后是否强制重启
   ```

---

## 相关文件清单

| 文件路径 | 问题 | 修复状态 | 优先级 |
|---------|------|---------|--------|
| `src/common/services/hot-update/AsarManager.ts:98-109` | ASAR CLI 路径不可用 | ⏳ 待修复 | P0 |
| `scripts/build/pack-mac-universal.js` | 未打包安装脚本 | ⏳ 待修复 | P1 |
| `src/common/services/auto-update-service.ts:455-476` | quitAndInstall 错误处理 | ⏳ 待修复 | P2 |
| `scripts/installer/macos/auto-install-update-macos.sh` | 安装脚本源文件 | ✅ 存在 | - |
| `src/common/services/hot-update/AsarManager.ts:58-66` | 备份创建 | ✅ 已修复 | - |

---

**报告生成时间**: 2025-12-22 10:30
**下一步**: 应用 P0 和 P1 修复，构建 v1.0.156 进行测试
