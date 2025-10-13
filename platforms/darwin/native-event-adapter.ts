import { EventEmitter } from 'events';
import { logger } from '../../common/utils/logger';

interface MacOSEventMonitor {
    start(): boolean;
    stop(): boolean;
    getCounts(): { keyboard: number; mouse: number; isMonitoring: boolean };
    resetCounts(): boolean;
    isMonitoring(): boolean;
}

export class NativeEventAdapter extends EventEmitter {
    private monitor: MacOSEventMonitor | null = null;
    private isInitialized = false;
    private checkInterval: NodeJS.Timeout | null = null;
    private lastCounts = { keyboard: 0, mouse: 0 };
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
                // 优化的路径解析策略
                const path = require('path');
                const fs = require('fs');
                
                // 多种路径策略，确保在各种环境下都能找到
                const possibleBasePaths = [
                    process.cwd(),  // 当前工作目录
                    path.dirname(process.execPath),  // Electron 可执行文件目录
                    path.dirname(require.main?.filename || ''),  // 主模块目录
                    __dirname,  // 当前模块目录
                    path.resolve(__dirname, '../../..'),  // 从dist回到项目根目录
                ];
                
                let simpleRelativePath = null;
                
                // 尝试每个基础路径
                for (const basePath of possibleBasePaths) {
                    if (!basePath) continue;
                    
                    const testPath = path.resolve(basePath, 'native-event-monitor');
                    console.log(`[NATIVE_EVENT] 测试基础路径: ${basePath} → ${testPath}`);
                    
                    if (fs.existsSync(testPath)) {
                        simpleRelativePath = testPath;
                        console.log(`[NATIVE_EVENT] ✅ 找到可用路径: ${simpleRelativePath}`);
                        break;
                    }
                }
                
                if (!simpleRelativePath) {
                    // 如果都没找到，使用第一个作为默认值
                    simpleRelativePath = path.resolve(process.cwd(), 'native-event-monitor');
                }
                
                console.log(`[NATIVE_EVENT] 优先尝试简单路径: ${simpleRelativePath}`);
                logger.info(`优先尝试简单路径: ${simpleRelativePath}`);
                
                if (fs.existsSync(simpleRelativePath)) {
                    console.log(`[NATIVE_EVENT] ✅ 找到原生模块: ${simpleRelativePath}`);
                    MacOSEventMonitor = require(simpleRelativePath);
                    console.log(`[NATIVE_EVENT] ✅ 模块加载成功`);
                    logger.info('✅ 原生模块加载成功');
                } else {
                    // 回退到多路径尝试
                    const possiblePaths = [
                        // 从编译后的dist目录向上3级 (dist/platforms/darwin -> project root)
                        path.resolve(__dirname, '../../../native-event-monitor'),
                        // 从electron目录的相对路径 (electron -> project root)
                        path.resolve(__dirname, '../native-event-monitor'),
                        // 绝对路径尝试 (开发环境)
                        '/Volumes/project/employee-monitering-master 2/employee-client-new/native-event-monitor'
                    ];
                    
                    let foundPath = null;
                    for (const testPath of possiblePaths) {
                        console.log(`[NATIVE_EVENT] 尝试备用路径: ${testPath}`);
                        if (fs.existsSync(testPath)) {
                            foundPath = testPath;
                            console.log(`[NATIVE_EVENT] ✅ 找到备用路径: ${foundPath}`);
                            break;
                        }
                    }
                    
                    if (!foundPath) {
                        throw new Error(`❌ 无法找到原生模块，尝试的路径: ${[simpleRelativePath, ...possiblePaths].join(', ')}`);
                    }
                    
                    MacOSEventMonitor = require(foundPath);
                    console.log(`[NATIVE_EVENT] ✅ 从备用路径加载成功`);
                    logger.info('✅ 从备用路径加载原生模块成功');
                }
            } catch (firstError) {
                logger.warn(`项目根目录加载失败: ${firstError.message}`);
                try {
                    // 回退到相对路径 (适用于ts-node运行)
                    logger.info('尝试相对路径加载');
                    MacOSEventMonitor = require('../../native-event-monitor');
                    logger.info('从相对路径成功加载原生模块');
                } catch (secondError) {
                    // 如果都失败，抛出更详细的错误
                    throw new Error(`无法加载原生模块: 主路径失败(${firstError.message}) | 备用路径失败(${secondError.message})`);
                }
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

    getCurrentCounts(): { keyboardCount: number; mouseCount: number } {
        if (!this.monitor) {
            return { keyboardCount: 0, mouseCount: 0 };
        }

        try {
            const counts = this.monitor.getCounts();
            return {
                keyboardCount: counts.keyboard,
                mouseCount: counts.mouse
            };
        } catch (error) {
            logger.error('获取事件计数时出错:', error);
            return { keyboardCount: 0, mouseCount: 0 };
        }
    }

    resetCounts(): boolean {
        if (!this.monitor) {
            return false;
        }

        try {
            const result = this.monitor.resetCounts();
            if (result) {
                this.lastCounts = { keyboard: 0, mouse: 0 };
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
                    counts.mouse !== this.lastCounts.mouse) {
                    
                    const newKeyboard = counts.keyboard - this.lastCounts.keyboard;
                    const newMouse = counts.mouse - this.lastCounts.mouse;
                    
                    if (newKeyboard > 0) {
                        this.emit('keyboard-events', newKeyboard);
                    }
                    if (newMouse > 0) {
                        this.emit('mouse-events', newMouse);
                    }
                    
                    this.lastCounts = {
                        keyboard: counts.keyboard,
                        mouse: counts.mouse
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