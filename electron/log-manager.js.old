/**
 * 统一日志管理器
 * 功能：
 * 1. 控制台输出（保留原有console.log）
 * 2. UI容器显示（最近100条日志）
 * 3. 文件存储（按日期时间轮转）
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class LogManager {
    constructor() {
        this.maxUILogs = 100; // UI最大显示日志条数
        this.maxFileLines = 10000; // 单个日志文件最大行数
        this.uiLogs = []; // UI显示的日志缓存
        this.mainWindow = null; // 主窗口引用
        
        // 初始化日志目录
        this.initLogDirectory();
        
        // 劫持原生console方法
        this.hijackConsole();
        
        console.log('[LOG_MANAGER] 日志管理器已初始化');
    }
    
    /**
     * 初始化日志目录
     */
    initLogDirectory() {
        try {
            // 获取应用安装/运行目录
            let appPath;
            try {
                appPath = app && app.getPath ? app.getPath('userData') : null;
            } catch (error) {
                // app module not available (non-Electron environment)
                appPath = null;
            }
            
            if (!appPath) {
                appPath = process.cwd();
            }
            
            this.logsDir = path.join(appPath, 'logs');
            
            // 创建logs目录
            if (!fs.existsSync(this.logsDir)) {
                fs.mkdirSync(this.logsDir, { recursive: true });
                console.log('[LOG_MANAGER] 创建日志目录:', this.logsDir);
            }
            
            // 获取当前日志文件路径
            this.updateCurrentLogFile();
            
        } catch (error) {
            console.error('[LOG_MANAGER] 初始化日志目录失败:', error.message);
            // 如果无法创建日志目录，使用临时目录
            this.logsDir = path.join(require('os').tmpdir(), 'employee-monitor-logs');
            try {
                if (!fs.existsSync(this.logsDir)) {
                    fs.mkdirSync(this.logsDir, { recursive: true });
                }
                this.updateCurrentLogFile();
            } catch (fallbackError) {
                console.error('[LOG_MANAGER] 使用备选日志目录也失败:', fallbackError.message);
                this.logsDir = null; // 禁用文件日志
            }
        }
    }
    
    /**
     * 更新当前日志文件路径
     */
    updateCurrentLogFile() {
        if (!this.logsDir) return;
        
        const now = new Date();
        const dateStr = now.getFullYear() + 
                       String(now.getMonth() + 1).padStart(2, '0') + 
                       String(now.getDate()).padStart(2, '0');
        const timeStr = String(now.getHours()).padStart(2, '0') + 
                       String(now.getMinutes()).padStart(2, '0') + 
                       String(now.getSeconds()).padStart(2, '0');
        
        this.currentLogFile = path.join(this.logsDir, `${dateStr}_${timeStr}.log`);
        
        // 检查当前日志文件是否需要轮转
        this.checkLogRotation();
    }
    
    /**
     * 检查日志轮转
     */
    checkLogRotation() {
        if (!this.currentLogFile || !fs.existsSync(this.currentLogFile)) {
            return;
        }
        
        try {
            const content = fs.readFileSync(this.currentLogFile, 'utf8');
            const lines = content.split('\n').length;
            
            if (lines >= this.maxFileLines) {
                console.log('[LOG_MANAGER] 日志文件已达到最大行数，开始轮转');
                this.updateCurrentLogFile(); // 创建新的日志文件
            }
        } catch (error) {
            console.error('[LOG_MANAGER] 检查日志轮转失败:', error.message);
        }
    }
    
    /**
     * 设置主窗口引用
     */
    setMainWindow(window) {
        this.mainWindow = window;
    }
    
    /**
     * 劫持原生console方法
     */
    hijackConsole() {
        // 保存原始方法
        this.originalConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn,
            info: console.info,
            debug: console.debug
        };
        
        // 重写console方法
        console.log = (...args) => this.log('info', args);
        console.error = (...args) => this.log('error', args);
        console.warn = (...args) => this.log('warning', args);
        console.info = (...args) => this.log('info', args);
        console.debug = (...args) => this.log('debug', args);
    }
    
    /**
     * 核心日志方法
     */
    log(level, args) {
        const timestamp = new Date();
        const timeStr = timestamp.toLocaleTimeString('zh-CN', { hour12: false });
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        
        // 1. 保持原有控制台输出
        const originalMethod = this.originalConsole[level === 'warning' ? 'warn' : level] || this.originalConsole.log;
        originalMethod(...args);
        
        // 2. 构造格式化日志条目
        const logEntry = {
            timestamp: timestamp.toISOString(),
            timeStr,
            level,
            message,
            fullMessage: `[${timeStr}] ${this.getLevelIcon(level)} ${message}`
        };
        
        // 3. 添加到UI日志缓存
        this.addToUICache(logEntry);
        
        // 4. 写入文件
        this.writeToFile(logEntry);
        
        // 5. 发送到UI（如果窗口存在）
        this.sendToUI(logEntry);
    }
    
    /**
     * 获取日志级别图标
     */
    getLevelIcon(level) {
        const icons = {
            info: 'ℹ️',
            warning: '⚠️',
            error: '❌',
            debug: '🔍',
            success: '✅'
        };
        return icons[level] || 'ℹ️';
    }
    
    /**
     * 添加到UI缓存
     */
    addToUICache(logEntry) {
        this.uiLogs.push(logEntry);
        
        // 保持UI日志数量限制
        if (this.uiLogs.length > this.maxUILogs) {
            this.uiLogs = this.uiLogs.slice(-this.maxUILogs);
        }
    }
    
    /**
     * 写入文件
     */
    writeToFile(logEntry) {
        if (!this.currentLogFile) return;
        
        try {
            const fileLogLine = `${logEntry.timestamp} [${logEntry.level.toUpperCase()}] ${logEntry.message}\n`;
            fs.appendFileSync(this.currentLogFile, fileLogLine);
            
            // 定期检查日志轮转（每100次写入检查一次）
            if (Math.random() < 0.01) {
                this.checkLogRotation();
            }
        } catch (error) {
            this.originalConsole.error('[LOG_MANAGER] 写入日志文件失败:', error.message);
        }
    }
    
    /**
     * 发送到UI
     */
    sendToUI(logEntry) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            try {
                this.mainWindow.webContents.send('log-update', {
                    type: 'new-log',
                    log: logEntry
                });
            } catch (error) {
                this.originalConsole.error('[LOG_MANAGER] 发送日志到UI失败:', error.message);
            }
        }
    }
    
    /**
     * 获取UI日志（用于初始化显示）
     */
    getUILogs() {
        return this.uiLogs;
    }
    
    /**
     * 清理旧日志文件
     */
    cleanupOldLogs(maxDays = 30) {
        if (!this.logsDir) return;
        
        try {
            const files = fs.readdirSync(this.logsDir);
            const cutoffTime = Date.now() - (maxDays * 24 * 60 * 60 * 1000);
            
            files.forEach(file => {
                if (file.endsWith('.log')) {
                    const filePath = path.join(this.logsDir, file);
                    const stats = fs.statSync(filePath);
                    
                    if (stats.mtime.getTime() < cutoffTime) {
                        fs.unlinkSync(filePath);
                        this.originalConsole.log('[LOG_MANAGER] 删除旧日志文件:', file);
                    }
                }
            });
        } catch (error) {
            this.originalConsole.error('[LOG_MANAGER] 清理旧日志失败:', error.message);
        }
    }
    
    /**
     * 获取日志统计信息
     */
    getLogStats() {
        const stats = {
            logsDir: this.logsDir,
            currentLogFile: this.currentLogFile,
            uiLogCount: this.uiLogs.length,
            maxUILogs: this.maxUILogs,
            maxFileLines: this.maxFileLines
        };
        
        if (this.logsDir) {
            try {
                const files = fs.readdirSync(this.logsDir);
                stats.logFileCount = files.filter(f => f.endsWith('.log')).length;
                
                if (this.currentLogFile && fs.existsSync(this.currentLogFile)) {
                    const content = fs.readFileSync(this.currentLogFile, 'utf8');
                    stats.currentFileLines = content.split('\n').length - 1;
                }
            } catch (error) {
                stats.error = error.message;
            }
        }
        
        return stats;
    }
    
    /**
     * 恢复原始console方法（用于清理）
     */
    restore() {
        if (this.originalConsole) {
            console.log = this.originalConsole.log;
            console.error = this.originalConsole.error;
            console.warn = this.originalConsole.warn;
            console.info = this.originalConsole.info;
            console.debug = this.originalConsole.debug;
        }
    }
}

module.exports = LogManager;