# 代码确认报告

## 问题1: 活动持久化的时机

### 当前实现

**活动数据流转路径**:
```
1. 采集阶段 (activity-collector-service.ts)
   ├─ 监听键盘鼠标事件 → 累加到 accumulatedData (内存)
   ├─ 每60秒触发 uploadAccumulatedData()
   └─ 调用 queueService.enqueueActivity(activityItem)

2. 队列阶段 (bounded-queue.ts)
   ├─ 先入队到内存队列 (BoundedQueue, capacity=20)
   ├─ 如果内存队列满 → 自动溢出到磁盘
   └─ 磁盘路径: queue-cache/activities/*.json

3. 上传阶段 (upload-manager.ts)
   ├─ WebSocket连接恢复时触发 startUpload()
   ├─ 从队列取出数据 (先内存，后磁盘)
   └─ 上传成功 → 删除磁盘文件
```

### 关键代码位置

**activity-collector-service.ts:469-481** - 定时上传触发
```typescript
private startUploadTimer(): void {
  this.uploadInterval = setInterval(async () => {
    if (this.isCollecting && this.hasAccumulatedData()) {
      try {
        await this.uploadAccumulatedData();  // ← 每60秒调用一次
      } catch (error) {
        logger.error('[ACTIVITY_COLLECTOR] Upload interval error:', error);
      }
    }
  }, this.config.activityInterval);  // ← 60000ms
}
```

**activity-collector-service.ts:625-654** - 入队操作
```typescript
// 使用队列系统（支持离线持久化 + 有界队列 + 自动上传）
const activityItem: ActivityQueueItem = {
  id: `activity_${timestampMs}`,
  timestamp: timestampMs,
  type: 'activity',
  data: { ... }
};

await queueService.enqueueActivity(activityItem);  // ← 入队到内存队列
```

**bounded-queue.ts** - 自动溢出机制
```typescript
async enqueue(item: T): Promise<void> {
  if (this.queue.length >= this.capacity) {
    // 内存队列已满，溢出到磁盘
    await this.diskManager.save(item);
  } else {
    this.queue.push(item);
  }
}
```

### 结论

✅ **活动持久化时机**：
1. **正常情况**: 活动数据先入队到**内存队列**（BoundedQueue, capacity=20）
2. **队列满时**: 内存队列满后自动溢出到**磁盘** (`queue-cache/activities/*.json`)
3. **定时频率**: 每 **60秒** 产生一条聚合的活动记录并入队
4. **数据特征**: 60秒内的键盘鼠标点击**累加**，窗口/URL取**最后值**

⚠️ **注意**:
- 持久化不是在采集时立即发生，而是在**内存队列满时**才溢出到磁盘
- 如果内存队列未满，数据仅存在于内存中
- 如果客户端崩溃且内存队列未满，**可能丢失部分活动数据**

---

## 问题2: 进程是否有重试机制

### 当前实现

**upload-manager.ts:208-230** - 上传失败处理
```typescript
if (settledResult.status === 'fulfilled' && settledResult.value.success) {
  // 上传成功：删除磁盘文件
  await queue.deleteFromDisk(item.id);
  this.uploadStats[type].success++;
} else {
  // 上传失败：重新入队 ← 所有类型都重新入队！
  this.uploadStats[type].failed++;

  logger.error(`[UploadManager] ❌ ${type} 上传失败，重新入队`, {
    itemId: item.id,
    error: error
  });

  // ❌ 问题：进程数据也会重新入队
  await queue.enqueue(item);  // ← 重新入队，包括 process 类型
}
```

**upload-manager.ts:91-95** - 三种数据类型并行上传
```typescript
await Promise.all([
  this.uploadLoop('screenshot', this.screenshotQueue),  // ← 有重试
  this.uploadLoop('activity', this.activityQueue),      // ← 有重试
  this.uploadLoop('process', this.processQueue)         // ← 有重试！
]);
```

**upload-manager.ts:247-256** - 指数退避重试
```typescript
// 如果批次全部失败，延长等待时间
if (batchFailureCount > 0 && batchSuccessCount === 0) {
  const backoffDelay = this.retryDelay * Math.min(consecutiveFailures, 5);
  logger.warn(`[UploadManager] ${type} 批次全部失败，等待 ${backoffDelay}ms 后重试`);
  await this.delay(backoffDelay);
}

// 如果连续失败次数过多，停止上传
if (consecutiveFailures >= this.maxRetries * this.concurrency) {
  logger.error(`[UploadManager] ${type} 连续失败次数过多，停止上传`);
  break;
}
```

### 结论

❌ **进程数据有重试机制**：
- **当前行为**: 进程数据上传失败后会**重新入队**并**重试**
- **重试次数**: 最多重试 `maxRetries * concurrency` 次（默认 3 * 5 = 15次）
- **退避策略**: 使用指数退避，延迟时间逐渐增加
- **与截图/活动相同**: 所有三种数据类型使用**相同的重试逻辑**

### 用户要求

> "进程是不是有重试机制？若是有就删除，进程不需要有重试机制"

✅ **需要修改**: 进程数据上传失败时应该**直接丢弃**，而不是重新入队重试。

---

## 需要的代码修改

### 修改位置: upload-manager.ts:208-230

**修改前**:
```typescript
if (settledResult.status === 'fulfilled' && settledResult.value.success) {
  // 上传成功：删除磁盘文件
  await queue.deleteFromDisk(item.id);
  this.uploadStats[type].success++;
} else {
  // ❌ 所有类型都重新入队
  await queue.enqueue(item);
}
```

**修改后**:
```typescript
if (settledResult.status === 'fulfilled' && settledResult.value.success) {
  // 上传成功：删除磁盘文件
  await queue.deleteFromDisk(item.id);
  this.uploadStats[type].success++;
} else {
  // ✅ 只有截图和活动重新入队，进程直接丢弃
  if (type === 'process') {
    // 进程数据上传失败，直接丢弃（不重试）
    logger.warn(`[UploadManager] ⚠️ 进程数据上传失败，已丢弃（不重试）`, {
      itemId: item.id,
      error: error
    });

    // 删除磁盘文件（如果存在）
    try {
      await queue.deleteFromDisk(item.id);
    } catch (deleteError) {
      // 忽略删除错误
    }
  } else {
    // 截图和活动数据：重新入队重试
    await queue.enqueue(item);

    logger.error(`[UploadManager] ❌ ${type} 上传失败，重新入队`, {
      itemId: item.id,
      error: error
    });
  }
}
```

### 理由

**进程数据特点**:
- **实时性强**: 进程列表反映的是某个时刻的系统状态
- **变化频繁**: 进程启动/关闭频繁，历史数据价值较低
- **数据量大**: 每次采集可能有几十个进程
- **不关键**: 丢失部分进程数据对监控影响较小

**截图和活动数据特点**:
- **价值高**: 用户行为的直接证据
- **不可恢复**: 丢失后无法重新采集
- **关键数据**: 监控的核心指标

**结论**: 进程数据上传失败时直接丢弃合理，避免浪费带宽和存储空间重试低价值数据。
