# Hot Update Critical Bug - Unpacked Directory Not Renamed

## Issue Summary

After hot update completes successfully, the application fails to start properly because the `app.asar.new.unpacked` directory is NOT renamed to replace `app.asar.unpacked`, causing a version mismatch between the ASAR code and native modules.

## Root Cause

**File State After Hot Update:**
```
/Applications/EmployeeSafety.app/Contents/Resources/
├── app.asar (17:24)             ← NEW (1.0.1) ✅
├── app.asar.unpacked (17:16)    ← OLD (1.0.0) ❌ STALE!
└── app.asar.new.unpacked (17:24) ← NEW (1.0.1) NOT RENAMED!
```

**Problem:**
1. Hot update creates `.new` files for both ASAR and unpacked directory
2. On restart, ONLY `app.asar` is being used (the `.new` was removed after rename)
3. But `app.asar.new.unpacked` is LEFT BEHIND without being renamed
4. Application loads with NEW ASAR but OLD unpacked modules
5. This causes module loading to fail silently during initialization

## Impact

**Symptoms:**
- Auto-update initialization stops at "Loading modules..." in logs
- No error message generated (silent failure)
- `app_instance` remains null
- IPC handlers never registered
- Application enters "simulation mode" with all features disabled
- UI shows "启动失败" when clicking start button

**Affected Modules:**
- `@electron/asar` (used by HotUpdateService)
- `sharp` and its dependencies (@img/sharp-darwin-arm64, @img/sharp-libvips-darwin-arm64)
- Any other native modules in unpacked directory

## Why This Happens

The hot update process (HotUpdateService.js):

1. ✅ Creates `app.asar.new` successfully
2. ✅ Creates `app.asar.new.unpacked` successfully
3. ✅ Verifies version in `.new` file
4. ✅ Completes hot update
5. ❌ Does NOT rename `.new` files before restart
6. ❌ Expects NEXT app startup to handle rename
7. ❌ But there's NO startup code to do the rename!

## Solution Required

Add startup logic in `electron/main-minimal.js` to:

1. Check for `app.asar.new` file on startup
2. If exists, rename it to `app.asar` (replace old)
3. Check for `app.asar.new.unpacked` directory on startup
4. If exists, rename it to `app.asar.unpacked` (replace old)
5. Only THEN proceed with normal initialization

**Critical:** This rename MUST happen BEFORE any module loading begins!

## Files to Modify

1. `electron/main-minimal.js` - Add startup rename logic at the very beginning
2. Consider adding this to `HotUpdateService.js` post-update verification

## Temporary Workaround

Manually rename the directories:
```bash
cd /Applications/EmployeeSafety.app/Contents/Resources/
rm -rf app.asar.unpacked
mv app.asar.new.unpacked app.asar.unpacked
```

Then restart the application.
