# 客户端持久化数据结构规范

## 文档版本

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| 1.0 | 2024-12-24 | Claude | 初始版本 - 用于后端接口设计 |

---

## 一、目录结构

客户端本地持久化目录：
```
~/Library/Application Support/employee-safety-client/queue-cache/
├── screenshots/          # 截图数据
│   └── 2024-12-24/
│       ├── screenshot_1703401200000.jpg       # 图片二进制文件
│       └── screenshot_1703401200000.meta.json # 元数据文件
├── activities/           # 活动数据
│   └── 2024-12-24/
│       └── activity_1703401200000.json
└── processes/            # 进程数据
    └── 2024-12-24/
        └── process_1703401200000.json
```

**说明**：
- 按**日期**分目录存储（`YYYY-MM-DD`格式）
- 文件名格式：`{type}_{timestamp}.{ext}`
- 截图采用**双文件**格式（`.jpg` + `.meta.json`）
- 活动和进程采用**单文件**格式（`.json`）

---

## 二、截图数据结构

### 2.1 图片文件

**文件名**: `screenshot_{timestamp}.jpg`
**格式**: JPEG 二进制文件
**质量**: 75（可配置，范围1-100）
**压缩**: Base64解码后的原始JPEG数据

**示例**:
```
screenshot_1703401200000.jpg  (约25KB - 50KB per file)
```

### 2.2 元数据文件

**文件名**: `screenshot_{timestamp}.meta.json`
**格式**: JSON

**完整数据结构**:
```json
{
  "id": "screenshot_1703401200000",
  "timestamp": 1703401200000,
  "type": "screenshot",
  "filePath": "/path/to/screenshot_1703401200000.jpg",
  "metaPath": "/path/to/screenshot_1703401200000.meta.json",
  "fileSize": 25600,
  "uploadStatus": "pending",
  "uploadAttempts": 0,
  "lastUploadAttempt": null,
  "createdAt": 1703401200000
}
```

**字段说明**:

| 字段 | 类型 | 必需 | 说明 | 示例值 |
|------|------|------|------|--------|
| `id` | string | ✅ | 唯一标识符 | `"screenshot_1703401200000"` |
| `timestamp` | number | ✅ | 截图时间戳（毫秒） | `1703401200000` |
| `type` | string | ✅ | 数据类型，固定为 `"screenshot"` | `"screenshot"` |
| `filePath` | string | ✅ | 图片文件绝对路径 | `"/path/to/screenshot_1703401200000.jpg"` |
| `metaPath` | string | ✅ | 元数据文件绝对路径 | `"/path/to/screenshot_1703401200000.meta.json"` |
| `fileSize` | number | ✅ | 图片文件大小（字节） | `25600` |
| `uploadStatus` | string | ✅ | 上传状态 | `"pending"` / `"uploading"` / `"success"` / `"failed"` |
| `uploadAttempts` | number | ✅ | 上传尝试次数 | `0` |
| `lastUploadAttempt` | number\|null | ✅ | 最后上传尝试时间戳 | `null` / `1703401300000` |
| `createdAt` | number | ✅ | 文件创建时间戳 | `1703401200000` |

### 2.3 后端需要的完整截图数据

**ZIP解压后，后端将收到以下格式**（需要组合 `.jpg` + `.meta.json`）：

```json
{
  "id": "screenshot_1703401200000",
  "timestamp": 1703401200000,
  "buffer": "<base64-encoded-jpeg-data>",
  "fileSize": 25600,
  "format": "jpg",
  "quality": 75,
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  "_metadata": {
    "uploadStatus": "pending",
    "uploadAttempts": 0,
    "lastUploadAttempt": null,
    "createdAt": 1703401200000
  }
}
```

**后端数据库插入需要的字段（从上述数据提取）**:
```typescript
{
  screenshot_id: "screenshot_1703401200000",       // 来自 id
  device_id: "{deviceId}",                         // 来自上传参数
  session_id: "{sessionId}",                       // 来自上传参数
  created_at: 1703401200000,                       // 来自 _metadata.createdAt
  timestamp: 1703401200000,                        // 来自 timestamp
  oss_url: "",                                     // 初始为空，上传OSS后填充
  file_size: 25600                                 // 来自 fileSize
}
```

**唯一索引约束**:
```sql
UNIQUE INDEX idx_screenshot_unique (created_at, timestamp, device_id, session_id)
```

---

## 三、活动数据结构

### 3.1 JSON文件

**文件名**: `activity_{timestamp}.json`
**格式**: JSON

**完整数据结构**:
```json
{
  "id": "activity_1703401200000",
  "timestamp": 1703401200000,
  "type": "activity",
  "data": {
    "deviceId": "device_918407e353c8721c",
    "timestamp": 1703401200000,
    "keystrokes": 116,
    "mouseClicks": 100,
    "idleTime": 0,
    "isActive": true,
    "mouseScrolls": 100,
    "activeWindow": "员工安全系统 - Google Chrome",
    "activeWindowProcess": "Google Chrome",
    "url": "http://localhost:3001/",
    "activityInterval": {
      "start": 1703401140000,
      "end": 1703401200000,
      "duration": 60000
    }
  },
  "_metadata": {
    "uploadStatus": "pending",
    "uploadAttempts": 0,
    "lastUploadAttempt": null,
    "createdAt": 1703401200000
  }
}
```

**字段说明**:

| 字段路径 | 类型 | 必需 | 说明 | 示例值 |
|---------|------|------|------|--------|
| `id` | string | ✅ | 唯一标识符 | `"activity_1703401200000"` |
| `timestamp` | number | ✅ | 活动时间戳（60秒聚合周期结束时间） | `1703401200000` |
| `type` | string | ✅ | 数据类型，固定为 `"activity"` | `"activity"` |
| `data.deviceId` | string | ✅ | 设备ID | `"device_918407e353c8721c"` |
| `data.timestamp` | number | ✅ | 活动时间戳（与外层相同） | `1703401200000` |
| `data.keystrokes` | number | ✅ | 键盘点击次数（60秒累加） | `116` |
| `data.mouseClicks` | number | ✅ | 鼠标点击次数（60秒累加） | `100` |
| `data.mouseScrolls` | number | ✅ | 鼠标滚动次数（60秒累加） | `100` |
| `data.idleTime` | number | ✅ | 空闲时间（毫秒） | `0` |
| `data.isActive` | boolean | ✅ | 是否活跃 | `true` |
| `data.activeWindow` | string | ✅ | 活动窗口标题（最后值） | `"员工安全系统 - Google Chrome"` |
| `data.activeWindowProcess` | string | ✅ | 活动窗口进程名（最后值） | `"Google Chrome"` |
| `data.url` | string | ✅ | 浏览器URL（最后值，已脱敏） | `"http://localhost:3001/"` |
| `data.activityInterval` | object | ⚠️ | 活动间隔信息（可选） | 见下方 |
| `data.activityInterval.start` | number | - | 间隔开始时间 | `1703401140000` |
| `data.activityInterval.end` | number | - | 间隔结束时间 | `1703401200000` |
| `data.activityInterval.duration` | number | - | 间隔时长（毫秒） | `60000` |
| `_metadata.uploadStatus` | string | ✅ | 上传状态 | `"pending"` |
| `_metadata.uploadAttempts` | number | ✅ | 上传尝试次数 | `0` |
| `_metadata.lastUploadAttempt` | number\|null | ✅ | 最后上传尝试时间 | `null` |
| `_metadata.createdAt` | number | ✅ | 文件创建时间 | `1703401200000` |

**重要说明**:
- ✅ **聚合数据**: `keystrokes`, `mouseClicks`, `mouseScrolls` 是**60秒内的累加值**
- ✅ **最后值**: `activeWindow`, `activeWindowProcess`, `url` 是**60秒周期结束时的最后值**
- ✅ **低频数据**: 每**60秒**产生**1条记录**，不存在高频冲突

**后端数据库插入需要的字段**:
```typescript
{
  activity_id: "activity_1703401200000",          // 来自 id
  device_id: "device_918407e353c8721c",           // 来自 data.deviceId
  session_id: "{sessionId}",                      // 来自上传参数
  timestamp: 1703401200000,                       // 来自 timestamp
  keystrokes: 116,                                // 来自 data.keystrokes
  mouse_clicks: 100,                              // 来自 data.mouseClicks
  mouse_scrolls: 100,                             // 来自 data.mouseScrolls
  idle_time: 0,                                   // 来自 data.idleTime
  is_active: true,                                // 来自 data.isActive
  active_window: "员工安全系统 - Google Chrome",   // 来自 data.activeWindow
  active_window_process: "Google Chrome",         // 来自 data.activeWindowProcess
  url: "http://localhost:3001/"                   // 来自 data.url
}
```

**唯一索引约束**:
```sql
UNIQUE INDEX idx_activity_unique (timestamp, session_id)
```

---

## 四、进程数据结构

### 4.1 JSON文件

**文件名**: `process_{timestamp}.json`
**格式**: JSON

**完整数据结构**:
```json
{
  "id": "process_1703401200000",
  "timestamp": 1703401200000,
  "type": "process",
  "data": {
    "deviceId": "device_918407e353c8721c",
    "timestamp": 1703401200000,
    "processes": [
      {
        "name": "Google Chrome",
        "pid": 12345,
        "cpu": 15.5,
        "memory": 512000000,
        "path": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "user": "zhangxiaoyu"
      },
      {
        "name": "Code",
        "pid": 23456,
        "cpu": 8.2,
        "memory": 256000000,
        "path": "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
        "user": "zhangxiaoyu"
      },
      {
        "name": "EmployeeSafety",
        "pid": 34567,
        "cpu": 2.1,
        "memory": 128000000,
        "path": "/Applications/EmployeeSafety.app/Contents/MacOS/EmployeeSafety",
        "user": "zhangxiaoyu"
      }
    ],
    "totalCpu": 25.8,
    "totalMemory": 896000000,
    "processCount": 3
  },
  "_metadata": {
    "uploadStatus": "pending",
    "uploadAttempts": 0,
    "lastUploadAttempt": null,
    "createdAt": 1703401200000
  }
}
```

**字段说明**:

| 字段路径 | 类型 | 必需 | 说明 | 示例值 |
|---------|------|------|------|--------|
| `id` | string | ✅ | 唯一标识符 | `"process_1703401200000"` |
| `timestamp` | number | ✅ | 进程采集时间戳 | `1703401200000` |
| `type` | string | ✅ | 数据类型，固定为 `"process"` | `"process"` |
| `data.deviceId` | string | ✅ | 设备ID | `"device_918407e353c8721c"` |
| `data.timestamp` | number | ✅ | 采集时间戳（与外层相同） | `1703401200000` |
| `data.processes` | array | ✅ | 进程列表 | 见下方 |
| `data.processes[].name` | string | ✅ | 进程名称 | `"Google Chrome"` |
| `data.processes[].pid` | number | ✅ | 进程ID | `12345` |
| `data.processes[].cpu` | number | ⚠️ | CPU使用率（百分比） | `15.5` |
| `data.processes[].memory` | number | ⚠️ | 内存占用（字节） | `512000000` |
| `data.processes[].path` | string | ⚠️ | 可执行文件路径 | `"/Applications/..."` |
| `data.processes[].user` | string | ⚠️ | 进程所属用户 | `"zhangxiaoyu"` |
| `data.totalCpu` | number | ⚠️ | 总CPU使用率 | `25.8` |
| `data.totalMemory` | number | ⚠️ | 总内存占用 | `896000000` |
| `data.processCount` | number | ⚠️ | 进程总数 | `3` |
| `_metadata.uploadStatus` | string | ✅ | 上传状态 | `"pending"` |
| `_metadata.uploadAttempts` | number | ✅ | 上传尝试次数 | `0` |
| `_metadata.lastUploadAttempt` | number\|null | ✅ | 最后上传尝试时间 | `null` |
| `_metadata.createdAt` | number | ✅ | 文件创建时间 | `1703401200000` |

**后端数据库插入需要的字段**:
```typescript
{
  process_id: "process_1703401200000",            // 来自 id
  device_id: "device_918407e353c8721c",           // 来自 data.deviceId
  session_id: "{sessionId}",                      // 来自上传参数
  timestamp: 1703401200000,                       // 来自 timestamp
  processes: JSON.stringify(data.processes),      // 来自 data.processes（JSON字符串）
  total_cpu: 25.8,                                // 来自 data.totalCpu
  total_memory: 896000000,                        // 来自 data.totalMemory
  process_count: 3                                // 来自 data.processCount
}
```

**⚠️ 重要说明**:
- **进程数据上传失败不重试**：客户端上传失败后直接丢弃，不会重新入队
- 后端收到进程数据后应尽快处理，失败也可以接受

---

## 五、ZIP压缩格式

### 5.1 ZIP文件结构

客户端启动/重连时，会将持久化数据压缩成ZIP文件上传：

```
screenshots_{timestamp}.zip
├── screenshot_1703401200000.json    # 包含 buffer(base64) + metadata
├── screenshot_1703401260000.json
└── screenshot_1703401320000.json

activities_{timestamp}.zip
├── activity_1703401200000.json      # 完整的 ActivityQueueItem + _metadata
├── activity_1703401260000.json
└── activity_1703401320000.json

processes_{timestamp}.zip (可选)
├── process_1703401200000.json       # 完整的 ProcessQueueItem + _metadata
└── process_1703401500000.json
```

### 5.2 ZIP内文件格式

#### 截图ZIP内的JSON格式

**文件名**: `screenshot_{timestamp}.json`

```json
{
  "id": "screenshot_1703401200000",
  "timestamp": 1703401200000,
  "type": "screenshot",
  "buffer": "iVBORw0KGgoAAAANSUhEUgAA...AASUVORK5CYII=",
  "fileSize": 25600,
  "format": "jpg",
  "quality": 75,
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  "_metadata": {
    "uploadStatus": "pending",
    "uploadAttempts": 0,
    "lastUploadAttempt": null,
    "createdAt": 1703401200000
  }
}
```

**说明**:
- `buffer` 字段包含完整的 Base64 编码的 JPEG 图片数据
- 后端需要解码 `buffer` 字段并上传到 OSS

#### 活动ZIP内的JSON格式

**文件名**: `activity_{timestamp}.json`

与磁盘持久化格式完全相同（见 **三、活动数据结构**）

#### 进程ZIP内的JSON格式

**文件名**: `process_{timestamp}.json`

与磁盘持久化格式完全相同（见 **四、进程数据结构**）

---

## 六、HTTP上传接口规范

### 6.1 请求格式

**接口地址**: `POST /api/startup-upload`

**请求类型**: `multipart/form-data`

**请求参数**:

| 参数名 | 类型 | 必需 | 说明 | 示例值 |
|--------|------|------|------|--------|
| `deviceId` | string | ✅ | 设备ID | `"device_918407e353c8721c"` |
| `sessionId` | string | ✅ | 会话ID | `"session_abc123"` |
| `uploadId` | string | ✅ | 上传批次ID（UUID） | `"550e8400-e29b-41d4-a716-446655440000"` |
| `screenshotZip` | file | ⚠️ | 截图ZIP文件（可选） | `screenshots_1703401200000.zip` |
| `activityZip` | file | ⚠️ | 活动ZIP文件（可选） | `activities_1703401200000.zip` |
| `processZip` | file | ⚠️ | 进程ZIP文件（可选） | `processes_1703401200000.zip` |

**cURL示例**:
```bash
curl -X POST http://localhost:3000/api/startup-upload \
  -F "deviceId=device_918407e353c8721c" \
  -F "sessionId=session_abc123" \
  -F "uploadId=550e8400-e29b-41d4-a716-446655440000" \
  -F "screenshotZip=@screenshots_1703401200000.zip" \
  -F "activityZip=@activities_1703401200000.zip"
```

### 6.2 响应格式

**成功响应** (HTTP 200):
```json
{
  "success": true,
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Files received and queued for processing"
}
```

**失败响应** (HTTP 400/500):
```json
{
  "success": false,
  "message": "Missing deviceId or sessionId"
}
```

**说明**:
- ✅ 后端接收到ZIP后**立即返回成功**，不等待处理完成
- ✅ 客户端收到200 OK后**立即删除本地ZIP文件**
- ✅ 后端**异步处理**ZIP文件（解压、上传OSS、写入数据库）

---

## 七、数据流转完整示例

### 7.1 截图数据流转

```
1. 客户端采集截图
   ├─ 压缩为JPEG (quality=75)
   ├─ Base64编码
   └─ 生成 ScreenshotQueueItem

2. 入队到BoundedQueue
   ├─ 内存队列未满 → 保存到内存
   └─ 内存队列已满 → 溢出到磁盘
       ├─ 写入 screenshot_xxx.jpg (二进制)
       └─ 写入 screenshot_xxx.meta.json (元数据)

3. 客户端启动/重连
   ├─ 扫描 queue-cache/screenshots/ 目录
   ├─ 读取所有 .jpg 和 .meta.json 文件
   ├─ 组合为完整的 JSON（包含buffer字段）
   ├─ 压缩为 screenshots_xxx.zip
   └─ 删除原始 .jpg 和 .meta.json 文件

4. 上传ZIP
   ├─ POST /api/startup-upload
   ├─ 等待200 OK响应
   └─ 删除 screenshots_xxx.zip

5. 后端处理
   ├─ 保存ZIP到 /tmp/upload-buffer/{deviceId}/
   ├─ 立即返回200 OK
   ├─ 异步解压ZIP
   ├─ 读取每个JSON文件
   ├─ 检查数据库唯一索引（幂等性）
   ├─ 插入数据库（oss_url为空）
   ├─ 解码buffer并上传到OSS
   ├─ 更新数据库oss_url字段
   └─ 删除临时文件和ZIP
```

### 7.2 活动数据流转

```
1. 客户端采集活动
   ├─ 60秒内累加 keystrokes, mouseClicks, mouseScrolls
   ├─ 记录最后的 activeWindow, url
   └─ 生成 ActivityQueueItem

2. 入队到BoundedQueue
   ├─ 内存队列未满 → 保存到内存
   └─ 内存队列已满 → 溢出到磁盘
       └─ 写入 activity_xxx.json

3. 客户端启动/重连
   ├─ 扫描 queue-cache/activities/ 目录
   ├─ 读取所有 .json 文件
   ├─ 压缩为 activities_xxx.zip
   └─ 删除原始 .json 文件

4. 上传ZIP
   ├─ POST /api/startup-upload
   ├─ 等待200 OK响应
   └─ 删除 activities_xxx.zip

5. 后端处理
   ├─ 保存ZIP到 /tmp/upload-buffer/{deviceId}/
   ├─ 立即返回200 OK
   ├─ 异步解压ZIP
   ├─ 读取每个JSON文件
   ├─ 检查数据库唯一索引（幂等性）
   ├─ 插入数据库
   └─ 删除临时文件和ZIP
```

---

## 八、关键约束和验证规则

### 8.1 数据完整性

| 数据类型 | 必需字段验证 | 唯一性验证 |
|---------|-------------|-----------|
| **截图** | id, timestamp, buffer, fileSize | `(created_at, timestamp, device_id, session_id)` |
| **活动** | id, timestamp, data.keystrokes, data.mouseClicks | `(timestamp, session_id)` |
| **进程** | id, timestamp, data.processes | 无唯一约束（可重复） |

### 8.2 数据大小限制

| 数据类型 | 单个文件大小 | 单次上传限制 |
|---------|------------|-------------|
| **截图** | 25KB - 50KB | 500MB（约10,000张） |
| **活动** | 500B - 2KB | 50MB（约25,000条） |
| **进程** | 2KB - 10KB | 50MB（约5,000条） |
| **总计** | - | **500MB** |

### 8.3 时间戳规范

- ✅ 所有时间戳使用**毫秒级Unix时间戳**（`Date.now()`）
- ✅ `timestamp` 字段表示数据产生时间
- ✅ `_metadata.createdAt` 字段表示文件创建时间
- ✅ 截图的 `created_at` 可以等于 `timestamp`（都是客户端生成）

### 8.4 字符编码

- ✅ 所有JSON文件使用 **UTF-8** 编码
- ✅ 图片buffer使用 **Base64** 编码
- ✅ URL字段已脱敏（只保留域名和路径，移除查询参数中的敏感信息）

---

## 九、FAQ

### Q1: 为什么截图使用双文件格式（.jpg + .meta.json）？

**A**: 为了优化磁盘IO性能：
- 图片二进制数据较大（25-50KB），单独存储
- 元数据较小（<1KB），单独存储便于快速读取
- 上传时需要组合成完整的JSON（包含buffer字段）

### Q2: created_at 和 timestamp 有什么区别？

**A**:
- `timestamp`: 数据产生时间（截图时间、活动时间）
- `_metadata.createdAt`: 文件写入磁盘的时间
- 大多数情况下两者相等或非常接近
- 截图表的 `created_at` 可以等于 `timestamp`（都是客户端生成）

### Q3: 活动数据为什么不会有高频冲突？

**A**:
- 活动数据是**60秒聚合**后产生**1条记录**
- `timestamp` 是聚合周期的结束时间（如 10:00:00, 10:01:00）
- 相同 `sessionId` 下，每60秒只会有1条记录
- 唯一索引 `(timestamp, session_id)` 不会冲突

### Q4: 进程数据为什么上传失败不重试？

**A**:
- 进程数据**实时性强**，历史数据价值较低
- 进程列表**变化频繁**，5分钟前的进程快照意义不大
- 避免浪费带宽和存储空间重试低价值数据
- 客户端上传失败后直接丢弃（删除内存和磁盘文件）

### Q5: 后端如何保证数据不丢失？

**A**:
- 后端收到ZIP后保存到 `/tmp/upload-buffer/{deviceId}/`
- 异步处理失败不会立即删除ZIP文件
- OSS上传失败可以重试
- 数据库插入使用 `ON DUPLICATE KEY UPDATE` 实现幂等性
- 所有步骤成功后才删除临时文件

---

## 十、版本历史

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0 | 2024-12-24 | 初始版本，定义截图、活动、进程的完整数据结构 |
