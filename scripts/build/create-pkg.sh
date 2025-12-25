#!/bin/bash

# EmployeeSafety PKG 安装包创建脚本
# PKG 格式会自动覆盖旧版本，解决多版本共存问题

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"

echo "📦 创建 macOS PKG 安装包..."
echo "=================================="

# 读取版本号
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")
echo "📌 当前版本: $VERSION"

# 确保应用已构建
if [ ! -d "$RELEASE_DIR/EmployeeSafety-darwin-arm64/EmployeeSafety.app" ]; then
    echo "❌ 错误: 找不到 arm64 版本，请先运行 npm run pack:mac"
    exit 1
fi

if [ ! -d "$RELEASE_DIR/EmployeeSafety-darwin-x64/EmployeeSafety.app" ]; then
    echo "❌ 错误: 找不到 x64 版本，请先运行 npm run pack:mac"
    exit 1
fi

# 创建 PKG 的函数
create_pkg() {
    local ARCH=$1
    local APP_PATH="$RELEASE_DIR/EmployeeSafety-darwin-$ARCH/EmployeeSafety.app"

    # 新命名格式: EmployeeSafety-macos-{arch}-{version}.pkg
    local PKG_NAME="EmployeeSafety-macos-$ARCH-$VERSION.pkg"
    local PKG_PATH="$RELEASE_DIR/$PKG_NAME"

    # 从 Info.plist 获取 Bundle ID（版本号已从 package.json 读取）
    local BUNDLE_VERSION=$(defaults read "$APP_PATH/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "$VERSION")
    local BUNDLE_ID=$(defaults read "$APP_PATH/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || echo "com.company.employee-monitor")

    echo ""
    echo "📦 创建 $ARCH 版本 PKG ($VERSION)..."
    echo "   版本: $BUNDLE_VERSION"
    echo "   Bundle ID: $BUNDLE_ID"

    # 删除旧的 PKG
    rm -f "$PKG_PATH"

    # 创建临时目录结构
    local TEMP_DIR="$RELEASE_DIR/pkg-temp-$ARCH"
    local PAYLOAD_DIR="$TEMP_DIR/payload"
    local SCRIPTS_DIR="$TEMP_DIR/scripts"

    rm -rf "$TEMP_DIR"
    mkdir -p "$PAYLOAD_DIR/Applications"
    mkdir -p "$SCRIPTS_DIR"

    # 复制应用到 payload
    cp -R "$APP_PATH" "$PAYLOAD_DIR/Applications/"

    # 创建安装前脚本 (preinstall)
    cat > "$SCRIPTS_DIR/preinstall" << 'EOF'
#!/bin/bash

APP_NAME="EmployeeSafety.app"
TARGET_PATH="/Applications/$APP_NAME"

echo "检查并关闭正在运行的应用..."

# 检查应用是否正在运行
if pgrep -f "$APP_NAME" > /dev/null; then
    echo "关闭正在运行的应用..."
    osascript -e "tell application \"EmployeeSafety\" to quit" 2>/dev/null || true
    sleep 2
    pkill -f "$APP_NAME" 2>/dev/null || true
    sleep 1
fi

# 删除旧版本（PKG会自动覆盖，但我们确保完全删除）
if [ -d "$TARGET_PATH" ]; then
    echo "删除旧版本..."
    rm -rf "$TARGET_PATH"
fi

exit 0
EOF

    # 创建安装后脚本 (postinstall)
    cat > "$SCRIPTS_DIR/postinstall" << 'EOF'
#!/bin/bash

APP_NAME="EmployeeSafety.app"
TARGET_PATH="/Applications/$APP_NAME"

echo "设置应用权限..."

# 确保应用可执行
chmod -R 755 "$TARGET_PATH"

# 移除隔离属性（避免"来自未知开发者"警告）
xattr -cr "$TARGET_PATH" 2>/dev/null || true

echo "安装完成！"

exit 0
EOF

    # 设置脚本可执行权限
    chmod +x "$SCRIPTS_DIR/preinstall"
    chmod +x "$SCRIPTS_DIR/postinstall"

    # 构建 PKG
    pkgbuild --root "$PAYLOAD_DIR" \
             --scripts "$SCRIPTS_DIR" \
             --identifier "$BUNDLE_ID" \
             --version "$BUNDLE_VERSION" \
             --install-location "/" \
             "$PKG_PATH"

    # 清理临时文件
    rm -rf "$TEMP_DIR"

    echo "   ✅ $PKG_NAME 创建成功"

    # 显示大小
    local FINAL_SIZE=$(du -h "$PKG_PATH" | awk '{print $1}')
    echo "   📊 文件大小: $FINAL_SIZE"
}

# 创建两个架构的 PKG
create_pkg "arm64"
create_pkg "x64"

echo ""
echo "=================================="
echo "✅ PKG 安装包创建完成！"
echo "=================================="
echo ""
echo "📦 生成的文件:"
ls -lh "$RELEASE_DIR"/*.pkg | awk '{print "   " $9 " (" $5 ")"}'
echo ""
echo "💡 安装说明:"
echo "   - 用户下载对应架构的 .pkg 文件"
echo "   - 双击运行安装器"
echo "   - PKG 会自动覆盖旧版本，无需手动删除"
echo "   - 安装完成后即可使用"
echo ""
echo "🔒 代码签名建议:"
echo "   - 建议对 PKG 进行代码签名以提升安全性"
echo "   - 签名命令: productsign --sign \"Developer ID Installer\" input.pkg output.pkg"
echo ""
