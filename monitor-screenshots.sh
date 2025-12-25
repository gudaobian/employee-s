#!/bin/bash

# Monitor screenshot queue status
SCREENSHOT_DIR="$HOME/Library/Application Support/employee-safety-client/queue-cache/screenshots"

echo "========== Screenshot Queue Monitor =========="
echo "监控截图队列状态 (每5秒刷新)"
echo ""

while true; do
  clear
  echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""

  if [ -d "$SCREENSHOT_DIR" ]; then
    # 统计每个日期目录的文件数
    for date_dir in "$SCREENSHOT_DIR"/*; do
      if [ -d "$date_dir" ]; then
        date_name=$(basename "$date_dir")
        file_count=$(find "$date_dir" -name "*.meta.json" | wc -l | tr -d ' ')

        if [ "$file_count" -gt 0 ]; then
          echo "📸 $date_name: $file_count 个截图待上传"

          # 显示最旧和最新的文件
          oldest=$(ls -t "$date_dir"/*.meta.json 2>/dev/null | tail -1 | xargs basename 2>/dev/null || echo "无")
          newest=$(ls -t "$date_dir"/*.meta.json 2>/dev/null | head -1 | xargs basename 2>/dev/null || echo "无")

          echo "   最旧: $oldest"
          echo "   最新: $newest"
        fi
      fi
    done

    # 总计
    total=$(find "$SCREENSHOT_DIR" -name "*.meta.json" 2>/dev/null | wc -l | tr -d ' ')
    echo ""
    echo "总计: $total 个截图文件"

    if [ "$total" -eq 0 ]; then
      echo "✅ 队列为空，截图上传正常"
    else
      echo "⚠️  仍有文件堆积，等待上传..."
    fi
  else
    echo "❌ 截图目录不存在: $SCREENSHOT_DIR"
  fi

  sleep 5
done
