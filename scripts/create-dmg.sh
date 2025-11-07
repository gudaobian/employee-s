#!/bin/bash

# EmployeeMonitor DMG 创建脚本
# 使用 macOS 原生 hdiutil 工具创建专业的安装镜像

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"

echo "💿 创建 macOS DMG 安装镜像..."
echo "=================================="

# 确保应用已构建
if [ ! -d "$RELEASE_DIR/EmployeeMonitor-darwin-arm64/EmployeeMonitor.app" ]; then
    echo "❌ 错误: 找不到 arm64 版本，请先运行 npm run pack:mac"
    exit 1
fi

if [ ! -d "$RELEASE_DIR/EmployeeMonitor-darwin-x64/EmployeeMonitor.app" ]; then
    echo "❌ 错误: 找不到 x64 版本，请先运行 npm run pack:mac"
    exit 1
fi

# 创建 DMG 的函数
create_dmg() {
    local ARCH=$1
    local APP_PATH="$RELEASE_DIR/EmployeeMonitor-darwin-$ARCH/EmployeeMonitor.app"
    local DMG_NAME="EmployeeMonitor-darwin-$ARCH.dmg"
    local DMG_PATH="$RELEASE_DIR/$DMG_NAME"
    local TEMP_DMG="$RELEASE_DIR/temp-$ARCH.dmg"
    local VOLUME_NAME="EmployeeMonitor"

    echo ""
    echo "📦 创建 $ARCH 版本 DMG..."

    # 删除旧的 DMG
    rm -f "$DMG_PATH" "$TEMP_DMG"

    # 创建临时目录
    local TEMP_DIR="$RELEASE_DIR/dmg-temp-$ARCH"
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"

    # 只复制应用和Applications快捷方式（简洁专业）
    cp -R "$APP_PATH" "$TEMP_DIR/"
    ln -s /Applications "$TEMP_DIR/Applications"

    # 创建安装说明文件
    cat > "$TEMP_DIR/安装说明.txt" << 'INSTALL_README'
EmployeeMonitor 安装说明
========================

⚠️  重要提示：
   如果您已经安装过旧版本，请先完成以下步骤：

1. 卸载旧版本：
   - 打开 Finder，进入「应用程序」文件夹
   - 找到 EmployeeMonitor.app
   - 拖到废纸篓并清空

2. 安装新版本：
   - 将本 DMG 中的 EmployeeMonitor.app 拖到「Applications」文件夹
   - 首次打开时右键选择「打开」

💡 为什么需要先删除旧版本？
   macOS 不允许直接覆盖应用，如果不删除旧版本，
   会导致两个版本同时存在，引起冲突。

📦 推荐使用 PKG 安装包：
   PKG 格式会自动覆盖旧版本，无需手动删除。
   如需 PKG 版本，请联系技术支持。

INSTALL_README

    # 计算需要的大小
    local SIZE=$(du -sm "$TEMP_DIR" | awk '{print $1}')
    local DMG_SIZE=$((SIZE + 50))  # 额外 50MB 空间

    # 创建 DMG
    hdiutil create -volname "$VOLUME_NAME" \
                   -srcfolder "$TEMP_DIR" \
                   -ov \
                   -format UDRW \
                   -size ${DMG_SIZE}m \
                   "$TEMP_DMG"

    # 挂载 DMG
    local MOUNT_DIR=$(hdiutil attach "$TEMP_DMG" | grep "Volumes" | awk '{print $3}')

    if [ -z "$MOUNT_DIR" ]; then
        echo "❌ 无法挂载 DMG"
        exit 1
    fi

    # 设置 Finder 显示选项（可选）
    # 等待挂载完成
    sleep 2

    # 卸载 DMG
    hdiutil detach "$MOUNT_DIR" -quiet

    # 转换为只读压缩格式
    hdiutil convert "$TEMP_DMG" \
                    -format UDZO \
                    -o "$DMG_PATH"

    # 清理临时文件
    rm -f "$TEMP_DMG"
    rm -rf "$TEMP_DIR"

    echo "   ✅ $DMG_NAME 创建成功"

    # 显示大小
    local FINAL_SIZE=$(du -h "$DMG_PATH" | awk '{print $1}')
    echo "   📊 文件大小: $FINAL_SIZE"
}

# 创建两个架构的 DMG
create_dmg "arm64"
create_dmg "x64"

echo ""
echo "=================================="
echo "✅ DMG 创建完成！"
echo "=================================="
echo ""
echo "📦 生成的文件:"
ls -lh "$RELEASE_DIR"/*.dmg | awk '{print "   " $9 " (" $5 ")"}'
echo ""
echo "💡 分发说明:"
echo "   - 用户下载对应架构的 .dmg 文件"
echo "   - 双击打开 DMG"
echo "   - 拖拽 EmployeeMonitor.app 到 Applications"
echo "   - 首次打开时右键选择'打开'"
echo ""
