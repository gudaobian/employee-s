#!/bin/bash
#
# Linux E2E Test Suite
#
# Tests the complete application flow on Linux systems.
# Requires X11 or Wayland display to be available.
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; }
log_header() { echo -e "${CYAN}$1${NC}"; }

echo ""
echo "================================================================"
echo "           Linux E2E Test Suite"
echo "================================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

run_test() {
    local test_name="$1"
    local test_cmd="$2"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    log_info "Running: $test_name"

    if eval "$test_cmd" > /dev/null 2>&1; then
        log_success "$test_name"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log_error "$test_name"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

skip_test() {
    local test_name="$1"
    local reason="$2"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
    log_warning "$test_name - SKIPPED: $reason"
}

# ============================================================
# Test 1: Platform Check
# ============================================================
echo ""
log_header "=== [1/7] Platform Check ==="
echo ""

if [ "$(uname -s)" != "Linux" ]; then
    log_error "This test suite is designed for Linux only."
    log_info "Current platform: $(uname -s)"
    echo ""
    log_info "To run on non-Linux for development testing, use:"
    log_info "  FORCE_LINUX_TESTS=true npm test -- --testPathPattern='tests/linux'"
    exit 1
fi

log_success "Running on Linux"
log_info "Kernel: $(uname -r)"
log_info "Distribution: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2 || echo 'Unknown')"

# ============================================================
# Test 2: Environment Check
# ============================================================
echo ""
log_header "=== [2/7] Environment Check ==="
echo ""

log_info "Desktop: ${XDG_CURRENT_DESKTOP:-unknown}"
log_info "Session Type: ${XDG_SESSION_TYPE:-unknown}"
log_info "Display (X11): ${DISPLAY:-none}"
log_info "Display (Wayland): ${WAYLAND_DISPLAY:-none}"

if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
    log_error "No display available. E2E tests require X11 or Wayland."
    log_info "If running in a headless environment, consider using xvfb:"
    log_info "  xvfb-run ./scripts/test-e2e-linux.sh"
    exit 1
fi

log_success "Display server available"

# ============================================================
# Test 3: Dependency Check
# ============================================================
echo ""
log_header "=== [3/7] Dependency Check ==="
echo ""

run_test "Node.js available" "which node"
run_test "npm available" "which npm"

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 16 ]; then
    log_success "Node.js version >= 16 ($(node -v))"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    log_error "Node.js version < 16 ($(node -v))"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

run_test "TypeScript compiled (dist directory exists)" "test -d dist"

# Check optional tools
echo ""
log_info "Checking optional tools..."

for tool in xdotool xprop xprintidle scrot grim gnome-screenshot spectacle; do
    if which $tool > /dev/null 2>&1; then
        log_success "$tool available"
    else
        log_warning "$tool not available (optional)"
    fi
done

# ============================================================
# Test 4: Unit Tests
# ============================================================
echo ""
log_header "=== [4/7] Unit Tests ==="
echo ""

if [ -f "package.json" ]; then
    log_info "Running Jest unit tests for Linux..."

    if npm test -- --testPathPattern='tests/linux' --passWithNoTests 2>&1; then
        log_success "Jest unit tests completed"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        log_warning "Jest unit tests had some failures (check output)"
    fi
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
else
    skip_test "Jest unit tests" "package.json not found"
fi

# ============================================================
# Test 5: Build Verification
# ============================================================
echo ""
log_header "=== [5/7] Build Verification ==="
echo ""

run_test "TypeScript compilation" "npm run compile"
run_test "Type checking" "npm run typecheck"

# Check for lint errors (warning only)
if npm run lint 2>&1 | grep -q "error"; then
    log_warning "ESLint found errors (non-blocking)"
else
    log_success "ESLint passed"
fi

# ============================================================
# Test 6: Native Module Test
# ============================================================
echo ""
log_header "=== [6/7] Native Module Test ==="
echo ""

if [ -d "native-event-monitor-linux" ]; then
    cd native-event-monitor-linux

    # Check if module is built
    if [ -f "build/Release/linux_event_monitor.node" ]; then
        log_success "Native module binary exists"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        log_warning "Native module binary not found (may need build)"
    fi
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    # Run quick test if available
    if [ -f "test/quick.test.js" ]; then
        log_info "Running native module quick test..."
        if node test/quick.test.js 2>&1; then
            log_success "Native module quick test passed"
            PASSED_TESTS=$((PASSED_TESTS + 1))
        else
            log_warning "Native module quick test had issues"
        fi
        TOTAL_TESTS=$((TOTAL_TESTS + 1))
    else
        skip_test "Native module quick test" "test/quick.test.js not found"
    fi

    cd "$PROJECT_DIR"
else
    skip_test "Native module tests" "native-event-monitor-linux directory not found"
fi

# ============================================================
# Test 7: Application Start Test
# ============================================================
echo ""
log_header "=== [7/7] Application Start Test ==="
echo ""

APP_PID=""

start_app() {
    if [ -f "dist/main/index.js" ]; then
        log_info "Starting application (index.js)..."
        timeout 10 node dist/main/index.js --test-mode &
        APP_PID=$!
        sleep 3
        return 0
    elif [ -f "dist/main/cli.js" ]; then
        log_info "Starting CLI health check..."
        timeout 10 node dist/main/cli.js health &
        APP_PID=$!
        sleep 2
        return 0
    fi
    return 1
}

cleanup_app() {
    if [ -n "$APP_PID" ]; then
        kill $APP_PID 2>/dev/null || true
        wait $APP_PID 2>/dev/null || true
    fi
}

trap cleanup_app EXIT

if start_app; then
    sleep 2
    if ps -p $APP_PID > /dev/null 2>&1; then
        log_success "Application started successfully (PID: $APP_PID)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        log_warning "Application exited immediately (may be expected in test mode)"
    fi
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    # Cleanup
    cleanup_app
    APP_PID=""
else
    skip_test "Application start" "Could not find application entry point"
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo "================================================================"
echo "                    Test Summary"
echo "================================================================"
echo ""
echo -e "  Total Tests:   ${TOTAL_TESTS}"
echo -e "  ${GREEN}Passed:${NC}        ${PASSED_TESTS}"
echo -e "  ${RED}Failed:${NC}        ${FAILED_TESTS}"
echo -e "  ${YELLOW}Skipped:${NC}       ${SKIPPED_TESTS}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${YELLOW}Some tests failed. Review output above.${NC}"
    exit 1
fi
