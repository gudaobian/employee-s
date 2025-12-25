# 热更新文件损坏问题修复总结

## 问题描述

### 现象
- 热更新后应用启动失败，显示"启动失败"
- 日志显示 JavaScript 语法错误：`Unexpected token '{'`
- 错误位置：`config-service-cli.js:271`

### 根本原因
后端在生成差异包时使用了**错误版本的 ASAR 文件**作为源：
- 当前运行版本：`1.0.1`（实际安装是 1.0.0）
- 后端缓存的 ASAR：`1.0.134` 和 `1.0.144`
- 差异包方向错误：从新版本（1.0.134）生成到旧版本（1.0.1）
- 结果：差异包包含了新版本的旧代码结构，覆盖了当前正确的代码

### 错误证据
**损坏的编译文件**（来自热更新）：
```javascript
},
screenshotInterval: 60000,
activityInterval: 600000,  // 旧版本代码结构
processScanInterval: 180000,
enableScreenshot: true,
enableActivity: true,
enableProcess: true        // ❌ 缺少逗号，导致语法错误
```

**正确的编译文件**（当前源码编译）：
```javascript
}  // ✅ 正确的结束
```

## 修复方案

### 1. 添加版本验证逻辑
**文件**：`api-server/src/services/HotUpdateService.ts`

**新增方法**：
```typescript
/**
 * 从 ASAR 文件中读取版本号
 * 用于验证 ASAR 文件与预期版本是否匹配
 */
private async getAsarVersion(asarPath: string): Promise<string> {
  const asar = await import('@electron/asar');
  const packageJsonContent = asar.extractFile(asarPath, 'package.json');
  const packageJson = JSON.parse(packageJsonContent.toString('utf-8'));
  return packageJson.version;
}
```

**验证逻辑**（添加到差异包生成流程）：
```typescript
// 5. 验证 ASAR 版本号
const oldPackageVersion = await this.getAsarVersion(oldAsarResult.asarPath);
const newPackageVersion = await this.getAsarVersion(newAsarResult.asarPath);

if (oldPackageVersion !== fromVersion) {
  throw new Error(
    `旧版本 ASAR 版本号不匹配: 期望 ${fromVersion}, 实际 ${oldPackageVersion}. ` +
    `可能使用了错误的安装包或 ASAR 文件已被污染。`
  );
}

if (newPackageVersion !== toVersion) {
  throw new Error(
    `新版本 ASAR 版本号不匹配: 期望 ${toVersion}, 实际 ${newPackageVersion}. ` +
    `可能使用了错误的安装包或 ASAR 文件已被污染。`
  );
}
```

**效果**：
- ✅ 阻止使用错误版本的 ASAR 生成差异包
- ✅ 在生成过程中提前发现版本不匹配问题
- ✅ 防止再次出现文件损坏

### 2. 清理错误数据
```bash
# 删除后端缓存的错误 ASAR 文件
rm -rf /Volumes/project/Projects/employee-monitering-master/api-server/temp/hot-update/extraction/*.asar

# 编译更新后的后端代码
cd api-server && npm run build

# 重启 API 服务器
npm run dev:local
```

### 3. 修复打包警告
**文件**：`scripts/build/pack-mac-universal.js`

**问题**：
- arm64 主机构建 x64 应用时，没有 x64 架构的 sharp 包
- afterCopy 钩子报警告找不到 x64 的 dylib 和 .node 文件

**修复**：
```javascript
// 检测跨架构构建
if (arch !== process.arch) {
  console.log(`   ℹ️  跨架构构建 (${process.arch} → ${arch})，跳过架构特定文件`);
} else {
  console.log(`   ⚠️  libvips dylib 未找到 (${arch})`);
  // ...详细错误信息
}
```

**效果**：
- ✅ 跨架构构建时显示信息而非警告
- ✅ 同架构构建时保留详细的调试信息
- ✅ 不影响构建结果（x64 应用会使用 ASAR unpacked 中的文件）

## 技术细节

### 热更新流程
```
客户端请求更新
    ↓
后端查找差异包: findDiff(fromVersion, toVersion, platform)
    ↓
返回差异包 URL 和元数据
    ↓
客户端下载差异包
    ↓
应用差异: DiffApplier.applyDiff()
    ↓
重新打包 ASAR
    ↓
重启应用
```

### 失败点
**之前**：后端 `findDiff()` 返回了错误的差异包（1.0.134 → 1.0.1）
**原因**：数据库中有错误的差异包记录，或者生成时使用了错误的源 ASAR
**结果**：应用了包含旧代码的差异，导致文件损坏

### 现在的保护机制
```typescript
// 生成差异包时
generateDiffPackage(fromPackage, toPackage, fromVersion, toVersion) {
  // 1. 提取 ASAR
  const oldAsar = extractAsar(fromPackage);
  const newAsar = extractAsar(toPackage);

  // 2. ✅ 验证版本号（新增）
  if (getAsarVersion(oldAsar) !== fromVersion) {
    throw Error("版本不匹配");  // 阻止继续
  }

  // 3. 生成差异
  const diff = compare(oldAsar, newAsar);

  // 4. 打包上传
  return createDiffPackage(diff);
}
```

## 遗留问题和建议

### 1. 当前安装应用
**状态**：ASAR 已手动修复（语法错误和 rpath）
**建议**：重新安装最新构建的 DMG 以确保所有文件正确

### 2. 差异包数据库
**状态**：可能包含错误的差异包记录
**建议**：清理或重新生成所有差异包

### 3. 版本号管理
**当前问题**：
- package.json 版本：`1.0.1`
- Info.plist 版本：`1.0.0`
- 日志显示版本：`1.0.1`

**建议**：统一版本号来源，使用 package.json 作为唯一真实来源

## 测试验证

### 验证版本检查
```bash
# 1. 尝试用错误版本生成差异包（应该失败）
# 后端日志会显示：
# ❌ 旧版本 ASAR 版本号不匹配: 期望 1.0.1, 实际 1.0.134

# 2. 用正确版本生成差异包（应该成功）
# 后端日志会显示：
# ✅ 版本验证通过: 1.0.1 → 1.0.2
```

### 验证打包改进
```bash
# 运行打包命令
npm run pack:mac

# arm64 构建输出：
#    ✅ libvips-cpp.8.17.2.dylib (arm64) 已复制到 Frameworks/
#    ✅ 已添加 Frameworks rpath 到 darwin-arm64.node

# x64 构建输出（新）：
#    ℹ️  跨架构构建 (arm64 → x64)，跳过架构特定文件
#    ℹ️  跨架构构建，跳过 .node 文件 rpath 配置
```

## 总结

| 修复项 | 状态 | 文件 |
|--------|------|------|
| ASAR 版本验证 | ✅ 已完成 | api-server/src/services/HotUpdateService.ts |
| 错误 ASAR 清理 | ✅ 已完成 | - |
| 打包警告优化 | ✅ 已完成 | scripts/build/pack-mac-universal.js |
| 后端代码编译 | ✅ 已完成 | - |
| API 服务器重启 | ✅ 已完成 | - |

**防护效果**：
- ✅ 阻止未来使用错误 ASAR 生成差异包
- ✅ 版本不匹配时提前报错终止
- ✅ 提供清晰的错误诊断信息
- ✅ 优化了构建过程的用户体验

---

**修复日期**：2025-12-23
**修复人员**：Claude Code
**严重程度**：🔴 CRITICAL - 导致应用完全无法启动
**影响范围**：所有通过热更新安装的客户端
**修复验证**：需要重新安装或等待下次正确的热更新包
