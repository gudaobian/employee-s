#!/bin/bash
# Privacy Protection Test Script
# Verifies URL sanitization and sensitive data redaction

set -e

echo "======================================"
echo "Privacy Protection Test Suite"
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
LOG_FILE="logs/app.log"
REPORT_DIR="doc/test-reports"
WAIT_TIME=70  # seconds for collection

# Test cases with expected behavior
declare -A PRIVACY_TESTS=(
  ["Query Parameter Stripping"]="https://example.com?token=abc123&page=1&api_key=secret"
  ["Sensitive Domain Redaction"]="https://mail.google.com/inbox/123"
  ["Banking Domain Protection"]="https://www.chase.com/accounts/12345"
  ["Healthcare Domain Protection"]="https://patient.healthcare.com/records"
  ["API Key Pattern Detection"]="https://api.example.com?apiKey=sk_test_12345"
  ["Password Pattern Detection"]="https://example.com?password=secret123"
  ["Token Pattern Detection"]="https://example.com?access_token=eyJhbGciOiJ"
  ["Credit Card Pattern"]="https://example.com?card=4532123456789012"
  ["Fragment Removal"]="https://example.com/path#section-with-data"
  ["Session ID Removal"]="https://example.com?sessionid=abc123&PHPSESSID=xyz789"
)

# Expected results for each test
declare -A EXPECTED_RESULTS=(
  ["Query Parameter Stripping"]="example.com"
  ["Sensitive Domain Redaction"]="REDACTED"
  ["Banking Domain Protection"]="REDACTED"
  ["Healthcare Domain Protection"]="REDACTED"
  ["API Key Pattern Detection"]="api.example.com"
  ["Password Pattern Detection"]="example.com"
  ["Token Pattern Detection"]="example.com"
  ["Credit Card Pattern"]="example.com"
  ["Fragment Removal"]="example.com/path"
  ["Session ID Removal"]="example.com"
)

# Test results
declare -A TEST_RESULTS
declare -A ACTUAL_OUTPUTS

# Function to check if application is running
check_app_running() {
  if ! pgrep -f "employee-client" > /dev/null; then
    echo -e "${RED}ERROR: Application not running!${NC}"
    echo "Please start the application first: npm run dev"
    exit 1
  fi
}

# Function to test privacy protection
test_privacy_case() {
  local test_name=$1
  local url=$2
  local expected="${EXPECTED_RESULTS[$test_name]}"

  echo ""
  echo "======================================";
  echo -e "${BLUE}Test: $test_name${NC}"
  echo "URL: $url"
  echo "Expected: $expected"
  echo "======================================";
  echo ""

  # Mark log position before test
  local log_size_before=0
  if [ -f "$LOG_FILE" ]; then
    log_size_before=$(wc -l < "$LOG_FILE")
  fi

  # Open URL in Safari
  echo "Opening Safari with test URL..."
  open -a Safari "$url"

  echo "Waiting ${WAIT_TIME} seconds for collection..."
  sleep $WAIT_TIME

  # Check log for collection and sanitization
  if [ -f "$LOG_FILE" ]; then
    # Get new log lines since test started
    local new_logs=$(tail -n +$((log_size_before + 1)) "$LOG_FILE")

    # Check if URL was collected
    if echo "$new_logs" | grep -q "URL collected"; then
      echo -e "${GREEN}✓ URL collection detected${NC}"

      # Extract collected URL from logs
      local collected_url=$(echo "$new_logs" | grep "URL collected" | tail -1 | grep -oE "https?://[^ ]+" | head -1)

      if [ -n "$collected_url" ]; then
        echo "Collected URL: $collected_url"
        ACTUAL_OUTPUTS[$test_name]="$collected_url"

        # Verify expected behavior
        case $test_name in
          *"Redaction"*|*"Protection"*)
            if echo "$collected_url" | grep -q "REDACTED"; then
              echo -e "${GREEN}✅ PASS: Sensitive domain redacted${NC}"
              TEST_RESULTS[$test_name]="PASS"
            else
              echo -e "${RED}❌ FAIL: Domain not redacted${NC}"
              TEST_RESULTS[$test_name]="FAIL"
            fi
            ;;

          *"Stripping"*|*"Removal"*|*"Detection"*)
            # Check that sensitive patterns are removed
            if echo "$collected_url" | grep -qE "(token|api_?key|password|sessionid|PHPSESSID|card=|#)"; then
              echo -e "${RED}❌ FAIL: Sensitive data still present${NC}"
              TEST_RESULTS[$test_name]="FAIL"
            else
              echo -e "${GREEN}✅ PASS: Sensitive data removed${NC}"
              TEST_RESULTS[$test_name]="PASS"
            fi
            ;;

          *)
            echo -e "${YELLOW}⚠️  Manual verification required${NC}"
            TEST_RESULTS[$test_name]="MANUAL"
            ;;
        esac
      else
        echo -e "${YELLOW}⚠️  Could not extract URL from logs${NC}"
        TEST_RESULTS[$test_name]="UNKNOWN"
        ACTUAL_OUTPUTS[$test_name]="N/A"
      fi
    else
      echo -e "${RED}❌ FAIL: No URL collection detected${NC}"
      TEST_RESULTS[$test_name]="FAIL"
      ACTUAL_OUTPUTS[$test_name]="Not collected"
    fi
  else
    echo -e "${RED}❌ ERROR: Log file not found${NC}"
    TEST_RESULTS[$test_name]="ERROR"
    ACTUAL_OUTPUTS[$test_name]="No logs"
  fi

  echo ""
}

# Generate markdown report
generate_report() {
  local timestamp=$(date +%Y%m%d_%H%M%S)
  local report_file="$REPORT_DIR/privacy-protection-report_$timestamp.md"

  mkdir -p "$REPORT_DIR"

  cat > "$report_file" << EOF
# macOS URL采集隐私保护测试报告

**测试日期**: $(date +"%Y-%m-%d %H:%M:%S")
**测试环境**: macOS $(sw_vers -productVersion)
**测试案例数**: ${#PRIVACY_TESTS[@]}

---

## 测试结果摘要

| 测试案例 | 输入URL | 预期结果 | 实际输出 | 状态 |
|----------|---------|----------|----------|------|
EOF

  # Count results
  local pass_count=0
  local fail_count=0
  local manual_count=0

  # Add results for each test
  for test_name in "${!PRIVACY_TESTS[@]}"; do
    local url="${PRIVACY_TESTS[$test_name]}"
    local expected="${EXPECTED_RESULTS[$test_name]}"
    local actual="${ACTUAL_OUTPUTS[$test_name]}"
    local result="${TEST_RESULTS[$test_name]}"

    # Truncate long URLs for table
    local url_display="$url"
    if [ ${#url_display} -gt 50 ]; then
      url_display="${url_display:0:47}..."
    fi

    local actual_display="$actual"
    if [ ${#actual_display} -gt 50 ]; then
      actual_display="${actual_display:0:47}..."
    fi

    local status_emoji=""
    case $result in
      "PASS")
        status_emoji="✅"
        ((pass_count++))
        ;;
      "FAIL")
        status_emoji="❌"
        ((fail_count++))
        ;;
      "MANUAL")
        status_emoji="⚠️"
        ((manual_count++))
        ;;
      *)
        status_emoji="❓"
        ;;
    esac

    echo "| $test_name | \`${url_display}\` | \`${expected}\` | \`${actual_display}\` | ${status_emoji} $result |" >> "$report_file"
  done

  cat >> "$report_file" << EOF

### 统计
- **通过**: $pass_count
- **失败**: $fail_count
- **需人工验证**: $manual_count
- **总计**: ${#PRIVACY_TESTS[@]}

---

## 详细分析

### 隐私保护机制验证

#### 1. 查询参数过滤
系统应自动移除敏感查询参数，同时保留白名单参数（如 page, lang, tab）。

**测试结果**:
EOF

  # Add detailed analysis
  for test_name in "${!PRIVACY_TESTS[@]}"; do
    if [[ "$test_name" =~ "Parameter"|"Detection"|"Removal" ]]; then
      local result="${TEST_RESULTS[$test_name]}"
      local actual="${ACTUAL_OUTPUTS[$test_name]}"

      echo "- **$test_name**: $result" >> "$report_file"
      echo "  - 输出: \`$actual\`" >> "$report_file"
    fi
  done

  cat >> "$report_file" << EOF

#### 2. 敏感域名保护
系统应对金融、医疗、邮件等敏感域名进行REDACTED处理。

**测试结果**:
EOF

  for test_name in "${!PRIVACY_TESTS[@]}"; do
    if [[ "$test_name" =~ "Redaction"|"Protection" ]]; then
      local result="${TEST_RESULTS[$test_name]}"
      local actual="${ACTUAL_OUTPUTS[$test_name]}"

      echo "- **$test_name**: $result" >> "$report_file"
      echo "  - 输出: \`$actual\`" >> "$report_file"
    fi
  done

  cat >> "$report_file" << EOF

#### 3. 模式匹配检测
系统应检测并移除符合敏感模式的内容（API密钥、令牌、信用卡等）。

**隐私配置**:
- 查询参数白名单: page, lang, tab, view, sort, filter
- 敏感模式检测: token, api_key, password, secret, sessionid
- 特殊模式: 信用卡号(13-19位)、令牌前缀(sk_, pk_)

---

## 建议与改进

EOF

  # Add recommendations based on results
  if [ $fail_count -gt 0 ]; then
    echo "### 失败案例分析" >> "$report_file"
    echo "" >> "$report_file"

    for test_name in "${!TEST_RESULTS[@]}"; do
      if [ "${TEST_RESULTS[$test_name]}" = "FAIL" ]; then
        echo "- **$test_name**: 需要检查隐私配置和过滤规则" >> "$report_file"
      fi
    done
    echo "" >> "$report_file"
  fi

  if [ $manual_count -gt 0 ]; then
    echo "### 需人工验证项" >> "$report_file"
    echo "" >> "$report_file"

    for test_name in "${!TEST_RESULTS[@]}"; do
      if [ "${TEST_RESULTS[$test_name]}" = "MANUAL" ]; then
        echo "- **$test_name**: 请人工检查日志确认处理正确性" >> "$report_file"
      fi
    done
    echo "" >> "$report_file"
  fi

  if [ $pass_count -eq ${#PRIVACY_TESTS[@]} ]; then
    echo "✅ **所有测试通过**，隐私保护机制运行正常" >> "$report_file"
  else
    echo "建议:" >> "$report_file"
    echo "1. 检查 \`common/config/privacy-config.ts\` 配置" >> "$report_file"
    echo "2. 验证 \`common/utils/privacy-helper.ts\` 实现" >> "$report_file"
    echo "3. 审查应用日志中的URL处理流程" >> "$report_file"
  fi

  cat >> "$report_file" << EOF

---

## 测试方法

### 测试流程
1. 在Safari中打开包含敏感信息的测试URL
2. 等待${WAIT_TIME}秒采集周期
3. 检查日志中的URL格式
4. 验证敏感信息是否被正确处理

### 验证标准
- 敏感域名被替换为 "REDACTED"
- 非白名单查询参数被移除
- URL fragment (#) 被移除
- 匹配敏感模式的内容被过滤

---

**报告生成时间**: $(date +"%Y-%m-%d %H:%M:%S")
**日志文件**: $LOG_FILE
**测试脚本**: test/manual/privacy-protection-test.sh
**隐私配置**: common/config/privacy-config.ts
EOF

  echo ""
  echo -e "${GREEN}Report generated: $report_file${NC}"
}

# Print summary to console
print_summary() {
  echo ""
  echo "======================================"
  echo "Privacy Test Summary"
  echo "======================================"

  local pass_count=0
  local fail_count=0

  for test_name in "${!TEST_RESULTS[@]}"; do
    local result="${TEST_RESULTS[$test_name]}"

    case $result in
      "PASS")
        echo -e "  ${GREEN}✅${NC} $test_name"
        ((pass_count++))
        ;;
      "FAIL")
        echo -e "  ${RED}❌${NC} $test_name"
        ((fail_count++))
        ;;
      "MANUAL")
        echo -e "  ${YELLOW}⚠️${NC}  $test_name (manual verification)"
        ;;
      *)
        echo -e "  ${YELLOW}❓${NC} $test_name (unknown)"
        ;;
    esac
  done

  echo ""
  echo "Total: $pass_count passed, $fail_count failed"
  echo "======================================"
  echo ""
}

# Main test execution
main() {
  echo "Checking prerequisites..."
  echo ""

  # Verify application is running
  check_app_running

  echo -e "${GREEN}Application detected. Starting privacy tests...${NC}"
  echo ""
  echo "⚠️  Note: This test will take approximately $(( (${#PRIVACY_TESTS[@]} * WAIT_TIME) / 60 )) minutes"
  echo "   Each test opens Safari with a different URL pattern."
  echo ""
  read -p "Press Enter to continue or Ctrl+C to cancel..."

  # Test each privacy case
  for test_name in "${!PRIVACY_TESTS[@]}"; do
    test_privacy_case "$test_name" "${PRIVACY_TESTS[$test_name]}"
  done

  # Print summary
  print_summary

  # Generate report
  generate_report

  echo ""
  echo -e "${GREEN}All privacy tests complete!${NC}"
  echo "Review the detailed report for full analysis."
  echo "Check logs manually for edge cases: $LOG_FILE"
  echo ""
}

# Run main function
main
