# Phase 3 简化主进程实施计划

**目标**: 简化 main-minimal.js，只保留窗口管理和 IPC 处理器

**完成日期**: 2025-12-20

---

## 📋 当前问题分析

### main-minimal.js 当前结构（~1700行）

**保留的核心功能**:
1. ✅ 窗口创建和管理 (createMainWindow)
2. ✅ 系统托盘管理 (createTray)
3. ✅ ASAR 完整性检查
4. ✅ 自动更新集成
5. ✅ 日志管理器 (UnifiedLogManager)

**需要简化的复杂业务逻辑**:
1. ❌ EmployeeMonitorApp 初始化（250+ 行复杂逻辑）
2. ❌ startAppService/stopAppService（150+ 行状态管理）
3. ❌ 复杂的 IPC 处理器（调用 app_instance 的各种方法）
4. ❌ 主进程状态管理（currentState, manuallyPaused 等）

---

## 🎯 Phase 2 已完成的渲染进程服务

### 渲染进程服务需要的 IPC 接口

根据 Phase 2 的实现，渲染进程服务需要以下 IPC 支持：

#### 1. FSMService 需求
```javascript
// 监听事件
- 'fsm-state-changed' (event) → 主进程广播 FSM 状态变化
- 'device-status-changed' (event) → 主进程广播设备状态变化

// 调用方法
- window.electronAPI.invoke('fsm:getCurrentState') → 获取当前状态
- window.electronAPI.invoke('fsm:forceTransition', targetState) → 强制状态转换
```

#### 2. AuthService 需求
```javascript
// 目前是 mock 实现，不需要主进程 IPC
// 未来可能需要：
- window.electronAPI.invoke('auth:authenticate', credentials)
- window.electronAPI.invoke('auth:getToken')
```

#### 3. DataSyncService 需求
```javascript
// 调用方法
- window.electronAPI.invoke('system:syncData') → 触发数据同步
```

#### 4. RendererApp 需求
```javascript
// 配置管理
- window.electronAPI.invoke('get-config') → 获取应用配置
- window.electronAPI.invoke('get-device-id') → 获取设备 ID

// 监听事件
- 'pause-monitoring' (event) → 暂停监控
- 'resume-monitoring' (event) → 恢复监控
- 'config-updated' (event) → 配置更新
- 'reload-renderer' (event) → 热更新通知
```

---

## 🔧 简化策略

### 方案 A：完全移除 EmployeeMonitorApp（激进）

**优点**:
- 主进程极度精简
- 清晰的职责分离
- 快速热更新

**缺点**:
- 需要将所有业务逻辑迁移到渲染进程
- 可能影响安全性（敏感逻辑暴露）
- 工作量大

**风险**: 高 ⚠️

### 方案 B：保留 EmployeeMonitorApp，简化调用（保守）✅

**优点**:
- 保持现有架构不变
- 业务逻辑仍在主进程（安全）
- 工作量小
- 兼容性好

**缺点**:
- 主进程仍然较重
- 职责不够清晰

**风险**: 低 ✅

### 方案 C：混合模式（渐进）

**优点**:
- 逐步迁移业务逻辑
- 灵活性高
- 可以分阶段实施

**缺点**:
- 架构复杂
- 过渡期维护成本高

**风险**: 中等 ⚠️

---

## ✅ 选择方案 B：保留 EmployeeMonitorApp，简化调用

### 实施步骤

#### Step 1: 保留核心组件

```javascript
// main-minimal.js 保留的部分

// 1. 核心依赖
const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const UnifiedLogManager = require('./unified-log-manager');
const { initializeAutoUpdate } = require('./auto-update-integration');

// 2. 全局变量（简化）
let mainWindow = null;
let tray = null;
let app_instance = null; // ✅ 保留，用于调用主进程服务
let logManager = null;

// 3. 核心功能
- checkAsarIntegrity()
- createMainWindow()
- createTray()
- setupIPCHandlers() // ⚠️ 需要简化
- initializeAutoUpdate()
```

#### Step 2: 简化 IPC 处理器

**当前 IPC 处理器（复杂）**:
```javascript
ipcMain.handle('app:start', async () => {
    // 150+ 行复杂的启动逻辑
    return await startAppService(true);
});
```

**简化后 IPC 处理器**:
```javascript
ipcMain.handle('app:start', async () => {
    // 直接委托给 EmployeeMonitorApp
    if (app_instance && typeof app_instance.startMonitoring === 'function') {
        await app_instance.startMonitoring();
        return { success: true, message: 'Service started' };
    }
    return { success: false, message: 'App instance not available' };
});
```

#### Step 3: 实现渲染进程需要的 IPC 接口

**新增/修改的 IPC 处理器**:

```javascript
// 1. 配置管理
ipcMain.handle('get-config', async () => {
    // 返回基本配置
    return {
        apiUrl: process.env.API_URL || 'http://localhost:3000',
        wsUrl: process.env.WS_URL || 'ws://localhost:3000',
        syncInterval: 60000,
        screenshotInterval: 300000,
        screenshotQuality: 80
    };
});

// 2. 设备 ID
ipcMain.handle('get-device-id', async () => {
    if (app_instance?.deviceId) {
        return app_instance.deviceId;
    }
    // 降级：返回系统标识
    const os = require('os');
    return os.hostname() + '-' + os.platform();
});

// 3. FSM 状态管理
ipcMain.handle('fsm:getCurrentState', () => {
    if (app_instance?.getStateMachine?.()) {
        const fsm = app_instance.getStateMachine();
        return fsm.getCurrentState?.() || 'UNKNOWN';
    }
    return 'INIT'; // 默认状态
});

ipcMain.handle('fsm:forceTransition', async (event, targetState) => {
    if (app_instance?.getStateMachine?.()) {
        const fsm = app_instance.getStateMachine();
        if (typeof fsm.forceTransition === 'function') {
            await fsm.forceTransition(targetState);
            return { success: true };
        }
    }
    return { success: false, message: 'FSM not available' };
});

// 4. 数据同步
ipcMain.handle('system:syncData', async () => {
    if (app_instance?.syncData && typeof app_instance.syncData === 'function') {
        return await app_instance.syncData();
    }
    // 降级：返回 mock 数据
    return {
        synced: true,
        itemCount: 0,
        timestamp: Date.now(),
        message: 'Mock sync (app instance not available)'
    };
});
```

#### Step 4: 事件广播机制

**监听主进程事件，转发到渲染进程**:

```javascript
function setupAppLogging() {
    if (!app_instance) return;

    // 监听 FSM 状态变化
    const fsm = app_instance.getStateMachine?.();
    if (fsm && fsm.on) {
        fsm.on('state-change', (newState, oldState) => {
            // 广播到渲染进程
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('fsm-state-changed', {
                    currentState: newState,
                    previousState: oldState,
                    timestamp: Date.now()
                });
            }
        });

        fsm.on('device-status', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('device-status-changed', data);
            }
        });
    }
}
```

#### Step 5: 移除冗余代码

**移除的部分**:

1. ❌ `startAppService()` 中的复杂状态检查（150+ 行）
   - 改为简单的委托调用

2. ❌ `stopAppService()` 中的复杂清理逻辑（100+ 行）
   - 改为简单的委托调用

3. ❌ 重复的状态管理变量
   - `currentState` → 从 FSM 获取
   - `manuallyPaused` → 从 FSM 获取

4. ❌ 复杂的自启动状态推送逻辑（60+ 行）
   - 改为简单的查询接口

---

## 📊 预期效果

### 代码行数

| 部分 | 当前 | 简化后 | 减少 |
|------|------|--------|------|
| main-minimal.js | ~1700 行 | ~800 行 | 53% ⬇️ |
| IPC 处理器 | ~600 行 | ~200 行 | 67% ⬇️ |
| 业务逻辑 | ~500 行 | ~100 行 | 80% ⬇️ |

### 职责分离

**主进程 (main-minimal.js)**:
- ✅ 窗口生命周期管理
- ✅ 系统托盘管理
- ✅ IPC 处理器注册
- ✅ 事件转发（主进程 → 渲染进程）
- ✅ EmployeeMonitorApp 初始化（保留）

**渲染进程 (renderer-app.js + services/)**:
- ✅ FSM 状态管理（本地）
- ✅ Auth 状态管理
- ✅ 数据同步调度
- ✅ UI 更新逻辑
- ✅ 热更新状态保存/恢复

---

## 🧪 测试计划

### 测试用例

1. **基础功能测试**
   - [ ] 窗口正常创建
   - [ ] 托盘正常显示
   - [ ] IPC 处理器正常响应

2. **渲染进程服务测试**
   - [ ] FSMService 能获取状态
   - [ ] FSMService 监听事件正常
   - [ ] DataSyncService 能触发同步
   - [ ] RendererApp 能获取配置

3. **降级测试**
   - [ ] app_instance 不存在时返回默认值
   - [ ] FSM 不可用时返回 mock 数据
   - [ ] sync 失败时使用本地 mock

4. **热更新测试**
   - [ ] 渲染进程重载后状态恢复
   - [ ] IPC 通信不中断

---

## 🚀 实施顺序

1. ✅ **分析 main-minimal.js 当前实现** (已完成)
2. ⏳ **创建简化版 IPC 处理器**
3. ⏳ **实现事件广播机制**
4. ⏳ **移除冗余业务逻辑**
5. ⏳ **测试简化后的功能**
6. ⏳ **文档更新**

---

## ⚠️ 风险和注意事项

### 风险

1. **EmployeeMonitorApp 依赖**
   - 如果 app_instance 初始化失败，IPC 处理器会降级到 mock
   - 需要确保降级逻辑健壮

2. **事件广播机制**
   - FSM 事件需要正确转发到渲染进程
   - 需要测试事件监听器的生命周期

3. **向后兼容**
   - 现有的 IPC 接口需要保持兼容
   - 旧的 HTML 界面也要能正常工作

### 缓解措施

1. **渐进式简化**
   - 先保留现有逻辑，逐步替换
   - 每次修改后都进行测试

2. **完善的降级机制**
   - 所有 IPC 处理器都有 fallback
   - 明确的错误处理和日志

3. **充分的测试**
   - 单元测试 IPC 处理器
   - 集成测试完整流程
   - 手动测试 UI 交互

---

## ✅ 成功标准

1. **功能完整性**
   - 所有渲染进程服务正常工作
   - UI 交互无异常
   - 托盘功能正常

2. **代码质量**
   - main-minimal.js 减少至少 50% 代码
   - IPC 处理器清晰简洁
   - 职责分离明确

3. **稳定性**
   - 降级机制可靠
   - 错误处理完善
   - 日志清晰可追踪

4. **可维护性**
   - 代码结构清晰
   - 注释完整
   - 易于理解和修改
