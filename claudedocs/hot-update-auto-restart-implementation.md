# 热更新自动重启和自动启动实施总结

## 实施完成时间
2025-12-24

## 实施方案
方案一：启动标志位法

---

## 代码修改

### 1. 修改 `src/common/services/auto-update-service.ts`

#### 添加 `setAutoStartFlag()` 方法 (line 766-788)

```typescript
/**
 * 设置自动启动标志文件
 * 在热更新完成后重启前调用，用于标记应用在重启后自动启动服务
 */
private setAutoStartFlag(): void {
  try {
    const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');
    const flagData = {
      timestamp: Date.now(),
      version: app.getVersion()
    };

    fs.writeFileSync(flagPath, JSON.stringify(flagData), 'utf-8');
    getUpdateLogger().info('[AUTO_START_FLAG] Flag file created', {
      path: flagPath,
      data: flagData
    });
  } catch (error: any) {
    getUpdateLogger().error('[AUTO_START_FLAG] Failed to create flag file', {
      error: error.message
    });
  }
}
```

**功能**:
- 创建标志文件: `~/Library/Application Support/EmployeeSafety/auto-start-after-update.flag`
- 写入时间戳和版本号用于验证
- 记录创建日志便于调试

---

#### 修改 `promptUserToRestart()` 方法 (line 790-822)

**原逻辑**: 显示对话框 → 用户点击"立即重启" → 重启应用

**新逻辑**: 写入标志文件 → 延迟1秒 → 自动重启

```typescript
/**
 * 提示用户重启应用（增强版：支持版本类型和强制更新）
 * ⚠️ 已修改为自动重启模式：热更新完成后自动重启，无需用户确认
 */
private promptUserToRestart(version: string, updateInfo?: CheckUpdateResponse): void {
  try {
    const isForceUpdate = updateInfo?.isForceUpdate || false;
    const versionChangeType = updateInfo?.versionChangeType || 'patch';
    const currentVersion = updateInfo?.currentVersion || app.getVersion();

    getUpdateLogger().info('[AUTO_RESTART] Hot update downloaded, preparing auto-restart', {
      fromVersion: currentVersion,
      toVersion: version,
      versionChangeType,
      isForceUpdate
    });

    // 1️⃣ 设置自动启动标志文件
    this.setAutoStartFlag();

    // 2️⃣ 延迟1秒后自动重启（确保标志文件写入完成）
    setTimeout(() => {
      getUpdateLogger().info('[AUTO_RESTART] Restarting application...');
      app.relaunch();
      app.quit();
    }, 1000);

  } catch (error: any) {
    getUpdateLogger().error('[AUTO_RESTART] Failed to restart application', {
      error: error.message
    });
  }
}
```

**关键改动**:
- ✅ 移除用户交互对话框
- ✅ 调用 `setAutoStartFlag()` 写入标志
- ✅ 延迟1秒确保文件写入完成
- ✅ 自动执行 `app.relaunch()` 和 `app.quit()`

---

### 2. 修改 `electron/main-minimal.js`

#### 添加 `checkAndAutoStartAfterUpdate()` 函数 (line 1855-1923)

```javascript
/**
 * 检查热更新后自动启动标志
 * 如果检测到标志文件，说明刚完成热更新重启，需要自动启动服务
 */
async function checkAndAutoStartAfterUpdate() {
    try {
        const fs = require('fs');
        const path = require('path');
        const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');

        console.log('[AUTO_START] Checking for update flag:', flagPath);

        if (fs.existsSync(flagPath)) {
            console.log('[AUTO_START] ✅ Update flag detected!');

            // 读取标志文件内容
            let flagData = null;
            try {
                const flagContent = fs.readFileSync(flagPath, 'utf-8');
                flagData = JSON.parse(flagContent);
                console.log('[AUTO_START] Flag data:', flagData);
            } catch (parseError) {
                console.warn('[AUTO_START] Failed to parse flag data:', parseError.message);
            }

            // ⏰ 时间戳验证（5分钟内有效，防止标志文件残留）
            if (flagData && flagData.timestamp) {
                const age = Date.now() - flagData.timestamp;
                const maxAge = 5 * 60 * 1000; // 5分钟

                if (age > maxAge) {
                    console.log('[AUTO_START] ⚠️ Flag expired (age:', age, 'ms), ignoring');
                    fs.unlinkSync(flagPath);
                    console.log('[AUTO_START] Expired flag file deleted');
                    return;
                }

                console.log('[AUTO_START] Flag is valid (age:', age, 'ms)');
            }

            // 立即删除标志文件（避免下次启动重复触发）
            fs.unlinkSync(flagPath);
            console.log('[AUTO_START] ✅ Flag file deleted');

            // ⏰ 延迟启动（等待应用完全初始化）
            setTimeout(async () => {
                console.log('[AUTO_START] ⏰ Triggering auto-start after hot update...');
                sendLogToRenderer('[自动启动] 检测到热更新完成，正在自动启动服务...');

                try {
                    // 🎯 调用启动服务逻辑（与点击启动按钮完全相同）
                    const result = await startAppService(false); // false = 自动启动模式

                    if (result && result.success) {
                        console.log('[AUTO_START] ✅ Service auto-started successfully after update');
                        sendLogToRenderer('[自动启动] 服务已自动启动成功');
                    } else {
                        console.error('[AUTO_START] ❌ Auto-start failed:', result?.message);
                        sendLogToRenderer('[自动启动] 服务自动启动失败: ' + (result?.message || '未知错误'), 'error');
                    }
                } catch (error) {
                    console.error('[AUTO_START] ❌ Auto-start exception:', error.message);
                    sendLogToRenderer('[自动启动] 服务自动启动异常: ' + error.message, 'error');
                }
            }, 3000); // 延迟3秒，确保FSM、网络检查等都完成

        } else {
            console.log('[AUTO_START] No update flag detected, normal startup');
        }
    } catch (error) {
        console.error('[AUTO_START] ❌ Error checking update flag:', error.message);
    }
}
```

**关键功能**:
1. ✅ 检测标志文件存在性
2. ✅ 读取并验证标志内容
3. ✅ 时间戳验证（5分钟内有效）
4. ✅ 立即删除标志文件（防止重复触发）
5. ✅ 延迟3秒后调用 `startAppService(false)` 自动启动
6. ✅ 详细日志记录便于调试
7. ✅ 向UI发送提示消息

---

#### 在 `app.whenReady()` 中调用检测函数 (line 430-431)

```javascript
// ✅ 检测热更新后自动启动标志
checkAndAutoStartAfterUpdate();
```

**位置**: 在最小化启动检测之后，加载主应用模块之前

**时序**:
```
app.whenReady()
  → 创建窗口、托盘
  → 注册IPC处理器
  → 初始化更新系统
  → 检测最小化启动
  → ✅ 检测热更新标志 (新增)
  → 加载主应用模块
```

---

## 完整流程

### 热更新下载完成 → 自动重启

```
1. 热更新下载完成
   ↓
2. HotUpdateService 触发 'update-ready' 事件
   ↓
3. AutoUpdateService.promptUserToRestart() 被调用
   ↓
4. setAutoStartFlag() 写入标志文件
   ↓
5. 延迟1秒
   ↓
6. app.relaunch() + app.quit() → 应用重启
```

**标志文件路径**: `~/Library/Application Support/EmployeeSafety/auto-start-after-update.flag`

**标志文件内容**:
```json
{
  "timestamp": 1735034567890,
  "version": "1.0.1"
}
```

---

### 应用重启 → 自动启动服务

```
1. 应用重启
   ↓
2. app.whenReady() 回调执行
   ↓
3. 初始化窗口、托盘、IPC等
   ↓
4. checkAndAutoStartAfterUpdate() 被调用
   ↓
5. 检测到标志文件存在
   ↓
6. 验证时间戳（< 5分钟）
   ↓
7. 删除标志文件
   ↓
8. 延迟3秒
   ↓
9. startAppService(false) → 自动启动监控服务 ✅
```

---

## 安全机制

### 1. 时间戳验证
```javascript
const age = Date.now() - flagData.timestamp;
const maxAge = 5 * 60 * 1000; // 5分钟

if (age > maxAge) {
    fs.unlinkSync(flagPath);
    return; // 忽略过期标志
}
```

**防止**: 标志文件残留导致每次启动都自动启动

---

### 2. 立即删除标志
```javascript
fs.unlinkSync(flagPath); // 读取后立即删除
```

**防止**: 重复触发自动启动

---

### 3. 尊重手动暂停标志
```javascript
const result = await startAppService(false); // false = 自动启动模式
```

在 `startAppService()` 内部:
```javascript
if (!isManualStart && manuallyPaused) {
    return { success: false, message: 'Automatic start blocked due to manual pause' };
}
```

**防止**: 覆盖用户手动停止服务的意愿

---

### 4. 延迟启动
```javascript
setTimeout(async () => {
    await startAppService(false);
}, 3000); // 延迟3秒
```

**确保**: FSM状态机、网络连接、权限检查等都初始化完成

---

## 测试验证步骤

### 手动测试标志文件机制

#### 1. 手动创建标志文件
```bash
# macOS
echo '{"timestamp":'$(date +%s000)',"version":"1.0.1"}' > ~/Library/Application\ Support/EmployeeSafety/auto-start-after-update.flag

# 检查文件是否创建成功
cat ~/Library/Application\ Support/EmployeeSafety/auto-start-after-update.flag
```

#### 2. 启动应用
```bash
npm run electron:dev
# 或打包后的应用
open release/EmployeeSafety-darwin-arm64/EmployeeSafety.app
```

#### 3. 观察日志

**预期日志**:
```
[AUTO_START] Checking for update flag: /Users/.../Library/Application Support/EmployeeSafety/auto-start-after-update.flag
[AUTO_START] ✅ Update flag detected!
[AUTO_START] Flag data: { timestamp: 1735034567890, version: '1.0.1' }
[AUTO_START] Flag is valid (age: 123 ms)
[AUTO_START] ✅ Flag file deleted
[AUTO_START] ⏰ Triggering auto-start after hot update...
[AUTO_START] ✅ Service auto-started successfully after update
```

#### 4. 验证标志文件已删除
```bash
ls ~/Library/Application\ Support/EmployeeSafety/auto-start-after-update.flag
# 应该显示: No such file or directory
```

#### 5. 验证服务已启动
- UI显示"运行中"状态
- 托盘图标变为绿色
- 检查日志确认监控服务启动

---

### 完整热更新流程测试

#### 前提条件
1. 后端已部署新版本（如1.0.2）
2. 客户端运行旧版本（如1.0.1）
3. 服务正在运行中

#### 测试步骤

1️⃣ **触发热更新检查**
```bash
# 在应用UI中点击"检查更新"按钮
# 或等待自动检查（每2分钟）
```

2️⃣ **观察下载进度**
- UI显示下载进度条
- 日志显示下载详情

3️⃣ **下载完成后自动重启**
- 无需用户点击对话框
- 应用自动重启（1秒后）

4️⃣ **重启后自动启动服务**
- 应用重启
- 延迟3秒后自动启动
- UI显示"运行中"状态

5️⃣ **验证版本更新成功**
```bash
# 检查应用版本
# macOS: EmployeeSafety.app/Contents/Info.plist
# 或在应用UI中查看版本号
```

---

### 日志关键字

**热更新下载完成**:
```
[AUTO_RESTART] Hot update downloaded, preparing auto-restart
[AUTO_START_FLAG] Flag file created
[AUTO_RESTART] Restarting application...
```

**应用重启后检测**:
```
[AUTO_START] Checking for update flag
[AUTO_START] ✅ Update flag detected!
[AUTO_START] Flag is valid
[AUTO_START] ✅ Flag file deleted
```

**自动启动服务**:
```
[AUTO_START] ⏰ Triggering auto-start after hot update...
[START] Starting service (manual: false, manuallyPaused: false)
[AUTO_START] ✅ Service auto-started successfully after update
```

---

## 常见问题排查

### 问题 1: 标志文件创建失败

**症状**: 热更新后重启，但服务未自动启动

**检查**:
```bash
# 检查标志文件是否存在
ls ~/Library/Application\ Support/EmployeeSafety/auto-start-after-update.flag
```

**原因**:
- 权限不足
- 磁盘空间不足
- userData 路径错误

**解决**:
- 检查应用日志中 `[AUTO_START_FLAG]` 相关错误
- 确认 `app.getPath('userData')` 返回正确路径

---

### 问题 2: 标志文件未删除

**症状**: 每次启动都自动启动服务

**检查**:
```bash
cat ~/Library/Application\ Support/EmployeeSafety/auto-start-after-update.flag
```

**原因**:
- `fs.unlinkSync()` 失败
- 权限不足

**解决**:
- 手动删除标志文件
- 检查文件权限

---

### 问题 3: 时间戳过期

**症状**: 标志文件存在，但未触发自动启动

**检查日志**:
```
[AUTO_START] ⚠️ Flag expired (age: 600000 ms), ignoring
```

**原因**:
- 标志文件创建时间超过5分钟

**解决**:
- 正常情况，重启应在1秒内完成，不会超时
- 如果经常超时，检查系统性能或增加超时时间

---

### 问题 4: 服务未自动启动

**症状**: 标志文件正确，但服务启动失败

**检查日志**:
```
[AUTO_START] ❌ Auto-start failed: ...
[START] Blocked automatic start due to manual pause flag
```

**原因**:
- `manuallyPaused` 标志为 `true`
- FSM状态机初始化失败
- 网络连接问题

**解决**:
- 检查 `manuallyPaused` 标志状态
- 确认FSM状态机正常初始化
- 检查网络连接

---

## 代码位置总结

| 修改项 | 文件 | 行号 | 说明 |
|--------|------|------|------|
| **标志文件写入** | `src/common/services/auto-update-service.ts` | 766-788 | `setAutoStartFlag()` 方法 |
| **自动重启逻辑** | `src/common/services/auto-update-service.ts` | 790-822 | `promptUserToRestart()` 修改 |
| **检测函数** | `electron/main-minimal.js` | 1855-1923 | `checkAndAutoStartAfterUpdate()` |
| **调用检测** | `electron/main-minimal.js` | 430-431 | `app.whenReady()` 内调用 |

---

## 后续优化建议

### 1. 添加用户通知
```javascript
// 在自动启动前显示系统通知
const { Notification } = require('electron');
new Notification({
    title: '应用已更新',
    body: '正在自动启动服务...'
}).show();
```

### 2. 添加配置选项
```typescript
// 允许用户选择是否自动重启
interface AutoUpdateConfig {
    autoRestart: boolean; // 默认true
    autoStartAfterUpdate: boolean; // 默认true
}
```

### 3. 统计上报
```typescript
// 记录自动重启和自动启动成功率
analytics.track('auto-restart-after-update', {
    fromVersion: oldVersion,
    toVersion: newVersion,
    success: true
});
```

---

## 总结

✅ **已完成**:
1. 热更新下载完成后自动重启（无需用户确认）
2. 应用重启后自动启动监控服务
3. 完整的安全机制和错误处理
4. 详细日志便于调试

✅ **关键优化**:
- 移除用户交互对话框，提升用户体验
- 标志文件机制可靠且易于调试
- 时间戳验证防止标志残留
- 尊重用户手动暂停意愿

✅ **测试验证**:
- TypeScript编译通过
- 逻辑流程完整
- 待实际热更新场景验证

🎯 **下一步**: 在测试环境触发实际热更新，验证完整流程
