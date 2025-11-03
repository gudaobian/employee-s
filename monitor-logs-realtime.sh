#!/bin/bash

# 实时监控客户端日志 - 专注于 mouseScrolls

echo "🔍 开始实时监控客户端日志..."
echo "================================"
echo "关注项："
echo "  1. 数据采集时的 mouseScrolls 值"
echo "  2. WebSocket 发送的完整数据"
echo "  3. 上传成功/失败状态"
echo ""
echo "⚠️  请在另一个窗口运行客户端并进行鼠标滚动操作"
echo "================================"
echo ""

# 如果日志文件存在，从文件读取；否则从标准输入读取
if [ -f "client.log" ]; then
  echo "📋 监控日志文件: client.log"
  tail -f client.log | grep --line-buffered -E "Uploading accumulated data|详细发送数据|mouseScrolls|WebSocket upload|ACTIVITY_COLLECTOR" | while read line; do
    if [[ $line == *"mouseScrolls"* ]]; then
      echo -e "\n🖱️  $(date '+%H:%M:%S') | $line"
    elif [[ $line == *"Uploading accumulated"* ]]; then
      echo -e "\n📤 $(date '+%H:%M:%S') | $line"
    elif [[ $line == *"WebSocket upload successful"* ]]; then
      echo -e "\n✅ $(date '+%H:%M:%S') | $line"
    elif [[ $line == *"upload failed"* ]]; then
      echo -e "\n❌ $(date '+%H:%M:%S') | $line"
    else
      echo "   $(date '+%H:%M:%S') | $line"
    fi
  done
else
  echo "⚠️  日志文件不存在，等待输入..."
  echo "请运行: npm run dev 2>&1 | tee client.log"
fi
