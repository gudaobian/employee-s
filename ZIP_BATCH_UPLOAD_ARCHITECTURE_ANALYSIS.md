# ZIP批量上传架构方案深度分析

## 方案概述

### 用户提出的架构

#### 截图上传流程
```
客户端启动
  ↓
1. 压缩持久化数据 → screenshots.zip
2. 删除原始文件（磁盘队列清空）
3. POST /api/screenshots/upload-batch
   - Body: { deviceId, sessionId, zipFile }
4. 等待响应
   ↓
后端接收
  ↓
5. 保存 zip → /tmp/{deviceId}/screenshots_{timestamp}.zip
6. 立即返回 { success: true }
   ↓
客户端收到成功
  ↓
7. 删除 screenshots.zip
   ↓
后端异步处理
  ↓
8. 解压 zip → /tmp/{deviceId}/extracted/
9. 并发上传到OSS（Promise.allSettled）
10. 写入MySQL（带幂等性检查）
11. 删除临时文件
```

#### 活动数据流程
```
客户端启动
  ↓
1. 压缩活动记录 → activities.zip
2. 删除原始文件
3. POST /api/activities/upload-batch
   ↓
后端接收
  ↓
4. 保存 zip → /tmp/{deviceId}/activities_{timestamp}.zip
5. 立即返回成功
   ↓
客户端删除 zip
   ↓
后端异步处理
  ↓
6. 解压 zip
7. 批量写入MySQL（带幂等性检查）
8. 删除临时文件
```

#### 数据库唯一索引设计
```sql
-- 截图表
CREATE TABLE screenshots (
  ...
  created_at TIMESTAMP,
  timestamp BIGINT,
  device_id VARCHAR(255),
  session_id VARCHAR(255),
  ...
);

CREATE UNIQUE INDEX idx_screenshots_unique
ON screenshots(created_at, timestamp, device_id, session_id);

-- 活动记录表
CREATE TABLE activity_records (
  ...
  timestamp BIGINT,
  session_id VARCHAR(255),
  ...
);

CREATE UNIQUE INDEX idx_activity_unique
ON activity_records(timestamp, session_id);
```

---

## 第一部分：架构优势分析

### 优势1：彻底解决客户端阻塞问题 ✅

**当前问题**：
```
客户端WebSocket上传流程：
1. 取出5个截图
2. 并发发送（实际串行）
3. 等待响应（30秒超时）
4. 处理结果
5. 超时重试 → 队列积压

总耗时：可能 > 60秒/批次
```

**新方案**：
```
客户端ZIP上传流程：
1. 压缩所有数据（1-2秒）
2. HTTP POST上传zip（5-10秒，取决于文件大小）
3. 收到成功响应
4. 删除zip

总耗时：< 15秒（确定性）
```

**对比**：
```
当前方案：
- 客户端等待时间：30秒/批次 × N批次
- 队列积压风险：高
- 阻塞严重：是

新方案：
- 客户端等待时间：15秒（一次性）
- 队列积压风险：无（已全部上传）
- 阻塞严重：否
```

**结论**：客户端阻塞问题**彻底解决** ✅

---

### 优势2：网络传输效率提升 ✅

**压缩比分析**：

```
未压缩（当前）：
- 截图：20-30KB × 200张 = 4-6MB
- 活动：0.5KB × 1000条 = 500KB
- 进程：1KB × 500条 = 500KB
总计：~5-7MB

ZIP压缩后（新方案）：
- 截图（JPEG已压缩）：压缩比 ~1.1-1.2 = 3.5-5MB
- 活动（JSON文本）：压缩比 ~3-5 = 100-150KB
- 进程（JSON文本）：压缩比 ~3-5 = 100-150KB
总计：~3.7-5.3MB

网络传输：
- 当前：5-7MB分批上传（多次请求）
- 新方案：3.7-5.3MB一次上传
- 节省：~30%网络流量
```

**HTTP效率**：
```
当前（WebSocket串行）：
- 请求次数：200次（逐个上传）
- 握手开销：200次TCP往返
- 总耗时：15秒 × 200 = 3000秒（串行）

新方案（HTTP批量）：
- 请求次数：1次
- 握手开销：1次HTTP请求
- 总耗时：上传时间（5-10秒）+ 后端异步处理（不阻塞客户端）
```

**结论**：网络效率提升**10-100倍** ✅

---

### 优势3：后端真正并发处理 ✅

**当前问题**：
```typescript
// WebSocket串行处理
socket.on('client:screenshot', async (data) => {
  await ossService.upload(...);  // 15秒阻塞
  // 下一个请求排队等待
});

实际并发：1个/次（串行）
```

**新方案**：
```typescript
// 异步并发处理
async function processZipAsync(zipPath) {
  const files = await extractZip(zipPath);  // 解压

  // ✅ 真正的并发上传
  await Promise.allSettled(
    files.map(async (file) => {
      await ossService.upload(file);  // 并发执行
    })
  );

  // 批量写入数据库
  await db.screenshots.bulkCreate(files, {
    ignoreDuplicates: true  // 幂等性
  });
}

实际并发：200个/批次（真正并发）
```

**性能对比**：
```
当前方案：
- 200个截图
- 串行上传：15秒 × 200 = 3000秒 = 50分钟

新方案：
- 200个截图
- 并发上传：max(15秒) = 15秒（所有并发完成）
- 性能提升：3000秒 → 15秒 = 200倍！
```

**结论**：后端性能提升**200倍** ✅

---

### 优势4：简化客户端逻辑 ✅

**当前客户端复杂度**：
```typescript
// 需要实现的组件
1. BoundedQueue（有界队列）
2. DiskQueueManager（磁盘持久化）
3. UploadManager（上传管理器）
4. WebSocketService（WebSocket通信）
5. 重试逻辑（指数退避）
6. 超时处理（30秒超时）
7. 队列统计（内存/磁盘监控）

总代码量：~2000行
复杂度：高
维护成本：高
```

**新方案客户端**：
```typescript
// 简化后的逻辑
async function uploadOnStartup() {
  // 1. 压缩数据
  const screenshotsZip = await compressDirectory('./queue-cache/screenshots');
  const activitiesZip = await compressDirectory('./queue-cache/activities');

  // 2. 上传
  await axios.post('/api/screenshots/upload-batch', {
    deviceId,
    sessionId,
    zipFile: screenshotsZip
  });

  await axios.post('/api/activities/upload-batch', {
    deviceId,
    sessionId,
    zipFile: activitiesZip
  });

  // 3. 清理
  await fs.rm('./queue-cache', { recursive: true });
}

总代码量：~200行
复杂度：低
维护成本：低
```

**结论**：客户端复杂度降低**90%** ✅

---

### 优势5：避免实时上传的网络依赖 ✅

**当前问题**：
```
场景：用户网络不稳定

WebSocket断开
  ↓
停止数据采集（fsm进入DISCONNECT状态）
  ↓
数据丢失风险
  ↓
重新连接后需要恢复
```

**新方案**：
```
场景：用户网络不稳定

离线运行
  ↓
持续采集数据到本地磁盘
  ↓
数据安全存储
  ↓
下次启动（网络恢复）
  ↓
一次性批量上传
```

**对比**：
```
当前方案：
- 网络依赖：强（实时上传）
- 离线容忍：低
- 数据丢失风险：高

新方案：
- 网络依赖：弱（启动时上传）
- 离线容忍：高
- 数据丢失风险：低
```

**结论**：离线容忍度**大幅提升** ✅

---

## 第二部分：潜在问题分析

### 问题1：启动时上传延迟 ⚠️

**场景**：用户启动应用

```
当前方案：
T0: 启动应用
T1: WebSocket连接
T2: 开始数据采集
T3: 实时上传数据
用户感知：立即可用

新方案：
T0: 启动应用
T1: 压缩数据（1-2秒）
T2: 上传zip（5-10秒）
T3: 等待响应
T4: 开始数据采集
用户感知：启动延迟 10-15秒
```

**影响**：
- 用户体验：启动变慢
- 阻塞时间：10-15秒（无法采集数据）
- 启动失败风险：如果上传失败，应用无法启动

**缓解方案**：
```typescript
// 异步启动
async function startup() {
  // 1. 先启动应用（不阻塞）
  await startApplication();

  // 2. 后台上传（异步）
  uploadHistoricalData().catch(error => {
    logger.error('历史数据上传失败，将在下次启动重试');
  });
}
```

**结论**：需要**异步处理**避免阻塞启动 ⚠️

---

### 问题2：磁盘空间双倍占用 ⚠️

**压缩过程**：
```
原始数据：
- /queue-cache/screenshots/*.jpg (5MB)
- /queue-cache/activities/*.json (500KB)

压缩时：
- /queue-cache/screenshots/*.jpg (5MB) ← 仍存在
- /tmp/screenshots.zip (4MB) ← 新创建
总占用：9MB

上传后删除：
- /tmp/screenshots.zip (删除)
- /queue-cache/screenshots/*.jpg (删除)
```

**峰值磁盘占用**：
```
当前方案：
- 峰值占用 = 原始数据大小
- 例如：5MB

新方案：
- 峰值占用 = 原始数据 + zip文件
- 例如：5MB + 4MB = 9MB
- 增加：80%
```

**影响**：
- 磁盘空间不足时可能失败
- 移动设备（存储有限）风险更高

**缓解方案**：
```typescript
// 分批压缩上传（减少峰值占用）
async function uploadInBatches() {
  const batches = splitIntoBatches(files, 100);  // 每批100个文件

  for (const batch of batches) {
    const zip = await compress(batch);  // 压缩100个
    await upload(zip);                  // 上传
    await fs.rm(batch);                 // 删除原文件
    await fs.rm(zip);                   // 删除zip
  }
}

峰值占用：500KB（100个文件） + 400KB（zip） = 900KB
降低：90%
```

**结论**：需要**分批处理**避免磁盘占用过高 ⚠️

---

### 问题3：压缩/解压CPU开销 ⚠️

**压缩开销**：
```
客户端压缩：
- 200个截图（5MB）
- 压缩时间：1-2秒（取决于CPU）
- CPU占用：可能100%（单核）

后端解压：
- 解压时间：0.5-1秒
- CPU占用：短暂峰值
```

**影响**：
- 客户端：启动时CPU占用高（可能卡顿）
- 后端：解压时CPU峰值（但异步处理，影响小）

**缓解方案**：
```typescript
// 使用流式压缩（降低内存占用）
const archive = archiver('zip', {
  zlib: { level: 1 }  // 低压缩率，快速压缩
});

// 后台线程压缩（不阻塞主线程）
const worker = new Worker('compress-worker.js');
worker.postMessage({ files });
```

**结论**：CPU开销可接受，但需**优化压缩级别** ⚠️

---

### 问题4：上传失败后的恢复机制 🔴

**关键问题**：用户提出的流程有重大缺陷！

```
用户的流程：
1. 压缩数据 → screenshots.zip
2. 删除原始文件 ← ⚠️ 危险操作！
3. 上传zip
4. 如果上传失败 → ❌ 数据永久丢失！
```

**失败场景**：
```
T0: 压缩完成，删除原文件 ✅
T1: 开始上传zip
T2: 网络故障 ❌
T3: 上传失败

结果：
- 原文件：已删除 ❌
- zip文件：上传失败 ❌
- 数据丢失：永久性 ❌
```

**严重性**：
- 网络不稳定时**数据丢失风险极高**
- 无法恢复
- 违反数据完整性原则

**正确流程**：
```
安全流程：
1. 压缩数据 → screenshots.zip
2. 上传zip
3. 等待服务器确认
4. ✅ 收到成功响应
5. 删除原始文件和zip

失败处理：
- 如果上传失败
  → 保留原文件
  → 删除zip
  → 下次启动重试
```

**结论**：用户提出的流程存在**严重数据丢失风险** 🔴

---

### 问题5：后端异步处理失败 🔴

**场景**：后端收到zip，返回成功，但异步处理失败

```
流程：
T0: 客户端上传zip
T1: 后端保存到 /tmp/{deviceId}/screenshots.zip ✅
T2: 后端返回 { success: true } ✅
T3: 客户端删除原文件和zip ✅

T4: 后端异步解压
T5: 后端上传OSS → 失败 ❌（OSS故障）

结果：
- 客户端：认为成功，已删除数据
- 后端：上传失败，数据丢失
- /tmp/{deviceId}/screenshots.zip：可能被清理
- 数据永久丢失 ❌
```

**严重性**：
- 客户端无法知道后端处理失败
- 数据已删除，无法重试
- 静默失败（silent failure）

**解决方案**：
```
方案A：客户端轮询确认
1. 上传zip
2. 后端返回 { taskId: 'task_123', accepted: true }
3. 客户端轮询 GET /api/upload/status/{taskId}
4. 确认状态为 'completed' 后再删除原文件

方案B：WebSocket通知
1. 上传zip
2. 后端异步处理
3. 处理完成后通过WebSocket通知客户端
4. 客户端收到通知后删除原文件

方案C：定期清理未确认数据
1. 客户端保留原文件7天
2. 定期检查服务器确认状态
3. 确认成功后删除
```

**结论**：必须实现**确认机制**，否则数据丢失风险 🔴

---

### 问题6：后端tmp目录管理 ⚠️

**问题**：
```
每次上传：
- 保存到 /tmp/{deviceId}/screenshots_{timestamp}.zip
- 异步处理
- 处理完成后删除

风险：
- 异步处理失败 → zip文件残留
- 服务器重启 → /tmp目录可能被清空（某些OS）
- 磁盘空间不足 → 多个设备同时上传
```

**示例**：
```
/tmp/
  device_A/
    screenshots_1703401200000.zip (5MB)  ← 处理中
    screenshots_1703401300000.zip (5MB)  ← 处理失败，残留
    screenshots_1703401400000.zip (5MB)  ← 等待处理
  device_B/
    screenshots_1703401250000.zip (5MB)
    screenshots_1703401350000.zip (5MB)
  ...

总占用：100MB+（20个设备 × 5MB）
```

**缓解方案**：
```typescript
// 定期清理任务
async function cleanupTmpDirectory() {
  const files = await fs.readdir('/tmp/uploads');

  for (const file of files) {
    const stat = await fs.stat(file);
    const age = Date.now() - stat.mtime;

    // 删除超过24小时的文件
    if (age > 24 * 60 * 60 * 1000) {
      await fs.rm(file);
      logger.warn(`[Cleanup] 删除过期临时文件: ${file}`);
    }
  }
}

// 每小时运行一次
setInterval(cleanupTmpDirectory, 60 * 60 * 1000);
```

**结论**：需要**定期清理机制** ⚠️

---

## 第三部分：数据库唯一索引分析

### 用户提出的索引设计

#### 截图表索引
```sql
CREATE UNIQUE INDEX idx_screenshots_unique
ON screenshots(created_at, timestamp, device_id, session_id);
```

**分析**：

**问题1：`created_at`不适合作为唯一性判断**
```
created_at = 数据库插入时间（后端生成）

场景：
T0: 客户端采集截图，timestamp = 1703401200000
T1: 第一次上传失败
T2: 第二次上传成功，后端插入数据库
    → created_at = 2025-12-24 10:00:00
T3: 客户端重试（超时），再次上传
    → 后端再次插入
    → created_at = 2025-12-24 10:00:05 ← 不同！
    → 唯一索引不会阻止 ❌

结果：重复数据插入成功
```

**原因**：
- `created_at`是**后端时间**，每次插入都不同
- 无法作为幂等性判断依据

**问题2：`timestamp`精度不足**
```
timestamp = 毫秒时间戳

可能性：
- 同一设备，同一会话
- 两张截图在同一毫秒拍摄
- timestamp相同
- 但实际是两张不同的截图

结果：第二张截图插入失败（唯一约束冲突）
```

**概率**：
- 截图间隔60秒 → 几乎不可能
- 截图间隔1秒 → 仍然很低
- 但理论上存在风险

---

#### 活动记录表索引
```sql
CREATE UNIQUE INDEX idx_activity_unique
ON activity_records(timestamp, session_id);
```

**分析**：

**问题：高概率冲突**
```
场景：用户快速操作

T0: 点击按钮A，timestamp = 1703401200000
T1: 点击按钮B，timestamp = 1703401200000（同一毫秒）

插入：
- activity_1: timestamp=1703401200000, sessionId=session_A
- activity_2: timestamp=1703401200000, sessionId=session_A ← 冲突！

结果：第二个活动插入失败 ❌
```

**严重性**：
- 活动频率高（鼠标点击、键盘输入）
- 同一毫秒多个活动很常见
- 导致大量数据丢失

**证据**：
```
高频操作场景：
- 用户快速打字：10个字符/秒 = 100ms/字符
- 同一毫秒可能有多个按键事件
- 复制粘贴：几十个字符同时产生
- 拖拽操作：mousemove事件可能1ms/次
```

**结论**：`(timestamp, sessionId)` 不适合作为唯一索引 🔴

---

### 正确的唯一索引设计

#### 方案A：使用客户端生成的唯一ID（推荐）

```sql
-- 截图表
CREATE TABLE screenshots (
  id VARCHAR(255) PRIMARY KEY,  -- screenshotId（客户端生成）
  device_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  timestamp BIGINT NOT NULL,
  oss_key VARCHAR(512),
  oss_url VARCHAR(512),
  created_at TIMESTAMP DEFAULT NOW(),
  ...
);

CREATE UNIQUE INDEX idx_screenshots_id ON screenshots(id);
CREATE INDEX idx_screenshots_device_session ON screenshots(device_id, session_id);

-- 活动记录表
CREATE TABLE activity_records (
  id VARCHAR(255) PRIMARY KEY,  -- activityId（客户端生成）
  device_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  timestamp BIGINT NOT NULL,
  type VARCHAR(50) NOT NULL,
  data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  ...
);

CREATE UNIQUE INDEX idx_activity_id ON activity_records(id);
CREATE INDEX idx_activity_device_session ON activity_records(device_id, session_id);
```

**ID生成规则**：
```typescript
// 客户端
const screenshotId = `screenshot_${deviceId}_${timestamp}_${uuid()}`;
const activityId = `activity_${deviceId}_${timestamp}_${sequence}`;

示例：
screenshot_device123_1703401200000_a1b2c3d4
activity_device123_1703401200000_001
activity_device123_1703401200000_002
```

**优势**：
- 客户端生成，唯一性保证
- 包含设备ID、时间戳、序列号
- 支持幂等性检查
- 避免时间戳冲突

---

#### 方案B：复合唯一索引（如果必须用时间戳）

```sql
-- 截图表（使用文件哈希）
CREATE TABLE screenshots (
  device_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  timestamp BIGINT NOT NULL,
  file_hash VARCHAR(64) NOT NULL,  -- SHA256哈希
  ...
);

CREATE UNIQUE INDEX idx_screenshots_unique
ON screenshots(device_id, session_id, timestamp, file_hash);

-- 活动记录表（添加序列号）
CREATE TABLE activity_records (
  device_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  timestamp BIGINT NOT NULL,
  sequence INT NOT NULL,  -- 同一毫秒内的序列号
  ...
);

CREATE UNIQUE INDEX idx_activity_unique
ON activity_records(device_id, session_id, timestamp, sequence);
```

**优势**：
- 文件哈希确保截图唯一性（即使时间戳相同）
- 序列号解决活动时间戳冲突
- 仍然支持幂等性

**缺点**：
- 需要客户端计算哈希（CPU开销）
- 索引更复杂（性能略差）

---

## 第四部分：幂等性实现分析

### 新方案的幂等性挑战

#### 问题：批量插入中的部分失败

```typescript
// 后端异步处理
async function processZip(zipPath) {
  const files = await extractZip(zipPath);  // 200个截图

  // 批量插入
  const results = await db.screenshots.bulkCreate(files, {
    ignoreDuplicates: true  // 忽略重复
  });

  logger.info(`插入成功: ${results.length}/200`);
}
```

**场景**：
```
第一次上传：
- 200个截图
- 前100个插入成功 ✅
- 后100个因网络问题插入失败 ❌
- 异步任务失败，zip文件残留

客户端重启：
- 再次上传相同的200个截图
- 前100个：ignoreDuplicates → 跳过 ✅
- 后100个：插入成功 ✅

但是：
- 如果第一次的后100个**部分成功**（如50个）
- 第二次上传时，这50个会被跳过
- 导致数据不完整
```

**解决方案**：
```typescript
// 事务处理
async function processZip(zipPath) {
  const files = await extractZip(zipPath);

  await db.transaction(async (tx) => {
    for (const file of files) {
      try {
        await tx.screenshots.create(file);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          // 幂等性：已存在，跳过
          continue;
        }
        throw error;  // 其他错误回滚事务
      }
    }
  });
}
```

**结论**：批量插入需要**逐个处理 + 事务保护** ⚠️

---

## 第五部分：与当前方案对比

### 性能对比

| 指标 | 当前方案（WebSocket） | 新方案（ZIP批量） | 提升 |
|------|---------------------|-----------------|------|
| **客户端等待时间** | 30秒/批次 × N批次 | 15秒（一次性） | 10-100倍 |
| **网络传输量** | 5-7MB | 3.7-5.3MB（压缩） | 30%减少 |
| **后端并发能力** | 1个/次（串行） | 200个/批次 | 200倍 |
| **上传总耗时** | 50分钟（200张） | 15秒 | 200倍 |
| **客户端复杂度** | 高（2000行代码） | 低（200行代码） | 90%降低 |

**结论**：新方案性能**远超**当前方案 ✅

---

### 可靠性对比

| 风险项 | 当前方案 | 新方案 | 评估 |
|--------|---------|--------|------|
| **数据丢失** | 低 | 高（如流程不当） | ⚠️ 需改进流程 |
| **重复上传** | 高 | 低（幂等性） | ✅ 新方案更好 |
| **网络依赖** | 强（实时） | 弱（批量） | ✅ 新方案更好 |
| **失败恢复** | 复杂 | 简单（重传zip） | ✅ 新方案更好 |
| **静默失败** | 低 | 高（异步处理） | ⚠️ 需确认机制 |

**结论**：新方案可靠性需要**改进流程细节** ⚠️

---

## 第六部分：风险评估与建议

### 高风险项 🔴

#### 1. 数据丢失风险（流程问题）
**原因**：先删除原文件，后上传
**后果**：上传失败 → 数据永久丢失
**建议**：
```
正确流程：
1. 压缩数据
2. 上传zip
3. 等待服务器确认
4. ✅ 确认成功后再删除原文件
```

#### 2. 异步处理静默失败
**原因**：后端返回成功，但异步处理失败
**后果**：客户端认为成功，数据实际丢失
**建议**：
```
实现确认机制：
- 方案A：客户端轮询任务状态
- 方案B：WebSocket通知处理结果
- 方案C：保留原文件直到确认
```

#### 3. 唯一索引设计错误
**原因**：`(timestamp, sessionId)` 高频冲突
**后果**：大量活动数据丢失
**建议**：
```
使用客户端生成的唯一ID：
- screenshotId = screenshot_{deviceId}_{timestamp}_{uuid}
- activityId = activity_{deviceId}_{timestamp}_{sequence}
```

---

### 中风险项 ⚠️

#### 1. 启动延迟
**影响**：10-15秒启动等待
**建议**：异步上传，不阻塞启动

#### 2. 磁盘空间双倍占用
**影响**：峰值占用增加80%
**建议**：分批压缩上传

#### 3. 后端tmp目录管理
**影响**：磁盘空间浪费
**建议**：定期清理机制

---

### 低风险项 ✅

#### 1. CPU开销
**影响**：压缩时短暂CPU峰值
**建议**：低压缩率、后台线程

#### 2. 批量插入幂等性
**影响**：部分重复数据可能被跳过
**建议**：逐个插入 + 事务保护

---

## 总结与建议

### 方案评估

**优势** ✅：
1. 彻底解决客户端阻塞问题
2. 网络传输效率提升10-100倍
3. 后端并发能力提升200倍
4. 客户端逻辑简化90%
5. 离线容忍度大幅提升

**劣势** ⚠️🔴：
1. 🔴 **数据丢失风险**（如流程不当）
2. 🔴 **异步处理静默失败**
3. 🔴 **唯一索引设计错误**
4. ⚠️ 启动延迟问题
5. ⚠️ 磁盘空间占用增加

---

### 改进建议

#### 必须修改（Critical）

1. **修改上传流程**：
```typescript
// ❌ 错误流程
compress() → delete() → upload()

// ✅ 正确流程
compress() → upload() → confirm() → delete()
```

2. **实现确认机制**：
```typescript
// 客户端轮询
const taskId = await uploadZip();
await pollTaskStatus(taskId);  // 确认成功
await deleteOriginalFiles();

// 或WebSocket通知
socket.on('upload_complete', (taskId) => {
  deleteOriginalFiles(taskId);
});
```

3. **修正唯一索引**：
```sql
-- ❌ 错误
CREATE UNIQUE INDEX ON screenshots(created_at, timestamp, device_id, session_id);

-- ✅ 正确
CREATE UNIQUE INDEX ON screenshots(id);  -- 客户端生成的唯一ID
```

---

#### 建议优化（Recommended）

1. **异步启动**：
```typescript
// 不阻塞启动
startApplication();
uploadHistoricalData().catch(...);
```

2. **分批处理**：
```typescript
// 减少峰值占用
uploadInBatches(files, 100);
```

3. **定期清理**：
```typescript
// 清理tmp目录
setInterval(cleanupTmpDirectory, 60 * 60 * 1000);
```

---

### 最终结论

**方案可行性**：✅ **可行**，但需要重大改进

**推荐决策**：
- ✅ 采用ZIP批量上传架构
- 🔴 **必须**修改上传流程（避免数据丢失）
- 🔴 **必须**实现确认机制（避免静默失败）
- 🔴 **必须**修正唯一索引设计（避免数据丢失）
- ⚠️ 建议分批处理和异步启动（优化体验）

**性能提升**：
- 客户端阻塞：彻底解决
- 上传速度：200倍提升
- 网络效率：30%提升

**风险控制**：
- 修改流程后，数据丢失风险可控
- 实现确认机制后，静默失败风险可控
- 修正索引后，数据完整性有保障

---

**版本**: v2.4.0-analysis
**日期**: 2025-12-24
**状态**: 📊 深度分析完成
**推荐**: ✅ 采用（需改进流程）
