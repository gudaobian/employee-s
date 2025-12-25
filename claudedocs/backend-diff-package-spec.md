# 后端差异包生成规范

## 概述

本文档定义了后端生成热更新差异包的完整规范，确保前后端格式兼容。

---

## 一、差异包目录结构

### 推荐结构（后端格式）

```
diff-package-1.0.166-to-1.0.167.zip
├── manifest.json          # 清单文件（必需）
└── changed/               # 变更文件目录（必需，目录名必须是"changed"）
    ├── package.json       # 变更的文件（保持相对路径）
    ├── electron/
    │   └── renderer/
    │       └── minimal-index.html
    └── out/
        └── common/
            └── services/
                └── auto-update-service.js
```

### 替代结构（前端格式，向后兼容）

```
diff-package.zip
├── manifest.json          # 清单文件（必需）
└── files/                 # 变更文件目录（前端格式）
    ├── package.json
    └── ...
```

**⚠️ 重要**：
- 客户端优先检查 `changed/` 目录，如果不存在则检查 `files/` 目录
- **推荐使用 `changed/` 目录**（后端格式）
- 目录名必须完全匹配（区分大小写）

---

## 二、清单文件格式（manifest.json）

客户端支持两种格式（自动检测），推荐使用**后端格式**。

### 格式1：后端格式（推荐）

```json
{
  "fromVersion": "1.0.166",
  "toVersion": "1.0.167",
  "changedFiles": [
    "package.json",
    "electron/renderer/minimal-index.html",
    "out/common/services/auto-update-service.js"
  ],
  "deletedFiles": [
    "out/common/config/update-config.js"
  ],
  "timestamp": "2025-12-23T10:30:00.000Z",
  "generatedAt": "2025-12-23T10:30:00.000Z"
}
```

### 格式2：前端格式（向后兼容）

```json
{
  "version": "1.0.167",
  "fromVersion": "1.0.166",
  "toVersion": "1.0.167",
  "changed": [
    "package.json",
    "electron/renderer/minimal-index.html"
  ],
  "deleted": [
    "out/common/config/update-config.js"
  ],
  "timestamp": "2025-12-23T10:30:00.000Z"
}
```

### 字段说明

| 字段 | 后端格式 | 前端格式 | 类型 | 必需 | 说明 |
|------|---------|---------|------|------|------|
| fromVersion | `fromVersion` | `fromVersion` | string | 可选 | 源版本号 |
| toVersion | `toVersion` | `toVersion` | string | **必需** | 目标版本号 |
| version | - | `version` | string | **必需**（前端格式） | 目标版本号（前端格式时必需） |
| changedFiles | `changedFiles` | `changed` | string[] | **必需** | 变更文件列表 |
| deletedFiles | `deletedFiles` | `deleted` | string[] | **必需** | 删除文件列表 |
| timestamp | `timestamp` 或 `generatedAt` | `timestamp` | string | 可选 | 生成时间（ISO 8601） |

**客户端检测逻辑**：
```typescript
// 智能检测格式类型
const hasBackendFields = content.changedFiles !== undefined || content.deletedFiles !== undefined;
const hasFrontendFields = content.changed !== undefined || content.deleted !== undefined;

if (hasBackendFields) {
  // 使用后端格式，自动转换为前端格式
} else if (hasFrontendFields) {
  // 直接使用前端格式
}
```

---

## 三、文件路径规范

### 路径格式

所有文件路径必须：
1. **相对路径**：相对于应用根目录（ASAR 根目录）
2. **Unix 风格**：使用 `/` 分隔符（不使用 `\`）
3. **不包含前导斜杠**：`package.json` ✅，`/package.json` ❌

### 示例路径

```json
{
  "changedFiles": [
    "package.json",                                    // ✅ 根目录文件
    "electron/renderer/minimal-index.html",            // ✅ 嵌套目录文件
    "out/common/services/auto-update-service.js",      // ✅ 编译输出文件
    "node_modules/some-module/index.js"                // ✅ 依赖文件（如果需要）
  ],
  "deletedFiles": [
    "out/common/config/update-config.js",              // ✅ 删除的文件
    "deprecated/old-feature.js"                        // ✅ 废弃文件
  ]
}
```

### 错误示例

```json
{
  "changedFiles": [
    "/package.json",                                   // ❌ 不要前导斜杠
    "electron\\renderer\\minimal-index.html",          // ❌ 不要反斜杠
    "../outside/file.js",                              // ❌ 不要相对路径导航
    "C:/absolute/path/file.js"                         // ❌ 不要绝对路径
  ]
}
```

---

## 四、changed/ 目录文件组织

`changed/` 目录下的文件必须**保持完整的相对路径结构**。

### 正确示例

如果 `manifest.json` 中有：
```json
{
  "changedFiles": [
    "package.json",
    "electron/renderer/minimal-index.html",
    "out/common/services/auto-update-service.js"
  ]
}
```

则 `changed/` 目录结构必须是：
```
changed/
├── package.json                                       # 对应 "package.json"
├── electron/                                          # 对应 "electron/..."
│   └── renderer/
│       └── minimal-index.html
└── out/                                               # 对应 "out/..."
    └── common/
        └── services/
            └── auto-update-service.js
```

### 错误示例

❌ **扁平化存储**（会导致文件找不到）：
```
changed/
├── package.json
├── minimal-index.html                                 # ❌ 缺少 electron/renderer/ 路径
└── auto-update-service.js                             # ❌ 缺少 out/common/services/ 路径
```

❌ **不完整路径**：
```
changed/
├── package.json
└── renderer/                                          # ❌ 缺少 electron/ 父目录
    └── minimal-index.html
```

---

## 五、压缩包生成步骤

### Node.js 示例（使用 tar）

```javascript
const tar = require('tar');
const fs = require('fs-extra');
const path = require('path');

async function generateDiffPackage(fromVersion, toVersion, changedFiles, deletedFiles) {
  const tempDir = path.join(process.cwd(), 'temp-diff-package');
  const changedDir = path.join(tempDir, 'changed');

  try {
    // 1. 创建临时目录
    await fs.ensureDir(changedDir);

    // 2. 生成清单文件（后端格式）
    const manifest = {
      fromVersion,
      toVersion,
      changedFiles: changedFiles.map(f => f.relativePath),
      deletedFiles: deletedFiles.map(f => f.relativePath),
      timestamp: new Date().toISOString(),
      generatedAt: new Date().toISOString()
    };
    await fs.writeJson(path.join(tempDir, 'manifest.json'), manifest, { spaces: 2 });

    // 3. 复制变更文件到 changed/ 目录（保持相对路径）
    for (const file of changedFiles) {
      const sourcePath = file.absolutePath;           // 源文件的绝对路径
      const relativePath = file.relativePath;         // 相对于应用根目录的路径
      const targetPath = path.join(changedDir, relativePath);

      // 确保父目录存在
      await fs.ensureDir(path.dirname(targetPath));

      // 复制文件
      await fs.copy(sourcePath, targetPath);
      console.log(`已复制: ${relativePath}`);
    }

    // 4. 压缩为 tar.gz
    const outputFile = `diff-package-${fromVersion}-to-${toVersion}.tar.gz`;
    await tar.create(
      {
        gzip: true,
        file: outputFile,
        cwd: tempDir
      },
      ['manifest.json', 'changed']
    );

    console.log(`✅ 差异包生成成功: ${outputFile}`);

    // 5. 清理临时目录
    await fs.remove(tempDir);

    return outputFile;
  } catch (error) {
    console.error('生成差异包失败:', error);
    await fs.remove(tempDir);
    throw error;
  }
}

// 使用示例
const changedFiles = [
  {
    absolutePath: '/build/output/package.json',
    relativePath: 'package.json'
  },
  {
    absolutePath: '/build/output/electron/renderer/minimal-index.html',
    relativePath: 'electron/renderer/minimal-index.html'
  },
  {
    absolutePath: '/build/output/out/common/services/auto-update-service.js',
    relativePath: 'out/common/services/auto-update-service.js'
  }
];

const deletedFiles = [
  {
    relativePath: 'out/common/config/update-config.js'
  }
];

generateDiffPackage('1.0.166', '1.0.167', changedFiles, deletedFiles);
```

---

## 六、API 响应格式（checkForUpdates）

后端 API 需要返回包含版本判断和更新类型的响应：

### 热更新响应（Patch/Minor 版本）

```json
{
  "available": true,
  "hasUpdate": true,
  "updateType": "hot",
  "versionChangeType": "patch",
  "version": "1.0.167",
  "currentVersion": "1.0.166",
  "minVersion": null,
  "isForceUpdate": false,
  "reason": "Patch update available",
  "hotUpdate": {
    "diffUrl": "https://cdn.example.com/diffs/diff-1.0.166-to-1.0.167.tar.gz",
    "manifest": {
      "version": "1.0.167",
      "fromVersion": "1.0.166",
      "toVersion": "1.0.167",
      "changed": ["package.json", "electron/renderer/minimal-index.html"],
      "deleted": [],
      "timestamp": "2025-12-23T10:30:00.000Z"
    }
  }
}
```

### 完整更新响应（Major 版本）

```json
{
  "available": true,
  "hasUpdate": true,
  "updateType": "full",
  "versionChangeType": "major",
  "version": "2.0.0",
  "currentVersion": "1.0.167",
  "minVersion": null,
  "isForceUpdate": false,
  "reason": "Major version update requires full installation",
  "downloadUrl": "https://cdn.example.com/releases/EmployeeSafety-2.0.0-arm64-mac.zip"
}
```

### 无更新响应

```json
{
  "available": false,
  "hasUpdate": false,
  "version": "1.0.167",
  "currentVersion": "1.0.167",
  "reason": "Already up to date"
}
```

### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `available` | boolean | 是 | 是否有可用更新 |
| `hasUpdate` | boolean | 是 | 是否有更新（同 available） |
| `updateType` | `"hot"` \| `"full"` | 是 | **后端判断**的更新类型 |
| `versionChangeType` | `"major"` \| `"minor"` \| `"patch"` | 是 | 版本变更类型 |
| `version` | string | 是 | 最新版本号 |
| `currentVersion` | string | 是 | 当前版本号 |
| `minVersion` | string \| null | 可选 | 最低兼容版本（强制更新） |
| `isForceUpdate` | boolean | 可选 | 是否强制更新 |
| `reason` | string | 可选 | 更新原因说明 |
| `hotUpdate` | object | 条件 | `updateType="hot"` 时必需 |
| `hotUpdate.diffUrl` | string | 是 | 差异包下载 URL |
| `hotUpdate.manifest` | object | 是 | 差异包清单（前端格式） |
| `downloadUrl` | string | 条件 | `updateType="full"` 时必需 |

---

## 七、版本判断逻辑（后端实现）

**客户端不再判断版本类型**，后端需要实现版本判断逻辑：

### 后端伪代码

```javascript
function determineUpdateType(currentVersion, latestVersion) {
  const current = parseVersion(currentVersion);  // [1, 0, 166]
  const latest = parseVersion(latestVersion);    // [2, 0, 0]

  // Major 版本更新（1.x.x → 2.x.x）
  if (latest[0] > current[0]) {
    return {
      updateType: 'full',
      versionChangeType: 'major',
      reason: 'Major version update requires full installation'
    };
  }

  // Minor 版本更新（1.0.x → 1.1.x）
  if (latest[1] > current[1]) {
    return {
      updateType: 'hot',
      versionChangeType: 'minor',
      reason: 'Minor update available via hot update'
    };
  }

  // Patch 版本更新（1.0.166 → 1.0.167）
  if (latest[2] > current[2]) {
    return {
      updateType: 'hot',
      versionChangeType: 'patch',
      reason: 'Patch update available via hot update'
    };
  }

  return {
    updateType: null,
    versionChangeType: null,
    reason: 'Already up to date'
  };
}
```

### 特殊情况处理

1. **跨版本更新**（例如 1.0.160 → 1.0.167）
   - 检查是否有累积差异包
   - 如果没有，返回 `updateType: "full"`

2. **降级更新**（例如 1.0.167 → 1.0.166）
   - 通常不支持热更新降级
   - 返回 `updateType: "full"` 或 `available: false`

3. **强制更新**（最低版本要求）
   ```javascript
   if (currentVersion < minSupportedVersion) {
     return {
       updateType: 'full',  // 或 'hot'，取决于版本差异
       isForceUpdate: true,
       minVersion: minSupportedVersion
     };
   }
   ```

---

## 八、验证与测试

### 验证差异包完整性

```bash
# 1. 解压差异包
tar -xzf diff-package-1.0.166-to-1.0.167.tar.gz -C /tmp/verify

# 2. 检查目录结构
ls -la /tmp/verify
# 应该看到:
# - manifest.json
# - changed/

# 3. 检查清单文件
cat /tmp/verify/manifest.json | jq
# 验证字段：toVersion, changedFiles, deletedFiles

# 4. 检查文件完整性
cd /tmp/verify/changed
find . -type f
# 验证所有 changedFiles 中的文件都存在
# 验证路径结构与清单一致
```

### 客户端测试流程

1. **安装旧版本** (v1.0.166)
   ```bash
   open release/EmployeeSafety-1.0.166-arm64-mac.zip
   ```

2. **发布差异包到服务器**
   - 上传 `diff-package-1.0.166-to-1.0.167.tar.gz`
   - 配置 API 返回热更新响应

3. **触发更新检查**
   - 客户端启动后自动检查
   - 或手动触发更新

4. **查看日志验证**
   ```bash
   tail -f ~/Library/Logs/employee-safety-client/update.log
   ```

   成功日志：
   ```
   [DiffApplier] 差异包根目录内容: ["manifest.json","changed"]
   [DiffApplier] 文件目录内容 (changed): ["package.json","electron","out"]
   [DiffApplier] 已复制: package.json
   [DiffApplier] 已复制: electron/renderer/minimal-index.html
   [DiffApplier] 复制完成: 2/2
   [DiffApplier] 验证通过
   [CHECK] Hot update successful, prompting restart
   ```

---

## 九、常见问题排查

### 问题1：文件复制失败（0/N copied）

**症状**：
```
[DiffApplier] 源文件不存在,跳过: package.json
[DiffApplier] 复制完成: 0/5
```

**原因**：
- `changed/` 目录不存在
- 文件路径结构不正确
- 压缩包损坏

**解决**：
1. 解压差异包验证 `changed/` 目录存在
2. 检查文件路径是否保持相对路径结构
3. 重新生成差异包

### 问题2：清单格式无效

**症状**：
```
[DiffApplier] 差异清单格式无效（既不是前端格式也不是后端格式）
```

**原因**：
- 清单文件缺少必需字段
- 字段名称拼写错误

**解决**：
1. 验证清单文件包含 `toVersion` 字段
2. 验证包含 `changedFiles`/`deletedFiles` 或 `changed`/`deleted` 字段
3. 使用 JSON 验证工具检查语法

### 问题3：解压失败

**症状**：
```
[HotUpdate] Failed to extract diff package
```

**原因**：
- 压缩格式不支持
- 文件损坏
- 权限问题

**解决**：
1. 确保使用 tar.gz 格式
2. 验证压缩包完整性（MD5/SHA256）
3. 检查文件权限

---

## 十、总结

### 后端必须实现

✅ **1. 版本判断逻辑**
- 根据语义化版本号判断 `updateType`
- Major 版本 → `"full"`
- Minor/Patch 版本 → `"hot"`

✅ **2. 差异包生成**
- 使用 `changed/` 目录存储文件
- 保持完整的相对路径结构
- 生成正确的 `manifest.json`（后端格式推荐）

✅ **3. API 响应格式**
- 返回 `updateType` 字段（后端判断）
- 返回 `versionChangeType` 字段
- `updateType="hot"` 时提供 `hotUpdate.diffUrl` 和 `manifest`
- `updateType="full"` 时提供 `downloadUrl`

### 客户端已支持

✅ 自动检测两种清单格式（后端/前端）
✅ 自动检测两种目录结构（`changed/`/`files/`）
✅ 根据后端 `updateType` 决定更新方式
✅ 完整的错误日志和调试信息

### 推荐配置

- **清单格式**：后端格式（`changedFiles`/`deletedFiles`）
- **目录名称**：`changed/`
- **压缩格式**：tar.gz
- **版本判断**：后端负责

---

## 附录：完整示例

### 示例1：生成 1.0.166 → 1.0.167 差异包

**变更内容**：
- 修改 `package.json`（版本号变更）
- 修改 `electron/renderer/minimal-index.html`（按钮颜色）
- 修改 `out/common/services/auto-update-service.js`（移除版本判断逻辑）

**差异包结构**：
```
diff-package-1.0.166-to-1.0.167.tar.gz
├── manifest.json
└── changed/
    ├── package.json
    ├── electron/
    │   └── renderer/
    │       └── minimal-index.html
    └── out/
        └── common/
            └── services/
                └── auto-update-service.js
```

**manifest.json**：
```json
{
  "fromVersion": "1.0.166",
  "toVersion": "1.0.167",
  "changedFiles": [
    "package.json",
    "electron/renderer/minimal-index.html",
    "out/common/services/auto-update-service.js"
  ],
  "deletedFiles": [],
  "timestamp": "2025-12-23T12:00:00.000Z",
  "generatedAt": "2025-12-23T12:00:00.000Z"
}
```

**API 响应**：
```json
{
  "available": true,
  "hasUpdate": true,
  "updateType": "hot",
  "versionChangeType": "patch",
  "version": "1.0.167",
  "currentVersion": "1.0.166",
  "reason": "Bug fixes and improvements",
  "hotUpdate": {
    "diffUrl": "https://cdn.example.com/diffs/diff-1.0.166-to-1.0.167.tar.gz",
    "manifest": {
      "version": "1.0.167",
      "fromVersion": "1.0.166",
      "toVersion": "1.0.167",
      "changed": [
        "package.json",
        "electron/renderer/minimal-index.html",
        "out/common/services/auto-update-service.js"
      ],
      "deleted": [],
      "timestamp": "2025-12-23T12:00:00.000Z"
    }
  }
}
```

**预期客户端日志**：
```
[HotUpdate] Checking for hot updates
[CHECK] Trying hot update first
[CHECK] Hot update available: 1.0.167
[HotUpdate] Downloading diff package from: https://...
[DiffApplier] 开始解压差异包
[DiffApplier] 差异包解压完成
[DiffApplier] 读取清单文件: manifest.json
[DiffApplier] 检测到后端格式（基于字段结构）
[DiffApplier] 后端格式转换完成: {fileName: "manifest.json", version: "1.0.167", changedCount: 3, deletedCount: 0}
[DiffApplier] 开始应用差异
[DiffApplier] 变更文件: 3, 删除文件: 0
[DiffApplier] 使用文件目录: /var/.../changed
[DiffApplier] 差异包根目录内容: ["manifest.json","changed"]
[DiffApplier] 文件目录内容 (changed): ["package.json","electron","out"]
[DiffApplier] 已复制: package.json
[DiffApplier] 已复制: electron/renderer/minimal-index.html
[DiffApplier] 已复制: out/common/services/auto-update-service.js
[DiffApplier] 复制完成: 3/3
[DiffApplier] 差异应用完成
[DiffApplier] 开始验证差异应用结果
[DiffApplier] 验证通过
[CHECK] Hot update successful, prompting restart
```

---

**文档版本**：v1.0
**更新日期**：2025-12-23
**适用客户端版本**：≥ v1.0.162
