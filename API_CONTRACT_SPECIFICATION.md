# ZIP启动上传 - 接口约束规范

## 文档版本

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| 1.0 | 2024-12-24 | System | 前后端接口详细规范 |

---

## 一、接口定义

### 1.1 基本信息

```yaml
接口名称: 启动数据批量上传
接口路径: POST /api/startup-upload
Content-Type: multipart/form-data
认证方式: 无需认证(通过deviceId标识)
超时时间: 120秒
最大请求体: 500MB
```

### 1.2 接口职责

- 接收客户端启动/重连时上传的ZIP压缩包
- 立即返回成功响应(不等待处理完成)
- 异步解压、处理、入库、上传OSS

---

## 二、请求规范

### 2.1 请求头(Headers)

```http
POST /api/startup-upload HTTP/1.1
Host: api.example.com
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Length: [文件总大小]
User-Agent: EmployeeSafetyClient/1.0.0
```

### 2.2 表单字段(Form Fields)

| 字段名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| deviceId | string | ✅ 是 | 设备唯一标识 | `device_918407e353c8721c` |
| sessionId | string | ✅ 是 | 会话唯一标识 | `session_1703401200000` |
| uploadId | string | ❌ 否 | 上传批次ID(UUID) | `550e8400-e29b-41d4-a716-446655440000` |
| screenshotZip | file | ❌ 否 | 截图数据ZIP文件 | `screenshots_1703401234567.zip` |
| activityZip | file | ❌ 否 | 活动数据ZIP文件 | `activities_1703401234567.zip` |
| processZip | file | ❌ 否 | 进程数据ZIP文件 | `processes_1703401234567.zip` |

**字段约束**:
- `deviceId`: 非空字符串, 长度 1-64
- `sessionId`: 非空字符串, 长度 1-64
- `uploadId`: UUID格式(可选, 后端会自动生成)
- ZIP文件: 至少上传一个ZIP文件, 单文件最大500MB

### 2.3 请求示例(cURL)

```bash
curl -X POST http://api.example.com/api/startup-upload \
  -F "deviceId=device_918407e353c8721c" \
  -F "sessionId=session_1703401200000" \
  -F "uploadId=550e8400-e29b-41d4-a716-446655440000" \
  -F "screenshotZip=@screenshots_1703401234567.zip" \
  -F "activityZip=@activities_1703401234567.zip" \
  -F "processZip=@processes_1703401234567.zip"
```

---

## 三、响应规范

### 3.1 成功响应(200 OK)

#### 响应头

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
X-Response-Time: 1234
```

#### 响应体

```json
{
  "success": true,
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "filesReceived": 3,
  "message": "Files received and queued for processing",
  "responseTime": 1234
}
```

**字段说明**:

| 字段名 | 类型 | 说明 |
|--------|------|------|
| success | boolean | 是否成功(true=成功, false=失败) |
| uploadId | string | 上传批次ID |
| filesReceived | number | 接收到的ZIP文件数量 |
| message | string | 响应消息 |
| responseTime | number | 响应耗时(毫秒) |

### 3.2 错误响应

#### 参数缺失(400 Bad Request)

```json
{
  "success": false,
  "error": "MISSING_PARAMS",
  "message": "deviceId and sessionId are required",
  "responseTime": 5
}
```

#### 无文件上传(400 Bad Request)

```json
{
  "success": false,
  "error": "NO_FILES",
  "message": "At least one ZIP file is required",
  "responseTime": 3
}
```

#### 文件过大(413 Payload Too Large)

```json
{
  "success": false,
  "error": "FILE_TOO_LARGE",
  "message": "File size exceeds 500MB limit",
  "responseTime": 2
}
```

#### 磁盘空间不足(507 Insufficient Storage)

```json
{
  "success": false,
  "error": "INSUFFICIENT_STORAGE",
  "message": "Server storage is full",
  "responseTime": 10
}
```

#### 服务器内部错误(500 Internal Server Error)

```json
{
  "success": false,
  "error": "INTERNAL_ERROR",
  "message": "Failed to save uploaded files: ENOSPC",
  "responseTime": 234
}
```

### 3.3 错误码清单

| HTTP状态码 | 错误代码 | 说明 | 处理建议 |
|-----------|---------|------|---------|
| 400 | MISSING_PARAMS | 缺少deviceId或sessionId | 客户端参数校验失败 |
| 400 | NO_FILES | 未上传任何ZIP文件 | 客户端逻辑错误 |
| 413 | FILE_TOO_LARGE | 单文件超过500MB | 客户端分批上传 |
| 507 | INSUFFICIENT_STORAGE | 服务器磁盘空间不足 | 重试或联系管理员 |
| 500 | INTERNAL_ERROR | 服务器内部错误 | 保留ZIP文件,下次重试 |
| 503 | SERVICE_UNAVAILABLE | 服务暂时不可用 | 指数退避重试 |

---

## 四、数据格式规范

### 4.1 截图数据格式(ZIP内JSON)

#### 文件命名规范

```
screenshot_1703401200000.json
screenshot_1703401260000.json
screenshot_1703401320000.json
```

#### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["id", "timestamp", "buffer", "fileSize", "format", "resolution"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^screenshot_[0-9]+$",
      "description": "截图唯一标识"
    },
    "timestamp": {
      "type": "integer",
      "minimum": 1577836800000,
      "description": "截图时间戳(毫秒, >=2020-01-01)"
    },
    "buffer": {
      "type": "string",
      "pattern": "^[A-Za-z0-9+/=]+$",
      "description": "Base64编码的JPEG图片数据"
    },
    "fileSize": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10485760,
      "description": "JPEG文件大小(字节, <=10MB)"
    },
    "format": {
      "type": "string",
      "enum": ["jpg", "jpeg"],
      "description": "图片格式"
    },
    "quality": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "description": "JPEG质量(1-100)"
    },
    "resolution": {
      "type": "object",
      "required": ["width", "height"],
      "properties": {
        "width": {
          "type": "integer",
          "minimum": 1,
          "maximum": 7680,
          "description": "宽度(像素, <=8K)"
        },
        "height": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4320,
          "description": "高度(像素, <=8K)"
        }
      }
    },
    "_metadata": {
      "type": "object",
      "properties": {
        "uploadStatus": {
          "type": "string",
          "enum": ["pending", "uploading", "success", "failed"]
        },
        "createdAt": {
          "type": "integer",
          "description": "客户端生成时间(毫秒)"
        }
      }
    }
  }
}
```

#### 示例数据

```json
{
  "id": "screenshot_1703401200000",
  "timestamp": 1703401200000,
  "buffer": "/9j/4AAQSkZJRgABAQEAYABgAAD/...(省略Base64数据)...=",
  "fileSize": 25600,
  "format": "jpg",
  "quality": 75,
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  "_metadata": {
    "uploadStatus": "pending",
    "createdAt": 1703401200000
  }
}
```

**关键约束**:
1. `buffer`: Base64编码的JPEG数据,解码后必须是有效的JPEG图片
2. `fileSize`: 必须与解码后的buffer大小一致(±10%误差允许)
3. `timestamp`: 必须在合理时间范围内(2020-01-01 至 当前时间+1小时)
4. `resolution`: 宽高必须 >0 且 <=8K分辨率

### 4.2 活动数据格式(ZIP内JSON)

#### 文件命名规范

```
activity_1703401200000.json
activity_1703401260000.json
activity_1703401320000.json
```

#### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["id", "timestamp", "data"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^activity_[0-9]+$"
    },
    "timestamp": {
      "type": "integer",
      "minimum": 1577836800000,
      "description": "60秒聚合周期结束时间(必须是60000的整数倍)"
    },
    "data": {
      "type": "object",
      "required": ["keystrokes", "mouseClicks", "mouseScrolls"],
      "properties": {
        "keystrokes": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000,
          "description": "60秒内键盘点击累加值"
        },
        "mouseClicks": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000,
          "description": "60秒内鼠标点击累加值"
        },
        "mouseScrolls": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000,
          "description": "60秒内鼠标滚动累加值"
        },
        "activeWindow": {
          "type": "string",
          "maxLength": 512,
          "description": "活动窗口标题(周期结束时的值)"
        },
        "activeWindowProcess": {
          "type": "string",
          "maxLength": 256,
          "description": "活动进程名(周期结束时的值)"
        },
        "url": {
          "type": "string",
          "format": "uri",
          "maxLength": 2048,
          "description": "当前URL(周期结束时的值)"
        }
      }
    },
    "_metadata": {
      "type": "object",
      "properties": {
        "uploadStatus": {
          "type": "string",
          "enum": ["pending", "uploading", "success", "failed"]
        },
        "createdAt": {
          "type": "integer"
        },
        "aggregationPeriod": {
          "type": "integer",
          "enum": [60000],
          "description": "聚合周期(毫秒, 固定60秒)"
        }
      }
    }
  }
}
```

#### 示例数据

```json
{
  "id": "activity_1703401200000",
  "timestamp": 1703401200000,
  "data": {
    "keystrokes": 116,
    "mouseClicks": 100,
    "mouseScrolls": 100,
    "activeWindow": "Google Chrome - Example Page",
    "activeWindowProcess": "Chrome",
    "url": "https://example.com/page"
  },
  "_metadata": {
    "uploadStatus": "pending",
    "createdAt": 1703401200000,
    "aggregationPeriod": 60000
  }
}
```

**关键约束**:
1. `timestamp`: 必须是60000的整数倍(即整分钟的时间戳)
2. 数值字段: 不能为负数,不能超过合理上限(100000)
3. `url`: 如果有值,必须是有效的URI格式
4. 所有累加值: 可以为0(表示无活动),但不能为null

**timestamp验证逻辑**:
```typescript
// 正确: timestamp % 60000 === 0
1703401200000 % 60000 === 0  // ✅ 合法
1703401260000 % 60000 === 0  // ✅ 合法

// 错误: timestamp % 60000 !== 0
1703401200123 % 60000 !== 0  // ❌ 非法
1703401200999 % 60000 !== 0  // ❌ 非法
```

### 4.3 进程数据格式(ZIP内JSON)

#### 文件命名规范

```
process_1703401200000.json
process_1703401500000.json
process_1703401800000.json
```

#### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["id", "timestamp", "data"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^process_[0-9]+$"
    },
    "timestamp": {
      "type": "integer",
      "minimum": 1577836800000
    },
    "data": {
      "type": "object",
      "required": ["processes"],
      "properties": {
        "processes": {
          "type": "array",
          "maxItems": 1000,
          "items": {
            "type": "object",
            "required": ["name", "pid"],
            "properties": {
              "name": {
                "type": "string",
                "maxLength": 256
              },
              "pid": {
                "type": "integer",
                "minimum": 0
              },
              "cpu": {
                "type": "number",
                "minimum": 0,
                "maximum": 100
              },
              "memory": {
                "type": "integer",
                "minimum": 0
              }
            }
          }
        },
        "totalCpu": {
          "type": "number",
          "minimum": 0,
          "maximum": 100
        },
        "totalMemory": {
          "type": "integer",
          "minimum": 0
        },
        "processCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10000
        }
      }
    },
    "_metadata": {
      "type": "object",
      "properties": {
        "uploadStatus": {
          "type": "string",
          "enum": ["pending", "uploading", "success", "failed"]
        },
        "createdAt": {
          "type": "integer"
        },
        "collectionInterval": {
          "type": "integer",
          "enum": [60000, 300000, 600000],
          "description": "采集间隔(毫秒: 1分钟, 5分钟, 10分钟)"
        }
      }
    }
  }
}
```

#### 示例数据

```json
{
  "id": "process_1703401200000",
  "timestamp": 1703401200000,
  "data": {
    "processes": [
      {
        "name": "Google Chrome",
        "pid": 12345,
        "cpu": 15.5,
        "memory": 512000000
      },
      {
        "name": "Visual Studio Code",
        "pid": 12346,
        "cpu": 8.2,
        "memory": 256000000
      }
    ],
    "totalCpu": 25.8,
    "totalMemory": 8589934592,
    "processCount": 45
  },
  "_metadata": {
    "uploadStatus": "pending",
    "createdAt": 1703401200000,
    "collectionInterval": 300000
  }
}
```

**关键约束**:
1. `processes`: 数组长度不超过1000(防止数据过大)
2. `cpu`: 百分比值, 0-100
3. `memory`: 字节数, 必须 ≥0
4. `processCount`: 与processes数组长度可以不一致(processCount是总数,processes是采样)

---

## 五、数据库幂等性约束

### 5.1 截图表唯一索引

```sql
-- 唯一索引定义
ALTER TABLE screenshots
ADD UNIQUE INDEX idx_screenshot_unique (
  created_at,   -- 客户端生成时间
  timestamp,    -- 截图时间戳
  device_id,    -- 设备ID
  session_id    -- 会话ID
);
```

**幂等性保证**:
- 相同的`(created_at, timestamp, device_id, session_id)`只能插入一次
- 重复插入会触发`ON DUPLICATE KEY UPDATE`
- 后端通过检查`oss_url`字段判断是否已上传

**插入行为**:
```sql
INSERT INTO screenshots
  (screenshot_id, device_id, session_id, created_at, timestamp, oss_url, file_size)
VALUES (?, ?, ?, ?, ?, '', ?)
ON DUPLICATE KEY UPDATE screenshot_id = screenshot_id;

-- 如果记录已存在,不会报错,也不会修改数据
-- 如果记录不存在,插入新记录(oss_url初始为空)
```

### 5.2 活动表唯一索引

```sql
ALTER TABLE activity_records
ADD UNIQUE INDEX idx_activity_unique (
  timestamp,    -- 60秒聚合周期结束时间
  session_id    -- 会话ID
);
```

**幂等性保证**:
- 同一会话的同一分钟只能有一条活动记录
- `timestamp`必须是60000的整数倍
- 不会有高频冲突(每60秒才产生1条记录)

### 5.3 进程表唯一索引

```sql
ALTER TABLE process_records
ADD UNIQUE INDEX idx_process_unique (
  timestamp,
  session_id
);
```

---

## 六、性能要求

### 6.1 响应时间

| 场景 | 目标 | 说明 |
|------|------|------|
| 参数验证 | <10ms | 立即返回错误 |
| 文件保存 | <500ms | 移动到缓冲目录 |
| 响应返回 | <1秒 | 包含文件保存时间 |
| 异步处理 | 不影响响应 | setImmediate执行 |

### 6.2 并发处理

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 并发请求 | 50 QPS | 同时处理50个上传请求 |
| 单设备限流 | 1次/分钟 | 防止客户端频繁重试 |
| OSS并发 | 10 | PQueue concurrency |

### 6.3 数据量限制

| 项目 | 限制 | 说明 |
|------|------|------|
| 单个ZIP文件 | ≤500MB | Multer配置 |
| 总请求体 | ≤500MB | Express配置 |
| ZIP内文件数 | ≤10000 | 合理上限 |
| 单次上传截图数 | ≤1000 | 建议分批 |

---

## 七、测试用例

### 7.1 正常场景

#### 测试用例1: 上传截图和活动数据

**请求**:
```bash
curl -X POST http://localhost:3000/api/startup-upload \
  -F "deviceId=test_device_001" \
  -F "sessionId=test_session_001" \
  -F "screenshotZip=@test_screenshots.zip" \
  -F "activityZip=@test_activities.zip"
```

**预期响应**(200 OK):
```json
{
  "success": true,
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "filesReceived": 2,
  "message": "Files received and queued for processing",
  "responseTime": 456
}
```

#### 测试用例2: 仅上传截图数据

**请求**:
```bash
curl -X POST http://localhost:3000/api/startup-upload \
  -F "deviceId=test_device_002" \
  -F "sessionId=test_session_002" \
  -F "screenshotZip=@test_screenshots.zip"
```

**预期响应**(200 OK):
```json
{
  "success": true,
  "uploadId": "660e8400-e29b-41d4-a716-446655440001",
  "filesReceived": 1,
  "message": "Files received and queued for processing",
  "responseTime": 234
}
```

### 7.2 异常场景

#### 测试用例3: 缺少deviceId

**请求**:
```bash
curl -X POST http://localhost:3000/api/startup-upload \
  -F "sessionId=test_session_003" \
  -F "screenshotZip=@test_screenshots.zip"
```

**预期响应**(400 Bad Request):
```json
{
  "success": false,
  "error": "MISSING_PARAMS",
  "message": "deviceId and sessionId are required",
  "responseTime": 5
}
```

#### 测试用例4: 未上传任何文件

**请求**:
```bash
curl -X POST http://localhost:3000/api/startup-upload \
  -F "deviceId=test_device_004" \
  -F "sessionId=test_session_004"
```

**预期响应**(400 Bad Request):
```json
{
  "success": false,
  "error": "NO_FILES",
  "message": "At least one ZIP file is required",
  "responseTime": 3
}
```

#### 测试用例5: 文件过大

**请求**:
```bash
curl -X POST http://localhost:3000/api/startup-upload \
  -F "deviceId=test_device_005" \
  -F "sessionId=test_session_005" \
  -F "screenshotZip=@large_file_600MB.zip"
```

**预期响应**(413 Payload Too Large):
```json
{
  "success": false,
  "error": "FILE_TOO_LARGE",
  "message": "File size exceeds 500MB limit",
  "responseTime": 2
}
```

### 7.3 幂等性测试

#### 测试用例6: 重复上传相同数据

**步骤**:
1. 第一次上传
2. 等待处理完成(10秒)
3. 第二次上传相同数据

**预期结果**:
- 第一次: 200 OK, 数据全部插入
- 第二次: 200 OK, 数据全部跳过(skipped)

---

## 八、集成示例

### 8.1 JavaScript/TypeScript客户端

```typescript
import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';

async function uploadStartupData(
  deviceId: string,
  sessionId: string,
  zipFiles: {
    screenshots?: string;
    activities?: string;
    processes?: string;
  }
): Promise<boolean> {
  const formData = new FormData();

  formData.append('deviceId', deviceId);
  formData.append('sessionId', sessionId);

  if (zipFiles.screenshots) {
    formData.append('screenshotZip', fs.createReadStream(zipFiles.screenshots));
  }

  if (zipFiles.activities) {
    formData.append('activityZip', fs.createReadStream(zipFiles.activities));
  }

  if (zipFiles.processes) {
    formData.append('processZip', fs.createReadStream(zipFiles.processes));
  }

  try {
    const response = await axios.post(
      'http://api.example.com/api/startup-upload',
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 120000,
        maxContentLength: 500 * 1024 * 1024,
        maxBodyLength: 500 * 1024 * 1024
      }
    );

    return response.status === 200 && response.data.success;

  } catch (error) {
    console.error('Upload failed:', error);
    return false;
  }
}

// 使用示例
const success = await uploadStartupData(
  'device_918407e353c8721c',
  'session_1703401200000',
  {
    screenshots: './screenshots_1703401234567.zip',
    activities: './activities_1703401234567.zip'
  }
);

console.log('Upload success:', success);
```

### 8.2 Python客户端

```python
import requests

def upload_startup_data(device_id, session_id, zip_files):
    """
    上传启动数据

    Args:
        device_id: 设备ID
        session_id: 会话ID
        zip_files: dict, 包含screenshots/activities/processes的ZIP文件路径

    Returns:
        bool: 是否成功
    """
    url = 'http://api.example.com/api/startup-upload'

    data = {
        'deviceId': device_id,
        'sessionId': session_id
    }

    files = {}

    if 'screenshots' in zip_files:
        files['screenshotZip'] = open(zip_files['screenshots'], 'rb')

    if 'activities' in zip_files:
        files['activityZip'] = open(zip_files['activities'], 'rb')

    if 'processes' in zip_files:
        files['processZip'] = open(zip_files['processes'], 'rb')

    try:
        response = requests.post(
            url,
            data=data,
            files=files,
            timeout=120
        )

        return response.status_code == 200 and response.json().get('success', False)

    except Exception as e:
        print(f'Upload failed: {e}')
        return False

    finally:
        # 关闭文件
        for f in files.values():
            f.close()

# 使用示例
success = upload_startup_data(
    'device_918407e353c8721c',
    'session_1703401200000',
    {
        'screenshots': './screenshots_1703401234567.zip',
        'activities': './activities_1703401234567.zip'
    }
)

print(f'Upload success: {success}')
```

---

## 九、版本兼容性

### 9.1 接口版本控制

```yaml
当前版本: v1
版本策略: URL路径版本控制
未来版本: /api/v2/startup-upload
```

### 9.2 向后兼容性

| 变更类型 | 兼容性 | 说明 |
|---------|--------|------|
| 添加可选字段 | ✅ 兼容 | 不影响旧客户端 |
| 添加新ZIP类型 | ✅ 兼容 | 旧客户端可不上传 |
| 修改必填字段 | ❌ 不兼容 | 需要发布新版本 |
| 修改响应格式 | ❌ 不兼容 | 需要发布新版本 |

### 9.3 弃用策略

```yaml
弃用公告期: 3个月
过渡期: 6个月
完全移除: 12个月后
```

---

## 十、安全要求

### 10.1 输入验证

- ✅ deviceId/sessionId长度和格式验证
- ✅ ZIP文件大小验证
- ✅ ZIP文件有效性验证(防止ZIP炸弹)
- ✅ JSON Schema验证

### 10.2 防护措施

- ✅ 单设备限流: 1次/分钟
- ✅ 全局限流: 50 QPS
- ✅ 文件类型白名单: .zip
- ✅ 路径遍历防护: 文件名过滤

---

## 十一、监控指标

### 11.1 关键指标

| 指标名称 | 说明 | 阈值 |
|---------|------|------|
| upload.success_rate | 上传成功率 | >99% |
| upload.response_time_p95 | 响应时间P95 | <1秒 |
| upload.file_size_avg | 平均文件大小 | 统计 |
| upload.processing_time_avg | 异步处理平均耗时 | <60秒 |
| upload.duplicate_rate | 重复数据率 | <0.1% |

### 11.2 告警规则

```yaml
告警1:
  指标: upload.success_rate < 95%
  级别: P1 (严重)
  通知: 立即通知

告警2:
  指标: upload.response_time_p95 > 5秒
  级别: P2 (重要)
  通知: 5分钟后通知

告警3:
  指标: upload.error_rate > 1%
  级别: P3 (一般)
  通知: 15分钟后通知
```

---

## 十二、FAQ

**Q: 客户端如何知道上传是否真正处理成功?**
A: 后端返回200即表示文件已接收并保存到缓冲区。异步处理失败会保留文件,下次可重试。数据库唯一索引保证幂等性。

**Q: 如果ZIP文件损坏怎么办?**
A: 后端解压失败会记录错误日志,保留ZIP文件。可以通过监控系统发现并人工介入。

**Q: timestamp字段为什么必须是60000的整数倍?**
A: 活动数据是60秒聚合产生的,timestamp代表聚合周期结束时间,必须是整分钟。这是数据库唯一索引的前提。

**Q: 可以并发上传多个批次吗?**
A: 不建议。客户端应该等待上一次上传完成再开始下一次。后端有单设备限流(1次/分钟)。

---

**文档维护**: 接口变更时必须同步更新此文档。
