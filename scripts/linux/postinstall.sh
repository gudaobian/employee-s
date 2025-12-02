#!/bin/bash
# Post-installation script for Employee Safety Monitor
# This script is executed after the package is installed via deb/rpm

set -e

APP_NAME="employee-safety"
APP_PATH="/opt/${APP_NAME}"
DESKTOP_FILE="/usr/share/applications/${APP_NAME}.desktop"
UDEV_RULES="/etc/udev/rules.d/99-${APP_NAME}.rules"

echo ""
echo "Setting up Employee Safety Monitor..."
echo ""

# Set correct permissions for the executable
if [ -f "${APP_PATH}/${APP_NAME}" ]; then
    chmod +x "${APP_PATH}/${APP_NAME}"
    echo "[OK] Set executable permissions"
fi

# Create udev rules for input device access
# This allows the application to monitor input events without root privileges
echo "Creating udev rules for input device access..."
cat > "$UDEV_RULES" << 'EOF'
# Employee Safety Monitor - Input device access rules
# Allows members of the 'input' group to read input events

# Keyboard events
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_KEYBOARD}=="1", GROUP="input", MODE="0660"

# Mouse events
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_MOUSE}=="1", GROUP="input", MODE="0660"
SUBSYSTEM=="input", KERNEL=="mouse[0-9]*", GROUP="input", MODE="0660"

# General input devices (fallback)
SUBSYSTEM=="input", GROUP="input", MODE="0660"
KERNEL=="event[0-9]*", SUBSYSTEM=="input", GROUP="input", MODE="0660"

# uinput device for synthetic input events (if needed)
KERNEL=="uinput", GROUP="input", MODE="0660"
EOF

echo "[OK] Created udev rules at $UDEV_RULES"

# Reload udev rules
if command -v udevadm &> /dev/null; then
    udevadm control --reload-rules 2>/dev/null || true
    udevadm trigger 2>/dev/null || true
    echo "[OK] Reloaded udev rules"
fi

# Update desktop database for application menu integration
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
    echo "[OK] Updated desktop database"
fi

# Update icon cache for proper icon display
if command -v gtk-update-icon-cache &> /dev/null; then
    for theme_dir in /usr/share/icons/*/; do
        if [ -f "${theme_dir}index.theme" ]; then
            gtk-update-icon-cache -f -t "$theme_dir" 2>/dev/null || true
        fi
    done
    echo "[OK] Updated icon cache"
fi

# Create log directory with appropriate permissions
LOG_DIR="/var/log/${APP_NAME}"
if [ ! -d "$LOG_DIR" ]; then
    mkdir -p "$LOG_DIR"
    chmod 755 "$LOG_DIR"
    echo "[OK] Created log directory at $LOG_DIR"
fi

# Create data directory in /var/lib for application data
DATA_DIR="/var/lib/${APP_NAME}"
if [ ! -d "$DATA_DIR" ]; then
    mkdir -p "$DATA_DIR"
    chmod 755 "$DATA_DIR"
    echo "[OK] Created data directory at $DATA_DIR"
fi

# Print success message and next steps
echo ""
echo "================================================================="
echo "  Employee Safety Monitor installed successfully!"
echo "================================================================="
echo ""
echo "  IMPORTANT: For input monitoring to work without root access,"
echo "  you need to add your user to the 'input' group:"
echo ""
echo "    sudo usermod -a -G input \$USER"
echo ""
echo "  Then log out and log back in for changes to take effect."
echo ""
echo "  Alternatively, you can run the application with sudo, but"
echo "  this is not recommended for regular use."
echo ""
echo "  To start the application:"
echo "    - Find 'Employee Safety' in your application menu, or"
echo "    - Run: ${APP_PATH}/${APP_NAME}"
echo ""
echo "================================================================="
echo ""

exit 0
