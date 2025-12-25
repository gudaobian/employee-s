# 热更新Frameworks同步功能 - 客户端实现文档

## 📋 修改摘要

**修改日期**: 2025-12-25
**版本**: 2.4.5+
**目的**: 解决Sharp库热更新后native依赖丢失的问题

---

## 🔧 客户端修改内容

### 1. 修改文件

- **文件**: `electron/main-minimal.js`
- **修改位置**: 第70-283行
- **新增代码**: ~140行

### 2. 核心功能

#### 2.1 热更新流程扩展

**原流程**:
```
1. 备份app.asar
2. 备份app.asar.unpacked
3. 替换app.asar
4. 替换app.asar.unpacked
5. 删除备份
6. 重启应用
```

**新流程**:
```
1. 备份app.asar
2. 备份app.asar.unpacked
3. 替换app.asar
4. 替换app.asar.unpacked
5. 🆕 同步Sharp库到Frameworks目录  ← 新增
6. 删除备份
7. 重启应用
```

#### 2.2 新增函数: `syncSharpLibrariesToFrameworks()`

**功能**: 将Sharp的.dylib文件从unpacked目录同步到Frameworks目录

**核心逻辑**:
1. ✅ 检测Sharp库源目录: `app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64/lib/`
2. ✅ 扫描所有.dylib文件
3. ✅ 对比源文件和目标文件（通过文件大小判断版本）
4. ✅ 备份旧版本 (.dylib.backup)
5. ✅ 复制新版本到Frameworks
6. ✅ 清理备份文件
7. ✅ 错误隔离（同步失败不影响热更新其他部分）

**安全特性**:
- ⚠️ 同步失败不会阻塞热更新流程
- ⚠️ 自动备份旧版本.dylib
- ⚠️ 同步失败时自动恢复备份
- ⚠️ 所有操作使用try-catch包裹

---

## 📊 执行流程图

```
热更新触发
    ↓
下载差分包 (包含unpacked目录变化)
    ↓
应用差分包
    ↓
替换app.asar ✅
    ↓
替换app.asar.unpacked ✅
    ↓
检测Sharp库更新 🔍
    ├─ 源目录存在? ────┐
    │   ↓ Yes          │ No
    │  读取.dylib文件  │
    │   ↓              │
    │  对比版本差异     │
    │   ↓              │
    │  需要更新?────┐   │
    │   ↓ Yes   ↓ No │
    │  备份旧版  跳过  │
    │   ↓          │  │
    │  复制新版     │  │
    │   ↓          │  │
    │  同步成功 ←──┘  │
    │   ↓             │
    └──→ 清理备份 ←────┘
         ↓
    重启应用 ✅
```

---

## 🧪 测试方案

### 测试场景1: Sharp版本升级

**前提条件**:
- 当前版本: 2.4.5 (Sharp 0.33.2, libvips 8.17.3)
- 新版本: 2.4.6 (Sharp 0.33.5, libvips 8.17.4)

**测试步骤**:
1. 确认当前Frameworks目录: `ls /Applications/EmployeeSafety.app/Contents/Frameworks/`
   - 应该看到: `libvips-cpp.8.17.3.dylib`

2. 触发热更新到2.4.6

3. 观察日志输出:
```
[HOT_UPDATE] 🔍 检测Sharp库更新，同步到Frameworks...
[HOT_UPDATE]   源目录: .../app.asar.unpacked/node_modules/@img/.../lib
[HOT_UPDATE]   目标目录: .../Frameworks
[HOT_UPDATE] 找到 1 个.dylib文件: [ 'libvips-cpp.8.17.4.dylib' ]
[HOT_UPDATE]   - libvips-cpp.8.17.4.dylib: 版本变化 (15.0MB -> 15.2MB)
[HOT_UPDATE]     已备份旧版本: libvips-cpp.8.17.3.dylib.backup
[HOT_UPDATE]     ✅ libvips-cpp.8.17.4.dylib 同步成功
[HOT_UPDATE]   已清理备份: libvips-cpp.8.17.3.dylib.backup
[HOT_UPDATE] ✅ 已同步 1 个Sharp库到Frameworks
```

4. 重启后验证:
```bash
ls -lh /Applications/EmployeeSafety.app/Contents/Frameworks/ | grep libvips
```
应该看到: `libvips-cpp.8.17.4.dylib`

5. 启动应用，检查Sharp是否正常加载:
```
[SHARP] Configured SHARP_LIBVIPS_LOCAL_PREBUILDS: ...
[INIT] EmployeeMonitorApp instance created successfully
```

**预期结果**: ✅ Sharp库升级成功，应用正常启动

---

### 测试场景2: Sharp版本不变

**前提条件**:
- 当前版本: 2.4.5 (Sharp 0.33.2)
- 新版本: 2.4.6 (Sharp 0.33.2, 只有JS代码变化)

**测试步骤**:
1. 触发热更新到2.4.6

2. 观察日志输出:
```
[HOT_UPDATE] 🔍 检测Sharp库更新，同步到Frameworks...
[HOT_UPDATE] 找到 1 个.dylib文件: [ 'libvips-cpp.8.17.3.dylib' ]
[HOT_UPDATE]   - libvips-cpp.8.17.3.dylib: 跳过（版本未变化）
[HOT_UPDATE] ℹ️  Sharp库版本未变化，无需同步 (检查了1个文件)
```

**预期结果**: ✅ 跳过同步，不产生额外文件操作

---

### 测试场景3: 初次安装（Frameworks目录为空）

**前提条件**:
- 全新安装应用
- Frameworks目录没有Sharp库

**测试步骤**:
1. 安装应用，触发热更新

2. 观察日志输出:
```
[HOT_UPDATE] ⚠️  Frameworks目录不存在，创建中...
[HOT_UPDATE] 🔍 检测Sharp库更新，同步到Frameworks...
[HOT_UPDATE]   - libvips-cpp.8.17.3.dylib: 新增文件
[HOT_UPDATE]     ✅ libvips-cpp.8.17.3.dylib 同步成功
[HOT_UPDATE] ✅ 已同步 1 个Sharp库到Frameworks
```

**预期结果**: ✅ 自动创建Frameworks目录并复制.dylib文件

---

### 测试场景4: 同步失败容错

**模拟方法**:
```bash
# 锁定Frameworks目录（模拟权限不足）
sudo chflags uchg /Applications/EmployeeSafety.app/Contents/Frameworks
```

**预期日志**:
```
[HOT_UPDATE] 🔍 检测Sharp库更新，同步到Frameworks...
[HOT_UPDATE]     ❌ libvips-cpp.8.17.4.dylib 同步失败: EPERM: operation not permitted
[HOT_UPDATE]     已恢复备份版本
[HOT_UPDATE] ⚠️  Sharp库同步失败（不影响其他更新）: ...
[HOT_UPDATE] ✅ 热更新安装成功（ASAR + unpacked）
```

**验证**:
- ✅ 热更新继续完成
- ✅ 应用可以重启（虽然Sharp库可能不可用）
- ✅ 不会导致应用崩溃

**恢复**:
```bash
sudo chflags nouchg /Applications/EmployeeSafety.app/Contents/Frameworks
```

---

## 📈 性能影响

### 时间开销

| 操作 | 预计耗时 | 说明 |
|------|---------|------|
| 扫描.dylib文件 | <10ms | 目录读取 |
| 文件大小对比 | <5ms | stat系统调用 |
| 备份旧版本 | <50ms | rename操作 |
| 复制新版本 | 100-500ms | 15MB文件拷贝 |
| 清理备份 | <10ms | unlink操作 |
| **总计** | **<600ms** | Sharp版本变化时 |
| **总计(跳过)** | **<20ms** | Sharp版本不变时 |

### 存储开销

- 短期（更新期间）: +15MB（备份文件）
- 长期: 0（备份自动清理）

---

## 🔍 日志级别说明

| 日志级别 | 前缀 | 含义 |
|----------|------|------|
| `[HOT_UPDATE] 🔍` | 检测 | 开始检测Sharp库更新 |
| `[HOT_UPDATE]   -` | 详细 | 单个文件处理详情 |
| `[HOT_UPDATE] ✅` | 成功 | 操作成功完成 |
| `[HOT_UPDATE] ⚠️` | 警告 | 可恢复的错误 |
| `[HOT_UPDATE] ❌` | 错误 | 操作失败 |
| `[HOT_UPDATE] ℹ️` | 信息 | 提示性消息 |

---

## 🛠️ 故障排查

### 问题1: 同步失败 "ENOENT: no such file or directory"

**原因**: Sharp库源目录不存在

**解决方案**:
1. 检查unpacked目录: `ls app.asar.unpacked/node_modules/@img/`
2. 确认Sharp安装: `npm list sharp`
3. 重新构建包含Sharp的版本

---

### 问题2: 同步失败 "EPERM: operation not permitted"

**原因**: Frameworks目录权限不足

**解决方案**:
```bash
# 检查权限
ls -la /Applications/EmployeeSafety.app/Contents/Frameworks

# 修复权限
sudo chown -R $(whoami) /Applications/EmployeeSafety.app/Contents/Frameworks
sudo chmod -R 755 /Applications/EmployeeSafety.app/Contents/Frameworks
```

---

### 问题3: Sharp加载失败 "Library not loaded"

**原因**: .dylib文件损坏或版本不匹配

**临时方案**:
```bash
# 手动复制
cp app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64/lib/*.dylib \
   /Applications/EmployeeSafety.app/Contents/Frameworks/
```

**根本解决**: 重新下载完整安装包

---

## 📝 维护建议

### 1. 监控建议

在后端记录以下指标:
- Sharp库同步成功率
- 同步失败错误类型
- 同步耗时分布

### 2. 版本发布检查清单

发布新版本前确认:
- [ ] Sharp版本是否变化
- [ ] 差分包是否包含unpacked目录
- [ ] 后端DiffPackageGenerator是否正确检测Sharp库变化
- [ ] 测试环境验证同步逻辑

### 3. 回滚策略

如果发现严重问题:
1. 后端撤回差分包
2. 推送回滚版本（恢复到上一个稳定版本）
3. 客户端会自动回滚Sharp库到备份版本

---

## 🔗 相关文件

- **客户端主文件**: `electron/main-minimal.js`
- **后端对比器**: `api-server/src/services/hot-update/FileComparator.ts`
- **后端生成器**: `api-server/src/services/hot-update/DiffPackageGenerator.ts`

---

## ✅ 总结

本次修改为热更新系统添加了**Frameworks目录同步**功能，彻底解决了Sharp库等原生依赖在热更新后丢失的问题。

**关键特性**:
- ✅ 自动检测Sharp库版本变化
- ✅ 智能跳过未变化的文件（性能优化）
- ✅ 完善的备份和恢复机制
- ✅ 错误隔离（不影响热更新主流程）
- ✅ 详细的日志输出（便于问题排查）

**兼容性**:
- ✅ 向后兼容（旧版本客户端忽略新字段）
- ✅ 向前兼容（新版本客户端处理旧差分包）
- ✅ 跨平台扩展（可支持Windows .dll文件）
