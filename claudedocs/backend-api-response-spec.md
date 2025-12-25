# 后端API响应格式规范

## API端点：/api/hot-update/check

### 请求参数

```
GET /api/hot-update/check?currentVersion=1.0.0&platform=darwin&deviceId=device_xxx
```

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| currentVersion | string | 是 | 当前客户端版本号 (例如: "1.0.0") |
| platform | string | 是 | 操作系统平台 ("darwin" 或 "win32") |
| deviceId | string | 是 | 设备唯一标识符 |

---

## 响应格式

### 外层结构

```json
{
  "success": true,
  "data": {
    // CheckUpdateResponse 对象（见下文）
  }
}
```

### CheckUpdateResponse 对象

#### 情况1：有热更新可用

```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "updateType": "hot",
    "version": "1.0.1",
    "currentVersion": "1.0.0",
    "versionChangeType": "patch",
    "isForceUpdate": false,
    "minVersion": null,
    "reason": "Bug fixes and improvements",
    "hotUpdate": {
      "diffUrl": "https://cdn.example.com/diffs/diff-1.0.0-to-1.0.1.tar.gz",
      "manifest": {
        "version": "1.0.1",
        "diffUrl": "https://cdn.example.com/diffs/diff-1.0.0-to-1.0.1.tar.gz",
        "diffSha512": "abc123...",
        "diffSize": 25600,
        "changedFilesCount": 2,
        "deletedFilesCount": 0,
        "releaseNotes": "- Fixed button color\n- Updated version",
        "requiresRestart": true,
        "fallbackFullUrl": "https://cdn.example.com/releases/EmployeeSafety-1.0.1-arm64-mac.zip"
      }
    }
  }
}
```

#### 情况2：需要完整更新（Major版本）

```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "updateType": "full",
    "version": "2.0.0",
    "currentVersion": "1.0.0",
    "versionChangeType": "major",
    "isForceUpdate": false,
    "minVersion": null,
    "reason": "Major version update requires full installation",
    "downloadUrl": "https://cdn.example.com/releases/EmployeeSafety-2.0.0-arm64-mac.zip"
  }
}
```

#### 情况3：无可用更新

```json
{
  "success": true,
  "data": {
    "hasUpdate": false,
    "version": "1.0.0",
    "currentVersion": "1.0.0",
    "reason": "Already up to date"
  }
}
```

---

## 字段详细说明

### CheckUpdateResponse 字段

| 字段名 | 类型 | 必需 | 说明 | 示例值 |
|--------|------|------|------|--------|
| `hasUpdate` | boolean | **是** | 是否有可用更新 | `true` |
| `updateType` | string | 条件 | 更新类型，`hasUpdate=true`时必需 | `"hot"` 或 `"full"` |
| `version` | string | **是** | 最新版本号 | `"1.0.1"` |
| `currentVersion` | string | **是** | 当前版本号（回显） | `"1.0.0"` |
| `versionChangeType` | string | 条件 | 版本变更类型，`hasUpdate=true`时必需 | `"major"` / `"minor"` / `"patch"` |
| `isForceUpdate` | boolean | 可选 | 是否强制更新 | `false` |
| `minVersion` | string \| null | 可选 | 最低兼容版本 | `"0.9.0"` 或 `null` |
| `reason` | string | 可选 | 更新原因说明 | `"Bug fixes"` |
| `hotUpdate` | object | 条件 | 热更新信息，`updateType="hot"`时**必需** | 见下文 |
| `downloadUrl` | string | 条件 | 完整更新下载链接，`updateType="full"`时**必需** | `"https://..."` |

### hotUpdate 对象

| 字段名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| `diffUrl` | string | 可选 | 差异包下载URL（冗余字段，主要在manifest中） |
| `manifest` | object | **是** | HotUpdateManifest 对象（见下文） |

### HotUpdateManifest 对象（关键！）

| 字段名 | 类型 | 必需 | 说明 | 示例值 |
|--------|------|------|------|--------|
| `version` | string | **是** | 目标版本号 | `"1.0.1"` |
| `diffUrl` | string | **是** | 差异包下载URL | `"https://cdn.example.com/diffs/diff-1.0.0-to-1.0.1.tar.gz"` |
| `diffSha512` | string | **是** | 差异包SHA512校验值 | `"abc123..."` (128字符) |
| `diffSize` | number | **是** | 差异包文件大小（字节） | `25600` |
| `changedFilesCount` | number | **是** | 变更文件数量 | `2` |
| `deletedFilesCount` | number | **是** | 删除文件数量 | `0` |
| `requiresRestart` | boolean | **是** | 是否需要重启（通常为true） | `true` |
| `releaseNotes` | string | 可选 | 更新说明 | `"- Fixed bugs\n- Improved performance"` |
| `fallbackFullUrl` | string | 可选 | 兜底的完整更新包URL | `"https://..."` |

---

## 完整响应示例（复制使用）

### 测试热更新响应（1.0.0 → 1.0.1）

```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "updateType": "hot",
    "version": "1.0.1",
    "currentVersion": "1.0.0",
    "versionChangeType": "patch",
    "isForceUpdate": false,
    "minVersion": null,
    "reason": "Test hot update with button color change",
    "hotUpdate": {
      "diffUrl": "http://127.0.0.1:3000/downloads/diffs/diff-1.0.0-to-1.0.1.tar.gz",
      "manifest": {
        "version": "1.0.1",
        "diffUrl": "http://127.0.0.1:3000/downloads/diffs/diff-1.0.0-to-1.0.1.tar.gz",
        "diffSha512": "请替换为实际的SHA512值",
        "diffSize": 25600,
        "changedFilesCount": 2,
        "deletedFilesCount": 0,
        "releaseNotes": "测试热更新：\n- 按钮颜色变更为绿色\n- 版本号升级",
        "requiresRestart": true,
        "fallbackFullUrl": "http://127.0.0.1:3000/downloads/EmployeeSafety-1.0.1-arm64-mac.zip"
      }
    }
  }
}
```

---

## 关键验证点

### ✅ 必需字段检查清单

**外层结构**：
- [ ] `success` 字段存在且为 `true`
- [ ] `data` 字段存在且为对象

**CheckUpdateResponse**：
- [ ] `hasUpdate` 字段存在
- [ ] `version` 字段存在
- [ ] `currentVersion` 字段存在
- [ ] `updateType` 字段存在（当 hasUpdate=true 时）

**当 updateType="hot" 时**：
- [ ] `hotUpdate` 对象存在
- [ ] `hotUpdate.manifest` 对象存在

**HotUpdateManifest（最关键）**：
- [ ] `version` 存在
- [ ] `diffUrl` 存在且是有效URL
- [ ] `diffSha512` 存在且是128字符的十六进制字符串
- [ ] `diffSize` 存在且为正整数
- [ ] `changedFilesCount` 存在且为非负整数
- [ ] `deletedFilesCount` 存在且为非负整数
- [ ] `requiresRestart` 存在且为布尔值

---

## 客户端日志验证

### 成功的日志示例

```
[HotUpdate] 请求URL: http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&deviceId=device_xxx
[HotUpdate] 发现更新: 1.0.1 (hot)
[UPDATE] [HotUpdate] Hot update available { version: '1.0.1', updateType: 'hot' }
[UPDATE] [CHECK] Hot update available: 1.0.1 {
  versionChangeType: 'patch',
  isForceUpdate: false,
  currentVersion: '1.0.0',
  minVersion: null,
  manifestSource: 'hotUpdate.manifest'
}
[HotUpdate] 开始下载并应用更新: 1.0.1
[HotUpdate] 下载差异包: http://127.0.0.1:3000/downloads/diffs/diff-1.0.0-to-1.0.1.tar.gz
```

### 失败的日志示例（字段缺失）

```
[HotUpdate] 发现更新: 1.0.1 (hot)
[UPDATE] [HotUpdate] Hot update available { version: '1.0.1', updateType: 'hot' }
[UPDATE] [CHECK] No hot update available, no further action needed  // ← manifest 字段缺失
```

---

## 常见错误

### 错误1：manifest 字段缺失

**错误响应**：
```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "updateType": "hot",
    "version": "1.0.1",
    "hotUpdate": {
      "diffUrl": "https://..."
      // ❌ 缺少 manifest 字段
    }
  }
}
```

**后果**：客户端判断为"No hot update available"

**修复**：添加完整的 `hotUpdate.manifest` 对象

---

### 错误2：manifest 字段不完整

**错误响应**：
```json
{
  "success": true,
  "data": {
    "hasUpdate": true,
    "updateType": "hot",
    "hotUpdate": {
      "manifest": {
        "version": "1.0.1",
        "diffUrl": "https://..."
        // ❌ 缺少 diffSha512, diffSize, changedFilesCount 等必需字段
      }
    }
  }
}
```

**后果**：下载时会报错（TypeScript 类型错误或运行时错误）

**修复**：确保 manifest 包含所有必需字段

---

### 错误3：diffSha512 格式错误

**错误示例**：
```json
{
  "diffSha512": "abc123"  // ❌ 太短，应该是128字符
}
```

**后果**：校验失败，热更新失败

**修复**：使用正确的SHA512计算
```bash
shasum -a 512 diff-package.tar.gz
```

---

## 生成 SHA512 校验值

### macOS/Linux

```bash
# 生成差异包的SHA512
shasum -a 512 diff-1.0.0-to-1.0.1.tar.gz | awk '{print $1}'
```

### Node.js

```javascript
const crypto = require('crypto');
const fs = require('fs');

function calculateSHA512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 使用
calculateSHA512('diff-1.0.0-to-1.0.1.tar.gz').then(sha512 => {
  console.log('SHA512:', sha512);
});
```

---

## 测试工具

### cURL 测试命令

```bash
curl -X GET "http://127.0.0.1:3000/api/hot-update/check?currentVersion=1.0.0&platform=darwin&deviceId=test_device" \
  -H "Content-Type: application/json" | jq
```

### 预期输出验证

```bash
# 1. 检查外层结构
echo $response | jq '.success'  # 应该输出 true
echo $response | jq '.data.hasUpdate'  # 应该输出 true

# 2. 检查 manifest 存在
echo $response | jq '.data.hotUpdate.manifest.version'  # 应该输出 "1.0.1"
echo $response | jq '.data.hotUpdate.manifest.diffSha512 | length'  # 应该输出 128

# 3. 检查所有必需字段
echo $response | jq '.data.hotUpdate.manifest | keys'
# 应该包含: ["changedFilesCount", "deletedFilesCount", "diffSha512", "diffSize", "diffUrl", "requiresRestart", "version"]
```

---

## 后端实现参考

### Node.js/Express 示例

```javascript
router.get('/api/hot-update/check', async (req, res) => {
  const { currentVersion, platform, deviceId } = req.query;

  // 判断是否有更新
  const latestVersion = '1.0.1';
  const hasUpdate = currentVersion !== latestVersion;

  if (!hasUpdate) {
    return res.json({
      success: true,
      data: {
        hasUpdate: false,
        version: currentVersion,
        currentVersion: currentVersion,
        reason: 'Already up to date'
      }
    });
  }

  // 判断更新类型（基于语义化版本）
  const updateType = determineUpdateType(currentVersion, latestVersion); // 'hot' 或 'full'

  if (updateType === 'hot') {
    // 读取差异包信息
    const diffPackagePath = `./diffs/diff-${currentVersion}-to-${latestVersion}.tar.gz`;
    const diffStats = fs.statSync(diffPackagePath);
    const diffSha512 = await calculateSHA512(diffPackagePath);

    // 读取差异包中的 manifest.json
    const manifestData = await readManifestFromTarGz(diffPackagePath);

    return res.json({
      success: true,
      data: {
        hasUpdate: true,
        updateType: 'hot',
        version: latestVersion,
        currentVersion: currentVersion,
        versionChangeType: getVersionChangeType(currentVersion, latestVersion),
        isForceUpdate: false,
        minVersion: null,
        reason: 'Bug fixes and improvements',
        hotUpdate: {
          diffUrl: `http://127.0.0.1:3000/downloads/diffs/diff-${currentVersion}-to-${latestVersion}.tar.gz`,
          manifest: {
            version: latestVersion,
            diffUrl: `http://127.0.0.1:3000/downloads/diffs/diff-${currentVersion}-to-${latestVersion}.tar.gz`,
            diffSha512: diffSha512,
            diffSize: diffStats.size,
            changedFilesCount: manifestData.changedFiles.length,
            deletedFilesCount: manifestData.deletedFiles.length,
            releaseNotes: 'Test hot update',
            requiresRestart: true,
            fallbackFullUrl: `http://127.0.0.1:3000/downloads/EmployeeSafety-${latestVersion}-arm64-mac.zip`
          }
        }
      }
    });
  } else {
    // Major 版本更新
    return res.json({
      success: true,
      data: {
        hasUpdate: true,
        updateType: 'full',
        version: latestVersion,
        currentVersion: currentVersion,
        versionChangeType: 'major',
        reason: 'Major version update requires full installation',
        downloadUrl: `http://127.0.0.1:3000/downloads/EmployeeSafety-${latestVersion}-arm64-mac.zip`
      }
    });
  }
});
```

---

**文档版本**：v1.1
**更新日期**：2025-12-23
**适用客户端版本**：≥ v1.0.2
