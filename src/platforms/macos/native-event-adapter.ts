import { EventEmitter } from 'events';
import { logger } from '../../common/utils/logger';

interface MacOSEventMonitor {
    start(): boolean;
    stop(): boolean;
    getCounts(): { keyboard: number; mouse: number; scrolls: number; isMonitoring: boolean };
    resetCounts(): boolean;
    isMonitoring(): boolean;
}

export class NativeEventAdapter extends EventEmitter {
    private monitor: MacOSEventMonitor | null = null;
    private isInitialized = false;
    private checkInterval: NodeJS.Timeout | null = null;
    private lastCounts = { keyboard: 0, mouse: 0, scrolls: 0 };
    private instanceId: string;

    constructor() {
        super();
        this.instanceId = `NEA_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[NATIVE_EVENT] 🆕 创建新实例: ${this.instanceId}`);
    }

    async initialize(): Promise<boolean> {
        try {
            // 尝试加载原生模块 - 考虑编译后的路径
            let MacOSEventMonitor;
            
            logger.info(`初始化原生事件适配器, 当前目录: ${__dirname}`);
            
            try {
                // 简化的路径解析策略 - 3种场景
                const path = require('path');
                const fs = require('fs');

                // 定义路径解析策略函数
                const pathStrategies = [
                    // 策略1: ASAR解包后的路径 (Electron打包后)
                    {
                        name: 'ASAR unpacked',
                        getPath: () => {
                            // process.resourcesPath 在Electron打包后指向Resources目录
                            const resourcesPath = (process as any).resourcesPath;
                            if (resourcesPath) {
                                return path.join(resourcesPath, 'app.asar.unpacked', 'native/macos');
                            }
                            return null;
                        }
                    },

                    // 策略2: 开发环境路径 (相对于可执行文件或工作目录)
                    {
                        name: 'Development',
                        getPath: () => {
                            // 尝试从多个基础目录定位
                            const baseDirs = [
                                process.cwd(),  // 当前工作目录
                                path.dirname(process.execPath),  // 可执行文件目录
                                path.dirname(require.main?.filename || ''),  // 主模块目录
                            ];

                            for (const baseDir of baseDirs) {
                                if (!baseDir) continue;
                                const modulePath = path.resolve(baseDir, 'native/macos');
                                if (fs.existsSync(modulePath)) {
                                    return modulePath;
                                }
                            }
                            return null;
                        }
                    },

                    // 策略3: 编译后的相对路径 (从out/dist目录向上查找)
                    {
                        name: 'Compiled relative',
                        getPath: () => {
                            // __dirname 在编译后通常是 out/dist/platforms/darwin
                            // 向上4级到达项目根目录
                            return path.resolve(__dirname, '../../../../native/macos');
                        }
                    }
                ];

                // 尝试所有策略
                let loadedPath: string | null = null;
                const attemptedPaths: string[] = [];

                for (const strategy of pathStrategies) {
                    const modulePath = strategy.getPath();
                    if (!modulePath) continue;

                    attemptedPaths.push(`${strategy.name}: ${modulePath}`);

                    if (fs.existsSync(modulePath)) {
                        logger.info(`[NATIVE_EVENT] ✅ 找到原生模块 (${strategy.name}): ${modulePath}`);
                        MacOSEventMonitor = require(modulePath);
                        loadedPath = modulePath;
                        break;
                    } else {
                        logger.debug(`[NATIVE_EVENT] ⏭️  跳过策略 ${strategy.name}: 路径不存在`);
                    }
                }

                if (!loadedPath) {
                    throw new Error(
                        `无法找到原生模块 native/macos。\n` +
                        `尝试的路径策略:\n${attemptedPaths.map(p => `  - ${p}`).join('\n')}\n` +
                        `请确保:\n` +
                        `  1. 已运行 npm run build:native:mac 编译原生模块\n` +
                        `  2. native/macos 目录存在于项目根目录\n` +
                        `  3. 如果是打包后的应用，检查 asarUnpack 配置是否正确`
                    );
                }

                logger.info('✅ 原生模块加载成功');
            } catch (error) {
                logger.error('原生模块加载失败:', error);
                throw error;
            }
            
            console.log('[NATIVE_EVENT] 🔧 创建MacOSEventMonitor实例...');
            this.monitor = new MacOSEventMonitor();
            console.log('[NATIVE_EVENT] 📋 MacOSEventMonitor实例创建成功');
            console.log('[NATIVE_EVENT] 🔍 验证实例方法:');
            console.log('  - start方法:', typeof this.monitor.start);
            console.log('  - stop方法:', typeof this.monitor.stop);
            console.log('  - getCounts方法:', typeof this.monitor.getCounts);
            console.log('  - resetCounts方法:', typeof this.monitor.resetCounts);
            console.log('  - isMonitoring方法:', typeof this.monitor.isMonitoring);
            
            this.isInitialized = true;
            
            logger.info('原生事件适配器初始化成功');
            console.log('[NATIVE_EVENT] ✅ 原生事件适配器完全初始化成功');
            return true;
        } catch (error) {
            console.error('[NATIVE_EVENT] 原生事件适配器初始化失败:', error);
            logger.error('原生事件适配器初始化失败:', error);
            logger.error('错误详情:', error.stack);
            return false;
        }
    }

    async start(): Promise<boolean> {
        console.log(`[NATIVE_EVENT] 🚀 开始启动原生事件监听... (实例: ${this.instanceId})`);
        console.log('[NATIVE_EVENT] 🔍 状态检查:');
        console.log('  - isInitialized:', this.isInitialized);
        console.log('  - monitor存在:', !!this.monitor);
        console.log('  - monitor类型:', typeof this.monitor);
        
        if (!this.isInitialized || !this.monitor) {
            console.error(`[NATIVE_EVENT] ❌ 原生事件适配器未初始化 (实例: ${this.instanceId})`);
            console.error('[NATIVE_EVENT] 💡 需要先调用 initialize() 方法');
            logger.error('原生事件适配器未初始化');
            
            // 尝试自动初始化
            console.log('[NATIVE_EVENT] 🔄 尝试自动初始化...');
            const initResult = await this.initialize();
            if (!initResult) {
                console.error('[NATIVE_EVENT] ❌ 自动初始化失败');
                return false;
            }
            console.log('[NATIVE_EVENT] ✅ 自动初始化成功');
        }

        try {
            console.log('[NATIVE_EVENT] 🔧 调用monitor.start()...');
            const startResult = this.monitor.start();
            console.log('[NATIVE_EVENT] 📋 start()返回结果:', startResult);
            
            if (startResult) {
                logger.info('原生事件监听启动成功');
                console.log('[NATIVE_EVENT] ✅ 原生事件监听启动成功');
                
                // 启动定期检查
                this.startPeriodicCheck();
                
                this.emit('started');
                return true;
            } else {
                logger.warn('原生事件监听启动失败 - 可能需要授权辅助功能权限');
                console.log('[NATIVE_EVENT] ⚠️ 原生事件监听启动失败 - 检查权限');
                console.log('[NATIVE_EVENT] 💡 可能需要授权辅助功能权限:');
                console.log('  1. 打开"系统偏好设置"');
                console.log('  2. 选择"安全性与隐私" > "隐私" > "辅助功能"');
                console.log('  3. 确保当前应用已添加并勾选');
                this.emit('permission-required');
                return false;
            }
        } catch (error) {
            logger.error('启动原生事件监听时出错:', error);
            console.error('[NATIVE_EVENT] ❌ 启动异常:', error);
            console.error('[NATIVE_EVENT] 🔍 异常详情:', error.stack);
            return false;
        }
    }

    async stop(): Promise<boolean> {
        if (!this.monitor) {
            return true;
        }

        try {
            // 停止定期检查
            if (this.checkInterval) {
                clearInterval(this.checkInterval);
                this.checkInterval = null;
            }

            const stopResult = this.monitor.stop();
            
            if (stopResult) {
                logger.info('原生事件监听停止成功');
                this.emit('stopped');
            }
            
            return stopResult;
        } catch (error) {
            logger.error('停止原生事件监听时出错:', error);
            return false;
        }
    }

    getCurrentCounts(): { keyboardCount: number; mouseCount: number; scrollCount: number } {
        if (!this.monitor) {
            return { keyboardCount: 0, mouseCount: 0, scrollCount: 0 };
        }

        try {
            const counts = this.monitor.getCounts();
            return {
                keyboardCount: counts.keyboard,
                mouseCount: counts.mouse,
                scrollCount: counts.scrolls || 0
            };
        } catch (error) {
            logger.error('获取事件计数时出错:', error);
            return { keyboardCount: 0, mouseCount: 0, scrollCount: 0 };
        }
    }

    resetCounts(): boolean {
        if (!this.monitor) {
            return false;
        }

        try {
            const result = this.monitor.resetCounts();
            if (result) {
                this.lastCounts = { keyboard: 0, mouse: 0, scrolls: 0 };
                logger.debug('原生事件计数器已重置');
            }
            return result;
        } catch (error) {
            logger.error('重置事件计数时出错:', error);
            return false;
        }
    }

    isMonitoring(): boolean {
        if (!this.monitor) {
            return false;
        }

        try {
            return this.monitor.isMonitoring();
        } catch (error) {
            logger.error('检查监听状态时出错:', error);
            return false;
        }
    }

    private startPeriodicCheck(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }

        this.checkInterval = setInterval(() => {
            if (!this.monitor) return;

            try {
                const counts = this.monitor.getCounts();
                
                // 检查是否有新的事件
                if (counts.keyboard !== this.lastCounts.keyboard ||
                    counts.mouse !== this.lastCounts.mouse ||
                    (counts.scrolls || 0) !== this.lastCounts.scrolls) {

                    const newKeyboard = counts.keyboard - this.lastCounts.keyboard;
                    const newMouse = counts.mouse - this.lastCounts.mouse;
                    const newScrolls = (counts.scrolls || 0) - this.lastCounts.scrolls;

                    if (newKeyboard > 0) {
                        this.emit('keyboard-events', newKeyboard);
                    }
                    if (newMouse > 0) {
                        this.emit('mouse-events', newMouse);
                    }
                    if (newScrolls > 0) {
                        this.emit('scroll-events', newScrolls);
                    }

                    this.lastCounts = {
                        keyboard: counts.keyboard,
                        mouse: counts.mouse,
                        scrolls: counts.scrolls || 0
                    };
                }
            } catch (error) {
                logger.error('定期检查时出错:', error);
            }
        }, 1000); // 每秒检查一次
    }

    async cleanup(): Promise<void> {
        await this.stop();
        this.removeAllListeners();
        this.monitor = null;
        this.isInitialized = false;
    }

    /**
     * 检查是否需要授权权限
     */
    requiresPermission(): boolean {
        // 可以通过尝试启动来检查
        return !this.isMonitoring();
    }

    /**
     * 获取权限授权指引
     */
    getPermissionInstructions(): string {
        return `需要授权辅助功能权限：
1. 打开"系统偏好设置"
2. 选择"安全性与隐私"
3. 点击"隐私"标签
4. 在左侧列表中选择"辅助功能"
5. 点击锁图标并输入密码
6. 找到您的应用程序并勾选复选框
7. 重启应用程序`;
    }
}