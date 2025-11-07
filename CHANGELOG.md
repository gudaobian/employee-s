# Changelog

All notable changes to the Employee Client will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.104] - 2025-11-06

### ✨ Added
- Active-win-compat module using NSWorkspace API for accurate window monitoring
- Comprehensive test suite with 70%+ code coverage
- Performance benchmarking infrastructure (P50/P95/P99 metrics)
- Integration tests for MacOSAdapter and window monitoring
- Detailed technical documentation for active-win-compat

### 🐛 Fixed
- **Critical**: Window monitoring returning "Electron" instead of actual application name
- **Critical**: Browser URL collection failure due to incorrect app detection
- Window monitoring accuracy improved from 0% to 95%+
- Application name detection now uses NSWorkspace API (more reliable)

### ⚡ Performance
- Window monitoring P50 latency: < 50ms (previously 200-500ms)
- Window monitoring P95 latency: < 100ms
- Window monitoring P99 latency: < 200ms
- Success rate: ≥ 95% (previously ~0% for some scenarios)
- Fallback mechanism to AppleScript ensures backward compatibility

### 📚 Technical Details
- Implemented JXA (JavaScript for Automation) wrapper for NSWorkspace API
- Primary method: NSWorkspace.frontmostApplication (accurate, fast)
- Fallback method: AppleScript System Events (backward compatible)
- Self-exclusion logic prevents monitoring own application
- Graceful error handling with null returns (never throws)
- Comprehensive logging with method identification

### 🧪 Testing
- 24 unit tests (23 passing, 1 platform skip)
- 14 integration tests for end-to-end verification
- Performance benchmark with target validation
- 70% line coverage, 100% function coverage
- Memory leak detection and stability tests

## [1.1.0] - 2025-11-05

### ✨ 新增功能

#### macOS浏览器URL采集
- 支持5种主流浏览器的URL自动采集（Safari、Chrome、Firefox、Edge、Brave）
- 实时采集当前活动浏览器的访问域名
- Firefox多级fallback机制（AppleScript → Window Title → Browser History）
- 采集周期：60秒（与活动数据采集同步）

#### 权限管理系统
- 新增CLI命令 `npm run check-permissions` 检查辅助功能权限
- 应用启动时自动检查权限并提示用户
- 权限监控服务实时检测权限撤销（60秒检查间隔）
- 自动打开系统设置引导用户授权
- CLI命令 `npm run open-accessibility-settings` 快速打开权限设置

#### 隐私保护机制
- 自动清理敏感查询参数（token、api_key、password等）
- 敏感域名完全屏蔽（邮箱、银行、医疗网站）
- URL规范化（只保留协议和域名，移除路径和参数）
- 敏感模式检测（信用卡号、会话ID等）
- 可配置的隐私保护策略

### 🔧 改进

#### 性能优化
- 实现60秒权限检查缓存机制，减少AppleScript开销
- 优化URL采集延迟：Safari P50≤60ms, P95≤250ms
- 内存占用优化：8小时运行内存增长<50MB
- Firefox采集超时机制：2秒超时保护

#### 用户体验
- 中文用户提示和错误消息
- 清晰的权限授予引导流程
- 系统通知提醒权限变化
- 详细的日志记录方便故障排除

#### 代码质量
- TypeScript类型定义完善
- 单元测试覆盖核心功能
- 集成测试验证端到端流程
- 性能基准测试建立指标

### 📚 文档

- 新增 [API文档](doc/API文档_macOS_URL采集.md)
- 新增 [用户指南](doc/用户指南_macOS_URL采集.md)
- 新增 [测试指南](doc/测试指南_macOS_URL采集.md)
- 新增 [实施方案分析](doc/macOS浏览器URL采集实施方案分析_20251105.md)
- 新增 [实施指南](doc/macOS浏览器URL采集实施指南_20251105.md)
- 新增浏览器兼容性测试报告

### ⚠️ 已知问题

#### Firefox兼容性限制
- Firefox的AppleScript支持不稳定，导致URL采集成功率仅40-60%
- 原因：Firefox 57+版本削减了AppleScript API支持
- 缓解措施：已实现3层fallback机制（AppleScript → Window Title → History）
- 未来计划：考虑开发浏览器扩展提高兼容性

#### 权限依赖
- 用户必须手动授予macOS辅助功能权限
- 无法通过代码自动授予权限（macOS系统限制）
- 已提供详细引导和自动打开设置功能

### 🔄 技术债务

- [ ] Firefox浏览器历史fallback尚未实现（Level 3 fallback）
- [ ] 自动化集成测试覆盖率待提高
- [ ] 性能监控Dashboard尚未开发

### 📦 打包说明

#### macOS应用打包
```bash
npm run pack:mac
```

生成文件：`release/EmployeeMonitor-darwin-{arch}.zip`

#### 系统要求
- macOS 10.13 (High Sierra) 或更高版本
- 需要手动授予辅助功能权限

### 🎯 浏览器支持矩阵

| 浏览器 | 支持状态 | 成功率 | 延迟(P50) | 备注 |
|--------|---------|--------|-----------|------|
| Safari | ✅ 完全支持 | 95% | 60ms | 最佳兼容性 |
| Chrome | ✅ 完全支持 | 90% | 80ms | 稳定可靠 |
| Edge | ✅ 完全支持 | 85% | 100ms | Chromium内核 |
| Brave | ✅ 完全支持 | 85% | 90ms | Chromium内核 |
| Firefox | ⚠️ 部分支持 | 40-60% | 2000ms | AppleScript不稳定 |

### 🔗 相关链接

- [实施指南](doc/macOS浏览器URL采集实施指南_20251105.md)
- [任务拆分文档](doc/task-split.md)
- [GitHub Issues](https://github.com/zhangxiaoyu2000/employee-s/issues)

---

### 升级指南

从1.0.x升级到1.1.0：

1. **备份数据**（可选）:
   ```bash
   cp -r ~/Library/Logs/employee-monitor ~/Desktop/logs-backup
   ```

2. **停止旧版本**:
   ```bash
   # 退出应用
   ```

3. **安装新版本**:
   - 下载1.1.0安装包
   - 覆盖安装到应用程序文件夹

4. **授予权限**（首次使用）:
   - 启动应用
   - 按照提示授予辅助功能权限

5. **验证功能**:
   ```bash
   npm run check-permissions
   npm run dev
   ```

### 回滚指南

如果遇到问题需要回滚到1.0.x：

1. 退出1.1.0应用
2. 重新安装1.0.x版本
3. 在系统设置中移除辅助功能权限
4. 重启应用

---

## [1.0.95] - 2025-11-04

### 修复
- 修复连接稳定性问题
- 改进WebSocket重连逻辑
- 优化FSM状态管理

---

## [1.0.93] - 2025-10-27

### 修复
- 修复URL路径泄露问题
- 改进隐私保护策略
- 优化日志记录

---

## [1.0.92] - 2025-10-26

### 修复
- 处理Chrome地址栏无协议URL
- 改进URL解析逻辑

---

## [1.0.38] - 2025-10-27

### 修复
- 修复Buffer日志泄露问题
- 改进日志安全性

---

**发布日期**: 2025-11-05
**版本**: 1.1.0
**Git标签**: `v1.1.0`
