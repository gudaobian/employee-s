# 截图上传幂等性问题分析与解决方案

## 问题描述

**用户发现的问题**:
> "图片上传了，可是超时，实质上截图已经上传到OSS了，客户端发现超时就会重复发送"

**问题本质**: 网络超时导致重复上传
```
时间线:
1. 客户端发送截图 → 服务器
2. 服务器上传到OSS (成功)
3. 服务器返回响应
4. ❌ 客户端超时，未收到响应
5. 客户端认为失败，重新入队
6. 下一次循环，客户端再次上传
7. ❌ 服务器再次上传到OSS (重复!)
```

---

## 当前代码分析

### 1. 截图ID生成

**文件**: `src/common/services/fsm/state-handlers/data-collect-state-handler.ts:1502`

```typescript
const screenshotItem: ScreenshotQueueItem = {
  id: `screenshot_${screenshotResult.timestamp}`,  // ✅ 客户端生成唯一ID
  timestamp: screenshotResult.timestamp,
  buffer: bufferBase64,
  fileSize: dataSize,
  format: 'jpg',
  quality: screenshotConfig.quality || 10,
  resolution: { width: ..., height: ... }
};
```

**优点**: 客户端生成唯一ID `screenshot_${timestamp}`
**问题**: ID只在客户端使用，**从未发送到服务器**！

### 2. 上传数据结构

**文件**: `src/common/services/upload-manager.ts:320-325`

```typescript
private async uploadScreenshot(item: ScreenshotQueueItem): Promise<void> {
  await this.websocketService.sendScreenshotData({
    buffer: item.buffer,        // ✅ 发送图片数据
    timestamp: item.timestamp,  // ✅ 发送时间戳
    fileSize: item.fileSize     // ✅ 发送文件大小
    // ❌ 缺失: item.id (截图唯一标识符)
  });
}
```

**关键发现**:
- ✅ 发送了: `buffer`, `timestamp`, `fileSize`
- ❌ **未发送**: `item.id` (截图唯一标识符)
- **后果**: 服务器无法识别重复上传的截图

### 3. WebSocket发送逻辑

**文件**: `src/common/services/websocket-service.ts:475-564`

```typescript
private async sendSocketIOEvent(event: string, data: any): Promise<void> {
  return new Promise((resolve, reject) => {
    // Socket.IO emit 有超时机制
    this.socket!.timeout(30000).emit(event, data, (error, response) => {
      if (error) {
        reject(new Error(`Timeout: ${error.message}`));  // ❌ 超时会reject
      }
      resolve();
    });
  });
}
```

**问题**:
- Socket.IO超时: 30秒
- 后端OSS超时: 5秒 (已知问题)
- 如果服务器上传OSS成功(6秒)，但30秒内返回响应 → 客户端认为成功
- 如果服务器上传OSS成功(6秒)，但网络问题导致30秒内无响应 → 客户端超时，重新入队

---

## 解决方案

### 方案A: 客户端去重 + 服务器幂等性 (推荐)

#### A1. 客户端发送截图ID (必须)

**修改**: `src/common/services/upload-manager.ts:320-332`

```typescript
private async uploadScreenshot(item: ScreenshotQueueItem): Promise<void> {
  await this.websocketService.sendScreenshotData({
    screenshotId: item.id,      // ✅ 新增: 发送唯一ID
    buffer: item.buffer,
    timestamp: item.timestamp,
    fileSize: item.fileSize
  });

  logger.info(`[UploadManager] 截图上传成功`, {
    itemId: item.id,
    screenshotId: item.id,      // ✅ 日志中记录ID
    fileSize: `${(item.fileSize / 1024 / 1024).toFixed(2)} MB`,
    timestamp: item.timestamp
  });
}
```

**好处**:
- 服务器可以根据 `screenshotId` 判断是否重复
- 日志可追踪每个截图的完整生命周期

#### A2. 服务器端幂等性检查 (后端任务)

**后端代码** (伪代码):

```typescript
// api-server/src/services/screenshot-service.ts
async handleScreenshotUpload(screenshotData) {
  const { screenshotId, buffer, timestamp, fileSize } = screenshotData;

  // ✅ 检查OSS是否已存在该ID的文件
  const ossKey = `screenshots/${deviceId}/${screenshotId}.jpg`;
  const exists = await ossService.objectExists(ossKey);

  if (exists) {
    logger.warn(`[Screenshot] 重复上传检测: ${screenshotId} 已存在于OSS，跳过上传`);
    return {
      success: true,
      message: 'Screenshot already uploaded (idempotent)',
      screenshotId,
      ossUrl: ossService.getUrl(ossKey)
    };
  }

  // ✅ 上传到OSS
  const uploadResult = await ossService.upload(ossKey, buffer);

  return {
    success: true,
    screenshotId,
    ossUrl: uploadResult.url
  };
}
```

**防止重复逻辑**:
1. 使用 `screenshotId` 作为OSS文件名的一部分
2. 上传前先检查文件是否存在 (`ossService.objectExists()`)
3. 如果存在，直接返回成功（幂等性）
4. 如果不存在，执行上传

#### A3. 客户端"上传中"状态跟踪 (可选优化)

**目的**: 防止同一截图在多个批次中并发上传

**实现**: `src/common/services/upload-manager.ts`

```typescript
export class UploadManager extends EventEmitter {
  // 新增: 正在上传的截图ID集合
  private uploadingScreenshots = new Set<string>();

  private async uploadLoop(
    type: 'screenshot' | 'activity' | 'process',
    queue: BoundedQueue<any>
  ): Promise<void> {
    while (this.uploading) {
      const batch: any[] = [];

      // ✅ 批量取出，跳过正在上传的项目
      for (let i = 0; i < this.concurrency; i++) {
        const item = await queue.dequeue();
        if (!item) break;

        // ✅ Screenshot类型: 检查是否正在上传
        if (type === 'screenshot' && this.uploadingScreenshots.has(item.id)) {
          logger.warn(`[UploadManager] Screenshot ${item.id} 正在上传中，跳过`);
          await queue.enqueue(item);  // 重新入队，稍后处理
          continue;
        }

        batch.push(item);
      }

      if (batch.length === 0) break;

      // ✅ 标记为"上传中"
      if (type === 'screenshot') {
        batch.forEach(item => this.uploadingScreenshots.add(item.id));
      }

      // 并行上传
      const results = await Promise.allSettled(
        batch.map(item => this.uploadItem(type, item))
      );

      // ✅ 处理结果并清除"上传中"标记
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const item = batch[i];

        // 清除"上传中"标记
        if (type === 'screenshot') {
          this.uploadingScreenshots.delete(item.id);
        }

        if (result.status === 'fulfilled' && result.value.success) {
          await queue.deleteFromDisk(item.id);
          this.uploadStats[type].success++;
        } else {
          await queue.enqueue(item);  // 失败重新入队
          this.uploadStats[type].failed++;
        }
      }
    }
  }
}
```

**好处**:
- 防止同一截图在不同批次中并发上传
- 即使服务器幂等性失效，客户端也有保护

---

### 方案B: 服务器延长OSS超时 (治本)

**当前问题**: 后端Ali OSS超时设置为 **5秒**，太短！

**解决**: 修改后端OSS配置

```typescript
// api-server/src/services/oss-service.ts
const ossClient = new OSS({
  timeout: 30000,  // ❌ 当前: 5000 (5秒)
                   // ✅ 修改: 30000 (30秒)
  // ... 其他配置
});
```

**影响**:
- 减少假性超时（服务器成功但客户端超时）
- 降低重复上传概率
- **优先级**: ⚠️ **最高** - 这是根本原因

---

## 实施计划

### 第一阶段: 后端修复 (优先级最高)

- [ ] **任务1**: 后端延长Ali OSS超时 (5秒 → 30秒)
- [ ] **任务2**: 后端实现幂等性检查 (A2方案)
  - 接收 `screenshotId` 参数
  - 上传前检查OSS文件是否存在
  - 返回幂等结果

**预期效果**: 减少90%的重复上传问题

### 第二阶段: 客户端增强 (防御性)

- [ ] **任务3**: 客户端发送截图ID (A1方案) ← **当前可实施**
- [ ] **任务4**: 客户端"上传中"状态跟踪 (A3方案，可选)

**预期效果**: 即使后端幂等性失效，客户端也有保护

---

## 测试验证

### 测试场景1: 正常上传
```
1. 客户端生成截图: screenshot_1703401200000
2. 发送到服务器 (包含screenshotId)
3. 服务器检查OSS: 不存在
4. 上传到OSS: 成功
5. 返回响应: {success: true, screenshotId: ...}
6. 客户端删除磁盘文件
```

### 测试场景2: 网络超时重试
```
1. 客户端发送截图: screenshot_1703401200000
2. 服务器上传OSS成功
3. 网络问题，响应未到达客户端 (30秒超时)
4. 客户端重新入队: screenshot_1703401200000
5. 下一次循环，客户端再次发送
6. ✅ 服务器检查OSS: 已存在 screenshot_1703401200000.jpg
7. ✅ 服务器直接返回成功 (幂等性)
8. 客户端删除磁盘文件
```

### 测试场景3: 并发批次保护
```
1. 批次1开始上传: screenshot_A (标记为"上传中")
2. 批次2尝试取出: screenshot_A
3. ✅ 检测到"上传中"，重新入队
4. 批次1完成，清除"上传中"标记
5. 批次3正常取出并上传
```

---

## 监控指标

### 重复上传检测日志

**后端日志** (新增):
```bash
grep "重复上传检测" /var/log/api-server/screenshot.log

# 预期输出 (修复后应该很少):
[Screenshot] 重复上传检测: screenshot_1703401200000 已存在于OSS，跳过上传
```

**客户端日志** (新增):
```bash
grep "正在上传中，跳过" /tmp/app-console.log

# 预期输出 (应该很少):
[UploadManager] Screenshot screenshot_1703401200000 正在上传中，跳过
```

### 成功率统计

```bash
# 后端: 幂等性触发次数
grep "already uploaded (idempotent)" /var/log/api-server/screenshot.log | wc -l

# 客户端: 上传成功率
grep "截图上传成功" /tmp/app-console.log | wc -l
```

---

## 已知限制

1. **时钟偏差**: 如果客户端时钟不同步，timestamp可能重复
   - **解决**: 使用 `timestamp + 随机数` 或UUID

2. **OSS延迟**: `objectExists()` 查询可能有延迟
   - **解决**: 使用Redis缓存最近上传的ID

3. **并发竞态**: 多个客户端同时上传相同截图（理论上不会发生）
   - **解决**: 后端使用分布式锁

---

## 快速实施

### 立即可实施 (客户端)

修改 `src/common/services/upload-manager.ts:320-332`:

```bash
# 编辑文件
vim src/common/services/upload-manager.ts

# 找到 uploadScreenshot 方法，添加 screenshotId
```

### 后端任务 (需要后端开发)

修改 `api-server/src/services/screenshot-service.ts`:

```bash
# 1. 增加 screenshotId 参数接收
# 2. 实现 OSS 幂等性检查
# 3. 延长 OSS 超时时间
```

---

**版本**: v2.3.4
**日期**: 2025-12-24
**优先级**: 🔴 **CRITICAL** - 防止OSS存储浪费和重复数据
**状态**: 📝 分析完成，待实施
