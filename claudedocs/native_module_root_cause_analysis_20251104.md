# Native Module Root Cause Analysis

**时间**: 2025-11-04 13:45
**问题**: v1.0.56-v1.0.68所有版本用户收到旧代码（UNKNOWN version, no getActiveURL）
**根本原因**: Windows原生模块使用了历史版本的预编译文件

---

## 问题发现

用户最终确认："我知道原因了，window原生采用了本地的目录，因为历史原因，重新编译原生模块耗时所以就直接使用了历史版本的一个原生模块本地上传了，原来构建原生模块的github的action配置文件是precompile-windows-native.yml"

## 调查结果

### 1. native-event-monitor-win模块状态

#### 目录结构
```
native-event-monitor-win/
├── build/
│   └── Release/
│       └── event_monitor.node  # PE32+ DLL, 编译于 2025-10-13 13:53:55
├── precompiled/
│   ├── build-metadata.json     # 标记为mock, Electron ^25.9.0
│   ├── event_monitor_mock.js   # Mock实现
│   ├── loader.js               # 预编译加载器
│   └── README.md
├── src/                        # C++源代码
├── binding.gyp                 # node-gyp构建配置
├── build.js                    # 构建脚本
├── index.js                    # 智能加载器
└── package.json
```

#### 关键发现

**1. 预编译元数据（build-metadata.json）**
```json
{
  "buildTime": "2025-09-28T02:41:00.782Z",
  "nodeVersion": "v18.20.8",
  "platform": "win32",
  "arch": "x64",
  "electronVersion": "^25.9.0",  // ❌ 错误版本！当前使用Electron 28.2.10
  "isMock": true,
  "mockCreatedBy": "192.168.1.140",
  "mockCreatedOn": "darwin",
  "warnings": [
    "This is a mock precompiled module for testing purposes",
    "Real event monitoring functionality is simulated",
    "Do not use in production environments"
  ]
}
```

**2. 实际编译的.node文件**
- **路径**: `build/Release/event_monitor.node`
- **类型**: PE32+ executable (DLL) (GUI) x86-64, for MS Windows
- **编译时间**: 2025-10-13 13:53:55
- **编译环境**: 可能是在macOS上本地编译的（mockCreatedOn: "darwin"）
- **目标版本**: Electron 25.9.0（根据metadata）

**3. 智能加载逻辑（index.js:16-37）**
```javascript
// 加载优先级：
// 1. 预编译模块（precompiled/loader.js）
// 2. Release构建（build/Release/event_monitor.node）
// 3. Debug构建（build/Debug/event_monitor.node）
// 4. 备用mock接口
```

### 2. ABI兼容性分析

#### 当前项目配置
- **package.json**: Electron 28.2.10
- **实际安装**: Electron v28.2.10
- **Node.js版本**: Electron 28使用Node.js 18.18.2
- **预期ABI**: ~120（推测，Electron 28专用ABI）

#### 预编译模块配置
- **构建时Electron**: ^25.9.0
- **构建时Node.js**: v18.20.8
- **目标ABI**: Electron 25专用ABI
- **构建平台**: Windows (PE32+ DLL)

#### 兼容性判断
```
❌ ABI不兼容
Electron 25 ABI ≠ Electron 28 ABI

虽然两者都基于Node.js 18.x，但Electron为每个主版本定义独立的ABI：
- Electron 25: 使用Node.js 18.15.0 + Electron 25专用ABI
- Electron 28: 使用Node.js 18.18.2 + Electron 28专用ABI

原因：Electron使用Chromium的BoringSSL而非OpenSSL，
每个Electron版本对应不同的Chromium版本，导致ABI不同。
```

### 3. 为什么验证都通过但用户仍收到旧代码？

#### 验证步骤检查的内容
v1.0.65-v1.0.68的workflow验证了：
1. ✅ `dist/platforms/windows/windows-adapter.js` 包含getActiveURL
2. ✅ NSIS安装包中的`app.asar`包含getActiveURL
3. ✅ SHA256 hash匹配（dist/ vs packaged）

#### 验证步骤没有检查的内容
❌ **Native module (event_monitor.node)** 是否与当前Electron版本兼容
❌ **Native module是否为预编译的旧版本**
❌ **Native module是否实际提供了getActiveURL依赖的功能**

#### 问题链路

```
1. TypeScript代码正确 (windows-adapter.ts包含getActiveURL)
   ↓
2. 编译成功 (dist/platforms/windows/windows-adapter.js正确)
   ↓
3. 打包成功 (app.asar包含正确的JS代码)
   ↓
4. 验证通过 (SHA256 hash匹配)
   ↓
5. 用户安装并运行
   ↓
6. WindowsAdapter加载 ✅
   ↓
7. 调用native-event-monitor-win ❌
   ↓
8. 加载优先级：precompiled/loader.js (旧Electron 25版本)
   ↓
9. ABI不兼容或功能缺失
   ↓
10. WindowsAdapter降级到备用模式（VERSION = "UNKNOWN"）
    ↓
11. getActiveURL不可用 ❌
```

### 4. precompile-windows-native.yml缺失

- ✅ 检查了整个项目目录，未找到`precompile-windows-native.yml`
- ✅ 用户提到的workflow配置文件可能已被删除或未提交到仓库
- ✅ 当前workflow (`build-and-release.yml`) 没有包含native module重建步骤

#### 当前workflow中的native module处理

**macOS**:
```json
"build:native:mac": "cd native-event-monitor && npm install && npm run build && npx electron-rebuild --version=$(npx electron --version | cut -d'v' -f2)"
```

**Windows**:
```json
"build:native:win": "cd native-event-monitor-win && npm install && npm run build"
```

**问题**：
- ❌ Windows版本**没有**使用`electron-rebuild`
- ❌ 直接使用`npm run build`可能使用系统node-gyp，不针对Electron ABI
- ❌ 没有指定目标Electron版本

## 解决方案

### 方案1: 在GitHub Actions中重新编译native module（推荐）

在`build-and-release.yml`中添加Windows native module重建步骤：

```yaml
- name: Rebuild Windows Native Module for Electron
  run: |
    Write-Host "🔨 重新编译Windows原生模块（针对Electron 28.2.10）"

    # 获取Electron版本
    $electronVersion = (npx electron --version).TrimStart('v')
    Write-Host "Target Electron version: $electronVersion"

    # 进入native模块目录
    cd native-event-monitor-win

    # 清理旧的构建
    if (Test-Path "build") {
      Remove-Item "build" -Recurse -Force
      Write-Host "✅ 清理旧构建目录"
    }

    # 清理precompiled（避免使用旧版本）
    if (Test-Path "precompiled/loader.js") {
      # 重命名而不删除，保留作为fallback
      Rename-Item "precompiled" "precompiled.old" -Force
      Write-Host "✅ 禁用预编译模块"
    }

    # 安装依赖
    npm install

    # 使用electron-rebuild重新编译
    npx electron-rebuild --version=$electronVersion --force

    # 验证编译结果
    $nodePath = "build/Release/event_monitor.node"
    if (Test-Path $nodePath) {
      Write-Host "✅ Native module compiled successfully"

      # 显示文件信息
      $fileInfo = Get-Item $nodePath
      Write-Host "File size: $($fileInfo.Length) bytes"
      Write-Host "Last modified: $($fileInfo.LastWriteTime)"
    } else {
      Write-Host "❌ CRITICAL: Native module compilation failed!"
      exit 1
    }

    cd ..
```

### 方案2: 修复package.json中的Windows构建命令

更新`package.json`:

```json
{
  "scripts": {
    "build:native:win": "cd native-event-monitor-win && npm install && npx electron-rebuild --version=$(npx electron --version | cut -d'v' -f2) --force"
  }
}
```

### 方案3: 完全移除预编译模块，强制每次构建

修改`native-event-monitor-win/index.js`的加载逻辑：

```javascript
function loadNativeModule() {
  if (nativeModule) {
    return nativeModule;
  }

  // ❌ 禁用预编译加载（在CI环境中）
  if (process.env.CI) {
    console.log('[WIN-NATIVE] CI环境：跳过预编译模块，强制使用构建版本');
  } else {
    // 1. 优先尝试加载预编译模块（仅在非CI环境）
    try {
      const precompiledLoader = path.join(__dirname, 'precompiled', 'loader.js');
      if (fs.existsSync(precompiledLoader)) {
        console.log('[WIN-NATIVE] 🔍 检测到预编译模块，尝试加载...');
        const loader = require(precompiledLoader);
        if (loader.isAvailable()) {
          nativeModule = loader.load();
          console.log('[WIN-NATIVE] ✅ 预编译模块加载成功');
          return nativeModule;
        }
      }
    } catch (error) {
      console.warn('[WIN-NATIVE] ⚠️ 预编译模块加载失败:', error.message);
    }
  }

  // 2. 加载编译后的模块...
}
```

### 方案4: 添加运行时ABI检查

在`native-event-monitor-win/precompiled/loader.js`中添加ABI验证：

```javascript
function isAvailable() {
  // 检查Electron版本兼容性
  const currentElectronVersion = process.versions.electron;
  const targetElectronVersion = metadata.electronVersion.replace('^', '');

  if (!currentElectronVersion) {
    console.warn('[WIN-NATIVE-PRECOMPILED] 非Electron环境');
    return false;
  }

  // 检查主版本号
  const currentMajor = parseInt(currentElectronVersion.split('.')[0]);
  const targetMajor = parseInt(targetElectronVersion.split('.')[0]);

  if (currentMajor !== targetMajor) {
    console.warn(`[WIN-NATIVE-PRECOMPILED] Electron版本不匹配: current=${currentElectronVersion}, target=${targetElectronVersion}`);
    return false;
  }

  return true;
}
```

## 立即行动建议

### v1.0.69发布计划

1. **修改`.github/workflows/build-and-release.yml`**
   - 在"Build TypeScript"步骤之后添加"Rebuild Windows Native Module"步骤
   - 使用`electron-rebuild --version=$(npx electron --version) --force`
   - 验证编译的.node文件存在

2. **修改`package.json`**
   - 更新版本到1.0.69
   - 更新`build:native:win`脚本使用electron-rebuild

3. **添加native module验证步骤**
   ```yaml
   - name: Verify native module compatibility
     run: |
       # 测试加载native module
       node -e "
       const m = require('./native-event-monitor-win');
       if (m.start && m.getCounts) {
         console.log('✅ Native module loaded successfully');
       } else {
         console.error('❌ Native module missing methods');
         process.exit(1);
       }
       "
   ```

4. **清理预编译文件**（可选）
   - 删除或重命名`native-event-monitor-win/precompiled/`目录
   - 或更新build-metadata.json为正确的Electron 28版本

## 预期结果

实施后，v1.0.69应该：

```
✅ TypeScript正确编译（包含getActiveURL）
✅ Native module针对Electron 28.2.10重新编译
✅ ABI兼容性正确（Electron 28专用ABI）
✅ NSIS安装包包含正确的native module
✅ 用户安装后运行正确版本
✅ 日志显示：
   Platform adapter version: 1.0.69-with-getActiveURL
   getActiveURL method exists: true
   Native module loaded successfully
```

## 技术债务记录

| 项目 | 优先级 | 行动 |
|------|--------|------|
| Windows native module未使用electron-rebuild | 🔴 P0 | 立即修复 |
| 预编译模块版本过时（Electron 25） | 🔴 P0 | 更新或移除 |
| 缺少native module ABI验证 | 🟡 P1 | 添加运行时检查 |
| precompile-windows-native.yml配置丢失 | 🟡 P1 | 重新创建workflow |
| macOS和Windows构建命令不一致 | 🟢 P2 | 统一使用electron-rebuild |

---

**文档版本**: v1.0
**下一步行动**: 修改workflow并发布v1.0.69
**预计解决时间**: 30分钟（workflow修改 + 测试构建）
