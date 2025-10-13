/**
 * Windows原生模块自动安装器
 * 集成到主应用程序中，无需手动命令行操作
 */

const { ipcMain, dialog, shell } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class WindowsNativeInstaller {
    constructor() {
        this.isInstalling = false;
        this.installProgress = 0;
        this.installStatus = 'ready'; // ready, installing, success, error
        this.errorMessage = '';
        this.setupIPC();
    }

    setupIPC() {
        // 检查原生模块状态
        ipcMain.handle('check-native-module-status', async () => {
            return this.checkNativeModuleStatus();
        });

        // 开始安装原生模块
        ipcMain.handle('install-native-module', async (event) => {
            return this.installNativeModule(event);
        });

        // 获取安装进度
        ipcMain.handle('get-install-progress', () => {
            return {
                isInstalling: this.isInstalling,
                progress: this.installProgress,
                status: this.installStatus,
                errorMessage: this.errorMessage
            };
        });

        // 重启应用程序启用原生模块
        ipcMain.handle('restart-with-native-module', () => {
            this.restartApplication();
        });
    }

    /**
     * 检查原生模块状态
     */
    checkNativeModuleStatus() {
        const appPath = process.resourcesPath || __dirname;
        const nativeModulePath = path.join(appPath, 'native-event-monitor-win', 'build', 'Release', 'event_monitor.node');
        
        const status = {
            isAvailable: fs.existsSync(nativeModulePath),
            hasSourceCode: this.hasSourceCode(),
            hasNodejs: this.hasNodejs(),
            hasNPM: this.hasNPM(),
            hasPython: this.hasPython(),
            hasVisualStudio: this.hasVisualStudioBuildTools(),
            canAutoInstall: false
        };

        // 判断是否可以自动安装
        status.canAutoInstall = status.hasSourceCode && status.hasNodejs && status.hasNPM;

        return status;
    }

    /**
     * 检查是否有源代码
     */
    hasSourceCode() {
        const appPath = process.resourcesPath || __dirname;
        const srcPath = path.join(appPath, 'native-event-monitor-win', 'src');
        const packagePath = path.join(appPath, 'native-event-monitor-win', 'package.json');
        
        return fs.existsSync(srcPath) && fs.existsSync(packagePath);
    }

    /**
     * 检查Node.js
     */
    hasNodejs() {
        try {
            const result = require('child_process').execSync('node --version', { encoding: 'utf8' });
            return result.includes('v');
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查NPM
     */
    hasNPM() {
        try {
            const result = require('child_process').execSync('npm --version', { encoding: 'utf8' });
            return result.trim().length > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查Python
     */
    hasPython() {
        try {
            const result = require('child_process').execSync('python --version', { encoding: 'utf8' });
            return result.includes('Python');
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查Visual Studio Build Tools
     */
    hasVisualStudioBuildTools() {
        // 简化检查 - 实际使用中可以更详细
        return true; // 假设大多数Windows系统都有
    }

    /**
     * 安装原生模块
     */
    async installNativeModule(event) {
        if (this.isInstalling) {
            return { success: false, message: '安装正在进行中' };
        }

        this.isInstalling = true;
        this.installProgress = 0;
        this.installStatus = 'installing';
        this.errorMessage = '';

        try {
            const appPath = process.resourcesPath || __dirname;
            const nativeModuleDir = path.join(appPath, 'native-event-monitor-win');

            // 更新进度
            this.updateProgress(event, 10, '准备安装环境...');

            // 步骤1: 安装node-gyp
            await this.runCommand('npm install -g node-gyp', '安装node-gyp...');
            this.updateProgress(event, 25, '安装构建工具...');

            // 步骤2: 进入目录并安装依赖
            process.chdir(nativeModuleDir);
            await this.runCommand('npm install', '安装依赖包...');
            this.updateProgress(event, 50, '编译原生模块...');

            // 步骤3: 编译原生模块
            await this.runCommand('npm run build', '编译中...');
            this.updateProgress(event, 80, '测试原生模块...');

            // 步骤4: 测试编译结果
            const testResult = await this.testNativeModule();
            this.updateProgress(event, 95, '完成安装...');

            if (testResult.success) {
                this.installStatus = 'success';
                this.installProgress = 100;
                this.updateProgress(event, 100, '安装成功！');
                
                return { 
                    success: true, 
                    message: '原生模块安装成功！请重启应用程序启用完整功能。',
                    needsRestart: true
                };
            } else {
                throw new Error(`测试失败: ${testResult.error}`);
            }

        } catch (error) {
            this.installStatus = 'error';
            this.errorMessage = error.message;
            this.updateProgress(event, 0, `安装失败: ${error.message}`);
            
            return { 
                success: false, 
                message: `安装失败: ${error.message}`,
                suggestion: this.getSuggestion(error.message)
            };
        } finally {
            this.isInstalling = false;
        }
    }

    /**
     * 运行命令
     */
    runCommand(command, description) {
        return new Promise((resolve, reject) => {
            console.log(`[INSTALLER] ${description}: ${command}`);
            
            const child = exec(command, { 
                encoding: 'utf8',
                timeout: 300000 // 5分钟超时
            });

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => {
                output += data;
                console.log(`[INSTALLER] ${data.trim()}`);
            });

            child.stderr.on('data', (data) => {
                errorOutput += data;
                console.error(`[INSTALLER] ERROR: ${data.trim()}`);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    console.log(`[INSTALLER] ✅ ${description} 完成`);
                    resolve(output);
                } else {
                    console.error(`[INSTALLER] ❌ ${description} 失败 (code: ${code})`);
                    reject(new Error(`${description} 失败: ${errorOutput || '未知错误'}`));
                }
            });

            child.on('error', (error) => {
                console.error(`[INSTALLER] ❌ ${description} 错误:`, error);
                reject(error);
            });
        });
    }

    /**
     * 测试原生模块
     */
    async testNativeModule() {
        try {
            const nativeModulePath = path.join(process.cwd(), 'build', 'Release', 'event_monitor.node');
            
            if (!fs.existsSync(nativeModulePath)) {
                return { success: false, error: '编译的原生模块文件不存在' };
            }

            // 尝试加载模块
            const nativeModule = require(nativeModulePath);
            
            if (typeof nativeModule.startMonitoring === 'function') {
                return { success: true };
            } else {
                return { success: false, error: '原生模块接口不完整' };
            }
            
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 更新进度
     */
    updateProgress(event, progress, message) {
        this.installProgress = progress;
        
        if (event && event.sender) {
            event.sender.send('install-progress-update', {
                progress,
                message,
                status: this.installStatus
            });
        }
        
        console.log(`[INSTALLER] Progress: ${progress}% - ${message}`);
    }

    /**
     * 获取错误建议
     */
    getSuggestion(errorMessage) {
        if (errorMessage.includes('node-gyp')) {
            return '请尝试安装 Windows Build Tools: npm install -g windows-build-tools';
        }
        if (errorMessage.includes('Python')) {
            return '请安装Python: https://www.python.org/';
        }
        if (errorMessage.includes('Visual Studio')) {
            return '请安装Visual Studio Build Tools';
        }
        if (errorMessage.includes('权限') || errorMessage.includes('permission')) {
            return '请以管理员身份运行应用程序';
        }
        return '请检查网络连接和系统环境';
    }

    /**
     * 重启应用程序
     */
    restartApplication() {
        const { app } = require('electron');
        
        // 显示确认对话框
        const result = dialog.showMessageBoxSync(null, {
            type: 'question',
            buttons: ['立即重启', '稍后重启'],
            defaultId: 0,
            title: '重启应用程序',
            message: '原生模块安装完成！',
            detail: '需要重启应用程序来启用完整的Windows事件监控功能。'
        });

        if (result === 0) {
            app.relaunch();
            app.exit(0);
        }
    }

    /**
     * 打开手动安装指南
     */
    openManualGuide() {
        const guidePath = path.join(__dirname, 'native-module-downloader.html');
        shell.openPath(guidePath);
    }
}

// 导出安装器
module.exports = { WindowsNativeInstaller };