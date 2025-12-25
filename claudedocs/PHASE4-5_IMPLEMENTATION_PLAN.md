# Phase 4-5 实施计划 - 渲染进程热更新服务

**目标**: 实现渲染进程文件的自动热更新（Hot Reload）
**适用场景**: 开发环境
**核心价值**: 修改渲染进程代码后自动重载，无需手动刷新

---

## 📋 需求分析

### 功能需求

1. **文件监听**
   - 监听 `electron/renderer/` 目录下的所有文件
   - 支持的文件类型：`.js`, `.html`, `.css`
   - 排除：`node_modules`, `.git`, `dist` 等目录

2. **热更新触发**
   - 文件变化 → 通知渲染进程 → 保存状态 → 重载窗口
   - 防抖机制：500ms 内的多次变化只触发一次重载
   - 只在开发环境启用（`!app.isPackaged`）

3. **状态管理**
   - 重载前：调用 `RendererApp.prepareForReload()`
   - 重载后：自动调用 `RendererApp.restoreState()`
   - 状态存储：localStorage

4. **用户体验**
   - 显示热更新通知（可选）
   - 重载期间保持窗口可见
   - 重载失败时显示错误信息

### 非功能需求

1. **性能**
   - 文件监听不影响主进程性能
   - 防抖机制避免频繁重载

2. **可靠性**
   - 文件监听失败不影响应用运行
   - 重载失败能够恢复

3. **可维护性**
   - 独立模块，易于启用/禁用
   - 清晰的日志输出

---

## 🏗️ 架构设计

### 组件划分

```
主进程 (Main Process)
├── FileWatcher (文件监听服务)
│   ├── 监听 electron/renderer/ 目录
│   ├── 防抖处理（500ms）
│   └── 触发热更新事件
│
└── HotReloadManager (热更新管理器)
    ├── 注册文件监听器
    ├── 发送重载通知到渲染进程
    └── 执行窗口重载

渲染进程 (Renderer Process)
└── RendererApp
    ├── 监听 'reload-renderer' 事件
    ├── prepareForReload() - 保存状态
    └── restoreState() - 恢复状态（已实现）
```

### 数据流

```
文件变化 (file changed)
    ↓
FileWatcher 检测到变化
    ↓
防抖处理 (500ms)
    ↓
HotReloadManager 触发重载
    ↓
发送 'reload-renderer' 到渲染进程
    ↓
RendererApp.prepareForReload()
    ├── 保存 FSM 状态
    ├── 保存 Auth 状态
    ├── 保存 DataSync 状态
    └── 清理资源
    ↓
主进程执行 mainWindow.reload()
    ↓
渲染进程重新加载
    ↓
RendererApp.restoreState()
    ├── 恢复 FSM 状态
    ├── 恢复 Auth 状态
    └── 恢复 DataSync 状态
```

---

## 🔧 实施步骤

### Step 1: 创建 FileWatcher 服务

**文件**: `electron/file-watcher.js`

**功能**:
- 使用 Node.js `fs.watch()` 或 `chokidar` 监听文件
- 过滤文件类型和目录
- 防抖处理

**API**:
```javascript
class FileWatcher extends EventEmitter {
  constructor(options) {
    // options: {
    //   watchPath,
    //   debounceDelay,
    //   fileTypes,
    //   ignorePaths
    // }
  }

  start() {
    // 开始监听
  }

  stop() {
    // 停止监听
  }

  // Events:
  // - 'change' (filePath, changeType)
}
```

**依赖**:
- 选项 1: 使用 `fs.watch()` (Node.js 内置)
- 选项 2: 使用 `chokidar` (更可靠，需要 npm install)

**推荐**: 使用 `fs.watch()` 先实现，如果不稳定再升级到 `chokidar`

### Step 2: 创建 HotReloadManager

**文件**: `electron/hot-reload-manager.js`

**功能**:
- 初始化 FileWatcher
- 监听文件变化事件
- 触发窗口重载

**API**:
```javascript
class HotReloadManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.fileWatcher = null;
  }

  start() {
    // 启动文件监听和热更新
  }

  stop() {
    // 停止热更新
  }

  reload() {
    // 执行重载逻辑
  }
}
```

### Step 3: 集成到主进程

**文件**: 修改 `electron/test-phase3-main.js` 或创建新的测试主进程

**集成点**:
```javascript
// 在 app.whenReady() 中
if (!app.isPackaged) {
  const HotReloadManager = require('./hot-reload-manager');
  const hotReload = new HotReloadManager(mainWindow);
  hotReload.start();
  console.log('[HOT-RELOAD] Hot reload enabled in development mode');
}
```

### Step 4: 更新 RendererApp（已完成）

RendererApp 已经实现了：
- ✅ `prepareForReload()` - 保存状态并清理
- ✅ `restoreState()` - 恢复状态
- ✅ 监听 `reload-renderer` 事件

只需确保这些方法在热更新时被正确调用。

### Step 5: 测试热更新

**测试文件**: `electron/renderer/test-hot-reload.html`

**测试步骤**:
1. 启动应用
2. 修改渲染进程文件（如 `renderer-app.js`）
3. 验证应用自动重载
4. 验证状态正确恢复

---

## 📦 技术选型

### 文件监听方案

#### 方案 A: `fs.watch()` (推荐)

**优点**:
- Node.js 内置，无需额外依赖
- 轻量级，性能好

**缺点**:
- 跨平台行为不一致
- 可能触发多次事件（需要防抖）

**实现示例**:
```javascript
const fs = require('fs');
const path = require('path');

const watchDir = path.join(__dirname, 'renderer');

fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
  if (filename && /\.(js|html|css)$/.test(filename)) {
    console.log(`File changed: ${filename}`);
    // 触发热更新
  }
});
```

#### 方案 B: `chokidar`

**优点**:
- 跨平台一致性好
- 更可靠的事件触发
- 更多配置选项

**缺点**:
- 需要额外依赖（增加包大小）

**实现示例**:
```javascript
const chokidar = require('chokidar');

const watcher = chokidar.watch('renderer/**/*.{js,html,css}', {
  ignored: /(^|[\/\\])\../,
  persistent: true
});

watcher.on('change', path => {
  console.log(`File ${path} has been changed`);
  // 触发热更新
});
```

**决策**: 先使用方案 A (`fs.watch()`)，如果不稳定再升级到方案 B

### 防抖实现

```javascript
class Debouncer {
  constructor(delay = 500) {
    this.delay = delay;
    this.timer = null;
  }

  debounce(callback) {
    clearTimeout(this.timer);
    this.timer = setTimeout(callback, this.delay);
  }

  cancel() {
    clearTimeout(this.timer);
  }
}
```

---

## 🔍 实现细节

### 1. FileWatcher 实现

**监听路径**: `electron/renderer/`

**包含文件**:
- `*.js` (JavaScript 文件)
- `*.html` (HTML 文件)
- `*.css` (CSS 文件)

**排除路径**:
- `node_modules/`
- `.git/`
- `dist/`
- `*.map`
- `*.min.js`

**防抖延迟**: 500ms

**事件类型**:
- `change` - 文件内容变化
- `rename` - 文件重命名/删除

### 2. HotReloadManager 实现

**重载流程**:
```javascript
async reload() {
  console.log('[HOT-RELOAD] Triggering reload...');

  // 1. 发送重载通知到渲染进程
  this.mainWindow.webContents.send('reload-renderer');

  // 2. 等待渲染进程保存状态（100ms 缓冲）
  await new Promise(resolve => setTimeout(resolve, 100));

  // 3. 执行重载
  this.mainWindow.reload();

  console.log('[HOT-RELOAD] Reload complete');
}
```

**错误处理**:
```javascript
try {
  await this.reload();
} catch (error) {
  console.error('[HOT-RELOAD] Reload failed:', error);
  // 可选：显示错误通知
}
```

### 3. 渲染进程集成

**RendererApp 监听重载事件** (已实现):
```javascript
// 在 setupIPC() 中
const unsub4 = window.electronAPI.on('reload-renderer', () => {
  console.log('[RendererApp] Hot reload requested by main process');
  this.prepareForReload();
});
this.ipcUnsubscribers.push(unsub4);
```

**状态保存** (已实现):
```javascript
async prepareForReload() {
  const currentState = {
    fsmState: this.fsm ? this.fsm.saveState() : null,
    authState: this.services.auth ? this.services.auth.saveState() : null,
    dataSyncState: this.services.dataSync ? this.services.dataSync.saveState() : null,
    config: this.config,
    timestamp: Date.now()
  };
  localStorage.setItem('app-state-backup', JSON.stringify(currentState));

  // 清理资源
  // ...
}
```

---

## ⚠️ 注意事项

### 1. 开发环境检测

**重要**: 只在开发环境启用热更新

```javascript
if (!app.isPackaged) {
  // 启用热更新
} else {
  // 生产环境，不启用
}
```

### 2. 文件监听性能

**问题**: 大量文件变化可能导致性能问题

**解决方案**:
- 使用防抖机制（500ms）
- 只监听必要的目录
- 排除不需要的文件类型

### 3. 状态恢复失败

**问题**: localStorage 可能损坏或不可用

**解决方案**:
```javascript
try {
  const savedState = localStorage.getItem('app-state-backup');
  if (savedState) {
    this.restoreState(JSON.parse(savedState));
  }
} catch (error) {
  console.error('[RendererApp] State restore failed:', error);
  localStorage.removeItem('app-state-backup');
  // 继续以新状态启动
}
```

### 4. 循环重载

**问题**: 重载可能触发文件变化，导致无限循环

**解决方案**:
- 监听文件系统事件，而不是应用事件
- 排除临时文件和缓存文件

---

## 🧪 测试计划

### 单元测试

1. **FileWatcher 测试**
   - 测试文件变化检测
   - 测试防抖机制
   - 测试文件类型过滤

2. **HotReloadManager 测试**
   - 测试重载触发
   - 测试错误处理

### 集成测试

1. **热更新流程测试**
   - 修改 JS 文件 → 自动重载 → 状态恢复
   - 修改 HTML 文件 → 自动重载 → UI 更新
   - 修改 CSS 文件 → 自动重载 → 样式更新

2. **状态保存测试**
   - FSM 状态保存和恢复
   - Auth 状态保存和恢复
   - DataSync 状态保存和恢复

3. **边界测试**
   - 快速连续修改文件 → 只触发一次重载
   - 重载期间再次修改 → 正确处理
   - localStorage 不可用 → 优雅降级

---

## 📈 成功标准

1. **功能完整性**
   - [ ] 文件变化能被正确检测
   - [ ] 防抖机制工作正常
   - [ ] 窗口能够自动重载
   - [ ] 状态能够正确恢复

2. **性能**
   - [ ] 文件监听不影响主进程性能
   - [ ] 重载延迟 < 1 秒
   - [ ] 状态恢复 < 500ms

3. **可靠性**
   - [ ] 热更新失败不影响应用运行
   - [ ] 状态恢复失败能够优雅降级
   - [ ] 生产环境自动禁用

4. **开发体验**
   - [ ] 修改代码后立即看到效果
   - [ ] 不需要手动刷新
   - [ ] 状态不丢失

---

## 🚀 实施顺序

1. ✅ **分析需求和设计方案** (当前)
2. ⏳ **实现 FileWatcher 服务**
3. ⏳ **实现 HotReloadManager**
4. ⏳ **创建测试主进程**
5. ⏳ **测试热更新流程**
6. ⏳ **创建完成报告**

---

## 📚 参考资料

- [Electron Hot Reload](https://www.electronjs.org/docs/latest/tutorial/hot-reload)
- [Node.js fs.watch()](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)
- [Chokidar](https://github.com/paulmillr/chokidar)
- [Debounce 防抖函数](https://css-tricks.com/debouncing-throttling-explained-examples/)

---

## ✨ 预期效果

**开发体验提升**:
- 修改渲染进程代码 → 500ms 后自动重载
- 状态保持不丢失
- 无需手动刷新窗口

**代码质量**:
- 独立模块，易于维护
- 只在开发环境启用
- 完善的错误处理

**性能影响**:
- 主进程性能影响 < 1%
- 内存占用增加 < 10MB
- 重载速度 < 1 秒
