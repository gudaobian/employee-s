/**
 * Auto Update Integration for Main Process
 *
 * Integrates AutoUpdateService into Electron main process with:
 * - Automatic initialization on app ready
 * - Post-update permission verification
 * - IPC handlers for renderer communication
 * - Update notification system
 */

const { app, dialog, ipcMain } = require('electron');
const path = require('path');

// Will be dynamically loaded after TypeScript compilation
let AutoUpdateService;
let UpdateConfigService;
let updateLogger;
let autoUpdateService = null;

/**
 * Initialize auto-update system
 */
async function initializeAutoUpdate() {
  try {
    console.log('[AUTO_UPDATE] Initializing auto-update system...');

    // Dynamically load compiled TypeScript modules
    try {
      const appPath = app.getAppPath();
      const distPath = app.isPackaged
        ? path.join(path.dirname(appPath), 'dist')
        : path.join(appPath, 'dist');

      const { AutoUpdateService: AUS } = require(
        path.join(distPath, 'common', 'services', 'auto-update-service')
      );
      const { UpdateConfigService: UCS } = require(
        path.join(distPath, 'common', 'config', 'update-config')
      );
      const { updateLogger: UL } = require(
        path.join(distPath, 'common', 'utils', 'update-logger')
      );

      AutoUpdateService = AUS;
      UpdateConfigService = UCS;
      updateLogger = UL;
    } catch (loadError) {
      console.error('[AUTO_UPDATE] Failed to load update modules:', loadError.message);
      console.error('[AUTO_UPDATE] Auto-update will be disabled');
      return false;
    }

    // Load configuration
    const updateConfig = new UpdateConfigService();
    const config = updateConfig.getConfig();

    if (!config.enabled) {
      console.log('[AUTO_UPDATE] Auto-update is disabled in configuration');
      return false;
    }

    console.log('[AUTO_UPDATE] Configuration loaded:', {
      channel: config.channel,
      updateServerUrl: config.updateServerUrl,
      autoDownload: config.autoDownload,
      checkInterval: config.checkInterval
    });

    // Create AutoUpdateService instance
    autoUpdateService = new AutoUpdateService({
      updateServerUrl: config.updateServerUrl,
      channel: config.channel,
      autoDownload: config.autoDownload,
      autoInstallOnQuit: config.autoInstallOnQuit
    });

    // Set up event handlers
    setupUpdateEventHandlers();

    // Verify previous update success
    const wasUpdated = await autoUpdateService.verifyUpdateSuccess();
    if (wasUpdated) {
      console.log('[AUTO_UPDATE] ✅ Previous update verified successfully');

      // Show success notification
      showUpdateSuccessNotification();
    }

    // Start periodic update checks
    autoUpdateService.startPeriodicCheck(config.checkInterval);

    console.log('[AUTO_UPDATE] ✅ Auto-update system initialized successfully');
    return true;
  } catch (error) {
    console.error('[AUTO_UPDATE] Initialization failed:', error);
    return false;
  }
}

/**
 * Setup update event handlers
 */
function setupUpdateEventListeners(service) {
  service.on('update-available', (info) => {
    console.log('[AUTO_UPDATE] New update available:', info.version);
    showUpdateAvailableNotification(info);
  });

  service.on('download-progress', (progress) => {
    console.log(
      `[AUTO_UPDATE] Download progress: ${Math.round(progress.percent)}%`
    );
    // Send progress to renderer if needed
    broadcastToAllWindows('update-download-progress', progress);
  });

  service.on('update-downloaded', (info) => {
    console.log('[AUTO_UPDATE] Update downloaded:', info.version);
    showUpdateReadyNotification(info);
  });

  service.on('error', (error) => {
    console.error('[AUTO_UPDATE] Update error:', error.message);
    showUpdateErrorNotification(error);
  });

  service.on('checking-for-update', () => {
    console.log('[AUTO_UPDATE] Checking for updates...');
  });

  service.on('update-not-available', () => {
    console.log('[AUTO_UPDATE] No update available');
  });
}

/**
 * Setup IPC handlers for renderer process
 */
function setupUpdateIPCHandlers() {
  // Check for updates manually
  ipcMain.handle('check-for-updates', async () => {
    if (!autoUpdateService) {
      return { success: false, error: 'Update service not available' };
    }

    try {
      await autoUpdateService.checkForUpdates();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
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

  console.log('[AUTO_UPDATE] IPC handlers registered');
}

/**
 * Show update available notification
 */
function showUpdateAvailableNotification(info) {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is now available`,
      detail:
        `Current version: ${app.getVersion()}\n` +
        `New version: ${info.version}\n\n` +
        `The update will download in the background and install automatically when you quit the application.`,
      buttons: ['OK'],
      defaultId: 0
    })
    .catch((err) => console.error('[AUTO_UPDATE] Failed to show notification:', err));
}

/**
 * Show update ready notification
 */
function showUpdateReadyNotification(info) {
  dialog
    .showMessageBox({
      type: 'question',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded`,
      detail:
        'The update is ready to install. The application will restart to complete the installation.\n\n' +
        'Do you want to restart now?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    .then((response) => {
      if (response.response === 0 && autoUpdateService) {
        // User chose to restart now
        autoUpdateService.quitAndInstall();
      }
    })
    .catch((err) => console.error('[AUTO_UPDATE] Failed to show notification:', err));
}

/**
 * Show update success notification
 */
function showUpdateSuccessNotification() {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update Complete',
      message: `Successfully updated to version ${app.getVersion()}`,
      detail: 'The application has been updated successfully.',
      buttons: ['OK'],
      defaultId: 0
    })
    .catch((err) => console.error('[AUTO_UPDATE] Failed to show notification:', err));
}

/**
 * Show update error notification
 */
function showUpdateErrorNotification(error) {
  console.error('[AUTO_UPDATE] Error:', error);
  // Don't show error dialogs to users - just log them
  // Errors are expected in some cases (network issues, etc.)
}

/**
 * Broadcast message to all windows
 */
function broadcastToAllWindows(channel, data) {
  const { BrowserWindow } = require('electron');
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  });
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

  autoUpdateService.on('update-available', (info) => {
    console.log('[AUTO_UPDATE] New update available:', info.version);
    showUpdateAvailableNotification(info);
  });

  autoUpdateService.on('download-progress', (progress) => {
    console.log(
      `[AUTO_UPDATE] Download progress: ${Math.round(progress.percent)}%`
    );
    broadcastToAllWindows('update-download-progress', progress);
  });

  autoUpdateService.on('update-downloaded', (info) => {
    console.log('[AUTO_UPDATE] Update downloaded:', info.version);
    showUpdateReadyNotification(info);
  });

  autoUpdateService.on('error', (error) => {
    console.error('[AUTO_UPDATE] Update error:', error.message);
    showUpdateErrorNotification(error);
  });
}

// Export functions
module.exports = {
  initializeAutoUpdate,
  setupUpdateIPCHandlers,
  getAutoUpdateService
};
