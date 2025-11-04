#!/bin/bash

echo "========================================="
echo "内存稳定性测试 (24 小时监控)"
echo "========================================="

LOG_FILE=~/Library/Logs/employee-monitor/logs/app.log
MEMORY_LOG=./memory-test-$(date +%Y%m%d_%H%M%S).log

echo ""
echo "测试配置:"
echo "- 监控时长: 24 小时"
echo "- 采样间隔: 5 分钟"
echo "- 总采样次数: 288 次"
echo "- 日志文件: $MEMORY_LOG"

echo ""
read -p "按 Enter 开始测试..."

echo ""
echo "测试开始: $(date)"
echo "========================================"

for i in {1..288}; do
  timestamp=$(date "+%Y-%m-%d %H:%M:%S")

  # 从日志中提取内存使用情况
  mem_info=$(tail -100 "$LOG_FILE" | grep -E "MEMORY|Heap:" | tail -1)

  if [ -n "$mem_info" ]; then
    echo "[$timestamp] $mem_info" >> "$MEMORY_LOG"
    echo "[$i/288] $timestamp - Memory logged"
  else
    echo "[$timestamp] No memory info found" >> "$MEMORY_LOG"
    echo "[$i/288] $timestamp - No memory info"
  fi

  # 等待 5 分钟 (300 秒)
  sleep 300
done

echo ""
echo "测试完成: $(date)"
echo "========================================"
echo ""
echo "分析内存日志:"
echo "----------------------------------------"
cat "$MEMORY_LOG" | grep "Heap:" | awk '{print $NF}' | sort -n | uniq

echo ""
echo "验收标准:"
echo "✓ 24 小时后内存使用应 < 350MB"
echo "✓ 内存使用应保持稳定，无持续增长趋势"
echo "✓ 应该看到定期的 GC 触发日志"
echo ""
