# 模拟预编译Windows原生模块

⚠️  **重要提示**: 这是用于测试集成流程的模拟模块，不提供真实的Windows事件监控功能。

## 模拟内容

- ✅ 预编译模块目录结构
- ✅ 模块加载器 (loader.js)
- ✅ 构建元数据 (build-metadata.json)
- ✅ 模拟原生模块 (event_monitor_mock.js)
- ✅ 安装验证脚本 (verify-installation.js)

## 使用方法

### 1. 验证模拟安装
```bash
cd native-event-monitor-win
node verify-installation.js
```

### 2. 测试应用集成
启动应用程序，应该会看到类似以下的日志：
```
[WIN-NATIVE] 🔍 检测到预编译模块，尝试加载...
[MOCK-PRECOMPILED] 模块可用性检查: true
[MOCK-PRECOMPILED] ⚠️  加载模拟预编译Windows原生模块
[MOCK-PRECOMPILED] ✅ 模拟Windows原生模块加载成功
[WIN-NATIVE] ✅ 预编译模块加载成功
```

### 3. 模拟事件监控
模拟模块会自动生成随机的事件计数：
- 键盘事件: 每秒0-2个随机事件
- 鼠标点击: 每秒0-1个随机事件  
- 空闲时间: 0-5000ms随机值

## 与真实预编译模块的区别

| 项目 | 模拟模块 | 真实预编译模块 |
|------|----------|----------------|
| 文件类型 | .js文件 | .node文件 (C++编译后) |
| 事件检测 | 随机生成 | 真实Windows Hook API |
| 性能 | JavaScript | 原生C++性能 |
| 依赖 | 无 | Windows API依赖 |

## 下一步

1. **测试集成流程**: 验证应用程序能正确检测和加载预编译模块
2. **构建流程测试**: 验证electron-builder能正确打包预编译文件
3. **实际预编译**: 在Windows环境中运行真实的预编译脚本
4. **生产部署**: 使用真实的预编译模块替换模拟版本

## 故障排除

如果遇到问题：
1. 检查文件权限
2. 确认Node.js版本兼容性
3. 验证目录结构完整性
4. 查看详细的错误日志
