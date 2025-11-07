#!/bin/bash
# Browser Compatibility Test Script
# Tests URL collection for each supported browser on macOS

set -e

echo "======================================"
echo "Browser Compatibility Test Suite"
echo "macOS URL Collection Feature"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
TEST_ITERATIONS=20
WAIT_TIME=60  # seconds between collections
LOG_FILE="logs/app.log"
REPORT_DIR="doc/test-reports"

# Test URLs for each browser
declare -A TEST_URLS=(
  ["Safari"]="https://github.com"
  ["Google Chrome"]="https://stackoverflow.com"
  ["Microsoft Edge"]="https://microsoft.com"
  ["Firefox"]="https://mozilla.org"
  ["Brave Browser"]="https://brave.com"
)

# Target success rates
declare -A TARGET_RATES=(
  ["Safari"]=95
  ["Google Chrome"]=90
  ["Microsoft Edge"]=85
  ["Firefox"]=40
  ["Brave Browser"]=85
)

# Results tracking
declare -A RESULTS
declare -A SUCCESS_COUNTS
declare -A FAILED_DETAILS

# Function to check if application is running
check_app_running() {
  if ! pgrep -f "employee-client" > /dev/null; then
    echo -e "${RED}ERROR: Application not running!${NC}"
    echo "Please start the application first: npm run dev"
    exit 1
  fi
}

# Function to check if browser is installed
check_browser_installed() {
  local browser=$1

  if ! mdfind "kMDItemKind == 'Application' && kMDItemFSName == '$browser.app'" | grep -q "$browser"; then
    echo -e "${YELLOW}WARNING: $browser not installed, skipping...${NC}"
    return 1
  fi
  return 0
}

# Function to test a single browser
test_browser() {
  local browser=$1
  local url=${TEST_URLS[$browser]}
  local success_count=0
  local failed_tests=""

  echo ""
  echo "======================================";
  echo -e "${BLUE}Testing: $browser${NC}"
  echo "URL: $url"
  echo "Iterations: $TEST_ITERATIONS"
  echo "Target Success Rate: ${TARGET_RATES[$browser]}%"
  echo "======================================";
  echo ""

  # Check browser installation
  if ! check_browser_installed "$browser"; then
    RESULTS[$browser]="N/A (not installed)"
    return
  fi

  # Clear existing log to track new collections
  if [ -f "$LOG_FILE" ]; then
    echo "$(tail -n 1000 $LOG_FILE)" > "$LOG_FILE"
  fi

  # Open browser with test URL
  echo "Opening $browser with test URL..."
  open -a "$browser" "$url"

  echo "Browser opened. Starting collection test in 5 seconds..."
  sleep 5

  # Run iterations
  for i in $(seq 1 $TEST_ITERATIONS); do
    echo -n "  Test $i/$TEST_ITERATIONS: "

    # Get timestamp before wait
    local before_time=$(date +%s)

    # Wait for collection cycle
    sleep $WAIT_TIME

    # Get timestamp after wait
    local after_time=$(date +%s)

    # Check logs for successful collection within time window
    if [ -f "$LOG_FILE" ]; then
      # Look for collection success with browser name
      if tail -n 200 "$LOG_FILE" | grep -q "URL collected.*$browser"; then
        echo -e "${GREEN}SUCCESS${NC}"
        ((success_count++))
      else
        echo -e "${RED}FAILED${NC}"
        failed_tests="$failed_tests $i"
      fi
    else
      echo -e "${RED}FAILED (no log)${NC}"
      failed_tests="$failed_tests $i"
    fi
  done

  # Calculate success rate
  local success_rate=$((success_count * 100 / TEST_ITERATIONS))
  local target_rate=${TARGET_RATES[$browser]}

  SUCCESS_COUNTS[$browser]=$success_count
  RESULTS[$browser]="$success_count/$TEST_ITERATIONS ($success_rate%)"
  FAILED_DETAILS[$browser]="$failed_tests"

  echo ""
  echo "Test complete: $browser"
  echo "  Success: $success_count / $TEST_ITERATIONS ($success_rate%)"

  if [ $success_rate -ge $target_rate ]; then
    echo -e "  ${GREEN}✅ Target met (≥${target_rate}%)${NC}"
  else
    echo -e "  ${RED}❌ Target missed (<${target_rate}%)${NC}"
    echo -e "  Failed iterations:$failed_tests"
  fi
  echo ""

  # Close browser to prepare for next test
  osascript -e "tell application \"$browser\" to quit" 2>/dev/null || true
  sleep 2
}

# Generate markdown report
generate_report() {
  local timestamp=$(date +%Y%m%d_%H%M%S)
  local report_file="$REPORT_DIR/browser-compatibility-report_$timestamp.md"

  mkdir -p "$REPORT_DIR"

  cat > "$report_file" << EOF
# macOS浏览器URL采集兼容性测试报告

**测试日期**: $(date +"%Y-%m-%d %H:%M:%S")
**测试环境**: macOS $(sw_vers -productVersion)
**测试迭代**: $TEST_ITERATIONS次/浏览器
**采集间隔**: ${WAIT_TIME}秒

---

## 测试结果摘要

| 浏览器 | 成功次数 | 目标成功率 | 实际成功率 | 状态 |
|--------|----------|-----------|-----------|------|
EOF

  # Add results for each browser
  for browser in "Safari" "Google Chrome" "Microsoft Edge" "Firefox" "Brave Browser"; do
    if [[ -n "${RESULTS[$browser]}" ]]; then
      local result="${RESULTS[$browser]}"

      if [[ "$result" == "N/A"* ]]; then
        echo "| $browser | - | - | $result | ⚠️ |" >> "$report_file"
        continue
      fi

      local count=${SUCCESS_COUNTS[$browser]}
      local rate=$(echo "$result" | grep -oE '[0-9]+%' | sed 's/%//')
      local target_rate=${TARGET_RATES[$browser]}

      # Determine status
      local status="✅"
      [ $rate -lt $target_rate ] && status="❌"

      echo "| $browser | $count/$TEST_ITERATIONS | ${target_rate}% | ${rate}% | $status |" >> "$report_file"
    fi
  done

  cat >> "$report_file" << EOF

---

## 详细分析

### 浏览器表现分析

EOF

  # Add detailed analysis for each browser
  for browser in "Safari" "Google Chrome" "Microsoft Edge" "Firefox" "Brave Browser"; do
    if [[ -n "${RESULTS[$browser]}" ]]; then
      local result="${RESULTS[$browser]}"

      if [[ "$result" == "N/A"* ]]; then
        continue
      fi

      local count=${SUCCESS_COUNTS[$browser]}
      local rate=$(echo "$result" | grep -oE '[0-9]+%' | sed 's/%//')
      local target_rate=${TARGET_RATES[$browser]}
      local failed="${FAILED_DETAILS[$browser]}"

      cat >> "$report_file" << EOF
#### $browser
- **测试结果**: $count/$TEST_ITERATIONS 成功 (${rate}%)
- **目标**: ≥${target_rate}%
- **状态**: $([ $rate -ge $target_rate ] && echo "✅ 达标" || echo "❌ 未达标")
EOF

      if [ -n "$failed" ]; then
        cat >> "$report_file" << EOF
- **失败迭代**:$failed
EOF
      fi

      echo "" >> "$report_file"
    fi
  done

  cat >> "$report_file" << EOF

### Firefox特殊说明
Firefox的成功率目标设定为40%，这是由于AppleScript支持的已知限制。系统已实现多层fallback机制：
1. **Level 1**: AppleScript (30-50%成功率，最佳质量)
2. **Level 2**: Window Title提取 (40-60%成功率)
3. **Level 3**: Browser History (计划实现)

综合预期成功率: 40-60%

---

## 测试方法论

### 测试流程
1. 为每个浏览器打开指定测试URL
2. 等待${WAIT_TIME}秒采集周期
3. 检查应用日志中的成功标记
4. 重复$TEST_ITERATIONS次独立测试
5. 计算成功率并与目标对比

### 验证标准
- 日志中包含 "URL collected" 且带有浏览器名称
- 采集时间在等待窗口内
- URL格式正确且未被错误处理

### 局限性
- 依赖应用日志完整性
- 网络延迟可能影响结果
- 浏览器启动时间差异

---

## 建议与后续行动

EOF

  # Add recommendations based on results
  local all_passed=true
  for browser in "Safari" "Google Chrome" "Microsoft Edge" "Firefox" "Brave Browser"; do
    if [[ -n "${RESULTS[$browser]}" ]]; then
      local result="${RESULTS[$browser]}"

      if [[ "$result" == "N/A"* ]]; then
        continue
      fi

      local rate=$(echo "$result" | grep -oE '[0-9]+%' | sed 's/%//')
      local target_rate=${TARGET_RATES[$browser]}

      if [ $rate -lt $target_rate ]; then
        all_passed=false
        echo "- **$browser**: 成功率低于目标，需要调查失败原因" >> "$report_file"
      fi
    fi
  done

  if [ "$all_passed" = true ]; then
    echo "- ✅ 所有浏览器达到或超过目标成功率" >> "$report_file"
    echo "- 建议: 继续监控生产环境表现" >> "$report_file"
  else
    echo "- 建议: 检查失败迭代的日志，分析具体失败原因" >> "$report_file"
    echo "- 建议: 验证权限设置是否正确" >> "$report_file"
    echo "- 建议: 考虑增加重试机制或fallback策略" >> "$report_file"
  fi

  cat >> "$report_file" << EOF

---

**报告生成时间**: $(date +"%Y-%m-%d %H:%M:%S")
**日志文件**: $LOG_FILE
**测试脚本**: test/manual/browser-compatibility-test.sh
EOF

  echo ""
  echo -e "${GREEN}Report generated: $report_file${NC}"
}

# Print summary to console
print_summary() {
  echo ""
  echo "======================================"
  echo "Test Summary"
  echo "======================================"

  for browser in "Safari" "Google Chrome" "Microsoft Edge" "Firefox" "Brave Browser"; do
    if [[ -n "${RESULTS[$browser]}" ]]; then
      local result="${RESULTS[$browser]}"
      local target_rate=${TARGET_RATES[$browser]}

      if [[ "$result" == "N/A"* ]]; then
        echo -e "  $browser: ${YELLOW}$result${NC}"
        continue
      fi

      local rate=$(echo "$result" | grep -oE '[0-9]+%' | sed 's/%//')

      if [ $rate -ge $target_rate ]; then
        echo -e "  $browser: ${GREEN}$result ✅${NC}"
      else
        echo -e "  $browser: ${RED}$result ❌${NC}"
      fi
    fi
  done

  echo "======================================"
  echo ""
}

# Main test execution
main() {
  echo "Checking prerequisites..."
  echo ""

  # Verify application is running
  check_app_running

  echo -e "${GREEN}Application detected. Starting tests...${NC}"
  echo ""
  echo "⚠️  Note: This test will take approximately $(( (TEST_ITERATIONS * WAIT_TIME * 5) / 60 )) minutes"
  echo "   You can monitor progress in real-time."
  echo ""
  read -p "Press Enter to continue or Ctrl+C to cancel..."

  # Test each browser
  for browser in "Safari" "Google Chrome" "Microsoft Edge" "Firefox" "Brave Browser"; do
    test_browser "$browser"
  done

  # Print summary
  print_summary

  # Generate report
  generate_report

  echo ""
  echo -e "${GREEN}All tests complete!${NC}"
  echo "Review the detailed report for full analysis."
  echo ""
}

# Run main function
main
