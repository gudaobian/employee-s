/**
 * 预编译Windows原生模块加载器 (模拟版本)
 * 此文件在模拟预编译时自动生成，用于加载模拟的native模块
 */

const path = require('path');
const fs = require('fs');

class MockPrecompiledNativeLoader {
    constructor() {
        this.moduleDir = __dirname;
        this.precompiledDir = path.join(this.moduleDir);
        this.metadataPath = path.join(this.precompiledDir, 'build-metadata.json');
        // 注意：在真实环境中这应该是event_monitor.node
        this.nativeModulePath = path.join(this.precompiledDir, 'event_monitor_mock.js');
    }

    /**
     * 检查预编译模块是否可用
     */
    isAvailable() {
        const available = fs.existsSync(this.nativeModulePath) && 
                         fs.existsSync(this.metadataPath);
        console.log(`[MOCK-PRECOMPILED] 模块可用性检查: ${available}`);
        return available;
    }

    /**
     * 加载预编译模块
     */
    load() {
        if (!this.isAvailable()) {
            throw new Error('模拟预编译的Windows原生模块不可用');
        }

        try {
            const metadata = JSON.parse(fs.readFileSync(this.metadataPath, 'utf8'));
            console.log('[MOCK-PRECOMPILED] ⚠️  加载模拟预编译Windows原生模块');
            console.log(`[MOCK-PRECOMPILED] 构建时间: ${metadata.buildTime}`);
            console.log(`[MOCK-PRECOMPILED] Node版本: ${metadata.nodeVersion}`);
            console.log(`[MOCK-PRECOMPILED] 模拟环境: ${metadata.isMock ? 'YES' : 'NO'}`);
            
            const nativeModule = require(this.nativeModulePath);
            console.log('[MOCK-PRECOMPILED] ✅ 模拟Windows原生模块加载成功');
            console.log('[MOCK-PRECOMPILED] 🔬 注意: 这是测试用的模拟模块，不提供真实的事件监控');
            return nativeModule;
        } catch (error) {
            console.error('[MOCK-PRECOMPILED] ❌ 模拟预编译模块加载失败:', error.message);
            throw error;
        }
    }

    /**
     * 获取构建信息
     */
    getBuildInfo() {
        if (!fs.existsSync(this.metadataPath)) {
            return null;
        }
        
        try {
            return JSON.parse(fs.readFileSync(this.metadataPath, 'utf8'));
        } catch {
            return null;
        }
    }
}

module.exports = new MockPrecompiledNativeLoader();
