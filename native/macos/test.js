#!/usr/bin/env node

const MacOSEventMonitor = require('./index');

console.log('=== macOS原生事件监听测试 ===');

const monitor = new MacOSEventMonitor();

console.log('1. 尝试启动事件监听...');
const startResult = monitor.start();

if (startResult) {
    console.log('✅ 事件监听启动成功！');
    console.log('🎯 请在接下来的15秒内按键盘和点击鼠标进行测试...');
    
    // 每秒显示计数
    const interval = setInterval(() => {
        const counts = monitor.getCounts();
        console.log(`📊 实时计数 - 键盘: ${counts.keyboard}, 鼠标: ${counts.mouse}, 监听状态: ${counts.isMonitoring}`);
    }, 1000);
    
    setTimeout(() => {
        clearInterval(interval);
        
        const finalCounts = monitor.getCounts();
        console.log('\n=== 最终测试结果 ===');
        console.log(`键盘事件总数: ${finalCounts.keyboard}`);
        console.log(`鼠标事件总数: ${finalCounts.mouse}`);
        
        if (finalCounts.keyboard > 0 || finalCounts.mouse > 0) {
            console.log('🎉 成功！原生模块能够检测到真实的键鼠事件！');
        } else {
            console.log('❌ 没有检测到任何事件，可能需要授权辅助功能权限');
        }
        
        console.log('2. 停止事件监听...');
        const stopResult = monitor.stop();
        console.log(`停止结果: ${stopResult ? '成功' : '失败'}`);
        
        console.log('3. 重置计数器...');
        const resetResult = monitor.resetCounts();
        console.log(`重置结果: ${resetResult ? '成功' : '失败'}`);
        
        const afterReset = monitor.getCounts();
        console.log(`重置后计数 - 键盘: ${afterReset.keyboard}, 鼠标: ${afterReset.mouse}`);
        
        process.exit(0);
    }, 15000);
    
} else {
    console.log('❌ 事件监听启动失败！');
    console.log('📝 可能的原因：');
    console.log('   1. 需要在"系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能"中授权');
    console.log('   2. 需要重启终端或应用程序');
    console.log('   3. 系统权限配置问题');
    process.exit(1);
}