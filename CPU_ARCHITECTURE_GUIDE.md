# CPU架构检测与热更新适配指南

## 📋 概述

本文档说明客户端如何检测设备CPU架构，并在热更新请求中携带架构信息，以便后端根据**平台+架构**精准匹配更新包。

---

## 🖥️ 支持的CPU架构

### **macOS 支持的架构**

| 架构 | 描述 | 典型设备 | Node.js返回值 | 占比 |
|------|------|----------|--------------|------|
| **arm64** | Apple Silicon (M系列芯片) | MacBook Pro/Air (2020+)<br>iMac (2021+)<br>Mac Studio<br>Mac mini (2020+) | `arm64` | ~70% (新设备) |
| **x64** | Intel 64位 | MacBook Pro/Air (2020前)<br>iMac (2020前)<br>Mac Pro | `x64` | ~30% (老设备) |

**兼容性说明**：
- ✅ **arm64 可运行 x64** - 通过 Rosetta 2 转译层（性能损失 20-30%）
- ❌ **x64 不能运行 arm64** - Intel Mac 无法运行 ARM 应用

**推荐策略**：
```
Apple Silicon Mac (arm64):
  优先: arm64 原生版本 (最佳性能)
  备选: x64 版本 (通过 Rosetta 2)

Intel Mac (x64):
  仅支持: x64 版本
```

---

### **Windows 支持的架构**

| 架构 | 描述 | 典型设备 | Node.js返回值 | 占比 |
|------|------|----------|--------------|------|
| **x64** | Intel/AMD 64位 | 绝大多数现代PC | `x64` | ~95% |
| **ia32** | Intel/AMD 32位 | 老旧PC或32位系统 | `ia32` | ~4% |
| **arm64** | ARM 64位 | Surface Pro X<br>Snapdragon PC | `arm64` | ~1% |

**兼容性说明**：
- ✅ **x64 可运行 ia32** - 通过 WOW64 兼容层（完全兼容）
- ✅ **arm64 可运行 x64/ia32** - 通过兼容层（性能损失）
- ❌ **ia32 不能运行 x64** - 32位系统无法运行64位应用

**推荐策略**：
```
Windows x64:
  优先: x64 版本 (最佳性能)
  备选: ia32 版本 (兼容但性能差)

Windows ia32:
  仅支持: ia32 版本

Windows arm64:
  优先: arm64 原生版本 (最佳性能)
  备选: x64 版本 (通过兼容层)
```

---

## 🔧 实现方法

### **1. 获取CPU架构**

#### **方法一：直接使用 `process.arch`（推荐）**

```typescript
// 最简单直接的方法
const arch = process.arch;
console.log(arch); // 'arm64', 'x64', 'ia32'
```

**返回值**：
- `'arm64'` - ARM 64位
- `'x64'` - Intel/AMD 64位
- `'ia32'` - Intel/AMD 32位

**优点**：
- ✅ 简单直接，无需额外依赖
- ✅ 返回应用编译时的目标架构
- ✅ 与热更新包的架构标识一致

---

#### **方法二：使用架构工具类（完整功能）**

我们提供了 `architecture-helper.ts` 工具类，支持更丰富的功能：

```typescript
import { getArchitecture, getArchitectureIdentifier } from '@common/utils/architecture-helper';

// 获取完整架构信息
const info = getArchitecture();
console.log(info);
/*
{
  arch: 'arm64',
  raw: 'arm64',
  isNative: true,  // 是否原生运行（非兼容层）
  platform: 'darwin',
  description: 'macOS ARM 64-bit'
}
*/

// 获取架构标识符（用于文件名等）
const identifier = getArchitectureIdentifier();
console.log(identifier); // 'darwin-arm64'
```

**额外功能**：
- 检测是否在兼容层运行（Rosetta 2 / WOW64）
- 获取推荐的下载架构列表
- 架构兼容性检查

---

### **2. 热更新请求携带架构**

#### **修改位置**：`src/common/services/hot-update/HotUpdateService.ts`

```typescript
async checkForUpdates(): Promise<CheckUpdateResponse | null> {
  const currentVersion = app.getVersion();
  const platform = process.platform === 'darwin' ? 'darwin' : 'win32';
  const arch = process.arch; // 🆕 获取CPU架构
  const deviceId = deviceInfo.deviceId;

  const url = `${this.apiBaseUrl}/api/hot-update/check?` +
    `currentVersion=${currentVersion}&` +
    `platform=${platform}&` +
    `arch=${arch}&` +  // 🆕 携带架构参数
    `deviceId=${deviceId}`;

  // 发送请求...
}
```

#### **请求URL示例**：

```
macOS Apple Silicon:
http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&arch=arm64&deviceId=xxx

macOS Intel:
http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&arch=x64&deviceId=xxx

Windows 64位:
http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=win32&arch=x64&deviceId=xxx

Windows 32位:
http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=win32&arch=ia32&deviceId=xxx
```

---

## 🔍 兼容层检测

### **macOS Rosetta 2 检测**

```typescript
import * as os from 'os';

// 检测是否在 Rosetta 2 下运行
const isRosetta = process.arch === 'x64' && os.arch() === 'arm64';

if (isRosetta) {
  console.log('⚠️ 运行在 Rosetta 2 兼容模式');
  console.log('性能损失：约 20-30%');
  console.log('建议：下载 arm64 原生版本');
}
```

**原理**：
- `process.arch` - 应用编译的目标架构（x64）
- `os.arch()` - 实际CPU架构（arm64）
- 两者不一致说明在兼容层运行

---

### **Windows WOW64 检测**

```typescript
// 检测是否在 WOW64 下运行
const isWow64 = process.arch === 'ia32' && process.env.PROCESSOR_ARCHITEW6432;

if (isWow64) {
  console.log('⚠️ 运行在 WOW64 兼容模式');
  console.log('限制：无法使用 >4GB 内存');
  console.log('建议：下载 x64 版本');
}
```

**原理**：
- `PROCESSOR_ARCHITEW6432` 环境变量只在 WOW64 下存在
- 表示实际的64位系统架构

---

## 📊 后端适配建议

### **数据库表结构**

```sql
-- client_versions 表增加 arch 字段
ALTER TABLE client_versions ADD COLUMN arch VARCHAR(10);

-- 创建索引
CREATE INDEX idx_client_versions_platform_arch
ON client_versions(platform, arch, status, version DESC);
```

### **查询逻辑**

```typescript
// 后端控制器伪代码
async checkForHotUpdate(req, res) {
  const { currentVersion, platform, arch, deviceId } = req.query;

  // 查询最新版本（匹配 platform + arch）
  const latestVersion = await ClientVersion.findLatestPublished(platform, arch);

  if (!latestVersion || latestVersion.version === currentVersion) {
    return res.json({ success: true, data: { hasUpdate: false } });
  }

  // 查找差分包（匹配 fromVersion → toVersion + platform + arch）
  const diffPackage = await DiffPackage.findDiff(
    currentVersion,
    latestVersion.version,
    platform,
    arch  // 🆕 增加架构匹配
  );

  return res.json({
    success: true,
    data: {
      hasUpdate: true,
      version: latestVersion.version,
      downloadUrl: diffPackage.downloadUrl,
      ...
    }
  });
}
```

### **架构匹配策略**

```typescript
// 推荐：支持架构降级（兼容层）
async findLatestPublished(platform: string, arch: string) {
  // 1. 优先查找精确匹配的架构
  let version = await this.findByPlatformAndArch(platform, arch);

  if (!version) {
    // 2. 降级到兼容架构
    const fallbackArch = getFallbackArchitecture(platform, arch);

    if (fallbackArch) {
      version = await this.findByPlatformAndArch(platform, fallbackArch);

      // 🔔 记录日志：使用了降级架构
      logger.warn(`使用降级架构: ${arch} → ${fallbackArch}`);
    }
  }

  return version;
}

// 架构降级表
function getFallbackArchitecture(platform: string, arch: string): string | null {
  const fallbackMap: Record<string, Record<string, string | null>> = {
    'darwin': {
      'arm64': 'x64',  // Apple Silicon 可降级到 x64（Rosetta 2）
      'x64': null      // Intel Mac 无降级选项
    },
    'win32': {
      'x64': 'ia32',   // x64 可降级到 ia32（WOW64）
      'arm64': 'x64',  // ARM64 可降级到 x64
      'ia32': null     // ia32 无降级选项
    }
  };

  return fallbackMap[platform]?.[arch] ?? null;
}
```

---

## 🧪 测试工具

### **运行架构检测测试**

```bash
# 显示当前设备的完整架构信息
node scripts/test-architecture.js
```

**输出示例**（Apple Silicon Mac）：

```
============================================================
设备CPU架构信息
============================================================

【基本信息】
平台:          darwin
进程架构:      arm64
系统架构:      arm64
CPU型号:       Apple M1
CPU核心数:     8

【架构类型】
当前架构:      arm64 (ARM 64-bit (Apple Silicon / Snapdragon))

【兼容层检测】
运行模式:      ✅ 原生 Apple Silicon 模式
说明:          ARM64 原生应用
性能:          最佳性能和能效

【推荐下载架构】
1. arm64 (推荐)
2. x64 (Rosetta 2兼容)

【热更新URL示例】
http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&arch=arm64&deviceId=device_example
============================================================
```

---

## 📝 总结

### **客户端修改**
1. ✅ 在热更新请求中携带 `arch` 参数
2. ✅ 使用 `process.arch` 获取CPU架构
3. ✅ 记录日志：`${platform}-${arch}`

### **后端修改**
1. ⏳ 接口增加 `arch` 参数（可选，默认查询所有架构）
2. ⏳ 数据库增加 `arch` 字段和索引
3. ⏳ 查询逻辑支持 `platform + arch` 精确匹配
4. ⏳ 实现架构降级策略（支持兼容层）

### **架构支持矩阵**

| 平台 | 优先架构 | 备选架构 | 不支持 |
|------|----------|----------|--------|
| **macOS** | arm64, x64 | - | ia32 |
| **Windows** | x64, ia32, arm64 | - | - |

### **下一步**
- 后端增加 `arch` 参数接收
- 后端实现按 `platform + arch` 查询最新版本
- 后端实现架构降级逻辑（可选）
- 测试不同架构设备的热更新流程
