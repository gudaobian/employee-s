#!/bin/bash

echo "========================================="
echo "系统休眠/唤醒测试"
echo "========================================="

LOG_FILE=~/Library/Logs/employee-monitor/logs/app.log

echo ""
echo "步骤 1: 启动客户端"
open /Applications/EmployeeMonitor.app
sleep 10

echo ""
echo "步骤 2: 检查初始连接状态"
echo "----------------------------------------"
tail -20 "$LOG_FILE" | grep -E "WEBSOCKET|connected"

echo ""
echo "步骤 3: 请手动让电脑休眠 5-10 分钟后唤醒"
echo "提示: 关闭屏幕盖子或使用 pmset sleepnow"
read -p "完成休眠和唤醒后按 Enter 继续..."

echo ""
echo "步骤 4: 检查唤醒后状态"
echo "----------------------------------------"
echo "查找电源事件日志:"
tail -50 "$LOG_FILE" | grep -E "POWER_EVENT|System resumed"

echo ""
echo "查找 WebSocket 重连日志:"
tail -50 "$LOG_FILE" | grep -E "WEBSOCKET|reconnect"

echo ""
echo "验收标准:"
echo "✓ 应该看到 [POWER_EVENT] 🌅 System resumed from sleep"
echo "✓ 应该看到 WebSocket reconnected 或 already connected"
echo "✓ 重连应在唤醒后 2 秒内完成"
echo ""
