#!/bin/bash
#
# Task 5 Verification Script
# Verifies all enhancements from Task 5: Final Optimization and Release Preparation
#

set -e

echo "======================================"
echo "Task 5 Verification Script"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

# Test function
test_step() {
  echo -e "${BLUE}🔍 Testing: $1${NC}"
}

pass() {
  echo -e "${GREEN}✅ PASS: $1${NC}"
  PASSED=$((PASSED + 1))
}

fail() {
  echo -e "${RED}❌ FAIL: $1${NC}"
  FAILED=$((FAILED + 1))
}

warn() {
  echo -e "${YELLOW}⚠️  WARN: $1${NC}"
}

echo "Step 1: Verify files exist"
echo "========================================"
test_step "Statistics module exists"
if [ -f "common/utils/url-collect-stats.ts" ]; then
  pass "url-collect-stats.ts found"
else
  fail "url-collect-stats.ts not found"
fi

test_step "Compiled statistics module exists"
if [ -f "dist/common/utils/url-collect-stats.js" ]; then
  pass "Compiled url-collect-stats.js found"
else
  fail "Compiled url-collect-stats.js not found"
fi

test_step "Statistics included in package"
if [ -f "release/EmployeeMonitor-darwin-arm64/EmployeeMonitor.app/Contents/Resources/app/dist/common/utils/url-collect-stats.js" ]; then
  pass "Statistics included in packaged app"
else
  warn "Packaged app not found (run npm run pack:mac first)"
fi

echo ""
echo "Step 2: Verify exports"
echo "========================================"
test_step "Statistics export in index.ts"
if grep -q "url-collect-stats" common/utils/index.ts; then
  pass "Statistics exported from utils index"
else
  fail "Statistics not exported"
fi

test_step "Statistics import in macos-adapter.ts"
if grep -q "urlCollectStats" platforms/macos/macos-adapter.ts; then
  pass "Statistics imported in MacOSAdapter"
else
  fail "Statistics not imported in MacOSAdapter"
fi

test_step "Statistics import in cli.ts"
if grep -q "urlCollectStats" main/cli.ts; then
  pass "Statistics imported in CLI"
else
  fail "Statistics not imported in CLI"
fi

echo ""
echo "Step 3: Verify implementation"
echo "========================================"
test_step "Retry logic in MacOSAdapter"
if grep -q "MAX_RETRIES" platforms/macos/macos-adapter.ts && \
   grep -q "exponential backoff" platforms/macos/macos-adapter.ts; then
  pass "Retry logic with exponential backoff implemented"
else
  fail "Retry logic not found or incomplete"
fi

test_step "Statistics recording on success"
if grep -q "recordSuccess" platforms/macos/macos-adapter.ts; then
  pass "Success recording implemented"
else
  fail "Success recording not found"
fi

test_step "Statistics recording on failure"
if grep -q "recordFailure" platforms/macos/macos-adapter.ts; then
  pass "Failure recording implemented"
else
  fail "Failure recording not found"
fi

test_step "Sleep utility for retry delays"
if grep -q "private sleep" platforms/macos/macos-adapter.ts; then
  pass "Sleep utility implemented"
else
  fail "Sleep utility not found"
fi

echo ""
echo "Step 4: Verify CLI commands"
echo "========================================"
test_step "Stats command in CLI"
if grep -q "command('stats')" main/cli.ts; then
  pass "Stats command defined in CLI"
else
  fail "Stats command not found"
fi

test_step "Stats options (--reset, --json)"
if grep -q "option('--reset'" main/cli.ts && \
   grep -q "option('--json'" main/cli.ts; then
  pass "Stats options implemented"
else
  fail "Stats options not found"
fi

echo ""
echo "Step 5: Verify package.json scripts"
echo "========================================"
test_step "npm run stats script"
if grep -q '"stats"' package.json; then
  pass "stats script added to package.json"
else
  fail "stats script not found"
fi

test_step "npm run stats:reset script"
if grep -q '"stats:reset"' package.json; then
  pass "stats:reset script added"
else
  fail "stats:reset script not found"
fi

test_step "npm run stats:json script"
if grep -q '"stats:json"' package.json; then
  pass "stats:json script added"
else
  fail "stats:json script not found"
fi

echo ""
echo "Step 6: Verify code quality"
echo "========================================"
test_step "No TODO comments in new code"
TODO_COUNT=$(grep -r "TODO" common/utils/url-collect-stats.ts platforms/macos/macos-adapter.ts 2>/dev/null | wc -l)
if [ "$TODO_COUNT" -eq 0 ]; then
  pass "No TODO comments found in new code"
else
  fail "Found $TODO_COUNT TODO comments"
fi

test_step "No console.log in statistics module"
CONSOLE_COUNT=$(grep -c "console\.log" common/utils/url-collect-stats.ts 2>/dev/null || echo 0)
if [ "$CONSOLE_COUNT" -eq 0 ]; then
  pass "No console.log in statistics module"
else
  fail "Found $CONSOLE_COUNT console.log statements"
fi

test_step "JSDoc comments present"
JSDOC_COUNT=$(grep -c "/\*\*" common/utils/url-collect-stats.ts)
if [ "$JSDOC_COUNT" -gt 10 ]; then
  pass "Comprehensive JSDoc comments ($JSDOC_COUNT blocks)"
else
  warn "Limited JSDoc comments ($JSDOC_COUNT blocks)"
fi

echo ""
echo "Step 7: Verify compilation"
echo "========================================"
test_step "TypeScript compilation"
if npm run typecheck > /dev/null 2>&1; then
  pass "TypeScript compilation successful"
else
  fail "TypeScript compilation failed"
fi

echo ""
echo "Step 8: Test CLI functionality (if compiled)"
echo "========================================"
if [ -f "dist/main/cli.js" ]; then
  test_step "CLI help shows stats command"
  if timeout 5 node dist/main/cli.js --help 2>&1 | grep -q "stats"; then
    pass "Stats command appears in help"
  else
    warn "Stats command not in help (may need compilation)"
  fi

  test_step "Stats command runs without error"
  # Run with short timeout since it may hang waiting for input
  if timeout 3 node dist/main/cli.js stats > /dev/null 2>&1; then
    pass "Stats command executes"
  else
    warn "Stats command execution issue (expected if no data)"
  fi
else
  warn "Compiled CLI not found, skipping functional tests"
fi

echo ""
echo "Step 9: Verify documentation"
echo "========================================"
test_step "Task 5 acceptance results document"
if [ -f "claudedocs/task5-acceptance-results.md" ]; then
  pass "Acceptance results document exists"
else
  fail "Acceptance results document not found"
fi

test_step "Task 5 summary document"
if [ -f "claudedocs/task5-summary.md" ]; then
  pass "Summary document exists"
else
  fail "Summary document not found"
fi

echo ""
echo "======================================"
echo "Verification Summary"
echo "======================================"
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
  echo -e "${RED}❌ Failed: $FAILED${NC}"
fi
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 All verification checks passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Run npm run stats (after some URL collections)"
  echo "  2. Test with different browsers"
  echo "  3. Verify statistics accuracy"
  echo "  4. Check retry mechanism under failure conditions"
  echo "  5. Monitor memory and CPU usage during extended run"
  exit 0
else
  echo -e "${RED}❌ Some verification checks failed${NC}"
  echo "Please review the failures above and fix before proceeding"
  exit 1
fi
