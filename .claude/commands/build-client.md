---
description: Build and release cross-platform client installers (Windows/macOS) via GitHub Actions
argument-hint: [new-version (optional)]
allowed-tools: Bash(git *), Read, Write
---

# Build Cross-Platform Client Installers

This command automates the process of building client installers for both Windows and macOS by creating a version tag and triggering GitHub Actions workflow.

**Version Handling:**
- If version is provided: Use the specified version (e.g., `/build-client 2.4.0`)
- If no version provided: Auto-increment patch version (e.g., 2.3.1 → 2.3.2)

## Workflow Overview

The build process consists of 5 stages:

1. **Precompile Native Modules** (Windows runner)
   - Compiles `native-event-monitor-win` C++ addon with Electron headers
   - Ensures ABI compatibility (Electron 25 = Node ABI 116)
   - Uploads compiled `.node` file as artifact

2. **Build Windows Application** (Windows runner)
   - Downloads precompiled native modules
   - Installs dependencies with `--ignore-scripts` to prevent rebuild
   - Compiles TypeScript
   - Packages with electron-builder
   - Verifies native module in final package

3. **Build macOS Application** (macOS runner)
   - Automatically runs on version tag push
   - Creates DMG installers for both Intel (x64) and Apple Silicon (arm64)

4. **Create GitHub Release**
   - Downloads all build artifacts
   - Generates release notes
   - Publishes release with installers

5. **Notify Completion**
   - Reports build status
   - Provides release URL

## Prerequisites

Before running this command:

1. **Must run from `employee-client/` directory**
2. Check current version in `package.json`
3. Decide on new version (semantic versioning: MAJOR.MINOR.PATCH)
4. Ensure all code changes are committed
5. Verify you have push access to the repository

## Usage

```bash
# Specify version explicitly
/build-client <new-version>

# Auto-increment patch version
/build-client
```

**Examples:**
```bash
# Auto-increment: 2.3.1 → 2.3.2
/build-client

# Explicit patch: 2.3.1 → 2.3.2
/build-client 2.3.2

# Minor version: 2.3.1 → 2.4.0
/build-client 2.4.0

# Major version: 2.3.1 → 3.0.0
/build-client 3.0.0
```

## Execution Steps

### Step 1: Determine Target Version

Determine the version to build (auto-increment if not provided):

```bash
# Get current version from package.json
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

# If version argument provided ($1), use it; otherwise auto-increment patch
if [ -z "$1" ]; then
  # Parse current version (e.g., 2.3.1)
  MAJOR=$(echo $CURRENT_VERSION | cut -d. -f1)
  MINOR=$(echo $CURRENT_VERSION | cut -d. -f2)
  PATCH=$(echo $CURRENT_VERSION | cut -d. -f3)

  # Increment patch version
  NEW_PATCH=$((PATCH + 1))
  TARGET_VERSION="$MAJOR.$MINOR.$NEW_PATCH"

  echo "📦 Auto-incrementing version: $CURRENT_VERSION → $TARGET_VERSION"
else
  TARGET_VERSION="$1"
  echo "📦 Using specified version: $TARGET_VERSION"
fi

# Check if tag already exists
if git rev-parse "v$TARGET_VERSION" >/dev/null 2>&1; then
  echo "❌ Tag v$TARGET_VERSION already exists"
  exit 1
else
  echo "✅ Tag v$TARGET_VERSION is available"
fi
```

### Step 2: Update Package Version

Update version in package.json:

```bash
# Update package.json version (using TARGET_VERSION from Step 1)
npm version $TARGET_VERSION --no-git-tag-version

# Verify the change
grep '"version"' package.json | head -1
```

### Step 3: Commit Version Change

Create a commit for the version bump:

```bash
git add package.json
git commit -m "chore(client): bump version to $TARGET_VERSION"
```

### Step 4: Create and Push Version Tag

Create annotated tag and push to trigger GitHub Actions:

```bash
# Create annotated tag
git tag -a "v$TARGET_VERSION" -m "Release v$TARGET_VERSION"

# Push commit and tag
git push origin main
git push origin "v$TARGET_VERSION"
```

### Step 5: Monitor GitHub Actions

After pushing the tag, GitHub Actions will automatically start the build workflow.

**Monitor the workflow:**

Open in browser:
```
https://github.com/OWNER/REPO/actions/workflows/build-and-release.yml
```

Or use GitHub CLI:
```bash
!gh run list --workflow=build-and-release.yml --limit 1
!gh run watch
```

## Build Workflow Trigger

The workflow is triggered by:

```yaml
on:
  push:
    tags:
      - 'v*.*.*'  # Any tag matching v1.0.0, v2.3.1, etc.
  workflow_dispatch:
    inputs:
      version:
        description: 'Release version (e.g., v1.0.0)'
        required: true
```

## Expected Outputs

After successful build (15-25 minutes), GitHub Release will include:

**Windows:**
- `EmployeeSafety-Setup-{version}.exe` - Windows installer (NSIS)

**macOS:**
- `EmployeeSafety-{version}-x64.dmg` - macOS installer for Intel processors
- `EmployeeSafety-{version}-arm64.dmg` - macOS installer for Apple Silicon (M1/M2/M3)

**Release URL:**
```
https://github.com/OWNER/REPO/releases/tag/v$1
```

## Verification Checklist

After workflow completes:

1. ✅ Check GitHub Actions run succeeded (all jobs green for both Windows and macOS)
2. ✅ Verify release exists: `https://github.com/OWNER/REPO/releases/tag/v$1`
3. ✅ Download and test **Windows** installer:
   - Download `EmployeeSafety-Setup-{version}.exe`
   - Test installation on Windows machine
   - Verify native module loads correctly (no ABI errors)
4. ✅ Download and test **macOS** installers:
   - Download both x64 and arm64 DMG files
   - Test installation on Intel Mac (x64) and/or Apple Silicon Mac (arm64)
   - Verify native module loads correctly
5. ✅ Test core functionality on both platforms:
   - Screenshot capture
   - Activity monitoring
   - Process scanning
   - WebSocket connection to server

## Troubleshooting

### Build Fails: Native Module Compilation Error

**Symptom:** Job `precompile-native` fails

**Solution:**
- Check Visual Studio Build Tools version (requires 17.x)
- Verify Python 3.9 is installed
- Review native module build logs

### Build Fails: ABI Mismatch Error

**Symptom:** Verification step reports wrong NODE_MODULE_VERSION

**Cause:** Native module compiled with wrong Node.js/Electron version

**Solution:**
- Ensure `electron-rebuild` uses correct Electron version
- Check `package.json` devDependencies: `"electron": "25.9.8"`
- Verify NODE_VERSION env var in workflow: `NODE_VERSION: '18'`

### Build Succeeds but App Crashes on Launch

**Symptom:** Installer runs but app crashes immediately

**Solution:**
1. Check Windows Event Viewer for error details
2. Look for "NODE_MODULE_VERSION" error in logs
3. Verify native module in package:
   ```
   release/win-unpacked/resources/app.asar.unpacked/native-event-monitor-win/build/Release/event_monitor.node
   ```

### Tag Already Exists Error

**Symptom:** `git tag` fails because tag already exists

**Solution:**
```bash
# Delete local tag
!git tag -d "v$1"

# Delete remote tag (careful!)
!git push origin --delete "v$1"

# Recreate tag with corrected version
```

### Workflow Not Triggered

**Symptom:** Push tag but no Actions run starts

**Causes:**
1. Tag name doesn't match pattern `v*.*.*`
2. Workflow file has syntax errors
3. GitHub Actions disabled for repository

**Solution:**
```bash
# Verify tag name format
!git tag -l "v$1"

# Manually trigger workflow
!gh workflow run build-and-release.yml -f version="v$1"
```

## Rollback Procedure

If build succeeds but release has critical issues:

1. **Mark release as draft:**
   ```bash
   !gh release edit "v$1" --draft
   ```

2. **Delete release (if needed):**
   ```bash
   !gh release delete "v$1" --yes
   !git push origin --delete "v$1"
   ```

3. **Fix issues and re-release:**
   ```bash
   # Increment patch version (e.g., 2.3.2 → 2.3.3)
   /build-client 2.3.3
   ```

## Manual Workflow Trigger

To trigger build without tag (testing):

```bash
# Using GitHub CLI
!gh workflow run build-and-release.yml \
  -f version="v$1" \
  -f prerelease=true

# Using GitHub web interface
# Navigate to: Actions → Build and Release → Run workflow
```

## CI/CD Architecture

```
Developer Machine
    │
    ├─ Update version in package.json
    ├─ Commit: "chore: bump version to X.Y.Z"
    ├─ Create tag: git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
    └─ Push: git push origin main && git push origin vX.Y.Z
              │
              ▼
    GitHub Repository
              │
              ▼
    GitHub Actions Trigger (on: push: tags: v*.*.*)
              │
              ├─────────────────────────────────┬────────────────────────────┐
              ▼                                 ▼                            ▼
    Job 1: Precompile                Job 2: Build Windows      Job 3: Build macOS
    (Windows Runner)                  (Windows Runner)          (macOS Runner)
    │                                 │                         │
    ├─ Setup VS Build Tools           ├─ Download native        ├─ Install deps
    ├─ Install Electron 25.9.8        │   modules artifact      ├─ Compile TS
    ├─ Install deps (--ignore-scripts)├─ Install deps           ├─ Build native
    ├─ Compile C++ with electron-rebuild ├─ Compile TypeScript │   modules
    ├─ Verify ABI 116                 ├─ Package with          └─ Package .dmg
    ├─ Upload artifact                │   electron-builder
    │                                 └─ Verify native in .exe
    │                                         │
    └─────────────────────────────────────────┴─────────────────┐
                                                                 ▼
                                                    Job 4: Create Release
                                                    (Ubuntu Runner)
                                                    │
                                                    ├─ Download all artifacts
                                                    ├─ Generate release notes
                                                    ├─ Create GitHub Release
                                                    └─ Upload installers
                                                              │
                                                              ▼
                                                    Job 5: Notify Completion
                                                              │
                                                              ▼
                                                    Release Published! 🎉
                                                    https://github.com/OWNER/REPO/releases/tag/vX.Y.Z
```

## Environment Variables

Workflow uses these environment variables:

```yaml
env:
  NODE_VERSION: '18'            # Must match Electron 25's Node.js
  CSC_IDENTITY_AUTO_DISCOVERY: false  # Disable code signing
```

**Secrets (if needed):**
- `GITHUB_TOKEN` - Auto-provided by GitHub Actions
- `CSC_LINK` - (Optional) Code signing certificate
- `CSC_KEY_PASSWORD` - (Optional) Certificate password

## Version Strategy

Follow semantic versioning:

- **MAJOR** (X.0.0): Breaking changes, incompatible API changes
- **MINOR** (1.X.0): New features, backward-compatible
- **PATCH** (1.0.X): Bug fixes, backward-compatible

**Current version:** $currentVersion (from package.json)

**Examples:**
- Bug fix: 2.3.1 → 2.3.2
- New feature: 2.3.2 → 2.4.0
- Breaking change: 2.4.0 → 3.0.0

## References

- **Workflow file:** `.github/workflows/build-and-release.yml`
- **electron-builder config:** `electron-builder.yml`
- **Native modules:**
  - Windows: `native/windows/`
  - macOS: `native/macos/`

## Execution

I will now execute the build process.

**Current working directory:**
```bash
pwd
```

**Step 1: Determine target version**
```bash
# Get current version
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "📦 Current version: $CURRENT_VERSION"

# Determine target version
if [ -z "$1" ]; then
  # Auto-increment patch version
  MAJOR=$(echo $CURRENT_VERSION | cut -d. -f1)
  MINOR=$(echo $CURRENT_VERSION | cut -d. -f2)
  PATCH=$(echo $CURRENT_VERSION | cut -d. -f3)
  NEW_PATCH=$((PATCH + 1))
  TARGET_VERSION="$MAJOR.$MINOR.$NEW_PATCH"
  echo "📦 Auto-incrementing: $CURRENT_VERSION → $TARGET_VERSION"
else
  TARGET_VERSION="$1"
  echo "📦 Using specified version: $TARGET_VERSION"
fi

# Check if tag already exists
if git rev-parse "v$TARGET_VERSION" >/dev/null 2>&1; then
  echo "❌ Tag v$TARGET_VERSION already exists"
  exit 1
else
  echo "✅ Tag v$TARGET_VERSION is available"
fi
```

**Step 2: Update package.json**
```bash
npm version $TARGET_VERSION --no-git-tag-version
grep '"version"' package.json | head -1
```

**Step 3: Commit changes**
```bash
git add package.json
git commit -m "chore(client): bump version to $TARGET_VERSION"
```

**Step 4: Create and push tag**
```bash
# Create annotated tag
git tag -a "v$TARGET_VERSION" -m "Release v$TARGET_VERSION"

# Show tag info
git tag -l "v$TARGET_VERSION" -n

# Push commit and tag
git push origin main
git push origin "v$TARGET_VERSION"

echo "✅ Version $TARGET_VERSION tagged and pushed successfully"
echo "🚀 GitHub Actions workflow will start building..."
```

**Monitor workflow:**

GitHub Actions should now start building. Monitor at:

```
https://github.com/OWNER/REPO/actions
```

Or use CLI:
```bash
!gh run list --workflow=build-and-release.yml --limit 1
```

**Expected timeline:**
- Precompile native: ~5-10 minutes
- Build Windows: ~10-15 minutes
- Create release: ~1-2 minutes
- **Total: ~15-25 minutes**

Once complete, download from:
```
https://github.com/OWNER/REPO/releases/tag/v$1
```
