#!/bin/bash

# EmployeeMonitor macOS 安装脚本生成器
# 为每个打包版本创建一键安装脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"

echo "📦 创建 macOS 安装脚本..."

# 为 arm64 版本创建安装脚本
cat > "$RELEASE_DIR/安装-AppleSilicon.command" << 'EOF'
#!/bin/bash

# EmployeeMonitor 一键安装脚本 (Apple Silicon)

APP_NAME="EmployeeMonitor.app"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)/EmployeeMonitor-darwin-arm64"
DEST_DIR="/Applications"

echo "======================================"
echo "  EmployeeMonitor 安装向导"
echo "  适用于: Apple Silicon (M1/M2/M3)"
echo "======================================"
echo ""

# 检查应用是否存在
if [ ! -d "$SOURCE_DIR/$APP_NAME" ]; then
    echo "❌ 错误: 找不到 $APP_NAME"
    echo "请确保此脚本在解压后的文件夹中运行"
    exit 1
fi

echo "📋 安装步骤:"
echo ""
echo "1️⃣  移除安全隔离属性..."
xattr -cr "$SOURCE_DIR/$APP_NAME"
echo "   ✅ 完成"
echo ""

echo "2️⃣  复制应用到应用程序文件夹..."
if [ -d "$DEST_DIR/$APP_NAME" ]; then
    echo "   ⚠️  检测到旧版本，正在替换..."
    rm -rf "$DEST_DIR/$APP_NAME"
fi
cp -R "$SOURCE_DIR/$APP_NAME" "$DEST_DIR/"
echo "   ✅ 完成"
echo ""

echo "3️⃣  设置应用权限..."
chmod -R 755 "$DEST_DIR/$APP_NAME"
echo "   ✅ 完成"
echo ""

echo "======================================"
echo "  ✅ 安装成功！"
echo "======================================"
echo ""
echo "📱 下一步操作："
echo ""
echo "1. 首次打开应用："
echo "   方法A: 在启动台或应用程序文件夹中找到 EmployeeMonitor"
echo "   方法B: 右键点击应用 → 选择'打开' → 确认打开"
echo ""
echo "2. 授予必要权限："
echo "   - 辅助功能权限（监控键盘鼠标）"
echo "   - 屏幕录制权限（截取屏幕）"
echo ""
echo "   💡 应用会自动引导您完成权限设置"
echo ""
echo "🎉 祝您使用愉快！"
echo ""

# 询问是否立即打开
read -p "是否现在打开应用? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 正在启动应用..."
    open "$DEST_DIR/$APP_NAME"
fi
EOF

# 为 x64 版本创建安装脚本
cat > "$RELEASE_DIR/安装-Intel.command" << 'EOF'
#!/bin/bash

# EmployeeMonitor 一键安装脚本 (Intel)

APP_NAME="EmployeeMonitor.app"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)/EmployeeMonitor-darwin-x64"
DEST_DIR="/Applications"

echo "======================================"
echo "  EmployeeMonitor 安装向导"
echo "  适用于: Intel 处理器"
echo "======================================"
echo ""

# 检查应用是否存在
if [ ! -d "$SOURCE_DIR/$APP_NAME" ]; then
    echo "❌ 错误: 找不到 $APP_NAME"
    echo "请确保此脚本在解压后的文件夹中运行"
    exit 1
fi

echo "📋 安装步骤:"
echo ""
echo "1️⃣  移除安全隔离属性..."
xattr -cr "$SOURCE_DIR/$APP_NAME"
echo "   ✅ 完成"
echo ""

echo "2️⃣  复制应用到应用程序文件夹..."
if [ -d "$DEST_DIR/$APP_NAME" ]; then
    echo "   ⚠️  检测到旧版本，正在替换..."
    rm -rf "$DEST_DIR/$APP_NAME"
fi
cp -R "$SOURCE_DIR/$APP_NAME" "$DEST_DIR/"
echo "   ✅ 完成"
echo ""

echo "3️⃣  设置应用权限..."
chmod -R 755 "$DEST_DIR/$APP_NAME"
echo "   ✅ 完成"
echo ""

echo "======================================"
echo "  ✅ 安装成功！"
echo "======================================"
echo ""
echo "📱 下一步操作："
echo ""
echo "1. 首次打开应用："
echo "   方法A: 在启动台或应用程序文件夹中找到 EmployeeMonitor"
echo "   方法B: 右键点击应用 → 选择'打开' → 确认打开"
echo ""
echo "2. 授予必要权限："
echo "   - 辅助功能权限（监控键盘鼠标）"
echo "   - 屏幕录制权限（截取屏幕）"
echo ""
echo "   💡 应用会自动引导您完成权限设置"
echo ""
echo "🎉 祝您使用愉快！"
echo ""

# 询问是否立即打开
read -p "是否现在打开应用? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 正在启动应用..."
    open "$DEST_DIR/$APP_NAME"
fi
EOF

# 设置脚本为可执行
chmod +x "$RELEASE_DIR/安装-AppleSilicon.command"
chmod +x "$RELEASE_DIR/安装-Intel.command"

echo "✅ 安装脚本已创建:"
echo "   - $RELEASE_DIR/安装-AppleSilicon.command"
echo "   - $RELEASE_DIR/安装-Intel.command"
echo ""
echo "📦 分发时包含这些脚本，用户双击即可安装"
