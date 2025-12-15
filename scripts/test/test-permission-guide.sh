#!/bin/bash
#
# Permission Testing Script
# Helps verify Linux permission configuration
#

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_pass() { echo -e "  ${GREEN}[OK]${NC} $1"; }
log_fail() { echo -e "  ${RED}[X]${NC} $1"; }
log_warn() { echo -e "  ${YELLOW}[-]${NC} $1"; }
log_info() { echo -e "  ${BLUE}[i]${NC} $1"; }

echo ""
echo "================================================================"
echo "         Linux Permission Verification"
echo "================================================================"
echo ""
echo "User: $(whoami)"
echo "Home: $HOME"
echo ""

# ============================================================
# Check Platform
# ============================================================
if [ "$(uname -s)" != "Linux" ]; then
    echo -e "${RED}This script is designed for Linux only.${NC}"
    echo "Current platform: $(uname -s)"
    exit 1
fi

# ============================================================
# Check Input Group Membership
# ============================================================
echo -e "${CYAN}=== Input Group Check ===${NC}"
GROUPS=$(groups)
echo "  Current groups: $GROUPS"
echo ""

if echo "$GROUPS" | grep -qw "input"; then
    log_pass "User is in 'input' group"
else
    log_fail "User is NOT in 'input' group"
    echo ""
    echo "  To fix, run:"
    echo -e "    ${YELLOW}sudo usermod -a -G input $USER${NC}"
    echo "  Then log out and log back in"
fi
echo ""

# ============================================================
# Check /dev/input Access
# ============================================================
echo -e "${CYAN}=== Device Access Check ===${NC}"
ACCESSIBLE=0
TOTAL=0

for dev in /dev/input/event*; do
    if [ -e "$dev" ]; then
        TOTAL=$((TOTAL + 1))
        if [ -r "$dev" ]; then
            ACCESSIBLE=$((ACCESSIBLE + 1))
        fi
    fi
done

if [ $ACCESSIBLE -gt 0 ]; then
    log_pass "Can access $ACCESSIBLE/$TOTAL input devices"
else
    log_fail "Cannot access any input devices"
    echo ""
    echo "  Check udev rules and group membership"
    echo "  See 'Udev Rules' section below"
fi
echo ""

# ============================================================
# Check Display Server
# ============================================================
echo -e "${CYAN}=== Display Server Check ===${NC}"

HAS_DISPLAY=false

if [ -n "$WAYLAND_DISPLAY" ]; then
    log_pass "Wayland display: $WAYLAND_DISPLAY"
    HAS_DISPLAY=true
fi

if [ -n "$DISPLAY" ]; then
    log_pass "X11 display: $DISPLAY"
    HAS_DISPLAY=true
fi

if [ "$HAS_DISPLAY" = false ]; then
    log_fail "No display server detected"
    echo ""
    echo "  The application requires X11 or Wayland"
fi
echo ""

# ============================================================
# Check Screenshot Tools
# ============================================================
echo -e "${CYAN}=== Screenshot Tools Check ===${NC}"

SCREENSHOT_TOOLS=(scrot grim gnome-screenshot spectacle flameshot import maim)
FOUND_SCREENSHOT=false

for tool in "${SCREENSHOT_TOOLS[@]}"; do
    if which $tool > /dev/null 2>&1; then
        log_pass "$tool available"
        FOUND_SCREENSHOT=true
    else
        log_warn "$tool not found"
    fi
done

if [ "$FOUND_SCREENSHOT" = false ]; then
    echo ""
    log_fail "No screenshot tools found!"
    echo ""
    echo "  Install at least one:"
    echo "    Debian/Ubuntu: sudo apt install scrot"
    echo "    Fedora: sudo dnf install scrot"
    echo "    Arch: sudo pacman -S scrot"
fi
echo ""

# ============================================================
# Check Window Tools
# ============================================================
echo -e "${CYAN}=== Window Tools Check ===${NC}"

WINDOW_TOOLS=(xdotool xprop wmctrl)
FOUND_WINDOW=false

for tool in "${WINDOW_TOOLS[@]}"; do
    if which $tool > /dev/null 2>&1; then
        log_pass "$tool available"
        FOUND_WINDOW=true
    else
        log_warn "$tool not found"
    fi
done

if [ "$FOUND_WINDOW" = false ]; then
    echo ""
    log_warn "No window tools found (optional but recommended)"
    echo ""
    echo "  Install for better active window detection:"
    echo "    Debian/Ubuntu: sudo apt install xdotool"
    echo "    Fedora: sudo dnf install xdotool"
fi
echo ""

# ============================================================
# Check Idle Detection Tools
# ============================================================
echo -e "${CYAN}=== Idle Detection Tools Check ===${NC}"

IDLE_TOOLS=(xprintidle xssstate)
FOUND_IDLE=false

for tool in "${IDLE_TOOLS[@]}"; do
    if which $tool > /dev/null 2>&1; then
        log_pass "$tool available"
        FOUND_IDLE=true
    else
        log_warn "$tool not found"
    fi
done

if [ "$FOUND_IDLE" = false ]; then
    echo ""
    log_warn "No idle detection tools found (optional)"
    echo ""
    echo "  Install for user idle time detection:"
    echo "    Debian/Ubuntu: sudo apt install xprintidle"
fi
echo ""

# ============================================================
# Check DBus for Wayland Portal
# ============================================================
echo -e "${CYAN}=== DBus/Portal Check ===${NC}"

if which dbus-send > /dev/null 2>&1; then
    log_pass "dbus-send available"

    # Check for screenshot portal
    if dbus-send --session --print-reply --dest=org.freedesktop.portal.Desktop \
        /org/freedesktop/portal/desktop org.freedesktop.DBus.Properties.Get \
        string:org.freedesktop.portal.Screenshot string:version > /dev/null 2>&1; then
        log_pass "Screenshot portal available"
    else
        log_warn "Screenshot portal not available (Wayland-specific)"
    fi
else
    log_warn "dbus-send not available"
fi
echo ""

# ============================================================
# Udev Rules
# ============================================================
echo -e "${CYAN}=== Udev Rules ===${NC}"

UDEV_RULE_FILE="/etc/udev/rules.d/99-input-access.rules"

if [ -f "$UDEV_RULE_FILE" ]; then
    log_pass "Custom udev rules file exists"
    echo ""
    echo "  Contents:"
    cat "$UDEV_RULE_FILE" | sed 's/^/    /'
else
    log_warn "No custom udev rules file found"
    echo ""
    echo "  To create udev rules for input access, run:"
    echo ""
    echo -e "    ${YELLOW}sudo tee $UDEV_RULE_FILE << 'EOF'${NC}"
    echo '    # Allow input group access to input devices'
    echo '    SUBSYSTEM=="input", GROUP="input", MODE="0660"'
    echo '    KERNEL=="event*", SUBSYSTEM=="input", GROUP="input", MODE="0660"'
    echo '    EOF'
    echo ""
    echo "    sudo udevadm control --reload-rules"
    echo "    sudo udevadm trigger"
fi
echo ""

# ============================================================
# Summary
# ============================================================
echo "================================================================"
echo "                    Summary"
echo "================================================================"
echo ""

# Calculate status
STATUS="minimal"
ISSUES=()

if ! echo "$GROUPS" | grep -qw "input"; then
    ISSUES+=("Not in input group")
fi

if [ $ACCESSIBLE -eq 0 ]; then
    ISSUES+=("No /dev/input access")
fi

if [ "$HAS_DISPLAY" = false ]; then
    ISSUES+=("No display server")
fi

if [ "$FOUND_SCREENSHOT" = false ]; then
    ISSUES+=("No screenshot tool")
fi

if [ ${#ISSUES[@]} -eq 0 ]; then
    STATUS="full"
    echo -e "  Status: ${GREEN}FULL${NC} - All permissions configured correctly"
elif [ ${#ISSUES[@]} -le 2 ]; then
    STATUS="partial"
    echo -e "  Status: ${YELLOW}PARTIAL${NC} - Some features may be limited"
else
    echo -e "  Status: ${RED}MINIMAL${NC} - Several issues need to be addressed"
fi

if [ ${#ISSUES[@]} -gt 0 ]; then
    echo ""
    echo "  Issues found:"
    for issue in "${ISSUES[@]}"; do
        echo -e "    ${RED}-${NC} $issue"
    done
fi

echo ""
echo "================================================================"
echo ""

# Exit with status code based on issues
if [ ${#ISSUES[@]} -eq 0 ]; then
    exit 0
elif [ ${#ISSUES[@]} -le 2 ]; then
    exit 0  # Partial is still OK
else
    exit 1
fi
