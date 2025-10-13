# Employee Monitor 部署指南

## 📋 概述

本指南说明如何使用GitHub Actions自动化构建和部署Employee Monitor Windows/macOS客户端，包括新修复的Windows原生事件监控模块。

## 🔧 前提条件

### 代码提交要求
- ✅ 所有代码已提交到GitHub仓库
- ✅ 包含新的 `message_pump.cpp/h` 文件
- ✅ `binding.gyp` 已更新包含 `message_pump.cpp`

### GitHub仓库配置
1. **Secrets配置**：
   - `GITHUB_TOKEN` (自动提供，无需配置)

2. **权限设置**：
   - Settings → Actions → General → Workflow permissions
   - 选择 "Read and write permissions"
   - 勾选 "Allow GitHub Actions to create and approve pull requests"

## 🚀 部署方式

### 方式1：标签触发（推荐用于正式发布）

创建并推送版本标签自动触发构建：

```bash
# 进入employee-client目录
cd employee-client

# 确保所有更改已提交
git add .
git commit -m "fix: add Windows message pump for Hook support"

# 创建版本标签
git tag -a v2.1.0 -m "Version 2.1.0 - Fix Windows activity detection"

# 推送标签到远程
git push origin v2.1.0
```

**触发条件**：推送格式为 `v*.*.*` 的标签

**自动流程**：
1. ✅ 在Windows Runner上预编译原生模块（包含message_pump）
2. ✅ 构建Windows安装包
3. ✅ 创建GitHub Release
4. ✅ 上传安装包到Release

### 方式2：手动触发（用于测试/预发布）

在GitHub网页界面触发工作流：

1. 进入仓库页面
2. 点击 **Actions** 标签
3. 选择 **"Build and Release Employee Monitor"** 工作流
4. 点击 **"Run workflow"** 按钮
5. 填写参数：
   - **version**: 版本号（如 `v2.1.0-beta`）
   - **prerelease**: 是否标记为预发布（测试版选 `true`）
6. 点击 **"Run workflow"** 开始构建

**适用场景**：
- 🧪 测试构建配置
- 📦 创建预发布版本
- 🔧 调试构建问题

### 方式3：推送触发预编译（仅编译原生模块）

推送代码到特定分支触发原生模块预编译：

```bash
# 推送到main或develop分支
git push origin main

# 或推送到develop分支
git push origin develop
```

**触发条件**：
- 推送到 `main` 或 `develop` 分支
- 修改了以下路径的文件：
  - `native-event-monitor-win/**`
  - `scripts/precompile-windows-native.js`
  - `.github/workflows/precompile-windows-native.yml`

**自动流程**：
1. ✅ 预编译Windows原生模块
2. ✅ 上传预编译工件（保留30天）
3. ⚠️ 不创建Release

## 📦 构建产物

### Windows构建产物

构建成功后会生成以下文件：

```
release/
├── Employee-Monitor-Setup-2.1.0.exe    # Windows安装程序（推荐）
├── Employee-Monitor-2.1.0-win.zip      # Windows便携版
└── Employee-Monitor-2.1.0.msi          # MSI安装包（可选）
```

### macOS构建产物（手动触发时）

```
release/
├── Employee-Monitor-2.1.0.dmg          # macOS磁盘映像
└── Employee-Monitor-2.1.0-mac.zip      # macOS压缩包
```

### 原生模块工件

```
precompiled-native-modules/
├── event_monitor.node                  # 编译的原生模块
├── build-metadata.json                 # 构建元数据
└── loader.js                          # 模块加载器
```

## 🔍 监控构建过程

### 查看构建状态

1. 进入仓库的 **Actions** 标签
2. 找到对应的工作流运行
3. 查看各个Job的执行状态：
   - **Precompile Native Modules** - 原生模块编译
   - **Build Windows Application** - Windows应用构建
   - **Build macOS Application** - macOS应用构建（可选）
   - **Create GitHub Release** - 创建发布
   - **Notify Build Completion** - 完成通知

### 关键检查点

#### 1. 原生模块编译阶段
```
✅ Setup Visual Studio Build Tools
✅ Install native module dependencies
✅ Run native module precompilation
   - 包含 message_pump.cpp 编译
   - 生成 event_monitor.node
✅ Verify native module
✅ Upload precompiled native modules
```

#### 2. Windows应用构建阶段
```
✅ Download precompiled native modules
✅ Install application dependencies
✅ Build TypeScript
✅ Create application bundle
   - electron-builder 打包
   - 包含预编译的原生模块
✅ Upload Windows build artifacts
```

#### 3. Release创建阶段
```
✅ Download Windows artifacts
✅ Prepare release notes
✅ Create GitHub Release
   - 上传 .exe 安装包
   - 上传 .zip 便携版
   - 包含原生模块构建信息
```

## 📥 下载和安装

### 从GitHub Release下载

发布完成后：

1. 进入仓库的 **Releases** 页面
2. 找到对应版本（如 `v2.1.0`）
3. 在 **Assets** 部分下载：
   - Windows: `Employee-Monitor-Setup-2.1.0.exe`
   - macOS: `Employee-Monitor-2.1.0.dmg`

### Release信息示例

```markdown
# Employee Monitor v2.1.0

## 🚀 新版本发布

### 📦 安装包

**Windows 用户：**
- Employee-Monitor-Setup-v2.1.0.exe - Windows 安装程序（推荐）
- Employee-Monitor-v2.1.0-win.zip - Windows 便携版

### ✨ 主要特性

- 🖥️ 跨平台支持（Windows、macOS）
- 📊 实时活动监控
- 🐛 修复Windows键盘鼠标检测问题
- 🔧 添加消息泵支持Hook事件处理
- 💾 解决内存泄漏问题

### 🔧 技术信息

- **构建时间**: 2025-10-08 11:30:00 UTC
- **提交哈希**: abc123...
- **Node.js 版本**: 22
- **原生模块**: ✅ 原生编译成功
```

## 🐛 故障排除

### 构建失败常见问题

#### 1. 原生模块编译失败

**症状**：
```
❌ Failed to compile native module
Error: MSB8020: The build tools for v142 cannot be found
```

**解决方案**：
- 检查 `microsoft/setup-msbuild@v2` 配置
- 确认Visual Studio Build Tools版本匹配
- 查看构建日志中的详细错误信息

#### 2. TypeScript编译错误

**症状**：
```
❌ npm run compile failed
TS2304: Cannot find name 'MessagePump'
```

**解决方案**：
- 确认所有新文件已提交到仓库
- 检查 `binding.gyp` 包含所有源文件
- 清理本地缓存重新构建

#### 3. electron-builder打包失败

**症状**：
```
❌ npm run pack:win failed
Cannot read properties of undefined
```

**解决方案**：
- 检查 `package.json` 中的 `build` 配置
- 确认所有依赖已正确安装
- 验证 `GH_TOKEN` 环境变量设置

#### 4. Release创建失败

**症状**：
```
❌ Create GitHub Release failed
Resource not accessible by integration
```

**解决方案**：
- 检查仓库的Actions权限设置
- 确认 `GITHUB_TOKEN` 有写入权限
- 验证标签格式正确（`v*.*.*`）

### 获取详细日志

1. 点击失败的Job
2. 展开每个步骤查看详细输出
3. 下载 **build-logs** 工件查看完整日志
4. 检查 **Upload build logs** 步骤的内容

## 🔒 安全考虑

### Secrets管理
- ❌ 不要在代码中硬编码密钥
- ✅ 使用GitHub Secrets存储敏感信息
- ✅ 定期轮换访问令牌

### 代码签名（可选）
对于生产环境，建议配置代码签名：

```yaml
# .github/workflows/build-and-release.yml
- name: Sign Windows executable
  run: |
    signtool sign /f ${{ secrets.CERT_FILE }} \
      /p ${{ secrets.CERT_PASSWORD }} \
      /tr http://timestamp.digicert.com \
      release/*.exe
```

需要配置的Secrets：
- `CERT_FILE`: 代码签名证书（Base64编码）
- `CERT_PASSWORD`: 证书密码

## 📊 构建统计

### 预期构建时间

| 阶段 | 预计时间 |
|------|---------|
| 预编译原生模块 | 5-10分钟 |
| 构建Windows应用 | 10-15分钟 |
| 构建macOS应用 | 10-15分钟 |
| 创建Release | 2-5分钟 |
| **总计** | **15-30分钟** |

### 资源消耗

- **Windows Runner**: ~2GB RAM, ~10GB 磁盘
- **macOS Runner**: ~2GB RAM, ~10GB 磁盘
- **工件存储**: ~50-100MB per build

## 🔄 持续改进

### 优化构建速度

1. **启用缓存**：
   - npm依赖缓存
   - 原生模块构建缓存
   - electron缓存

2. **并行构建**：
   - 多平台同时构建
   - 矩阵策略编译多版本

3. **增量构建**：
   - 只在相关文件变更时触发
   - 使用路径过滤

### 添加自动测试

在构建前运行测试：

```yaml
- name: Run tests
  run: |
    npm run test
    npm run test:integration
```

### 通知集成

添加构建通知（可选）：

```yaml
- name: Notify on Slack
  if: always()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

## 📞 支持

遇到问题时：

1. 📖 查看本文档的故障排除部分
2. 🔍 检查GitHub Actions日志
3. 📝 查看 `claudedocs/windows-hook-fix.md` 技术细节
4. 🐛 在仓库创建Issue报告问题

## 🎯 快速开始检查清单

部署前确认：

- [ ] 所有代码已提交到GitHub
- [ ] `binding.gyp` 包含 `message_pump.cpp`
- [ ] GitHub Actions权限已配置
- [ ] 版本号已更新
- [ ] 创建并推送版本标签
- [ ] 监控Actions执行状态
- [ ] 验证Release创建成功
- [ ] 下载并测试安装包

完成以上步骤后，您的Windows活动监控修复将自动部署到生产环境！
