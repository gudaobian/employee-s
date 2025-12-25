# 热更新 Unpacked 目录修复 - December 23, 2025

## 问题总结

**症状**: 热更新下载和应用成功，但应用重启后仍然显示"启动失败"。

**日志显示**:
- ✅ 热更新过程完全成功（下载、校验、应用、打包）
- ✅ 版本验证通过：1.0.1
- ✅ 用户选择重启
- ✅ 模块加载成功
- ❌ 但应用功能失败（"启动失败"）

## 根本原因

### 文件状态分析

热更新完成后的文件状态：
```
/Applications/EmployeeSafety.app/Contents/Resources/
├── app.asar (20:08)              ← NEW 1.0.1 ✅
├── app.asar.unpacked (19:52)     ← OLD 1.0.0 ❌
└── app.asar.new.unpacked (20:08) ← NEW 1.0.1 (未重命名) ❌
```

### 问题分析

**启动时的文件替换逻辑不完整**：

`electron/main-minimal.js` 中的热更新安装逻辑（15-65行）只处理了：
- ✅ 检查并重命名 `app.asar.new` → `app.asar`
- ❌ **忽略了** `app.asar.new.unpacked` 目录

导致的后果：
1. 新的 ASAR 代码（1.0.1）尝试加载旧的原生模块（1.0.0）
2. 版本不匹配导致 sharp 等原生模块加载失败
3. `EmployeeMonitorApp` 初始化失败
4. `app_instance` 保持为 null
5. 应用进入"simulation mode"（模拟模式）

## 修复方案

### 1. 修改 `electron/main-minimal.js`

**修复前** (只处理 ASAR):
```javascript
if (originalFs.existsSync(newAsarPath)) {
  // 备份并替换 app.asar
  originalFs.renameSync(newAsarPath, asarPath);
  // 重启
  app.relaunch();
  app.exit(0);
}
```

**修复后** (同时处理 ASAR + unpacked):
```javascript
const unpackedPath = `${asarPath}.unpacked`;
const newUnpackedPath = `${asarPath}.new.unpacked`;
const backupUnpackedPath = `${asarPath}.unpacked.backup`;

if (originalFs.existsSync(newAsarPath)) {
  // 1. 备份 ASAR
  originalFs.copyFileSync(asarPath, backupPath);

  // 2. 备份 unpacked（新增）
  if (originalFs.existsSync(unpackedPath)) {
    copyDirSync(unpackedPath, backupUnpackedPath);
  }

  // 3. 替换 ASAR
  originalFs.renameSync(newAsarPath, asarPath);

  // 4. 替换 unpacked（新增）
  if (originalFs.existsSync(newUnpackedPath)) {
    if (originalFs.existsSync(unpackedPath)) {
      removeDirSync(unpackedPath);
    }
    originalFs.renameSync(newUnpackedPath, unpackedPath);
  }

  // 5. 删除备份
  if (originalFs.existsSync(backupPath)) {
    originalFs.unlinkSync(backupPath);
  }
  if (originalFs.existsSync(backupUnpackedPath)) {
    removeDirSync(backupUnpackedPath);
  }

  // 6. 重启
  app.relaunch();
  app.exit(0);
}
```

### 2. 添加辅助函数

```javascript
// 递归复制目录
function copyDirSync(src, dest) {
  if (!originalFs.existsSync(dest)) {
    originalFs.mkdirSync(dest, { recursive: true });
  }
  const entries = originalFs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      originalFs.copyFileSync(srcPath, destPath);
    }
  }
}

// 递归删除目录
function removeDirSync(dirPath) {
  if (originalFs.existsSync(dirPath)) {
    const entries = originalFs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        removeDirSync(fullPath);
      } else {
        originalFs.unlinkSync(fullPath);
      }
    }
    originalFs.rmdirSync(dirPath);
  }
}
```

### 3. 增强错误处理和回滚机制

```javascript
catch (error) {
  console.error('[HOT_UPDATE] ❌ 安装失败:', error.message);
  console.error('[HOT_UPDATE] 错误堆栈:', error.stack);

  // 回滚 ASAR
  if (originalFs.existsSync(backupPath)) {
    originalFs.copyFileSync(backupPath, asarPath);
    originalFs.unlinkSync(backupPath);
  }

  // 回滚 unpacked（新增）
  if (originalFs.existsSync(backupUnpackedPath)) {
    if (originalFs.existsSync(unpackedPath)) {
      removeDirSync(unpackedPath);
    }
    copyDirSync(backupUnpackedPath, unpackedPath);
    removeDirSync(backupUnpackedPath);
  }
}
```

## 测试流程

### 1. 手动修复当前损坏状态

```bash
cd /Applications/EmployeeSafety.app/Contents/Resources
rm -rf app.asar.unpacked
mv app.asar.new.unpacked app.asar.unpacked
```

**验证**:
```bash
ls -lah | grep "app.asar"
# 应该显示：
# app.asar (新版本时间戳)
# app.asar.unpacked (新版本时间戳)
```

### 2. 重启应用验证修复

```bash
killall -9 EmployeeSafety
open /Applications/EmployeeSafety.app
tail -f ~/Library/Logs/employee-safety-client/auto-update.log
```

**期望输出**:
```
✅ AutoUpdateService loaded
✅ AppConfigManager loaded
✅ All modules loaded successfully
```

### 3. 完整热更新测试

**步骤**:
1. 安装当前版本（1.0.0，包含 unpacked 修复）
2. 修改 UI（例如：按钮颜色改为绿色）
3. 版本号改为 1.0.1
4. 打包并部署到服务器
5. 在客户端触发热更新
6. 观察更新过程和重启后的状态

**验证点**:
- ✅ 热更新下载成功
- ✅ 差异应用成功
- ✅ ASAR 打包成功
- ✅ **unpacked 目录处理成功**
- ✅ 重启后自动安装（ASAR + unpacked）
- ✅ 应用正常启动
- ✅ UI 变化可见（确认新版本生效）

## 完整的热更新流程

### 下载和应用阶段 (HotUpdateService)

1. **检查更新**: `GET /api/hot-update/check`
2. **下载差异包**: `GET /api/hot-update/download/{version}`
3. **校验 SHA256**: 验证下载完整性
4. **创建备份**: `app.asar.backup` + `app.asar.unpacked.backup`
5. **解包当前应用**: ASAR + unpacked → 临时目录
6. **解压差异包**: tar.gz → 临时目录
7. **应用差异**: 复制修改/新增的文件，删除被删除的文件
8. **重新打包**: 临时目录 → `app.asar.new` + `app.asar.new.unpacked`
9. **验证版本**: 检查新 ASAR 中的 package.json 版本
10. **清理备份**: 删除 .backup 文件
11. **上报结果**: `POST /api/hot-update/report`
12. **提示重启**: 显示强制更新对话框

### 安装阶段 (main-minimal.js 启动时)

1. **检测 .new 文件**: 检查 `app.asar.new` 是否存在
2. **备份当前版本**: ASAR + unpacked → .backup
3. **安装 ASAR**: `app.asar.new` → `app.asar`
4. **安装 unpacked**: `app.asar.new.unpacked` → `app.asar.unpacked` ✅ **修复重点**
5. **删除备份**: 清理 .backup 文件
6. **重新启动**: `app.relaunch()` + `app.exit(0)`

### 启动阶段 (应用正常运行)

1. **加载新代码**: 从新的 ASAR 加载
2. **加载原生模块**: 从新的 unpacked 加载 ✅ **版本匹配**
3. **初始化服务**: AutoUpdateService, EmployeeMonitorApp
4. **注册 IPC 处理器**: 所有功能正常
5. **显示 UI**: 用户看到新版本的界面变化

## 为什么需要 unpacked 目录？

### ASAR 的限制

ASAR (Atom Shell Archive) 是一种只读归档格式，用于打包 Electron 应用。但有以下限制：

1. **原生模块必须 unpack**: Node.js 原生模块（.node 文件）无法从 ASAR 中加载
2. **动态库必须 unpack**: macOS 的 .dylib、Windows 的 .dll 文件必须在文件系统上
3. **可执行文件必须 unpack**: 需要执行权限的文件无法从 ASAR 运行

### 本项目使用的 unpacked 模块

```
app.asar.unpacked/
├── node_modules/
│   ├── @img/
│   │   └── sharp-libvips-darwin-arm64/
│   │       └── lib/
│   │           └── libvips-cpp.8.17.2.dylib  ← sharp 依赖的动态库
│   └── sharp/
│       └── build/
│           └── Release/
│               └── sharp-darwin-arm64.node   ← sharp 原生模块
└── native/
    └── macos/
        └── build/
            └── Release/
                └── macos.node                 ← 自定义原生模块
```

### 版本不匹配的后果

如果 ASAR 和 unpacked 版本不匹配：

1. **sharp 模块加载失败**:
   ```
   Error: Could not load the "sharp" module using the darwin-arm64 runtime
   Library not loaded: @rpath/libvips-cpp.8.17.2.dylib
   ```

2. **自定义原生模块失败**: macOS 事件监控等功能失效

3. **应用无法初始化**: `EmployeeMonitorApp` 构造函数失败

4. **降级到 simulation mode**: 所有核心功能被禁用

## 相关文件

### 修改的文件
- `electron/main-minimal.js` (15-145行) - 热更新安装逻辑

### 相关文档
- `MODULE_LOADING_FIX.md` - 模块加载延迟初始化修复
- `HOT_UPDATE_BUG_ANALYSIS.md` - 初始的 unpacked 目录问题分析
- `scripts/build/pack-mac-universal.js` - ASAR 打包配置（unpackDir 设置）

### 测试文件
- `~/Library/Logs/employee-safety-client/auto-update.log` - 自动更新日志
- `~/Library/Logs/employee-safety-client/update.log` - 热更新详细日志

## 版本历史

- **v1.0.0-1.0.136**: 原始热更新实现（只处理 ASAR）
- **v1.0.137-1.0.142**: UI 状态修复尝试（未解决根本问题）
- **v1.0.143**: 模块加载延迟初始化修复
- **v1.0.144**: **本次修复 - Unpacked 目录完整处理** ✅

## 经验教训

### 原生模块热更新的复杂性

1. **不仅仅是代码更新**: 原生模块涉及二进制文件，必须整体替换
2. **ASAR + unpacked 是整体**: 两者必须版本匹配，不能只更新一个
3. **动态库加载顺序**: macOS/Windows 动态链接器需要在文件系统上找到 .dylib/.dll

### 测试覆盖的重要性

1. **单元测试不够**: 需要集成测试覆盖整个热更新流程
2. **文件系统状态验证**: 更新后需要验证所有文件的时间戳和内容
3. **多版本回归测试**: 测试从不同旧版本升级到新版本

### 日志和可观测性

1. **详细的步骤日志**: 每个文件操作都应该有日志
2. **错误堆栈完整性**: catch 块中打印完整 stack trace
3. **文件状态快照**: 关键时刻记录文件系统状态

---

**状态**: ✅ RESOLVED
**修复版本**: 1.0.144
**日期**: December 23, 2025
**工程师**: Claude Code (Anthropic)
