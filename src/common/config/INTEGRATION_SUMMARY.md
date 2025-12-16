# URL 配置管理器集成总结

## ✅ 已完成的工作

### 1. 创建核心配置管理器

**文件**: `src/common/config/url-config-manager.ts`

**功能**:
- 单一基础 URL 配置
- 自动生成所有 API 端点
- HTTP → WebSocket 自动转换
- URL 验证和格式化
- 配置文件持久化（electron-store）

**API**:
```typescript
class URLConfigManager {
  getBaseUrl(): string;
  setBaseUrl(url: string): void;
  getUpdateServerUrl(): string;
  getDataApiUrl(): string;
  getAuthApiUrl(): string;
  getScreenshotApiUrl(): string;
  getWebSocketUrl(): string;
  getAllUrls(): object;
  validateUrl(url: string): { valid: boolean; error?: string };
  reset(): void;
  getConfigPath(): string;
}
```

### 2. 集成到核心服务

#### src/main/app.ts
**修改**: 使用 URLConfigManager 获取基础服务器地址

```typescript
// 修改前
serverUrl: process.env.SERVER_URL || 'http://localhost:3000'

// 修改后
serverUrl: urlConfig.getBaseUrl()
```

**影响**: 应用启动时自动使用配置的基础 URL

#### src/common/services/websocket-service.ts
**修改**: WebSocket URL 自动生成

```typescript
// 修改前
private buildWebSocketUrl(): string {
  if (config.serverUrl) {
    const baseUrl = config.serverUrl.endsWith('/') ? config.serverUrl.slice(0, -1) : config.serverUrl;
    const socketUrl = `${baseUrl}/client`;
    return socketUrl;
  }
  throw new Error('No WebSocket URL configured');
}

// 修改后
private buildWebSocketUrl(): string {
  // 优先使用配置服务中的 websocketUrl（如果UI设置了）
  const config = this.configService.getConfig();
  if (config.websocketUrl) {
    return config.websocketUrl;
  }

  // 使用 URLConfigManager 自动生成
  return urlConfig.getWebSocketUrl();
}
```

**影响**: WebSocket 连接地址自动从基础 URL 生成，支持 http → ws 自动转换

#### src/common/services/auto-update-service.ts
**修改**: 更新服务器 URL 自动生成

```typescript
// 修改前
constructor(options: AutoUpdateServiceOptions) {
  this.apiClient = new UpdateApiClient(
    options.updateServerUrl,  // 必须传入
    app.getVersion()
  );
}

// 修改后
constructor(options: AutoUpdateServiceOptions) {
  // 优先使用传入的 updateServerUrl，否则使用 URLConfigManager
  const updateServerUrl = options.updateServerUrl || urlConfig.getUpdateServerUrl();

  this.apiClient = new UpdateApiClient(
    updateServerUrl,
    app.getVersion()
  );
}
```

**影响**: 更新检查自动使用 `baseUrl + /api/updates`

#### src/common/services/auth-service.ts
**修改**: 认证 API 地址使用 URLConfigManager

```typescript
// 修改前
const authResult = await this.performDeviceAuth(targetDeviceId, config.serverUrl);
const refreshUrl = this.buildRefreshUrl(config.serverUrl);
const revokeUrl = this.buildRevokeUrl(config.serverUrl);

// 修改后
const authResult = await this.performDeviceAuth(targetDeviceId, urlConfig.getBaseUrl());
const refreshUrl = this.buildRefreshUrl(urlConfig.getBaseUrl());
const revokeUrl = this.buildRevokeUrl(urlConfig.getBaseUrl());
```

**影响**: 所有认证相关 API 自动使用统一的基础 URL

### 3. 创建使用文档

**文件**:
- `src/common/config/url-config-usage.md` - 详细使用指南
- `src/common/config/INTEGRATION_SUMMARY.md` - 本文档（集成总结）

## 📊 架构对比

### 旧架构（已废弃）
```
用户需要配置：
├─ serverUrl: 'http://server.com'
├─ updateServerUrl: 'http://server.com/api/updates'
├─ websocketUrl: 'ws://server.com/socket'
├─ dataApiUrl: 'http://server.com/api/data'
└─ ... 更多 URL

问题：
❌ 换服务器需要修改多个配置
❌ 容易配置不一致导致错误
❌ 企业部署困难（100+ 台电脑）
❌ 用户体验差（UI 需要多个输入框）
```

### 新架构（当前）
```
用户只需配置：
└─ baseUrl: 'http://server.com'

自动生成：
├─ updateServerUrl: baseUrl + /api/updates
├─ dataApiUrl: baseUrl + /api/data
├─ authApiUrl: baseUrl + /api/auth
├─ screenshotApiUrl: baseUrl + /api/screenshot
└─ websocketUrl: ws://server.com/socket (自动转换)

优势：
✅ 换服务器只需修改一个地址
✅ 确保所有接口地址一致
✅ 便于企业批量部署
✅ 用户体验好（UI 只需一个输入框）
✅ 行业标准做法（钉钉、企业微信等）
```

## 🔄 升级路径

### 现有用户迁移

对于已有配置文件的用户，系统会自动兼容：

1. **旧配置文件** (`app-config.json`):
```json
{
  "serverUrl": "http://company-server.com",
  "updateServerUrl": "http://company-server.com/api/updates"
}
```

2. **新配置文件** (`server-config.json`):
```json
{
  "baseUrl": "http://company-server.com"
}
```

**迁移步骤**:
- 首次启动时，读取旧配置中的 `serverUrl`
- 自动写入新配置的 `baseUrl`
- 删除冗余的 URL 配置

### 开发环境切换

```typescript
// 切换到测试服务器
import { setBaseUrl } from '@common/config/url-config-manager';
setBaseUrl('http://test-server.com');

// 切换到生产服务器
setBaseUrl('http://prod-server.com');
```

## 🎯 用户使用流程

### 方式 1: 通过 UI（推荐）

1. 打开应用设置页面
2. 在"服务器地址"输入框输入: `http://company-server.com`
3. 点击"保存"
4. 所有 API 地址自动配置完成

### 方式 2: 通过配置文件

**配置文件位置**:
- Windows: `C:\Users\{用户}\AppData\Roaming\employee-monitor\server-config.json`
- macOS: `~/Library/Application Support/employee-monitor/server-config.json`

**编辑配置**:
```json
{
  "baseUrl": "http://your-server.com"
}
```

**重启应用**即可生效

## 🧪 测试验证

### 验证配置是否生效

```typescript
import { getApiUrls } from '@common/config/url-config-manager';

console.log(getApiUrls());
// 输出:
// {
//   base: 'http://company-server.com',
//   update: 'http://company-server.com/api/updates',
//   data: 'http://company-server.com/api/data',
//   auth: 'http://company-server.com/api/auth',
//   screenshot: 'http://company-server.com/api/screenshot',
//   websocket: 'ws://company-server.com/socket'
// }
```

### 验证服务连接

1. **更新检查**: 检查日志中的更新服务器 URL
2. **WebSocket**: 验证 Socket.IO 连接地址
3. **认证**: 验证设备认证请求的目标地址

## 📝 注意事项

### 1. URL 格式要求

**有效格式**:
```
✅ http://server.com
✅ http://server.com:3000
✅ https://server.com
✅ https://192.168.1.100:3000
```

**无效格式**:
```
❌ ftp://server.com  (不支持 ftp 协议)
❌ server.com         (缺少协议)
❌ http://server.com/ (末尾斜杠会被自动移除)
```

### 2. 配置优先级

```
配置文件（server-config.json）> 默认值
```

- 不再使用环境变量（已移除 `process.env.SERVER_URL` 依赖）
- 不再使用注册表/Plist（企业部署应使用配置文件）

### 3. 更改生效时机

**需要重启的场景**:
- 修改 `baseUrl` 后
- 切换服务器环境后

**无需重启的场景**:
- 查看当前配置
- 验证 URL 格式

### 4. 配置文件位置

**查看配置文件路径**:
```typescript
import { urlConfig } from '@common/config/url-config-manager';
console.log(urlConfig.getConfigPath());
```

## 🚀 未来增强

### 计划中的功能

1. **多环境配置切换**
   - 快速切换测试/生产环境
   - 环境配置预设模板

2. **配置导入/导出**
   - 批量部署时导出配置
   - 新设备导入配置

3. **配置验证增强**
   - 连接测试（Ping 服务器）
   - API 可达性检测
   - 版本兼容性检查

4. **UI 增强**
   - 配置向导（首次启动）
   - 可视化配置编辑器
   - 配置历史记录

## 📚 相关文档

- **使用指南**: `url-config-usage.md`
- **API 参考**: `url-config-manager.ts` 源码注释
- **配置示例**: `.env.example` (已废弃，仅供参考)

## 💡 最佳实践

### 企业部署

1. **统一配置分发**
   ```bash
   # 准备配置文件
   echo '{"baseUrl":"http://company-server.com"}' > server-config.json

   # 批量分发到所有客户端
   # Windows: C:\Users\*\AppData\Roaming\employee-monitor\
   # macOS: ~/Library/Application Support/employee-monitor/
   ```

2. **配置验证**
   ```typescript
   import { urlConfig } from '@common/config/url-config-manager';

   const result = urlConfig.validateUrl('http://company-server.com');
   if (!result.valid) {
     console.error('配置错误:', result.error);
   }
   ```

3. **监控连接状态**
   - 定期检查 WebSocket 连接
   - 验证 API 可达性
   - 记录连接失败日志

### 开发调试

```typescript
// 开发环境
setBaseUrl('http://localhost:3000');

// 查看所有生成的 URL
console.table(getApiUrls());

// 切换到测试服务器
setBaseUrl('http://test-server.com');
```

## ✅ 验收检查

集成完成后，请验证以下功能：

- [ ] UI 可以设置服务器地址
- [ ] 配置保存后重启应用仍然有效
- [ ] WebSocket 连接使用正确的 URL
- [ ] 自动更新检查使用正确的 URL
- [ ] 设备认证使用正确的 URL
- [ ] 数据上报使用正确的 URL
- [ ] 截图上传使用正确的 URL
- [ ] URL 验证正常工作
- [ ] 配置文件路径正确
- [ ] 重置配置功能正常

## 🎉 总结

通过 URLConfigManager 的集成，我们实现了：

1. **用户友好**: 只需设置一个服务器地址
2. **部署简单**: 企业批量部署只需分发一个配置文件
3. **错误减少**: 避免多个 URL 配置不一致
4. **架构优雅**: 符合单一配置源原则
5. **行业标准**: 与钉钉、企业微信等企业软件一致

这是专业企业软件应有的配置管理方式！ 🚀
