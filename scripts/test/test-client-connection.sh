#!/bin/bash

# Employee Monitor 客户端连接测试脚本
# 版本: 1.0
# 创建时间: 2025-11-04

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 测试计数器
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试函数
test_result() {
    local test_name="$1"
    local result="$2"
    local details="$3"

    ((TOTAL_TESTS++))

    if [ "$result" = "PASS" ]; then
        ((PASSED_TESTS++))
        echo -e "${GREEN}✅ PASS${NC} - $test_name"
        if [ -n "$details" ]; then
            echo "        $details"
        fi
    else
        ((FAILED_TESTS++))
        echo -e "${RED}❌ FAIL${NC} - $test_name"
        if [ -n "$details" ]; then
            echo "        $details"
        fi
    fi
}

# 显示标题
echo "========================================="
echo "Employee Monitor 连接测试套件"
echo "========================================="
echo ""

# 测试 1: 配置文件存在性
echo "[TEST 1] 检查配置文件..."
if [ -f ~/Library/Application\ Support/employee-monitor/config.json ]; then
    test_result "配置文件存在" "PASS" "~/Library/Application Support/employee-monitor/config.json"
else
    test_result "配置文件存在" "FAIL" "配置文件不存在"
fi

# 测试 2: 配置文件格式
echo ""
echo "[TEST 2] 验证配置文件格式..."
if command -v jq > /dev/null; then
    if jq '.' ~/Library/Application\ Support/employee-monitor/config.json > /dev/null 2>&1; then
        test_result "配置文件格式" "PASS" "JSON 格式正确"
    else
        test_result "配置文件格式" "FAIL" "JSON 格式错误"
    fi
else
    test_result "配置文件格式" "SKIP" "jq 未安装，跳过验证"
    ((TOTAL_TESTS--))  # 不计入总数
fi

# 测试 3: 必需配置字段
echo ""
echo "[TEST 3] 检查必需配置字段..."
if command -v jq > /dev/null && [ -f ~/Library/Application\ Support/employee-monitor/config.json ]; then
    CONFIG_FILE=~/Library/Application\ Support/employee-monitor/config.json

    # 检查 serverUrl
    if jq -e '.serverUrl' "$CONFIG_FILE" > /dev/null 2>&1; then
        SERVER_URL=$(jq -r '.serverUrl' "$CONFIG_FILE")
        test_result "serverUrl 配置" "PASS" "$SERVER_URL"
    else
        test_result "serverUrl 配置" "FAIL" "serverUrl 未配置"
    fi

    # 检查 deviceId
    if jq -e '.deviceId' "$CONFIG_FILE" > /dev/null 2>&1; then
        DEVICE_ID=$(jq -r '.deviceId' "$CONFIG_FILE")
        test_result "deviceId 配置" "PASS" "$DEVICE_ID"
    else
        test_result "deviceId 配置" "FAIL" "deviceId 未配置"
    fi
fi

# 测试 4: API 服务器可达性
echo ""
echo "[TEST 4] 测试 API 服务器连接..."
if curl -s -f -m 5 http://localhost:3000/api/health > /dev/null 2>&1; then
    test_result "API 服务器连接" "PASS" "http://localhost:3000 可达"
else
    test_result "API 服务器连接" "FAIL" "API 服务器不可达"
fi

# 测试 5: WebSocket 端口监听
echo ""
echo "[TEST 5] 检查 WebSocket 端口..."
if lsof -i :3000 2>/dev/null | grep LISTEN > /dev/null; then
    test_result "WebSocket 端口" "PASS" "端口 3000 正在监听"
else
    test_result "WebSocket 端口" "FAIL" "端口 3000 未监听"
fi

# 测试 6: 客户端进程运行
echo ""
echo "[TEST 6] 检查客户端进程..."
if pgrep -f "EmployeeMonitor" > /dev/null; then
    PID=$(pgrep -f "EmployeeMonitor" | head -1)
    test_result "客户端进程" "PASS" "进程 ID: $PID"
else
    test_result "客户端进程" "FAIL" "客户端未运行"
fi

# 测试 7: 日志文件存在
echo ""
echo "[TEST 7] 检查日志文件..."
LOG_FILE=~/Library/Logs/employee-monitor/logs/app.log
if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(ls -lh "$LOG_FILE" | awk '{print $5}')
    test_result "日志文件存在" "PASS" "大小: $LOG_SIZE"
else
    test_result "日志文件存在" "FAIL" "日志文件不存在"
fi

# 测试 8: WebSocket 连接状态
echo ""
echo "[TEST 8] 检查 WebSocket 连接..."
if [ -f "$LOG_FILE" ]; then
    if tail -100 "$LOG_FILE" | grep -q "Socket.IO connection established"; then
        test_result "WebSocket 连接" "PASS" "连接已建立"
    else
        if tail -100 "$LOG_FILE" | grep -q "connection error\|connect_error"; then
            ERROR_MSG=$(tail -100 "$LOG_FILE" | grep "connection error\|connect_error" | tail -1 | cut -c 1-80)
            test_result "WebSocket 连接" "FAIL" "$ERROR_MSG"
        else
            test_result "WebSocket 连接" "FAIL" "未找到连接成功日志"
        fi
    fi
fi

# 测试 9: 客户端模式（在线/离线）
echo ""
echo "[TEST 9] 检查客户端模式..."
if [ -f "$LOG_FILE" ]; then
    if tail -100 "$LOG_FILE" | grep -q "networkSubState.*ONLINE"; then
        test_result "客户端模式" "PASS" "ONLINE 模式"
    elif tail -100 "$LOG_FILE" | grep -q "networkSubState.*OFFLINE"; then
        test_result "客户端模式" "FAIL" "OFFLINE 模式"
    else
        test_result "客户端模式" "UNKNOWN" "无法确定模式"
    fi
fi

# 测试 10: 数据上传状态
echo ""
echo "[TEST 10] 检查数据上传..."
if [ -f "$LOG_FILE" ]; then
    if tail -200 "$LOG_FILE" | grep -q "已通过WebSocket服务上传"; then
        UPLOAD_COUNT=$(tail -200 "$LOG_FILE" | grep -c "已通过WebSocket服务上传")
        test_result "数据上传" "PASS" "检测到 $UPLOAD_COUNT 次上传"
    else
        if tail -200 "$LOG_FILE" | grep -q "WebSocket服务未连接"; then
            test_result "数据上传" "FAIL" "WebSocket 未连接"
        else
            test_result "数据上传" "WARN" "未检测到数据上传（可能时间太短）"
        fi
    fi
fi

# 显示测试结果
echo ""
echo "========================================="
echo "测试结果汇总"
echo "========================================="
echo ""
echo "总计测试: $TOTAL_TESTS"
echo -e "${GREEN}通过: $PASSED_TESTS${NC}"
echo -e "${RED}失败: $FAILED_TESTS${NC}"
echo ""

# 计算成功率
if [ $TOTAL_TESTS -gt 0 ]; then
    SUCCESS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    echo "成功率: $SUCCESS_RATE%"
    echo ""
fi

# 提供建议
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}🎉 所有测试通过！客户端运行正常。${NC}"
    EXIT_CODE=0
elif [ $FAILED_TESTS -le 2 ]; then
    echo -e "${YELLOW}⚠️  部分测试失败，但客户端可能正常工作。${NC}"
    echo "建议查看失败的测试项并进行修复。"
    EXIT_CODE=1
else
    echo -e "${RED}❌ 多项测试失败，客户端可能存在问题。${NC}"
    echo ""
    echo "建议操作："
    echo "1. 确保 API 服务器正在运行"
    echo "2. 检查配置文件是否正确"
    echo "3. 查看日志文件获取详细错误信息:"
    echo "   tail -100 ~/Library/Logs/employee-monitor/logs/app.log"
    EXIT_CODE=2
fi

echo ""
echo "========================================="

# 提供快速命令
echo ""
echo "快速诊断命令:"
echo "  查看实时日志:"
echo "    tail -f ~/Library/Logs/employee-monitor/logs/app.log | grep -E 'WEBSOCKET|ONLINE|OFFLINE'"
echo ""
echo "  查看配置:"
echo "    cat ~/Library/Application\\ Support/employee-monitor/config.json | jq '.'"
echo ""
echo "  重启客户端:"
echo "    pkill -9 EmployeeMonitor && open /Applications/EmployeeMonitor.app"
echo ""

exit $EXIT_CODE
