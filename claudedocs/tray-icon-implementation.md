# 系统托盘图标实现文档

## 功能概述

为客户端应用添加系统托盘图标显示功能：
- **macOS**: 顶部菜单栏显示图标（黑白 Template Image）
- **Windows**: 右下角系统托盘显示图标（彩色图标）

## 实现细节

### 1. 托盘图标文件

已创建以下托盘图标文件：

| 文件名 | 平台 | 尺寸 | 类型 | 说明 |
|--------|------|------|------|------|
| `trayTemplate.png` | macOS | 16x16 | 黑白 | 标准分辨率 Template Image |
| `trayTemplate@2x.png` | macOS | 32x32 | 黑白 | Retina 高分辨率 |
| `tray-icon.png` | Windows | 16x16 | 彩色 | 系统托盘图标 |

**图标设计**：简单的人形图标（圆形头部 + 矩形身体）

### 2. 代码修改

**文件**: `electron/main-minimal.js`

**修改内容**:
```javascript
function createDefaultIcon() {
    // macOS: 优先从文件加载 trayTemplate.png
    if (platform === 'darwin') {
        const trayIconPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icons', 'trayTemplate.png')
            : path.join(__dirname, '..', 'assets', 'icons', 'trayTemplate.png');

        if (fs.existsSync(trayIconPath)) {
            const icon = nativeImage.createFromPath(trayIconPath);
            icon.setTemplateImage(true); // macOS Template Image 模式
            return icon;
        }
    }

    // Windows: 优先从文件加载 tray-icon.png
    if (platform === 'win32') {
        const trayIconPath = app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icons', 'tray-icon.png')
            : path.join(__dirname, '..', 'assets', 'icons', 'tray-icon.png');

        if (fs.existsSync(trayIconPath)) {
            const icon = nativeImage.createFromPath(trayIconPath);
            return icon;
        }
    }

    // 备选方案：动态生成 SVG 图标
    // ...
}
```

### 3. 托盘菜单功能

已实现的托盘菜单项：

```
状态: 运行中 (DATA_COLLECT)
────────────────────────────
显示主界面
────────────────────────────
启动服务      [当服务未运行时可点击]
停止服务      [当服务运行时可点击]
────────────────────────────
版本信息
```

**菜单功能**：
- ✅ 显示当前运行状态（运行中/已停止）
- ✅ 显示 FSM 当前状态
- ✅ 启动/停止监控服务
- ✅ 显示主窗口
- ✅ 查看版本信息

### 4. 打包配置

托盘图标文件需要被 unpack 以便运行时加载。

**已配置**: `scripts/build/pack-mac-universal.js`

```javascript
asar: {
  unpack: '**/{native,node_modules/sharp,node_modules/@img}/**'
}
```

**需要确认**: 托盘图标文件是否被正确 unpack。如果没有，需要添加：

```javascript
asar: {
  unpack: '**/{native,node_modules/sharp,node_modules/@img,assets/icons/tray*}/**'
}
```

## 测试步骤

### macOS 测试

1. **开发环境测试**:
```bash
npm run electron:dev
```

2. **验证**:
   - 检查顶部菜单栏（右上角，时钟附近）
   - 应该看到黑白的人形图标
   - 点击图标查看菜单

3. **打包测试**:
```bash
npm run pack:mac
open release/EmployeeSafety-darwin-arm64/EmployeeSafety.app
```

4. **日志检查**:
```bash
# 查看托盘图标加载日志
tail -f /tmp/app-console.log | grep TRAY
```

预期输出：
```
[MACOS_TRAY] 尝试加载托盘图标文件: /path/to/trayTemplate.png
[MACOS_TRAY] ✅ 托盘图标加载成功 (Template Image)
```

### Windows 测试

1. **打包测试**:
```bash
npm run pack:win
```

2. **验证**:
   - 安装并运行应用
   - 检查右下角系统托盘（隐藏图标区域）
   - 应该看到彩色的人形图标
   - 点击图标查看菜单

3. **日志检查**:
```
[WINDOWS_TRAY] 尝试加载托盘图标文件: C:\path\to\tray-icon.png
[WINDOWS_TRAY] ✅ 托盘图标加载成功
```

## 常见问题

### Q1: macOS 菜单栏看不到图标？

**可能原因**:
1. 菜单栏图标被隐藏了（macOS 会自动隐藏不常用的图标）
2. 图标颜色与背景相同（深色模式/浅色模式问题）

**解决方案**:
1. 按住 Command 键拖动其他图标，给托盘图标腾出空间
2. 使用 Template Image 模式（已实现），系统会自动适配主题颜色
3. 检查控制台日志确认托盘创建成功

### Q2: Windows 托盘图标不显示？

**可能原因**:
1. 图标文件未被正确 unpack
2. 图标尺寸不正确

**解决方案**:
1. 检查 `app.asar.unpacked/assets/icons/` 目录是否存在图标文件
2. 使用 16x16 尺寸的 PNG 图标
3. 检查日志确认图标加载成功

### Q3: 如何更换托盘图标？

**步骤**:
1. 准备新图标：
   - macOS: 黑白 PNG，16x16 和 32x32 (@2x)
   - Windows: 彩色 PNG，16x16
2. 替换文件：
   - `assets/icons/trayTemplate.png`
   - `assets/icons/trayTemplate@2x.png`
   - `assets/icons/tray-icon.png`
3. 重新打包应用

## 技术说明

### macOS Template Image

macOS 推荐使用 Template Image 模式，优点：
- ✅ 自动适配深色/浅色主题
- ✅ 系统会自动处理颜色反转
- ✅ 符合 macOS Human Interface Guidelines

**要求**:
- 使用黑色图标，透明背景
- 调用 `icon.setTemplateImage(true)`

### Windows 系统托盘

Windows 系统托盘图标要求：
- 尺寸：16x16 像素
- 格式：PNG 或 ICO
- 样式：彩色图标，可以带背景

**注意**: Windows 10/11 会将托盘图标默认隐藏，需要用户手动设置"始终显示"。

## 备选方案

如果托盘图标文件加载失败，代码会自动降级到动态生成的 SVG 图标：

1. **macOS**: 黑白 SVG Template Image
2. **Windows**: 彩色 SVG 图标
3. **Linux**: 彩色 SVG 图标

这确保了即使图标文件缺失，托盘功能也能正常工作。

## 文件清单

```
assets/icons/
├── icon.icns                 # 应用主图标 (圆角版本)
├── icon-square-backup.icns   # 备份的原始正方形图标
├── trayTemplate.png          # macOS 托盘图标 16x16
├── trayTemplate@2x.png       # macOS 托盘图标 32x32
├── tray-icon.png             # Windows 托盘图标 16x16
└── create-tray-icons.py      # 图标生成脚本
```

## 更新日期

**创建日期**: 2025-12-23
**最后更新**: 2025-12-23
**修改人员**: Claude Code
