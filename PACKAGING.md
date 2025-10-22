# macOS 打包完整指南

**最后更新**: 2025-10-20
**适用版本**: v1.0.20+

---

## 前置条件

### 1. 依赖已修复 ✅

- ✅ `debug@^4.4.3` 已添加到 dependencies
- ✅ 原生模块加载路径已修复
- ✅ 国内镜像已配置（`.npmrc`）

### 2. 环境要求

- macOS 10.15+
- Node.js 16+
- Xcode Command Line Tools
- 稳定的网络连接（下载Electron需要）

---

## 快速打包（推荐）

### 仅当前架构（arm64）

```bash
# 1. 清理旧打包
rm -rf release/

# 2. 打包arm64版本
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npx @electron/packager . EmployeeMonitor \
  --platform=darwin \
  --arch=arm64 \
  --out=release \
  --overwrite \
  --prune=false \
  --ignore="native-event-monitor-win|native-event-monitor/node_modules|^/debug/|^/doc/"

# 3. 验证结果
ls -lh release/
du -sh release/EmployeeMonitor-darwin-arm64/
```

**预期大小**: ~100-120MB

---

## 完整打包流程

### 步骤1: 准备环境

```bash
# 确保依赖完整
npm install

# 确认debug模块已安装
ls node_modules/debug
```

### 步骤2: 配置镜像（一次性）

**方式1: 使用.npmrc**（已配置）
```
electron_mirror=https://npmmirror.com/mirrors/electron/
```

**方式2: 环境变量**
```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

### 步骤3: 执行打包

#### 选项A: 使用npm脚本
```bash
npm run pack:mac:universal
```

#### 选项B: 手动打包单架构
```bash
# arm64 (当前机器架构)
npx @electron/packager . EmployeeMonitor \
  --platform=darwin \
  --arch=arm64 \
  --out=release \
  --overwrite \
  --prune=false \
  --ignore="native-event-monitor-win|native-event-monitor/node_modules|^/debug/|^/doc/"
```

### 步骤4: 验证打包

```bash
# 检查大小
du -sh release/EmployeeMonitor-darwin-*/

# 检查debug模块
ls release/EmployeeMonitor-darwin-*/EmployeeMonitor.app/Contents/Resources/app/node_modules/debug

# 测试运行
open release/EmployeeMonitor-darwin-arm64/EmployeeMonitor.app
```

---

## 关键配置说明

### ignore规则解释

| 规则 | 排除内容 | 原因 |
|------|---------|------|
| `native-event-monitor-win` | Windows原生模块 | macOS不需要 |
| `native-event-monitor/node_modules` | 原生模块的依赖 | 编译依赖，运行不需要 |
| `^/debug/` | 项目根debug目录 | 测试文件目录 |
| `^/doc/` | 文档目录 | 不影响运行 |
| `^/src/` `^/platforms/` | TypeScript源码 | 已编译到dist/ |

### prune选项

- `--prune=true` (默认): 只打包dependencies，可能缺失传递依赖
- `--prune=false` (推荐): 打包所有node_modules，确保完整

---

## 常见问题解决

### Q1: Cannot find module 'debug'

**原因**: debug不在dependencies
**解决**: ✅ 已修复（v1.0.20+）

验证：
```bash
grep debug package.json
```

应该看到：
```json
"dependencies": {
  "debug": "^4.4.3",
  ...
}
```

### Q2: Could not load "sharp" module

**原因**: 跨架构打包，sharp二进制不匹配
**解决**:
- 仅打包当前架构（arm64）
- 或使用electron-builder

### Q3: 打包文件过大（>500MB）

**原因**: 包含了不必要的文件
**检查**:
```bash
du -sh release/*/EmployeeMonitor.app/Contents/Resources/app/* | sort -hr
```

**常见多余项**:
- `native-event-monitor/node_modules` (11MB)
- `debug/` 目录 (1.3MB)
- TypeScript源码目录

**解决**: 使用本文档的ignore规则

### Q4: 下载Electron超时

**原因**: 网络限制
**解决**:
1. 使用国内镜像（已配置）
2. 手动下载Electron缓存
3. 使用VPN或代理

---

## 验证清单

打包完成后验证：

- [ ] release/目录已创建
- [ ] 应用大小 < 150MB
- [ ] debug模块存在于顶层node_modules
- [ ] 应用可以启动
- [ ] 原生模块正常加载
- [ ] 活动数据正常监控
- [ ] 数据可以上传

---

## 打包后测试

### 1. 启动测试
```bash
open release/EmployeeMonitor-darwin-arm64/EmployeeMonitor.app
```

**预期**:
- ✅ 应用启动
- ✅ 托盘图标显示
- ✅ 无错误提示

### 2. 功能测试

点击"开始监控"，观察：
- ✅ FSM状态机正常运行
- ✅ 原生模块加载成功
- ✅ 键盘/鼠标计数正常
- ✅ 数据上传成功

### 3. 日志检查

```bash
# macOS日志位置
~/Library/Logs/EmployeeMonitor/

# 或通过Console.app查看
```

---

## 生产部署建议

### 代码签名（可选）

```bash
codesign --force --deep --sign - release/EmployeeMonitor.app
```

### 公证（可选，需Apple Developer账号）

```bash
npx @electron/notarize --app-bundle-id com.company.employee-safety \
  --app-path release/EmployeeMonitor.app \
  --apple-id your@email.com \
  --apple-id-password @keychain:AC_PASSWORD
```

### 创建DMG安装包

```bash
npm run pack:mac:dmg
```

---

## 故障排查

### 打包卡住不动

**检查下载进度**:
```bash
ps aux | grep electron
```

**查看缓存**:
```bash
ls ~/.electron/
ls ~/Library/Caches/electron/
```

**清除缓存重试**:
```bash
rm -rf ~/.electron
npm run pack:mac
```

### 打包成功但启动失败

**查看启动日志**:
```bash
/path/to/EmployeeMonitor.app/Contents/MacOS/EmployeeMonitor
```

**常见错误**:
1. Cannot find module 'xxx' → 检查dependencies
2. sharp加载失败 → 架构不匹配
3. 权限问题 → `xattr -cr EmployeeMonitor.app`

---

## 附录：完整命令参考

### 开发环境打包测试

```bash
# 快速打包（不压缩，仅当前架构）
npx @electron/packager . EmployeeMonitor \
  --platform=darwin \
  --arch=arm64 \
  --out=release \
  --overwrite \
  --no-asar \
  --prune=false
```

### 生产环境打包

```bash
# 使用electron-builder（推荐）
npx electron-builder --mac --arm64

# 或使用npm脚本
npm run pack:mac:builder
```

### 调试打包问题

```bash
# 启用详细日志
DEBUG=* npx @electron/packager . EmployeeMonitor --platform=darwin --arch=arm64 --out=release
```

---

**文档维护**: 遇到新问题请更新本文档
**相关文档**: `doc/打包应用启动失败问题分析_20251020.md`
