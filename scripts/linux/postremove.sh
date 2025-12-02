#!/bin/bash
# Post-removal script for Employee Safety Monitor
# This script is executed after the package is removed via deb/rpm

APP_NAME="employee-safety"
UDEV_RULES="/etc/udev/rules.d/99-${APP_NAME}.rules"
LOG_DIR="/var/log/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
CONFIG_DIR="/etc/${APP_NAME}"

echo ""
echo "Cleaning up Employee Safety Monitor..."
echo ""

# Remove udev rules
if [ -f "$UDEV_RULES" ]; then
    rm -f "$UDEV_RULES"
    echo "[OK] Removed udev rules"

    # Reload udev rules
    if command -v udevadm &> /dev/null; then
        udevadm control --reload-rules 2>/dev/null || true
        echo "[OK] Reloaded udev rules"
    fi
fi

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
    echo "[OK] Updated desktop database"
fi

# Update icon cache
if command -v gtk-update-icon-cache &> /dev/null; then
    for theme_dir in /usr/share/icons/*/; do
        if [ -f "${theme_dir}index.theme" ]; then
            gtk-update-icon-cache -f -t "$theme_dir" 2>/dev/null || true
        fi
    done
    echo "[OK] Updated icon cache"
fi

# Note: We don't remove log and data directories by default
# as they may contain important user data
# Uncomment the following lines if you want to remove them

# if [ -d "$LOG_DIR" ]; then
#     rm -rf "$LOG_DIR"
#     echo "[OK] Removed log directory"
# fi

# if [ -d "$DATA_DIR" ]; then
#     rm -rf "$DATA_DIR"
#     echo "[OK] Removed data directory"
# fi

# if [ -d "$CONFIG_DIR" ]; then
#     rm -rf "$CONFIG_DIR"
#     echo "[OK] Removed config directory"
# fi

# Clean up user-specific config (in home directories)
# This is optional and commented out by default
# for user_home in /home/*; do
#     if [ -d "$user_home/.config/${APP_NAME}" ]; then
#         rm -rf "$user_home/.config/${APP_NAME}"
#     fi
# done

echo ""
echo "================================================================="
echo "  Employee Safety Monitor has been removed."
echo "================================================================="
echo ""
echo "  Note: User data and logs have been preserved in:"
echo "    - ${LOG_DIR}"
echo "    - ${DATA_DIR}"
echo ""
echo "  To completely remove all data, run:"
echo "    sudo rm -rf ${LOG_DIR} ${DATA_DIR}"
echo ""
echo "================================================================="
echo ""

exit 0
