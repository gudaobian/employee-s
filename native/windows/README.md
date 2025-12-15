# Windows Native Event Monitor

Windows平台原生键盘和鼠标事件监控模块，使用Windows Hook API实现真实事件检测。

## 功能特性

- ✅ 实时键盘事件检测（WH_KEYBOARD_LL）
- ✅ 实时鼠标点击检测（WH_MOUSE_LL）
- ✅ 系统空闲时间检测
- ✅ 低级Hook实现，性能优化
- ✅ C++17标准，兼容现代Electron
- ✅ 完整的错误处理和调试支持

## 系统要求

### Windows版本
- Windows 7 SP1 或更高版本
- Windows Server 2008 R2 或更高版本

### 开发环境
- Node.js 16.0.0 或更高版本
- Visual Studio Build Tools 2019 或更高版本
- Python 2.7 或 3.x
- node-gyp 10.0.0 或更高版本

## 安装依赖

### 安装Visual Studio Build Tools
```bash
# 选项1：安装完整的Visual Studio Community
# 下载并安装 Visual Studio Community 2019/2022

# 选项2：仅安装Build Tools
# 下载并安装 Build Tools for Visual Studio 2019/2022
# 确保选择 "C++ build tools" 工作负载
```

### 安装Python
```bash
# 选项1：从Microsoft Store安装
# 搜索并安装 Python 3.x

# 选项2：从python.org下载安装包
# 确保添加到PATH环境变量
```

### 配置npm
```bash
# 设置Python路径（如果需要）
npm config set python python

# 设置Visual Studio版本（如果需要）
npm config set msvs_version 2019
```

## 编译安装

### 自动编译
```bash
cd native-event-monitor-win
npm install
```

### 手动编译
```bash
cd native-event-monitor-win
npm run build
```

### 测试安装
```bash
npm test
```

## 使用方法

### 基本用法
```javascript
const eventMonitor = require('./native-event-monitor-win');

// 启动监控
if (eventMonitor.start()) {
    console.log('事件监控已启动');
} else {
    console.log('事件监控启动失败');
}

// 获取事件计数
const counts = eventMonitor.getCounts();
console.log('键盘事件:', counts.keyboard);
console.log('鼠标点击:', counts.mouseClicks);
console.log('系统空闲时间:', counts.idleTime + 'ms');
console.log('监控状态:', counts.isMonitoring);

// 重置计数
eventMonitor.resetCounts();

// 停止监控
eventMonitor.stop();
```

### 高级用法（使用TypeScript适配器）
```typescript
import WindowsNativeEventAdapter from './src/native-event-adapter';

const adapter = new WindowsNativeEventAdapter();

// 检查模块可用性
if (adapter.isAvailable()) {
    // 启动监控
    await adapter.startMonitoring();
    
    // 获取详细状态
    const status = await adapter.getDetailedStatus();
    console.log('监控状态:', status);
    
    // 获取事件速率
    const rates = await adapter.getEventRates();
    console.log('键盘速率:', rates.keyboardRate + ' events/sec');
    console.log('鼠标速率:', rates.mouseClickRate + ' events/sec');
    
    // 清理
    await adapter.cleanup();
}
```

## API参考

### 原生模块方法

#### `start(): boolean`
启动事件监控。

**返回值:** 
- `true` - 启动成功
- `false` - 启动失败

#### `stop(): boolean`
停止事件监控。

**返回值:**
- `true` - 停止成功
- `false` - 停止失败

#### `getCounts(): object`
获取当前事件计数。

**返回值:**
```javascript
{
    keyboard: number,      // 键盘事件计数
    mouseClicks: number,   // 鼠标点击计数
    idleTime: number,      // 系统空闲时间（毫秒）
    isMonitoring: boolean  // 监控状态
}
```

#### `resetCounts(): boolean`
重置所有事件计数。

**返回值:**
- `true` - 重置成功
- `false` - 重置失败

#### `isMonitoring(): boolean`
检查监控状态。

**返回值:**
- `true` - 正在监控
- `false` - 未在监控

## 权限要求

### 用户权限
- 普通用户权限即可运行
- 某些企业环境可能需要管理员权限

### 系统权限
- 需要设置全局Hook（WH_KEYBOARD_LL, WH_MOUSE_LL）
- 需要访问系统输入信息（GetLastInputInfo）

### 防病毒软件
部分防病毒软件可能会检测到Hook行为，需要添加白名单。

## 故障排除

### 编译错误

#### MSB8020错误
```
错误: The build tools for v142 (Platform Toolset = 'v142') cannot be found.
解决: 安装Visual Studio Build Tools 2019或更高版本
```

#### Python错误
```
错误: gyp ERR! stack Error: Python executable "python" is not a Python 2 or 3.
解决: 
1. 安装Python 2.7或3.x
2. 运行: npm config set python python
```

#### node-gyp错误
```
错误: gyp ERR! not ok
解决:
1. 清理构建缓存: npm run clean
2. 重新安装: npm install --build-from-source
3. 检查Visual Studio和Python安装
```

### 运行时错误

#### 模块加载失败
```
错误: Cannot find module './build/Release/event_monitor.node'
解决:
1. 重新编译: npm run build
2. 检查编译输出目录
3. 尝试Debug版本: ./build/Debug/event_monitor.node
```

#### Hook安装失败
```
错误: Failed to install keyboard/mouse hook
解决:
1. 以管理员权限运行
2. 检查防病毒软件设置
3. 添加应用程序到白名单
```

### 性能问题

#### 高CPU使用率
- 检查是否监控了鼠标移动事件（默认已禁用）
- 调整事件采集频率
- 检查其他应用程序冲突

#### 内存泄漏
- 确保调用stop()方法停止监控
- 检查Hook是否正确卸载
- 监控内存使用情况

## 开发指南

### 项目结构
```
native-event-monitor-win/
├── src/
│   ├── event_monitor.cpp     # 主要事件监控逻辑
│   ├── keyboard_hook.cpp     # 键盘Hook实现
│   ├── keyboard_hook.h       # 键盘Hook头文件
│   ├── mouse_hook.cpp        # 鼠标Hook实现
│   ├── mouse_hook.h          # 鼠标Hook头文件
│   ├── idle_detector.cpp     # 空闲时间检测
│   ├── idle_detector.h       # 空闲时间检测头文件
│   └── native-event-adapter.ts # TypeScript适配器
├── binding.gyp               # 构建配置
├── package.json              # 包配置
├── build.js                  # 构建脚本
├── index.js                  # 模块入口
└── README.md                 # 说明文档
```

### 添加新功能
1. 在相应的.cpp/.h文件中实现功能
2. 在event_monitor.cpp中导出JavaScript接口
3. 在native-event-adapter.ts中添加TypeScript封装
4. 更新测试和文档

### 调试模式
编译时启用调试输出：
```bash
# Windows
set DEBUG=1 && npm run build

# 在代码中使用
#ifdef _DEBUG
std::cout << "Debug message" << std::endl;
#endif
```

## 许可证

本项目使用MIT许可证。

## 技术支持

如遇问题，请检查：
1. 系统要求是否满足
2. 依赖是否正确安装
3. 权限是否充足
4. 防病毒软件设置

详细错误信息请查看编译日志和运行时日志。