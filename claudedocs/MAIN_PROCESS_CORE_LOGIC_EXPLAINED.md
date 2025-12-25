# 主进程核心逻辑详解

## 📋 什么是"主进程核心逻辑"？

### 核心概念

**主进程核心逻辑** = 应用启动时就加载的、无法在运行时重新加载的代码

```
主进程启动流程（只执行一次）:
  1. Electron 启动主进程
  2. 读取 main-minimal.js 或 main/index.ts
  3. 执行初始化代码
  4. 代码被加载到内存并缓存
  5. ❌ 之后无法更新这些代码，除非重启
```

---

## 🔍 具体例子说明

### 当前项目中的主进程核心逻辑

让我用您项目中的实际代码来说明：

#### 1️⃣ 窗口创建逻辑（核心逻辑）

**位置**: `electron/main-minimal.js:492-530`

```javascript
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: APP_CONFIG.width,           // ← 窗口大小配置
        height: APP_CONFIG.height,
        resizable: APP_CONFIG.resizable,
        webPreferences: {
            nodeIntegration: false,        // ← 安全配置
            contextIsolation: true,        // ← 上下文隔离
            preload: path.join(__dirname, 'preload-js.js')
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        skipTaskbar: process.platform === 'darwin'
    });

    mainWindow.loadFile(htmlPath);
}
```

**为什么是核心逻辑**：
- ✅ 这段代码在应用启动时执行
- ✅ 定义了窗口如何创建（大小、安全策略、预加载脚本）
- ❌ 运行时无法修改这些配置（已经创建的窗口无法改变这些属性）

**修改示例**：
```javascript
// 假如你想把窗口从 340x265 改成 400x300
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 400,   // ← 改了这里
        height: 300,  // ← 改了这里
        // ...
    });
}

结果：
  ❌ 热更新无效 - 窗口已经创建了
  ❌ reload() 无效 - 只刷新窗口内容，不会重新创建窗口
  ✅ 必须重启应用 - 重新执行 createMainWindow()
```

---

#### 2️⃣ IPC 通信通道定义（核心逻辑）

**位置**: `electron/main-minimal.js` 中的 `ipcMain.handle()` 调用

```javascript
// 主进程定义 IPC 通道
ipcMain.handle('pause-monitor', async () => {
    if (app_instance) {
        await app_instance.pause();
        return { success: true };
    }
});

ipcMain.handle('resume-monitor', async () => {
    if (app_instance) {
        await app_instance.resume();
        return { success: true };
    }
});

ipcMain.handle('get-state', async () => {
    if (app_instance) {
        return app_instance.getState();
    }
});
```

**为什么是核心逻辑**：
- ✅ 这些通道在主进程启动时注册
- ✅ 定义了渲染进程和主进程如何通信
- ❌ 运行时无法修改通道名称或处理逻辑

**修改示例**：
```javascript
// 假如你想把通道名从 'pause-monitor' 改成 'pause-monitoring'
ipcMain.handle('pause-monitoring', async () => {  // ← 改了通道名
    // ...
});

结果：
  ❌ 热更新无效 - 旧的通道名已经注册，无法删除
  ❌ reload() 无效 - 只刷新渲染进程，主进程的 ipcMain 不会重新注册
  ✅ 必须重启应用 - 重新注册 IPC 通道
```

---

#### 3️⃣ 托盘图标和菜单（核心逻辑）

**位置**: `electron/main-minimal.js` 中的托盘创建逻辑

```javascript
function createTray() {
    tray = new Tray(nativeImage.createFromPath(iconPath));

    const contextMenu = Menu.buildFromTemplate([
        { label: '显示窗口', click: () => { mainWindow.show(); } },
        { label: '暂停监控', click: () => { /* ... */ } },
        { label: '恢复监控', click: () => { /* ... */ } },
        { label: '退出', click: () => { app.quit(); } }
    ]);

    tray.setContextMenu(contextMenu);
}
```

**为什么是核心逻辑**：
- ✅ 托盘图标在主进程启动时创建
- ✅ 菜单项在创建时定义
- ❌ 运行时无法修改菜单结构（只能修改菜单项的状态，如启用/禁用）

**修改示例**：
```javascript
// 假如你想在托盘菜单中新增一个"关于"选项
const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { mainWindow.show(); } },
    { label: '暂停监控', click: () => { /* ... */ } },
    { label: '恢复监控', click: () => { /* ... */ } },
    { label: '关于', click: () => { /* 显示关于对话框 */ } },  // ← 新增
    { label: '退出', click: () => { app.quit(); } }
]);

结果：
  ❌ 热更新无效 - 托盘菜单已经创建
  ❌ reload() 无效 - 托盘在主进程，不在渲染进程
  ✅ 必须重启应用 - 重新创建托盘菜单
```

---

#### 4️⃣ 应用生命周期管理（核心逻辑）

```javascript
app.on('ready', async () => {
    createMainWindow();
    createTray();
    initializeAutoUpdate();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});
```

**为什么是核心逻辑**：
- ✅ 这些事件监听器在应用启动时注册
- ✅ 定义了应用的生命周期行为
- ❌ 运行时无法修改事件处理逻辑

**修改示例**：
```javascript
// 假如你想修改 macOS 上的退出行为
app.on('window-all-closed', () => {
    // 原来：macOS 上窗口关闭后应用保持运行
    // 现在：所有平台都直接退出
    app.quit();  // ← 改了这里
});

结果：
  ❌ 热更新无效 - 事件监听器已经注册
  ❌ reload() 无效 - 主进程的事件监听不会重新注册
  ✅ 必须重启应用 - 重新注册生命周期事件
```

---

#### 5️⃣ 原生模块加载（核心逻辑）

```javascript
// 假设加载原生模块
let nativeModule;

try {
    const nativeModulePath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'native',
        'macos.node'
    );
    nativeModule = require(nativeModulePath);
} catch (error) {
    console.error('Failed to load native module:', error);
}
```

**为什么是核心逻辑**：
- ✅ 原生模块（.node 文件）在加载后无法卸载
- ✅ `require()` 会永久缓存模块
- ❌ 无法在运行时替换原生模块

**修改示例**：
```javascript
// 假如你更新了 macos.node 文件（修复了 Bug）

结果：
  ❌ 热更新无效 - 原生模块已经加载到内存
  ❌ delete require.cache 无效 - 原生模块不在 Node.js 缓存中
  ❌ reload() 无效 - 原生模块在主进程
  ✅ 必须重启应用 - 重新加载 .node 文件
```

---

## 🆚 对比：什么不是核心逻辑

### ✅ 非核心逻辑（可以通过 reload 更新）

#### 1️⃣ 渲染进程的业务逻辑

```javascript
// renderer/app.js
class RendererApp {
    async init() {
        // ✅ 这些代码在渲染进程
        this.fsm = new DeviceFSM();
        this.authService = new AuthService();

        await this.fsm.start();
    }
}

// 页面加载时执行
window.addEventListener('DOMContentLoaded', async () => {
    const app = new RendererApp();
    await app.init();
});
```

**为什么不是核心逻辑**：
- ✅ 这些代码在渲染进程执行
- ✅ 每次 `reload()` 都会重新加载和执行
- ✅ 可以更新这些代码，然后刷新窗口

**修改示例**：
```javascript
// 假如你优化了 FSM 的逻辑
class RendererApp {
    async init() {
        this.fsm = new ImprovedDeviceFSM();  // ← 使用新的 FSM
        // ...
    }
}

结果：
  ✅ 热更新有效 - 替换 renderer/app.js 文件
  ✅ reload() 有效 - 刷新窗口，重新执行 init()
  ✅ 不需要重启 - 0.5 秒完成更新
```

---

#### 2️⃣ 渲染进程的 UI 代码

```html
<!-- renderer/index.html -->
<div id="status">运行中</div>
<button onclick="pauseMonitoring()">暂停监控</button>
```

```javascript
// renderer/ui.js
function pauseMonitoring() {
    window.ipc.invoke('pause-monitor');
    document.getElementById('status').textContent = '已暂停';
}
```

**为什么不是核心逻辑**：
- ✅ UI 代码在渲染进程
- ✅ `reload()` 会重新加载 HTML 和 JavaScript
- ✅ 可以修改 UI 样式、文字、逻辑

**修改示例**：
```html
<!-- 假如你想改变按钮文字和样式 -->
<button class="new-style" onclick="pauseMonitoring()">
    暂停运行  <!-- ← 改了文字 -->
</button>
```

```css
.new-style {
    background: red;  /* ← 改了样式 */
}
```

结果：
  ✅ 热更新有效 - 替换 HTML/CSS 文件
  ✅ reload() 有效 - 刷新窗口，看到新样式
  ✅ 不需要重启 - 0.5 秒完成更新

---

#### 3️⃣ 配置文件和数据

```json
// config.json
{
    "reportInterval": 60000,
    "screenshotQuality": 80,
    "serverUrl": "https://api.example.com"
}
```

```javascript
// renderer/app.js
async function loadConfig() {
    const config = await fetch('/config.json').then(r => r.json());
    this.reportInterval = config.reportInterval;
}
```

**为什么不是核心逻辑**：
- ✅ 配置文件动态加载
- ✅ 可以在运行时重新读取
- ✅ 不需要重启应用

**修改示例**：
```json
// 假如你想把上报间隔从 60 秒改成 30 秒
{
    "reportInterval": 30000  // ← 改了这里
}
```

结果：
  ✅ 热更新有效 - 替换 config.json
  ✅ 重新加载配置 - 调用 loadConfig()
  ✅ 不需要重启 - 立即生效

---

## 📊 总结对比表

| 类型 | 位置 | 是否核心逻辑 | 修改后是否需要重启 | 示例 |
|------|------|-------------|------------------|------|
| **窗口创建配置** | 主进程 | ✅ 是 | ❌ 需要重启 | 窗口大小、安全策略 |
| **IPC 通道定义** | 主进程 | ✅ 是 | ❌ 需要重启 | ipcMain.handle() |
| **托盘菜单结构** | 主进程 | ✅ 是 | ❌ 需要重启 | Tray, Menu |
| **生命周期事件** | 主进程 | ✅ 是 | ❌ 需要重启 | app.on('ready') |
| **原生模块加载** | 主进程 | ✅ 是 | ❌ 需要重启 | require('xxx.node') |
| **业务逻辑服务** | 渲染进程 | ❌ 否 | ✅ 不需要重启 | FSM, AuthService |
| **UI 界面代码** | 渲染进程 | ❌ 否 | ✅ 不需要重启 | HTML, CSS, JS |
| **配置文件数据** | 数据文件 | ❌ 否 | ✅ 不需要重启 | config.json |

---

## 🎯 实际应用场景

### 场景1：修改窗口大小 ❌ 需要重启

```javascript
// 主进程核心逻辑修改
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 400,   // 从 340 改成 400
        height: 300,  // 从 265 改成 300
    });
}

原因：
  • 窗口创建配置是主进程核心逻辑
  • 在应用启动时执行
  • 运行时无法重新创建窗口

解决方案：
  ✅ 必须发布新版本，用户重启应用
```

---

### 场景2：修改托盘菜单项 ❌ 需要重启

```javascript
// 主进程核心逻辑修改
const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { mainWindow.show(); } },
    { label: '关于', click: showAboutDialog },  // ← 新增菜单项
    { label: '退出', click: () => { app.quit(); } }
]);

原因：
  • 托盘菜单是主进程核心逻辑
  • 菜单结构在创建时固定
  • 无法动态新增菜单项

解决方案：
  ✅ 必须发布新版本，用户重启应用
```

---

### 场景3：优化数据上报逻辑 ✅ 不需要重启

```javascript
// 渲染进程业务逻辑修改
class DataSyncService {
    async syncData() {
        // 从每 60 秒上报改成每 30 秒
        setInterval(() => {
            this.reportToServer();
        }, 30000);  // ← 优化了上报频率
    }
}

原因：
  • DataSyncService 在渲染进程
  • reload() 会重新执行 init()
  • 新逻辑立即生效

解决方案：
  ✅ 热更新渲染进程文件
  ✅ 调用 mainWindow.reload()
  ✅ 0.5 秒完成，不需要重启
```

---

### 场景4：修复 UI 显示 Bug ✅ 不需要重启

```html
<!-- 修复按钮文字拼写错误 -->
<button>暂停监控</button>  <!-- 从"暫停監控"改成"暂停监控" -->
```

```javascript
// 修复状态显示逻辑
function updateStatus(state) {
    const statusText = {
        'RUNNING': '运行中',  // ← 修复了显示文字
        'PAUSED': '已暂停'
    };
    document.getElementById('status').textContent = statusText[state];
}

原因：
  • UI 代码在渲染进程
  • reload() 会重新加载 HTML/JS
  • 新界面立即显示

解决方案：
  ✅ 热更新 HTML/JS 文件
  ✅ 调用 mainWindow.reload()
  ✅ 0.5 秒完成，不需要重启
```

---

## 💡 如何判断是否是核心逻辑？

**三个判断标准**：

### 1. 在哪里执行？
```
主进程执行？
  ├─ 是 → ✅ 核心逻辑（需要重启）
  └─ 否 → 继续判断

渲染进程执行？
  ├─ 是 → ❌ 非核心逻辑（可 reload）
  └─ 否 → 继续判断
```

### 2. 什么时候执行？
```
应用启动时执行一次？
  ├─ 是 → ✅ 核心逻辑（需要重启）
  └─ 否 → ❌ 非核心逻辑（可 reload）
```

### 3. 能否重新加载？
```
修改后能通过 reload() 生效？
  ├─ 能 → ❌ 非核心逻辑（可 reload）
  └─ 不能 → ✅ 核心逻辑（需要重启）
```

---

## 🎓 总结

**主进程核心逻辑** = 应用启动时在主进程中执行的、定义应用基础结构的代码

**具体包括**：
1. 窗口创建和配置
2. IPC 通信通道
3. 托盘和菜单
4. 应用生命周期
5. 原生模块加载
6. 系统权限管理

**修改这些需要重启的原因**：
- 这些代码在应用启动时执行一次
- 执行后就固化了（窗口已创建、通道已注册）
- Node.js 会永久缓存已加载的模块
- 无法在运行时"卸载"再"重新加载"

**不需要重启的内容**：
- 渲染进程的业务逻辑
- UI 界面代码
- 配置文件和数据
- 动态加载的资源

这就是为什么"渲染进程重载方案"能让 70% 的更新避免重启 - 因为大部分日常更新都是修改业务逻辑和 UI，而不是修改主进程核心逻辑。
