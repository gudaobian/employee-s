# 文件命名规范变更总结

## 📋 变更概述

所有构建产物现已统一采用新的命名格式：**`EmployeeSafety-平台名-CPU架构-版本号.后缀`**

## 🎯 新命名格式示例

### macOS
- DMG: `EmployeeSafety-macos-arm64-1.0.132.dmg`
- DMG: `EmployeeSafety-macos-x64-1.0.132.dmg`
- PKG: `EmployeeSafety-macos-arm64-1.0.132.pkg`
- PKG: `EmployeeSafety-macos-x64-1.0.132.pkg`
- ZIP: `EmployeeSafety-macos-arm64-1.0.132.zip`
- ZIP: `EmployeeSafety-macos-x64-1.0.132.zip`

### Windows
- EXE (64位): `EmployeeSafety-win-x64-1.0.132.exe`
- EXE (32位): `EmployeeSafety-win-ia32-1.0.132.exe`

## 📝 修改的文件列表

### 1. macOS 构建脚本

#### `scripts/build/create-dmg.sh`
**修改内容**：
- ✅ 添加版本号读取：`VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")`
- ✅ 更新命名格式：`EmployeeSafety-macos-$ARCH-$VERSION.dmg`
- ✅ 为两个架构分别生成：arm64 和 x64

#### `scripts/build/create-pkg.sh`
**修改内容**：
- ✅ 添加版本号读取：`VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")`
- ✅ 更新命名格式：`EmployeeSafety-macos-$ARCH-$VERSION.pkg`
- ✅ 修正 PROJECT_ROOT 路径计算：`$(cd "$SCRIPT_DIR/../.." && pwd)`

### 2. Electron Builder 配置

#### `electron-builder.yml`
**修改内容**：
- ✅ macOS 添加 `artifactName`: `"EmployeeSafety-macos-${arch}-${version}.${ext}"`
- ✅ DMG 添加 `artifactName`: `"EmployeeSafety-macos-${arch}-${version}.${ext}"`
- ✅ Windows 添加 `artifactName`: `"EmployeeSafety-win-${arch}-${version}.${ext}"`
- ✅ Windows 目标架构扩展：从 `[x64]` 改为 `[x64, ia32]`
- ✅ NSIS 添加 `artifactName`: `"EmployeeSafety-win-${arch}-${version}.${ext}"`

### 3. GitHub Actions CI 工作流

#### `.github/workflows/build-and-release.yml`
**修改内容**：

**矩阵构建策略**：
```yaml
strategy:
  matrix:
    arch: [x64, ia32]
```

**关键变更**：
- ✅ Job 名称：`Build Windows Application (${{ matrix.arch }})`
- ✅ 原生模块编译架构：使用矩阵变量 `${{ matrix.arch }}`
- ✅ 构建命令：`npx electron-builder --win nsis --${{ matrix.arch }}`
- ✅ Artifact 上传：分别上传 `windows-installer-x64` 和 `windows-installer-ia32`
- ✅ Release 下载：分别下载两个架构的 artifact
- ✅ Release Notes：更新文件名示例

**环境变量设置**：
```powershell
$targetArch = "${{ matrix.arch }}"
$env:npm_config_arch = $targetArch
$env:npm_config_target_arch = $targetArch
```

## 🔧 技术细节

### 架构支持

#### macOS
- **arm64**: Apple Silicon (M1/M2/M3/M4)
- **x64**: Intel 处理器

#### Windows
- **x64**: Intel/AMD 64位 (主流)
- **ia32**: Intel/AMD 32位 (兼容老系统)

### 版本号来源
- **统一来源**: `package.json` 中的 `version` 字段
- **读取方式**: `node -p "require('package.json').version"`
- **构建时**: 从 Git tag 自动提取并更新到 package.json

### CI 矩阵构建优势
1. **并行构建**: x64 和 ia32 同时构建，节省时间
2. **独立验证**: 每个架构独立编译和验证
3. **清晰分离**: Artifact 明确标识架构
4. **易于扩展**: 未来可轻松添加新架构（如 arm64 for Windows）

## 📊 构建产物对比

### 旧格式 (v1.0.131 及之前)
```
macOS:
- EmployeeSafety-darwin-arm64.dmg  ❌ 没有版本号
- EmployeeSafety-darwin-x64.dmg    ❌ 没有版本号

Windows:
- EmployeeSafety-Setup-1.0.131.exe ❌ 没有架构标识，只有 x64
```

### 新格式 (v1.0.132 及之后)
```
macOS:
- EmployeeSafety-macos-arm64-1.0.132.dmg ✅ 平台+架构+版本
- EmployeeSafety-macos-x64-1.0.132.dmg   ✅ 平台+架构+版本
- EmployeeSafety-macos-arm64-1.0.132.pkg ✅ PKG 格式也支持
- EmployeeSafety-macos-x64-1.0.132.pkg   ✅ PKG 格式也支持

Windows:
- EmployeeSafety-win-x64-1.0.132.exe   ✅ 64位版本
- EmployeeSafety-win-ia32-1.0.132.exe  ✅ 32位版本（新增）
```

## 🚀 使用方法

### 本地构建 macOS

```bash
# 1. 打包应用（生成 .app 文件）
npm run pack:mac

# 2. 生成 DMG 安装镜像
npm run pack:mac:dmg
# 输出: release/EmployeeSafety-macos-arm64-1.0.132.dmg
#      release/EmployeeSafety-macos-x64-1.0.132.dmg

# 3. 生成 PKG 安装包（可选）
bash scripts/build/create-pkg.sh
# 输出: release/EmployeeSafety-macos-arm64-1.0.132.pkg
#      release/EmployeeSafety-macos-x64-1.0.132.pkg
```

### GitHub Actions 构建 Windows

```bash
# 推送版本标签触发 CI 构建
git tag v1.0.132
git push origin v1.0.132

# CI 自动构建两个架构：
# - EmployeeSafety-win-x64-1.0.132.exe
# - EmployeeSafety-win-ia32-1.0.132.exe
```

### 手动触发 CI 构建

1. 访问 GitHub Actions 页面
2. 选择 "Build and Release" 工作流
3. 点击 "Run workflow"
4. 输入版本号（如 `v1.0.132`）
5. 点击 "Run workflow" 确认

## 📦 热更新后端适配

### 后端需要的变更

#### 1. 数据库表结构
```sql
-- 已有字段
platform VARCHAR(10)  -- 'darwin' 或 'win32'
arch VARCHAR(10)      -- 'x64', 'arm64', 'ia32'

-- 构建产物需要按 platform + arch 存储
```

#### 2. 热更新 API 响应
客户端发送：
```
GET /api/hot-update/check?currentVersion=1.0.131&platform=darwin&arch=arm64&deviceId=xxx
```

后端返回：
```json
{
  "hasUpdate": true,
  "version": "1.0.132",
  "downloadUrl": "https://cdn.example.com/EmployeeSafety-macos-arm64-1.0.132.dmg",
  "arch": "arm64",
  "platform": "darwin"
}
```

#### 3. 文件存储结构
```
releases/
├── 1.0.132/
│   ├── EmployeeSafety-macos-arm64-1.0.132.dmg
│   ├── EmployeeSafety-macos-x64-1.0.132.dmg
│   ├── EmployeeSafety-win-x64-1.0.132.exe
│   └── EmployeeSafety-win-ia32-1.0.132.exe
├── 1.0.131/
│   └── ...
```

## ✅ 验证清单

### macOS 构建验证
- [ ] 运行 `npm run pack:mac:dmg`
- [ ] 检查 `release/` 目录是否生成：
  - [ ] `EmployeeSafety-macos-arm64-{version}.dmg`
  - [ ] `EmployeeSafety-macos-x64-{version}.dmg`
- [ ] 版本号是否与 package.json 一致
- [ ] 双击 DMG 文件能否正常挂载
- [ ] 拖拽安装是否正常工作

### Windows CI 构建验证
- [ ] 推送版本标签或手动触发工作流
- [ ] CI 构建日志显示两个架构：x64 和 ia32
- [ ] GitHub Release 包含两个 EXE 文件
- [ ] 文件名格式正确：`EmployeeSafety-win-{arch}-{version}.exe`
- [ ] 下载并运行两个版本，验证都能正常安装

### 热更新验证
- [ ] 客户端请求携带 `arch` 参数
- [ ] 后端返回正确架构的更新包
- [ ] 下载的文件名与架构匹配
- [ ] 安装包能正常替换旧版本

## 🎉 改进效果

1. **文件名清晰明确**: 用户一眼就知道平台、架构和版本
2. **支持多架构**: Windows 现在同时支持 64位和32位
3. **后端适配简化**: 通过文件名即可识别平台和架构
4. **版本管理规范**: 所有产物版本号统一来自 package.json
5. **自动化构建**: CI 自动生成所有架构的安装包

## 📚 相关文档

- [CPU架构检测指南](./CPU_ARCHITECTURE_GUIDE.md)
- [架构测试工具](./scripts/test-architecture.js)
- [热更新服务](./src/common/services/hot-update/HotUpdateService.ts)

---

**生成时间**: 2025-12-25
**影响版本**: v1.0.132+
**向后兼容**: ✅ 老版本客户端仍可使用（热更新 API 向后兼容）
