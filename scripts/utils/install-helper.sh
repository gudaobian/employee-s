#!/bin/bash

# Employee Monitor 安装助手
# 自动检测并删除旧版本，避免多版本共存问题

set -e

APP_NAME="EmployeeMonitor.app"
TARGET_PATH="/Applications/$APP_NAME"
CURRENT_APP="$1"  # 从DMG中拖入的新版本路径

echo "🔍 检查是否存在旧版本..."

# 检查 /Applications 中是否已存在应用
if [ -d "$TARGET_PATH" ]; then
    echo "⚠️  发现已安装的版本"

    # 获取旧版本号
    OLD_VERSION=$(defaults read "$TARGET_PATH/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "未知")

    # 获取新版本号
    NEW_VERSION=$(defaults read "$CURRENT_APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "未知")

    echo "   旧版本: $OLD_VERSION"
    echo "   新版本: $NEW_VERSION"

    # 检查应用是否正在运行
    if pgrep -f "$APP_NAME" > /dev/null; then
        echo "🛑 应用正在运行，正在关闭..."
        osascript -e "tell application \"EmployeeMonitor\" to quit" 2>/dev/null || true
        sleep 2

        # 强制终止
        pkill -f "$APP_NAME" 2>/dev/null || true
        sleep 1
    fi

    echo "🗑️  删除旧版本..."
    rm -rf "$TARGET_PATH"
    echo "   ✅ 旧版本已删除"
fi

# 复制新版本
echo "📦 安装新版本..."
cp -R "$CURRENT_APP" "/Applications/"

echo ""
echo "✅ 安装完成！"
echo ""
echo "💡 提示："
echo "   - 应用已安装到 /Applications/EmployeeMonitor.app"
echo "   - 首次打开请右键选择'打开'"
echo ""
