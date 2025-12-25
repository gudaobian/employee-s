/**
 * Auto Update Integration for Main Process
 *
 * Integrates AutoUpdateService into Electron main process with:
 * - Automatic initialization on app ready
 * - Post-update permission verification
 * - IPC handlers for renderer communication
 * - Update notification system
 */

const { app, dialog, ipcMain, BrowserWindow, Notification } = require('electron');
const path = require('path');
const log = require('electron-log');
const { execFile } = require('child_process');
const os = require('os');
const fs = require('fs');

// Configure electron-log for auto-update
log.transports.file.resolvePathFn = () => path.join(app.getPath('logs'), 'auto-update.log');
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// 跳过代码签名验证（开发环境和测试环境）
// TODO: 生产环境应该使用正确签名的应用，并移除这个跳过逻辑
process.env.ELECTRON_UPDATER_ALLOW_UNSIGNED = '1';
log.info('[AUTO_UPDATE] Code signature validation DISABLED (testing mode - unconditional skip)');

// Global error handlers to prevent crashes from update errors
process.on('uncaughtException', (error) => {
  if (error.message && error.message.includes('download')) {
    log.error('[AUTO_UPDATE] Uncaught download error (prevented crash):', error);
    // Don't crash the app for download errors
    return;
  }
  // Re-throw other errors
  log.error('[FATAL] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.toString().includes('download')) {
    log.error('[AUTO_UPDATE] Unhandled download rejection (prevented crash):', reason);
    // Don't crash the app for download errors
    return;
  }
  log.error('[FATAL] Unhandled rejection:', reason);
});

// Will be dynamically loaded after TypeScript compilation
let AutoUpdateService;
let AppConfigManager;
let autoUpdateService = null;

/**
 * Initialize auto-update system
 */
async function initializeAutoUpdate() {
  try {
    log.info('[AUTO_UPDATE] Initializing auto-update system...');
    log.info('[AUTO_UPDATE] App version:', app.getVersion());
    log.info('[AUTO_UPDATE] App path:', app.getAppPath());
    log.info('[AUTO_UPDATE] Is packaged:', app.isPackaged);

    // Dynamically load compiled TypeScript modules
    try {
      const appPath = app.getAppPath();
      // In packaged app, compiled files are in out/dist
      const distPath = path.join(appPath, 'out', 'dist');

      log.info('[AUTO_UPDATE] Dist path:', distPath);
      log.info('[AUTO_UPDATE] Loading modules...');

      log.info('[AUTO_UPDATE] Step 1: Loading AutoUpdateService...');
      const { AutoUpdateService: AUS } = require(
        path.join(distPath, 'common', 'services', 'auto-update-service')
      );
      log.info('[AUTO_UPDATE] ✅ AutoUpdateService loaded');

      log.info('[AUTO_UPDATE] Step 2: Loading AppConfigManager...');
      const { AppConfigManager: ACM } = require(
        path.join(distPath, 'common', 'config', 'app-config-manager')
      );
      log.info('[AUTO_UPDATE] ✅ AppConfigManager loaded');

      AutoUpdateService = AUS;
      AppConfigManager = ACM;
      log.info('[AUTO_UPDATE] ✅ All modules loaded successfully');
    } catch (loadError) {
      log.error('[AUTO_UPDATE] Failed to load update modules:', loadError.message);
      log.error('[AUTO_UPDATE] Error stack:', loadError.stack);
      log.error('[AUTO_UPDATE] Auto-update will be disabled');
      return false;
    }

    // Load configuration from AppConfigManager
    const appConfig = AppConfigManager.getInstance();

    if (!appConfig.get('updateEnabled')) {
      log.info('[AUTO_UPDATE] Auto-update is disabled in configuration');
      return false;
    }

    const updateServerUrl = appConfig.getUpdateServerUrl();
    if (!updateServerUrl) {
      log.warn('[AUTO_UPDATE] No baseUrl configured, auto-update disabled');
      log.warn('[AUTO_UPDATE] Please configure server address in settings');
      return false;
    }

    log.info('[AUTO_UPDATE] Configuration loaded:', {
      channel: appConfig.get('updateChannel'),
      updateServerUrl: updateServerUrl,
      autoDownload: appConfig.get('updateAutoDownload'),
      checkInterval: appConfig.get('updateCheckInterval')
    });

    // Create AutoUpdateService instance
    // Don't pass updateServerUrl - let it read from appConfig automatically
    autoUpdateService = new AutoUpdateService({
      channel: appConfig.get('updateChannel'),
      autoDownload: appConfig.get('updateAutoDownload'),
      autoInstallOnQuit: appConfig.get('updateAutoInstall')
    });

    // Set up event handlers
    setupUpdateEventHandlers();

    // Verify previous update success
    const wasUpdated = await autoUpdateService.verifyUpdateSuccess();
    if (wasUpdated) {
      log.info('[AUTO_UPDATE] ✅ Previous update verified successfully');

      // Show success notification
      showUpdateSuccessNotification();
    }

    // Wrap periodic check in try-catch to prevent crashes
    try {
      const checkInterval = appConfig.get('updateCheckInterval');
      autoUpdateService.startPeriodicCheck(checkInterval);
      log.info('[AUTO_UPDATE] Periodic checks started, interval:', checkInterval, 'ms');
    } catch (checkError) {
      log.error('[AUTO_UPDATE] Failed to start periodic checks:', checkError);
      // Don't fail initialization even if periodic check fails
    }

    log.info('[AUTO_UPDATE] ✅ Auto-update system initialized successfully');
    return true;
  } catch (error) {
    log.error('[AUTO_UPDATE] Initialization failed:', error);
    log.error('[AUTO_UPDATE] Error stack:', error.stack);
    // Don't crash the app - just disable auto-update
    return false;
  }
}

/**
 * Setup update event handlers
 */
function setupUpdateEventListeners(service) {
  service.on('update-available', (info) => {
    log.info('[AUTO_UPDATE] New update available:', info.version);
    showUpdateAvailableNotification(info);
  });

  service.on('download-progress', (progress) => {
    const speedMB = (progress.bytesPerSecond / 1024 / 1024).toFixed(2);
    const transferredMB = (progress.transferred / 1024 / 1024).toFixed(2);
    const totalMB = (progress.total / 1024 / 1024).toFixed(2);

    log.info(
      `[AUTO_UPDATE] Download progress: ${Math.round(progress.percent)}% | ` +
      `Speed: ${speedMB} MB/s | ` +
      `Downloaded: ${transferredMB} / ${totalMB} MB`
    );

    // Test notification at 10% to verify user can see progress
    if (Math.round(progress.percent) === 10) {
      try {
        const notification = new Notification({
          title: '下载进度',
          body: `更新下载已完成 10% - Dock图标应显示进度条\n速度: ${speedMB} MB/s`,
          silent: false
        });
        notification.show();
        log.info('[AUTO_UPDATE] 10% progress notification shown');
      } catch (error) {
        log.error('[AUTO_UPDATE] Failed to show 10% notification:', error);
      }
    }

    // Send progress to renderer if needed
    broadcastToAllWindows('update-download-progress', progress);
  });

  service.on('update-downloaded', async (info) => {
    log.info('[AUTO_UPDATE] Update downloaded:', info.version);

    // 清除进度条和恢复标题
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      if (!window.isDestroyed()) {
        window.setProgressBar(-1); // -1 移除进度条
        window.setTitle('企业安全');
      }
    });

    // On macOS, use custom auto-install to bypass Squirrel.Mac signature validation
    if (os.platform() === 'darwin') {
      log.info('[AUTO_UPDATE] macOS detected - attempting auto-install');
      const installed = await executeAutoInstall();

      if (installed) {
        log.info('[AUTO_UPDATE] Auto-install initiated successfully');
        // The install script will restart the app automatically
        return;
      }

      log.warn('[AUTO_UPDATE] Auto-install failed, falling back to manual notification');
    }

    // Fallback: show notification for manual installation
    showUpdateReadyNotification(info);
  });

  service.on('error', (error) => {
    log.error('[AUTO_UPDATE] Update error:', error.message);
    showUpdateErrorNotification(error);
  });

  service.on('checking-for-update', () => {
    log.info('[AUTO_UPDATE] Checking for updates...');
  });

  service.on('update-not-available', () => {
    log.info('[AUTO_UPDATE] No update available');
  });
}

/**
 * Setup IPC handlers for renderer process
 */
function setupUpdateIPCHandlers() {
  // Check for updates manually
  ipcMain.handle('check-for-updates', async () => {
    if (!autoUpdateService) {
      return {
        success: true,
        updateAvailable: false,
        reason: '更新服务不可用'
      };
    }

    return new Promise((resolve) => {
      let updateAvailableHandler;
      let updateNotAvailableHandler;
      let timeout;

      // 清理监听器
      const cleanup = () => {
        if (updateAvailableHandler) {
          autoUpdateService.removeListener('update-available', updateAvailableHandler);
        }
        if (updateNotAvailableHandler) {
          autoUpdateService.removeListener('update-not-available', updateNotAvailableHandler);
        }
        if (timeout) {
          clearTimeout(timeout);
        }
      };

      // 监听更新可用事件
      updateAvailableHandler = (info) => {
        cleanup();
        resolve({
          success: true,
          updateAvailable: true,
          version: info.version,
          releaseNotes: info.releaseNotes
        });
      };

      // 监听无更新事件
      updateNotAvailableHandler = (info) => {
        cleanup();
        resolve({
          success: true,
          updateAvailable: false,
          currentVersion: info.version,
          reason: '已是最新版本'
        });
      };

      autoUpdateService.once('update-available', updateAvailableHandler);
      autoUpdateService.once('update-not-available', updateNotAvailableHandler);

      // 15秒超时
      timeout = setTimeout(() => {
        cleanup();
        resolve({
          success: true,
          updateAvailable: false,
          reason: '检查超时或无可用版本'
        });
      }, 15000);

      // 开始检查
      autoUpdateService.checkForUpdates().catch((error) => {
        cleanup();

        // 404错误表示没有可用版本，这不是失败
        if (error.message && (
          error.message.includes('404') ||
          error.message.includes('No published version') ||
          error.message.includes('Cannot find channel')
        )) {
          resolve({
            success: true,
            updateAvailable: false,
            reason: '暂无可用版本'
          });
        } else {
          // 其他错误才是真正的检查失败
          resolve({
            success: false,
            error: error.message || '检查更新失败'
          });
        }
      });
    });
  });

  // Install update and restart
  ipcMain.handle('install-update', async () => {
    if (!autoUpdateService) {
      return { success: false, error: 'No update available' };
    }

    try {
      await autoUpdateService.quitAndInstall();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Get update status
  ipcMain.handle('get-update-status', () => {
    if (!autoUpdateService) {
      return {
        available: false,
        version: app.getVersion(),
        updateServiceAvailable: false
      };
    }

    return {
      available: true,
      version: app.getVersion(),
      channel: autoUpdateService.getChannel(),
      updateServiceAvailable: true
    };
  });

  // Get current version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Change update channel
  ipcMain.handle('set-update-channel', async (event, channel) => {
    if (!autoUpdateService) {
      return { success: false, error: 'Update service not available' };
    }

    try {
      autoUpdateService.setChannel(channel);
      return { success: true, channel };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  log.info('[AUTO_UPDATE] IPC handlers registered');
}

/**
 * Show update available notification (macOS native notification)
 */
function showUpdateAvailableNotification(info) {
  try {
    log.info('[AUTO_UPDATE] Showing update notification:', info.version);

    // Use macOS native notification - won't interfere with main window
    const notification = new Notification({
      title: '发现新版本',
      body: `版本 ${info.version} 现已可用。\n正在后台下载...`,
      silent: false,
      timeoutType: 'default'
    });

    notification.show();

    log.info('[AUTO_UPDATE] Native notification shown');
  } catch (error) {
    log.error('[AUTO_UPDATE] Failed to show notification:', error);
    // Don't crash the app - just log the error
  }
}

/**
 * Check if update is already cached locally
 */
function checkLocalUpdateCache(targetVersion) {
  try {
    const cacheDir = path.join(app.getPath('cache'), 'employee-safety-client', 'pending');
    const updateZip = path.join(cacheDir, 'EmployeeSafety.zip');

    if (!fs.existsSync(updateZip)) {
      log.info('[AUTO_UPDATE] No local cache found');
      return false;
    }

    // Check file size (basic validation)
    const stats = fs.statSync(updateZip);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);

    log.info(`[AUTO_UPDATE] Local cache found: ${updateZip}`);
    log.info(`[AUTO_UPDATE] Cache file size: ${fileSizeMB} MB`);

    // Save target version for later validation (optional)
    const cacheInfoPath = path.join(cacheDir, 'cache-info.json');
    try {
      const cacheInfo = JSON.parse(fs.readFileSync(cacheInfoPath, 'utf8'));
      if (cacheInfo.version === targetVersion) {
        log.info(`[AUTO_UPDATE] Cache version matches target: ${targetVersion}`);
        return true;
      } else {
        log.warn(`[AUTO_UPDATE] Cache version mismatch: ${cacheInfo.version} !== ${targetVersion}`);
        // Delete old cache
        fs.unlinkSync(updateZip);
        fs.unlinkSync(cacheInfoPath);
        return false;
      }
    } catch (err) {
      // cache-info.json doesn't exist or is invalid, assume cache is valid
      log.warn('[AUTO_UPDATE] cache-info.json not found, assuming cache is valid');
      return true;
    }
  } catch (error) {
    log.error('[AUTO_UPDATE] Error checking local cache:', error);
    return false;
  }
}

/**
 * Execute auto-install script for macOS (bypasses Squirrel.Mac signature validation)
 */
async function executeAutoInstall() {
  // Only for macOS
  if (os.platform() !== 'darwin') {
    log.info('[AUTO_UPDATE] Auto-install only available on macOS');
    return false;
  }

  try {
    // Find the downloaded update zip
    const cacheDir = path.join(app.getPath('cache'), 'employee-safety-client', 'pending');
    const updateZip = path.join(cacheDir, 'EmployeeSafety.zip');

    if (!fs.existsSync(updateZip)) {
      log.error('[AUTO_UPDATE] Update zip not found:', updateZip);
      return false;
    }

    log.info('[AUTO_UPDATE] Found update zip:', updateZip);

    // Get install script path (in Resources if packaged, in project if dev)
    let scriptPath;
    if (app.isPackaged) {
      // ✅ 优先尝试 Resources 根目录（extraResource 默认位置）
      scriptPath = path.join(process.resourcesPath, 'auto-install-update-macos.sh');

      // 如果不存在，尝试 installer-scripts 子目录（向后兼容）
      if (!fs.existsSync(scriptPath)) {
        scriptPath = path.join(process.resourcesPath, 'installer-scripts', 'auto-install-update-macos.sh');
      }
    } else {
      scriptPath = path.join(__dirname, '..', 'installer-scripts', 'auto-install-update-macos.sh');
    }

    if (!fs.existsSync(scriptPath)) {
      log.error('[AUTO_UPDATE] Install script not found:', scriptPath);
      log.error('[AUTO_UPDATE] Searched locations:');
      log.error('[AUTO_UPDATE]   1. ', path.join(process.resourcesPath, 'auto-install-update-macos.sh'));
      log.error('[AUTO_UPDATE]   2. ', path.join(process.resourcesPath, 'installer-scripts', 'auto-install-update-macos.sh'));
      return false;
    }

    log.info('[AUTO_UPDATE] Executing install script:', scriptPath);
    log.info('[AUTO_UPDATE] Update zip:', updateZip);

    // Execute install script in background
    execFile(scriptPath, [updateZip], (error, stdout, stderr) => {
      if (error) {
        log.error('[AUTO_UPDATE] Install script error:', error);
        log.error('[AUTO_UPDATE] stderr:', stderr);

        // Show error notification to user
        dialog
          .showMessageBox({
            type: 'error',
            title: '更新安装失败',
            message: '自动安装更新时发生错误',
            detail: `错误信息: ${error.message}\n\n请尝试重启应用或联系技术支持。\n\n详细日志已保存到: ~/Library/Logs/employee-safety-client/auto-update.log`,
            buttons: ['重启应用', '稍后处理'],
            defaultId: 0,
            cancelId: 1
          })
          .then((response) => {
            if (response.response === 0) {
              // User chose to restart
              app.relaunch();
              app.exit(0);
            }
          })
          .catch((err) => log.error('[AUTO_UPDATE] Failed to show error dialog:', err));
        return;
      }

      log.info('[AUTO_UPDATE] Install script output:', stdout);
      if (stderr) {
        log.warn('[AUTO_UPDATE] Install script warnings:', stderr);
      }

      // Show success notification (optional)
      try {
        const notification = new Notification({
          title: '更新安装成功',
          body: '应用将在几秒钟内重启到新版本',
          silent: false
        });
        notification.show();
        log.info('[AUTO_UPDATE] Install success notification shown');
      } catch (notifError) {
        log.error('[AUTO_UPDATE] Failed to show success notification:', notifError);
      }
    });

    log.info('[AUTO_UPDATE] Install script launched successfully');
    return true;
  } catch (error) {
    log.error('[AUTO_UPDATE] Failed to execute auto-install:', error);
    return false;
  }
}

/**
 * Show update ready notification
 */
function showUpdateReadyNotification(info) {
  dialog
    .showMessageBox({
      type: 'question',
      title: '更新已就绪',
      message: `版本 ${info.version} 已下载完成`,
      detail:
        '更新已准备就绪，应用将重启以完成安装。\n\n' +
        '您要现在重启吗？',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1
    })
    .then((response) => {
      if (response.response === 0) {
        log.info('[AUTO_UPDATE] 用户选择立即重启');

        if (!autoUpdateService) {
          log.error('[AUTO_UPDATE] autoUpdateService 不可用，无法重启');
          dialog.showMessageBox({
            type: 'error',
            title: '重启失败',
            message: '更新服务不可用',
            detail: '请手动重启应用以完成更新',
            buttons: ['确定']
          });
          return;
        }

        try {
          log.info('[AUTO_UPDATE] 正在调用 quitAndInstall()...');
          autoUpdateService.quitAndInstall();
          log.info('[AUTO_UPDATE] quitAndInstall() 调用成功');
        } catch (error) {
          log.error('[AUTO_UPDATE] quitAndInstall() 失败:', error);
          dialog.showMessageBox({
            type: 'error',
            title: '重启失败',
            message: '无法自动重启应用',
            detail: `错误信息: ${error.message}\n\n请手动重启应用以完成更新`,
            buttons: ['确定']
          });
        }
      } else {
        log.info('[AUTO_UPDATE] 用户选择稍后重启');
      }
    })
    .catch((err) => log.error('[AUTO_UPDATE] Failed to show notification:', err));
}

/**
 * Show update success notification
 */
function showUpdateSuccessNotification() {
  dialog
    .showMessageBox({
      type: 'info',
      title: '更新完成',
      message: `已成功更新至版本 ${app.getVersion()}`,
      detail: '应用程序已成功更新。',
      buttons: ['确定'],
      defaultId: 0
    })
    .catch((err) => log.error('[AUTO_UPDATE] Failed to show notification:', err));
}

/**
 * Show update error notification
 */
function showUpdateErrorNotification(error) {
  log.error('[AUTO_UPDATE] Error:', error);
  // Don't show error dialogs to users - just log them
  // Errors are expected in some cases (network issues, etc.)
}

/**
 * Broadcast message to all windows
 */
function broadcastToAllWindows(channel, data) {
  const { BrowserWindow } = require('electron');
  const windows = BrowserWindow.getAllWindows();

  // 如果是下载进度事件，直接在main进程显示进度
  if (channel === 'update-download-progress' && data && typeof data.percent === 'number') {
    const percent = data.percent / 100; // 转换为0-1范围

    log.info(`[AUTO_UPDATE] Setting progress bar - Windows count: ${windows.length}, Percent: ${percent}`);

    windows.forEach((window, index) => {
      if (!window.isDestroyed()) {
        try {
          // 设置dock进度条（macOS）或任务栏进度（Windows）
          window.setProgressBar(percent);
          log.info(`[AUTO_UPDATE] Window ${index} - Progress bar set to ${percent}`);

          // 更新窗口标题显示进度
          const originalTitle = '企业安全';
          const newTitle = `${originalTitle} - 下载更新 ${Math.round(data.percent)}%`;
          window.setTitle(newTitle);
          log.info(`[AUTO_UPDATE] Window ${index} - Title set to: ${newTitle}`);
        } catch (error) {
          log.error(`[AUTO_UPDATE] Window ${index} - Error setting progress:`, error);
        }
      } else {
        log.warn(`[AUTO_UPDATE] Window ${index} is destroyed`);
      }
    });
  }

  // 发送事件给renderer
  windows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  });
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get auto-update service instance
 */
function getAutoUpdateService() {
  return autoUpdateService;
}

/**
 * Setup update event handlers
 */
function setupUpdateEventHandlers() {
  if (!autoUpdateService) return;

  autoUpdateService.on('update-available', async (info) => {
    log.info('[AUTO_UPDATE] New update available:', info.version);

    // Check if update is already cached locally
    const isCached = checkLocalUpdateCache(info.version);

    if (isCached) {
      log.info('[AUTO_UPDATE] Update already cached, skipping download');
      log.info('[AUTO_UPDATE] Triggering direct installation from cache');

      // Show notification about using cached update
      try {
        const notification = new Notification({
          title: '使用本地缓存更新',
          body: `版本 ${info.version} 已缓存，将直接安装`,
          silent: false
        });
        notification.show();
      } catch (error) {
        log.error('[AUTO_UPDATE] Failed to show cache notification:', error);
      }

      // Directly trigger installation without downloading
      // Simulate update-downloaded event
      if (os.platform() === 'darwin') {
        log.info('[AUTO_UPDATE] macOS detected - attempting auto-install from cache');
        const installed = await executeAutoInstall();

        if (installed) {
          log.info('[AUTO_UPDATE] Auto-install from cache initiated successfully');
          return;
        }

        log.warn('[AUTO_UPDATE] Auto-install from cache failed, falling back to manual notification');
        showUpdateReadyNotification(info);
      } else {
        showUpdateReadyNotification(info);
      }

      return; // Skip normal download process
    }

    // No cache, proceed with normal download
    log.info('[AUTO_UPDATE] No cache found, starting download');
    showUpdateAvailableNotification(info);
  });

  autoUpdateService.on('download-progress', (progress) => {
    log.info(
      `[AUTO_UPDATE] Download progress: ${Math.round(progress.percent)}%`
    );
    broadcastToAllWindows('update-download-progress', progress);
  });

  autoUpdateService.on('update-downloaded', async (info) => {
    log.info('[AUTO_UPDATE] Update downloaded:', info.version);

    // Save cache info for future use
    try {
      const cacheDir = path.join(app.getPath('cache'), 'employee-safety-client', 'pending');
      const cacheInfoPath = path.join(cacheDir, 'cache-info.json');
      const cacheInfo = {
        version: info.version,
        downloadedAt: new Date().toISOString()
      };
      fs.writeFileSync(cacheInfoPath, JSON.stringify(cacheInfo, null, 2));
      log.info('[AUTO_UPDATE] Cache info saved:', cacheInfo);
    } catch (error) {
      log.error('[AUTO_UPDATE] Failed to save cache info:', error);
    }

    // 清除进度条和恢复标题
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      if (!window.isDestroyed()) {
        window.setProgressBar(-1); // -1 移除进度条
        window.setTitle('企业安全');
      }
    });

    // On macOS, use custom auto-install to bypass Squirrel.Mac signature validation
    if (os.platform() === 'darwin') {
      log.info('[AUTO_UPDATE] macOS detected - attempting auto-install');
      const installed = await executeAutoInstall();

      if (installed) {
        log.info('[AUTO_UPDATE] Auto-install initiated successfully');
        // The install script will restart the app automatically
        return;
      }

      log.warn('[AUTO_UPDATE] Auto-install failed, falling back to manual notification');
    }

    showUpdateReadyNotification(info);
  });

  autoUpdateService.on('error', (error) => {
    try {
      log.error('[AUTO_UPDATE] Update error:', error.message);
      log.error('[AUTO_UPDATE] Error details:', error);
      // Don't show error notification - just log it
      // showUpdateErrorNotification(error);
    } catch (handlerError) {
      log.error('[AUTO_UPDATE] Error handler failed:', handlerError);
      // Swallow error to prevent crash
    }
  });
}

// Export functions
module.exports = {
  initializeAutoUpdate,
  setupUpdateIPCHandlers,
  getAutoUpdateService
};
