#!/bin/bash

echo "========================================="
echo "缓存持久化测试"
echo "========================================="

CACHE_FILE=~/Library/Application\ Support/employee-monitor/cache/offline-cache.json

echo ""
echo "步骤 1: 启动客户端"
open /Applications/EmployeeMonitor.app
sleep 5

echo ""
echo "步骤 2: 断开网络连接"
echo "提示: 关闭 Wi-Fi 或拔出网线"
read -p "断网后按 Enter 继续..."

echo ""
echo "步骤 3: 等待 2 分钟收集离线数据"
for i in {120..1}; do
  echo -ne "\r等待中: $i 秒  "
  sleep 1
done
echo ""

echo ""
echo "步骤 4: 检查缓存文件"
echo "----------------------------------------"
if [ -f "$CACHE_FILE" ]; then
  if command -v jq &> /dev/null; then
    cache_items=$(cat "$CACHE_FILE" | jq '. | length')
    echo "✓ 缓存文件存在"
    echo "✓ 缓存项数: $cache_items"

    # 显示缓存统计
    echo ""
    echo "缓存类型分布:"
    cat "$CACHE_FILE" | jq -r '.[].dataType' | sort | uniq -c
  else
    echo "✓ 缓存文件存在"
    echo "提示: 安装 jq 可查看详细信息 (brew install jq)"
  fi
else
  echo "✗ 缓存文件不存在: $CACHE_FILE"
fi

echo ""
echo "步骤 5: 重启客户端"
echo "----------------------------------------"
pkill -9 EmployeeMonitor
sleep 2
open /Applications/EmployeeMonitor.app
sleep 5

echo ""
echo "步骤 6: 检查缓存恢复"
echo "----------------------------------------"
tail -50 ~/Library/Logs/employee-monitor/logs/app.log | grep -E "PERSISTENT_CACHE|Cache loaded|Restored from disk"

echo ""
echo "步骤 7: 恢复网络连接"
echo "提示: 重新连接 Wi-Fi 或插入网线"
read -p "恢复网络后按 Enter 继续..."

echo ""
echo "步骤 8: 等待 1 分钟观察数据上传"
for i in {60..1}; do
  echo -ne "\r等待中: $i 秒  "
  sleep 1
done
echo ""

echo ""
echo "步骤 9: 检查缓存上传日志"
echo "----------------------------------------"
tail -100 ~/Library/Logs/employee-monitor/logs/app.log | grep -E "Upload|已上传|cache"

echo ""
echo "验收标准:"
echo "✓ 离线时应生成缓存文件"
echo "✓ 重启后应看到 'Cache loaded' 日志"
echo "✓ 恢复网络后缓存数据应上传"
echo "✓ 缓存容量应支持至少 2 小时离线数据"
echo ""
