/**
 * 简化的 IPC 处理器
 *
 * 职责：
 * 1. 为渲染进程服务提供必要的 IPC 接口
 * 2. 委托调用主进程 EmployeeMonitorApp（如果可用）
 * 3. 提供降级/mock 实现（当主进程服务不可用时）
 *
 * Phase 3: 简化主进程，只保留窗口管理和 IPC
 */

const { ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * 设置简化的 IPC 处理器
 * @param {Object} refs - 引用对象
 * @param {Object} refs.app_instance - EmployeeMonitorApp 实例
 * @param {Object} refs.mainWindow - 主窗口实例
 * @param {Object} refs.tray - 托盘实例
 * @param {Function} refs.updateTrayIcon - 更新托盘图标函数
 * @param {Function} refs.updateTrayMenu - 更新托盘菜单函数
 * @param {Function} refs.sendLogToRenderer - 发送日志到渲染进程
 */
function setupSimplifiedIPCHandlers(refs) {
    const {
        app_instance,
        mainWindow,
        tray,
        updateTrayIcon,
        updateTrayMenu,
        sendLogToRenderer
    } = refs;

    console.log('[IPC] Setting up simplified IPC handlers...');

    // ==================== 配置管理 ====================

    /**
     * 获取应用配置
     * 优先从 app_instance 获取，否则返回默认配置
     */
    ipcMain.handle('get-config', async () => {
        try {
            console.log('[IPC] get-config called');

            // 尝试从 app_instance 获取配置
            if (app_instance?.() && typeof app_instance().getConfig === 'function') {
                const config = app_instance().getConfig();
                console.log('[IPC] Returning config from app_instance:', config);
                return config;
            }

            // 降级：返回默认配置
            const defaultConfig = {
                apiUrl: process.env.API_URL || 'http://localhost:3000',
                wsUrl: process.env.WS_URL || 'ws://localhost:3000',
                syncInterval: 60000,
                screenshotInterval: 300000,
                screenshotQuality: 80,
                activityInterval: 600000, // 活动收集间隔：10分钟
                deviceId: null
            };

            console.log('[IPC] Returning default config (app_instance not available)');
            return defaultConfig;
        } catch (error) {
            console.error('[IPC] get-config error:', error);
            // 返回最基础的配置
            return {
                apiUrl: 'http://localhost:3000',
                wsUrl: 'ws://localhost:3000',
                syncInterval: 60000,
                screenshotInterval: 300000,
                screenshotQuality: 80,
                activityInterval: 600000,
                deviceId: null
            };
        }
    });

    /**
     * 更新应用配置
     */
    ipcMain.handle('update-config', async (event, newConfig) => {
        console.log('[IPC] update-config called:', newConfig);

        if (app_instance?.() && typeof app_instance().updateConfig === 'function') {
            await app_instance().updateConfig(newConfig);

            // 广播配置更新到渲染进程
            if (mainWindow?.() && !mainWindow().isDestroyed()) {
                mainWindow().webContents.send('config-updated', newConfig);
            }

            return { success: true };
        }

        console.log('[IPC] update-config: app_instance not available');
        return { success: false, message: 'App instance not available' };
    });

    // ==================== 设备信息 ====================

    /**
     * 获取设备 ID
     * 优先从 app_instance 获取，否则返回系统标识
     */
    ipcMain.handle('get-device-id', async () => {
        try {
            console.log('[IPC] get-device-id called');

            // 尝试从 app_instance 获取
            if (app_instance?.() && app_instance().deviceId) {
                console.log('[IPC] Returning deviceId from app_instance:', app_instance().deviceId);
                return app_instance().deviceId;
            }

            // 降级：返回系统标识
            const fallbackId = `${os.hostname()}-${os.platform()}`;
            console.log('[IPC] Returning fallback deviceId:', fallbackId);
            return fallbackId;
        } catch (error) {
            console.error('[IPC] get-device-id error:', error);
            // 返回最基础的降级 ID
            return `unknown-${Date.now()}`;
        }
    });

    /**
     * 获取系统信息
     */
    ipcMain.handle('get-system-info', async () => {
        return {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            uptime: os.uptime()
        };
    });

    // ==================== FSM 状态管理 ====================

    /**
     * 获取当前 FSM 状态
     */
    ipcMain.handle('fsm:getCurrentState', () => {
        console.log('[IPC] fsm:getCurrentState called');

        if (app_instance?.() && typeof app_instance().getStateMachine === 'function') {
            const fsm = app_instance().getStateMachine();
            if (fsm && typeof fsm.getCurrentState === 'function') {
                const state = fsm.getCurrentState();
                console.log('[IPC] Current FSM state:', state);
                return state;
            }
        }

        console.log('[IPC] FSM not available, returning INIT');
        return 'INIT'; // 默认状态
    });

    /**
     * 强制 FSM 状态转换（调试用）
     */
    ipcMain.handle('fsm:forceTransition', async (event, targetState) => {
        console.log('[IPC] fsm:forceTransition called, target:', targetState);

        if (app_instance?.() && typeof app_instance().getStateMachine === 'function') {
            const fsm = app_instance().getStateMachine();
            if (fsm && typeof fsm.forceTransition === 'function') {
                try {
                    await fsm.forceTransition(targetState);
                    console.log('[IPC] FSM transition successful');
                    return { success: true, newState: fsm.getCurrentState() };
                } catch (error) {
                    console.error('[IPC] FSM transition failed:', error);
                    return { success: false, error: error.message };
                }
            }
        }

        console.log('[IPC] FSM not available for transition');
        return { success: false, message: 'FSM not available' };
    });

    // ==================== 数据同步 ====================

    /**
     * 触发数据同步
     */
    ipcMain.handle('system:syncData', async () => {
        try {
            console.log('[IPC] system:syncData called');

            if (app_instance?.() && typeof app_instance().syncData === 'function') {
                try {
                    const result = await app_instance().syncData();
                    console.log('[IPC] Data sync successful:', result);
                    return result;
                } catch (error) {
                    console.error('[IPC] Data sync failed:', error);
                    return {
                        synced: false,
                        error: error.message,
                        timestamp: Date.now()
                    };
                }
            }

            // 降级：返回 mock 数据
            console.log('[IPC] App instance not available, returning mock sync');
            return {
                synced: true,
                itemCount: 0,
                timestamp: Date.now(),
                message: 'Mock sync (app instance not available)'
            };
        } catch (error) {
            console.error('[IPC] system:syncData outer error:', error);
            return {
                synced: false,
                error: error.message || 'Unknown error',
                timestamp: Date.now()
            };
        }
    });

    // ==================== 应用控制 ====================

    /**
     * 启动应用服务
     */
    ipcMain.handle('app:start', async () => {
        console.log('[IPC] app:start called');

        if (app_instance?.() && typeof app_instance().startMonitoring === 'function') {
            try {
                await app_instance().startMonitoring();

                if (updateTrayIcon) updateTrayIcon(true);
                if (updateTrayMenu) updateTrayMenu();
                if (sendLogToRenderer) sendLogToRenderer('监控服务启动成功');

                console.log('[IPC] Service started successfully');
                return { success: true, message: 'Service started' };
            } catch (error) {
                console.error('[IPC] Service start failed:', error);
                return { success: false, error: error.message };
            }
        }

        console.log('[IPC] App instance not available');
        return { success: false, message: 'App instance not available' };
    });

    /**
     * 停止应用服务
     */
    ipcMain.handle('app:stop', async () => {
        console.log('[IPC] app:stop called');

        if (app_instance?.() && typeof app_instance().stopMonitoring === 'function') {
            try {
                await app_instance().stopMonitoring();

                if (updateTrayIcon) updateTrayIcon(false);
                if (updateTrayMenu) updateTrayMenu();
                if (sendLogToRenderer) sendLogToRenderer('监控服务已停止');

                console.log('[IPC] Service stopped successfully');
                return { success: true, message: 'Service stopped' };
            } catch (error) {
                console.error('[IPC] Service stop failed:', error);
                return { success: false, error: error.message };
            }
        }

        console.log('[IPC] App instance not available');
        return { success: false, message: 'App instance not available' };
    });

    /**
     * 获取应用状态
     */
    ipcMain.handle('app:getStatus', async () => {
        console.log('[IPC] app:getStatus called');

        if (app_instance?.()) {
            const instance = app_instance();
            const fsm = typeof instance.getStateMachine === 'function'
                ? instance.getStateMachine()
                : null;

            const status = {
                isRunning: false,
                state: 'UNKNOWN',
                deviceId: instance.deviceId || null,
                isPaused: false
            };

            if (fsm) {
                status.state = fsm.getCurrentState?.() || 'UNKNOWN';
                status.isRunning = typeof fsm.isServiceRunning === 'function'
                    ? fsm.isServiceRunning()
                    : false;
                status.isPaused = fsm.isPaused || false;
            }

            console.log('[IPC] App status:', status);
            return status;
        }

        console.log('[IPC] App instance not available, returning default status');
        return {
            isRunning: false,
            state: 'INIT',
            deviceId: null,
            isPaused: false
        };
    });

    // ==================== 窗口控制 ====================

    /**
     * 最小化窗口
     */
    ipcMain.handle('window:minimize', async () => {
        console.log('[IPC] window:minimize called');

        if (mainWindow?.() && !mainWindow().isDestroyed()) {
            mainWindow().hide();
            return { success: true };
        }

        return { success: false, message: 'Window not available' };
    });

    /**
     * 显示窗口
     */
    ipcMain.handle('window:show', async () => {
        console.log('[IPC] window:show called');

        if (mainWindow?.() && !mainWindow().isDestroyed()) {
            mainWindow().show();
            mainWindow().focus();
            return { success: true };
        }

        return { success: false, message: 'Window not available' };
    });

    // ==================== 日志管理 ====================

    /**
     * 添加日志
     */
    ipcMain.handle('log:add', async (event, logData) => {
        console.log('[IPC] log:add called:', logData);

        if (sendLogToRenderer && logData.message) {
            sendLogToRenderer(logData.message);
        }

        return { success: true };
    });

    console.log('[IPC] Simplified IPC handlers registered successfully');
}

/**
 * 设置事件广播机制
 * 监听主进程事件，转发到渲染进程
 *
 * @param {Object} refs - 引用对象
 * @param {Object} refs.app_instance - EmployeeMonitorApp 实例
 * @param {Object} refs.mainWindow - 主窗口实例
 */
function setupEventBroadcasting(refs) {
    const { app_instance, mainWindow } = refs;

    console.log('[IPC] Setting up event broadcasting...');

    if (!app_instance?.()) {
        console.log('[IPC] App instance not available, skipping event broadcasting setup');
        return;
    }

    const instance = app_instance();

    // 获取 FSM 实例
    const fsm = typeof instance.getStateMachine === 'function'
        ? instance.getStateMachine()
        : null;

    if (!fsm) {
        console.log('[IPC] FSM not available, skipping event broadcasting setup');
        return;
    }

    // 监听 FSM 状态变化
    if (typeof fsm.on === 'function') {
        fsm.on('state-change', (newState, oldState) => {
            console.log('[IPC] FSM state changed:', oldState, '->', newState);

            if (mainWindow?.() && !mainWindow().isDestroyed()) {
                mainWindow().webContents.send('fsm-state-changed', {
                    currentState: newState,
                    previousState: oldState,
                    timestamp: Date.now()
                });
            }
        });

        fsm.on('device-status', (data) => {
            console.log('[IPC] Device status changed:', data);

            if (mainWindow?.() && !mainWindow().isDestroyed()) {
                mainWindow().webContents.send('device-status-changed', data);
            }
        });

        console.log('[IPC] Event broadcasting setup complete');
    } else {
        console.log('[IPC] FSM does not support event listening');
    }
}

module.exports = {
    setupSimplifiedIPCHandlers,
    setupEventBroadcasting
};
