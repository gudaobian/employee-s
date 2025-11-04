# Employee Monitoring Client - New Architecture

这是基于三层架构重构后的Employee Monitoring Client，遵循`main/`、`common/`、`platforms/`的标准结构。

## 🏗️ 架构概述

```
employee-client-new/
├── main/                           # 主进程层
│   ├── cli.ts                      # CLI主入口
│   ├── platform-factory.ts         # 平台工厂
│   └── ...
├── common/                         # 跨平台共享层
│   ├── config/                     # 配置管理
│   ├── interfaces/                 # 统一接口定义
│   ├── services/                   # 核心服务
│   ├── types/                      # 类型定义
│   └── utils/                      # 工具函数
└── platforms/                      # 平台特定实现层
    ├── common/                     # 平台通用基类
    ├── macos/                      # macOS特定实现
    └── windows/                    # Windows特定实现
```

## 🚀 快速开始

### 安装依赖

```bash
cd employee-client-new
npm install
```

### 构建项目

```bash
npm run build
```

### 运行CLI

```bash
# 开发模式
npm run dev:cli

# 或直接运行TypeScript
npx ts-node main/cli.ts --help
```

## 📋 CLI命令

### 基本命令

```bash
# 启动监控客户端
employee-monitor-new start

# 查看运行状态  
employee-monitor-new status

# 设备信息
employee-monitor-new device info

# 配置管理
employee-monitor-new config show
employee-monitor-new config set <key> <value>
employee-monitor-new config reset --confirm

# 健康检查
employee-monitor-new health

# 截图测试
employee-monitor-new screenshot -f png -q 80 -o test.png
```

### 高级选项

```bash
# 后台模式启动
employee-monitor-new start --daemon

# JSON格式输出设备信息
employee-monitor-new device info --json
```

## 🔧 开发指南

### 项目结构

- **main/**: 应用主入口和平台工厂
- **common/interfaces/**: 统一接口定义，确保跨平台一致性
- **common/config/**: 配置管理服务
- **common/services/**: 核心业务服务
- **platforms/**: 平台特定实现，通过接口实现统一API

### 添加新平台

1. 在`platforms/`下创建新平台目录
2. 实现`IPlatformAdapter`接口
3. 在`PlatformFactory`中注册新平台

### 添加新服务

1. 在`common/interfaces/`定义服务接口
2. 在`common/services/`实现跨平台服务
3. 在平台特定目录实现平台相关功能

## 🧪 测试

```bash
# 运行测试
npm test

# 监听模式
npm run test:watch
```

## 🔍 调试

```bash
# 开发模式启动（带调试信息）
NODE_ENV=development npx ts-node main/cli.ts start

# 查看详细配置
employee-monitor-new config show
```

## 📊 架构优势

### 🎯 清晰分层
- **main/**: 应用入口，处理命令行和初始化
- **common/**: 跨平台共享，提供统一服务
- **platforms/**: 平台特定，封装系统差异

### 🔌 可扩展性
- 新平台支持：只需实现`IPlatformAdapter`
- 新功能添加：通过接口扩展，保持兼容
- 服务解耦：独立的服务模块，便于测试和维护

### 🛡️ 健壮性
- 统一错误处理
- 配置验证和默认值
- 权限检查和降级策略
- 资源自动清理

## 🔗 与原版本的差异

### 改进点

1. **目录结构规范化**: 遵循三层架构标准
2. **接口标准化**: 统一的平台接口定义
3. **配置管理增强**: 更灵活的配置系统
4. **错误处理改进**: 统一的错误处理机制
5. **平台适配优化**: 更好的跨平台兼容性

### 迁移指南

原版本路径 → 新版本路径：
- `src/shared/config/` → `common/config/`
- `src/shared/services/` → `common/services/`
- `src/shared/utils/` → `common/utils/`
- `src/platforms/darwin/` → `platforms/macos/`

## 📝 待完成功能

- [ ] FSM状态机服务迁移
- [ ] 数据同步服务实现
- [ ] WebSocket服务集成
- [ ] 完整的错误处理系统
- [ ] 单元测试覆盖
- [ ] 文档完善

## 🤝 贡献指南

1. 遵循现有的架构模式
2. 实现相应的接口
3. 添加适当的错误处理
4. 编写单元测试
5. 更新文档

## 🌐 Browser URL Collection

### Features

- ✅ Privacy-first URL sanitization
- ✅ Cross-platform permission detection
- ✅ Firefox multi-level fallback strategy
- ✅ Tamper detection and monitoring
- ✅ GDPR-compliant data handling

### Quick Start

```bash
# Verify system requirements
npm run test:health

# Run URL collection
npm run dev

# Run integration tests
npm test

# Performance benchmarks
npm run test:performance
```

### Platform Support

| Platform | Browser | Success Rate | Notes |
|----------|---------|--------------|-------|
| macOS | Safari | 85-95% | Requires Accessibility permission |
| macOS | Chrome | 80-90% | Requires Accessibility permission |
| macOS | Firefox | 40-60% | Best effort, multi-fallback |
| macOS | Edge | 75-85% | Requires Accessibility permission |
| Windows | Chrome | 75-85% | Requires UI Automation |
| Windows | Edge | 75-85% | Requires UI Automation |
| Windows | Firefox | 50-70% | Best effort |

### Privacy Protection

All URLs are sanitized:
- Query parameters stripped (except whitelist)
- Sensitive domains redacted (email, banking, healthcare)
- Pattern-based filtering (tokens, passwords, API keys)
- Configurable privacy levels (Minimal, Default, Strict)

**Example**:
```typescript
// Input
https://example.com/api?token=abc123&page=1

// Output (with DEFAULT_PRIVACY_CONFIG)
https://example.com/api?page=1

// Sensitive domain input
https://mail.google.com/mail/u/0/#inbox

// Output
[REDACTED_SENSITIVE]
```

### Documentation

- 📖 [Deployment Guide](docs/deployment-guide.md) - Complete deployment instructions for macOS and Windows
- 🔧 [Troubleshooting Guide](docs/troubleshooting.md) - Solutions for common issues
- 🧪 [Testing Guide](test/integration/browser-url-collection.test.ts) - Integration test examples

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- test/integration/browser-url-collection.test.ts
npm test -- test/integration/firefox-collection.test.ts
npm test -- test/unit/privacy-helper.test.ts

# Performance benchmarks
npm run test:performance
```

---

## 📄 许可证

MIT License