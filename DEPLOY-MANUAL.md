# 手动部署命令速查

如果不使用自动部署脚本，可以使用以下命令手动触发部署。

## 🚀 快速部署（推荐）

```bash
# 使用自动部署脚本
./DEPLOY.sh
```

脚本会自动：
- ✅ 检查未提交的更改
- ✅ 推荐版本号
- ✅ 创建和推送标签
- ✅ 触发GitHub Actions构建

## 📝 手动部署步骤

### 1. 提交所有更改

```bash
# 查看状态
git status

# 添加所有更改
git add .

# 提交
git commit -m "fix: add Windows message pump for Hook support"
```

### 2. 推送到远程

```bash
# 推送当前分支
git push origin main

# 或推送到develop分支
git push origin develop
```

### 3. 创建版本标签

```bash
# 创建标签 (格式: v主版本.次版本.补丁版本)
git tag -a v2.1.0 -m "Version 2.1.0 - Fix Windows activity detection"

# 推送标签（触发构建）
git push origin v2.1.0
```

## 🏷️ 版本号规范

遵循语义化版本控制 (Semantic Versioning):

```
v主版本.次版本.补丁版本[-预发布标识]

示例:
- v2.0.0      主要版本 (破坏性更新)
- v2.1.0      次要版本 (新功能)
- v2.1.1      补丁版本 (bug修复)
- v2.1.0-beta 预发布版本
- v2.1.0-rc.1 候选发布版本
```

### 版本类型选择

| 更新类型 | 版本号变化 | 使用场景 |
|---------|-----------|---------|
| 主要版本 | 1.0.0 → 2.0.0 | 架构重构、破坏性API更改 |
| 次要版本 | 1.0.0 → 1.1.0 | 新功能、向后兼容 |
| 补丁版本 | 1.0.0 → 1.0.1 | bug修复、性能优化 |

### 本次修复建议

```bash
# Windows活动检测修复 - 推荐使用次要版本或补丁版本
git tag -a v2.1.0 -m "Version 2.1.0
- Fix Windows keyboard and mouse detection
- Add message pump for Hook support
- Fix memory leak issue"

git push origin v2.1.0
```

## 🎯 触发方式对比

### 方式1: 标签触发（正式发布）

```bash
# 创建并推送标签
git tag -a v2.1.0 -m "Release message"
git push origin v2.1.0
```

**结果**：
- ✅ 完整构建流程
- ✅ 自动创建GitHub Release
- ✅ 上传安装包
- ✅ 生成Release说明

**适用于**: 正式版本发布

### 方式2: 手动触发（测试/预发布）

1. 访问: `https://github.com/你的用户名/employee-monitering-master/actions`
2. 选择 "Build and Release Employee Monitor"
3. 点击 "Run workflow"
4. 填写参数：
   - version: `v2.1.0-beta`
   - prerelease: `true`
5. 点击 "Run workflow"

**结果**：
- ✅ 完整构建流程
- ✅ 创建预发布Release
- ⚠️ 标记为Pre-release

**适用于**: 测试版本、内部验证

### 方式3: 推送触发（仅预编译）

```bash
# 推送代码到特定分支
git push origin main
```

**触发条件**:
- 修改了 `native-event-monitor-win/**` 路径
- 修改了 `scripts/precompile-windows-native.js`
- 修改了 `.github/workflows/precompile-windows-native.yml`

**结果**：
- ✅ 仅编译原生模块
- ✅ 上传预编译工件
- ❌ 不创建Release

**适用于**: 测试原生模块编译

## 🔍 检查构建状态

### 命令行检查

```bash
# 使用GitHub CLI (需要安装gh)
gh workflow view "Build and Release Employee Monitor"

# 查看最近的运行记录
gh run list --workflow="Build and Release Employee Monitor"

# 查看特定运行的日志
gh run view <run-id> --log
```

### 网页检查

1. **Actions页面**: `https://github.com/你的用户名/employee-monitering-master/actions`
2. **选择工作流**: "Build and Release Employee Monitor"
3. **查看运行记录**: 点击对应的运行
4. **查看日志**: 展开各个Job查看详细日志

## 📦 下载构建产物

### 从GitHub Release下载

```bash
# 使用GitHub CLI下载
gh release download v2.1.0

# 或指定特定文件
gh release download v2.1.0 -p "*.exe"

# 或使用浏览器
# https://github.com/你的用户名/employee-monitering-master/releases/tag/v2.1.0
```

### 从Actions工件下载

```bash
# 列出工件
gh run view <run-id> --log

# 下载工件
gh run download <run-id>

# 或在网页下载
# Actions → 选择运行 → Artifacts部分
```

## 🔧 常用Git命令

### 标签管理

```bash
# 列出所有标签
git tag

# 列出匹配的标签
git tag -l "v2.*"

# 查看标签详情
git show v2.1.0

# 删除本地标签
git tag -d v2.1.0

# 删除远程标签
git push origin :refs/tags/v2.1.0
# 或
git push --delete origin v2.1.0

# 重新创建标签
git tag -a v2.1.0 -m "New message" -f
git push origin v2.1.0 -f
```

### 分支管理

```bash
# 查看当前分支
git branch

# 查看所有分支
git branch -a

# 切换分支
git checkout main

# 创建并切换分支
git checkout -b feature/new-feature

# 合并分支
git merge feature/new-feature
```

### 查看历史

```bash
# 查看提交历史
git log --oneline --graph --all

# 查看标签历史
git log --tags --simplify-by-decoration --pretty="format:%ai %d"

# 查看最近10次提交
git log -10 --oneline
```

## ⚡ 快捷命令别名

添加到 `~/.gitconfig` 或 `~/.bashrc`:

```bash
# Git别名
alias gs='git status'
alias ga='git add .'
alias gc='git commit -m'
alias gp='git push'
alias gt='git tag'
alias gta='git tag -a'
alias gpt='git push --tags'

# 部署相关
alias deploy='./DEPLOY.sh'
alias deploy-check='gh run list --workflow="Build and Release Employee Monitor" --limit 5'
alias deploy-logs='gh run view --log'
```

使用示例：

```bash
# 快速提交和推送
ga && gc "fix: update code" && gp

# 创建标签
gta v2.1.0 -m "Release v2.1.0"

# 推送标签
gpt

# 检查构建
deploy-check
```

## 📋 部署前检查清单

在执行部署前，请确认：

- [ ] 所有代码已提交
- [ ] 测试通过
- [ ] 版本号已确定
- [ ] Release说明已准备
- [ ] `binding.gyp` 包含 `message_pump.cpp`
- [ ] GitHub Actions权限已配置
- [ ] 网络连接正常

## 🆘 回滚部署

如果部署出现问题需要回滚：

```bash
# 1. 删除问题标签
git push --delete origin v2.1.0
git tag -d v2.1.0

# 2. 在GitHub删除Release
gh release delete v2.1.0 --yes

# 3. 回退到上一个版本
git checkout v2.0.0

# 4. 重新发布（如需要）
git tag -a v2.0.1 -m "Hotfix version"
git push origin v2.0.1
```

## 📞 获取帮助

- 📖 查看详细文档: `claudedocs/deployment-guide.md`
- 🔧 技术细节: `claudedocs/windows-hook-fix.md`
- 🌐 GitHub Actions文档: https://docs.github.com/en/actions
- 💬 创建Issue获取支持
