#!/bin/bash

# 创建专业的 macOS DMG 安装包
# 包含自定义背景、图标布局等

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"
ASSETS_DIR="$PROJECT_ROOT/assets"

echo "💿 创建专业 macOS DMG 安装包..."
echo "=================================="

# 创建专业 DMG 的函数
create_professional_dmg() {
    local ARCH=$1
    local APP_PATH="$RELEASE_DIR/EmployeeMonitor-darwin-$ARCH/EmployeeMonitor.app"
    local DMG_NAME="EmployeeMonitor-darwin-$ARCH.dmg"
    local DMG_PATH="$RELEASE_DIR/$DMG_NAME"
    local TEMP_DMG="$RELEASE_DIR/temp-$ARCH.dmg"
    local VOLUME_NAME="EmployeeMonitor Installer"

    echo ""
    echo "📦 创建 $ARCH 版本专业 DMG..."

    # 检查应用是否存在
    if [ ! -d "$APP_PATH" ]; then
        echo "❌ 找不到应用: $APP_PATH"
        exit 1
    fi

    # 删除旧文件
    rm -f "$DMG_PATH" "$TEMP_DMG"

    # 创建临时目录
    local TEMP_DIR="$RELEASE_DIR/dmg-staging-$ARCH"
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"

    # 复制应用
    echo "   📋 复制应用文件..."
    cp -R "$APP_PATH" "$TEMP_DIR/"

    # 创建 Applications 快捷方式
    echo "   🔗 创建 Applications 快捷方式..."
    ln -s /Applications "$TEMP_DIR/Applications"

    # 创建简洁的安装说明
    cat > "$TEMP_DIR/.安装说明.txt" << 'EOF'
安装步骤:

1. 将 EmployeeMonitor 拖拽到 Applications 文件夹
2. 首次打开时，右键点击应用选择"打开"
3. 授予辅助功能和屏幕录制权限

详细说明请访问企业内部文档或联系技术支持
EOF

    # 创建 .DS_Store 文件设置图标位置和窗口样式
    cat > "$TEMP_DIR/.create-ds-store.applescript" << 'APPLESCRIPT'
tell application "Finder"
    tell disk "EmployeeMonitor Installer"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {400, 100, 920, 470}
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 100
        set background color of viewOptions to {23593, 23593, 23593}

        -- 设置图标位置
        set position of item "EmployeeMonitor.app" of container window to {140, 180}
        set position of item "Applications" of container window to {380, 180}

        close
        open
        update without registering applications
        delay 2
    end tell
end tell
APPLESCRIPT

    # 计算大小
    local SIZE=$(du -sm "$TEMP_DIR" | awk '{print $1}')
    local DMG_SIZE=$((SIZE + 20))

    # 创建临时 DMG
    echo "   💾 创建磁盘镜像..."
    hdiutil create -volname "$VOLUME_NAME" \
                   -srcfolder "$TEMP_DIR" \
                   -ov \
                   -format UDRW \
                   -size ${DMG_SIZE}m \
                   "$TEMP_DMG" > /dev/null

    # 挂载 DMG 进行自定义
    echo "   🎨 自定义界面..."
    local MOUNT_DIR=$(hdiutil attach "$TEMP_DMG" -readwrite -noverify -noautoopen | grep "Volumes" | awk -F'\t' '{print $3}')

    if [ -z "$MOUNT_DIR" ]; then
        echo "❌ 无法挂载 DMG"
        exit 1
    fi

    # 等待挂载完成
    sleep 2

    # 删除临时 AppleScript 文件
    rm -f "$MOUNT_DIR/.create-ds-store.applescript"

    # 隐藏安装说明（可选）
    # SetFile -a V "$MOUNT_DIR/.安装说明.txt" 2>/dev/null || true

    # 应用 Finder 设置
    if [ -f "$TEMP_DIR/.create-ds-store.applescript" ]; then
        osascript "$TEMP_DIR/.create-ds-store.applescript" 2>/dev/null || true
    fi

    # 同步更改
    sync

    # 卸载
    echo "   📤 完成自定义..."
    hdiutil detach "$MOUNT_DIR" -quiet -force || true
    sleep 1

    # 转换为只读压缩格式
    echo "   🗜️  压缩镜像..."
    hdiutil convert "$TEMP_DMG" \
                    -format UDZO \
                    -imagekey zlib-level=9 \
                    -o "$DMG_PATH" > /dev/null

    # 清理
    rm -f "$TEMP_DMG"
    rm -rf "$TEMP_DIR"

    # 显示结果
    local FINAL_SIZE=$(du -h "$DMG_PATH" | awk '{print $1}')
    echo "   ✅ 完成: $DMG_NAME ($FINAL_SIZE)"
}

# 创建两个版本
create_professional_dmg "arm64"
create_professional_dmg "x64"

echo ""
echo "=================================="
echo "✅ 专业 DMG 创建完成！"
echo "=================================="
echo ""
echo "📦 生成的文件:"
ls -lh "$RELEASE_DIR"/*.dmg 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}'
echo ""
echo "💡 用户体验:"
echo "   1. 双击打开 DMG"
echo "   2. 看到专业安装界面"
echo "   3. 拖拽应用到 Applications"
echo "   4. 右键打开（首次）"
echo ""
