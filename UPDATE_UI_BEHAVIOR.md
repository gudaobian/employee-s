# 更新UI行为说明文档

## 修改版本

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| 1.0 | 2024-12-24 | 修改热更新和全量更新的UI显示行为 |

---

## 更新类型对比

| 更新类型 | 触发条件 | UI行为 | 重启方式 | 文件位置 |
|---------|---------|--------|---------|----------|
| **热更新（增量）** | Minor/Patch版本升级 | ✅ **后台运行，不弹窗** | 自动重启，窗口隐藏 | `auto-update-service.ts:424-430` |
| **全量更新** | Major版本升级 | ✅ **显示对话框** | 手动下载DMG/exe | `auto-update-service.ts:827-887` |

---

## 一、热更新（增量更新）- 后台运行

### 1.1 更新流程

```
1. 检测到热更新 (Minor/Patch版本)
   ├─ 后台下载差异包
   ├─ 后台应用更新
   └─ 设置自动启动标志

2. 自动重启应用
   ├─ 关闭当前进程
   ├─ 重新启动进程
   └─ ✅ 窗口强制隐藏（后台运行）

3. 自动启动服务
   ├─ 检测到热更新标志
   ├─ 自动启动监控服务
   └─ 删除标志文件
```

### 1.2 用户体验

- ❌ **不显示任何窗口**
- ❌ **不显示任何对话框**
- ❌ **不显示任何通知**
- ✅ **完全后台运行**
- ✅ **无感知更新**
- ✅ **自动重启服务**

### 1.3 代码实现

#### 自动重启逻辑

**文件**: `src/common/services/auto-update-service.ts:794-822`

```typescript
private promptUserToRestart(version: string, updateInfo?: CheckUpdateResponse): void {
  try {
    getUpdateLogger().info('[AUTO_RESTART] Hot update downloaded, preparing auto-restart');

    // 1️⃣ 设置自动启动标志文件
    this.setAutoStartFlag();

    // 2️⃣ 延迟1秒后自动重启（确保标志文件写入完成）
    setTimeout(() => {
      getUpdateLogger().info('[AUTO_RESTART] Restarting application...');
      app.relaunch();  // 重新启动应用
      app.quit();      // 退出当前进程
    }, 1000);

  } catch (error: any) {
    getUpdateLogger().error('[AUTO_RESTART] Failed to restart application', error);
  }
}
```

#### 窗口隐藏逻辑

**文件**: `electron/main-minimal.js:815-818`

```javascript
else if (isHotUpdateRestart) {
    // ✅ 热更新重启：强制隐藏窗口，后台运行
    mainWindow.hide();
    console.log('[STARTUP] 热更新重启检测到，窗口强制隐藏，后台运行');
}
```

**关键修改**：
- **修改前**：窗口"保持隐藏"（但如果之前是显示状态，可能仍然显示）
- **修改后**：调用 `mainWindow.hide()` **强制隐藏**窗口，确保后台运行

#### 自动启动标志检测

**文件**: `electron/main-minimal.js:1893-1978`

```javascript
function hasAutoStartFlag() {
  try {
    const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');

    if (!fs.existsSync(flagPath)) {
      return false;
    }

    // 读取标志文件
    const flagData = JSON.parse(fs.readFileSync(flagPath, 'utf-8'));
    console.log('[AUTO_START_CHECK] Flag file found:', flagData);

    return true;
  } catch (error) {
    console.error('[AUTO_START_CHECK] Error checking flag:', error);
    return false;
  }
}
```

---

## 二、全量更新 - 显示对话框

### 2.1 更新流程

```
1. 检测到全量更新 (Major版本)
   └─ 后端判定需要完整安装包

2. ✅ 显示对话框
   ├─ 标题: "🚀 重大版本更新"
   ├─ 内容: 版本信息 + 更新说明
   └─ 按钮: [下载更新] [稍后]

3. 用户操作
   ├─ 点击"下载更新" → 打开浏览器下载页面
   └─ 点击"稍后" → 关闭对话框，下次检测时再次提示
```

### 2.2 用户体验

- ✅ **显示对话框**
- ✅ **提示版本信息**
- ✅ **提供下载链接**
- ✅ **用户主动操作**
- ✅ **手动下载安装**

### 2.3 代码实现

**文件**: `src/common/services/auto-update-service.ts:827-887`

```typescript
private showManualDownloadNotification(updateInfo: CheckUpdateResponse & { downloadUrl?: string }): void {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0];

    if (!mainWindow) {
      getUpdateLogger().warn('[MANUAL_DOWNLOAD] No main window found');
      return;
    }

    const currentVersion = updateInfo.currentVersion || app.getVersion();
    const newVersion = updateInfo.version;
    const downloadUrl = updateInfo.downloadUrl || updateInfo.manifest?.fallbackFullUrl;

    const title = '🚀 重大版本更新';
    const message = `发现新版本 ${newVersion}`;
    const detail =
      `当前版本: ${currentVersion}\n` +
      `新版本: ${newVersion}\n\n` +
      '检测到重大版本更新，需要手动下载安装。\n\n' +
      '点击"下载更新"将打开浏览器下载页面。';

    // ✅ 显示对话框
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title,
      message,
      detail,
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then((result) => {
      if (result.response === 0) {
        // 用户选择下载
        const { shell } = require('electron');
        shell.openExternal(downloadUrl);
      } else {
        // 用户选择稍后
        getUpdateLogger().info('[MANUAL_DOWNLOAD] User postponed download');
      }
    });
  } catch (error: any) {
    getUpdateLogger().error('[MANUAL_DOWNLOAD] Failed to show download notification', error);
  }
}
```

**触发条件** (`auto-update-service.ts:438-446`):

```typescript
if (updateInfo?.updateType === 'full') {
  // 后端判定需要完整更新（通常是Major版本），提示用户手动下载DMG
  getUpdateLogger().info('[CHECK] Full update required (backend decision), prompting manual download', {
    currentVersion: updateInfo.currentVersion,
    newVersion: updateInfo.version,
    reason: updateInfo.reason
  });
  this.showManualDownloadNotification(updateInfo);
  return;
}
```

---

## 三、对比说明

### 3.1 更新判定逻辑

**后端判定**（推荐）:
```typescript
// 后端 API 返回
{
  "updateType": "hot",   // 热更新
  "updateType": "full"   // 全量更新
}
```

**前端判定**（备用）:
```typescript
// 版本号对比
const versionChangeType = getVersionChangeType(currentVersion, newVersion);

if (versionChangeType === 'major') {
  // Major版本变化 → 全量更新
  this.showManualDownloadNotification(updateInfo);
} else {
  // Minor/Patch变化 → 热更新
  await this.hotUpdateService.downloadAndApply(manifest);
}
```

### 3.2 窗口行为对比

| 场景 | 热更新 | 全量更新 |
|------|-------|---------|
| **更新检测** | 后台 | 后台 |
| **文件下载** | 后台 | 浏览器 |
| **应用更新** | 后台 | 手动安装 |
| **重启应用** | 自动，窗口隐藏 | 手动启动新版本 |
| **启动服务** | 自动 | 正常启动流程 |

### 3.3 用户感知对比

| 维度 | 热更新 | 全量更新 |
|------|-------|---------|
| **是否弹窗** | ❌ 不弹窗 | ✅ 弹窗 |
| **是否可见** | ❌ 完全后台 | ✅ 显示对话框 |
| **是否需要操作** | ❌ 无需操作 | ✅ 需要点击下载 |
| **更新速度** | ⚡ 快速（秒级） | 🐢 较慢（分钟级） |
| **网络占用** | 📦 小（差异包） | 📦 大（完整包） |

---

## 四、测试验证

### 4.1 热更新测试

**测试步骤**:
```bash
# 1. 准备环境
当前版本: v1.0.132
后端配置: Minor版本更新 (v1.0.133)

# 2. 触发更新
等待自动检测更新（或手动触发）

# 3. 验证行为
预期结果:
  ✅ 后台下载更新
  ✅ 不显示任何窗口
  ✅ 自动重启应用
  ✅ 重启后窗口仍隐藏
  ✅ 自动启动监控服务
  ✅ 托盘图标正常显示
```

**验证日志**:
```
[AUTO_RESTART] Hot update downloaded, preparing auto-restart
[AUTO_RESTART] Restarting application...
[STARTUP] 热更新重启检测到，窗口强制隐藏，后台运行
[自动启动] 检测到热更新完成，正在自动启动服务...
[自动启动] ✅ 服务启动成功
```

### 4.2 全量更新测试

**测试步骤**:
```bash
# 1. 准备环境
当前版本: v1.0.132
后端配置: Major版本更新 (v2.0.0)

# 2. 触发更新
等待自动检测更新（或手动触发）

# 3. 验证行为
预期结果:
  ✅ 显示对话框
  ✅ 标题: "🚀 重大版本更新"
  ✅ 显示版本信息
  ✅ 显示两个按钮: [下载更新] [稍后]
  ✅ 点击"下载更新"打开浏览器
  ✅ 点击"稍后"关闭对话框
```

**对话框内容**:
```
🚀 重大版本更新

发现新版本 2.0.0

当前版本: 1.0.132
新版本: 2.0.0

检测到重大版本更新，需要手动下载安装。

点击"下载更新"将打开浏览器下载页面。

[下载更新]  [稍后]
```

---

## 五、常见问题

### Q1: 热更新后窗口仍然显示怎么办？

**A**: 检查以下几点：
1. 确认是热更新重启（检查日志中是否有 `[STARTUP] 热更新重启检测到`）
2. 确认标志文件存在（`~/Library/Application Support/employee-safety-client/auto-start-after-update.flag`）
3. 确认代码已更新到最新版本（包含 `mainWindow.hide()` 调用）
4. 重新打包应用：`npm run pack:mac`

### Q2: 全量更新对话框没有显示怎么办？

**A**: 检查以下几点：
1. 确认后端返回 `updateType: "full"`
2. 确认主窗口存在（`BrowserWindow.getAllWindows()[0]` 不为空）
3. 检查日志中是否有 `[MANUAL_DOWNLOAD] Showing download notification`
4. 检查是否有对话框权限问题（macOS需要授权）

### Q3: 如何手动测试热更新流程？

**A**: 使用以下方法：
```bash
# 1. 创建标志文件
echo '{"timestamp":1703401200000,"version":"1.0.132"}' > ~/Library/Application\ Support/employee-safety-client/auto-start-after-update.flag

# 2. 重启应用
# 应该看到窗口隐藏，后台运行

# 3. 检查日志
cat ~/Library/Logs/employee-safety-client/main.log | grep "AUTO_START"
```

### Q4: 如何手动测试全量更新对话框？

**A**: 使用后端API强制返回全量更新：
```bash
# 修改后端响应（临时测试）
{
  "hasUpdate": true,
  "updateType": "full",
  "version": "2.0.0",
  "currentVersion": "1.0.132",
  "downloadUrl": "https://example.com/download.dmg"
}
```

---

## 六、修改文件清单

| 文件 | 修改内容 | 行号 |
|------|---------|------|
| `electron/main-minimal.js` | 热更新重启时强制隐藏窗口 | 815-818 |
| `src/common/services/auto-update-service.ts` | 热更新自动重启逻辑（已存在） | 794-822 |
| `src/common/services/auto-update-service.ts` | 全量更新显示对话框（已存在） | 827-887 |

---

## 七、总结

### 修改目标

✅ **热更新**：完全后台运行，不弹窗，不打扰用户
✅ **全量更新**：显示对话框，提示用户手动下载安装

### 实现方式

- **热更新**：通过 `mainWindow.hide()` 强制隐藏窗口
- **全量更新**：通过 `dialog.showMessageBox()` 显示对话框

### 用户体验提升

- ✅ 热更新无感知，不影响用户工作
- ✅ 全量更新有提示，用户主动控制
- ✅ 更新流程清晰，不会混淆
