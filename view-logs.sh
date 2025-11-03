#!/bin/bash

# 日志查看脚本 - 用于调试 mouseScrolls 问题

echo "🔍 客户端日志查看工具"
echo "======================"
echo ""

# 检查是否有保存的日志文件
if [ -f "client.log" ]; then
  echo "📋 分析已保存的日志文件..."
  echo ""

  # 1. 查看活动数据上传
  echo "1️⃣ 活动数据上传记录："
  grep "Uploading accumulated data" client.log | tail -5
  echo ""

  # 2. 查看 mouseScrolls 数据
  echo "2️⃣ mouseScrolls 数据："
  grep -E "mouseScrolls|鼠标滚动" client.log | tail -10
  echo ""

  # 3. 查看 WebSocket 发送详情
  echo "3️⃣ WebSocket 发送详情："
  grep -A 8 "详细发送数据" client.log | tail -20
  echo ""

  # 4. 查看上传成功/失败
  echo "4️⃣ 上传结果："
  grep -E "WebSocket upload successful|upload failed" client.log | tail -5
  echo ""

  # 5. 统计信息
  echo "5️⃣ 统计信息："
  echo "  - 总上传次数: $(grep -c "Uploading accumulated data" client.log)"
  echo "  - 成功次数: $(grep -c "WebSocket upload successful" client.log)"
  echo "  - 失败次数: $(grep -c "upload failed" client.log)"
  echo "  - mouseScrolls 记录: $(grep -c "mouseScrolls" client.log)"

else
  echo "⚠️  没有找到日志文件 client.log"
  echo ""
  echo "请先运行客户端并保存日志："
  echo "  npm run dev > client.log 2>&1"
  echo ""
  echo "或者实时查看日志："
  echo "  npm run dev 2>&1 | tee client.log"
fi

echo ""
echo "======================"
echo "💡 使用提示："
echo "  - 运行客户端并保存日志: npm run dev > client.log 2>&1"
echo "  - 实时查看并保存: npm run dev 2>&1 | tee client.log"
echo "  - 只看 mouseScrolls: grep mouseScrolls client.log"
echo "  - 只看上传记录: grep 'Uploading accumulated' client.log"
