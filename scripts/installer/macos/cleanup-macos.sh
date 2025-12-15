#!/bin/bash
# Employee Safety Client - macOS Cleanup Script
# This script cleans up old installations before installing new version

set -e

APP_NAME="EmployeeSafety"
PROCESS_NAME="EmployeeSafety"
BUNDLE_ID="com.company.employee-safety"

echo "========================================"
echo "Employee Safety - macOS 安装前清理"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo "ℹ️  $1"
}

# Function to stop running processes
stop_processes() {
    print_info "检查运行中的进程..."

    # Get process IDs
    PIDS=$(pgrep -f "$PROCESS_NAME" 2>/dev/null || true)

    if [ -z "$PIDS" ]; then
        print_success "没有发现运行中的进程"
        return 0
    fi

    print_info "发现进程: $PIDS"
    print_info "正在停止进程..."

    # Try graceful termination first
    for PID in $PIDS; do
        if ps -p $PID > /dev/null 2>&1; then
            print_info "尝试优雅停止进程 (PID: $PID)..."
            kill -TERM $PID 2>/dev/null || true
        fi
    done

    # Wait a moment
    sleep 2

    # Force kill if still running
    for PID in $PIDS; do
        if ps -p $PID > /dev/null 2>&1; then
            print_warning "进程仍在运行，强制终止 (PID: $PID)..."
            kill -9 $PID 2>/dev/null || true
        fi
    done

    # Verify all processes are stopped
    if pgrep -f "$PROCESS_NAME" > /dev/null 2>&1; then
        print_error "部分进程无法停止"
        return 1
    fi

    print_success "所有进程已停止"
    return 0
}

# Function to clean log files
clean_logs() {
    print_info "清理日志文件..."

    LOG_DIRS=(
        "$HOME/Library/Logs/$APP_NAME"
        "$HOME/Library/Application Support/employee-safety-client/logs"
        "$HOME/.employee-safety/logs"
    )

    for LOG_DIR in "${LOG_DIRS[@]}"; do
        if [ -d "$LOG_DIR" ]; then
            print_info "删除: $LOG_DIR"
            rm -rf "$LOG_DIR" 2>/dev/null || print_warning "无法删除: $LOG_DIR"
        fi
    done

    print_success "日志文件已清理"
}

# Function to clean temporary files
clean_temp_files() {
    print_info "清理临时文件..."

    TEMP_PATTERNS=(
        "$TMPDIR/employee-safety-*"
        "$TMPDIR/$APP_NAME*"
        "/tmp/employee-safety-*"
    )

    for PATTERN in "${TEMP_PATTERNS[@]}"; do
        if ls $PATTERN 1> /dev/null 2>&1; then
            print_info "删除临时文件: $PATTERN"
            rm -rf $PATTERN 2>/dev/null || true
        fi
    done

    print_success "临时文件已清理"
}

# Function to clean cache files
clean_cache() {
    print_info "清理缓存文件..."

    CACHE_DIRS=(
        "$HOME/Library/Caches/$BUNDLE_ID"
        "$HOME/Library/Caches/employee-safety-client"
        "$HOME/Library/Application Support/employee-safety-client/Cache"
        "$HOME/Library/Application Support/employee-safety-client/Code Cache"
        "$HOME/Library/Application Support/employee-safety-client/GPUCache"
    )

    for CACHE_DIR in "${CACHE_DIRS[@]}"; do
        if [ -d "$CACHE_DIR" ]; then
            print_info "删除缓存: $CACHE_DIR"
            rm -rf "$CACHE_DIR" 2>/dev/null || print_warning "无法删除: $CACHE_DIR"
        fi
    done

    print_success "缓存已清理"
}

# Function to remove old application
remove_old_app() {
    print_info "检查旧版本应用..."

    APP_PATHS=(
        "/Applications/$APP_NAME.app"
        "$HOME/Applications/$APP_NAME.app"
    )

    for APP_PATH in "${APP_PATHS[@]}"; do
        if [ -d "$APP_PATH" ]; then
            print_info "发现旧版本: $APP_PATH"

            # Check if we should remove it
            if [ "$REMOVE_OLD_APP" = "true" ]; then
                print_info "删除旧版本..."
                rm -rf "$APP_PATH" 2>/dev/null || print_error "无法删除: $APP_PATH"
                print_success "旧版本已删除"
            else
                print_warning "跳过删除旧版本（需要手动处理）"
            fi
        fi
    done
}

# Function to clean user data (optional)
clean_user_data() {
    if [ "$CLEAN_USER_DATA" != "true" ]; then
        print_info "跳过用户数据清理（保留配置）"
        return 0
    fi

    print_warning "清理用户数据..."

    USER_DATA_DIRS=(
        "$HOME/Library/Application Support/employee-safety-client"
        "$HOME/Library/Preferences/$BUNDLE_ID.plist"
        "$HOME/.employee-safety"
    )

    for DATA_DIR in "${USER_DATA_DIRS[@]}"; do
        if [ -e "$DATA_DIR" ]; then
            print_info "删除用户数据: $DATA_DIR"
            rm -rf "$DATA_DIR" 2>/dev/null || print_warning "无法删除: $DATA_DIR"
        fi
    done

    print_success "用户数据已清理"
}

# Function to remove login items
remove_login_items() {
    print_info "清理登录项..."

    # Remove from login items using osascript
    osascript -e "tell application \"System Events\" to delete login item \"$APP_NAME\"" 2>/dev/null || true

    print_success "登录项已清理"
}

# Parse command line arguments
REMOVE_OLD_APP=false
CLEAN_USER_DATA=false
SILENT_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --remove-old)
            REMOVE_OLD_APP=true
            shift
            ;;
        --clean-data)
            CLEAN_USER_DATA=true
            shift
            ;;
        --silent)
            SILENT_MODE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --remove-old    Remove old application bundle"
            echo "  --clean-data    Clean user data and preferences"
            echo "  --silent        Run without user interaction"
            echo "  --help          Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Main execution
main() {
    echo ""

    # Ask for confirmation if not in silent mode
    if [ "$SILENT_MODE" != "true" ]; then
        echo "此脚本将执行以下操作:"
        echo "  1. 停止运行中的 Employee Safety 进程"
        echo "  2. 清理日志文件"
        echo "  3. 清理临时文件"
        echo "  4. 清理缓存文件"

        if [ "$REMOVE_OLD_APP" = "true" ]; then
            echo "  5. 删除旧版本应用"
        fi

        if [ "$CLEAN_USER_DATA" = "true" ]; then
            echo "  6. 清理用户数据和配置"
        fi

        echo ""
        read -p "是否继续? [y/N] " -n 1 -r
        echo

        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_warning "操作已取消"
            exit 0
        fi
    fi

    echo ""

    # Execute cleanup steps
    stop_processes || print_warning "进程停止失败，继续执行..."
    clean_logs
    clean_temp_files
    clean_cache
    remove_old_app
    clean_user_data
    remove_login_items

    echo ""
    echo "========================================"
    print_success "清理完成!"
    echo "========================================"
    echo ""

    if [ "$SILENT_MODE" != "true" ]; then
        echo "现在可以安装新版本的 Employee Safety"
        echo ""
    fi
}

# Run main function
main
