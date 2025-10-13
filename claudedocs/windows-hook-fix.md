# Windows客户端活动检测修复方案

## 问题诊断

### 问题1：键盘和鼠标检测不工作
**根本原因**：Windows Hook (`SetWindowsHookEx`) 需要消息循环才能触发回调，但原代码缺少消息泵。

**技术细节**：
- `WH_KEYBOARD_LL` 和 `WH_MOUSE_LL` 低级Hook依赖Windows消息队列
- 没有消息循环处理，Hook永远不会接收到事件
- Hook安装成功但回调函数从未被调用

### 问题2：内存占用过高
**根本原因**：系统消息未被处理，在消息队列中累积导致内存泄漏。

**影响**：
- 长时间运行后内存占用持续增长
- 系统消息队列溢出
- 应用程序响应变慢

## 修复方案

### 新增消息泵模块

创建了独立的消息处理线程来支持Hook工作：

**新增文件**：
- `src/message_pump.h` - 消息泵类定义
- `src/message_pump.cpp` - 消息泵实现

**核心功能**：
1. 独立线程运行Windows消息循环
2. 使用 `PeekMessage` + `DispatchMessage` 处理Hook消息
3. 优雅的启动/停止机制
4. 自动防止内存泄漏

### 修改的文件

**`event_monitor.cpp`**：
```cpp
// 添加消息泵支持
#include "message_pump.h"
static MessagePump* messagePump = nullptr;

// Hook安装前先启动消息泵
if (!messagePump) {
    messagePump = new MessagePump();
}
messagePump->Start();

// Hook卸载后停止消息泵
messagePump->Stop();
delete messagePump;
messagePump = nullptr;
```

**`binding.gyp`**：
```json
"sources": [
  "src/event_monitor.cpp",
  "src/keyboard_hook.cpp",
  "src/mouse_hook.cpp",
  "src/idle_detector.cpp",
  "src/message_pump.cpp"  // 新增
]
```

## 构建和部署

### 1. 重新编译原生模块

在Windows开发机器上：

```bash
cd employee-client/native-event-monitor-win

# 清理旧构建
rimraf build

# 重新编译
node-gyp configure
node-gyp build

# 或使用npm脚本
npm run build
```

### 2. 验证编译结果

检查生成的文件：
```bash
# 应该存在以下文件
build/Release/event_monitor.node
```

### 3. 重新构建客户端

```bash
cd employee-client

# 清理dist目录
npm run clean

# 完整构建
npm run build

# 打包Windows版本
npm run pack:win
```

## 测试方法

### 本地测试

```bash
# 运行测试脚本
cd native-event-monitor-win
node test-native-events.js
```

**预期输出**：
```
[MESSAGE_PUMP] Thread started with ID: xxxxx
[MESSAGE_PUMP] Message loop started
[HOOK] Message pump started successfully
[HOOK] All hooks installed successfully
[WIN-NATIVE] ✅ Windows原生事件监控已启动

# 按键盘或点击鼠标后
[WIN-NATIVE] 事件计数 - 键盘: 5, 鼠标: 3, 空闲: 0ms
```

### Electron环境测试

```bash
# 启动Electron开发模式
npm run electron:dev

# 在客户端界面查看日志容器
# 应该看到：
✅ Windows原生事件监控模块已加载
✅ Windows原生事件监控已启动
✅ 原生模块检测到X个键盘事件，Y个鼠标点击
```

### 内存测试

监控内存占用变化：

```bash
# Windows任务管理器
# 或使用PowerShell
Get-Process EmployeeMonitor | Select-Object WorkingSet64
```

**预期结果**：
- 启动后内存稳定在合理范围（50-100MB）
- 长时间运行内存不增长
- 活动检测正常工作

## 技术说明

### 消息泵工作原理

```
┌─────────────────────────────────────────┐
│  Windows系统消息队列                      │
│  (键盘/鼠标事件)                          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  MessagePump Thread                      │
│  ┌────────────────────────────────────┐ │
│  │  while (running) {                 │ │
│  │    PeekMessage(&msg, ...)          │ │
│  │    DispatchMessage(&msg)           │ │
│  │    Sleep(10)                       │ │
│  │  }                                 │ │
│  └────────────────────────────────────┘ │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Hook Callbacks                          │
│  ├─ KeyboardProc() → keyboardCount++    │
│  └─ MouseProc() → mouseClickCount++     │
└─────────────────────────────────────────┘
```

### 为什么需要独立线程

1. **非阻塞**：主Node.js线程不能被消息循环阻塞
2. **持续性**：消息泵必须持续运行才能接收Hook事件
3. **隔离性**：避免影响Electron的主消息循环

### 内存管理

- 消息泵使用 `PeekMessage` 而非 `GetMessage`，避免阻塞
- 及时处理所有消息，防止队列堆积
- `Sleep(10)` 控制CPU占用，不影响Hook响应速度
- 优雅的停止机制（WM_QUIT）确保资源释放

## 常见问题

### Q: Hook仍然不工作？

检查：
1. 是否有管理员权限（某些系统需要）
2. 安全软件是否阻止Hook
3. 查看日志中的错误消息

### Q: 内存仍在增长？

检查：
1. 消息泵线程是否正常启动（查看日志）
2. 是否有其他内存泄漏源（截图、进程监控等）
3. 使用内存分析工具定位具体问题

### Q: 如何调试原生模块？

```bash
# 编译Debug版本
node-gyp configure --debug
node-gyp build --debug

# 使用Visual Studio附加到进程
# 或查看详细日志输出
```

## 性能优化建议

1. **消息泵睡眠时间**：当前10ms，可根据需要调整
   - 更短：响应更快但CPU占用高
   - 更长：CPU占用低但可能延迟

2. **事件过滤**：仅监控需要的事件类型
   ```cpp
   // mouse_hook.cpp 中已经过滤了移动事件
   // case WM_MOUSEMOVE: // 已注释，避免过多事件
   ```

3. **批量上传**：定期批量上传活动数据，减少网络请求

## 后续改进

- [ ] 添加Hook健康检查机制
- [ ] 实现Hook自动恢复（如果意外停止）
- [ ] 添加性能指标监控
- [ ] 优化消息泵CPU占用
- [ ] 支持动态调整监控间隔

## 相关文件

- `native-event-monitor-win/src/message_pump.h`
- `native-event-monitor-win/src/message_pump.cpp`
- `native-event-monitor-win/src/event_monitor.cpp`
- `native-event-monitor-win/binding.gyp`
- `platforms/windows/windows-adapter.ts`
- `common/services/activity-collector-service.ts`
