/**
 * 最精简版Electron主进程
 * 280x320px 小窗口，只包含7个核心功能
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, clipboard, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const originalFs = require('original-fs'); // ⚡ 未被 ASAR 劫持的原始 fs 模块

// ========================================
// 🔧 FIX: Configure sharp to find native libraries in ASAR unpacked directory
// ========================================
if (app.isPackaged) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked');
    process.env.SHARP_LIBVIPS_LOCAL_PREBUILDS = path.join(unpackedPath, 'node_modules/@img');
    console.log('[SHARP] Configured SHARP_LIBVIPS_LOCAL_PREBUILDS:', process.env.SHARP_LIBVIPS_LOCAL_PREBUILDS);
}

// ========================================
// 热更新：启动时检测并替换 .new 文件（包括 unpacked 目录）
// ========================================
(function applyPendingUpdate() {
  if (!app.isPackaged) return; // 开发环境跳过

  try {
    const asarPath = path.join(process.resourcesPath, 'app.asar');
    const newAsarPath = `${asarPath}.new`;
    const backupPath = `${asarPath}.backup`;

    const unpackedPath = `${asarPath}.unpacked`;
    const newUnpackedPath = `${asarPath}.new.unpacked`;
    const backupUnpackedPath = `${asarPath}.unpacked.backup`;

    // 检查是否有待安装的更新
    if (originalFs.existsSync(newAsarPath)) {
      console.log('[HOT_UPDATE] 检测到待安装更新:', newAsarPath);

      // 1. 备份当前版本 ASAR（如果还没有备份）
      if (!originalFs.existsSync(backupPath)) {
        console.log('[HOT_UPDATE] 备份当前 ASAR...');
        originalFs.copyFileSync(asarPath, backupPath);
      }

      // 2. 备份当前版本 unpacked（如果存在且还没有备份）
      if (originalFs.existsSync(unpackedPath) && !originalFs.existsSync(backupUnpackedPath)) {
        console.log('[HOT_UPDATE] 备份当前 unpacked 目录...');
        copyDirSync(unpackedPath, backupUnpackedPath);
      }

      // 3. 替换 ASAR 为新版本
      console.log('[HOT_UPDATE] 安装新版本 ASAR...');
      originalFs.renameSync(newAsarPath, asarPath);

      // 4. 替换 unpacked 目录（如果存在）
      if (originalFs.existsSync(newUnpackedPath)) {
        console.log('[HOT_UPDATE] 安装新版本 unpacked 目录...');

        // 删除旧的 unpacked 目录
        if (originalFs.existsSync(unpackedPath)) {
          console.log('[HOT_UPDATE] 删除旧 unpacked 目录...');
          removeDirSync(unpackedPath);
        }

        // 重命名新的 unpacked 目录
        originalFs.renameSync(newUnpackedPath, unpackedPath);
        console.log('[HOT_UPDATE] ✅ unpacked 目录替换成功');

        // 🆕 4.5. 同步Sharp库到Frameworks目录
        syncSharpLibrariesToFrameworks(unpackedPath);
      }

      // 5. 删除备份（替换成功后）
      if (originalFs.existsSync(backupPath)) {
        originalFs.unlinkSync(backupPath);
      }
      if (originalFs.existsSync(backupUnpackedPath)) {
        removeDirSync(backupUnpackedPath);
      }

      console.log('[HOT_UPDATE] ✅ 热更新安装成功（ASAR + unpacked）');

      // 6. 重新启动应用以加载新代码
      console.log('[HOT_UPDATE] 重新启动应用...');
      app.relaunch({ args: process.argv.slice(1).concat(["--start-minimized"]) });
      app.exit(0);
    }
  } catch (error) {
    console.error('[HOT_UPDATE] ❌ 安装失败:', error.message);
    console.error('[HOT_UPDATE] 错误堆栈:', error.stack);

    // 尝试回滚
    try {
      const asarPath = path.join(process.resourcesPath, 'app.asar');
      const backupPath = `${asarPath}.backup`;
      const unpackedPath = `${asarPath}.unpacked`;
      const backupUnpackedPath = `${asarPath}.unpacked.backup`;

      console.log('[HOT_UPDATE] 开始回滚...');

      // 回滚 ASAR
      if (originalFs.existsSync(backupPath)) {
        console.log('[HOT_UPDATE] 回滚 ASAR...');
        originalFs.copyFileSync(backupPath, asarPath);
        originalFs.unlinkSync(backupPath);
      }

      // 回滚 unpacked
      if (originalFs.existsSync(backupUnpackedPath)) {
        console.log('[HOT_UPDATE] 回滚 unpacked 目录...');
        if (originalFs.existsSync(unpackedPath)) {
          removeDirSync(unpackedPath);
        }
        copyDirSync(backupUnpackedPath, unpackedPath);
        removeDirSync(backupUnpackedPath);
      }

      console.log('[HOT_UPDATE] ✅ 回滚成功');
    } catch (rollbackError) {
      console.error('[HOT_UPDATE] ❌ 回滚失败:', rollbackError.message);
    }
  }

  // 辅助函数：递归复制目录
  function copyDirSync(src, dest) {
    if (!originalFs.existsSync(dest)) {
      originalFs.mkdirSync(dest, { recursive: true });
    }
    const entries = originalFs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirSync(srcPath, destPath);
      } else {
        originalFs.copyFileSync(srcPath, destPath);
      }
    }
  }

  // 辅助函数：递归删除目录
  function removeDirSync(dirPath) {
    if (originalFs.existsSync(dirPath)) {
      const entries = originalFs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          removeDirSync(fullPath);
        } else {
          originalFs.unlinkSync(fullPath);
        }
      }
      originalFs.rmdirSync(dirPath);
    }
  }

  // 🆕 辅助函数：同步Sharp库到Frameworks目录
  function syncSharpLibrariesToFrameworks(unpackedPath) {
    try {
      const frameworksPath = path.join(process.resourcesPath, '..', 'Frameworks');
      const sharpLibSource = path.join(unpackedPath, 'node_modules/@img/sharp-libvips-darwin-arm64/lib');

      // 检查Sharp库源目录是否存在
      if (!originalFs.existsSync(sharpLibSource)) {
        console.log('[HOT_UPDATE] ℹ️  Sharp库源目录不存在，跳过Frameworks同步');
        return;
      }

      // 确保Frameworks目录存在
      if (!originalFs.existsSync(frameworksPath)) {
        console.log('[HOT_UPDATE] ⚠️  Frameworks目录不存在，创建中...');
        originalFs.mkdirSync(frameworksPath, { recursive: true });
      }

      console.log('[HOT_UPDATE] 🔍 检测Sharp库更新，同步到Frameworks...');
      console.log('[HOT_UPDATE]   源目录:', sharpLibSource);
      console.log('[HOT_UPDATE]   目标目录:', frameworksPath);

      // 读取所有.dylib文件
      const allFiles = originalFs.readdirSync(sharpLibSource);
      const dylibFiles = allFiles.filter(file => file.endsWith('.dylib'));

      if (dylibFiles.length === 0) {
        console.log('[HOT_UPDATE] ⚠️  未找到.dylib文件');
        return;
      }

      console.log(`[HOT_UPDATE] 找到 ${dylibFiles.length} 个.dylib文件:`, dylibFiles);

      let syncCount = 0;
      let skipCount = 0;

      for (const dylibFile of dylibFiles) {
        const sourcePath = path.join(sharpLibSource, dylibFile);
        const targetPath = path.join(frameworksPath, dylibFile);

        // 检查是否需要同步
        let needsSync = false;
        let reason = '';

        if (!originalFs.existsSync(targetPath)) {
          needsSync = true;
          reason = '新增文件';
        } else {
          // 对比文件大小判断版本是否不同
          const sourceStats = originalFs.statSync(sourcePath);
          const targetStats = originalFs.statSync(targetPath);

          if (sourceStats.size !== targetStats.size) {
            needsSync = true;
            reason = `版本变化 (${(targetStats.size / 1024 / 1024).toFixed(2)}MB -> ${(sourceStats.size / 1024 / 1024).toFixed(2)}MB)`;
          } else {
            // 大小相同，假设版本一致
            skipCount++;
            console.log(`[HOT_UPDATE]   - ${dylibFile}: 跳过（版本未变化）`);
            continue;
          }
        }

        if (needsSync) {
          console.log(`[HOT_UPDATE]   - ${dylibFile}: ${reason}`);

          try {
            // 备份旧版本（如果存在）
            if (originalFs.existsSync(targetPath)) {
              const backupTargetPath = `${targetPath}.backup`;
              if (originalFs.existsSync(backupTargetPath)) {
                originalFs.unlinkSync(backupTargetPath);
              }
              originalFs.renameSync(targetPath, backupTargetPath);
              console.log(`[HOT_UPDATE]     已备份旧版本: ${dylibFile}.backup`);
            }

            // 复制新版本
            originalFs.copyFileSync(sourcePath, targetPath);
            syncCount++;
            console.log(`[HOT_UPDATE]     ✅ ${dylibFile} 同步成功`);

          } catch (fileError) {
            console.error(`[HOT_UPDATE]     ❌ ${dylibFile} 同步失败:`, fileError.message);

            // 尝试恢复备份
            const backupTargetPath = `${targetPath}.backup`;
            if (originalFs.existsSync(backupTargetPath)) {
              try {
                originalFs.renameSync(backupTargetPath, targetPath);
                console.log(`[HOT_UPDATE]     已恢复备份版本`);
              } catch (restoreError) {
                console.error(`[HOT_UPDATE]     恢复备份失败:`, restoreError.message);
              }
            }
          }
        }
      }

      // 清理备份文件（同步成功后）
      try {
        const frameworkFiles = originalFs.readdirSync(frameworksPath);
        const backupFiles = frameworkFiles.filter(f => f.endsWith('.dylib.backup'));

        for (const backupFile of backupFiles) {
          const backupPath = path.join(frameworksPath, backupFile);
          originalFs.unlinkSync(backupPath);
          console.log(`[HOT_UPDATE]   已清理备份: ${backupFile}`);
        }
      } catch (cleanupError) {
        console.error('[HOT_UPDATE] 清理备份文件失败:', cleanupError.message);
      }

      // 总结
      if (syncCount > 0) {
        console.log(`[HOT_UPDATE] ✅ 已同步 ${syncCount} 个Sharp库到Frameworks`);
      } else if (skipCount > 0) {
        console.log(`[HOT_UPDATE] ℹ️  Sharp库版本未变化，无需同步 (检查了${skipCount}个文件)`);
      }

    } catch (error) {
      console.error('[HOT_UPDATE] ⚠️  Sharp库同步失败（不影响其他更新）:', error.message);
      console.error('[HOT_UPDATE] 错误堆栈:', error.stack);
      // 不抛出错误，允许热更新继续完成
    }
  }
})();
// ========================================
const { WindowsNativeInstaller } = require('./windows-native-installer');
const UnifiedLogManager = require('./unified-log-manager');
const { initializeAutoUpdate, setupUpdateIPCHandlers } = require('./auto-update-integration');
const EnhancedHotReloadManager = require('./enhanced-hot-reload-manager');

// 全局变量
let mainWindow = null;
let permissionWizardWindow = null;
let nativeModuleWindow = null;
let tray = null;
let app_instance = null;
let isQuitting = false;
let currentState = 'INIT';
let manuallyPaused = false; // 添加手动暂停标志，初始为false允许启动
let windowsNativeInstaller = null;
let logManager = null; // 日志管理器
let hotReloadManager = null; // 增强版热更新管理器

// 检查启动参数
const isStartMinimized = process.argv.includes('--start-minimized');
console.log(`[STARTUP] Start minimized: ${isStartMinimized}`);
console.log(`[STARTUP] Command line args:`, process.argv);

// 应用配置
const APP_CONFIG = {
    name: 'Employee Safety',
    width: 340,
    height: 265, // 紧凑布局，无底部padding
    resizable: false
};

// 防止多实例运行
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// 注意：macOS Dock 显示/隐藏由 Info.plist 中的 LSUIElement 控制
// LSUIElement=false: 显示窗口和菜单栏
// LSUIElement=true: 后台代理模式（无窗口）
if (process.platform === 'darwin') {
    console.log('macOS detected - UI mode controlled by Info.plist LSUIElement setting');
}

/**
 * ASAR完整性检查
 * 启动时验证ASAR文件完整性，损坏时自动从备份恢复
 */
function checkAsarIntegrity() {
    // 开发模式跳过检查
    if (!app.isPackaged) {
        console.log('[Startup] Development mode - skipping ASAR integrity check');
        return true;
    }

    const asarPath = path.join(process.resourcesPath, 'app.asar');
    const backupPath = `${asarPath}.backup`;

    // ⚡ FIX: Check if using directory packaging (--no-asar)
    if (!fs.existsSync(asarPath)) {
        // Using directory packaging instead of ASAR
        const appDirPath = path.join(process.resourcesPath, 'app');
        if (fs.existsSync(appDirPath)) {
            console.log('[Startup] ✅ Using directory packaging (no ASAR) - skipping integrity check');
            return true;
        }
        console.error('[Startup] ❌ Neither app.asar nor app directory found');
        return false;
    }

    // ⚡ FIX: 使用 original-fs 避免 ASAR 虚拟文件系统重定向
    try {
        // 使用未被劫持的原始 fs 模块读取 ASAR 文件
        // 这样可以直接访问物理文件，不经过 Electron 的 ASAR 重定向
        const fd = originalFs.openSync(asarPath, 'r');
        const buffer = Buffer.allocUnsafe(16);
        const bytesRead = originalFs.readSync(fd, buffer, 0, 16, 0);
        originalFs.closeSync(fd);

        // 验证读取成功
        if (bytesRead < 16) {
            throw new Error(`ASAR文件损坏：只能读取 ${bytesRead} 字节`);
        }

        // 验证 ASAR 文件头部（不会全为 0）
        const isAllZeros = buffer.slice(0, 16).every(b => b === 0);
        if (isAllZeros) {
            throw new Error('ASAR文件损坏：文件内容异常');
        }

        console.log(`[Startup] ✅ ASAR完整性检查通过 - 文件格式正常`);
        return true;

    } catch (error) {
        console.error('[Startup] ❌ ASAR文件检查失败:', error.message);

        // 尝试从备份恢复
        if (fs.existsSync(backupPath)) {
            console.log('[Startup] 发现备份文件,尝试恢复...');
            try {
                fs.copyFileSync(backupPath, asarPath);
                console.log('[Startup] ✅ ASAR已从备份恢复,应用将重启');

                dialog.showMessageBoxSync({
                    type: 'warning',
                    title: '应用已恢复',
                    message: '检测到应用文件损坏，已自动从备份恢复。\n应用将重新启动。',
                    buttons: ['确定']
                });

                app.relaunch({ args: process.argv.slice(1).concat(["--start-minimized"]) });
                app.exit(0);
                return false;

            } catch (restoreError) {
                console.error('[Startup] ❌ 从备份恢复失败:', restoreError.message);

                dialog.showErrorBox(
                    '应用启动失败',
                    '应用文件已损坏且无法恢复。\n请重新安装应用。'
                );
                return false;
            }
        } else {
            console.error('[Startup] ❌ 未找到备份文件');

            dialog.showErrorBox(
                '应用启动失败',
                '应用文件已损坏且未找到备份。\n请重新安装应用。'
            );
            return false;
        }
    }
}

// 启动前检查ASAR完整性
if (!checkAsarIntegrity()) {
    // 如果检查失败且没有触发重启,直接退出
    app.quit();
}

// 应用就绪
app.whenReady().then(async () => {
    console.log('[MAIN] ========== APP READY CALLBACK START ==========');
    console.log('[MAIN] Timestamp:', new Date().toISOString());
    console.log('企业安全 (精简版) 启动中...');
    console.log('[MAIN] Environment check - isPackaged:', app.isPackaged, 'appPath:', app.getAppPath());
    console.log('[MAIN] __dirname:', __dirname, 'process.cwd():', process.cwd());

    // 隐藏默认菜单栏（Windows/Linux）
    if (process.platform !== 'darwin') {
        Menu.setApplicationMenu(null);
    }

    // 初始化日志管理器
    try {
        logManager = new UnifiedLogManager({
            logLevel: 'WARN'
        });
        console.log('[LOG_MANAGER] 统一日志管理器已启动');
    } catch (logError) {
        console.error('[LOG_MANAGER] 初始化失败:', logError);
    }

    // 初始化Windows原生模块安装器
    if (process.platform === 'win32') {
        windowsNativeInstaller = new WindowsNativeInstaller();
        sendLogToRenderer('Windows原生模块安装器已初始化');
    }

    try {
        createMainWindow();
        console.log('[MAIN] 主窗口创建成功');
    } catch (winError) {
        console.error('[MAIN] 创建主窗口失败:', winError);
    }

    try {
        createTray();
        console.log('[MAIN] 系统托盘创建成功');
    } catch (trayError) {
        console.error('[MAIN] 创建系统托盘失败:', trayError);
    }

    try {
        setupIPCHandlers();
        console.log('[MAIN] IPC处理器注册成功');
    } catch (ipcError) {
        console.error('[MAIN] 注册IPC处理器失败:', ipcError);
    }

    // 初始化自动更新系统
    console.log('[MAIN] ===== STEP 4: Initializing Auto-Update System =====');
    try {
        initializeAutoUpdate(mainWindow).catch(e => console.error("[MAIN] Auto-update error:", e));
        console.log('[MAIN] ✅ 自动更新系统已初始化');
    } catch (updateError) {
        console.error('[MAIN] ❌ 自动更新系统初始化失败:', updateError);
    }
    console.log('[MAIN] ===== STEP 4: Auto-Update Initialized =====');

    // 注册更新相关的IPC处理器（即使更新服务初始化失败也需要注册）
    console.log('[MAIN] ===== STEP 5: Setting up Update IPC Handlers =====');
    try {
        setupUpdateIPCHandlers();
        console.log('[MAIN] ✅ 更新IPC处理器已注册');
    } catch (ipcError) {
        console.error('[MAIN] ❌ 注册更新IPC处理器失败:', ipcError);
    }
    console.log('[MAIN] ===== STEP 5: Update IPC Handlers Registered =====');

    // 初始化增强版热更新系统（仅开发环境）
    console.log('[MAIN] 🔍 Checking if should initialize hot reload... isPackaged:', app.isPackaged);
    if (!app.isPackaged) {
        console.log('[MAIN] 🔍 Entering hot reload initialization block...');
        try {
            console.log('[MAIN] 🔍 Creating EnhancedHotReloadManager instance...');
            hotReloadManager = new EnhancedHotReloadManager(mainWindow, {
                watchPath: path.join(__dirname, 'renderer'),
                fileTypes: ['.js', '.html', '.css', '.json', '.scss', '.ts', '.jsx', '.tsx', '.less'],
                ignorePaths: ['node_modules', '.git', 'dist', '.DS_Store'],
                debounceDelay: 500,
                reloadDelay: 100,
                smartReload: true,
                showNotifications: true,
                showProgress: true,
                debug: false,
                enableStats: true
            });

            hotReloadManager.start();
            console.log('[MAIN] ✅ 增强版热更新系统已启用 (开发模式)');
            console.log('[MAIN] 监听目录:', path.join(__dirname, 'renderer'));
            console.log('[MAIN] 智能重载: CSS 文件只刷新样式');
        } catch (hotReloadError) {
            console.error('[MAIN] 热更新系统初始化失败:', hotReloadError);
        }
    } else {
        console.log('[MAIN] ⚠️ 热更新系统已禁用 (生产模式)');
    }

    // 初始化托盘菜单状态和验证托盘
    setTimeout(() => {
        if (tray && !tray.isDestroyed()) {
            console.log('✅ Tray verification: Tray is active and not destroyed');
            updateTrayMenu();
        } else {
            console.error('❌ Tray verification failed: Tray is null or destroyed');
            console.log('Attempting to recreate tray...');
            createTray();
        }
        
        // 额外验证：检查托盘是否在系统中可见
        if (process.platform === 'darwin') {
            console.log('macOS: Please check the top menu bar (near the clock) for the app icon');
        }
    }, 1000);
    
    // 如果是最小化启动，自动启动监控服务
    if (isStartMinimized) {
        setTimeout(async () => {
            console.log('[STARTUP] 最小化启动检测到，自动启动监控服务...');
            try {
                const result = await startAppService(false); // false = 自动启动，非手动
                if (result && result.success) {
                    console.log('[STARTUP] 后台监控服务启动成功');
                } else {
                    console.log('[STARTUP] 后台监控服务启动失败:', result?.message || '未知错误');
                }
            } catch (error) {
                console.error('[STARTUP] 后台监控服务启动异常:', error.message);
            }
        }, 3000); // 等待3秒确保所有组件初始化完成
    }

    // ✅ 检测热更新后自动启动标志
    console.log('[MAIN] 🔍 Before checkAndAutoStartAfterUpdate() call');
    console.log('[MAIN] 🔍 checkAndAutoStartAfterUpdate type:', typeof checkAndAutoStartAfterUpdate);
    try {
        checkAndAutoStartAfterUpdate().catch(err => {
            console.error('[MAIN] ❌ checkAndAutoStartAfterUpdate error:', err);
        });
        console.log('[MAIN] ✅ After checkAndAutoStartAfterUpdate() call');
    } catch (syncError) {
        console.error('[MAIN] ❌ Synchronous error calling checkAndAutoStartAfterUpdate:', syncError);
    }
    console.log('[MAIN] 🔍 Continuing to STEP 6...');

    console.log('[MAIN] ===== STEP 6: Loading Main Application Module =====');
    console.log('[MAIN] Timestamp:', new Date().toISOString());

    // 尝试导入主应用
    try {
        sendLogToRenderer('[INIT] 正在尝试加载主应用模块...');
        console.log('[INIT] Attempting to import EmployeeMonitorApp...');
        
        // 使用多种路径尝试加载，支持不同的打包结构
        let EmployeeMonitorApp;
        
        // 获取基础路径 - 适应electron-packager的结构
        const basePath = app.isPackaged 
            ? path.dirname(app.getAppPath())  // 打包后的app目录
            : __dirname;  // 开发环境
            
        sendLogToRenderer(`[INIT] 环境检测 - 打包状态: ${app.isPackaged}, 基础路径: ${basePath}`);
        console.log('[INIT] Base detection - isPackaged:', app.isPackaged, 'basePath:', basePath, 'appPath:', app.getAppPath());
        
        // 🔧 FIX: 优化路径顺序，打包环境优先使用ASAR内路径，移除不可靠的process.cwd()
        const possiblePaths = app.isPackaged ? [
            // 打包环境：优先使用ASAR内路径
            path.join(app.getAppPath(), 'out', 'dist', 'main', 'app'),
            path.join(__dirname, 'out', 'dist', 'main', 'app'),
            path.join(basePath, 'out', 'dist', 'main', 'app'),
            // electron-builder 结构
            path.join(process.resourcesPath, 'app', 'out', 'dist', 'main', 'app'),
        ] : [
            // 开发环境：使用开发目录路径
            path.join(__dirname, '..', 'out', 'dist', 'main', 'app'),
            path.join(__dirname, 'out', 'dist', 'main', 'app'),
        ];
        
        let loadError;
        for (const appPath of possiblePaths) {
            try {
                const fs = require('fs');
                const fileExists = fs.existsSync(appPath + '.js');
                sendLogToRenderer(`[INIT] 检查路径: ${appPath + '.js'} - 存在: ${fileExists}`);
                console.log('[INIT] Checking path:', appPath + '.js', 'exists:', fileExists);
                
                if (fileExists) {
                    sendLogToRenderer(`[INIT] 尝试从以下路径加载: ${appPath}`);
                    console.log('[INIT] Trying to load from:', appPath);
                    try {
                        const result = require(appPath);
                        console.log("[INIT] Module required successfully");
                        console.log("[INIT] Result type:", typeof result);
                        console.log("[INIT] Result keys:", Object.keys(result || {}).join(", "));
                        EmployeeMonitorApp = result.EmployeeMonitorApp;
                        console.log("[INIT] EmployeeMonitorApp type:", typeof EmployeeMonitorApp);
                        if (!EmployeeMonitorApp) {
                            throw new Error("EmployeeMonitorApp is undefined in module exports");
                        }
                    } catch (requireError) {
                        console.error("[INIT] Require error:", requireError.message);
                        console.error("[INIT] Require error stack:", requireError.stack);
                        throw requireError;
                    }
                    console.log("[INIT] Has EmployeeMonitorApp:", "EmployeeMonitorApp" in result);
                    sendLogToRenderer(`[INIT] ✅ 成功从路径加载: ${appPath}`);
                    console.log('[INIT] Import successful from:', appPath);
                    break;
                } else {
                    sendLogToRenderer(`[INIT] ❌ 文件不存在: ${appPath + '.js'}`);
                    console.log('[INIT] File does not exist:', appPath + '.js');
                }
            } catch (error) {
                sendLogToRenderer(`[INIT] ❌ 加载失败: ${appPath} - ${error.message}`, 'error');
                console.log('[INIT] Failed to load from:', appPath, '-', error.message);
                loadError = error;
            }
        }
        
        if (!EmployeeMonitorApp) {
            throw new Error('Could not load EmployeeMonitorApp from any path. Last error: ' + loadError?.message);
        }
        sendLogToRenderer('[INIT] ✅ 主应用模块加载成功，正在创建实例...');
        console.log('[INIT] Import successful, creating instance...');
        
        app_instance = new EmployeeMonitorApp();
        sendLogToRenderer('[INIT] ✅ 主应用实例创建成功');
        console.log('[INIT] EmployeeMonitorApp instance created successfully');
        
        // 监听应用状态变化，在手动暂停时强制停止
        if (app_instance) {
            console.log('[INIT] Setting up app event listeners...');
            app_instance.on('stateChanged', async (data) => {
                console.log(`[APP_MONITOR] App state change detected: ${data.oldState} -> ${data.newState}, manuallyPaused: ${manuallyPaused}`);
                
                // 如果应用尝试启动但我们处于手动暂停状态，强制停止它
                // 但需要确保这不是初始启动或手动启动的情况
                if (manuallyPaused && (data.newState === 'starting' || data.newState === 'running')) {
                    console.log('[APP_MONITOR] Detected start attempt while manually paused');
                    
                    // 给用户启动一些时间窗口，避免误停初始启动
                    setTimeout(async () => {
                        // 再次检查暂停状态，以防在延迟期间状态发生变化
                        if (manuallyPaused) {
                            console.log('[APP_MONITOR] Force stopping app due to manual pause (after delay check)');
                            try {
                                if (app_instance && typeof app_instance.stop === 'function') {
                                    await app_instance.stop();
                                    console.log('[APP_MONITOR] App force stopped successfully');
                                    sendLogToRenderer('服务已停止：检测到手动暂停状态', 'warning');
                                }
                            } catch (error) {
                                console.error('[APP_MONITOR] Failed to force stop app:', error);
                            }
                        } else {
                            console.log('[APP_MONITOR] Manual pause cleared during delay, allowing app to continue');
                        }
                    }, 2000); // 增加延迟到2秒，给初始化更多时间
                }
            });
        }
        
        sendLogToRenderer('[INIT] ✅ 主应用加载完成，系统就绪');
        console.log('[INIT] Main application loaded and ready');
        console.log('[MAIN] ===== STEP 6: Main Application Module Loaded Successfully =====');
        console.log('[MAIN] ========== APP READY CALLBACK COMPLETED ==========');

        // 不再自动启动，等待用户手动启动或配置
        sendLogToRenderer('应用已就绪，请先配置服务器地址然后手动启动');

    } catch (error) {
        console.log('[MAIN] ===== STEP 6: Main Application Module Load FAILED =====');
        console.error('[INIT] Failed to load main application:', error.message);
        console.error('[INIT] Error stack:', error.stack);

        // === 建议1: 增强诊断信息收集 ===
        const fs = require('fs');
        const basePath = app.isPackaged
            ? path.dirname(app.getAppPath())
            : __dirname;

        // 重新定义 possiblePaths（在 catch 块中需要重新定义）
        const diagnosticPaths = [
            path.join(__dirname, '..', 'out', 'dist', 'main', 'app'),
            path.join(basePath, 'out', 'dist', 'main', 'app'),
            path.join(app.getAppPath(), 'out', 'dist', 'main', 'app'),
            path.join(process.resourcesPath || '', 'app', 'out', 'dist', 'main', 'app'),
            path.join(__dirname, 'out', 'dist', 'main', 'app'),
            path.join(process.cwd(), 'out', 'dist', 'main', 'app'),
        ];

        const diagnosticInfo = {
            timestamp: new Date().toISOString(),
            errorMessage: error.message,
            errorStack: error.stack,
            environment: {
                isPackaged: app.isPackaged,
                appPath: app.getAppPath(),
                __dirname: __dirname,
                cwd: process.cwd(),
                resourcesPath: process.resourcesPath,
                platform: process.platform,
                electronVersion: process.versions.electron,
                nodeVersion: process.versions.node
            },
            attemptedPaths: [],
            directoryStructure: {}
        };

        // 重新检查所有路径并记录详细信息
        diagnosticPaths.forEach(modulePath => {
            const pathInfo = {
                path: modulePath,
                fullPath: modulePath + '.js',
                exists: false,
                error: null,
                stats: null
            };

            try {
                if (fs.existsSync(modulePath + '.js')) {
                    pathInfo.exists = true;
                    pathInfo.stats = fs.statSync(modulePath + '.js');
                }
            } catch (pathError) {
                pathInfo.error = pathError.message;
            }

            diagnosticInfo.attemptedPaths.push(pathInfo);
        });

        // 检查关键目录结构
        const checkPaths = [
            path.join(__dirname, '..', 'dist'),
            path.join(app.getAppPath(), 'dist'),
            path.join(process.cwd(), 'dist'),
            path.join(process.resourcesPath || '', 'app', 'dist')
        ];

        checkPaths.forEach(dirPath => {
            const dirInfo = {
                path: dirPath,
                exists: false,
                files: [],
                error: null
            };

            try {
                if (fs.existsSync(dirPath)) {
                    dirInfo.exists = true;
                    // 递归列出目录内容（最多2层）
                    const listDir = (dir, depth = 0) => {
                        if (depth > 2) return [];
                        try {
                            const items = fs.readdirSync(dir);
                            return items.map(item => {
                                const itemPath = path.join(dir, item);
                                const stat = fs.statSync(itemPath);
                                if (stat.isDirectory() && depth < 2) {
                                    return {
                                        name: item,
                                        type: 'directory',
                                        children: listDir(itemPath, depth + 1)
                                    };
                                }
                                return {
                                    name: item,
                                    type: 'file',
                                    size: stat.size
                                };
                            });
                        } catch (err) {
                            return [];
                        }
                    };
                    dirInfo.files = listDir(dirPath);
                }
            } catch (dirError) {
                dirInfo.error = dirError.message;
            }

            diagnosticInfo.directoryStructure[dirPath] = dirInfo;
        });

        // 保存诊断信息到文件
        try {
            const userDataPath = app.getPath('userData');
            const diagPath = path.join(userDataPath, 'module-load-diagnostic.json');
            fs.writeFileSync(diagPath, JSON.stringify(diagnosticInfo, null, 2));
            console.error('[INIT] ❌ 诊断信息已保存至:', diagPath);
            sendLogToRenderer(`诊断信息已保存: ${diagPath}`, 'error');
        } catch (saveError) {
            console.error('[INIT] 保存诊断信息失败:', saveError.message);
        }

        // 输出诊断摘要到日志
        console.log('[INIT] 诊断摘要:', {
            attemptedPathCount: diagnosticInfo.attemptedPaths.length,
            existingPaths: diagnosticInfo.attemptedPaths.filter(p => p.exists).length,
            checkedDirectories: Object.keys(diagnosticInfo.directoryStructure).length
        });

        console.log('[INIT] Running in standalone/simulation mode');
        sendLogToRenderer('主应用加载失败，运行在模拟模式: ' + error.message, 'warning');
    }
});

function createMainWindow() {
    console.log('[WINDOW_CREATE] 🪟 Function called - starting window creation...');
    console.log('[WINDOW_CREATE] Platform:', process.platform);
    console.log('[WINDOW_CREATE] APP_CONFIG:', JSON.stringify(APP_CONFIG));

    // macOS 和 Windows 使用原有逻辑
    console.log('[WINDOW_CREATE] Creating BrowserWindow instance...');
    mainWindow = new BrowserWindow({
            width: APP_CONFIG.width,
            height: APP_CONFIG.height,
            resizable: APP_CONFIG.resizable,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload-js.js')
            },
            show: false,
            title: APP_CONFIG.name,
            titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', // 只在macOS使用特殊样式
            vibrancy: process.platform === 'darwin' ? 'under-window' : undefined, // 只在macOS使用毛玻璃效果
            icon: createDefaultIcon(),
            minimizable: true,
            maximizable: false,
            closable: true,
            // 隐藏菜单栏（所有平台）
            autoHideMenuBar: true,
            // macOS: 不在任务栏显示（配合 LSUIElement=true）
            skipTaskbar: process.platform === 'darwin'
        });

    console.log('[WINDOW_CREATE] ✅ BrowserWindow instance created successfully');
    console.log('[WINDOW_CREATE] Window ID:', mainWindow.id);

        // 隐藏菜单栏（Windows）
        if (process.platform === 'win32') {
            mainWindow.setMenuBarVisibility(false);
            mainWindow.setAutoHideMenuBar(true);
        }

    // 加载精简界面
    const htmlPath = path.join(__dirname, 'renderer', 'minimal-index.html');
    console.log('[DEBUG] Attempting to load HTML from:', htmlPath);
    console.log('[DEBUG] __dirname is:', __dirname);
    console.log('[DEBUG] HTML file exists:', require('fs').existsSync(htmlPath));
    
    mainWindow.loadFile(htmlPath)
        .then(() => {
            console.log('Minimal interface loaded');

            // 设置日志管理器的主窗口引用
            if (logManager) {
                logManager.setMainWindow(mainWindow);
                console.log('[LOG_MANAGER] 主窗口引用已设置');
            }

            // 延迟推送自启动状态(等待渲染进程初始化完成)
            // 使用多次重试确保状态能够正确推送
            // 注意：platformAdapter 只在 app_instance.start() 后才可用
            const pushAutoStartStatus = async (retryCount = 0, maxRetries = 15) => {
                try {
                    console.log(`[AUTO_START_INIT] 正在获取自启动状态... (尝试 ${retryCount + 1}/${maxRetries})`);

                    // 首先检查 app_instance 是否存在
                    if (!app_instance) {
                        console.log('[AUTO_START_INIT] ⏳ App实例尚未创建,等待...');
                        if (retryCount < maxRetries - 1) {
                            setTimeout(() => pushAutoStartStatus(retryCount + 1, maxRetries), 2000);
                        }
                        return;
                    }

                    // 检查 app 是否已进入 RUNNING 状态
                    const appState = app_instance.getState ? app_instance.getState() : null;
                    console.log(`[AUTO_START_INIT] App状态: ${appState}`);

                    if (appState !== 'running' && appState !== 'RUNNING') {
                        console.log('[AUTO_START_INIT] ⏳ App尚未启动完成,等待... (当前状态:', appState, ')');
                        if (retryCount < maxRetries - 1) {
                            setTimeout(() => pushAutoStartStatus(retryCount + 1, maxRetries), 2000);
                        } else {
                            console.warn('[AUTO_START_INIT] ⚠️ App未在规定时间内启动,跳过自启动状态检查');
                            // 仍然通知UI，设置为默认值
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('autostart-status-changed', { enabled: false, unavailable: true });
                            }
                        }
                        return;
                    }

                    // App已运行，获取平台适配器
                    const platformAdapter = app_instance.getPlatformAdapter();
                    if (platformAdapter && typeof platformAdapter.isAutoStartEnabled === 'function') {
                        const enabled = await platformAdapter.isAutoStartEnabled();
                        console.log('[AUTO_START_INIT] ✅ 当前自启动状态:', enabled);

                        // 推送初始状态到渲染进程
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            console.log('[AUTO_START_INIT] 📤 推送初始状态到UI: enabled =', enabled);
                            mainWindow.webContents.send('autostart-status-changed', { enabled });
                            sendLogToRenderer(`[状态同步] 自启动状态: ${enabled ? '已开启' : '已关闭'}`);
                        }
                    } else {
                        console.warn('[AUTO_START_INIT] ⚠️ 平台适配器不可用(App已运行但适配器未就绪)');
                        // 平台适配器未初始化,继续重试
                        if (retryCount < maxRetries - 1) {
                            setTimeout(() => pushAutoStartStatus(retryCount + 1, maxRetries), 2000);
                        }
                    }
                } catch (error) {
                    console.error('[AUTO_START_INIT] ❌ 获取自启动状态异常:', error);
                    // 出错也继续重试
                    if (retryCount < maxRetries - 1) {
                        setTimeout(() => pushAutoStartStatus(retryCount + 1, maxRetries), 2000);
                    }
                }
            };

            // 首次尝试延迟3秒（等待App初始化）
            setTimeout(() => pushAutoStartStatus(), 3000);

            // 检查是否是热更新重启（优先级最高）
            const isHotUpdateRestart = hasAutoStartFlag();

            // 根据启动参数和热更新标志决定是否显示窗口
            if (!isStartMinimized && !isHotUpdateRestart) {
                // 确保窗口在所有工作区可见并置于最前
                mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                mainWindow.show();
                mainWindow.focus();
                // 恢复正常工作区行为
                setTimeout(() => {
                    mainWindow.setVisibleOnAllWorkspaces(false);
                }, 500);
                console.log('[STARTUP] 窗口已显示（正常启动）');
            } else if (isHotUpdateRestart) {
                // ✅ 热更新重启：强制隐藏窗口，后台运行
                mainWindow.hide();
                console.log('[STARTUP] 热更新重启检测到，窗口强制隐藏，后台运行');
            } else {
                console.log('[STARTUP] 后台启动，窗口保持隐藏');
                // 后台启动时自动启动监控服务
                setTimeout(async () => {
                    try {
                        console.log('[STARTUP] 正在自动启动监控服务...');
                        const result = await startAppService(false); // false 表示不是手动启动
                        if (result.success) {
                            console.log('[STARTUP] ✅ 监控服务自动启动成功');
                            sendLogToRenderer('[后台启动] 监控服务已自动启动');
                        } else {
                            console.log('[STARTUP] ❌ 监控服务自动启动失败:', result.error);
                            sendLogToRenderer('[后台启动] 监控服务启动失败: ' + result.error, 'error');
                        }
                    } catch (error) {
                        console.error('[STARTUP] 监控服务自动启动异常:', error);
                        sendLogToRenderer('[后台启动] 监控服务启动异常: ' + error.message, 'error');
                    }
                }, 2000); // 延迟2秒启动，确保所有组件都已初始化
            }
        })
        .catch(err => {
            console.error('Failed to load minimal interface:', err);
            // 备用简单界面
            const simpleHtml = createFallbackHtml();
            mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(simpleHtml)}`);
            
            // 设置日志管理器的主窗口引用
            if (logManager) {
                logManager.setMainWindow(mainWindow);
                console.log('[LOG_MANAGER] 主窗口引用已设置');
            }
            
            // 根据启动参数决定是否显示窗口
            if (!isStartMinimized) {
                mainWindow.show();
                console.log('[STARTUP] 备用界面已显示（正常启动）');
            } else {
                console.log('[STARTUP] 后台启动，备用界面保持隐藏');
                // 后台启动时自动启动监控服务
                setTimeout(async () => {
                    try {
                        console.log('[STARTUP] 正在自动启动监控服务...');
                        const result = await startAppService(false); // false 表示不是手动启动
                        if (result.success) {
                            console.log('[STARTUP] ✅ 监控服务自动启动成功');
                            sendLogToRenderer('[后台启动] 监控服务已自动启动');
                        } else {
                            console.log('[STARTUP] ❌ 监控服务自动启动失败:', result.error);
                            sendLogToRenderer('[后台启动] 监控服务启动失败: ' + result.error, 'error');
                        }
                    } catch (error) {
                        console.error('[STARTUP] 监控服务自动启动异常:', error);
                        sendLogToRenderer('[后台启动] 监控服务启动异常: ' + error.message, 'error');
                    }
                }, 2000); // 延迟2秒启动，确保所有组件都已初始化
            }
        });

    // 窗口事件
    mainWindow.on('closed', () => {
        mainWindow = null;
        isRendererReady = false;
        logQueue = []; // 清空日志队列
    });

    mainWindow.on('close', (event) => {
        // 阻止窗口关闭，改为隐藏到托盘/菜单栏
        event.preventDefault();
        mainWindow.hide();

        // 在macOS上，显示提示信息
        if (process.platform === 'darwin') {
            sendLogToRenderer('应用已隐藏到菜单栏，点击菜单栏图标可重新显示');
        } else {
            sendLogToRenderer('应用已隐藏到系统托盘，右键托盘图标可重新显示');
        }
    });

    // 监听渲染进程准备好的事件
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('[RENDERER] Renderer process ready');
        isRendererReady = true;

        // 刷新缓存的日志队列
        if (logQueue.length > 0) {
            console.log(`[RENDERER] Flushing ${logQueue.length} queued logs`);
            // 延迟一下确保渲染进程完全准备好
            setTimeout(() => {
                flushLogQueue();
            }, 100);
        }
    });

    // 监听渲染进程崩溃
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('[RENDERER] Renderer process gone:', details.reason);
        isRendererReady = false;
        logQueue = []; // 清空队列
    });

    // 监听页面卸载
    mainWindow.webContents.on('did-start-loading', () => {
        isRendererReady = false;
    });
}

function createTray() {
    console.log('Creating system tray...');

    // macOS 和 Windows 使用原有逻辑
    const trayIcon = createDefaultIcon();

    if (!trayIcon) {
        console.error('Failed to create tray icon!');
        return;
    }

    console.log('Creating Tray with icon...');
    tray = new Tray(trayIcon);

    if (tray) {
        console.log('Tray created successfully');
        tray.setToolTip(APP_CONFIG.name);
        console.log(`Tray tooltip set to: ${APP_CONFIG.name}`);

        // macOS: 隐藏Dock图标，只保留菜单栏托盘
        if (process.platform === 'darwin') {
            console.log('macOS tray created - Dock icon hidden, menu bar only');
        }
    } else {
        console.error('Failed to create tray');
        return;
    }

    // 创建托盘后立即设置正确的菜单状态和事件监听器
    updateTrayMenu();
}

function createPermissionWizardWindow(permissions = []) {
    if (permissionWizardWindow) {
        permissionWizardWindow.focus();
        return;
    }

    try {
        permissionWizardWindow = new BrowserWindow({
            width: 800,
            height: 600,
            minWidth: 600,
            minHeight: 500,
            modal: true,
            parent: mainWindow || undefined,
            show: false,
            resizable: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload-js.js')
            },
            title: '权限设置向导 - 企业安全',
            titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
            vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
            icon: createDefaultIcon()
        });

        // 加载权限向导页面
        const wizardPath = path.join(__dirname, 'renderer', 'permission-wizard.html');
        permissionWizardWindow.loadFile(wizardPath)
            .then(() => {
                console.log('Permission wizard loaded successfully');
                permissionWizardWindow.show();
                // 发送权限信息到渲染进程
                permissionWizardWindow.webContents.send('init-permission-wizard', { permissions });
                sendLogToRenderer('权限向导已打开');
            })
            .catch(error => {
                console.error('Failed to load permission wizard:', error);
                // 如果无法加载权限向导，显示简单的对话框
                showPermissionFallback(permissions);
                if (permissionWizardWindow) {
                    permissionWizardWindow.close();
                }
            });

        permissionWizardWindow.on('closed', () => {
            permissionWizardWindow = null;
            sendLogToRenderer('权限向导已关闭');
        });

        // 处理权限向导的错误
        permissionWizardWindow.webContents.on('crashed', () => {
            console.error('Permission wizard crashed');
            sendLogToRenderer('权限向导崩溃', 'error');
        });

        permissionWizardWindow.webContents.on('unresponsive', () => {
            console.warn('Permission wizard became unresponsive');
            sendLogToRenderer('权限向导无响应', 'warning');
        });

    } catch (error) {
        console.error('Error creating permission wizard:', error);
        sendLogToRenderer('创建权限向导失败: ' + error.message, 'error');
        showPermissionFallback(permissions);
    }
}

function showPermissionFallback(permissions) {
    // 简单的权限提示对话框作为后备方案
    const { dialog } = require('electron');
    const message = `需要以下权限才能正常工作：\n\n${permissions.join('\n')}\n\n请手动在系统设置中授予这些权限。`;
    
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '权限设置',
        message: '权限设置提醒',
        detail: message,
        buttons: ['确定', '稍后设置'],
        defaultId: 0
    }).then((result) => {
        if (result.response === 0) {
            sendLogToRenderer('用户确认权限设置提醒');
        } else {
            sendLogToRenderer('用户选择稍后设置权限');
        }
    }).catch(error => {
        console.error('Error showing permission fallback dialog:', error);
    });
}

function createDefaultIcon() {
    const platform = process.platform;
    console.log(`[TRAY_ICON] Creating default tray icon for platform: ${platform}`);

    // ========================================
    // 优先尝试从文件加载托盘图标
    // ========================================

    // macOS: 使用 Template Image (黑白图标)
    if (platform === 'darwin') {
        try {
            // 尝试加载 trayTemplate.png (支持 @2x retina)
            const trayIconPath = app.isPackaged
                ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icons', 'trayTemplate.png')
                : path.join(__dirname, '..', 'assets', 'icons', 'trayTemplate.png');

            console.log('[MACOS_TRAY] 尝试加载托盘图标文件:', trayIconPath);

            if (fs.existsSync(trayIconPath)) {
                const icon = nativeImage.createFromPath(trayIconPath);
                if (!icon.isEmpty()) {
                    icon.setTemplateImage(true); // macOS Template Image 模式
                    console.log('[MACOS_TRAY] ✅ 托盘图标加载成功 (Template Image)');
                    return icon;
                }
            } else {
                console.log('[MACOS_TRAY] 托盘图标文件不存在，尝试备选方案');
            }
        } catch (error) {
            console.log('[MACOS_TRAY] 加载托盘图标失败:', error.message);
        }
    }

    // Windows: 使用彩色图标
    if (platform === 'win32') {
        try {
            const trayIconPath = app.isPackaged
                ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icons', 'tray-icon.png')
                : path.join(__dirname, '..', 'assets', 'icons', 'tray-icon.png');

            console.log('[WINDOWS_TRAY] 尝试加载托盘图标文件:', trayIconPath);

            if (fs.existsSync(trayIconPath)) {
                const icon = nativeImage.createFromPath(trayIconPath);
                if (!icon.isEmpty()) {
                    console.log('[WINDOWS_TRAY] ✅ 托盘图标加载成功');
                    return icon;
                }
            } else {
                console.log('[WINDOWS_TRAY] 托盘图标文件不存在，尝试备选方案');
            }
        } catch (error) {
            console.log('[WINDOWS_TRAY] 加载托盘图标失败:', error.message);
        }
    }

    // ========================================
    // 备选方案：动态生成图标
    // ========================================
    console.log('[TRAY_ICON] 使用动态生成的备选图标');

    // Linux平台：创建彩色PNG图标（Linux托盘图标通常需要彩色）
    if (platform === 'linux') {
        try {
            console.log('[LINUX_TRAY] Creating Linux tray icon (PNG format)...');
            // Linux托盘图标使用彩色SVG，22x22是常见尺寸
            const linuxIconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
                <circle cx="11" cy="11" r="10" fill="#4A90D9"/>
                <circle cx="11" cy="9" r="3" fill="#ffffff"/>
                <rect x="8" y="14" width="6" height="2" rx="1" fill="#ffffff"/>
            </svg>`;

            const iconBuffer = Buffer.from(linuxIconSvg);
            const icon = nativeImage.createFromBuffer(iconBuffer);

            if (!icon.isEmpty()) {
                console.log('[LINUX_TRAY] Linux tray icon created successfully');
                return icon;
            }
        } catch (error) {
            console.log('[LINUX_TRAY] SVG icon creation failed:', error.message);
        }

        // Linux备选方案：创建简单的彩色PNG
        try {
            console.log('[LINUX_TRAY] Creating fallback solid color icon...');
            const fallbackSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">
                <rect width="22" height="22" fill="#4A90D9" rx="4"/>
                <text x="11" y="15" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#ffffff">ES</text>
            </svg>`;

            const iconBuffer = Buffer.from(fallbackSvg);
            const icon = nativeImage.createFromBuffer(iconBuffer);

            if (!icon.isEmpty()) {
                console.log('[LINUX_TRAY] Fallback icon created successfully');
                return icon;
            }
        } catch (error) {
            console.log('[LINUX_TRAY] Fallback icon creation failed:', error.message);
        }
    }

    // macOS平台：使用Template Image格式
    if (platform === 'darwin') {
        try {
            console.log('[MACOS_TRAY] Creating macOS template icon...');
            // macOS托盘图标应该是黑白的，并使用template image模式
            const macOSIconSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="7" fill="none" stroke="#000000" stroke-width="2"/>
                <circle cx="8" cy="6" r="1.5" fill="#000000"/>
                <rect x="6" y="10" width="4" height="1" fill="#000000"/>
            </svg>`;

            const iconBuffer = Buffer.from(macOSIconSvg);
            const icon = nativeImage.createFromBuffer(iconBuffer);

            // 使用Template Image模式（这是macOS推荐的方式）
            icon.setTemplateImage(true);
            console.log('[MACOS_TRAY] macOS template icon created successfully');
            return icon;
        } catch (error) {
            console.log('[MACOS_TRAY] Template icon creation failed:', error.message);
        }

        // macOS备选：尝试使用系统图标
        try {
            console.log('[MACOS_TRAY] Trying macOS native system icon...');
            const systemIcon = nativeImage.createFromNamedImage('NSApplicationIcon');
            if (!systemIcon.isEmpty()) {
                const resizedIcon = systemIcon.resize({ width: 16, height: 16 });
                resizedIcon.setTemplateImage(false);
                console.log('[MACOS_TRAY] macOS system icon created successfully');
                return resizedIcon;
            }
        } catch (error) {
            console.log('[MACOS_TRAY] System icon creation failed:', error.message);
        }
    }

    // Windows平台或通用备选方案：创建实心图标
    try {
        console.log('[TRAY_ICON] Creating solid icon (Windows/fallback)...');
        const solidIconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <rect x="0" y="0" width="16" height="16" fill="#000000"/>
            <rect x="2" y="2" width="12" height="12" fill="#ffffff"/>
            <rect x="4" y="4" width="8" height="8" fill="#000000"/>
            <text x="8" y="11" text-anchor="middle" font-family="Arial, sans-serif" font-size="6" fill="#ffffff">安</text>
        </svg>`;

        const iconBuffer = Buffer.from(solidIconSvg);
        const icon = nativeImage.createFromBuffer(iconBuffer);

        if (platform === 'darwin') {
            icon.setTemplateImage(false);
        }

        console.log('[TRAY_ICON] Solid icon created successfully');
        return icon;
    } catch (error) {
        console.log('[TRAY_ICON] Solid icon creation failed:', error.message);
    }
    
    // 方法2: 创建简单的PNG数据图标
    try {
        console.log('Creating PNG data icon...');
        // 创建一个16x16的简单PNG图标数据
        // 这是一个最小的有效PNG，16x16像素，每像素3字节RGB
        const width = 16;
        const height = 16;
        
        // 简单创建PNG头部和数据
        const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        
        // IHDR chunk - 图像头部信息
        const ihdrLength = Buffer.from([0x00, 0x00, 0x00, 0x0D]);
        const ihdrType = Buffer.from('IHDR');
        const ihdrData = Buffer.concat([
            Buffer.from([0x00, 0x00, 0x00, 0x10]), // width: 16
            Buffer.from([0x00, 0x00, 0x00, 0x10]), // height: 16
            Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]) // 8-bit RGB, no compression, no filter, no interlace
        ]);
        const ihdrCrc = Buffer.from([0x90, 0x91, 0x68, 0x36]); // 预计算的CRC
        
        // IDAT chunk - 图像数据 (简化的白色背景图像)
        const idatLength = Buffer.from([0x00, 0x00, 0x00, 0x3E]);
        const idatType = Buffer.from('IDAT');
        const idatData = Buffer.from([
            0x78, 0x9C, // zlib header
            0x63, 0x00, 0x03, 0x00, 0x00, 0x50, 0x00, 0x01, // 简化的压缩数据
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x3D, 0xCF
        ]);
        const idatCrc = Buffer.from([0x1D, 0x9A, 0x34, 0x5E]); // 预计算的CRC
        
        // IEND chunk - 结束标记
        const iendLength = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        const iendType = Buffer.from('IEND');
        const iendCrc = Buffer.from([0xAE, 0x42, 0x60, 0x82]);
        
        // 组合所有PNG数据
        const pngData = Buffer.concat([
            pngSignature,
            ihdrLength, ihdrType, ihdrData, ihdrCrc,
            idatLength, idatType, idatData, idatCrc,
            iendLength, iendType, iendCrc
        ]);
        
        const icon = nativeImage.createFromBuffer(pngData);
        if (process.platform === 'darwin') {
            icon.setTemplateImage(false);
        }
        
        console.log('PNG data icon created successfully');
        return icon;
    } catch (error) {
        console.log('PNG data creation failed:', error.message);
    }
    
    // 方法2: 尝试使用macOS原生的icns文件
    try {
        const icnsPath = path.join(__dirname, '..', 'assets', 'icons', 'icon.icns');
        if (require('fs').existsSync(icnsPath)) {
            console.log('Loading ICNS file:', icnsPath);
            const icon = nativeImage.createFromPath(icnsPath);
            // 调整大小到16x16
            const resizedIcon = icon.resize({ width: 16, height: 16 });
            console.log('ICNS icon loaded and resized successfully');
            return resizedIcon;
        }
    } catch (error) {
        console.log('ICNS file loading failed:', error.message);
    }
    
    // 方法2: 尝试使用ico文件
    try {
        const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'icon.ico');
        if (require('fs').existsSync(iconPath)) {
            console.log('Loading ICO file:', iconPath);
            const icon = nativeImage.createFromPath(iconPath);
            // 调整大小到16x16
            const resizedIcon = icon.resize({ width: 16, height: 16 });
            console.log('ICO icon loaded and resized successfully');
            return resizedIcon;
        }
    } catch (error) {
        console.log('ICO file loading failed:', error.message);
    }
    
    // 方法3: 创建一个简单的二进制PNG图标
    console.log('Creating binary PNG icon...');
    try {
        // 创建一个16x16的PNG二进制数据，确保不透明
        // 这是一个最小化的PNG图标，灰色背景，白色方块
        const pngData = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
            0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10, // 16x16 dimensions
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x91, 0x68, // bit depth=8, color type=2 (RGB)
            0x36, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, // rest of IHDR
            0x73, 0x00, 0x00, 0x0B, 0x13, 0x00, 0x00, 0x0B,
            0x13, 0x01, 0x00, 0x9A, 0x9C, 0x18, 0x00, 0x00,
            0x00, 0x2E, 0x49, 0x44, 0x41, 0x54, 0x28, 0x15, // IDAT chunk with simple pattern
            0x63, 0x60, 0x60, 0x60, 0xF8, 0x0F, 0x00, 0x01,
            0x01, 0x01, 0x01, 0x00, 0x02, 0x02, 0x02, 0x02,
            0x00, 0x03, 0x03, 0x03, 0x03, 0x00, 0x04, 0x04,
            0x04, 0x04, 0x00, 0x05, 0x05, 0x05, 0x05, 0x00,
            0x06, 0x06, 0x06, 0x06, 0x00, 0x07, 0x07, 0x07,
            0x07, 0x00, 0x08, 0x08, 0x08, 0x08, 0x2A, 0x94,
            0x77, 0x4E, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
            0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82 // IEND chunk
        ]);
        
        const icon = nativeImage.createFromBuffer(pngData);
        console.log('Binary PNG icon created successfully');
        return icon;
    } catch (binaryError) {
        console.log('Binary PNG method failed:', binaryError.message);
    }
    
    // 方法4: 如果Canvas不可用，创建简单的SVG
    console.log('Creating SVG fallback icon...');
    const svgIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <rect width="16" height="16" fill="#333333"/>
        <rect x="4" y="4" width="8" height="8" fill="#FFFFFF"/>
        <rect x="7" y="7" width="2" height="2" fill="#333333"/>
    </svg>`;
    
    const iconBuffer = Buffer.from(svgIcon);
    const icon = nativeImage.createFromBuffer(iconBuffer);
    console.log('SVG icon created successfully');
    return icon;
}

function createFallbackHtml() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>企业安全</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            padding: 15px; text-align: center; 
            background: #f8f9fa; color: #333; margin: 0;
            width: 280px; height: 320px; overflow: hidden;
        }
        .container { max-width: 250px; margin: 0 auto; }
        h1 { font-size: 16px; margin-bottom: 15px; color: #007AFF; }
        .status { padding: 8px; background: #e3f2fd; 
                 border-radius: 4px; margin: 8px 0; font-size: 12px; }
        button { padding: 6px 12px; margin: 3px; border: none; 
                border-radius: 4px; background: #007AFF; color: white; 
                font-size: 11px; cursor: pointer; }
        button:hover { background: #0056CC; }
        .logs { background: #2d3748; color: white; padding: 6px;
                border-radius: 4px; height: 60px; overflow-y: auto;
                font-family: monospace; font-size: 9px; margin: 8px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>企业安全</h1>
        <div class="status" id="status">就绪</div>
        <button onclick="startService()">启动</button>
        <button onclick="stopService()">停止</button>
        <button onclick="checkStatus()">查看状态</button>
        <button onclick="checkPermissions()">查看权限</button>
        <div class="logs" id="logs">[启动] 应用程序已就绪</div>
        <button onclick="minimizeToTray()">最小化到托盘</button>
    </div>
    <script>
        function startService() { 
            document.getElementById('status').textContent = '启动中...';
            window.electronAPI?.app.start().then(() => {
                document.getElementById('status').textContent = '运行中';
            });
        }
        function stopService() { 
            document.getElementById('status').textContent = '停止中...';
            window.electronAPI?.app.stop().then(() => {
                document.getElementById('status').textContent = '已停止';
            });
        }
        function checkStatus() {
            window.electronAPI?.app.getStatus().then(status => {
                document.getElementById('status').textContent = 
                    status?.isRunning ? '运行中' : '已停止';
            });
        }
        function checkPermissions() {
            document.getElementById('logs').innerHTML += '<br>[权限] 正在检查权限...';
        }
        function minimizeToTray() {
            window.electronAPI?.window.minimize();
        }
    </script>
</body>
</html>`;
}

// IPC处理器 - 只保留核心功能
function setupIPCHandlers() {
    console.log('[IPC_SETUP] 🔧 Starting IPC handler registration...');

    // 应用控制
    console.log('[IPC_SETUP] Registering app:start handler...');
    ipcMain.handle('app:start', async () => {
        return await startAppService(true); // true = manual user start
    });
    console.log('[IPC_SETUP] ✅ app:start registered');

    console.log('[IPC_SETUP] Registering app:stop handler...');
    ipcMain.handle('app:stop', async () => {
        return await stopAppService();
    });
    console.log('[IPC_SETUP] ✅ app:stop registered');

    console.log('[IPC_SETUP] Registering app:getStatus handler...');
    ipcMain.handle('app:getStatus', async () => {
        if (app_instance) {
            try {
                // 获取应用状态 - 更精确的状态检查，优先使用FSM状态
                let appState = 'UNKNOWN';
                let isRunning = false;
                let deviceState = currentState;
                let stateMachine = null;
                
                // 首先获取FSM状态
                if (app_instance.getStateMachine && typeof app_instance.getStateMachine === 'function') {
                    stateMachine = app_instance.getStateMachine();
                    if (stateMachine && typeof stateMachine.getCurrentState === 'function') {
                        deviceState = stateMachine.getCurrentState();
                        // 更新当前状态缓存
                        currentState = deviceState;
                    }
                }
                
                // 基于FSM状态判断应用是否运行中 - 修复状态判断逻辑
                const runningStates = ['DATA_COLLECT', 'CONFIG_FETCH', 'WS_CHECK', 'HEARTBEAT', 'BIND_CHECK', 'REGISTER'];
                const errorStates = ['ERROR', 'DISCONNECT'];

                // ✅ 关键修复：改进状态判断逻辑
                // 运行中的条件：在运行状态 OR (FSM服务已启动 AND 不在错误状态)
                let fsmIsRunning = false;
                if (stateMachine && typeof stateMachine.isServiceRunning === 'function') {
                    const serviceRunning = stateMachine.isServiceRunning();
                    const inRunningState = runningStates.includes(deviceState);
                    const inErrorState = errorStates.includes(deviceState);

                    // 只要满足以下任一条件就认为是运行中：
                    // 1. 在运行状态列表中（DATA_COLLECT, REGISTER, BIND_CHECK等）
                    // 2. FSM服务已启动且不在错误状态（包括INIT, UNBOUND等）
                    fsmIsRunning = inRunningState || (serviceRunning && !inErrorState);

                    console.log(`[STATUS] FSM state: ${deviceState}, Service running: ${serviceRunning}, In running state: ${inRunningState}, In error state: ${inErrorState}, Final running: ${fsmIsRunning}`);
                } else {
                    // 降级到旧逻辑
                    fsmIsRunning = runningStates.includes(deviceState);
                }
                
                const fsmIsInError = errorStates.includes(deviceState);
                
                // 获取App的状态
                let appGetStateResult = null;
                if (app_instance.getState && typeof app_instance.getState === 'function') {
                    appGetStateResult = app_instance.getState();
                }
                
                // 修复状态优先级逻辑：
                // 1. 如果FSM处于错误状态，强制设置为停止
                // 2. 如果FSM在运行状态，则应用运行中
                // 3. 否则使用App的状态
                if (fsmIsInError) {
                    isRunning = false;
                    appState = 'STOPPED';
                } else if (fsmIsRunning) {
                    isRunning = true;
                    appState = 'RUNNING';
                } else if (app_instance.isRunning && typeof app_instance.isRunning === 'function') {
                    isRunning = app_instance.isRunning();
                    appState = isRunning ? 'RUNNING' : 'STOPPED';
                } else if (appGetStateResult) {
                    appState = appGetStateResult;
                    isRunning = appState === 'RUNNING';
                } else {
                    // 最后的兜底逻辑
                    appState = deviceState === 'INIT' ? 'STARTING' : 'STOPPED';
                    isRunning = false;
                }
                
                // 获取详细状态（如果可用）
                let detailedStatus = {};
                if (typeof app_instance.getDetailedStatus === 'function') {
                    detailedStatus = await app_instance.getDetailedStatus();
                }
                
                // deviceState is already obtained above
                
                console.log(`[STATUS_CHECK] App state: ${appState}, Running: ${isRunning}, Device state: ${deviceState}`);
                
                return {
                    isRunning,
                    appState,
                    deviceState,
                    platform: os.platform(),
                    hostname: os.hostname(),
                    ...detailedStatus
                };
            } catch (error) {
                console.error('[STATUS_CHECK] Error getting status:', error);
                return { 
                    isRunning: false, 
                    appState: 'ERROR',
                    error: error.message,
                    platform: os.platform(),
                    hostname: os.hostname()
                };
            }
        }
        return {
            isRunning: false,
            appState: 'STOPPED',
            platform: os.platform(),
            hostname: os.hostname(),
            message: 'App instance not available'
        };
    });

    // 权限管理 (removed duplicate - handled below)

    // 窗口控制
    ipcMain.handle('window:minimize', async () => {
        if (mainWindow) {
            mainWindow.hide();
            return { success: true };
        }
        return { success: false };
    });

    // 配置管理
    ipcMain.handle('config:get', async () => {
        return await getAppConfig();
    });

    ipcMain.handle('config:update', async (event, newConfig) => {
        return await updateAppConfig(newConfig);
    });

    // 日志管理
    ipcMain.handle('log:add', async (event, logData) => {
        // 转发日志到渲染进程
        if (mainWindow) {
            mainWindow.webContents.send('log:received', logData);
        }
        return { success: true };
    });

    // 获取UI日志
    ipcMain.handle('log:getUILogs', async () => {
        if (logManager) {
            return { success: true, data: logManager.getUILogs() };
        }
        return { success: false, error: '日志管理器未初始化' };
    });

    // 获取日志统计信息
    ipcMain.handle('log:getStats', async () => {
        if (logManager) {
            return { success: true, data: logManager.getLogStats() };
        }
        return { success: false, error: '日志管理器未初始化' };
    });

    // 清理旧日志文件
    ipcMain.handle('log:cleanup', async (event, maxDays = 30) => {
        if (logManager) {
            try {
                logManager.cleanupOldLogs(maxDays);
                return { success: true, message: '日志清理完成' };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
        return { success: false, error: '日志管理器未初始化' };
    });

    // 自启动管理
    ipcMain.handle('autostart:enable', async () => {
        try {
            if (app_instance && app_instance.getPlatformAdapter) {
                console.log('[AUTO_START] App instance available, enabling auto-start...');

                // 注意：这里只设置开机自启动，不启动监控服务
                // 用户需要手动点击"启动服务"按钮来启动监控

                // 检查 app 状态，如果正在启动中，等待完成
                const appState = app_instance.getState ? app_instance.getState() : null;
                console.log('[AUTO_START] Current app state:', appState);

                if (appState === 'starting' || appState === 'STARTING') {
                    console.log('[AUTO_START] App is starting, waiting for initialization to complete...');
                    sendLogToRenderer('⏳ 正在等待应用初始化完成...', 'info');

                    // 等待最多30秒让 app 完成启动
                    const maxWaitTime = 30000;
                    const checkInterval = 1000;
                    const startTime = Date.now();

                    while (Date.now() - startTime < maxWaitTime) {
                        const currentState = app_instance.getState ? app_instance.getState() : null;
                        if (currentState === 'running' || currentState === 'RUNNING') {
                            console.log('[AUTO_START] App initialization completed');
                            break;
                        }

                        // 等待1秒后再检查
                        await new Promise(resolve => setTimeout(resolve, checkInterval));
                    }

                    const finalState = app_instance.getState ? app_instance.getState() : null;
                    if (finalState !== 'running' && finalState !== 'RUNNING') {
                        console.log('[AUTO_START] App initialization timeout, current state:', finalState);
                        sendLogToRenderer('⚠️ 应用初始化超时，请稍后再试', 'warning');
                        return { success: false, error: '应用正在初始化中，请稍后再试' };
                    }
                }

                console.log('[AUTO_START] Getting platform adapter...');
                const platformAdapter = app_instance.getPlatformAdapter();
                console.log('[AUTO_START] Platform adapter:', platformAdapter ? 'available' : 'not available');

                if (platformAdapter && typeof platformAdapter.enableAutoStart === 'function') {
                    console.log('[AUTO_START] enableAutoStart method available, calling...');
                    const result = await platformAdapter.enableAutoStart();
                    if (result) {
                        sendLogToRenderer('自启动已开启', 'success');

                        // 推送状态变化到渲染进程
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            console.log('[AUTO_START] Sending autostart-status-changed event to renderer (enabled: true)');
                            mainWindow.webContents.send('autostart-status-changed', { enabled: true });
                        }

                        return { success: true, message: '自启动开启成功' };
                    } else {
                        sendLogToRenderer('自启动开启失败', 'error');
                        return { success: false, error: '平台自启动功能调用失败' };
                    }
                }
            }
            sendLogToRenderer('自启动开启失败: 平台适配器不可用', 'error');
            return { success: false, error: '平台适配器不可用' };
        } catch (error) {
            sendLogToRenderer('自启动开启错误: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('autostart:disable', async () => {
        try {
            if (app_instance && app_instance.getPlatformAdapter) {
                console.log('[AUTO_START] Disabling auto-start, checking app state...');
                
                // Check if app is properly initialized/started
                const appState = app_instance.getState ? app_instance.getState() : null;
                console.log('[AUTO_START] App state:', appState);
                
                // If app is not running, try to start it first to get platform adapter
                if (appState !== 'running' && appState !== 'RUNNING') {
                    console.log('[AUTO_START] App not running, starting app service first...');
                    try {
                        const startResult = await startAppService(true); // true = manual start
                        if (startResult && startResult.success) {
                            console.log('[AUTO_START] App service started for disable operation...');
                            // Wait a moment for platform adapter to initialize
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    } catch (startError) {
                        console.log('[AUTO_START] Error starting app for disable operation:', startError);
                    }
                }
                
                const platformAdapter = app_instance.getPlatformAdapter();
                console.log('[AUTO_START] Platform adapter:', platformAdapter ? 'available' : 'not available');
                
                if (platformAdapter && typeof platformAdapter.disableAutoStart === 'function') {
                    const result = await platformAdapter.disableAutoStart();
                    if (result) {
                        sendLogToRenderer('自启动已关闭', 'warning');

                        // 推送状态变化到渲染进程
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            console.log('[AUTO_START] Sending autostart-status-changed event to renderer (enabled: false)');
                            mainWindow.webContents.send('autostart-status-changed', { enabled: false });
                        }

                        return { success: true, message: '自启动关闭成功' };
                    } else {
                        sendLogToRenderer('自启动关闭失败', 'error');
                        return { success: false, error: '平台自启动功能调用失败' };
                    }
                }
            }
            sendLogToRenderer('自启动关闭失败: 平台适配器不可用', 'error');
            return { success: false, error: '平台适配器不可用' };
        } catch (error) {
            sendLogToRenderer('自启动关闭错误: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('autostart:status', async () => {
        try {
            if (app_instance && app_instance.getPlatformAdapter) {
                // 检查 app 状态，如果正在启动中，返回特殊状态而不是错误
                const appState = app_instance.getState ? app_instance.getState() : null;

                if (appState === 'starting' || appState === 'STARTING') {
                    console.log('[AUTO_START] App is starting, status check will retry later');
                    return { success: false, error: '应用正在初始化中', initializing: true };
                }

                const platformAdapter = app_instance.getPlatformAdapter();
                if (platformAdapter && typeof platformAdapter.isAutoStartEnabled === 'function') {
                    const result = await platformAdapter.isAutoStartEnabled();
                    return { success: true, enabled: result };
                }
            }
            return { success: false, error: '平台适配器不可用' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 权限管理
    ipcMain.handle('permission:check', async () => {
        try {
            const permissions = await checkSystemPermissions();
            return { success: true, data: permissions };
        } catch (error) {
            console.error('Error checking permissions:', error);
            sendLogToRenderer('权限检查失败: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('permission:request', async (event, permissions) => {
        try {
            sendLogToRenderer('正在请求权限...');
            const result = await requestSystemPermissions(permissions);
            sendLogToRenderer('权限请求完成');
            return { success: true, data: result };
        } catch (error) {
            console.error('Error requesting permissions:', error);
            sendLogToRenderer('权限请求失败: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    });

    // 新增：主动权限请求处理器  
    ipcMain.handle('permission:requestAll', async () => {
        try {
            sendLogToRenderer('开始主动请求所有必需权限...');
            const result = await requestSystemPermissions([]);
            return { success: true, data: result };
        } catch (error) {
            console.error('Error requesting all permissions:', error);
            sendLogToRenderer('权限请求失败: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    });

    // 系统设置打开处理器
    ipcMain.handle('system:openSystemPreferences', async () => {
        try {
            if (process.platform === 'darwin') {
                await openScreenRecordingSettings();
                return { success: true };
            } else {
                sendLogToRenderer('此功能仅支持macOS系统', 'warning');
                return { success: false, error: '不支持的平台' };
            }
        } catch (error) {
            console.error('Error opening system preferences:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('permission:showWizard', async (event, permissions = []) => {
        try {
            createPermissionWizardWindow(permissions);
            return { success: true };
        } catch (error) {
            console.error('Error showing permission wizard:', error);
            sendLogToRenderer('打开权限向导失败: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    });

    // FSM状态管理 (如果主应用可用)
    ipcMain.handle('fsm:getCurrentState', () => {
        try {
            if (app_instance && typeof app_instance.getCurrentState === 'function') {
                return { success: true, data: { state: app_instance.getCurrentState() } };
            }
            return { success: true, data: { state: currentState } };
        } catch (error) {
            console.error('Error getting FSM state:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('fsm:forceTransition', async (event, targetState) => {
        try {
            if (app_instance && typeof app_instance.forceStateTransition === 'function') {
                await app_instance.forceStateTransition(targetState);
                sendLogToRenderer(`强制状态转换到: ${targetState}`);
                return { success: true };
            } else {
                // 模拟状态转换
                currentState = targetState;
                sendLogToRenderer(`模拟状态转换到: ${targetState}`);
                return { success: true };
            }
        } catch (error) {
            console.error('Error forcing state transition:', error);
            sendLogToRenderer('状态转换失败: ' + error.message, 'error');
            return { success: false, error: error.message };
        }
    });

    console.log('[IPC_SETUP] ✅ All IPC handlers registered successfully');
}

// ========================================
// 热更新后自动启动检测
// ========================================

/**
 * 同步检查是否存在热更新标志文件
 * 用于在窗口显示前判断是否应该隐藏窗口
 */
function hasAutoStartFlag() {
    try {
        const fs = require('fs');
        const path = require('path');
        const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');

        if (fs.existsSync(flagPath)) {
            // 验证时间戳
            try {
                const flagContent = fs.readFileSync(flagPath, 'utf-8');
                const flagData = JSON.parse(flagContent);
                const age = Date.now() - flagData.timestamp;
                const maxAge = 5 * 60 * 1000; // 5分钟

                if (age > maxAge) {
                    // 标志已过期，删除
                    fs.unlinkSync(flagPath);
                    return false;
                }

                return true;
            } catch (e) {
                return false;
            }
        }

        return false;
    } catch (error) {
        return false;
    }
}

/**
 * 检查热更新后自动启动标志
 * 如果检测到标志文件，说明刚完成热更新重启，需要自动启动服务
 */
async function checkAndAutoStartAfterUpdate() {
    try {
        const fs = require('fs');
        const path = require('path');
        const flagPath = path.join(app.getPath('userData'), 'auto-start-after-update.flag');

        console.log('[AUTO_START] Checking for update flag:', flagPath);

        if (fs.existsSync(flagPath)) {
            console.log('[AUTO_START] ✅ Update flag detected!');

            // 读取标志文件内容
            let flagData = null;
            try {
                const flagContent = fs.readFileSync(flagPath, 'utf-8');
                flagData = JSON.parse(flagContent);
                console.log('[AUTO_START] Flag data:', flagData);
            } catch (parseError) {
                console.warn('[AUTO_START] Failed to parse flag data:', parseError.message);
            }

            // ⏰ 时间戳验证（5分钟内有效，防止标志文件残留）
            if (flagData && flagData.timestamp) {
                const age = Date.now() - flagData.timestamp;
                const maxAge = 5 * 60 * 1000; // 5分钟

                if (age > maxAge) {
                    console.log('[AUTO_START] ⚠️ Flag expired (age:', age, 'ms), ignoring');
                    fs.unlinkSync(flagPath);
                    console.log('[AUTO_START] Expired flag file deleted');
                    return;
                }

                console.log('[AUTO_START] Flag is valid (age:', age, 'ms)');
            }

            // 立即删除标志文件（避免下次启动重复触发）
            fs.unlinkSync(flagPath);
            console.log('[AUTO_START] ✅ Flag file deleted');

            // ⏰ 延迟启动（等待应用完全初始化）
            setTimeout(async () => {
                console.log('[AUTO_START] ⏰ Triggering auto-start after hot update...');
                sendLogToRenderer('[自动启动] 检测到热更新完成，正在自动启动服务...');

                try {
                    // 🎯 调用启动服务逻辑（与点击启动按钮完全相同）
                    const result = await startAppService(false); // false = 自动启动模式

                    if (result && result.success) {
                        console.log('[AUTO_START] ✅ Service auto-started successfully after update');
                        console.log('[AUTO_START] 🔽 App running in background mode with tray icon (window never shown)');
                        sendLogToRenderer('[自动启动] 服务已自动启动成功，应用在后台运行');
                    } else {
                        console.error('[AUTO_START] ❌ Auto-start failed:', result?.message);
                        sendLogToRenderer('[自动启动] 服务自动启动失败: ' + (result?.message || '未知错误'), 'error');
                    }
                } catch (error) {
                    console.error('[AUTO_START] ❌ Auto-start exception:', error.message);
                    sendLogToRenderer('[自动启动] 服务自动启动异常: ' + error.message, 'error');
                }
            }, 3000); // 延迟3秒，确保FSM、网络检查等都完成

        } else {
            console.log('[AUTO_START] No update flag detected, normal startup');
        }
    } catch (error) {
        console.error('[AUTO_START] ❌ Error checking update flag:', error.message);
    }
}

// ========================================
// 辅助函数
// ========================================

async function startAppService(isManualStart = false) {
    // 发送日志到渲染进程
    sendLogToRenderer('正在启动服务...');
    
    // 如果是手动启动，清除手动暂停标志
    if (isManualStart) {
        manuallyPaused = false;
        console.log('[START] Manual start - clearing manuallyPaused flag');
    } else {
        // 如果是自动启动，检查手动暂停标志
        if (manuallyPaused) {
            console.log('[START] Blocked automatic start due to manual pause flag');
            sendLogToRenderer('自动启动已阻止：用户手动暂停');
            return { success: false, message: 'Automatic start blocked due to manual pause' };
        }
    }
    
    console.log(`[START] Starting service (manual: ${isManualStart}, manuallyPaused: ${manuallyPaused})`);
    
    if (app_instance) {
        try {
            // 监听应用事件并转发日志
            setupAppLogging();

            // ✅ 检查监控状态，防止重复启动
            let monitoringState = null;
            if (typeof app_instance.getMonitoringState === 'function') {
                monitoringState = app_instance.getMonitoringState();
                console.log('[START] Current monitoring state:', monitoringState);
            }

            // 🔒 关键修复：检查所有非stopped状态，防止并发启动导致Promise挂起
            // 活跃状态包括：running（运行中）、starting（启动中）、connecting（连接中）、
            // registering（注册中）、heartbeat（心跳中）等所有工作状态
            const activeStates = ['running', 'starting', 'connecting', 'registering', 'heartbeat',
                                  'bind_check', 'ws_check', 'config_fetch', 'data_collect'];

            // 安全转换 monitoringState 为字符串
            const stateStr = monitoringState ? String(monitoringState).toLowerCase() : null;

            if (stateStr && activeStates.includes(stateStr)) {
                console.log('[START] Monitoring already active (state:', monitoringState, '), skipping duplicate start');
                sendLogToRenderer(`监控服务已激活 (${monitoringState})`);
                updateTrayIcon(true);
                updateTrayMenu();

                // 立即广播状态
                broadcastStatusUpdate();

                return { success: true, message: `Service already active: ${monitoringState}`, alreadyRunning: true };
            }

            // 只有在明确的stopped状态或null（未初始化）时才允许启动
            console.log('[START] Monitoring state is:', monitoringState || 'null', '- proceeding with start');

            // 如果应用未初始化，先启动应用本身
            if (app_instance.getState?.() === 'stopped') {
                console.log('[START] Starting app instance first...');
                await app_instance.start();
                console.log('[START] App instance started, now starting monitoring...');
            }

            // 启动监控（FSM）
            if (typeof app_instance.startMonitoring === 'function') {
                console.log('[START] Calling startMonitoring()...');
                await app_instance.startMonitoring();
                updateTrayIcon(true);
                updateTrayMenu(); // 更新托盘菜单
                sendLogToRenderer('监控服务启动成功');
                console.log('[START] Monitoring started successfully, state:', app_instance.getMonitoringState?.());
            } else {
                // 兼容旧版本
                console.log('[START] Using legacy start()...');
                await app_instance.start();
                updateTrayIcon(true);
                updateTrayMenu();
                sendLogToRenderer('服务启动成功');
                console.log('[START] Service started (legacy mode), state:', app_instance.getState?.());
            }

            // 立即同步状态到UI
            setTimeout(() => {
                console.log('[START] Broadcasting status after start, app state:', app_instance.getState?.());
                broadcastStatusUpdate();
            }, 1000); // 给FSM一点时间来启动

            // 设置定期状态广播（每5秒）
            if (global.statusBroadcastInterval) {
                clearInterval(global.statusBroadcastInterval);
            }
            global.statusBroadcastInterval = setInterval(() => {
                broadcastStatusUpdate();
            }, 5000);

            return { success: true, message: 'Service started' };
        } catch (error) {
            console.error('[START] Error starting service:', error);
            console.error('[START] Error stack:', error.stack);
            sendLogToRenderer('启动失败: ' + error.message, 'error');
            return { success: false, message: error.message, error: error.stack };
        }
    }
    
    // === 建议2: 模拟模式强烈警告 ===
    updateTrayIcon(true);

    // 向日志发送警告
    sendLogToRenderer('⚠️⚠️⚠️ 警告：运行在模拟模式 ⚠️⚠️⚠️', 'error');
    sendLogToRenderer('核心监控功能不可用：截图、活动监测、数据上传均已禁用', 'error');
    sendLogToRenderer('这通常是因为应用打包配置错误导致主模块加载失败', 'error');
    sendLogToRenderer('请检查 ~/Library/Application Support/企业安全/module-load-diagnostic.json', 'error');

    // 更新托盘提示
    if (tray && !tray.isDestroyed()) {
        tray.setToolTip('⚠️ 企业安全 (模拟模式 - 功能受限)');
    }

    // 模拟状态更新
    setTimeout(() => {
        broadcastStatusUpdate();
    }, 1000);

    // 持续警告（每30秒一次）
    const simulationWarningInterval = setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('critical-warning', {
                title: '🚨 核心功能不可用',
                message: '主应用模块加载失败，监控功能已禁用。\n\n请重新安装应用或查看诊断文件：\n~/Library/Application Support/企业安全/module-load-diagnostic.json',
                severity: 'critical',
                persistent: true
            });
        }
    }, 30000);

    // 保存定时器以便清理
    global.simulationWarningInterval = simulationWarningInterval;

    return {
        success: false,  // 返回 false 表示实际上失败了
        message: '⚠️ Started in simulation mode - core features disabled',
        simulationMode: true
    };
}

// 新增：广播状态更新到UI
async function broadcastStatusUpdate() {
    try {
        if (mainWindow && mainWindow.webContents) {
            // 直接调用状态检查逻辑而不是通过IPC
            let status;
            if (app_instance) {
                try {
                    // 获取应用状态 - 更精确的状态检查，优先使用FSM状态
                    let appState = 'UNKNOWN';
                    let isRunning = false;
                    let deviceState = currentState;
                    
                    // 首先获取FSM状态
                    if (app_instance.getStateMachine && typeof app_instance.getStateMachine === 'function') {
                        const stateMachine = app_instance.getStateMachine();
                        if (stateMachine && typeof stateMachine.getCurrentState === 'function') {
                            deviceState = stateMachine.getCurrentState();
                            // 更新当前状态缓存
                            currentState = deviceState;
                        }
                    }
                    
                    // 基于FSM状态判断应用是否运行中 - 修复状态判断逻辑
                    const runningStates = ['DATA_COLLECT', 'CONFIG_FETCH', 'WS_CHECK', 'HEARTBEAT', 'BIND_CHECK', 'REGISTER'];
                    const errorStates = ['ERROR', 'DISCONNECT'];  // ✅ UNBOUND 不是错误，是正常的等待绑定状态

                    // ✅ 关键修复：改进状态判断逻辑（与 IPC 处理器保持一致）
                    // 运行中的条件：在运行状态 OR (FSM服务已启动 AND 不在错误状态)
                    let fsmIsRunning = false;
                    if (app_instance.getStateMachine && typeof app_instance.getStateMachine === 'function') {
                        const stateMachine = app_instance.getStateMachine();
                        if (stateMachine && typeof stateMachine.isServiceRunning === 'function') {
                            const serviceRunning = stateMachine.isServiceRunning();
                            const inRunningState = runningStates.includes(deviceState);
                            const inErrorState = errorStates.includes(deviceState);

                            // 只要满足以下任一条件就认为是运行中：
                            // 1. 在运行状态列表中（DATA_COLLECT, REGISTER, BIND_CHECK等）
                            // 2. FSM服务已启动且不在错误状态（包括INIT, UNBOUND等）
                            fsmIsRunning = inRunningState || (serviceRunning && !inErrorState);

                            console.log(`[BROADCAST] FSM state: ${deviceState}, Service running: ${serviceRunning}, In running state: ${inRunningState}, In error state: ${inErrorState}, Final running: ${fsmIsRunning}`);
                        } else {
                            // 降级到旧逻辑
                            fsmIsRunning = runningStates.includes(deviceState);
                        }
                    } else {
                        // 降级到旧逻辑
                        fsmIsRunning = runningStates.includes(deviceState);
                    }
                    
                    const fsmIsInError = errorStates.includes(deviceState);
                    
                    // 获取App的状态
                    let appGetStateResult = null;
                    if (app_instance.getState && typeof app_instance.getState === 'function') {
                        appGetStateResult = app_instance.getState();
                    }
                    
                    // ✅ 修复状态优先级逻辑：优先使用 FSM 状态，而不是 app.getState()
                    // FSM 才是真正在工作的部分，app.getState() 只是一个抽象状态
                    if (fsmIsInError) {
                        // 如果FSM处于错误状态，强制设置为停止
                        isRunning = false;
                        appState = 'STOPPED';
                        deviceState = 'ERROR';
                    } else if (fsmIsRunning) {
                        // ✅ 如果FSM在运行状态，则应用运行中（不管 app.getState() 返回什么）
                        isRunning = true;
                        appState = 'RUNNING';
                        // deviceState保持FSM的状态
                    } else {
                        // FSM 既不在运行也不在错误状态，使用 app.getState() 作为fallback
                        if (appGetStateResult === 'running') {
                            isRunning = true;
                            appState = 'RUNNING';
                        } else if (appGetStateResult === 'stopped') {
                            isRunning = false;
                            appState = 'STOPPED';
                            deviceState = 'INIT';
                        } else {
                            // 最后的兜底逻辑
                            isRunning = false;
                            appState = deviceState === 'INIT' ? 'STARTING' : 'STOPPED';
                            deviceState = 'INIT';
                        }
                    }
                    
                    // deviceState is already obtained above
                    
                    status = {
                        isRunning,
                        appState,
                        deviceState,
                        platform: os.platform(),
                        hostname: os.hostname()
                    };
                    
                } catch (error) {
                    console.error('[BROADCAST] Error getting status:', error);
                    status = { 
                        isRunning: false, 
                        appState: 'ERROR',
                        error: error.message,
                        platform: os.platform(),
                        hostname: os.hostname()
                    };
                }
            } else {
                status = {
                    isRunning: false,
                    appState: 'STOPPED',
                    platform: os.platform(),
                    hostname: os.hostname(),
                    message: 'App instance not available'
                };
            }
            
            console.log('[BROADCAST] Broadcasting status update:', status);
            mainWindow.webContents.send('app-status-changed', {
                isRunning: status.isRunning,
                appState: status.appState,
                deviceState: status.deviceState
            });
        }
    } catch (error) {
        console.error('[BROADCAST] Error broadcasting status:', error);
    }
}

async function stopAppService() {
    sendLogToRenderer('正在停止服务...');
    
    // 设置手动暂停标志，防止自动重启
    manuallyPaused = true;
    console.log('[STOP] Setting manuallyPaused = true to prevent auto restart');
    
    if (app_instance) {
        try {
            // 停止监控（FSM）
            if (typeof app_instance.stopMonitoring === 'function') {
                await app_instance.stopMonitoring();
                updateTrayIcon(false);
                updateTrayMenu(); // 更新托盘菜单
                sendLogToRenderer('监控服务已停止');
                console.log('[STOP] Monitoring stopped successfully');
                return { success: true, message: 'Monitoring stopped' };
            } else {
                // 兼容旧版本 - 停止整个应用
                await app_instance.stop();
                updateTrayIcon(false);
                updateTrayMenu();
                sendLogToRenderer('服务已停止');
                return { success: true, message: 'Service stopped' };
            }
        } catch (error) {
            sendLogToRenderer('停止失败: ' + error.message, 'error');
            return { success: false, message: error.message };
        }
    }
    
    // 模拟停止
    updateTrayIcon(false);

    // 清理警告定时器
    if (global.simulationWarningInterval) {
        clearInterval(global.simulationWarningInterval);
        global.simulationWarningInterval = null;
    }

    sendLogToRenderer('服务已停止 (模拟模式)');
    return { success: true, message: 'Stopped (simulation mode)', simulationMode: true };
}

async function checkSystemPermissions() {
    const permissions = {
        screenRecording: false,
        accessibility: false,
        inputMonitoring: false,
        systemInfo: true // 系统信息通常不需要特殊权限
    };

    try {
        if (process.platform === 'darwin') {
            // macOS权限检查
            await checkMacOSPermissions(permissions);
        } else if (process.platform === 'win32') {
            // Windows权限检查
            await checkWindowsPermissions(permissions);
        }
    } catch (error) {
        console.error('Permission check failed:', error);
        sendLogToRenderer('权限检查失败: ' + error.message, 'error');
        
        // 设置默认权限状态
        permissions.screenRecording = false;
        permissions.accessibility = false;
        permissions.inputMonitoring = false;
    }

    return permissions;
}

// 平台特定权限检查函数
async function checkMacOSPermissions(permissions) {
    try {
        const { systemPreferences } = require('electron');
        
        console.log('[权限检查] 开始检查macOS权限...');
        
        // 检查屏幕录制权限 - 使用更准确的检测方法
        if (systemPreferences && typeof systemPreferences.getMediaAccessStatus === 'function') {
            const screenStatus = systemPreferences.getMediaAccessStatus('screen');
            console.log('[权限检查] 系统API返回屏幕录制权限状态:', screenStatus);
            
            // 不仅依赖API，还要实际测试截图功能
            const actualScreenPermission = await checkMacOSScreenPermissionFallback();
            console.log('[权限检查] 实际截图测试结果:', actualScreenPermission);
            
            // 只有当API返回granted且实际测试通过时才认为有权限
            permissions.screenRecording = (screenStatus === 'granted') && actualScreenPermission;
            console.log('[权限检查] 最终屏幕录制权限结果:', permissions.screenRecording);
            
            // 检查辅助功能权限
            if (typeof systemPreferences.isTrustedAccessibilityClient === 'function') {
                permissions.accessibility = systemPreferences.isTrustedAccessibilityClient(false);
                console.log('[权限检查] 辅助功能权限状态:', permissions.accessibility);
            }
        } else {
            // 降级到文件系统检查
            console.log('[权限检查] 使用降级方法检查macOS权限');
            sendLogToRenderer('使用降级方法检查macOS权限');
            permissions.screenRecording = await checkMacOSScreenPermissionFallback();
            permissions.accessibility = await checkMacOSAccessibilityPermissionFallback();
        }
        
        // 输入监控权限 (通常需要辅助功能权限)
        permissions.inputMonitoring = permissions.accessibility;
        
        console.log('[权限检查] 最终权限状态:', JSON.stringify(permissions, null, 2));
        
    } catch (error) {
        console.error('macOS permission check error:', error);
        sendLogToRenderer('macOS权限检查异常: ' + error.message, 'error');
        throw error;
    }
}

async function checkWindowsPermissions(permissions) {
    try {
        // Windows通常不需要特殊权限检查
        permissions.screenRecording = true;
        permissions.accessibility = true;
        permissions.inputMonitoring = true;
        
        // 检查是否有管理员权限
        const isAdmin = await checkWindowsAdminPrivileges();
        if (!isAdmin) {
            sendLogToRenderer('Windows: 建议以管理员权限运行以获得完整功能', 'warning');
        }
        
        sendLogToRenderer('Windows权限检查完成 - 所有权限可用');
        
    } catch (error) {
        console.error('Windows permission check error:', error);
        sendLogToRenderer('Windows权限检查异常: ' + error.message, 'error');
        throw error;
    }
}

// 权限检查的辅助函数
async function checkMacOSScreenPermissionFallback() {
    try {
        const { exec } = require('child_process');
        const fs = require('fs');
        const util = require('util');
        const execPromise = util.promisify(exec);
        
        console.log('[权限检查] 开始实际截图测试...');
        
        // 生成唯一的临时文件名
        const tempPath = `/tmp/screen_permission_test_${Date.now()}.png`;
        
        // 尝试截图（-x参数表示不播放快门声音）
        await execPromise(`screencapture -x "${tempPath}"`, { timeout: 5000 });
        
        // 检查文件是否存在且大小大于0
        if (fs.existsSync(tempPath)) {
            const stats = fs.statSync(tempPath);
            console.log('[权限检查] 截图文件大小:', stats.size, 'bytes');
            
            // 清理临时文件
            try {
                fs.unlinkSync(tempPath);
            } catch (cleanupError) {
                console.log('[权限检查] 清理临时文件失败:', cleanupError.message);
            }
            
            // 如果文件大小大于1000字节，认为截图成功
            const hasPermission = stats.size > 1000;
            console.log('[权限检查] 截图权限测试结果:', hasPermission);
            return hasPermission;
        } else {
            console.log('[权限检查] 截图文件未生成');
            return false;
        }
    } catch (error) {
        console.log('[权限检查] 截图测试失败:', error.message);
        return false;
    }
}

async function checkMacOSAccessibilityPermissionFallback() {
    try {
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        
        // 尝试使用AppleScript检查辅助功能权限
        await execPromise('osascript -e "tell application \\"System Events\\" to get name of first process"', { timeout: 3000 });
        return true;
    } catch (error) {
        return false;
    }
}

async function checkWindowsAdminPrivileges() {
    try {
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        
        await execPromise('net session >nul 2>&1', { timeout: 3000 });
        return true;
    } catch (error) {
        return false;
    }
}

// 权限请求函数
async function requestSystemPermissions(permissions = []) {
    try {
        if (process.platform === 'darwin') {
            return await requestMacOSPermissions(permissions);
        } else if (process.platform === 'win32') {
            return await requestWindowsPermissions(permissions);
        } else {
            return await requestLinuxPermissions(permissions);
        }
    } catch (error) {
        console.error('Permission request failed:', error);
        sendLogToRenderer('权限请求失败: ' + error.message, 'error');
        throw error;
    }
}

async function requestMacOSPermissions(permissions) {
    try {
        const { systemPreferences, shell } = require('electron');
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const results = {};
        let hasRequested = false;
        
        sendLogToRenderer('开始请求macOS权限...');
        
        // 1. 屏幕录制权限 - 使用Electron API主动请求
        if (permissions.includes('screenRecording') || !permissions.length) {
            sendLogToRenderer('请求屏幕录制权限...');
            
            if (systemPreferences && typeof systemPreferences.askForMediaAccess === 'function') {
                try {
                    // 主动触发权限请求对话框
                    const granted = await systemPreferences.askForMediaAccess('screen');
                    results.screenRecording = granted;
                    hasRequested = true;
                    
                    if (granted) {
                        sendLogToRenderer('✅ 屏幕录制权限已授权', 'success');
                    } else {
                        sendLogToRenderer('❌ 屏幕录制权限被拒绝', 'warning');
                    }
                } catch (error) {
                    sendLogToRenderer('屏幕录制权限请求失败: ' + error.message, 'error');
                    results.screenRecording = false;
                }
            } else {
                sendLogToRenderer('系统不支持自动请求屏幕录制权限', 'warning');
                results.screenRecording = false;
            }
            
            // 如果权限被拒绝，打开系统设置
            if (!results.screenRecording) {
                await openScreenRecordingSettings();
            }
        }
        
        // 2. 辅助功能权限 - 通过AppleScript检测并引导用户
        if (permissions.includes('accessibility') || !permissions.length) {
            sendLogToRenderer('检查辅助功能权限...');
            
            try {
                // 尝试执行需要辅助功能权限的操作来触发权限请求
                const testScript = `
                    tell application "System Events"
                        return name of first application process whose frontmost is true
                    end tell
                `;
                
                await execAsync(`osascript -e '${testScript.replace(/'/g, "\\'")}'`);
                results.accessibility = true;
                sendLogToRenderer('✅ 辅助功能权限已授权', 'success');
                hasRequested = true;
                
            } catch (error) {
                results.accessibility = false;
                sendLogToRenderer('❌ 辅助功能权限未授权', 'warning');
                
                // 打开辅助功能设置页面
                await openAccessibilitySettings();
                hasRequested = true;
            }
        }
        
        // 3. 输入监控权限（通常跟随辅助功能权限）
        if (permissions.includes('inputMonitoring') || !permissions.length) {
            sendLogToRenderer('检查输入监控权限...');
            
            // 输入监控权限通常需要手动设置，直接打开设置页面
            results.inputMonitoring = results.accessibility || false;
            
            if (!results.inputMonitoring) {
                await openInputMonitoringSettings();
                hasRequested = true;
            }
        }
        
        if (hasRequested) {
            sendLogToRenderer('💡 权限请求已发送，请在系统设置中完成授权后重启应用', 'info');
        }
        
        return results;
    } catch (error) {
        console.error('macOS permission request error:', error);
        sendLogToRenderer('权限请求失败: ' + error.message, 'error');
        throw error;
    }
}

// 打开屏幕录制设置页面
async function openScreenRecordingSettings() {
    const { shell } = require('electron');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
        sendLogToRenderer('正在打开屏幕录制设置...');
        
        // 方法1: 直接打开到屏幕录制页面
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        
        // 方法2: 使用AppleScript精确导航
        const appleScript = `
            tell application "System Preferences"
                activate
                set current pane to pane "com.apple.preference.security"
                delay 1
                tell application "System Events"
                    tell process "System Preferences"
                        try
                            click button "Privacy" of toolbar 1 of window 1
                            delay 0.5
                            select row "Screen Recording" of table 1 of scroll area 1 of group 1 of tab group 1 of window 1
                        on error
                            -- 如果UI结构不同，尝试其他方法
                        end try
                    end tell
                end tell
            end tell
        `;
        
        setTimeout(async () => {
            try {
                await execAsync(`osascript -e '${appleScript.replace(/'/g, "\\'")}'`);
                sendLogToRenderer('📍 已导航到屏幕录制设置页面');
            } catch (error) {
                console.log('AppleScript navigation failed:', error);
            }
        }, 1000);
        
    } catch (error) {
        sendLogToRenderer('打开设置页面失败: ' + error.message, 'error');
    }
}

// 打开辅助功能设置页面
async function openAccessibilitySettings() {
    const { shell } = require('electron');
    
    try {
        sendLogToRenderer('正在打开辅助功能设置...');
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        sendLogToRenderer('📍 请在辅助功能列表中勾选"企业安全"');
    } catch (error) {
        sendLogToRenderer('打开辅助功能设置失败: ' + error.message, 'error');
    }
}

// 打开输入监控设置页面
async function openInputMonitoringSettings() {
    const { shell } = require('electron');
    
    try {
        sendLogToRenderer('正在打开输入监控设置...');
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
        sendLogToRenderer('📍 请在输入监控列表中勾选"企业安全"');
    } catch (error) {
        sendLogToRenderer('打开输入监控设置失败: ' + error.message, 'error');
    }
}

async function requestWindowsPermissions(permissions) {
    // Windows通常不需要特殊权限请求
    sendLogToRenderer('Windows平台: 权限通常无需特殊请求');
    return { success: true };
}

async function requestLinuxPermissions(permissions) {
    // Linux权限请求取决于具体的发行版和桌面环境
    sendLogToRenderer('Linux平台: 请检查应用程序权限设置');
    return { success: true };
}

function updateTrayIcon(isRunning) {
    if (tray) {
        const icon = createDefaultIcon();
        tray.setImage(icon);
        tray.setToolTip(`${APP_CONFIG.name} - ${isRunning ? '运行中' : '已停止'}`);
    }
}

// 更新托盘菜单状态
function updateTrayMenu() {
    if (!tray) return;
    
    try {
        let statusText = '未知';
        let isRunning = false;
        
        // 获取当前状态 - 修复状态判断逻辑
        if (app_instance) {
            try {
                if (app_instance.getStateMachine && typeof app_instance.getStateMachine === 'function') {
                    const stateMachine = app_instance.getStateMachine();
                    if (stateMachine && typeof stateMachine.getCurrentState === 'function') {
                        currentState = stateMachine.getCurrentState();
                        
                        // 关键修复：同时检查 FSM 的 isServiceRunning 状态
                        if (typeof stateMachine.isServiceRunning === 'function') {
                            const serviceRunning = stateMachine.isServiceRunning();
                            console.log(`[TRAY] FSM state: ${currentState}, Service running: ${serviceRunning}`);
                            
                            // 只有当 FSM 服务确实在运行时，才根据状态判断是否运行中
                            if (serviceRunning) {
                                const runningStates = ['DATA_COLLECT', 'CONFIG_FETCH', 'WS_CHECK', 'HEARTBEAT'];
                                isRunning = runningStates.includes(currentState);
                            } else {
                                // FSM 服务已停止，无论当前状态是什么，都认为未运行
                                isRunning = false;
                            }
                        } else {
                            // 降级到旧逻辑
                            const runningStates = ['DATA_COLLECT', 'CONFIG_FETCH', 'WS_CHECK', 'HEARTBEAT'];
                            isRunning = runningStates.includes(currentState);
                        }
                    }
                }
                
                statusText = isRunning ? '运行中' : '已停止';
            } catch (error) {
                statusText = '错误';
            }
        }
        
        // 构建托盘菜单 - 监控程序不提供退出选项
        const menuTemplate = [
            {
                label: `状态: ${statusText} (${currentState || '未知'})`,
                enabled: false
            },
            { type: 'separator' },
            {
                label: '显示主界面',
                click: async () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();

                        // 窗口显示时同步自启动状态
                        try {
                            const platformAdapter = app_instance?.getPlatformAdapter();
                            if (platformAdapter && typeof platformAdapter.isAutoStartEnabled === 'function') {
                                const enabled = await platformAdapter.isAutoStartEnabled();
                                console.log('[AUTO_START_SYNC] 托盘打开窗口,同步状态:', enabled);
                                mainWindow.webContents.send('autostart-status-changed', { enabled });
                            }
                        } catch (error) {
                            console.error('[AUTO_START_SYNC] 同步状态失败:', error);
                        }
                    }
                }
            },
            { type: 'separator' },
            {
                label: '启动服务',
                enabled: !isRunning,
                click: async () => {
                    const result = await startAppService(true);
                    console.log('Tray start result:', result);
                    setTimeout(() => updateTrayMenu(), 1000); // 延迟更新状态
                }
            },
            {
                label: '停止服务',
                enabled: isRunning,
                click: async () => {
                    const result = await stopAppService();
                    console.log('Tray stop result:', result);
                    setTimeout(() => updateTrayMenu(), 1000); // 延迟更新状态
                }
            }
            // 注意: 不添加"退出应用"选项,这是监控程序,不应允许员工随意退出
        ];

        const contextMenu = Menu.buildFromTemplate(menuTemplate);
        
        tray.setContextMenu(contextMenu);
        
        // 设置托盘点击事件监听器（只设置一次）
        if (!tray._eventsSet) {
            // 点击托盘图标时显示上下文菜单（而不是主窗口）
            tray.on('click', () => {
                console.log('Tray icon clicked - showing context menu');
                // macOS上单击托盘图标时显示菜单
                if (process.platform === 'darwin') {
                    tray.popUpContextMenu();
                }
            });
            
            // 右键点击显示菜单（适用于所有平台）
            tray.on('right-click', () => {
                console.log('Tray icon right-clicked - showing context menu');
                tray.popUpContextMenu();
            });
            
            tray._eventsSet = true;
        }
        
        // 更新图标状态
        updateTrayIcon(isRunning);
        
    } catch (error) {
        console.error('Error updating tray menu:', error);
    }
}

// 获取跨平台的配置目录
function getConfigDirectory() {
    const os = require('os');
    const homeDir = os.homedir();
    
    switch (process.platform) {
        case 'darwin':
            // macOS: ~/Library/Application Support/EmployeeMonitor
            return path.join(homeDir, 'Library', 'Application Support', 'EmployeeMonitor');
        case 'win32':
            // Windows: %APPDATA%\EmployeeMonitor
            return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'EmployeeMonitor');
        default:
            // 其他平台使用 ~/.employee-monitor
            return path.join(homeDir, '.employee-monitor');
    }
}

// 配置管理函数 - 使用 AppConfigManager
async function getAppConfig() {
    try {
        const { appConfig } = require(path.join(__dirname, '..', 'out', 'dist', 'common', 'config', 'app-config-manager'));
        const baseUrl = appConfig.getBaseUrl();

        return {
            success: true,
            serverUrl: baseUrl || 'http://23.95.193.155:3000'
        };
    } catch (error) {
        console.error('[CONFIG] Failed to load app-config:', error);
        // 返回默认配置
        return {
            success: true,
            serverUrl: 'http://23.95.193.155:3000'
        };
    }
}

async function updateAppConfig(newConfig) {
    try {
        // 使用 AppConfigManager 更新配置
        const { appConfig } = require(path.join(__dirname, '..', 'out', 'dist', 'common', 'config', 'app-config-manager'));

        // 更新 serverUrl (baseUrl)
        if (newConfig.serverUrl) {
            console.log('[CONFIG] Updating baseUrl:', newConfig.serverUrl);
            appConfig.setBaseUrl(newConfig.serverUrl); // 这会触发 config-updated 事件
        }

        // 更新其他配置项
        Object.entries(newConfig).forEach(([key, value]) => {
            if (key !== 'serverUrl') {
                appConfig.set(key, value);
            }
        });

        // 如果主应用存在，更新其配置
        if (app_instance && typeof app_instance.updateConfig === 'function') {
            app_instance.updateConfig(newConfig);
        }

        console.log('[CONFIG] Config updated:', newConfig);
        sendLogToRenderer(`配置已更新: ${JSON.stringify(newConfig)}`);
        return { success: true, message: '配置已保存' };

    } catch (error) {
        console.error('[CONFIG] Failed to update config:', error);
        return { success: false, message: '保存配置失败: ' + error.message };
    }
}

// 应用生命周期和错误处理
app.on('window-all-closed', () => {
    // 保持应用运行，只是隐藏窗口
    console.log('All windows closed, keeping app running in background');
    sendLogToRenderer('所有窗口已关闭，应用继续在后台运行');
});

app.on('activate', () => {
    try {
        if (mainWindow === null) {
            createMainWindow();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
        sendLogToRenderer('应用已激活');
    } catch (error) {
        console.error('Error activating app:', error);
        sendLogToRenderer('应用激活失败: ' + error.message, 'error');
    }
});

app.on('before-quit', async (event) => {
    console.log('Application preparing to quit...');
    sendLogToRenderer('应用准备退出...');
    isQuitting = true;
    
    // 阻止退出，先进行清理工作
    event.preventDefault();
    
    try {
        // 停止主应用服务
        if (app_instance && typeof app_instance.stop === 'function') {
            console.log('Stopping employee monitor service...');
            sendLogToRenderer('正在停止监控服务...');
            await app_instance.stop();
            sendLogToRenderer('监控服务已停止');
        }

        // 停止热更新系统
        if (hotReloadManager) {
            console.log('Stopping hot reload manager...');
            try {
                const stats = hotReloadManager.getStats();
                if (stats) {
                    console.log('[HOT-RELOAD] Final statistics:', stats);
                }
                hotReloadManager.stop();
                console.log('[HOT-RELOAD] Hot reload manager stopped');
            } catch (error) {
                console.error('[HOT-RELOAD] Error stopping hot reload manager:', error);
            }
        }

        // 清理资源
        await cleanup();
        
        // 现在真正退出
        app.exit(0);
    } catch (error) {
        console.error('Error during app shutdown:', error);
        sendLogToRenderer('退出时发生错误: ' + error.message, 'error');
        // 强制退出
        app.exit(1);
    }
});

app.on('will-quit', (event) => {
    console.log('Application will quit');
    sendLogToRenderer('应用即将退出');
});

// 全局错误处理
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    sendLogToRenderer('未捕获异常: ' + error.message, 'error');
    
    // 尝试优雅关闭
    gracefulShutdown('uncaughtException', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    sendLogToRenderer('未处理的Promise拒绝: ' + reason, 'error');
    
    // 尝试优雅关闭
    gracefulShutdown('unhandledRejection', reason);
});

// 系统信号处理
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    sendLogToRenderer('收到SIGTERM信号，开始优雅关闭');
    gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully');
    sendLogToRenderer('收到SIGINT信号，开始优雅关闭');
    gracefulShutdown('SIGINT');
});

// 优雅关闭函数
async function gracefulShutdown(signal, error) {
    console.log(`Graceful shutdown initiated by: ${signal}`);
    sendLogToRenderer(`开始优雅关闭 (${signal})`);
    
    try {
        // 设置关闭超时
        const shutdownTimeout = setTimeout(() => {
            console.error('Shutdown timeout, forcing exit');
            process.exit(1);
        }, 10000); // 10秒超时
        
        // 停止主应用
        if (app_instance && typeof app_instance.stop === 'function') {
            await app_instance.stop();
        }
        
        // 清理资源
        await cleanup();
        
        clearTimeout(shutdownTimeout);
        
        if (error) {
            console.error('Exiting due to error:', error);
            process.exit(1);
        } else {
            console.log('Graceful shutdown completed');
            process.exit(0);
        }
    } catch (shutdownError) {
        console.error('Error during graceful shutdown:', shutdownError);
        process.exit(1);
    }
}

// 清理函数
async function cleanup() {
    console.log('Starting cleanup process...');
    sendLogToRenderer('开始清理资源...');
    
    const cleanupTasks = [];
    
    try {
        // 恢复日志管理器的原始console方法
        if (logManager) {
            cleanupTasks.push(
                new Promise((resolve) => {
                    logManager.restore();
                    logManager = null;
                    console.log('[LOG_MANAGER] 日志管理器已清理');
                    resolve();
                })
            );
        }
        
        // 关闭权限向导窗口
        if (permissionWizardWindow) {
            cleanupTasks.push(
                new Promise((resolve) => {
                    permissionWizardWindow.close();
                    permissionWizardWindow = null;
                    resolve();
                })
            );
        }
        
        // 清理托盘图标
        if (tray) {
            cleanupTasks.push(
                new Promise((resolve) => {
                    tray.destroy();
                    tray = null;
                    resolve();
                })
            );
        }
        
        // 关闭主窗口
        if (mainWindow) {
            cleanupTasks.push(
                new Promise((resolve) => {
                    mainWindow.close();
                    mainWindow = null;
                    resolve();
                })
            );
        }
        
        // 等待所有清理任务完成
        await Promise.allSettled(cleanupTasks);
        
        console.log('Cleanup completed successfully');
        sendLogToRenderer('资源清理完成');
        
    } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
        sendLogToRenderer('清理时发生错误: ' + cleanupError.message, 'error');
        throw cleanupError;
    }
}

console.log('企业安全精简版进程已加载');

// 日志队列，用于缓存窗口未准备好时的日志
let logQueue = [];
let isRendererReady = false;

// 日志辅助函数（带安全检查）
function sendLogToRenderer(message, type = 'info') {
    const logData = {
        message: message,
        type: type,
        timestamp: new Date().toISOString()
    };

    // 检查窗口是否存在且未销毁
    if (!mainWindow || mainWindow.isDestroyed()) {
        // 缓存日志到队列（限制队列大小防止内存泄漏）
        if (logQueue.length < 500) {
            logQueue.push(logData);
        }
        return;
    }

    // 检查 webContents 是否存在且未销毁
    if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
        if (logQueue.length < 500) {
            logQueue.push(logData);
        }
        return;
    }

    // 检查渲染进程是否准备好
    if (!isRendererReady) {
        if (logQueue.length < 500) {
            logQueue.push(logData);
        }
        return;
    }

    // 尝试发送日志，捕获可能的错误
    try {
        mainWindow.webContents.send('log:received', logData);
    } catch (error) {
        // 静默处理发送错误，避免错误循环
        // console.error 会被重写的 console.log 捕获，所以不记录
    }
}

// 刷新日志队列
function flushLogQueue() {
    if (!isRendererReady || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const logsToSend = [...logQueue];
    logQueue = [];

    logsToSend.forEach(logData => {
        try {
            if (mainWindow && !mainWindow.isDestroyed() &&
                mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('log:received', logData);
            }
        } catch (error) {
            // 静默处理错误
        }
    });
}

// 重写console.log来捕获数据采集相关的日志
const originalConsoleLog = console.log;
console.log = function(...args) {
    // 调用原始的console.log
    originalConsoleLog.apply(console, args);
    
    // 检查是否是需要显示在UI的日志
    const message = args.join(' ');
    
    // 扩展日志匹配规则，包含更多运维关键信息
    const logPatterns = [
        '[DATA_COLLECT]',
        '[FSM]',
        '[INIT]',
        '[HEARTBEAT]',
        '[REGISTER]',
        '[BIND_CHECK]',
        '[WS_CHECK]',
        '[CONFIG_FETCH]',
        '[SCREENSHOT]',
        '[LOGGING]',
        '[STATUS_CHECK]',
        '[CONFIG]'
    ];
    
    // 检查是否匹配任何模式
    const shouldLog = logPatterns.some(pattern => message.includes(pattern));
    
    if (shouldLog) {
        // 根据日志内容确定类型和重要性
        let logType = 'info';
        
        // 数据采集相关
        if (message.includes('📊') || message.includes('开始数据收集周期')) {
            logType = 'data';
        } else if (message.includes('📸') && message.includes('截图')) {
            logType = 'data';
        } else if (message.includes('📤') || message.includes('上传') || message.includes('WebSocket')) {
            logType = 'upload';
        } 
        // 成功状态
        else if (message.includes('✅') || message.includes('成功') || message.includes('successful')) {
            logType = 'success';
        } 
        // 状态转换
        else if (message.includes('State transition') || message.includes('状态')) {
            logType = 'info';
        }
        // 连接相关
        else if (message.includes('connection') || message.includes('连接')) {
            logType = 'success';
        }
        // 错误和失败
        else if (message.includes('❌') || message.includes('失败') || message.includes('Failed') || message.includes('error')) {
            logType = 'error';
        }
        // 警告
        else if (message.includes('⚠️') || message.includes('warning') || message.includes('warn')) {
            logType = 'warning';
        }
        
        // 转发到渲染进程，但要清理和简化消息
        const cleanMessage = cleanLogMessage(message);
        sendLogToRenderer(cleanMessage, logType);
    }
};

// 清理和简化日志消息，使其更适合UI显示
function cleanLogMessage(rawMessage) {
    // 移除不必要的前缀和字符
    let cleaned = rawMessage
        .replace(/^\[\d{2}:\d{2}:\d{2}\] /, '') // 移除时间戳前缀
        .replace(/\[\w+\] /, '') // 移除日志级别前缀
        .replace(/\s+/g, ' ') // 合并多个空格
        .trim();
    
    // 特殊处理一些常见的日志模式
    if (cleaned.includes('📊 开始数据收集周期')) {
        return '开始新的数据收集周期';
    } else if (cleaned.includes('✅ 截图数据收集完成')) {
        const match = cleaned.match(/(\d+) 字节/);
        const size = match ? ` (${formatBytes(parseInt(match[1]))})` : '';
        return `截图收集完成${size}`;
    } else if (cleaned.includes('Screenshot data sent successfully')) {
        return '截图数据上传成功';
    } else if (cleaned.includes('Activity data sent successfully')) {
        return '活动数据上传成功';
    } else if (cleaned.includes('State transition:')) {
        const match = cleaned.match(/State transition: (\w+) → (\w+)/);
        if (match) {
            return `状态转换: ${match[1]} → ${match[2]}`;
        }
    } else if (cleaned.includes('Persistent WebSocket connected successfully')) {
        return 'WebSocket连接建立成功';
    } else if (cleaned.includes('Configuration fetched successfully')) {
        return '服务器配置获取成功';
    }
    
    return cleaned;
}

// 格式化字节大小
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 设置应用日志监听和错误恢复
function setupAppLogging() {
    if (app_instance && !app_instance._loggingSetup) {
        app_instance._loggingSetup = true;
        
        // 监听状态变化事件
        app_instance.on('stateChanged', (data) => {
            sendLogToRenderer(`应用状态: ${data.oldState} → ${data.newState}`);
            currentState = data.newState || currentState;
            
            // 更新托盘菜单状态
            updateTrayMenu();
            
            // 通知渲染进程更新状态显示
            if (mainWindow) {
                const isRunning = data.newState === 'RUNNING';
                mainWindow.webContents.send('app-status-changed', {
                    isRunning: isRunning,
                    appState: data.newState,
                    deviceState: currentState
                });
            }
        });
        
        // 监听设备状态变化
        app_instance.on('deviceStateChanged', (data) => {
            sendLogToRenderer(`设备状态: ${data.from} → ${data.to}`);
            currentState = data.to;
            
            // 更新托盘菜单状态
            updateTrayMenu();
            
            // 通知渲染进程设备状态变化
            if (mainWindow) {
                mainWindow.webContents.send('device-status-changed', {
                    from: data.from,
                    to: data.to,
                    currentState: data.to
                });
            }
        });
        
        // 监听错误事件并实施错误恢复
        app_instance.on('error', (error) => {
            sendLogToRenderer('错误: ' + error.message, 'error');
            handleApplicationError(error);
        });
        
        // 监听网络连接事件
        app_instance.on('connectionLost', () => {
            sendLogToRenderer('网络连接丢失', 'warning');
            handleConnectionLoss();
        });
        
        app_instance.on('connectionRestored', () => {
            sendLogToRenderer('网络连接已恢复', 'success');
            handleConnectionRestore();
        });
        
        // 监听其他关键事件
        app_instance.on('started', () => {
            sendLogToRenderer('监控服务已启动', 'success');
            updateTrayIcon(true);
        });

        app_instance.on('stopped', () => {
            sendLogToRenderer('监控服务已停止', 'warning');
            updateTrayIcon(false);
        });

        // 监听初始化进度事件
        app_instance.on('init-progress', (progress) => {
            // 转发进度事件到渲染进程
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('init-progress', progress);
            }
        });
        
        app_instance.on('screenshotTaken', () => {
            sendLogToRenderer('已捕获屏幕截图', 'info');
        });
        
        app_instance.on('dataSynced', () => {
            sendLogToRenderer('数据同步完成', 'success');
        });
        
        // 监听数据采集相关事件
        console.log('[LOGGING] Setting up dataCollectionStart event listener');
        app_instance.on('dataCollectionStart', () => {
            console.log('[LOGGING] Received dataCollectionStart event');
            sendLogToRenderer('开始数据采集', 'data');
        });
        
        console.log('[LOGGING] Setting up dataCollectionCycle event listener');
        app_instance.on('dataCollectionCycle', (data) => {
            console.log('[LOGGING] Received dataCollectionCycle event', data);
            if (data && data.type) {
                sendLogToRenderer(`采集 ${data.type} 数据 - ${data.count || 1} 项`, 'data');
            } else {
                sendLogToRenderer('正在采集数据...', 'data');
            }
        });
        
        app_instance.on('dataUploadStart', (data) => {
            sendLogToRenderer(`开始上传数据 - ${data.totalItems || 0} 项`, 'info');
        });
        
        app_instance.on('dataUploadProgress', (data) => {
            if (data && data.progress) {
                sendLogToRenderer(`上传进度: ${Math.round(data.progress * 100)}%`, 'info');
            }
        });
        
        console.log('[LOGGING] Setting up dataUploadSuccess event listener');
        app_instance.on('dataUploadSuccess', (data) => {
            console.log('[LOGGING] Received dataUploadSuccess event', data);
            sendLogToRenderer(`数据上传成功 - ${data.uploadedItems || 0} 项`, 'upload');
            
            // 重要：数据上传成功后重置活动计数器
            try {
                if (app_instance && typeof app_instance.getPlatformAdapter === 'function') {
                    const adapter = app_instance.getPlatformAdapter();
                    if (adapter && typeof adapter.onDataUploadSuccess === 'function') {
                        adapter.onDataUploadSuccess();
                        console.log('[LOGGING] Activity counters reset after successful upload');
                    }
                }
            } catch (error) {
                console.error('[LOGGING] Failed to reset activity counters:', error.message);
            }
        });
        
        app_instance.on('dataUploadFailed', (error) => {
            sendLogToRenderer(`数据上传失败: ${error.message}`, 'error');
        });
        
        app_instance.on('activityDetected', (activity) => {
            if (activity && activity.type) {
                sendLogToRenderer(`检测到活动: ${activity.type}`, 'info');
            }
        });
        
        app_instance.on('websocketConnected', () => {
            sendLogToRenderer('WebSocket连接已建立', 'success');
        });
        
        app_instance.on('websocketDisconnected', () => {
            sendLogToRenderer('WebSocket连接已断开', 'warning');
        });
        
        app_instance.on('configUpdated', (config) => {
            sendLogToRenderer('配置已更新', 'info');
        });
        
        // 监听权限事件
        app_instance.on('permissionDenied', (permission) => {
            sendLogToRenderer(`权限被拒绝: ${permission}`, 'error');
            handlePermissionDenied(permission);
        });
        
        app_instance.on('permissionGranted', (permission) => {
            sendLogToRenderer(`权限已授予: ${permission}`, 'success');
        });
        
        // 监听健康检查事件
        app_instance.on('healthCheck', (status) => {
            if (status && status.healthy) {
                sendLogToRenderer('健康检查: 正常', 'success');
            } else if (status && status.issues && Array.isArray(status.issues)) {
                sendLogToRenderer(`健康检查: 异常 - ${status.issues.join(', ')}`, 'warning');
            } else {
                sendLogToRenderer('健康检查: 状态未知', 'warning');
            }
        });
        
        // 监听资源使用情况
        app_instance.on('resourceUsage', (usage) => {
            if (usage.memoryUsage > 0.8 || usage.cpuUsage > 0.9) {
                sendLogToRenderer(`资源使用率过高: CPU ${Math.round(usage.cpuUsage * 100)}% 内存 ${Math.round(usage.memoryUsage * 100)}%`, 'warning');
            }
        });
    }
}

// 应用错误处理器
function handleApplicationError(error) {
    console.error('Application error occurred:', error);
    
    // 根据错误类型采取不同的恢复策略
    if (error.code === 'NETWORK_ERROR') {
        handleNetworkError(error);
    } else if (error.code === 'PERMISSION_ERROR') {
        handlePermissionError(error);
    } else if (error.code === 'CONFIG_ERROR') {
        handleConfigError(error);
    } else {
        handleGenericError(error);
    }
}

// 网络错误处理
function handleNetworkError(error) {
    sendLogToRenderer('网络错误，尝试重新连接...', 'warning');
    
    // 延迟重试连接
    setTimeout(async () => {
        try {
            if (app_instance && typeof app_instance.reconnect === 'function') {
                await app_instance.reconnect();
                sendLogToRenderer('重新连接成功', 'success');
            }
        } catch (retryError) {
            sendLogToRenderer('重新连接失败: ' + retryError.message, 'error');
            // 继续以离线模式运行
            sendLogToRenderer('切换到离线模式', 'warning');
        }
    }, 5000);
}

// 权限错误处理
function handlePermissionError(error) {
    sendLogToRenderer('权限错误，打开权限向导', 'warning');
    
    // 解析所需权限
    const requiredPermissions = error.requiredPermissions || ['屏幕录制权限', '辅助功能权限'];
    createPermissionWizardWindow(requiredPermissions);
}

// 配置错误处理
function handleConfigError(error) {
    sendLogToRenderer('配置错误，使用默认配置', 'warning');
    
    // 重置为默认配置
    const defaultConfig = {
        serverUrl: 'http://23.95.193.155:3000',
        monitoringInterval: 30000,
        enableScreenshots: true
    };
    
    updateAppConfig(defaultConfig).then(() => {
        sendLogToRenderer('已重置为默认配置', 'info');
    }).catch(configError => {
        sendLogToRenderer('重置配置失败: ' + configError.message, 'error');
    });
}

// 通用错误处理
function handleGenericError(error) {
    sendLogToRenderer('应用发生未知错误，尝试重启服务', 'error');
    
    // 尝试重启服务
    setTimeout(async () => {
        try {
            if (app_instance && typeof app_instance.restart === 'function') {
                await app_instance.restart();
                sendLogToRenderer('服务重启成功', 'success');
            }
        } catch (restartError) {
            sendLogToRenderer('服务重启失败: ' + restartError.message, 'error');
        }
    }, 3000);
}

// 连接丢失处理
function handleConnectionLoss() {
    // 更新UI状态
    if (mainWindow) {
        mainWindow.webContents.send('connection-status', { connected: false });
    }
    
    // 启动重连机制
    startReconnectionAttempts();
}

// 连接恢复处理
function handleConnectionRestore() {
    // 更新UI状态
    if (mainWindow) {
        mainWindow.webContents.send('connection-status', { connected: true });
    }
    
    // 停止重连机制
    stopReconnectionAttempts();
}

// 权限拒绝处理
function handlePermissionDenied(permission) {
    const { dialog } = require('electron');
    
    dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '权限缺失',
        message: `缺少必要权限: ${permission}`,
        detail: '请在系统设置中授予此权限以确保应用正常工作。',
        buttons: ['打开权限向导', '稍后处理'],
        defaultId: 0
    }).then((result) => {
        if (result.response === 0) {
            createPermissionWizardWindow([permission]);
        }
    }).catch(error => {
        console.error('Error showing permission dialog:', error);
    });
}

// 重连机制
let reconnectionInterval = null;
let reconnectionAttempts = 0;
const maxReconnectionAttempts = 10;

function startReconnectionAttempts() {
    if (reconnectionInterval) {
        return; // 已经在重连
    }
    
    reconnectionAttempts = 0;
    reconnectionInterval = setInterval(async () => {
        reconnectionAttempts++;
        sendLogToRenderer(`重连尝试 ${reconnectionAttempts}/${maxReconnectionAttempts}`, 'info');
        
        try {
            if (app_instance && typeof app_instance.checkConnection === 'function') {
                const isConnected = await app_instance.checkConnection();
                if (isConnected) {
                    sendLogToRenderer('连接已恢复', 'success');
                    stopReconnectionAttempts();
                    return;
                }
            }
        } catch (error) {
            // 继续重连
        }
        
        if (reconnectionAttempts >= maxReconnectionAttempts) {
            sendLogToRenderer('重连失败，切换到离线模式', 'warning');
            stopReconnectionAttempts();
        }
    }, 10000); // 每10秒尝试一次
}

function stopReconnectionAttempts() {
    if (reconnectionInterval) {
        clearInterval(reconnectionInterval);
        reconnectionInterval = null;
        reconnectionAttempts = 0;
    }
}

// 健康检查
function performHealthCheck() {
    if (!app_instance) {
        return {
            healthy: false,
            issues: ['主应用未初始化']
        };
    }
    
    const issues = [];
    
    // 检查内存使用 - 调整阈值为更合理的值
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 300 * 1024 * 1024) { // 300MB - 更适合Electron应用
        issues.push('内存使用过高');
    }
    
    // 检查窗口状态
    if (!mainWindow || mainWindow.isDestroyed()) {
        issues.push('主窗口不可用');
    }
    
    // 检查托盘图标
    if (!tray || tray.isDestroyed()) {
        issues.push('托盘图标不可用');
    }
    
    return {
        healthy: issues.length === 0,
        issues: issues
    };
}

// 定期健康检查
setInterval(() => {
    const healthStatus = performHealthCheck();
    if (!healthStatus.healthy) {
        sendLogToRenderer(`健康检查失败: ${healthStatus.issues.join(', ')}`, 'warning');
    }
}, 60000); // 每分钟检查一次

// 打开增强版安装器窗口
function openEnhancedInstaller() {
    if (nativeModuleWindow) {
        nativeModuleWindow.focus();
        return;
    }

    try {
        nativeModuleWindow = new BrowserWindow({
            width: 700,
            height: 800,
            parent: mainWindow,
            modal: false,
            show: false,
            resizable: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload-js.js')
            },
            title: '启用完整Windows功能',
            icon: createDefaultIcon(),
            titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default'
        });

        // 加载增强版安装界面
        nativeModuleWindow.loadFile(path.join(__dirname, 'renderer', 'enhanced-installer.html'))
            .then(() => {
                console.log('Enhanced installer loaded successfully');
                nativeModuleWindow.show();
                sendLogToRenderer('Windows功能安装器已打开');
            })
            .catch(error => {
                console.error('Failed to load enhanced installer:', error);
                sendLogToRenderer('打开安装器失败: ' + error.message, 'error');
                
                // 回退到简单提示
                showInstallFallback();
                if (nativeModuleWindow) {
                    nativeModuleWindow.close();
                }
            });

        nativeModuleWindow.on('closed', () => {
            nativeModuleWindow = null;
            sendLogToRenderer('Windows功能安装器已关闭');
        });

        // 检查是否是Windows系统
        if (process.platform !== 'win32') {
            setTimeout(() => {
                if (nativeModuleWindow && nativeModuleWindow.webContents) {
                    nativeModuleWindow.webContents.executeJavaScript(`
                        document.body.innerHTML = \`
                            <div style="text-align: center; padding: 40px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
                                <div style="font-size: 72px; margin-bottom: 20px;">ℹ️</div>
                                <h1 style="color: #2d3748; margin-bottom: 10px;">平台提示</h1>
                                <p style="color: #718096; margin-bottom: 30px;">此功能仅适用于Windows系统</p>
                                <div style="background: #fed7d7; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                    当前运行在 ${process.platform} 平台上。<br>
                                    Windows原生事件监控功能仅在Windows系统上可用。
                                </div>
                                <button onclick="window.close()" style="background: #667eea; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer;">关闭</button>
                            </div>
                        \`;
                    `);
                }
            }, 1000);
        }

    } catch (error) {
        console.error('Error creating enhanced installer window:', error);
        sendLogToRenderer('创建安装器窗口失败: ' + error.message, 'error');
        showInstallFallback();
    }
}

// 简单安装提示作为后备方案
function showInstallFallback() {
    const { dialog } = require('electron');
    
    if (process.platform !== 'win32') {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '平台提示',
            message: 'Windows完整功能',
            detail: `此功能仅适用于Windows系统。\n当前运行在 ${process.platform} 平台上。`,
            buttons: ['确定'],
            defaultId: 0
        });
        return;
    }

    const message = `Windows原生事件监控功能可以解决键盘鼠标计数为0的问题。

要启用完整功能，请：

1. 以管理员身份运行PowerShell
2. 导航到应用程序目录
3. 运行 quick-windows-setup.cmd

或查看 WINDOWS_QUICK_START.md 文件获取详细步骤。`;

    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '启用Windows完整功能',
        message: '需要安装原生模块',
        detail: message,
        buttons: ['确定', '稍后安装'],
        defaultId: 0
    }).then((result) => {
        if (result.response === 0) {
            sendLogToRenderer('用户确认查看Windows功能安装指南');
        } else {
            sendLogToRenderer('用户选择稍后安装Windows功能');
        }
    }).catch(error => {
        console.error('Error showing install fallback dialog:', error);
    });
}