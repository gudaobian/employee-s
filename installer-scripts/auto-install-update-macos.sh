#!/bin/bash

# Auto Install Update Script for macOS
# Bypasses Squirrel.Mac signature validation by manual installation

set -e  # Exit on error

UPDATE_ZIP="$1"
APP_NAME="EmployeeSafety.app"
INSTALL_DIR="/Applications"
TEMP_DIR=$(mktemp -d)

echo "======================================"
echo "  Auto Update Installation"
echo "======================================"
echo ""

# Validate input
if [ -z "$UPDATE_ZIP" ] || [ ! -f "$UPDATE_ZIP" ]; then
    echo "❌ Error: Update zip file not found: $UPDATE_ZIP"
    exit 1
fi

echo "📦 Update file: $UPDATE_ZIP"
echo "📂 Temp directory: $TEMP_DIR"
echo ""

# Step 1: Extract update
echo "1️⃣  Extracting update..."
unzip -q "$UPDATE_ZIP" -d "$TEMP_DIR"
if [ ! -d "$TEMP_DIR/$APP_NAME" ]; then
    echo "❌ Error: $APP_NAME not found in zip"
    rm -rf "$TEMP_DIR"
    exit 1
fi
echo "   ✅ Extracted"
echo ""

# Step 2: Remove quarantine attributes
echo "2️⃣  Removing quarantine attributes..."
xattr -cr "$TEMP_DIR/$APP_NAME"
echo "   ✅ Quarantine removed"
echo ""

# Step 3: Self-sign the app
echo "3️⃣  Signing application..."
codesign --force --deep --sign - "$TEMP_DIR/$APP_NAME" 2>&1 | grep -v "bundle format is ambiguous" || true
echo "   ✅ Signed"
echo ""

# Step 4: Stop running app
echo "4️⃣  Stopping running application..."
killall -9 EmployeeSafety 2>/dev/null || true
sleep 2
echo "   ✅ Application stopped"
echo ""

# Step 5: Replace application
echo "5️⃣  Installing update..."
if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
    echo "   ⚠️  Removing old version..."
    rm -rf "$INSTALL_DIR/$APP_NAME"
fi
cp -R "$TEMP_DIR/$APP_NAME" "$INSTALL_DIR/"
echo "   ✅ Update installed"
echo ""

# Step 6: Cleanup
echo "6️⃣  Cleaning up..."
rm -rf "$TEMP_DIR"
echo "   ✅ Cleanup complete"
echo ""

# Step 7: Restart application
echo "7️⃣  Restarting application..."
sleep 1
open "$INSTALL_DIR/$APP_NAME"
echo "   ✅ Application restarted"
echo ""

echo "======================================"
echo "  ✅ Update installed successfully!"
echo "======================================"
echo ""

exit 0
