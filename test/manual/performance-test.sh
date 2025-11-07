#!/bin/bash
# Performance & Stability Test Script
# Tests memory usage, latency, and long-term stability

set -e

echo "======================================"
echo "Performance & Stability Test"
echo "macOS URL Collection Feature"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LOG_FILE="logs/app.log"
REPORT_DIR="doc/test-reports"
TEST_DURATION_HOURS=${1:-8}  # Default 8 hours, can be overridden
MEMORY_CHECK_INTERVAL=3600  # 1 hour
LATENCY_SAMPLE_SIZE=100
MEMORY_THRESHOLD_MB=50  # Alert if memory grows >50MB

# Performance targets
P50_TARGET=60
P95_TARGET=250
P99_TARGET=1000

# Test results
declare -a MEMORY_SAMPLES
declare -a LATENCY_SAMPLES
INITIAL_MEMORY=0
CURRENT_MEMORY=0

# Function to check if application is running
check_app_running() {
  if ! pgrep -f "employee-client" > /dev/null; then
    echo -e "${RED}ERROR: Application not running!${NC}"
    echo "Please start the application first: npm run dev"
    exit 1
  fi
}

# Function to get memory usage
get_memory_usage() {
  local pid=$(pgrep -f "employee-client" | head -1)

  if [ -z "$pid" ]; then
    echo "0"
    return
  fi

  # Get RSS memory in KB
  local mem=$(ps -o rss= -p "$pid" | awk '{print $1}')
  echo "$mem"
}

# Function to extract latency from logs
extract_latency_samples() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "0"
    return
  fi

  # Extract latency values from "URL collected in Xms" log messages
  grep -oE "URL collected in [0-9]+ms" "$LOG_FILE" | \
    grep -oE "[0-9]+" | \
    tail -n $LATENCY_SAMPLE_SIZE
}

# Function to calculate percentile
calculate_percentile() {
  local percentile=$1
  shift
  local values=("$@")

  if [ ${#values[@]} -eq 0 ]; then
    echo "0"
    return
  fi

  # Sort values
  IFS=$'\n' sorted=($(sort -n <<<"${values[*]}"))
  unset IFS

  # Calculate index
  local index=$(( ${#sorted[@]} * $percentile / 100 ))
  [ $index -lt 0 ] && index=0
  [ $index -ge ${#sorted[@]} ] && index=$((${#sorted[@]} - 1))

  echo "${sorted[$index]}"
}

# Function to monitor memory over time
monitor_memory() {
  echo ""
  echo "======================================"
  echo "Memory Monitoring"
  echo "Duration: $TEST_DURATION_HOURS hours"
  echo "Check Interval: $((MEMORY_CHECK_INTERVAL / 60)) minutes"
  echo "======================================"
  echo ""

  # Get initial memory
  INITIAL_MEMORY=$(get_memory_usage)
  local initial_mb=$((INITIAL_MEMORY / 1024))

  echo -e "${BLUE}Initial memory: ${initial_mb} MB${NC}"
  MEMORY_SAMPLES+=("$INITIAL_MEMORY")

  # Monitor over time
  for i in $(seq 1 $TEST_DURATION_HOURS); do
    echo ""
    echo "Waiting $((MEMORY_CHECK_INTERVAL / 60)) minutes until next check..."
    echo "(Hour $i of $TEST_DURATION_HOURS)"

    sleep $MEMORY_CHECK_INTERVAL

    # Check if app is still running
    if ! pgrep -f "employee-client" > /dev/null; then
      echo -e "${RED}ERROR: Application crashed!${NC}"
      echo "Test terminated at hour $i"
      return 1
    fi

    # Get current memory
    CURRENT_MEMORY=$(get_memory_usage)
    local current_mb=$((CURRENT_MEMORY / 1024))
    local increase_mb=$(( (CURRENT_MEMORY - INITIAL_MEMORY) / 1024 ))

    MEMORY_SAMPLES+=("$CURRENT_MEMORY")

    echo -e "${BLUE}Hour $i: ${current_mb} MB (增长: ${increase_mb} MB)${NC}"

    # Check threshold
    if [ $increase_mb -gt $MEMORY_THRESHOLD_MB ]; then
      echo -e "${RED}⚠️  WARNING: Memory increase > ${MEMORY_THRESHOLD_MB}MB${NC}"
      echo "   Possible memory leak detected"
    else
      echo -e "${GREEN}✓ Memory usage within normal range${NC}"
    fi
  done

  echo ""
  echo -e "${GREEN}Memory monitoring complete${NC}"
  return 0
}

# Function to analyze latency
analyze_latency() {
  echo ""
  echo "======================================"
  echo "Latency Analysis"
  echo "======================================"
  echo ""

  # Extract latency samples
  local latencies=($(extract_latency_samples))

  if [ ${#latencies[@]} -eq 0 ]; then
    echo -e "${RED}ERROR: No latency data found in logs${NC}"
    echo "Ensure the application has been collecting URLs"
    return 1
  fi

  echo "Sample size: ${#latencies[@]} measurements"
  echo ""

  # Calculate percentiles
  local p50=$(calculate_percentile 50 "${latencies[@]}")
  local p95=$(calculate_percentile 95 "${latencies[@]}")
  local p99=$(calculate_percentile 99 "${latencies[@]}")

  # Calculate average
  local sum=0
  for lat in "${latencies[@]}"; do
    sum=$((sum + lat))
  done
  local avg=$((sum / ${#latencies[@]}))

  echo "Latency Percentiles:"
  echo "  Average: ${avg}ms"
  echo "  P50: ${p50}ms (target: ≤${P50_TARGET}ms)"
  echo "  P95: ${p95}ms (target: ≤${P95_TARGET}ms)"
  echo "  P99: ${p99}ms (target: ≤${P99_TARGET}ms)"
  echo ""

  # Verify targets
  local p50_status="✅"
  local p95_status="✅"
  local p99_status="✅"

  [ $p50 -le $P50_TARGET ] && p50_status="✅" || p50_status="❌"
  [ $p95 -le $P95_TARGET ] && p95_status="✅" || p95_status="❌"
  [ $p99 -le $P99_TARGET ] && p99_status="✅" || p99_status="❌"

  echo "Target Status:"
  echo -e "  P50: $p50_status $([ $p50 -le $P50_TARGET ] && echo 'PASS' || echo 'FAIL')"
  echo -e "  P95: $p95_status $([ $p95 -le $P95_TARGET ] && echo 'PASS' || echo 'FAIL')"
  echo -e "  P99: $p99_status $([ $p99 -le $P99_TARGET ] && echo 'PASS' || echo 'FAIL')"
  echo ""

  # Store for report
  LATENCY_SAMPLES=("${latencies[@]}")
  LATENCY_P50=$p50
  LATENCY_P95=$p95
  LATENCY_P99=$p99
  LATENCY_AVG=$avg

  return 0
}

# Function to analyze error rate
analyze_error_rate() {
  echo ""
  echo "======================================"
  echo "Error Rate Analysis"
  echo "======================================"
  echo ""

  if [ ! -f "$LOG_FILE" ]; then
    echo -e "${RED}ERROR: Log file not found${NC}"
    return 1
  fi

  # Count total attempts and successes
  local total_attempts=$(grep -c "Attempting URL collection" "$LOG_FILE" || echo "0")
  local total_successes=$(grep -c "✅ URL collected" "$LOG_FILE" || echo "0")
  local total_failures=$(grep -c "❌ URL collection failed" "$LOG_FILE" || echo "0")

  if [ $total_attempts -eq 0 ]; then
    echo -e "${YELLOW}WARNING: No collection attempts found in logs${NC}"
    return 1
  fi

  local success_rate=$((total_successes * 100 / total_attempts))
  local failure_rate=$((total_failures * 100 / total_attempts))

  echo "Collection Statistics:"
  echo "  Total Attempts: $total_attempts"
  echo "  Successes: $total_successes ($success_rate%)"
  echo "  Failures: $total_failures ($failure_rate%)"
  echo ""

  # Analyze failure reasons
  echo "Failure Breakdown:"
  grep "URL collection failed" "$LOG_FILE" | \
    grep -oE "reason: [^,]+" | \
    cut -d: -f2 | \
    sort | uniq -c | sort -rn | \
    awk '{printf "  - %s: %d occurrences\n", $2, $1}'

  echo ""

  ERROR_STATS="$total_attempts attempts, $total_successes successes ($success_rate%)"

  return 0
}

# Generate markdown report
generate_report() {
  local timestamp=$(date +%Y%m%d_%H%M%S)
  local report_file="$REPORT_DIR/performance-report_$timestamp.md"

  mkdir -p "$REPORT_DIR"

  cat > "$report_file" << EOF
# macOS URL采集性能与稳定性测试报告

**测试日期**: $(date +"%Y-%m-%d %H:%M:%S")
**测试环境**: macOS $(sw_vers -productVersion)
**测试时长**: $TEST_DURATION_HOURS 小时

---

## 测试结果摘要

### 内存使用
- **初始内存**: $((INITIAL_MEMORY / 1024)) MB
- **最终内存**: $((CURRENT_MEMORY / 1024)) MB
- **内存增长**: $(( (CURRENT_MEMORY - INITIAL_MEMORY) / 1024 )) MB
- **阈值**: ${MEMORY_THRESHOLD_MB} MB
- **状态**: $([ $(( (CURRENT_MEMORY - INITIAL_MEMORY) / 1024 )) -le $MEMORY_THRESHOLD_MB ] && echo "✅ 正常" || echo "⚠️ 超出阈值")

### 延迟性能
- **平均延迟**: ${LATENCY_AVG}ms
- **P50**: ${LATENCY_P50}ms (目标: ≤${P50_TARGET}ms) $([ $LATENCY_P50 -le $P50_TARGET ] && echo "✅" || echo "❌")
- **P95**: ${LATENCY_P95}ms (目标: ≤${P95_TARGET}ms) $([ $LATENCY_P95 -le $P95_TARGET ] && echo "✅" || echo "❌")
- **P99**: ${LATENCY_P99}ms (目标: ≤${P99_TARGET}ms) $([ $LATENCY_P99 -le $P99_TARGET ] && echo "✅" || echo "❌")
- **样本数**: ${#LATENCY_SAMPLES[@]}

### 错误率
$ERROR_STATS

---

## 详细分析

### 1. 内存稳定性

**内存采样历史**:

| 时间点 | 内存使用 (MB) | 增长 (MB) | 状态 |
|--------|--------------|----------|------|
EOF

  # Add memory samples to table
  for i in "${!MEMORY_SAMPLES[@]}"; do
    local mem_mb=$((${MEMORY_SAMPLES[$i]} / 1024))
    local increase_mb=$(( (${MEMORY_SAMPLES[$i]} - INITIAL_MEMORY) / 1024 ))
    local status="✅"
    [ $increase_mb -gt $MEMORY_THRESHOLD_MB ] && status="⚠️"

    echo "| Hour $i | ${mem_mb} | ${increase_mb} | ${status} |" >> "$report_file"
  done

  cat >> "$report_file" << EOF

**分析**:
EOF

  local final_increase=$(( (CURRENT_MEMORY - INITIAL_MEMORY) / 1024 ))
  if [ $final_increase -le $MEMORY_THRESHOLD_MB ]; then
    echo "- ✅ 内存使用稳定，无明显泄漏" >> "$report_file"
    echo "- 内存增长在可接受范围内 (${final_increase}MB ≤ ${MEMORY_THRESHOLD_MB}MB)" >> "$report_file"
  else
    echo "- ⚠️ 内存持续增长超过阈值" >> "$report_file"
    echo "- 建议检查是否存在内存泄漏" >> "$report_file"
    echo "- 增长量: ${final_increase}MB (阈值: ${MEMORY_THRESHOLD_MB}MB)" >> "$report_file"
  fi

  cat >> "$report_file" << EOF

### 2. 延迟性能

**延迟分布**:
- 平均: ${LATENCY_AVG}ms
- 中位数 (P50): ${LATENCY_P50}ms
- 95th百分位: ${LATENCY_P95}ms
- 99th百分位: ${LATENCY_P99}ms

**性能目标对比**:

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| P50 | ≤${P50_TARGET}ms | ${LATENCY_P50}ms | $([ $LATENCY_P50 -le $P50_TARGET ] && echo "✅ 达标" || echo "❌ 未达标") |
| P95 | ≤${P95_TARGET}ms | ${LATENCY_P95}ms | $([ $LATENCY_P95 -le $P95_TARGET ] && echo "✅ 达标" || echo "❌ 未达标") |
| P99 | ≤${P99_TARGET}ms | ${LATENCY_P99}ms | $([ $LATENCY_P99 -le $P99_TARGET ] && echo "✅ 达标" || echo "❌ 未达标") |

**分析**:
EOF

  if [ $LATENCY_P50 -le $P50_TARGET ] && [ $LATENCY_P95 -le $P95_TARGET ] && [ $LATENCY_P99 -le $P99_TARGET ]; then
    echo "- ✅ 所有延迟指标达标" >> "$report_file"
    echo "- 系统响应速度符合预期" >> "$report_file"
  else
    echo "- ⚠️ 部分延迟指标未达标" >> "$report_file"

    if [ $LATENCY_P50 -gt $P50_TARGET ]; then
      echo "- P50超标: 影响大部分用户体验" >> "$report_file"
    fi

    if [ $LATENCY_P95 -gt $P95_TARGET ]; then
      echo "- P95超标: 5%的请求响应较慢" >> "$report_file"
    fi

    if [ $LATENCY_P99 -gt $P99_TARGET ]; then
      echo "- P99超标: 长尾延迟需要优化" >> "$report_file"
    fi
  fi

  cat >> "$report_file" << EOF

### 3. 稳定性评估

**测试时长**: $TEST_DURATION_HOURS 小时
**应用状态**: $(pgrep -f "employee-client" > /dev/null && echo "✅ 运行中" || echo "❌ 已停止")

**稳定性指标**:
- 无崩溃: $(pgrep -f "employee-client" > /dev/null && echo "✅ 是" || echo "❌ 否")
- 内存稳定: $([ $final_increase -le $MEMORY_THRESHOLD_MB ] && echo "✅ 是" || echo "❌ 否")
- 性能稳定: $([ $LATENCY_P95 -le $P95_TARGET ] && echo "✅ 是" || echo "❌ 否")

---

## 建议与改进

EOF

  # Add recommendations
  local issues_found=false

  if [ $final_increase -gt $MEMORY_THRESHOLD_MB ]; then
    echo "### 内存优化" >> "$report_file"
    echo "- 检查URL缓存策略，避免无限增长" >> "$report_file"
    echo "- 审查日志轮转机制" >> "$report_file"
    echo "- 使用内存分析工具定位泄漏点" >> "$report_file"
    echo "" >> "$report_file"
    issues_found=true
  fi

  if [ $LATENCY_P95 -gt $P95_TARGET ]; then
    echo "### 性能优化" >> "$report_file"
    echo "- 优化浏览器检测逻辑，减少不必要的重试" >> "$report_file"
    echo "- 考虑异步处理，避免阻塞主流程" >> "$report_file"
    echo "- 分析P95延迟的具体原因（日志中查找慢请求）" >> "$report_file"
    echo "" >> "$report_file"
    issues_found=true
  fi

  if ! $issues_found; then
    echo "✅ **系统运行良好**，所有指标达标" >> "$report_file"
    echo "" >> "$report_file"
    echo "建议:" >> "$report_file"
    echo "- 继续监控生产环境表现" >> "$report_file"
    echo "- 定期运行此测试以验证长期稳定性" >> "$report_file"
    echo "" >> "$report_file"
  fi

  cat >> "$report_file" << EOF

---

## 测试方法

### 测试流程
1. 记录应用初始内存使用
2. 每小时采样一次内存使用
3. 从日志提取延迟数据
4. 计算性能指标和错误率
5. 持续监控${TEST_DURATION_HOURS}小时

### 性能指标定义
- **P50 (中位数)**: 50%的请求响应时间 ≤ 此值
- **P95**: 95%的请求响应时间 ≤ 此值
- **P99**: 99%的请求响应时间 ≤ 此值

### 局限性
- 测试环境可能与生产环境有差异
- 网络状态影响延迟测量
- 单个macOS系统的测试结果

---

**报告生成时间**: $(date +"%Y-%m-%d %H:%M:%S")
**日志文件**: $LOG_FILE
**测试脚本**: test/manual/performance-test.sh
EOF

  echo ""
  echo -e "${GREEN}Report generated: $report_file${NC}"
}

# Print summary to console
print_summary() {
  echo ""
  echo "======================================"
  echo "Performance Test Summary"
  echo "======================================"
  echo ""

  echo "Memory:"
  echo "  Initial: $((INITIAL_MEMORY / 1024)) MB"
  echo "  Final: $((CURRENT_MEMORY / 1024)) MB"
  echo "  Growth: $(( (CURRENT_MEMORY - INITIAL_MEMORY) / 1024 )) MB"
  echo ""

  echo "Latency:"
  echo "  P50: ${LATENCY_P50}ms (target: ≤${P50_TARGET}ms)"
  echo "  P95: ${LATENCY_P95}ms (target: ≤${P95_TARGET}ms)"
  echo "  P99: ${LATENCY_P99}ms (target: ≤${P99_TARGET}ms)"
  echo ""

  echo "Status:"
  local mem_status="✅"
  [ $(( (CURRENT_MEMORY - INITIAL_MEMORY) / 1024 )) -gt $MEMORY_THRESHOLD_MB ] && mem_status="⚠️"

  local lat_status="✅"
  [ $LATENCY_P95 -gt $P95_TARGET ] && lat_status="❌"

  echo "  Memory: $mem_status"
  echo "  Latency: $lat_status"

  echo "======================================"
  echo ""
}

# Main test execution
main() {
  echo "Checking prerequisites..."
  echo ""

  # Verify application is running
  check_app_running

  echo -e "${GREEN}Application detected. Starting performance test...${NC}"
  echo ""
  echo "⚠️  Test Configuration:"
  echo "   Duration: $TEST_DURATION_HOURS hours"
  echo "   Memory checks: Every $((MEMORY_CHECK_INTERVAL / 60)) minutes"
  echo "   This is a LONG-RUNNING test. Keep your Mac awake."
  echo ""
  read -p "Press Enter to continue or Ctrl+C to cancel..."

  # Run memory monitoring (blocks for test duration)
  if ! monitor_memory; then
    echo -e "${RED}Test failed due to application crash${NC}"
    exit 1
  fi

  # Analyze latency
  analyze_latency

  # Analyze errors
  analyze_error_rate

  # Print summary
  print_summary

  # Generate report
  generate_report

  echo ""
  echo -e "${GREEN}Performance test complete!${NC}"
  echo "Review the detailed report for full analysis."
  echo ""
}

# Run main function
main
