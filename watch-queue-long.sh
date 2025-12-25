#!/bin/bash

SCREENSHOT_DIR="/Users/zhangxiaoyu/Library/Application Support/employee-safety-client/queue-cache/screenshots/2025-12-24"

echo "监控截图队列 (60秒，每5秒检查一次)..."
echo ""

prev_count=-1

for i in $(seq 1 12); do
  if [ -d "$SCREENSHOT_DIR" ]; then
    count=$(ls "$SCREENSHOT_DIR" 2>/dev/null | grep -E '\.meta\.json' | wc -l | tr -d ' ')

    # 计算变化
    if [ "$prev_count" -ne -1 ]; then
      diff=$((count - prev_count))
      if [ "$diff" -eq 0 ]; then
        change_str="(无变化)"
      elif [ "$diff" -gt 0 ]; then
        change_str="(+$diff ⚠️ 新增)"
      else
        change_str="($diff ✅ 减少)"
      fi
    else
      change_str=""
    fi

    echo "$(date '+%H:%M:%S') - 截图文件数: $count $change_str"
    prev_count=$count
  else
    echo "$(date '+%H:%M:%S') - 目录不存在"
  fi

  sleep 5
done

echo ""
if [ "$prev_count" -eq 0 ]; then
  echo "✅ 队列已完全清空！"
elif [ "$count" -lt 31 ]; then
  echo "✅ 文件正在减少（从 31 → $count），后台上传正常工作"
elif [ "$count" -eq 31 ]; then
  echo "⚠️  文件数量未变化，可能需要重启客户端触发 StartupUploadService"
else
  echo "❌ 文件继续增加，仍有问题"
fi
