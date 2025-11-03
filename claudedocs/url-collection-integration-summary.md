# 浏览器URL采集集成总结

## 完成时间
2025-11-03

## 实现内容

### 1. URL采集服务 (URLCollectorService)
**文件**: `common/services/url-collector-service.ts`

**功能**:
- 跨平台浏览器URL采集（Safari、Chrome、Firefox、Edge、Brave、Opera）
- 自动检测活动窗口是否为浏览器
- 集成隐私保护（URL脱敏）
- 采集方法：AppleScript、Window Title、UI Automation
- 失败处理和日志记录

**关键方法**:
```typescript
async collectActiveURL(): Promise<URLInfo | null>
```

### 2. URL采集日志系统 (URLCollectLogger)
**文件**: `common/utils/url-collect-logger.ts`

**功能**:
- 专用URL采集日志文件：`url-collect.log`
- 日志位置：`~/Library/Logs/employee-monitor/logs/`（macOS）
- 日志格式：`时间戳 | SUCCESS/FAILURE | 浏览器名 | URL | method:值 | quality:值 | privacy:值`
- 自动刷新：每5秒或缓冲区达到50条
- 日志轮转：10MB自动轮转，保留5个历史文件
- 单例模式：全局共享实例

**日志示例**:
```
2025-11-03T10:23:45.123Z | SUCCESS | Chrome | https://github.com | method:applescript | quality:full_url | privacy:full
2025-11-03T10:23:50.456Z | FAILURE | Firefox | N/A | error:Failed to get URL
```

### 3. 活动采集器集成 (ActivityCollectorService)
**文件**: `common/services/activity-collector-service.ts`

**修改内容**:
1. **导入URL采集服务**:
   ```typescript
   import { URLCollectorService } from './url-collector-service';
   ```

2. **ActivityData接口扩展**:
   ```typescript
   export interface ActivityData {
     // ... 其他字段
     activeUrl?: string; // 活动窗口的URL（如果是浏览器）
   }
   ```

3. **初始化URL采集服务**:
   ```typescript
   constructor(...) {
     // ...
     this.urlCollectorService = new URLCollectorService();
   }

   async start(): Promise<void> {
     // ...
     if (this.urlCollectorService) {
       await this.urlCollectorService.initialize(this.platformAdapter);
     }
   }
   ```

4. **浏览器判断方法**:
   ```typescript
   private isBrowserApplication(appName: string): boolean {
     if (!appName) return false;

     const lowerAppName = appName.toLowerCase();
     const browserNames = [
       'safari', 'chrome', 'google chrome', 'firefox',
       'edge', 'microsoft edge', 'brave', 'brave browser',
       'opera', 'vivaldi', 'arc'
     ];

     return browserNames.some(browser => lowerAppName.includes(browser));
   }
   ```

5. **上传数据时采集URL（仅浏览器）**:
   ```typescript
   private async uploadAccumulatedData(): Promise<void> {
     // 获取窗口信息
     const windowInfo = await this.platformAdapter.getActiveWindow();
     this.accumulatedData.windowTitle = windowInfo?.title;
     this.accumulatedData.processName = windowInfo?.application;

     // 仅当活动窗口是浏览器时才采集URL
     if (windowInfo?.application && this.isBrowserApplication(windowInfo.application)) {
       const urlInfo = await this.urlCollectorService.collectActiveURL();
       if (urlInfo) {
         this.accumulatedData.activeUrl = urlInfo.url;
       }
     }

     // 上传数据（包含activeUrl）
     const inputActivityData = {
       // ... 其他字段
       activeUrl: this.accumulatedData.activeUrl
     };
   }
   ```

### 4. 平台适配器集成 (DarwinAdapter)
**文件**: `platforms/darwin/darwin-adapter.ts`

**新增方法**:
```typescript
async getActiveURL(browserName: string): Promise<string | null>
```

**功能**:
- 检查Accessibility权限
- 调用平台特定URL采集器
- 记录采集成功/失败日志

## 数据流

```
用户操作应用
    ↓
ActivityCollectorService 定期采集活动数据（每activityInterval）
    ↓
获取活动窗口信息（标题、应用名）
    ↓
判断应用是否为浏览器 (isBrowserApplication)
    ↓
    ├─ 否 → 仅记录窗口信息，activeUrl = undefined
    │
    └─ 是 → 调用 URLCollectorService.collectActiveURL()
              ↓
          调用 DarwinAdapter.getActiveURL(browserName)
              ↓
          调用 DarwinURLCollector 获取原始URL
              ↓
          应用隐私保护（sanitizeUrl）
              ↓
          记录到 url-collect.log
              ↓
          返回脱敏后的URL到 ActivityCollectorService
              ↓
包含在活动数据中上传到服务器
    ↓
服务器接收：
- 浏览器: { ..., activeUrl: "https://github.com", ... }
- 非浏览器: { ..., activeUrl: undefined, ... }
```

## 隐私保护

URL采集时自动应用隐私保护：
- **查询参数过滤**：移除敏感参数（token、password等）
- **敏感域名检测**：邮件、银行、医疗等网站完全屏蔽
- **URL脱敏**：`[REDACTED_SENSITIVE]` 或 `[REDACTED_PATTERN]`
- **配置化**：支持白名单、敏感模式配置

## 测试验证

编译状态：✅ 成功通过 TypeScript 编译

## 后续工作建议

1. **Windows平台支持**：为 WindowsAdapter 添加 getActiveURL() 方法
2. **服务器端接收**：确保服务器API支持接收 `activeUrl` 字段
3. **实际测试**：在真实环境中测试URL采集和上传
4. **配置界面**：添加URL采集开关和隐私配置选项
5. **性能优化**：监控URL采集对系统性能的影响

## 相关文件

- `common/services/url-collector-service.ts` - URL采集服务
- `common/utils/url-collect-logger.ts` - URL采集日志系统
- `common/services/activity-collector-service.ts` - 活动采集器（已集成URL采集）
- `platforms/darwin/darwin-adapter.ts` - macOS适配器（已添加URL采集）
- `common/utils/privacy-helper.ts` - URL隐私保护工具
- `common/config/privacy-config.ts` - 隐私配置
