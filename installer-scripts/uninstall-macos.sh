#!/bin/bash
# Employee Safety Client - macOS Uninstaller
# Complete removal of the application and all its data

set -e

APP_NAME="EmployeeSafety"
PROCESS_NAME="EmployeeSafety"
BUNDLE_ID="com.company.employee-safety"

echo "========================================"
echo "Employee Safety - macOS 卸载程序"
echo "========================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

# Check if running with sudo for certain operations
check_permissions() {
    if [ "$EUID" -eq 0 ]; then
        print_warning "以 root 权限运行"
        IS_ROOT=true
    else
        IS_ROOT=false
    fi
}

# Stop all processes
stop_processes() {
    print_info "停止 Employee Safety 进程..."

    PIDS=$(pgrep -f "$PROCESS_NAME" 2>/dev/null || true)

    if [ -z "$PIDS" ]; then
        print_success "没有运行中的进程"
        return 0
    fi

    for PID in $PIDS; do
        if ps -p $PID > /dev/null 2>&1; then
            print_info "停止进程 (PID: $PID)..."
            kill -TERM $PID 2>/dev/null || true
        fi
    done

    sleep 3

    # Force kill if needed
    PIDS=$(pgrep -f "$PROCESS_NAME" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        print_warning "强制终止进程..."
        for PID in $PIDS; do
            kill -9 $PID 2>/dev/null || true
        done
    fi

    print_success "进程已停止"
}

# Remove application bundles
remove_applications() {
    print_info "删除应用程序..."

    APP_LOCATIONS=(
        "/Applications/$APP_NAME.app"
        "$HOME/Applications/$APP_NAME.app"
        "/Applications/Utilities/$APP_NAME.app"
    )

    for APP_PATH in "${APP_LOCATIONS[@]}"; do
        if [ -d "$APP_PATH" ]; then
            print_info "删除: $APP_PATH"
            rm -rf "$APP_PATH" 2>/dev/null || {
                if [ "$IS_ROOT" = false ]; then
                    print_error "权限不足，尝试使用 sudo..."
                    sudo rm -rf "$APP_PATH" || print_error "删除失败: $APP_PATH"
                else
                    print_error "删除失败: $APP_PATH"
                fi
            }
            print_success "应用已删除: $APP_PATH"
        fi
    done
}

# Remove user data
remove_user_data() {
    print_info "删除用户数据..."

    USER_DATA_PATHS=(
        "$HOME/Library/Application Support/employee-safety-client"
        "$HOME/Library/Application Support/$APP_NAME"
        "$HOME/.employee-safety"
    )

    for DATA_PATH in "${USER_DATA_PATHS[@]}"; do
        if [ -e "$DATA_PATH" ]; then
            print_info "删除: $DATA_PATH"
            rm -rf "$DATA_PATH" || print_warning "无法删除: $DATA_PATH"
        fi
    done

    print_success "用户数据已删除"
}

# Remove preferences
remove_preferences() {
    print_info "删除偏好设置..."

    PREF_PATHS=(
        "$HOME/Library/Preferences/$BUNDLE_ID.plist"
        "$HOME/Library/Preferences/ByHost/$BUNDLE_ID.*.plist"
        "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState"
    )

    for PREF_PATH in "${PREF_PATHS[@]}"; do
        if ls $PREF_PATH 1> /dev/null 2>&1; then
            print_info "删除: $PREF_PATH"
            rm -rf $PREF_PATH || print_warning "无法删除: $PREF_PATH"
        fi
    done

    # Kill preference cache
    defaults delete "$BUNDLE_ID" 2>/dev/null || true

    print_success "偏好设置已删除"
}

# Remove caches
remove_caches() {
    print_info "删除缓存..."

    CACHE_PATHS=(
        "$HOME/Library/Caches/$BUNDLE_ID"
        "$HOME/Library/Caches/employee-safety-client"
    )

    for CACHE_PATH in "${CACHE_PATHS[@]}"; do
        if [ -d "$CACHE_PATH" ]; then
            print_info "删除: $CACHE_PATH"
            rm -rf "$CACHE_PATH" || print_warning "无法删除: $CACHE_PATH"
        fi
    done

    print_success "缓存已删除"
}

# Remove logs
remove_logs() {
    print_info "删除日志..."

    LOG_PATHS=(
        "$HOME/Library/Logs/$APP_NAME"
        "$HOME/Library/Logs/employee-safety-client"
    )

    for LOG_PATH in "${LOG_PATHS[@]}"; do
        if [ -d "$LOG_PATH" ]; then
            print_info "删除: $LOG_PATH"
            rm -rf "$LOG_PATH" || print_warning "无法删除: $LOG_PATH"
        fi
    done

    print_success "日志已删除"
}

# Remove login items
remove_login_items() {
    print_info "删除登录项..."

    osascript <<EOF 2>/dev/null || true
tell application "System Events"
    try
        delete login item "$APP_NAME"
    end try
end tell
EOF

    print_success "登录项已删除"
}

# Remove launch agents/daemons (if any)
remove_launch_items() {
    print_info "删除启动项..."

    LAUNCH_PATHS=(
        "$HOME/Library/LaunchAgents/$BUNDLE_ID.plist"
        "/Library/LaunchAgents/$BUNDLE_ID.plist"
        "/Library/LaunchDaemons/$BUNDLE_ID.plist"
    )

    for LAUNCH_PATH in "${LAUNCH_PATHS[@]}"; do
        if [ -f "$LAUNCH_PATH" ]; then
            print_info "卸载: $LAUNCH_PATH"

            # Unload first
            if [[ "$LAUNCH_PATH" == *"LaunchDaemons"* ]]; then
                sudo launchctl unload "$LAUNCH_PATH" 2>/dev/null || true
                sudo rm -f "$LAUNCH_PATH" || print_warning "无法删除: $LAUNCH_PATH"
            else
                launchctl unload "$LAUNCH_PATH" 2>/dev/null || true
                rm -f "$LAUNCH_PATH" || print_warning "无法删除: $LAUNCH_PATH"
            fi
        fi
    done

    print_success "启动项已删除"
}

# Clean temporary files
clean_temp() {
    print_info "清理临时文件..."

    rm -rf "$TMPDIR/employee-safety-"* 2>/dev/null || true
    rm -rf "$TMPDIR/$APP_NAME"* 2>/dev/null || true
    rm -rf /tmp/employee-safety-* 2>/dev/null || true

    print_success "临时文件已清理"
}

# Receipt cleanup (for package installations)
remove_receipts() {
    print_info "删除安装收据..."

    RECEIPT_PATHS=(
        "/var/db/receipts/$BUNDLE_ID.*"
        "/Library/Receipts/$APP_NAME*"
    )

    for RECEIPT_PATH in "${RECEIPT_PATHS[@]}"; do
        if ls $RECEIPT_PATH 1> /dev/null 2>&1; then
            print_info "删除: $RECEIPT_PATH"
            if [ "$IS_ROOT" = true ]; then
                rm -rf $RECEIPT_PATH || print_warning "无法删除: $RECEIPT_PATH"
            else
                sudo rm -rf $RECEIPT_PATH 2>/dev/null || print_warning "无法删除: $RECEIPT_PATH"
            fi
        fi
    done

    print_success "安装收据已删除"
}

# Summary of what will be removed
show_summary() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "此卸载程序将删除:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  📦 应用程序:"
    echo "     • /Applications/$APP_NAME.app"
    echo ""
    echo "  📁 用户数据:"
    echo "     • ~/Library/Application Support/employee-safety-client"
    echo "     • ~/.employee-safety"
    echo ""
    echo "  ⚙️  偏好设置:"
    echo "     • ~/Library/Preferences/$BUNDLE_ID.plist"
    echo ""
    echo "  🗂  缓存和日志:"
    echo "     • ~/Library/Caches/$BUNDLE_ID"
    echo "     • ~/Library/Logs/$APP_NAME"
    echo ""
    echo "  🚀 启动项:"
    echo "     • 登录项"
    echo "     • Launch Agents/Daemons"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Main execution
main() {
    check_permissions

    # Show what will be removed
    show_summary

    # Ask for confirmation
    echo -e "${RED}⚠️  警告: 此操作将完全删除 Employee Safety 及其所有数据!${NC}"
    echo ""
    read -p "确定要继续吗? 请输入 'yes' 确认: " -r
    echo

    if [ "$REPLY" != "yes" ]; then
        print_warning "卸载已取消"
        exit 0
    fi

    echo ""
    print_info "开始卸载..."
    echo ""

    # Execute uninstall steps
    stop_processes
    remove_applications
    remove_user_data
    remove_preferences
    remove_caches
    remove_logs
    remove_login_items
    remove_launch_items
    clean_temp
    remove_receipts

    echo ""
    echo "========================================"
    print_success "卸载完成!"
    echo "========================================"
    echo ""
    echo "Employee Safety 已从您的 Mac 中完全删除。"
    echo ""
    echo "如需重新安装，请访问:"
    echo "https://github.com/gudaobian/employee-s/releases"
    echo ""
}

# Run main function
main
