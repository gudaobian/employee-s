#!/bin/bash

# Employee Monitor 客户端上线问题修复脚本
# 版本: 1.0
# 创建时间: 2025-11-04

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示标题
show_header() {
    echo "========================================="
    echo "Employee Monitor 客户端上线问题修复"
    echo "========================================="
    echo ""
}

# 检查 API 服务器状态
check_api_server() {
    log_info "检查 API 服务器状态..."

    if curl -s -f http://localhost:3000/api/health > /dev/null 2>&1; then
        log_success "API 服务器运行正常"
        return 0
    else
        log_error "API 服务器未运行或不可达"
        log_warning "请先启动 API 服务器:"
        log_warning "  cd api-server && npm run dev:local"
        return 1
    fi
}

# 备份配置
backup_config() {
    log_info "备份现有配置..."

    BACKUP_DIR=~/employee-monitor-backup/$(date +%Y%m%d_%H%M%S)
    mkdir -p "$BACKUP_DIR"

    if [ -f ~/Library/Application\ Support/employee-monitor/config.json ]; then
        cp ~/Library/Application\ Support/employee-monitor/config.json \
           "$BACKUP_DIR/config.json.bak"
        log_success "配置已备份到: $BACKUP_DIR"
    else
        log_warning "配置文件不存在，跳过备份"
    fi

    # 备份应用（可选）
    if [ -d /Applications/EmployeeMonitor.app ]; then
        log_info "备份应用程序（这可能需要几分钟）..."
        cp -r /Applications/EmployeeMonitor.app "$BACKUP_DIR/EmployeeMonitor.app.bak"
        log_success "应用程序已备份"
    fi
}

# 创建配置文件
create_config() {
    log_info "创建/更新配置文件..."

    CONFIG_DIR=~/Library/Application\ Support/employee-monitor
    mkdir -p "$CONFIG_DIR"

    # 生成设备 ID
    DEVICE_ID="mac-$(hostname)-$(date +%s)"

    # 创建配置文件
    cat > "$CONFIG_DIR/config.json" << EOF
{
  "serverUrl": "http://localhost:3000",
  "websocketUrl": "http://localhost:3000/client",
  "deviceId": "$DEVICE_ID",
  "enableMonitoring": true,
  "screenshotInterval": 30000,
  "activityInterval": 60000,
  "processScanInterval": 180000,
  "enableScreenshot": true,
  "enableActivity": true,
  "enableProcess": true,
  "logLevel": "info"
}
EOF

    log_success "配置文件已创建"
    log_info "设备 ID: $DEVICE_ID"

    # 验证 JSON 格式
    if command -v jq > /dev/null; then
        if jq '.' "$CONFIG_DIR/config.json" > /dev/null 2>&1; then
            log_success "配置文件 JSON 格式正确"
        else
            log_error "配置文件 JSON 格式错误"
            return 1
        fi
    fi
}

# 停止现有应用
stop_client() {
    log_info "停止现有客户端..."

    pkill -9 -f "EmployeeMonitor" 2>/dev/null || true
    pkill -9 -f "employee-monitor" 2>/dev/null || true

    sleep 2

    if pgrep -f "EmployeeMonitor" > /dev/null; then
        log_error "无法停止客户端进程"
        return 1
    else
        log_success "客户端已停止"
    fi
}

# 启动客户端
start_client() {
    log_info "启动客户端应用..."

    if [ ! -d /Applications/EmployeeMonitor.app ]; then
        log_error "客户端应用未安装: /Applications/EmployeeMonitor.app"
        return 1
    fi

    open /Applications/EmployeeMonitor.app

    log_success "客户端已启动"
    log_info "等待应用初始化..."
    sleep 10
}

# 验证连接
verify_connection() {
    log_info "验证 WebSocket 连接..."

    LOG_FILE=~/Library/Logs/employee-monitor/logs/app.log

    if [ ! -f "$LOG_FILE" ]; then
        log_error "日志文件不存在: $LOG_FILE"
        return 1
    fi

    # 检查连接成功
    if tail -100 "$LOG_FILE" | grep -q "Socket.IO connection established"; then
        log_success "✅ WebSocket 连接成功"
    else
        log_error "❌ WebSocket 连接失败"
        log_warning "查看日志获取详细信息:"
        log_warning "  tail -f $LOG_FILE"
        return 1
    fi

    # 检查在线模式
    if tail -100 "$LOG_FILE" | grep -q "networkSubState.*ONLINE"; then
        log_success "✅ 客户端处于 ONLINE 模式"
    else
        log_warning "⚠️ 客户端可能仍在 OFFLINE 模式"
    fi

    # 等待数据上传
    log_info "等待数据上传（60 秒）..."
    sleep 60

    # 检查数据上传
    if tail -200 "$LOG_FILE" | grep -q "已通过WebSocket服务上传"; then
        log_success "✅ 数据成功上传"
    else
        log_warning "⚠️ 未检测到数据上传"
    fi
}

# 显示结果
show_results() {
    echo ""
    echo "========================================="
    echo "修复完成"
    echo "========================================="
    echo ""
    log_info "配置文件位置:"
    echo "  ~/Library/Application Support/employee-monitor/config.json"
    echo ""
    log_info "日志文件位置:"
    echo "  ~/Library/Logs/employee-monitor/logs/app.log"
    echo ""
    log_info "实时监控日志:"
    echo "  tail -f ~/Library/Logs/employee-monitor/logs/app.log | grep -E 'WEBSOCKET|ONLINE|OFFLINE'"
    echo ""
    log_info "管理后台:"
    echo "  http://localhost/admin"
    echo ""
}

# 主流程
main() {
    show_header

    # 步骤 1: 检查 API 服务器
    if ! check_api_server; then
        log_error "请先启动 API 服务器，然后重新运行此脚本"
        exit 1
    fi

    # 步骤 2: 备份
    backup_config

    # 步骤 3: 创建配置
    if ! create_config; then
        log_error "配置创建失败"
        exit 1
    fi

    # 步骤 4: 停止客户端
    if ! stop_client; then
        log_warning "停止客户端时出现问题，继续执行..."
    fi

    # 步骤 5: 启动客户端
    if ! start_client; then
        log_error "启动客户端失败"
        exit 1
    fi

    # 步骤 6: 验证连接
    if verify_connection; then
        log_success "🎉 客户端上线成功！"
        show_results
        exit 0
    else
        log_error "连接验证失败"
        log_warning "请查看日志文件获取详细信息"
        show_results
        exit 1
    fi
}

# 执行主流程
main "$@"
