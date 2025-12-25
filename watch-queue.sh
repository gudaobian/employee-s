#!/bin/bash

SCREENSHOT_DIR="/Users/zhangxiaoyu/Library/Application Support/employee-safety-client/queue-cache/screenshots/2025-12-24"

echo "开始监控截图队列（30秒）..."
echo ""

for i in $(seq 1 15); do
  if [ -d "$SCREENSHOT_DIR" ]; then
    count=$(ls "$SCREENSHOT_DIR" 2>/dev/null | grep -E '\.meta\.json' | wc -l | tr -d ' ')
    echo "$(date '+%H:%M:%S') - 截图文件数: $count"
  else
    echo "$(date '+%H:%M:%S') - 目录不存在"
  fi
  sleep 2
done

echo ""
echo "监控完成"
