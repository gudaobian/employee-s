# 版本更新功能说明

**日期**: 2025-12-20
**状态**: ✅ 已完成
**类型**: 应用版本更新系统（非开发热更新）

---

## 功能概述

为UI界面添加了"检查更新"按钮，用于检查和安装应用程序的新版本。这是**应用版本更新系统**，与开发环境的热更新（Hot Reload）是完全不同的功能。

## 两种"更新"的区别

| 特性 | 开发热更新 (Hot Reload) | 应用版本更新 (Auto Update) |
|------|------------------------|---------------------------|
| **用途** | 开发时代码自动刷新 | 生产环境应用升级 |
| **触发** | 修改代码文件 | 用户点击"检查更新" |
| **环境** | 仅开发模式 | 生产模式 |
| **用户** | 开发人员 | 最终用户 |
| **UI按钮** | 无（自动） | 有"检查更新"按钮 |

## 更新策略

根据版本号自动选择更新方式：

- **小版本更新** (28.2.10 → 28.2.11): 热更新，无需重启
- **中版本更新** (28.2.x → 28.3.x): 热更新，自动应用
- **大版本更新** (28.x.x → 29.x.x): 完整安装包，需要下载并安装

## 已完成的修改

### 1. UI样式添加

**文件**: `electron/renderer/minimal-index.html`
**位置**: 第354-367行

```css
.btn-update {
    background: linear-gradient(135deg, #34c759 0%, #28a745 100%);
    color: white;
}

.btn-update:hover {
    background: linear-gradient(135deg, #28a745 0%, #218838 100%);
}

.btn-update:disabled {
    background: linear-gradient(135deg, #95d5a6 0%, #7cc48f 100%);
    cursor: not-allowed;
    opacity: 0.6;
}
```

### 2. HTML按钮添加

**文件**: `electron/renderer/minimal-index.html`
**位置**: 第653行

```html
<button class="btn btn-update" id="checkUpdateButton" onclick="checkForUpdates()">检查更新</button>
```

按钮位置在控制按钮组中：
```
[启动] [查看权限] [检查更新] [后台运行]
```

### 3. JavaScript函数添加

**文件**: `electron/renderer/minimal-index.html`
**位置**: 第1410-1476行

```javascript
async function checkForUpdates() {
    // 调用主进程IPC: 'check-for-updates'
    // 显示按钮状态：检查中... → 发现更新/已是最新/检查失败
    // 更新状态栏信息
}
```

## 功能特性

### 按钮状态变化

1. **初始状态**: "检查更新" (绿色渐变)
2. **检查中**: "检查中..." (禁用状态)
3. **有更新**: "发现更新" (显示3秒)
4. **无更新**: "已是最新" (显示2秒)
5. **失败**: "检查失败" (显示2秒)

### 状态栏提示

- 发现新版本: `发现新版本: X.Y.Z`
- 已是最新: `当前已是最新版本`
- 检查失败: `更新检查失败`

### 自动恢复

所有状态变化后会自动恢复按钮到初始状态：
- 成功: 2-3秒后恢复
- 失败: 2秒后恢复

## 后端支持

### IPC处理器 (已存在)

**文件**: `electron/auto-update-integration.js`

```javascript
// 第240行
ipcMain.handle('check-for-updates', async () => {
    // 检查更新逻辑
});

// 第254行
ipcMain.handle('install-update', async () => {
    // 安装更新逻辑
});

// 第268行
ipcMain.handle('get-update-status', () => {
    // 获取更新状态
});

// 第286行
ipcMain.handle('get-app-version', () => {
    // 获取当前版本
});
```

### Preload桥接 (已存在)

**文件**: `electron/preload-js.js`

```javascript
// 第113行：通用invoke方法
invoke: async (channel, ...args) => {
    return await ipcRenderer.invoke(channel, ...args);
}
```

## 使用方法

### 用户操作流程

1. 打开应用程序
2. 点击"检查更新"按钮（绿色按钮，位于控制按钮组）
3. 等待检查结果（按钮显示"检查中..."）
4. 查看结果：
   - **有更新**: 按钮显示"发现更新"，状态栏显示版本号
   - **无更新**: 按钮显示"已是最新"
   - **失败**: 按钮显示"检查失败"

### 开发者测试

```bash
# 启动应用
npx electron electron/main-minimal.js

# 在UI中点击"检查更新"按钮
# 观察控制台输出和按钮状态变化
```

## 更新流程说明

### 小版本热更新流程

1. 用户点击"检查更新"
2. 应用检查服务器上的版本
3. 发现新版本（如 28.2.11）
4. 自动下载差异文件
5. 应用补丁（无需重启）
6. 更新完成提示

### 大版本完整更新流程

1. 用户点击"检查更新"
2. 应用检查服务器上的版本
3. 发现大版本更新（如 29.0.0）
4. 下载完整安装包
5. 显示下载进度条
6. 下载完成后提示安装
7. 用户确认后重启并安装

## 配置说明

### 服务器配置

更新服务器地址在应用配置中设置：
- **默认地址**: `http://23.95.193.155:3000`
- **配置路径**: UI中的"服务器配置"区域

### 更新通道

支持多个更新通道：
- **stable**: 稳定版本（默认）
- **beta**: 测试版本
- **alpha**: 内测版本

## 改进记录

### 2025-12-20：优化错误提示逻辑

**问题**: 数据库无版本时显示"检查更新出错"，用户体验不佳

**改进**:
1. **IPC Handler增强** (`electron/auto-update-integration.js` 第238-326行):
   - 监听 `update-available` 和 `update-not-available` 事件
   - 区分404错误（无版本）和真正的检查失败
   - 404相关错误返回 `{ success: true, updateAvailable: false, reason: '暂无可用版本' }`
   - 其他错误返回 `{ success: false, error: ... }`

2. **前端显示优化** (`electron/renderer/minimal-index.html` 第1410-1478行):
   - `updateAvailable: true` → 显示"发现更新" + 版本号
   - `updateAvailable: false` → 显示"无更新" + 具体原因（已是最新/暂无可用版本/更新服务不可用）
   - `success: false` → 显示"检查失败" + 错误信息（仅网络错误等真正失败）

**用户体验提升**:
- ✅ 无版本时显示"暂无可用版本"而非"检查失败"
- ✅ 已是最新时显示"已是最新版本"
- ✅ 服务不可用时显示"更新服务不可用"
- ✅ 真正失败时才显示"检查失败"

## 已知问题

### 1. 开发模式限制

**问题**: 开发模式下更新功能可能不可用
**原因**: `auto-update-integration.js` 尝试加载编译后的模块
**解决**: 仅在打包后的应用中测试完整更新功能
**用户体验**: 显示"更新服务不可用"（友好提示，非错误）

**日志**:
```
[AUTO_UPDATE] Failed to load update modules: Cannot find module '.../out/dist/...'
[AUTO_UPDATE] Auto-update will be disabled
```

### 2. 服务器无版本数据

**问题**: 数据库中没有已发布的版本
**原因**: `client_versions` 表中无 `status='published'` 的darwin版本
**解决**: 通过管理后台上传并发布版本，或执行SQL插入测试数据
**用户体验**: 显示"暂无可用版本"（友好提示，非错误）

## 测试建议

### 开发环境测试

```bash
# 1. 编译项目
npm run build

# 2. 启动应用
npx electron electron/main-minimal.js

# 3. 测试按钮功能
# - 点击"检查更新"
# - 观察按钮状态变化
# - 查看控制台日志
```

### 生产环境测试

```bash
# 1. 打包应用
npm run pack:mac  # 或 pack:win

# 2. 安装并运行打包后的应用

# 3. 测试完整更新流程
# - 点击"检查更新"
# - 验证下载进度
# - 验证安装流程
```

## 后续增强建议

### UI增强
- [ ] 添加更新日志展示
- [ ] 添加下载进度条
- [ ] 添加更新历史记录
- [ ] 添加更新通道切换选项

### 功能增强
- [ ] 自动检查更新（定时）
- [ ] 静默下载（后台）
- [ ] 增量更新优化
- [ ] 断点续传支持

### 用户体验
- [ ] 更新前确认对话框
- [ ] 更新失败重试机制
- [ ] 网络连接状态检测
- [ ] 更新文件完整性校验

## 相关文档

- **热更新集成**: `HOT_RELOAD_MAIN_INTEGRATION_REPORT.md`
- **自动更新实现**: `AUTO_UPDATE_IMPLEMENTATION_PLAN.md` (如果存在)
- **API文档**: 查看 `auto-update-integration.js` 代码注释

---

**完成时间**: 2025-12-20
**实现者**: Claude Sonnet 4.5
**测试状态**: ⏳ 待生产环境验证
