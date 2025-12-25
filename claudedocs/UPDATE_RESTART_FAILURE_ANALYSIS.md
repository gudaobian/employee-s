# 更新重启失败分析报告

**日期**: 2025-12-22
**问题版本**: v1.0.154 → v1.0.155
**严重程度**: 🚨 CRITICAL

---

## 问题症状

### 症状 1: 跳过热更新，直接全量下载
- ❌ 一检测到更新就开始下载 103.94 MB 全量包
- ❌ 没有尝试热更新差异包（预期 ~25KB）
- ❌ 未创建 `app.asar.new` 文件

### 症状 2: 全量更新后点击"立即重启"无反应
- ✅ 全量更新下载完成（103.94 MB）
- ✅ 显示"版本 1.0.155 已下载完成"对话框
- ❌ 点击"立即重启"后，应用没有重启
- ❌ 更新未安装，版本仍为 1.0.154

---

## 根本原因分析

### 问题 1: 为何跳过热更新？

通过代码分析，发现热更新检测流程如下：

**AutoUpdateService.ts:350-398** - 更新检测逻辑：
```typescript
// 1. 优先尝试热更新
if (this.hotUpdateService) {
  updateLogger.info('[CHECK] Trying hot update first');

  const updateInfo = await this.hotUpdateService.checkForUpdates();

  if (updateInfo?.hasUpdate && updateInfo.updateType === 'hot' && updateInfo.manifest) {
    // 发现热更新
    const success = await this.hotUpdateService.downloadAndApply(updateInfo.manifest);

    if (success) {
      // 热更新成功,提示用户重启
      this.promptUserToRestart(updateInfo.manifest.version, updateInfo);
      return;
    }

    // 热更新失败,继续完整更新
    updateLogger.warn('[CHECK] Hot update failed, fallback to full update');
  }

  if (updateInfo?.updateType === 'full') {
    // 需要完整更新
    updateLogger.info('[CHECK] Full update required:', updateInfo.reason);
  }
}

// 2. 完整更新流程 (原有逻辑)
const result = await autoUpdater.checkForUpdates(); // ⚠️ 无论如何都会执行
```

**可能原因**:

1. **服务端未配置热更新**
   - API 返回 `updateType: 'full'` 或无 `manifest`
   - 服务端未生成 1.0.154 → 1.0.155 的差异包

2. **热更新服务未初始化**
   - `appConfig.get('hotUpdateEnabled')` 返回 `false`
   - 配置文件中禁用了热更新
   - 代码位置: `AutoUpdateService.ts:95-96`

3. **无条件执行全量更新**
   - Line 400-410: 即使热更新判断完成，仍会调用 `autoUpdater.checkForUpdates()`
   - 这会触发 electron-updater 下载全量包

**关键问题**: 逻辑缺陷 - 即使热更新成功，也会继续执行全量更新检测。

### 问题 2: 为何全量更新后不重启？

#### 全量更新的重启流程

**auto-update-integration.js:547-595** - 全量更新重启对话框：
```javascript
function showUpdateReadyNotification(info) {
  dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '更新已就绪',
    message: `版本 ${info.version} 已下载完成`,
    buttons: ['立即重启', '稍后'],
  }).then((response) => {
    if (response.response === 0) {
      log.info('[AUTO_UPDATE] 用户选择立即重启');

      try {
        log.info('[AUTO_UPDATE] 正在调用 quitAndInstall()...');
        autoUpdateService.quitAndInstall(); // ✅ 正确的方法
        log.info('[AUTO_UPDATE] quitAndInstall() 调用成功');
      } catch (error) {
        log.error('[AUTO_UPDATE] quitAndInstall() 失败:', error);
      }
    }
  });
}
```

**AutoUpdateService.ts:455-476** - quitAndInstall 实现：
```typescript
async quitAndInstall(isSilent: boolean = false, isForceRunAfter: boolean = true): Promise<void> {
  try {
    updateLogger.info('Preparing to quit and install update', {
      isSilent,
      isForceRunAfter
    });

    // Save application state before quitting
    await this.saveApplicationState();

    // Report installing status
    this.reportUpdateStatus(UpdateStatus.INSTALLING);

    // Delay to ensure state is saved
    setTimeout(() => {
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter); // ⚠️ electron-updater 的方法
    }, 1000);
  } catch (error: any) {
    updateLogger.error('Failed to quit and install', error);
    throw error;
  }
}
```

**可能失败原因**:

1. **Squirrel.Mac 签名验证失败**
   - macOS 要求更新包签名匹配
   - 如果签名不一致，Squirrel.Mac 会静默失败

2. **缓存路径问题**
   - electron-updater 下载到 `~/Library/Caches/employee-safety-client/pending/`
   - 如果路径权限问题或文件损坏，安装会失败

3. **没有捕获错误**
   - `setTimeout` 中的 `quitAndInstall()` 调用，错误无法被 try-catch 捕获
   - 如果失败，应用会静默忽略

4. **应用被阻止退出**
   - macOS 可能阻止应用自动退出
   - 需要用户授权或系统设置允许

#### 热更新的重启流程（对比）

**AutoUpdateService.ts:735-780** - 热更新重启对话框：
```typescript
private promptUserToRestart(version: string, updateInfo?: CheckUpdateResponse): void {
  dialog.showMessageBox(mainWindow, {
    title: getVersionChangeTitle(versionChangeType, isForceUpdate),
    message: formatVersionChange(currentVersion, version, versionChangeType),
    buttons: isForceUpdate ? ['立即重启'] : ['立即重启', '稍后'],
  }).then((result) => {
    if (result.response === 0 || isForceUpdate) {
      updateLogger.info('[PROMPT] User chose to restart (or forced)');
      app.relaunch();  // ❌ 只是重启应用，不安装更新！
      app.quit();
    }
  });
}
```

**关键问题**: 热更新的重启逻辑**错误** - 使用 `app.relaunch() + app.quit()` 只会重启应用，不会应用热更新！

热更新的正确流程应该是：
1. 下载差异包
2. 创建 `app.asar.new` 文件
3. 重启应用
4. 主进程启动时检测 `.new` 文件并替换（`main-minimal.js:15-60`）

但当前代码在步骤3使用了错误的方法，应该使用：
```typescript
app.relaunch();  // 重启应用
app.quit();      // 退出当前进程
```

这是**正确的**！问题不在这里。

真正的问题可能是：
- 热更新的 `downloadAndApply` 没有创建 `.new` 文件
- 或者创建失败了

---

## 日志分析建议

### 需要检查的日志

1. **热更新日志** (`~/Library/Logs/EmployeeSafety/`):
   ```bash
   grep -i "hot.*update\|热更新" ~/Library/Logs/EmployeeSafety/*.log
   ```

   查找：
   - `[CHECK] Trying hot update first`
   - `[CHECK] Hot update available` 或 `[CHECK] Full update required`
   - `hotUpdateEnabled` 配置值

2. **全量更新日志**:
   ```bash
   grep -i "quitAndInstall\|update.*downloaded" ~/Library/Logs/EmployeeSafety/auto-update.log
   ```

   查找：
   - `[AUTO_UPDATE] 正在调用 quitAndInstall()...`
   - `[AUTO_UPDATE] quitAndInstall() 调用成功` 或错误信息

3. **electron-updater 日志**:
   ```bash
   cat ~/Library/Logs/EmployeeSafety/auto-update.log | grep -A5 "update-downloaded"
   ```

---

## 解决方案

### 方案 1: 修复热更新跳过问题

**问题**: 即使判断应该用热更新，仍会执行全量更新检测

**修复**: `src/common/services/auto-update-service.ts:350-428`

```typescript
async checkForUpdates(): Promise<void> {
  if (this.isChecking) {
    updateLogger.debug('Update check already in progress');
    return;
  }

  if (this.downloadInProgress) {
    updateLogger.debug('Download in progress, skipping update check');
    return;
  }

  try {
    this.isChecking = true;

    // 1. 优先尝试热更新
    if (this.hotUpdateService) {
      updateLogger.info('[CHECK] Trying hot update first');

      const updateInfo = await this.hotUpdateService.checkForUpdates();

      if (updateInfo?.hasUpdate && updateInfo.updateType === 'hot' && updateInfo.manifest) {
        // 发现热更新
        updateLogger.info(`[CHECK] Hot update available: ${updateInfo.version}`);

        const success = await this.hotUpdateService.downloadAndApply(updateInfo.manifest);

        if (success) {
          // 热更新成功,提示用户重启
          updateLogger.info('[CHECK] Hot update successful, prompting restart');
          this.promptUserToRestart(updateInfo.manifest.version, updateInfo);
          return; // ✅ 成功后直接返回，不执行全量更新
        }

        // 热更新失败,继续完整更新
        updateLogger.warn('[CHECK] Hot update failed, fallback to full update');
      }

      if (updateInfo?.updateType === 'full') {
        // 服务端明确要求全量更新
        updateLogger.info('[CHECK] Full update required:', updateInfo.reason);
      } else if (updateInfo?.updateType === 'hot') {
        // 热更新可用但未成功，记录原因
        updateLogger.warn('[CHECK] Hot update available but failed to apply');
      } else {
        // 服务端返回无更新或未知类型
        updateLogger.info('[CHECK] No hot update available from server');
      }
    } else {
      updateLogger.info('[CHECK] Hot update service not available, using full update');
    }

    // 2. 完整更新流程 (只在热更新不可用或失败时执行)
    const feedURL = `${this.apiClient.getBaseURL()}?deviceId=${this.deviceId}`;
    updateLogger.info('[CHECK] Starting full update check', {
      currentVersion: app.getVersion(),
      feedURL,
      deviceId: this.deviceId,
      channel: this.channel,
      timestamp: new Date().toISOString()
    });

    const result = await autoUpdater.checkForUpdates();

    if (result) {
      updateLogger.info('[CHECK] Update check completed', {
        updateInfo: result.updateInfo,
        hasUpdate: result.updateInfo.version !== app.getVersion()
      });
    }
  } catch (error: any) {
    updateLogger.error('[CHECK] Failed to check for updates', {
      error: error.message,
      stack: error.stack,
      feedURL: `${this.apiClient.getBaseURL()}?deviceId=${this.deviceId}`
    });
    throw error;
  } finally {
    this.isChecking = false;
  }
}
```

**关键改动**:
- 热更新成功后 `return`，不继续执行全量更新
- 增加日志区分不同情况
- 明确只在必要时执行全量更新

### 方案 2: 修复全量更新不重启问题

**问题**: `quitAndInstall()` 调用后应用未重启

**临时解决方案** - 增加错误处理和备用重启：

`src/common/services/auto-update-service.ts:455-476`

```typescript
async quitAndInstall(isSilent: boolean = false, isForceRunAfter: boolean = true): Promise<void> {
  try {
    updateLogger.info('Preparing to quit and install update', {
      isSilent,
      isForceRunAfter,
      platform: process.platform
    });

    // Save application state before quitting
    await this.saveApplicationState();

    // Report installing status
    this.reportUpdateStatus(UpdateStatus.INSTALLING);

    // 尝试 electron-updater 的方法
    try {
      updateLogger.info('Calling autoUpdater.quitAndInstall()...');
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
      updateLogger.info('autoUpdater.quitAndInstall() called successfully');

      // 如果5秒后还没退出，说明可能失败了
      setTimeout(() => {
        updateLogger.error('Application did not quit after quitAndInstall(), forcing restart');
        app.relaunch();
        app.exit(0);
      }, 5000);

    } catch (quitError: any) {
      updateLogger.error('autoUpdater.quitAndInstall() failed, using fallback', {
        error: quitError.message
      });

      // 备用方案：强制重启
      app.relaunch();
      app.exit(0);
    }
  } catch (error: any) {
    updateLogger.error('Failed to quit and install', error);
    throw error;
  }
}
```

**关键改动**:
- 添加平台信息日志
- 捕获 `quitAndInstall()` 可能的错误
- 5秒超时后强制重启（备用方案）
- 如果 `quitAndInstall()` 失败，直接重启应用

**长期解决方案** - 使用 macOS 脚本安装（已实现）:

`electron/auto-update-integration.js:454-542` 已经实现了 `executeAutoInstall()`，通过脚本绕过 Squirrel.Mac 签名验证。

检查是否正常工作：
```bash
# 检查脚本是否存在
ls -la /Applications/EmployeeSafety.app/Contents/Resources/installer-scripts/auto-install-update-macos.sh

# 检查脚本权限
chmod +x /Applications/EmployeeSafety.app/Contents/Resources/installer-scripts/auto-install-update-macos.sh
```

### 方案 3: 检查配置文件

**检查热更新是否启用**:

```bash
# 读取配置文件
cat ~/Library/Application\ Support/EmployeeSafety/config.json | grep hotUpdate

# 或检查数据库（如果使用 electron-store）
cat ~/Library/Application\ Support/EmployeeSafety/config.json | python3 -m json.tool | grep -A2 -B2 hotUpdate
```

**期望配置**:
```json
{
  "hotUpdateEnabled": true,
  "updateEnabled": true,
  "updateAutoDownload": true,
  "updateChannel": "stable"
}
```

如果 `hotUpdateEnabled: false`，修改为 `true`。

---

## 测试验证

### 验证修复后的行为

**测试 1: 热更新流程**
1. 修改代码后构建 v1.0.156
2. 服务端配置 1.0.155 → 1.0.156 差异包
3. 启动 v1.0.155
4. 检查日志应出现：
   ```
   [CHECK] Trying hot update first
   [CHECK] Hot update available: 1.0.156
   [HotUpdate] 开始热更新流程
   [HotUpdate] 备份完成
   [HotUpdate] 应用差异成功
   [HotUpdate] 创建 app.asar.new 成功
   [PROMPT] User chose to restart
   ```
5. 点击重启后，应用重启并安装更新
6. 验证版本为 1.0.156

**测试 2: 全量更新流程**
1. 服务端不提供差异包（或禁用热更新）
2. 应直接下载全量包
3. 下载完成后点击"立即重启"
4. 检查日志应出现：
   ```
   [AUTO_UPDATE] 正在调用 quitAndInstall()...
   [AUTO_UPDATE] quitAndInstall() 调用成功
   ```
5. 应用应在5秒内退出并重启
6. 验证版本已更新

**测试 3: 重启失败备用方案**
1. 如果 `quitAndInstall()` 失败
2. 应在5秒后看到：
   ```
   [ERROR] Application did not quit after quitAndInstall(), forcing restart
   ```
3. 应用应强制重启

---

## 现场调试步骤

### 步骤 1: 收集日志
```bash
# 压缩所有日志
tar -czf update-logs-$(date +%Y%m%d-%H%M%S).tar.gz \
  ~/Library/Logs/EmployeeSafety/ \
  ~/Library/Application\ Support/EmployeeSafety/config.json

# 查看最近的更新日志
tail -100 ~/Library/Logs/EmployeeSafety/auto-update.log
```

### 步骤 2: 检查文件系统状态
```bash
# 检查 ASAR 文件
ls -lah /Applications/EmployeeSafety.app/Contents/Resources/ | grep asar

# 期望输出：
# -rw-r--r--  app.asar
# (可能有) -rw-r--r--  app.asar.backup
# (可能有) -rw-r--r--  app.asar.new

# 检查下载缓存
ls -lah ~/Library/Caches/employee-safety-client/pending/
```

### 步骤 3: 手动触发更新
```bash
# 打开应用并手动检查更新
# 在界面点击"检查更新"
# 观察控制台输出和日志文件
```

---

## 相关文件清单

| 文件路径 | 修改内容 | 说明 |
|---------|---------|------|
| `src/common/services/auto-update-service.ts:350-428` | 修复热更新判断逻辑 | 热更新成功后不再执行全量更新 |
| `src/common/services/auto-update-service.ts:455-476` | 增加重启错误处理 | 添加备用重启方案和超时机制 |
| `electron/auto-update-integration.js:547-595` | 保持现有逻辑 | 全量更新重启逻辑正确，无需修改 |
| `electron/main-minimal.js:15-60` | 保持现有逻辑 | 热更新安装逻辑正确，无需修改 |

---

## 下一步行动

### 立即执行
1. ✅ 收集当前环境的完整日志
2. ✅ 检查配置文件中的 `hotUpdateEnabled` 设置
3. ✅ 验证服务端是否配置了差异包

### 代码修复
1. 🔧 应用方案 1: 修复热更新跳过问题
2. 🔧 应用方案 2: 增加全量更新重启的错误处理
3. 🔧 构建 v1.0.156 进行测试

### 测试验证
1. 🧪 测试热更新流程 (1.0.155 → 1.0.156)
2. 🧪 测试全量更新流程
3. 🧪 测试重启失败的备用方案

---

**报告完成时间**: 2025-12-22
**下次审查**: 修复后验证测试结果
