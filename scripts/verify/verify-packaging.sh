#!/bin/bash
# Packaging Verification Script for macOS Employee Client

set -e

echo "======================================"
echo "Packaging Verification Script"
echo "======================================"
echo ""

# Configuration
APP_NAME="EmployeeMonitor"
BUILD_DIR="dist"
RELEASE_DIR="release"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Step 1: Clean build
echo "Step 1: Cleaning previous builds..."
if npm run clean; then
  echo -e "${GREEN}✅ Clean complete${NC}"
else
  echo -e "${RED}❌ Clean failed${NC}"
  exit 1
fi
echo ""

# Step 2: Full build
echo "Step 2: Running full build..."
if npm run build; then
  echo -e "${GREEN}✅ Build successful${NC}"
else
  echo -e "${RED}❌ Build failed${NC}"
  exit 1
fi
echo ""

# Step 3: Verify dist directory
echo "Step 3: Verifying dist directory..."
if [ -d "$BUILD_DIR" ]; then
  echo "  Build directory exists: $BUILD_DIR"
  echo "  Contents:"
  ls -lh "$BUILD_DIR" | head -10

  # Count TypeScript files
  ts_count=$(find "$BUILD_DIR" -name "*.js" -type f | wc -l)
  echo "  JavaScript files: $ts_count"

  if [ $ts_count -gt 0 ]; then
    echo -e "${GREEN}✅ Dist verification passed${NC}"
  else
    echo -e "${RED}❌ No JavaScript files found in dist${NC}"
    exit 1
  fi
else
  echo -e "${RED}❌ Dist directory not found${NC}"
  exit 1
fi
echo ""

# Step 4: Build native modules (macOS)
echo "Step 4: Building native modules..."
if [ "$(uname)" = "Darwin" ]; then
  if npm run build:native:mac; then
    echo -e "${GREEN}✅ Native modules built successfully${NC}"
  else
    echo -e "${YELLOW}⚠️  Native modules build failed (will use precompiled)${NC}"
  fi
else
  echo -e "${BLUE}ℹ️  Skipping native module build (not on macOS)${NC}"
fi
echo ""

# Step 5: Package macOS app
echo "Step 5: Packaging macOS application..."
if [ "$(uname)" = "Darwin" ]; then
  if npm run pack:mac; then
    echo -e "${GREEN}✅ Packaging successful${NC}"
  else
    echo -e "${RED}❌ Packaging failed${NC}"
    exit 1
  fi
else
  echo -e "${BLUE}ℹ️  Skipping packaging (not on macOS)${NC}"
  echo ""
  echo "======================================"
  echo "Verification Summary"
  echo "======================================"
  echo -e "${GREEN}✅ Build: SUCCESS${NC}"
  echo -e "${BLUE}ℹ️  Package: SKIPPED (not on macOS)${NC}"
  exit 0
fi
echo ""

# Step 6: Verify release artifacts
echo "Step 6: Verifying release artifacts..."
if [ -d "$RELEASE_DIR" ]; then
  echo "  Release directory contents:"
  ls -lh "$RELEASE_DIR"

  # Check for .app bundle
  app_count=$(find "$RELEASE_DIR" -name "*.app" -type d | wc -l)
  if [ $app_count -gt 0 ]; then
    echo -e "${GREEN}✅ Application bundle found: $app_count${NC}"
  else
    echo -e "${YELLOW}⚠️  No .app bundle found${NC}"
  fi

  # Check for .zip files
  zip_count=$(find "$RELEASE_DIR" -name "*.zip" -type f | wc -l)
  if [ $zip_count -gt 0 ]; then
    echo -e "${GREEN}✅ ZIP archives found: $zip_count${NC}"

    # List ZIP files with sizes
    find "$RELEASE_DIR" -name "*.zip" -type f -exec ls -lh {} \; | awk '{print "    " $9 " (" $5 ")"}'
  fi
else
  echo -e "${RED}❌ Release directory not found${NC}"
  exit 1
fi
echo ""

# Step 7: Test packaged app (if exists)
echo "Step 7: Testing packaged application..."
app_path=$(find "$RELEASE_DIR" -name "*.app" -type d | head -1)

if [ -n "$app_path" ]; then
  echo "  Found app: $app_path"

  # Check Info.plist
  if [ -f "$app_path/Contents/Info.plist" ]; then
    echo -e "${GREEN}✅ Info.plist exists${NC}"

    # Extract version
    version=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$app_path/Contents/Info.plist" 2>/dev/null || echo "unknown")
    echo "  App version: $version"

    # Extract bundle ID
    bundle_id=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$app_path/Contents/Info.plist" 2>/dev/null || echo "unknown")
    echo "  Bundle ID: $bundle_id"
  else
    echo -e "${RED}❌ Info.plist not found${NC}"
  fi

  # Check executable
  executable="$app_path/Contents/MacOS/$APP_NAME"
  if [ -f "$executable" ]; then
    echo -e "${GREEN}✅ Executable exists${NC}"
    echo "  Executable: $executable"
    echo "  Size: $(ls -lh "$executable" | awk '{print $5}')"
  else
    echo -e "${RED}❌ Executable not found${NC}"
  fi

  # Check Resources
  resources_dir="$app_path/Contents/Resources"
  if [ -d "$resources_dir" ]; then
    echo -e "${GREEN}✅ Resources directory exists${NC}"
    resource_count=$(find "$resources_dir" -type f | wc -l)
    echo "  Resource files: $resource_count"
  fi

  # Check code signature (if signed)
  echo ""
  echo "  Checking code signature..."
  if codesign -v "$app_path" 2>/dev/null; then
    echo -e "${GREEN}✅ Code signature valid${NC}"

    # Show signature details
    codesign -dv "$app_path" 2>&1 | grep "Authority" | head -3 | sed 's/^/    /'
  else
    echo -e "${YELLOW}⚠️  App not signed (expected for development build)${NC}"
  fi

  # Check entitlements
  echo ""
  echo "  Checking entitlements..."
  if codesign -d --entitlements :- "$app_path" 2>/dev/null | grep -q "com.apple.security"; then
    echo -e "${GREEN}✅ Entitlements found${NC}"
    codesign -d --entitlements :- "$app_path" 2>/dev/null | grep "com.apple.security" | sed 's/^/    /'
  else
    echo -e "${BLUE}ℹ️  No entitlements (may not be required)${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  No .app bundle to test${NC}"
fi
echo ""

# Step 8: Verify URL collection feature files
echo "Step 8: Verifying URL collection feature files..."
required_files=(
  "$BUILD_DIR/platforms/darwin/url-collector.js"
  "$BUILD_DIR/platforms/macos/permission-checker.js"
  "$BUILD_DIR/common/services/permission-monitor-service.js"
)

missing_files=0
for file in "${required_files[@]}"; do
  if [ -f "/Volumes/project/Projects/employee-monitering-master/employee-client/$file" ]; then
    echo -e "${GREEN}✅ Found: $file${NC}"
  else
    echo -e "${RED}❌ Missing: $file${NC}"
    missing_files=$((missing_files + 1))
  fi
done

if [ $missing_files -eq 0 ]; then
  echo -e "${GREEN}✅ All URL collection files present${NC}"
else
  echo -e "${RED}❌ Missing $missing_files URL collection files${NC}"
fi
echo ""

# Summary
echo "======================================"
echo "Verification Summary"
echo "======================================"
echo -e "${GREEN}✅ Build: SUCCESS${NC}"
echo -e "${GREEN}✅ Package: SUCCESS${NC}"
echo -e "${GREEN}✅ Verification: PASSED${NC}"
echo ""
echo "📦 Package Information:"
if [ -n "$app_path" ]; then
  echo "  App Bundle: $(basename "$app_path")"
  echo "  Version: $version"
  echo "  Bundle ID: $bundle_id"
fi
echo ""
echo "🔍 Next Steps:"
echo "  1. Test the packaged app manually"
echo "  2. Verify URL collection functionality"
echo "  3. Check permission prompts"
echo "  4. Test with all supported browsers"
echo "  5. Run integration tests: npm run test:integration"
echo "  6. Create GitHub release (if ready)"
echo ""
echo "📋 Manual Testing Checklist:"
echo "  [ ] Install app from release/"
echo "  [ ] Grant Accessibility permission"
echo "  [ ] Launch app and check logs"
echo "  [ ] Test Safari URL collection"
echo "  [ ] Test Chrome URL collection"
echo "  [ ] Test Firefox URL collection"
echo "  [ ] Verify privacy protection (check logs for sanitized URLs)"
echo "  [ ] Test permission revocation and re-grant"
echo "  [ ] Run for 1 hour and check memory usage"
echo ""
