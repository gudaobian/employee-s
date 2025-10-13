/**
 * Windows原生模块自动安装器
 * 在运行时下载和编译Windows特定的原生事件监控模块
 */

const { ipcMain, shell, app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const https = require('https');
const util = require('util');

const execAsync = util.promisify(exec);

class NativeModuleInstaller {
    constructor() {
        this.setupIpcHandlers();
        this.installPath = path.join(app.getPath('userData'), 'native-modules');
        this.moduleSourceUrl = 'https://github.com/your-repo/native-event-monitor-win/archive/main.zip'; // 需要替换为实际的仓库地址
    }

    setupIpcHandlers() {
        // 检查管理员权限
        ipcMain.handle('check-admin-permissions', async () => {
            return await this.checkAdminPermissions();
        });

        // 请求权限提升
        ipcMain.handle('request-elevation', async () => {
            return await this.requestElevation();
        });

        // 下载原生模块源码
        ipcMain.handle('download-native-module-source', async () => {
            return await this.downloadModuleSource();
        });

        // 设置构建环境
        ipcMain.handle('setup-build-environment', async () => {
            return await this.setupBuildEnvironment();
        });

        // 编译原生模块
        ipcMain.handle('compile-native-module', async () => {
            return await this.compileNativeModule();
        });

        // 安装原生模块
        ipcMain.handle('install-native-module', async () => {
            return await this.installNativeModule();
        });

        // 检查原生模块状态
        ipcMain.handle('check-native-module-status', async () => {
            return await this.checkNativeModuleStatus();
        });

        // 重启应用程序
        ipcMain.handle('restart-application', async () => {
            app.relaunch();
            app.exit();
        });
    }

    async checkAdminPermissions() {
        try {
            if (process.platform === 'win32') {
                await execAsync('net session >nul 2>&1');
                return true;
            }
            return true; // 非Windows平台假设有权限
        } catch (error) {
            return false;
        }
    }

    async requestElevation() {
        try {
            if (process.platform === 'win32') {
                // 创建UAC提升脚本
                const elevationScript = `
                    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
                    $startInfo.FileName = "${process.execPath}"
                    $startInfo.Arguments = "${process.argv.slice(1).join(' ')}"
                    $startInfo.Verb = "runas"
                    $startInfo.UseShellExecute = $true
                    
                    try {
                        [System.Diagnostics.Process]::Start($startInfo)
                        Write-Output "Elevation requested successfully"
                    } catch {
                        Write-Error "Elevation failed"
                        exit 1
                    }
                `;

                await execAsync(`powershell -Command "${elevationScript}"`);
                return true;
            }
            return true;
        } catch (error) {
            console.error('权限提升失败:', error);
            return false;
        }
    }

    async downloadModuleSource() {
        try {
            // 确保安装目录存在
            if (!fs.existsSync(this.installPath)) {
                fs.mkdirSync(this.installPath, { recursive: true });
            }

            // 方案1: 从应用程序资源复制
            const sourceDir = path.join(__dirname, '..', 'native-event-monitor-win');
            const targetDir = path.join(this.installPath, 'native-event-monitor-win');
            
            if (fs.existsSync(sourceDir)) {
                await this.copyDirectory(sourceDir, targetDir);
                console.log('从应用程序资源复制原生模块源码');
                return true;
            }

            // 方案2: 从网络下载（如果有远程仓库）
            // 这里可以实现从GitHub或其他源下载
            console.log('使用内置源码');
            return true;

        } catch (error) {
            console.error('下载模块源码失败:', error);
            throw new Error(`下载失败: ${error.message}`);
        }
    }

    async copyDirectory(source, target) {
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }

        const items = fs.readdirSync(source);
        for (const item of items) {
            const sourcePath = path.join(source, item);
            const targetPath = path.join(target, item);
            const stat = fs.statSync(sourcePath);

            if (stat.isDirectory()) {
                await this.copyDirectory(sourcePath, targetPath);
            } else {
                fs.copyFileSync(sourcePath, targetPath);
            }
        }
    }

    async setupBuildEnvironment() {
        try {
            // 检查必要的构建工具
            const checks = [
                { name: 'Node.js', command: 'node --version' },
                { name: 'npm', command: 'npm --version' }
            ];

            for (const check of checks) {
                try {
                    await execAsync(check.command);
                    console.log(`✅ ${check.name} 可用`);
                } catch (error) {
                    throw new Error(`${check.name} 未安装或不可用`);
                }
            }

            // 检查node-gyp
            try {
                await execAsync('npx node-gyp --version');
                console.log('✅ node-gyp 可用');
            } catch (error) {
                console.log('安装 node-gyp...');
                await execAsync('npm install -g node-gyp');
            }

            // 检查Python
            try {
                await execAsync('python --version');
                console.log('✅ Python 可用');
            } catch (error) {
                console.warn('⚠️ Python 可能未安装，某些原生模块可能无法编译');
            }

            return true;
        } catch (error) {
            console.error('构建环境设置失败:', error);
            throw new Error(`构建环境设置失败: ${error.message}`);
        }
    }

    async compileNativeModule() {
        try {
            const moduleDir = path.join(this.installPath, 'native-event-monitor-win');
            
            if (!fs.existsSync(moduleDir)) {
                throw new Error('原生模块源码不存在');
            }

            console.log('开始编译原生模块...');
            
            // 切换到模块目录并安装依赖
            process.chdir(moduleDir);
            
            console.log('安装依赖...');
            await execAsync('npm install');
            
            console.log('编译原生模块...');
            await execAsync('npm run build');
            
            // 验证编译结果
            const buildOutputs = [
                path.join(moduleDir, 'build', 'Release', 'event_monitor.node'),
                path.join(moduleDir, 'build', 'Debug', 'event_monitor.node')
            ];
            
            const hasOutput = buildOutputs.some(outputPath => fs.existsSync(outputPath));
            if (!hasOutput) {
                throw new Error('编译完成但未找到输出文件');
            }
            
            console.log('✅ 原生模块编译成功');
            return true;
            
        } catch (error) {
            console.error('原生模块编译失败:', error);
            throw new Error(`编译失败: ${error.message}`);
        }
    }

    async installNativeModule() {
        try {
            const sourceDir = path.join(this.installPath, 'native-event-monitor-win');
            const appDir = path.dirname(app.getPath('exe'));
            const targetDir = path.join(appDir, 'resources', 'native-event-monitor-win');
            
            // 复制编译后的模块到应用程序目录
            await this.copyDirectory(sourceDir, targetDir);
            
            console.log('✅ 原生模块安装成功');
            return true;
            
        } catch (error) {
            console.error('原生模块安装失败:', error);
            throw new Error(`安装失败: ${error.message}`);
        }
    }

    async checkNativeModuleStatus() {
        try {
            // 检查原生模块是否存在并可加载
            const appDir = path.dirname(app.getPath('exe'));
            const moduleFiles = [
                path.join(appDir, 'resources', 'native-event-monitor-win', 'build', 'Release', 'event_monitor.node'),
                path.join(appDir, 'resources', 'native-event-monitor-win', 'build', 'Debug', 'event_monitor.node'),
                path.join(__dirname, '..', 'native-event-monitor-win', 'build', 'Release', 'event_monitor.node'),
                path.join(__dirname, '..', 'native-event-monitor-win', 'build', 'Debug', 'event_monitor.node')
            ];
            
            for (const moduleFile of moduleFiles) {
                if (fs.existsSync(moduleFile)) {
                    try {
                        // 尝试加载模块
                        require(moduleFile);
                        console.log('✅ 原生模块可用:', moduleFile);
                        return true;
                    } catch (error) {
                        console.warn('⚠️ 原生模块文件存在但无法加载:', error.message);
                    }
                }
            }
            
            return false;
            
        } catch (error) {
            console.error('检查原生模块状态失败:', error);
            return false;
        }
    }

    async showInstallationDialog() {
        const result = await dialog.showMessageBox({
            type: 'info',
            title: 'Windows完整功能',
            message: '检测到可以启用Windows完整监控功能',
            detail: '是否现在下载并安装原生事件监控模块？这将启用真实的键盘和鼠标事件检测。',
            buttons: ['立即安装', '手动安装', '稍后提醒'],
            defaultId: 0,
            cancelId: 2
        });

        return result.response;
    }
}

module.exports = NativeModuleInstaller;