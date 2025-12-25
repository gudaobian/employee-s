# 热更新自动重启和自动启动服务分析

## 概览

**目标**: 热更新下载完成后自动重启应用,并在重启后自动点击"启动服务"按钮

**当前行为**:
- ✅ 热更新下载完成后显示对话框
- ⚠️ 用户点击"立即重启"按钮后重启
- ❌ 重启后需要手动点击"启动"按钮才能开始监控

**期望行为**:
- ✅ 热更新下载完成后自动重启(无需用户点击对话框)
- ✅ 重启后自动调用启动服务逻辑,无需手动点击

---

## 核心流程分析

### 1. UI层 - 启动按钮

**文件**: `electron/renderer/minimal-index.html`

**启动按钮定义** (line 651):
```html
<button class="btn-toggle stopped" id="toggleButton" onclick="toggleService()">启动</button>
```

**toggleService()函数** (lines 892-977):
```javascript
async function toggleService() {
    // ... 防重复点击逻辑 ...

    if (isRunning) {
        // 停止服务
        const result = await window.electronAPI.app.stop();
    } else {
        // 启动服务
        const result = await window.electronAPI.app.start(); // ⬅️ 关键调用

        if (result && (result.success === true || result.alreadyRunning === true)) {
            isRunning = true;
            updateStatus('运行中', true);
        }
    }
}
```

**关键发现**:
- 启动按钮实际调用: `window.electronAPI.app.start()`
- 这是一个异步IPC调用,返回结果包含 `success` 或 `alreadyRunning` 字段

---

### 2. 预加载层 - IPC桥接

**文件**: `electron/preload-js.js`

**electronAPI定义** (line 12):
```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  app: {
    start: () => ipcRenderer.invoke('app:start'),  // ⬅️ IPC通道名称
    stop: () => ipcRenderer.invoke('app:stop'),
    restart: () => ipcRenderer.invoke('app:restart'),
    getStatus: () => ipcRenderer.invoke('app:getStatus')
  },
  // ...
});
```

**关键发现**:
- IPC通道名称: `'app:start'`
- 使用 `ipcRenderer.invoke()` 双向通信(有返回值)

---

### 3. 主进程层 - IPC处理

**文件**: `electron/main-minimal.js`

**IPC Handler注册** (line 1416):
```javascript
ipcMain.handle('app:start', async () => {
    return await startAppService(true); // ⬅️ true = manual user start
});
```

**startAppService()函数** (lines 1845-1900+):
```javascript
async function startAppService(isManualStart = false) {
    sendLogToRenderer('正在启动服务...');

    // 如果是手动启动,清除手动暂停标志
    if (isManualStart) {
        manuallyPaused = false;
        console.log('[START] Manual start - clearing manuallyPaused flag');
    } else {
        // 如果是自动启动,检查手动暂停标志
        if (manuallyPaused) {
            console.log('[START] Blocked automatic start due to manual pause flag');
            return { success: false, message: 'Automatic start blocked due to manual pause' };
        }
    }

    if (app_instance) {
        // 检查是否已经在运行
        let monitoringState = app_instance.getMonitoringState();

        // ... 状态检查逻辑 ...

        // 启动监控
        await app_instance.startMonitoring();

        // 更新托盘图标和菜单
        updateTrayIcon(true);
        updateTrayMenu();

        return { success: true, message: 'Service started successfully' };
    }

    return { success: false, message: 'App instance not available' };
}
```

**关键发现**:
- `isManualStart` 参数区分手动启动和自动启动
- 手动启动: `isManualStart=true` (清除暂停标志,强制启动)
- 自动启动: `isManualStart=false` (受 `manuallyPaused` 标志控制)
- 核心逻辑: 调用 `app_instance.startMonitoring()`

---

### 4. 热更新重启流程

**文件**: `src/common/services/auto-update-service.ts`

**重启触发点** (lines 804-805):
```typescript
app.relaunch(); // 重启应用
app.quit();     // 退出当前进程
```

**完整的重启提示逻辑** (line 769):
```typescript
private promptUserToRestart(version: string, updateInfo?: CheckUpdateResponse): void {
    const mainWindow = BrowserWindow.getAllWindows()[0];

    // 显示对话框
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '更新已就绪',
        message: `版本 ${version} 已下载完成`,
        detail: '点击"立即重启"应用更新',
        buttons: ['立即重启', '稍后重启']
    }).then((result) => {
        if (result.response === 0) { // 用户点击"立即重启"
            getUpdateLogger().info('[PROMPT] User chose to restart');
            app.relaunch();  // ⬅️ 重启应用
            app.quit();      // ⬅️ 退出
        } else {
            getUpdateLogger().info('[PROMPT] User postponed restart');
        }
    });
}
```

**关键发现**:
- 当前需要用户点击对话框"立即重启"按钮
- 重启后应用从头开始初始化(main-minimal.js 的 app.whenReady())
- 没有自动启动服务的逻辑

---

## 实现方案设计

### 方案一: 启动标志位法 (推荐)

**核心思路**: 在重启前设置持久化标志,重启后检测标志自动启动

#### 实现步骤:

**步骤 1: 修改热更新重启逻辑**

文件: `src/common/services/auto-update-service.ts` (line 804)

```typescript
private promptUserToRestart(version: string, updateInfo?: CheckUpdateResponse): void {
    // ... 对话框代码 ...

    // ✅ 方案一(推荐): 跳过对话框,直接重启
    getUpdateLogger().info('[AUTO_RESTART] Hot update downloaded, auto-restarting...');

    // 1️⃣ 设置启动标志 (持久化到文件)
    this.setAutoStartFlag();

    // 2️⃣ 立即重启
    setTimeout(() => {
        app.relaunch();
        app.quit();
    }, 1000); // 延迟1秒确保标志文件写入完成
}

/**
 * 设置自动启动标志文件
 */
private setAutoStartFlag(): void {
    try {
        const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');
        fs.writeFileSync(flagPath, JSON.stringify({
            timestamp: Date.now(),
            version: app.getVersion()
        }), 'utf-8');
        getUpdateLogger().info('[AUTO_START_FLAG] Flag file created:', flagPath);
    } catch (error: any) {
        getUpdateLogger().error('[AUTO_START_FLAG] Failed to create flag:', error);
    }
}
```

**步骤 2: 应用启动时检测标志并自动启动**

文件: `electron/main-minimal.js` (在 app.whenReady() 内添加)

```javascript
app.whenReady().then(async () => {
    // ... 现有初始化代码 ...

    // ✅ 检测热更新后自动启动标志
    checkAndAutoStartAfterUpdate();
});

/**
 * 检查热更新后自动启动标志
 */
async function checkAndAutoStartAfterUpdate() {
    try {
        const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');

        if (fs.existsSync(flagPath)) {
            console.log('[AUTO_START] Detected update flag, will auto-start service...');

            // 读取标志内容(可选,用于日志记录)
            const flagContent = fs.readFileSync(flagPath, 'utf-8');
            const flagData = JSON.parse(flagContent);
            console.log('[AUTO_START] Flag data:', flagData);

            // 删除标志文件(避免下次启动时重复触发)
            fs.unlinkSync(flagPath);
            console.log('[AUTO_START] Flag file deleted');

            // ⏰ 延迟启动(等待应用完全初始化)
            setTimeout(async () => {
                console.log('[AUTO_START] Triggering auto-start...');

                // 🎯 直接调用启动服务逻辑(与点击按钮完全相同)
                const result = await startAppService(false); // false = 自动启动

                if (result && result.success) {
                    console.log('[AUTO_START] ✅ Service auto-started successfully');
                } else {
                    console.error('[AUTO_START] ❌ Auto-start failed:', result?.message);
                }
            }, 3000); // 延迟3秒,确保FSM、网络检查等都完成
        } else {
            console.log('[AUTO_START] No update flag detected, normal startup');
        }
    } catch (error) {
        console.error('[AUTO_START] Error checking flag:', error);
    }
}
```

**关键要点**:
1. **标志文件路径**: `app.getPath('userData')/auto-start-after-update.flag`
2. **写入时机**: 热更新下载完成,调用 `app.relaunch()` 之前
3. **读取时机**: 应用重启后,`app.whenReady()` 内初始化完成后
4. **自动清理**: 读取后立即删除标志文件,避免重复触发
5. **启动参数**: 传入 `isManualStart=false` (自动启动模式)
6. **延迟启动**: 等待3秒确保FSM状态机、网络检查等初始化完成

---

### 方案二: 命令行参数法

**核心思路**: 重启时传入命令行参数,启动时检测参数

#### 实现步骤:

**步骤 1: 修改重启逻辑传入参数**

文件: `src/common/services/auto-update-service.ts`

```typescript
private promptUserToRestart(version: string, updateInfo?: CheckUpdateResponse): void {
    getUpdateLogger().info('[AUTO_RESTART] Hot update downloaded, restarting with auto-start flag...');

    // 重启时传入命令行参数
    app.relaunch({ args: process.argv.slice(1).concat(['--auto-start-after-update']) });
    app.quit();
}
```

**步骤 2: 启动时检测参数**

文件: `electron/main-minimal.js`

```javascript
app.whenReady().then(async () => {
    // ... 现有初始化 ...

    // 检测命令行参数
    if (process.argv.includes('--auto-start-after-update')) {
        console.log('[AUTO_START] Detected --auto-start-after-update flag');

        setTimeout(async () => {
            const result = await startAppService(false);
            console.log('[AUTO_START] Result:', result);
        }, 3000);
    }
});
```

**优点**:
- 无需文件I/O操作
- 参数自动失效(不会持久化)

**缺点**:
- 如果用户手动启动应用(双击图标),参数会丢失
- macOS App重启机制可能不保留自定义参数

---

### 方案三: 使用渲染进程自动点击 (不推荐)

**思路**: 重启后在渲染进程加载时自动调用 `toggleService()`

**缺点**:
- 需要等待窗口创建和渲染进程加载(较慢)
- 依赖UI层,不够可靠
- 无法区分是否是热更新重启

**不推荐使用**

---

## 时序图

### 当前流程

```
热更新完成 → 显示对话框 → 用户点击"立即重启" → app.relaunch() → app.quit()
    ↓
应用重启 → main-minimal.js 初始化 → 创建窗口 → 渲染UI
    ↓
用户手动点击"启动"按钮 → toggleService() → IPC('app:start') → startAppService(true) → 开始监控
```

### 目标流程(方案一)

```
热更新完成 → 写入标志文件 → app.relaunch() → app.quit()
    ↓
应用重启 → main-minimal.js 初始化 → 检测标志文件存在
    ↓
删除标志文件 → 延迟3秒 → startAppService(false) → 自动开始监控 ✅
```

---

## 关键代码位置总结

| 组件 | 文件 | 关键函数/代码行 | 说明 |
|------|------|----------------|------|
| **UI启动按钮** | `electron/renderer/minimal-index.html` | `toggleService()` (line 892) | 用户点击启动按钮时调用 |
| **IPC桥接** | `electron/preload-js.js` | `app.start` (line 12) | 将UI调用转为IPC |
| **IPC处理** | `electron/main-minimal.js` | `ipcMain.handle('app:start')` (line 1416) | 接收IPC调用 |
| **启动逻辑** | `electron/main-minimal.js` | `startAppService(isManualStart)` (line 1845) | 核心启动服务函数 |
| **热更新重启** | `src/common/services/auto-update-service.ts` | `promptUserToRestart()` (line 769) | 显示重启对话框 |
| **重启执行** | `src/common/services/auto-update-service.ts` | `app.relaunch()` (line 804) | 实际重启应用 |
| **应用初始化** | `electron/main-minimal.js` | `app.whenReady()` | 应用启动入口 |

---

## 实现建议

### 推荐: 方案一 - 启动标志位法

**理由**:
1. ✅ 实现简单,逻辑清晰
2. ✅ 持久化可靠(文件系统)
3. ✅ 与现有代码兼容性好
4. ✅ 易于调试(可检查标志文件是否存在)
5. ✅ 支持延迟启动(等待初始化完成)

**待实现文件**:
- `src/common/services/auto-update-service.ts` (添加 `setAutoStartFlag()` 方法)
- `electron/main-minimal.js` (添加 `checkAndAutoStartAfterUpdate()` 函数)

**测试验证**:
1. 触发热更新下载
2. 下载完成后检查标志文件是否创建: `~/Library/Application Support/EmployeeSafety/auto-start-after-update.flag`
3. 应用自动重启
4. 检查日志确认自动启动触发: `[AUTO_START] Service auto-started successfully`
5. 确认标志文件已被删除
6. 验证监控服务正常运行

---

## 风险评估

### 潜在风险

1. **启动时机过早**
   - 风险: FSM状态机、网络连接等未初始化完成就启动服务
   - 缓解: 使用 `setTimeout(..., 3000)` 延迟启动

2. **标志文件残留**
   - 风险: 如果删除失败,每次启动都会自动启动
   - 缓解: 添加时间戳验证(只在5分钟内有效)

3. **用户手动暂停被覆盖**
   - 风险: 用户手动停止服务后,热更新重启自动启动
   - 缓解: 使用 `isManualStart=false`,尊重 `manuallyPaused` 标志

4. **多次重启触发**
   - 风险: 连续热更新导致多次自动启动
   - 缓解: 每次读取标志后立即删除

### 安全措施

```javascript
// 增强版标志文件验证
async function checkAndAutoStartAfterUpdate() {
    try {
        const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');

        if (fs.existsSync(flagPath)) {
            const flagData = JSON.parse(fs.readFileSync(flagPath, 'utf-8'));

            // ⏰ 时间戳验证(5分钟内有效)
            const age = Date.now() - flagData.timestamp;
            if (age > 5 * 60 * 1000) {
                console.log('[AUTO_START] Flag expired, ignoring');
                fs.unlinkSync(flagPath);
                return;
            }

            // 立即删除标志
            fs.unlinkSync(flagPath);

            // 延迟启动
            setTimeout(async () => {
                const result = await startAppService(false);
                console.log('[AUTO_START] Result:', result);
            }, 3000);
        }
    } catch (error) {
        console.error('[AUTO_START] Error:', error);
    }
}
```

---

## 总结

### 核心发现

1. **启动按钮实际调用**: `startAppService(true)` (通过IPC通道 `'app:start'`)
2. **自动启动关键**: 调用 `startAppService(false)` (自动模式,受 `manuallyPaused` 控制)
3. **热更新重启位置**: `auto-update-service.ts` 的 `promptUserToRestart()` 方法
4. **应用启动入口**: `main-minimal.js` 的 `app.whenReady()` 回调

### 下一步行动

1. ✅ 分析完成 (本文档)
2. ⏳ 等待用户确认方案
3. ⏳ 实现方案一代码修改
4. ⏳ 测试验证

---

**分析完成时间**: 2025-12-24
**分析人员**: Claude Code
