// 智能路径解析：优先使用预编译二进制，降级使用本地编译
const path = require('path');
const fs = require('fs');

let nativeMonitor;

try {
    // 策略1: 预编译二进制 (优先) - 基于Electron ABI版本
    const electronABI = process.versions.modules; // Electron模块版本号
    const arch = process.arch; // arm64 或 x64
    const prebuiltPath = path.join(__dirname, 'bin', `darwin-${arch}-${electronABI}`, 'native-event-monitor.node');

    if (fs.existsSync(prebuiltPath)) {
        console.log(`[NATIVE_EVENT] ✅ 加载预编译二进制: ${prebuiltPath}`);
        nativeMonitor = require(prebuiltPath);
    } else {
        // 策略2: 本地编译产物 (降级)
        console.log('[NATIVE_EVENT] ⚠️  预编译二进制不存在，尝试加载本地编译产物...');
        console.log(`[NATIVE_EVENT] 预期路径: ${prebuiltPath}`);
        nativeMonitor = require('./build/Release/event_monitor');
        console.log('[NATIVE_EVENT] ✅ 成功加载本地编译产物');
    }
} catch (error) {
    const electronABI = process.versions.modules;
    const arch = process.arch;
    const prebuiltPath = path.join(__dirname, 'bin', `darwin-${arch}-${electronABI}`, 'native-event-monitor.node');
    const buildPath = path.join(__dirname, 'build', 'Release', 'event_monitor.node');

    console.error('[NATIVE_EVENT] ❌ 原生模块加载失败');
    console.error('尝试的路径:');
    console.error(`  1. 预编译: ${prebuiltPath} [${fs.existsSync(prebuiltPath) ? '存在' : '不存在'}]`);
    console.error(`  2. 本地编译: ${buildPath} [${fs.existsSync(buildPath) ? '存在' : '不存在'}]`);
    console.error('\n解决方案:');
    console.error('  执行命令: cd employee-client && npm run build:native:mac');
    console.error('  或确保预编译二进制存在于 bin/ 目录\n');

    throw new Error(
        `原生模块加载失败:\n` +
        `  预编译路径: ${prebuiltPath} (${fs.existsSync(prebuiltPath) ? '存在但加载失败' : '不存在'})\n` +
        `  编译路径: ${buildPath} (${fs.existsSync(buildPath) ? '存在但加载失败' : '不存在'})\n` +
        `\n解决方案:\n` +
        `  1. 执行 'npm run build:native:mac' 编译模块\n` +
        `  2. 或确保预编译二进制存在于 bin/ 目录\n` +
        `\n原始错误: ${error.message}`
    );
}

class MacOSEventMonitor {
    constructor() {
        this.isRunning = false;
    }

    /**
     * 启动事件监听
     * @returns {boolean} 是否成功启动
     */
    start() {
        try {
            const result = nativeMonitor.start();
            this.isRunning = result;
            return result;
        } catch (error) {
            console.error('启动事件监听失败:', error);
            return false;
        }
    }

    /**
     * 停止事件监听
     * @returns {boolean} 是否成功停止
     */
    stop() {
        try {
            const result = nativeMonitor.stop();
            this.isRunning = false;
            return result;
        } catch (error) {
            console.error('停止事件监听失败:', error);
            return false;
        }
    }

    /**
     * 获取事件计数
     * @returns {Object} 包含keyboard和mouse计数的对象
     */
    getCounts() {
        try {
            return nativeMonitor.getCounts();
        } catch (error) {
            console.error('获取事件计数失败:', error);
            return { keyboard: 0, mouse: 0, isMonitoring: false };
        }
    }

    /**
     * 重置事件计数
     * @returns {boolean} 是否成功重置
     */
    resetCounts() {
        try {
            return nativeMonitor.resetCounts();
        } catch (error) {
            console.error('重置事件计数失败:', error);
            return false;
        }
    }

    /**
     * 检查是否正在监听
     * @returns {boolean} 是否正在监听
     */
    isMonitoring() {
        try {
            // 从原生模块获取实际状态
            const counts = nativeMonitor.getCounts();
            return counts.isMonitoring;
        } catch (error) {
            console.error('检查监听状态失败:', error);
            return false;
        }
    }
}

module.exports = MacOSEventMonitor;