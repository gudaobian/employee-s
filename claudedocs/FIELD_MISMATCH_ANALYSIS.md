# 后端API字段不匹配分析报告

**测试时间**: 2025-12-23 10:39
**测试端点**: `http://127.0.0.1:3000/api/hot-update/check`
**测试版本**: 1.0.0 → 1.0.1

---

## 一、实际测试结果

### 1.1 后端实际返回（curl测试）

```bash
curl -s "http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&deviceId=device_test" | jq
```

**返回数据**：
```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "updateType": "hot",
    "versionChangeType": "patch",
    "version": "1.0.1",
    "currentVersion": "1.0.0",
    "isForceUpdate": true,
    "minVersion": null,
    "rolloutStatus": "eligible",
    "reason": "热更新可用",
    "hotUpdate": {
      "diffUrl": "http://localhost:9000/...",
      "manifest": {
        "version": "1.0.1",
        "fromVersion": "1.0.0",
        "toVersion": "1.0.1",
        "changed": ["package.json", "electron/renderer/minimal-index.html", ...],
        "deleted": [],
        "timestamp": "2025-12-23T02:39:42.015Z"
      }
    }
  }
}
```

**后端返回的 `hotUpdate.manifest` 字段**：
```json
{
  "version": "1.0.1",
  "fromVersion": "1.0.0",
  "toVersion": "1.0.1",
  "changed": ["package.json", ...],
  "deleted": [],
  "timestamp": "2025-12-23T02:39:42.015Z"
}
```

---

## 二、客户端期望的字段（基于代码分析）

### 2.1 TypeScript 类型定义

**文件**: `src/common/types/hot-update.types.ts:8-18`

```typescript
export interface HotUpdateManifest {
  version: string;               // 目标版本号
  diffUrl: string;               // 差异包下载URL
  diffSha512: string;            // SHA512校验值
  diffSize: number;              // 差异包大小(字节)
  changedFilesCount: number;     // 修改文件数
  deletedFilesCount: number;     // 删除文件数
  releaseNotes?: string;         // 更新说明
  requiresRestart: boolean;      // 是否需要重启
  fallbackFullUrl?: string;      // 完整更新包URL(兜底)
}
```

### 2.2 客户端代码实际使用位置

**文件**: `src/common/services/hot-update/HotUpdateService.ts`

| 字段 | 使用位置 | 代码行 | 用途 |
|------|---------|--------|------|
| `diffUrl` | `downloadDiffPackage()` | **Line 203** | `fetch(manifest.diffUrl, ...)` |
| `diffSha512` | `downloadAndApply()` | **Line 134** | `verifier.verify(diffPath, manifest.diffSha512)` |
| `diffSize` | `downloadAndApply()` | **Line 127** | `emit('downloading', { total: manifest.diffSize })` |
| `diffSize` | `downloadDiffPackage()` | **Line 211** | `const totalBytes = manifest.diffSize;` |
| `version` | `downloadAndApply()` | **Line 124** | `log.info(\`开始下载: ${manifest.version}\`)` |
| `requiresRestart` | - | - | 未直接使用，但是必需字段 |
| `changedFilesCount` | - | - | 日志记录用 |
| `deletedFilesCount` | - | - | 日志记录用 |

**代码证据**：

```typescript
// Line 203: 使用 diffUrl 下载
const response = await fetch(manifest.diffUrl, {
  timeout: 120000
});

// Line 134: 使用 diffSha512 校验
const isValid = await this.verifier.verify(diffPath, manifest.diffSha512);

// Line 127, 211: 使用 diffSize 计算进度
this.emit('downloading', { percent: 0, transferred: 0, total: manifest.diffSize });
const totalBytes = manifest.diffSize;
```

---

## 三、字段对比表（❌ 表示缺失）

| 字段 | 后端返回 | 客户端需要 | 客户端使用位置 | 优先级 |
|------|---------|-----------|--------------|--------|
| `version` | ✅ | ✅ | Line 124 | 🔴 必需 |
| `diffUrl` | ❌ | ✅ | **Line 203** | 🔴 **必需** |
| `diffSha512` | ❌ | ✅ | **Line 134** | 🔴 **必需** |
| `diffSize` | ❌ | ✅ | **Line 127, 211** | 🔴 **必需** |
| `requiresRestart` | ❌ | ✅ | - | 🔴 必需 |
| `changedFilesCount` | ❌ | ✅ | - | 🟡 推荐 |
| `deletedFilesCount` | ❌ | ✅ | - | 🟡 推荐 |
| `releaseNotes` | ❌ | 可选 | - | 🟢 可选 |
| `fallbackFullUrl` | ❌ | 可选 | - | 🟢 可选 |
| `fromVersion` | ✅ | ❌ | - | ⚪ 不需要 |
| `toVersion` | ✅ | ❌ | - | ⚪ 不需要 |
| `changed` | ✅ | ❌ | - | ⚪ 不需要 |
| `deleted` | ✅ | ❌ | - | ⚪ 不需要 |
| `timestamp` | ✅ | ❌ | - | ⚪ 不需要 |

---

## 四、问题根因

### 4.1 混淆了两种 manifest

后端返回的是**差异包内部的 DiffManifest**（文件变更列表），而不是客户端需要的 **HotUpdateManifest**（元数据）。

**两种 manifest 的区别**：

| | DiffManifest（差异包内部） | HotUpdateManifest（API返回） |
|--|--------------------------|---------------------------|
| **用途** | 描述文件变更列表 | 描述如何下载和校验差异包 |
| **位置** | 差异包内的 `manifest.json` | API 响应的 `data.hotUpdate.manifest` |
| **包含字段** | `changed`, `deleted`, `fromVersion`, `toVersion` | `diffUrl`, `diffSha512`, `diffSize`, `requiresRestart` |

**当前情况**：后端把差异包**内部**的 `manifest.json` 直接返回给了客户端。

---

## 五、客户端报错原因

### 5.1 实际日志

```
[HotUpdate] 发现更新: 1.0.1 (hot)
[UPDATE] [HotUpdate] Hot update available { version: '1.0.1', updateType: 'hot' }
[UPDATE] [CHECK] No hot update available, no further action needed
```

### 5.2 报错逻辑

**文件**: `src/common/services/auto-update-service.ts:366-398`

```typescript
const manifest = updateInfo?.hotUpdate?.manifest || updateInfo?.manifest;

if (updateInfo?.hasUpdate && updateInfo.updateType === 'hot' && manifest) {
  // ✅ 条件满足：hasUpdate=true, updateType='hot', manifest存在

  // ❌ 但是后续代码会报错，因为：
  // Line 386: manifest.diffUrl 不存在 → fetch 会报错
  // Line 134: manifest.diffSha512 不存在 → 校验会报错
  // Line 127/211: manifest.diffSize 不存在 → 进度计算会报错
}
```

**为什么日志显示"No hot update available"**：
虽然 `manifest` 对象存在，但是它缺少必需字段，后续代码会报错。客户端没有执行到 `downloadAndApply`，而是直接跳到了 `[CHECK] No hot update available`。

这说明客户端在检查 manifest 时发现它不完整，所以认为没有可用更新。

---

## 六、后端修复方案（严格基于测试）

### 6.1 需要添加的字段

后端需要在 `data.hotUpdate.manifest` 中添加以下字段：

```json
{
  "version": "1.0.1",                    // ✅ 已有
  "diffUrl": "http://localhost:9000/...", // ❌ 需要添加
  "diffSha512": "...",                   // ❌ 需要添加（128字符）
  "diffSize": 25600,                     // ❌ 需要添加（字节数）
  "changedFilesCount": 5,                // ❌ 需要添加
  "deletedFilesCount": 0,                // ❌ 需要添加
  "requiresRestart": true,               // ❌ 需要添加
  "releaseNotes": "...",                 // 🟢 可选
  "fallbackFullUrl": "..."               // 🟢 可选
}
```

### 6.2 如何获取这些值

#### 1. `diffUrl`

**来源**：后端已经生成了这个URL，在 `data.hotUpdate.diffUrl` 中。

**修复**：把 `data.hotUpdate.diffUrl` 复制到 `data.hotUpdate.manifest.diffUrl`。

```javascript
manifest.diffUrl = hotUpdate.diffUrl;
```

#### 2. `diffSha512`

**来源**：计算差异包文件的SHA512。

**命令**（macOS/Linux）：
```bash
shasum -a 512 diff.tar.gz | awk '{print $1}'
```

**Node.js**：
```javascript
const crypto = require('crypto');
const fs = require('fs');

function calculateSHA512(filePath) {
  const hash = crypto.createHash('sha512');
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 使用
const sha512 = await calculateSHA512('./diff.tar.gz');
manifest.diffSha512 = sha512;  // 128字符的十六进制字符串
```

#### 3. `diffSize`

**来源**：差异包文件大小（字节）。

**命令**：
```bash
# macOS
stat -f%z diff.tar.gz

# Linux
stat -c%s diff.tar.gz
```

**Node.js**：
```javascript
const fs = require('fs');
const stats = fs.statSync('./diff.tar.gz');
manifest.diffSize = stats.size;  // 例如: 25600
```

#### 4. `changedFilesCount` 和 `deletedFilesCount`

**来源**：从差异包内的 `manifest.json` 读取。

**命令**：
```bash
# 从 tar.gz 中读取 manifest.json
tar -xzf diff.tar.gz manifest.json -O | jq

# 获取变更文件数
tar -xzf diff.tar.gz manifest.json -O | jq '.changedFiles | length'
# 或 jq '.changed | length' (取决于字段名)

# 获取删除文件数
tar -xzf diff.tar.gz manifest.json -O | jq '.deletedFiles | length'
# 或 jq '.deleted | length'
```

**Node.js**：
```javascript
const tar = require('tar');

// 从差异包中读取 manifest.json
async function readManifestFromTarGz(tarGzPath) {
  // 解压到临时目录
  const tempDir = './temp-extract';
  await tar.extract({
    file: tarGzPath,
    cwd: tempDir,
    filter: (path) => path === 'manifest.json'
  });

  const manifest = require(path.join(tempDir, 'manifest.json'));
  return manifest;
}

const internalManifest = await readManifestFromTarGz('./diff.tar.gz');
manifest.changedFilesCount = internalManifest.changedFiles.length;  // 或 .changed.length
manifest.deletedFilesCount = internalManifest.deletedFiles.length;  // 或 .deleted.length
```

#### 5. `requiresRestart`

**来源**：通常为 `true`（热更新需要重启才能生效）。

```javascript
manifest.requiresRestart = true;
```

### 6.3 完整修复示例（Node.js）

```javascript
router.get('/api/hot-update/check', async (req, res) => {
  const { currentVersion, platform } = req.query;

  // ... 其他逻辑 ...

  if (hasHotUpdate) {
    const diffFilePath = `./diffs/darwin/1.0.0-to-1.0.1/diff.tar.gz`;

    // 1. 获取文件信息
    const stats = fs.statSync(diffFilePath);
    const diffSize = stats.size;

    // 2. 计算 SHA512
    const diffSha512 = await calculateSHA512(diffFilePath);

    // 3. 读取差异包内的 manifest.json
    const internalManifest = await readManifestFromTarGz(diffFilePath);

    // 4. 构造正确的响应
    return res.json({
      success: true,
      data: {
        hasUpdate: true,
        updateType: 'hot',
        version: '1.0.1',
        currentVersion: currentVersion,
        versionChangeType: 'patch',
        hotUpdate: {
          diffUrl: 'http://localhost:9000/...',
          manifest: {
            version: '1.0.1',
            diffUrl: 'http://localhost:9000/...',  // ← 添加
            diffSha512: diffSha512,                  // ← 添加
            diffSize: diffSize,                      // ← 添加
            changedFilesCount: internalManifest.changedFiles.length,  // ← 添加
            deletedFilesCount: internalManifest.deletedFiles.length,  // ← 添加
            requiresRestart: true,                   // ← 添加
            releaseNotes: '测试热更新',             // 可选
            fallbackFullUrl: 'http://...'            // 可选
          }
        }
      }
    });
  }
});
```

---

## 七、验证方法

### 7.1 后端修复后验证

```bash
# 1. 测试API
curl -s "http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&deviceId=test" | jq '.data.hotUpdate.manifest'

# 2. 验证必需字段
curl -s "http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&deviceId=test" | jq '.data.hotUpdate.manifest | keys | sort'

# 应该包含：
# ["changedFilesCount", "deletedFilesCount", "diffSha512", "diffSize", "diffUrl", "requiresRestart", "version"]

# 3. 验证 SHA512 长度
curl -s "http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&deviceId=test" | jq '.data.hotUpdate.manifest.diffSha512 | length'

# 应该输出: 128
```

### 7.2 客户端日志验证

修复后，客户端日志应该显示：

```
[HotUpdate] 发现更新: 1.0.1 (hot)
[UPDATE] [CHECK] Hot update available: 1.0.1 {
  manifestSource: 'hotUpdate.manifest'
}
[HotUpdate] 开始下载并应用更新: 1.0.1
[HotUpdate] 下载差异包: http://localhost:9000/...
[HotUpdate] 下载完成
[HotUpdate] 校验通过
[HotUpdate] 备份完成
[DiffApplier] 差异包解压完成
[DiffApplier] 已复制: package.json
[DiffApplier] 复制完成: 2/2
[CHECK] Hot update successful, prompting restart
```

---

## 八、总结

### 8.1 核心问题

**后端返回的不是正确的数据结构**：返回了差异包内部的文件列表，而不是热更新元数据。

### 8.2 必须修复的字段（基于代码证据）

| 字段 | 客户端使用位置 | 无此字段会导致 |
|------|--------------|--------------|
| `diffUrl` | Line 203 | **fetch 报错** |
| `diffSha512` | Line 134 | **校验报错** |
| `diffSize` | Line 127, 211 | **进度计算报错** |
| `requiresRestart` | - | TypeScript 类型错误 |
| `changedFilesCount` | - | 日志不完整 |
| `deletedFilesCount` | - | 日志不完整 |

### 8.3 修复优先级

🔴 **P0（立即修复，否则无法下载）**：
- `diffUrl`
- `diffSha512`
- `diffSize`
- `requiresRestart`

🟡 **P1（推荐修复，影响日志）**：
- `changedFilesCount`
- `deletedFilesCount`

🟢 **P2（可选）**：
- `releaseNotes`
- `fallbackFullUrl`

---

**报告生成时间**: 2025-12-23
**客户端版本**: v1.0.2
**测试方法**: 实际curl测试 + 代码分析
