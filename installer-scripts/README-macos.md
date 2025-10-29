# Employee Safety Client - macOS 安装和卸载指南

## 📦 安装步骤

### 首次安装

1. **打开 DMG 文件**
   ```bash
   open EmployeeSafety-x.x.x.dmg
   ```

2. **拖放安装**
   - 将 EmployeeSafety.app 拖到 Applications 文件夹
   - 等待复制完成

3. **首次启动**
   - 打开 Launchpad 或进入 Applications 文件夹
   - 双击 EmployeeSafety.app
   - 如果出现安全提示，前往 **系统偏好设置 > 安全性与隐私** 允许运行

### 升级安装

#### 方法 1: 使用清理脚本（推荐）

```bash
# 1. 打开 DMG 或从应用资源目录运行清理脚本
/Applications/EmployeeSafety.app/Contents/Resources/cleanup-macos.sh

# 或从 DMG 运行（如果包含）
/Volumes/EmployeeSafety\ x.x.x/cleanup-macos.sh

# 2. 按照提示操作

# 3. 拖放新版本到 Applications 文件夹（覆盖）
```

#### 方法 2: 手动清理

```bash
# 1. 停止运行中的应用
# 点击菜单栏的 EmployeeSafety 图标 → 退出
# 或使用命令行
pkill -f EmployeeSafety

# 2. 删除旧版本
rm -rf /Applications/EmployeeSafety.app

# 3. 清理日志（可选）
rm -rf ~/Library/Logs/EmployeeSafety
rm -rf ~/Library/Application\ Support/employee-safety-client/logs

# 4. 安装新版本（拖放）
```

## 🗑️ 完全卸载

### 方法 1: 使用卸载脚本（推荐）

```bash
# 从应用资源目录运行
/Applications/EmployeeSafety.app/Contents/Resources/uninstall-macos.sh

# 或从下载的脚本运行
chmod +x uninstall-macos.sh
./uninstall-macos.sh
```

卸载脚本会删除:
- ✅ 应用程序
- ✅ 用户数据和配置
- ✅ 缓存和日志
- ✅ 偏好设置
- ✅ 登录项
- ✅ 启动项

### 方法 2: 手动卸载

```bash
# 1. 停止应用
pkill -f EmployeeSafety

# 2. 删除应用程序
sudo rm -rf /Applications/EmployeeSafety.app

# 3. 删除用户数据
rm -rf ~/Library/Application\ Support/employee-safety-client
rm -rf ~/.employee-safety

# 4. 删除偏好设置
rm -f ~/Library/Preferences/com.company.employee-safety.plist
defaults delete com.company.employee-safety

# 5. 删除缓存
rm -rf ~/Library/Caches/com.company.employee-safety
rm -rf ~/Library/Caches/employee-safety-client

# 6. 删除日志
rm -rf ~/Library/Logs/EmployeeSafety
rm -rf ~/Library/Logs/employee-safety-client

# 7. 删除登录项
osascript -e 'tell application "System Events" to delete login item "EmployeeSafety"'

# 8. 清理临时文件
rm -rf $TMPDIR/employee-safety-*
rm -rf /tmp/employee-safety-*
```

## 🛠️ 清理脚本选项

### cleanup-macos.sh

**基本用法:**
```bash
./cleanup-macos.sh
```

**高级选项:**
```bash
# 删除旧版本应用
./cleanup-macos.sh --remove-old

# 删除所有用户数据（包括配置）
./cleanup-macos.sh --clean-data

# 静默模式（无交互）
./cleanup-macos.sh --silent

# 组合使用
./cleanup-macos.sh --remove-old --clean-data --silent

# 查看帮助
./cleanup-macos.sh --help
```

**清理内容:**
- ✅ 停止运行中的进程
- ✅ 清理日志文件
- ✅ 清理临时文件
- ✅ 清理缓存
- ⚙️ 可选：删除旧版本
- ⚙️ 可选：清理用户数据

### uninstall-macos.sh

**用法:**
```bash
./uninstall-macos.sh
```

需要输入 `yes` 确认卸载。

## 📁 文件位置

### 应用程序
```
/Applications/EmployeeSafety.app
```

### 用户数据
```
~/Library/Application Support/employee-safety-client/
~/.employee-safety/
```

### 配置文件
```
~/Library/Preferences/com.company.employee-safety.plist
```

### 日志文件
```
~/Library/Logs/EmployeeSafety/
~/Library/Application Support/employee-safety-client/logs/
```

### 缓存
```
~/Library/Caches/com.company.employee-safety/
~/Library/Caches/employee-safety-client/
~/Library/Application Support/employee-safety-client/Cache/
~/Library/Application Support/employee-safety-client/Code Cache/
~/Library/Application Support/employee-safety-client/GPUCache/
```

### 临时文件
```
$TMPDIR/employee-safety-*
/tmp/employee-safety-*
```

## ⚙️ 自动启动配置

### 启用自动启动

1. **通过系统偏好设置:**
   - 打开 **系统偏好设置 > 用户与群组**
   - 选择 **登录项** 标签页
   - 点击 **+** 按钮
   - 选择 `/Applications/EmployeeSafety.app`
   - 点击 **添加**

2. **通过命令行:**
   ```bash
   osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/EmployeeSafety.app", hidden:false}'
   ```

### 禁用自动启动

1. **通过系统偏好设置:**
   - 打开 **系统偏好设置 > 用户与群组**
   - 选择 **登录项** 标签页
   - 选中 EmployeeSafety
   - 点击 **-** 按钮删除

2. **通过命令行:**
   ```bash
   osascript -e 'tell application "System Events" to delete login item "EmployeeSafety"'
   ```

## 🔒 权限和安全

### Gatekeeper

首次运行时，macOS 可能显示安全警告：

**解决方法:**

1. **方法 1: 系统偏好设置**
   - 前往 **系统偏好设置 > 安全性与隐私**
   - 点击 **仍要打开** 按钮

2. **方法 2: 命令行**
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/EmployeeSafety.app
   ```

3. **方法 3: 右键菜单**
   - 右键点击 EmployeeSafety.app
   - 选择 **打开**
   - 在弹出的对话框中点击 **打开**

### 权限需求

Employee Safety 可能需要以下权限：

- **辅助功能**: 监控键盘和鼠标活动
- **屏幕录制**: 截取屏幕截图
- **全磁盘访问**: 读取系统信息（可选）

**授予权限:**
1. 打开 **系统偏好设置 > 安全性与隐私 > 隐私**
2. 选择相应的权限类别
3. 勾选 EmployeeSafety.app

## 🚨 故障排除

### 应用无法启动

**问题:** 双击应用无响应

**解决:**
```bash
# 检查进程是否已运行
ps aux | grep EmployeeSafety

# 查看崩溃日志
cat ~/Library/Logs/DiagnosticReports/EmployeeSafety*.crash

# 重置权限
chmod -R 755 /Applications/EmployeeSafety.app
xattr -cr /Applications/EmployeeSafety.app
```

### 清理脚本执行失败

**问题:** Permission denied

**解决:**
```bash
# 添加执行权限
chmod +x cleanup-macos.sh

# 或使用 bash 运行
bash cleanup-macos.sh
```

### 无法删除应用

**问题:** Operation not permitted

**解决:**
```bash
# 使用 sudo
sudo rm -rf /Applications/EmployeeSafety.app

# 或检查是否有进程占用
lsof | grep EmployeeSafety
```

### 权限请求不显示

**问题:** 应用未请求必要权限

**解决:**
```bash
# 重置隐私数据库（需要重启）
tccutil reset All com.company.employee-safety

# 重新启动应用
```

## 📞 技术支持

### 日志收集

如遇问题，请收集以下日志：

```bash
# 创建日志收集目录
mkdir ~/Desktop/EmployeeSafety-logs

# 复制应用日志
cp -R ~/Library/Logs/EmployeeSafety ~/Desktop/EmployeeSafety-logs/
cp -R ~/Library/Application\ Support/employee-safety-client/logs ~/Desktop/EmployeeSafety-logs/

# 复制系统日志
cp ~/Library/Logs/DiagnosticReports/EmployeeSafety*.crash ~/Desktop/EmployeeSafety-logs/ 2>/dev/null || true

# 创建系统信息
system_profiler SPSoftwareDataType SPHardwareDataType > ~/Desktop/EmployeeSafety-logs/system-info.txt

# 打包
cd ~/Desktop
tar -czf EmployeeSafety-logs.tar.gz EmployeeSafety-logs/

echo "日志已打包: ~/Desktop/EmployeeSafety-logs.tar.gz"
```

### 系统信息

```bash
# macOS 版本
sw_vers

# 硬件信息
sysctl -n machdep.cpu.brand_string
sysctl hw.memsize

# 应用版本
defaults read /Applications/EmployeeSafety.app/Contents/Info.plist CFBundleShortVersionString
```

## 🔄 升级最佳实践

### 升级前检查清单

- [ ] 停止 Employee Safety 应用
- [ ] 备份重要配置（如有需要）
- [ ] 运行清理脚本或手动清理日志
- [ ] 删除旧版本应用
- [ ] 安装新版本
- [ ] 重新授予必要权限
- [ ] 验证功能正常

### 保留数据升级

如需保留配置和数据：

```bash
# 仅清理日志和缓存，保留配置
./cleanup-macos.sh  # 默认保留配置

# 或手动清理
rm -rf ~/Library/Application\ Support/employee-safety-client/logs
rm -rf ~/Library/Caches/employee-safety-client
```

### 全新安装升级

完全重置应用状态：

```bash
# 完全清理所有数据
./cleanup-macos.sh --clean-data --remove-old --silent

# 重新安装
# 拖放新版本到 Applications 文件夹
```

## 📝 更新日志

### v1.0.47 (2025-10-29)
- ✅ 添加 macOS 清理脚本
- ✅ 添加 macOS 卸载脚本
- ✅ 支持自动化安装前清理
- ✅ 完整的安装和卸载文档

## 🔗 相关链接

- GitHub: https://github.com/gudaobian/employee-s
- 下载最新版本: https://github.com/gudaobian/employee-s/releases
- 问题反馈: https://github.com/gudaobian/employee-s/issues
