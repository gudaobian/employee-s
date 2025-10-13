const nativeMonitor = require('./build/Release/event_monitor');

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