# 安装清理脚本说明

## 概述

此目录包含 Employee Safety Client 的安装清理脚本，用于在安装新版本前自动清理旧版本。

## 文件说明

### 1. installer.nsh
NSIS 安装脚本宏定义，定义了以下清理步骤：

- **customInit**: 安装前执行
  - 停止所有运行中的 Employee Safety 进程
  - 调用 PowerShell 清理脚本（如果存在）
  - 删除旧的日志文件
  - 清理临时文件

- **customInstall**: 安装时执行
  - 额外的清理操作

- **customUnInit**: 卸载前执行
  - 停止所有进程

- **customUnInstall**: 卸载时执行
  - 删除所有用户数据
  - 删除配置文件
  - 删除日志文件

### 2. cleanup.ps1
PowerShell 清理脚本，提供更详细的清理功能：

- 停止运行中的进程
- 卸载旧版本（可选）
- 删除日志文件
- 清理应用程序缓存（保留配置）
- 清理临时文件

## 安装流程

### 标准安装
```
1. 用户双击 EmployeeSafety-Setup-x.x.x.exe
2. NSIS 执行 customInit 宏
   ├─ 停止 EmployeeSafety.exe
   ├─ 停止 electron.exe
   ├─ 运行 cleanup.ps1（如果存在）
   ├─ 删除日志文件
   └─ 清理临时文件
3. 继续正常安装流程
4. 安装完成
```

### 升级安装
```
1. 检测到已安装旧版本
2. 执行清理流程（同上）
3. 覆盖安装新版本
4. 保留用户配置（可选）
```

### 卸载流程
```
1. 用户运行卸载程序
2. NSIS 执行 customUnInit 宏
   └─ 停止所有进程
3. 删除程序文件
4. NSIS 执行 customUnInstall 宏
   ├─ 删除 %APPDATA%\employee-safety-client
   └─ 删除 %LOCALAPPDATA%\employee-safety-client
5. 卸载完成
```

## 清理的文件和目录

### 日志文件
- `%APPDATA%\employee-safety-client\logs\**`
- `%LOCALAPPDATA%\employee-safety-client\logs\**`
- `%USERPROFILE%\.employee-safety\logs\**`

### 缓存文件
- `%APPDATA%\employee-safety-client\Cache\**`
- `%APPDATA%\employee-safety-client\Code Cache\**`
- `%APPDATA%\employee-safety-client\GPUCache\**`

### 临时文件
- `%TEMP%\employee-safety-*`

### 配置文件（仅卸载时删除）
- `%APPDATA%\employee-safety-client\config.json`
- `%APPDATA%\employee-safety-client\**`

## 配置选项

### electron-builder.yml
```yaml
nsis:
  deleteAppDataOnUninstall: true  # 卸载时删除应用数据
  allowElevation: true            # 允许请求管理员权限
  include: build/installer/installer.nsh
```

### 自定义清理行为

编辑 `cleanup.ps1` 修改清理行为：

```powershell
# 保留配置文件
Remove-AppData -IncludeConfig $false

# 删除所有数据（包括配置）
Remove-AppData -IncludeConfig $true

# 启用旧版本卸载
Uninstall-OldVersion  # 取消注释此行
```

## 测试

### 本地测试安装脚本
```bash
# 构建安装包
npm run pack:win

# 安装
cd release
./EmployeeSafety-Setup-1.0.46.exe

# 查看安装日志
# NSIS 会在安装过程中显示详细日志
```

### 测试清理脚本
```powershell
# 直接运行清理脚本
powershell.exe -ExecutionPolicy Bypass -File build/installer/cleanup.ps1

# 查看输出
# 脚本会显示详细的清理步骤和结果
```

## 故障排除

### 进程无法停止
- **原因**: 进程被系统保护或权限不足
- **解决**: 以管理员身份运行安装程序

### 日志删除失败
- **原因**: 文件被占用或权限不足
- **解决**: 关闭所有相关程序后重试

### PowerShell 脚本未执行
- **原因**: PowerShell 执行策略限制
- **解决**: 安装程序使用 `-ExecutionPolicy Bypass` 参数，应该能绕过限制

## 安全考虑

1. **进程终止**: 使用 `taskkill /F` 强制终止，可能导致未保存数据丢失
2. **文件删除**: 删除操作不可逆，请确保重要数据已备份
3. **管理员权限**: 某些操作可能需要管理员权限
4. **旧版本卸载**: 默认禁用自动卸载，避免意外删除

## 更新日志

### v1.0.46 (2025-10-29)
- ✅ 添加安装前进程清理
- ✅ 添加日志文件自动删除
- ✅ 添加 PowerShell 详细清理脚本
- ✅ 添加卸载时数据清理
- ✅ 支持保留用户配置
