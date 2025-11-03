#!/bin/bash

# 查看客户端活动相关日志的脚本

echo "选择查看方式："
echo "1. 查看最近的活动上传日志"
echo "2. 查看 mouseScrolls 相关日志"
echo "3. 实时监控活动数据"
echo "4. 查看 WebSocket 发送详情"
echo ""

case "${1:-1}" in
  1)
    echo "📊 最近的活动上传日志："
    echo "================================"
    npm run dev 2>&1 | grep -A 5 "Uploading accumulated data\|WebSocket upload"
    ;;
  2)
    echo "🖱️ mouseScrolls 相关日志："
    echo "================================"
    npm run dev 2>&1 | grep -i "mouseScrolls\|滚动"
    ;;
  3)
    echo "📡 实时监控（按 Ctrl+C 停止）："
    echo "================================"
    npm run dev 2>&1 | grep --line-buffered "ACTIVITY_COLLECTOR\|WEBSOCKET.*activity"
    ;;
  4)
    echo "📤 WebSocket 发送详情："
    echo "================================"
    npm run dev 2>&1 | grep -A 10 "详细发送数据"
    ;;
esac
