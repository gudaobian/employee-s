#!/usr/bin/env node

/**
 * 模拟Windows原生模块安装验证脚本
 */

const loader = require('./precompiled/loader');

console.log('🧪 验证模拟Windows原生模块安装...');

try {
    console.log('1. 检查模拟预编译模块可用性...');
    if (!loader.isAvailable()) {
        throw new Error('模拟预编译模块不可用');
    }
    console.log('✅ 模拟预编译模块可用');

    console.log('2. 获取构建信息...');
    const buildInfo = loader.getBuildInfo();
    if (buildInfo) {
        console.log(`✅ 构建时间: ${buildInfo.buildTime}`);
        console.log(`✅ Node版本: ${buildInfo.nodeVersion}`);
        console.log(`✅ 平台架构: ${buildInfo.platform}/${buildInfo.arch}`);
        console.log(`⚠️  模拟模式: ${buildInfo.isMock ? 'YES' : 'NO'}`);
    }

    console.log('3. 测试模块加载...');
    const nativeModule = loader.load();
    console.log('✅ 模块加载成功');

    console.log('4. 测试模块功能...');
    if (typeof nativeModule.start === 'function' && 
        typeof nativeModule.stop === 'function' && 
        typeof nativeModule.getCounts === 'function') {
        console.log('✅ 模块接口验证成功');
    } else {
        throw new Error('模块接口不完整');
    }

    console.log('5. 测试模拟功能...');
    nativeModule.start();
    const counts = nativeModule.getCounts();
    console.log(`✅ 模拟事件计数: 键盘=${counts.keyboard}, 鼠标=${counts.mouseClicks}`);
    nativeModule.stop();
    console.log('✅ 模拟监控停止成功');

    console.log('\n🎉 模拟Windows原生模块验证完成！');
    console.log('🔬 注意: 这是用于测试集成流程的模拟模块');
    console.log('📋 在真实环境中，将使用实际编译的C++模块');

    process.exit(0);

} catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    console.error('\n💡 解决建议:');
    console.error('1. 重新运行模拟预编译脚本');
    console.error('2. 检查文件完整性');
    console.error('3. 确认Node.js环境正常');
    process.exit(1);
}
