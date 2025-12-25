# 真实端到端安装测试指南

**测试脚本**: `test-real-installation.js`
**用途**: 验证全量更新的安装流程是否能在真实环境中成功执行
**风险级别**: ⚠️ **HIGH** - 会真实替换 `/Applications` 中的应用

---

## ⚠️ 重要警告

**此脚本会执行真实的安装操作：**

- ✅ 会自动备份当前应用（如果存在）
- ⚠️ 会替换 `/Applications/EmployeeSafety.app`
- ✅ 提供回滚机制
- ✅ 详细日志记录

**使用前请确保：**

1. 已保存所有重要数据
2. 理解脚本会修改系统文件
3. 有备份恢复的准备

---

## 📋 前置要求

### 1. 构建更新包

```bash
# 确保已构建最新版本
npm run pack:mac

# 验证构建产物
ls -lh release/EmployeeSafety-1.0.158-arm64-mac.zip
ls -la release/EmployeeSafety-darwin-arm64/EmployeeSafety.app/Contents/Resources/auto-install-update-macos.sh
```

### 2. 检查当前安装

```bash
# 查看当前安装的版本
defaults read /Applications/EmployeeSafety.app/Contents/Info CFBundleShortVersionString

# 或者直接启动应用查看版本号
```

---

## 🚀 运行测试

### 基本用法

```bash
# 进入项目目录
cd /path/to/employee-client

# 运行测试脚本
node test-real-installation.js

# 或者使用执行权限直接运行
./test-real-installation.js
```

### 测试流程

脚本会按顺序执行以下步骤：

#### 步骤 1: 前置条件检查

```
检查项目:
  ✅ 更新包存在 (EmployeeSafety-1.0.158-arm64-mac.zip)
  ✅ 安装脚本存在 (auto-install-update-macos.sh)
  ✅ 脚本可执行 (权限 755)
  ✅ 当前应用 (如果已安装)
```

**可能的问题**:

- ❌ 更新包不存在 → 运行 `npm run pack:mac`
- ❌ 安装脚本不存在 → 检查打包配置
- ❌ 脚本没有执行权限 → 脚本会自动添加

#### 步骤 2: 用户确认

```
⚠️  警告: 即将执行真实安装！
   这会替换 /Applications/EmployeeSafety.app
   已安装的应用将被备份

确认继续？ (yes/no):
```

**输入 `yes` 继续，`no` 取消**

#### 步骤 3: 备份当前应用

```
=== 步骤 1: 备份当前应用 ===

创建备份目录: ./test-backup-1234567890
开始备份，这可能需要几秒钟...
✅ 备份完成，耗时: 3245ms
   备份位置: ./test-backup-1234567890/EmployeeSafety.app
✅ 备份验证通过（大小匹配）
```

**备份机制**:

- 完整复制当前应用到 `test-backup-[timestamp]/`
- 验证备份大小与原始应用一致
- 如果没有已安装应用，跳过备份

#### 步骤 4: 关闭正在运行的应用

```
=== 步骤 2: 关闭正在运行的应用 ===

检测到应用正在运行
   进程ID: 12345
是否关闭正在运行的应用？ (yes/no): yes

尝试优雅关闭应用...
✅ 应用已关闭
```

**关闭策略**:

1. 尝试优雅关闭 (`osascript quit`)
2. 如果失败，强制终止 (`killall -9`)
3. 等待进程完全退出

#### 步骤 5: 执行安装脚本

```
=== 步骤 3: 执行安装脚本 ===

脚本路径: .../auto-install-update-macos.sh
更新包路径: .../EmployeeSafety-1.0.158-arm64-mac.zip
应用名称: EmployeeSafety.app
安装目录: /Applications

开始执行安装脚本...
[脚本输出...]
✅ 安装脚本执行完成，耗时: 15.23s
```

**这一步会真实执行**:

- 解压更新包
- 替换 `/Applications/EmployeeSafety.app`
- 设置权限
- 清理临时文件

#### 步骤 6: 验证安装结果

```
=== 步骤 4: 验证安装结果 ===

✅ 应用已安装: /Applications/EmployeeSafety.app
✅ 可执行文件存在且有执行权限
✅ 安装版本: 1.0.158
✅ 版本号正确
  ✅ Contents/Info.plist
  ✅ Contents/MacOS/EmployeeSafety
  ✅ Contents/Resources/app.asar
```

**验证项目**:

- 应用目录存在
- 可执行文件权限正确
- 版本号为 1.0.158
- Bundle 结构完整

#### 步骤 7: 测试启动应用

```
=== 步骤 5: 测试启动应用 ===

是否尝试启动应用以测试功能？ (yes/no): yes

启动应用...
✅ 应用启动命令已执行

请在应用中验证以下内容:
  1. 应用是否正常启动
  2. 版本号是否显示 1.0.158
  3. 按钮是否为黄色（v1.0.157+ 特征）
  4. 核心功能是否正常

✅ 应用正在运行
```

#### 步骤 8: 清理备份（可选）

```
=== 清理测试文件 ===

是否删除备份文件？ (yes/no): no
备份保留在: ./test-backup-1234567890
```

---

## 📊 测试结果示例

### 成功的测试

```
╔════════════════════════════════════════════════════════════╗
║  测试结果                                                  ║
╚════════════════════════════════════════════════════════════╝

验证结果:
  应用已安装: ✅
  可执行权限: ✅
  版本正确: ✅ (1.0.158)
  Bundle 结构: ✅

🎉 安装测试成功！

后续操作:
  1. 手动验证应用功能
  2. 确认版本号为 1.0.158
  3. 检查按钮颜色（应为黄色）

测试总耗时: 25.67s
日志已保存到: ./test-installation.log
```

### 失败的测试

```
╔════════════════════════════════════════════════════════════╗
║  测试结果                                                  ║
╚════════════════════════════════════════════════════════════╝

验证结果:
  应用已安装: ✅
  可执行权限: ❌
  版本正确: ❌ (1.0.157)
  Bundle 结构: ✅

❌ 安装测试失败！

是否回滚到备份版本？ (yes/no): yes

=== 回滚到备份版本 ===
删除当前安装的应用...
✅ 当前应用已删除
恢复备份...
✅ 备份已恢复
恢复的版本: 1.0.157
```

---

## 🔧 故障排除

### 问题 1: 更新包不存在

**错误**:
```
❌ 找不到更新包: .../release/EmployeeSafety-1.0.158-arm64-mac.zip
   请先运行: npm run pack:mac
```

**解决**:
```bash
npm run pack:mac
```

### 问题 2: 安装脚本没有执行权限

**错误**:
```
❌ 脚本没有执行权限
```

**解决**:
脚本会自动添加执行权限。如果仍然失败：
```bash
chmod 755 release/.../auto-install-update-macos.sh
```

### 问题 3: 应用无法关闭

**错误**:
```
检查应用运行状态失败
```

**解决**:
手动关闭应用：
```bash
# 查看进程
ps aux | grep EmployeeSafety

# 强制关闭
killall -9 EmployeeSafety
```

### 问题 4: 安装脚本执行失败

**错误**:
```
❌ 安装脚本执行失败: Command failed
```

**解决**:
1. 查看详细日志：`cat test-installation.log`
2. 检查脚本内容：`cat .../auto-install-update-macos.sh`
3. 手动执行脚本查看错误：
```bash
bash -x .../auto-install-update-macos.sh \
     .../EmployeeSafety-1.0.158-arm64-mac.zip \
     EmployeeSafety.app \
     /Applications
```

### 问题 5: 版本验证失败

**错误**:
```
⚠️  版本号不是预期的 1.0.158
```

**可能原因**:
1. 打包时 `package.json` 版本不正确
2. 安装脚本解压了错误的文件
3. 缓存问题

**解决**:
```bash
# 检查打包应用的版本
defaults read ./release/.../EmployeeSafety.app/Contents/Info CFBundleShortVersionString

# 清理并重新打包
npm run clean
npm run build
npm run pack:mac
```

### 问题 6: Bundle 结构验证失败

**错误**:
```
  ❌ Contents/Resources/app.asar 不存在
```

**可能原因**:
1. 安装脚本解压不完整
2. 权限问题
3. 磁盘空间不足

**解决**:
```bash
# 检查磁盘空间
df -h /Applications

# 检查安装目录权限
ls -la /Applications | grep EmployeeSafety

# 查看详细日志
cat test-installation.log
```

---

## 🔄 回滚机制

### 自动备份

每次测试都会自动备份当前安装的应用到：

```
test-backup-[timestamp]/EmployeeSafety.app
```

### 手动回滚

如果测试失败，脚本会提示是否回滚：

```
是否回滚到备份版本？ (yes/no): yes
```

### 手动恢复备份

如果需要手动恢复：

```bash
# 1. 删除当前安装
sudo rm -rf /Applications/EmployeeSafety.app

# 2. 恢复备份
sudo cp -R test-backup-1234567890/EmployeeSafety.app /Applications/

# 3. 设置权限
sudo chmod -R 755 /Applications/EmployeeSafety.app
```

---

## 📝 日志文件

### 日志位置

```
./test-installation.log
```

### 日志格式

```
[2025-12-22T12:34:56.789Z] [INFO] 开始测试
[2025-12-22T12:34:57.123Z] [INFO] ✅ 找到更新包: ...
[2025-12-22T12:34:58.456Z] [WARN] ⚠️  脚本没有执行权限
[2025-12-22T12:35:00.789Z] [ERROR] ❌ 安装脚本执行失败
```

### 查看日志

```bash
# 查看完整日志
cat test-installation.log

# 查看最后 50 行
tail -50 test-installation.log

# 只看错误和警告
grep -E "\[WARN\]|\[ERROR\]" test-installation.log

# 实时查看（如果测试很慢）
tail -f test-installation.log
```

---

## 🎯 测试场景

### 场景 1: 全新安装

**条件**: `/Applications` 中没有 `EmployeeSafety.app`

**预期**:
- 跳过备份
- 直接安装
- 版本为 1.0.158

### 场景 2: 从旧版本更新

**条件**: 已安装 v1.0.157

**预期**:
- 备份 v1.0.157
- 安装 v1.0.158
- 版本号更新

### 场景 3: 覆盖安装相同版本

**条件**: 已安装 v1.0.158

**预期**:
- 备份 v1.0.158
- 重新安装 v1.0.158
- 验证成功

### 场景 4: 应用正在运行

**条件**: EmployeeSafety 正在运行

**预期**:
- 检测到运行中
- 提示用户关闭
- 优雅关闭或强制终止
- 继续安装

---

## ✅ 成功标准

测试成功需要满足：

1. ✅ 安装脚本执行无错误
2. ✅ 应用存在于 `/Applications/EmployeeSafety.app`
3. ✅ 可执行文件有正确权限
4. ✅ 版本号为 1.0.158
5. ✅ Bundle 结构完整（Info.plist, MacOS/, Resources/app.asar）
6. ✅ 应用能够正常启动
7. ✅ 核心功能正常（手动验证）

---

## 🔐 安全性

### 脚本安全

- ✅ 所有用户输入都需要确认
- ✅ 自动备份机制
- ✅ 详细日志记录
- ✅ 提供回滚选项
- ❌ **不会**自动删除备份（需用户确认）
- ❌ **不会**跳过任何验证步骤

### 权限要求

脚本可能需要管理员权限来：

- 替换 `/Applications` 中的应用
- 设置应用权限

**如果遇到权限错误**:

```bash
# 使用 sudo 运行（谨慎）
sudo node test-real-installation.js
```

---

## 📚 相关文档

- 完整测试报告: `V1.0.158_TESTING_REPORT.md`
- v1.0.158 修复: `V1.0.158_ESM_IMPORT_FIX.md`
- v1.0.156 修复: `V1.0.156_FIXES.md`
- 更新流程分析: `UPDATE_FLOW_CODE_AUDIT.md`

---

## 💡 最佳实践

### 测试前

1. ✅ 保存所有工作
2. ✅ 关闭正在运行的应用
3. ✅ 运行 `npm run pack:mac` 确保最新构建
4. ✅ 备份重要数据（脚本会自动备份应用）

### 测试中

1. ✅ 仔细阅读每个提示
2. ✅ 观察脚本输出
3. ✅ 不要中断脚本执行（特别是安装步骤）

### 测试后

1. ✅ 手动验证应用功能
2. ✅ 检查版本号和按钮颜色
3. ✅ 保留日志文件供参考
4. ✅ 确认无误后再删除备份

---

**创建时间**: 2025-12-22
**适用版本**: v1.0.158+
**维护者**: Claude Code
