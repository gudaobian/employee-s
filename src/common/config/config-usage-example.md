# 配置管理使用指南

## 📋 三种配置方式

### 方式1: 环境变量（企业部署，最高优先级）

#### Windows (PowerShell)
```powershell
# 设置环境变量
$env:UPDATE_SERVER_URL="http://company-server.com/api/updates"
$env:SERVER_URL="http://company-server.com"

# 启动应用
.\EmployeeSafety.exe
```

#### macOS/Linux
```bash
# 设置环境变量
export UPDATE_SERVER_URL="http://company-server.com/api/updates"
export SERVER_URL="http://company-server.com"

# 启动应用
./EmployeeSafety.app
```

---

### 方式2: 配置文件（用户/管理员修改，中等优先级）

#### 配置文件位置
- **Windows**: `C:\Users\{用户}\AppData\Roaming\employee-monitor\app-config.json`
- **macOS**: `~/Library/Application Support/employee-monitor/app-config.json`
- **Linux**: `~/.config/employee-monitor/app-config.json`

#### 手动编辑配置文件
```json
{
  "serverUrl": "http://custom-server.com",
  "updateServerUrl": "http://custom-server.com/api/updates",
  "updateEnabled": true,
  "updateCheckInterval": 120000,
  "updateChannel": "stable",
  "updateAutoDownload": true,
  "updateAutoInstall": true,
  "logLevel": "WARN"
}
```

#### 通过代码修改（在应用内）
```typescript
import { appConfig } from '@common/config/app-config-manager';

// 单个修改
appConfig.set('updateServerUrl', 'http://new-server.com/api/updates');

// 批量修改
appConfig.setMultiple({
  serverUrl: 'http://new-server.com',
  updateServerUrl: 'http://new-server.com/api/updates',
  updateChannel: 'beta'
});
```

---

### 方式3: 默认值（最低优先级）

如果既没有环境变量，也没有配置文件，使用代码中的默认值：
```typescript
serverUrl: 'http://localhost:3000'
updateServerUrl: 'http://23.95.193.155:3000/api/updates'
```

---

## 🔧 代码中使用配置

### 基础用法
```typescript
import { getConfig, setConfig } from '@common/config/app-config-manager';

// 读取配置
const serverUrl = getConfig('serverUrl');
const updateUrl = getConfig('updateServerUrl');

// 修改配置
setConfig('updateChannel', 'beta');
```

### 获取所有配置
```typescript
import { getAllConfig } from '@common/config/app-config-manager';

const config = getAllConfig();
console.log(config);
// {
//   serverUrl: 'http://localhost:3000',
//   updateServerUrl: 'http://23.95.193.155:3000/api/updates',
//   ...
// }
```

### 验证配置
```typescript
import { appConfig } from '@common/config/app-config-manager';

const result = appConfig.validate();
if (!result.valid) {
  console.error('配置无效:', result.errors);
}
```

### 备份和还原配置
```typescript
import { appConfig } from '@common/config/app-config-manager';

// 导出配置（备份）
const backup = appConfig.exportConfig();
fs.writeFileSync('config-backup.json', JSON.stringify(backup, null, 2));

// 导入配置（还原）
const backup = JSON.parse(fs.readFileSync('config-backup.json', 'utf-8'));
appConfig.importConfig(backup);
```

### 重置为默认值
```typescript
import { appConfig } from '@common/config/app-config-manager';

appConfig.reset(); // 删除所有自定义配置，恢复默认值
```

---

## 🎯 优先级示例

假设有以下配置：

1. **环境变量**: `UPDATE_SERVER_URL=http://env-server.com`
2. **配置文件**: `{ "updateServerUrl": "http://file-server.com" }`
3. **默认值**: `http://23.95.193.155:3000/api/updates`

**实际使用的值**: `http://env-server.com` （环境变量优先级最高）

---

## 🏢 企业部署场景

### 场景1: 统一服务器地址
所有客户端连接到公司内部服务器：

**通过组策略设置环境变量**:
```
UPDATE_SERVER_URL=http://internal-server.company.com/api/updates
SERVER_URL=http://internal-server.company.com
```

### 场景2: 不同环境使用不同配置

**开发环境**:
```bash
export UPDATE_SERVER_URL=http://dev-server.com/api/updates
export UPDATE_CHANNEL=dev
```

**测试环境**:
```bash
export UPDATE_SERVER_URL=http://test-server.com/api/updates
export UPDATE_CHANNEL=beta
```

**生产环境**:
```bash
export UPDATE_SERVER_URL=http://prod-server.com/api/updates
export UPDATE_CHANNEL=stable
```

---

## 📝 配置文件示例

完整的 `app-config.json` 示例：

```json
{
  "serverUrl": "http://23.95.193.155:3000",
  "updateServerUrl": "http://23.95.193.155:3000/api/updates",
  "updateEnabled": true,
  "updateCheckInterval": 120000,
  "updateChannel": "stable",
  "updateAutoDownload": true,
  "updateAutoInstall": true,
  "logLevel": "WARN"
}
```

---

## ❓ 常见问题

### Q: 如何查看当前配置文件路径？
```typescript
import { appConfig } from '@common/config/app-config-manager';
console.log(appConfig.getConfigFilePath());
```

### Q: 环境变了怎么办？
1. **临时切换**: 设置环境变量后启动应用
2. **永久切换**: 修改配置文件
3. **批量切换**: 通过脚本批量修改环境变量或配置文件

### Q: 如何在 GUI 中提供设置界面？
```typescript
// 在设置页面中
function onSaveSettings(formData) {
  appConfig.setMultiple({
    serverUrl: formData.serverUrl,
    updateServerUrl: formData.updateServerUrl,
    updateChannel: formData.channel
  });

  // 验证配置
  const result = appConfig.validate();
  if (!result.valid) {
    alert('配置无效: ' + result.errors.join(', '));
    return;
  }

  alert('设置已保存！');
}
```

### Q: 配置文件可以手动编辑吗？
可以！直接用文本编辑器打开 `app-config.json` 编辑即可，重启应用后生效。
