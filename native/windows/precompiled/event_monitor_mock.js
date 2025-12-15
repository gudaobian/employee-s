// 模拟的Windows原生事件监控模块
// 在真实的预编译流程中，这将是编译后的 event_monitor.node 文件

const mockCounts = {
    keyboard: 0,
    mouseClicks: 0,
    idleTime: 0
};

let isMonitoring = false;

module.exports = {
    start() {
        console.log('[MOCK-NATIVE] 🔄 启动模拟Windows事件监控');
        isMonitoring = true;
        
        // 模拟事件计数增长
        setInterval(() => {
            if (isMonitoring) {
                mockCounts.keyboard += Math.floor(Math.random() * 3);
                mockCounts.mouseClicks += Math.floor(Math.random() * 2);
                mockCounts.idleTime = Math.floor(Math.random() * 5000);
            }
        }, 1000);
        
        return true;
    },

    stop() {
        console.log('[MOCK-NATIVE] ⏹️  停止模拟Windows事件监控');
        isMonitoring = false;
        return true;
    },

    getCounts() {
        return {
            keyboard: mockCounts.keyboard,
            mouseClicks: mockCounts.mouseClicks,
            idleTime: mockCounts.idleTime,
            isMonitoring
        };
    },

    resetCounts() {
        console.log('[MOCK-NATIVE] 🔄 重置事件计数');
        mockCounts.keyboard = 0;
        mockCounts.mouseClicks = 0;
        mockCounts.idleTime = 0;
        return true;
    },

    isMonitoring() {
        return isMonitoring;
    }
};