#!/usr/bin/env node

/**
 * 创建模拟预编译模块 - 用于在没有Windows环境时测试预编译流程
 * 这个脚本创建一个模拟的预编译模块结构，用于测试集成流程
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class MockPrecompiledCreator {
    constructor() {
        this.projectRoot = path.resolve(__dirname, '..');
        this.nativeModuleDir = path.join(this.projectRoot, 'native-event-monitor-win');
        this.precompiledDir = path.join(this.nativeModuleDir, 'precompiled');
        
        console.log('🧪 创建模拟预编译Windows原生模块');
        console.log(`📁 目标目录: ${this.precompiledDir}`);
    }

    /**
     * 创建预编译目录结构
     */
    createDirectoryStructure() {
        console.log('\n📁 创建目录结构...');
        
        if (fs.existsSync(this.precompiledDir)) {
            console.log('🗑️  清理现有预编译目录');
            fs.rmSync(this.precompiledDir, { recursive: true, force: true });
        }
        
        fs.mkdirSync(this.precompiledDir, { recursive: true });
        console.log('✅ 预编译目录已创建');
    }

    /**
     * 创建模拟的原生模块文件
     */
    createMockNativeModule() {
        console.log('\n🔧 创建模拟原生模块...');
        
        // 创建一个简单的JavaScript模拟，而不是真正的.node文件
        // 在实际的预编译流程中，这将是真正的编译后的C++模块
        const mockModuleContent = `// 模拟的Windows原生事件监控模块
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
};`;

        // 注意：在真实环境中这应该是event_monitor.node文件
        // 这里我们创建一个.js文件来模拟
        const mockModulePath = path.join(this.precompiledDir, 'event_monitor_mock.js');
        fs.writeFileSync(mockModulePath, mockModuleContent);
        console.log('📄 模拟原生模块已创建: event_monitor_mock.js');
    }

    /**
     * 创建预编译模块加载器
     */
    createPrecompiledLoader() {
        console.log('\n📋 创建预编译模块加载器...');
        
        const loaderContent = `/**
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
        console.log(\`[MOCK-PRECOMPILED] 模块可用性检查: \${available}\`);
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
            console.log(\`[MOCK-PRECOMPILED] 构建时间: \${metadata.buildTime}\`);
            console.log(\`[MOCK-PRECOMPILED] Node版本: \${metadata.nodeVersion}\`);
            console.log(\`[MOCK-PRECOMPILED] 模拟环境: \${metadata.isMock ? 'YES' : 'NO'}\`);
            
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
`;

        const loaderPath = path.join(this.precompiledDir, 'loader.js');
        fs.writeFileSync(loaderPath, loaderContent);
        console.log('📄 预编译加载器已创建: loader.js');
    }

    /**
     * 创建构建元数据
     */
    createBuildMetadata() {
        console.log('\n📋 创建构建元数据...');
        
        const metadata = {
            buildTime: new Date().toISOString(),
            nodeVersion: process.version,
            platform: 'win32', // 模拟Windows平台
            arch: 'x64',
            electronVersion: this.getElectronVersion(),
            isMock: true, // 标识这是模拟版本
            mockCreatedBy: os.hostname(),
            mockCreatedOn: os.platform(),
            files: [
                {
                    name: 'event_monitor_mock.js',
                    size: '2.5 KB',
                    modified: new Date().toISOString(),
                    note: 'Mock implementation for testing'
                }
            ],
            buildEnvironment: {
                os: 'Windows 10 (Simulated)',
                release: '10.0.19041',
                hostname: 'mock-build-server',
                compiler: 'Mock Compiler v1.0.0',
                visualStudio: 'Mock VS 2022'
            },
            warnings: [
                'This is a mock precompiled module for testing purposes',
                'Real event monitoring functionality is simulated',
                'Do not use in production environments'
            ]
        };

        const metadataPath = path.join(this.precompiledDir, 'build-metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        console.log('📄 构建元数据已创建: build-metadata.json');
    }

    /**
     * 获取Electron版本
     */
    getElectronVersion() {
        try {
            const packageJsonPath = path.join(this.projectRoot, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            return packageJson.devDependencies?.electron || 
                   packageJson.dependencies?.electron || 
                   'unknown';
        } catch {
            return 'unknown';
        }
    }

    /**
     * 创建验证脚本
     */
    createVerificationScript() {
        console.log('\n🔍 创建验证脚本...');
        
        const verificationContent = `#!/usr/bin/env node

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
        console.log(\`✅ 构建时间: \${buildInfo.buildTime}\`);
        console.log(\`✅ Node版本: \${buildInfo.nodeVersion}\`);
        console.log(\`✅ 平台架构: \${buildInfo.platform}/\${buildInfo.arch}\`);
        console.log(\`⚠️  模拟模式: \${buildInfo.isMock ? 'YES' : 'NO'}\`);
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
    setTimeout(() => {
        const counts = nativeModule.getCounts();
        console.log(\`✅ 模拟事件计数: 键盘=\${counts.keyboard}, 鼠标=\${counts.mouseClicks}\`);
        nativeModule.stop();
        console.log('✅ 模拟监控停止成功');
    }, 2000);

    console.log('\\n🎉 模拟Windows原生模块验证完成！');
    console.log('🔬 注意: 这是用于测试集成流程的模拟模块');
    console.log('📋 在真实环境中，将使用实际编译的C++模块');
    
} catch (error) {
    console.error('\\n❌ 验证失败:', error.message);
    console.error('\\n💡 解决建议:');
    console.error('1. 重新运行模拟预编译脚本');
    console.error('2. 检查文件完整性');
    console.error('3. 确认Node.js环境正常');
    process.exit(1);
}
`;

        const verificationPath = path.join(this.nativeModuleDir, 'verify-installation.js');
        fs.writeFileSync(verificationPath, verificationContent);
        console.log('📄 验证脚本已创建: verify-installation.js');
    }

    /**
     * 创建使用说明
     */
    createUsageInstructions() {
        console.log('\n📚 创建使用说明...');
        
        const instructionsContent = `# 模拟预编译Windows原生模块

⚠️  **重要提示**: 这是用于测试集成流程的模拟模块，不提供真实的Windows事件监控功能。

## 模拟内容

- ✅ 预编译模块目录结构
- ✅ 模块加载器 (loader.js)
- ✅ 构建元数据 (build-metadata.json)
- ✅ 模拟原生模块 (event_monitor_mock.js)
- ✅ 安装验证脚本 (verify-installation.js)

## 使用方法

### 1. 验证模拟安装
\`\`\`bash
cd native-event-monitor-win
node verify-installation.js
\`\`\`

### 2. 测试应用集成
启动应用程序，应该会看到类似以下的日志：
\`\`\`
[WIN-NATIVE] 🔍 检测到预编译模块，尝试加载...
[MOCK-PRECOMPILED] 模块可用性检查: true
[MOCK-PRECOMPILED] ⚠️  加载模拟预编译Windows原生模块
[MOCK-PRECOMPILED] ✅ 模拟Windows原生模块加载成功
[WIN-NATIVE] ✅ 预编译模块加载成功
\`\`\`

### 3. 模拟事件监控
模拟模块会自动生成随机的事件计数：
- 键盘事件: 每秒0-2个随机事件
- 鼠标点击: 每秒0-1个随机事件  
- 空闲时间: 0-5000ms随机值

## 与真实预编译模块的区别

| 项目 | 模拟模块 | 真实预编译模块 |
|------|----------|----------------|
| 文件类型 | .js文件 | .node文件 (C++编译后) |
| 事件检测 | 随机生成 | 真实Windows Hook API |
| 性能 | JavaScript | 原生C++性能 |
| 依赖 | 无 | Windows API依赖 |

## 下一步

1. **测试集成流程**: 验证应用程序能正确检测和加载预编译模块
2. **构建流程测试**: 验证electron-builder能正确打包预编译文件
3. **实际预编译**: 在Windows环境中运行真实的预编译脚本
4. **生产部署**: 使用真实的预编译模块替换模拟版本

## 故障排除

如果遇到问题：
1. 检查文件权限
2. 确认Node.js版本兼容性
3. 验证目录结构完整性
4. 查看详细的错误日志
`;

        const instructionsPath = path.join(this.precompiledDir, 'README.md');
        fs.writeFileSync(instructionsPath, instructionsContent);
        console.log('📄 使用说明已创建: README.md');
    }

    /**
     * 主执行流程
     */
    run() {
        try {
            console.log('🧪 开始创建模拟预编译Windows原生模块');
            console.log('=' .repeat(50));

            // 1. 创建目录结构
            this.createDirectoryStructure();

            // 2. 创建模拟原生模块
            this.createMockNativeModule();

            // 3. 创建加载器
            this.createPrecompiledLoader();

            // 4. 创建元数据
            this.createBuildMetadata();

            // 5. 创建验证脚本
            this.createVerificationScript();

            // 6. 创建使用说明
            this.createUsageInstructions();

            console.log('\n' + '=' .repeat(50));
            console.log('🎉 模拟预编译模块创建完成！');
            console.log('📁 模拟预编译目录:', path.relative(this.projectRoot, this.precompiledDir));
            console.log('');
            console.log('🧪 测试步骤:');
            console.log('1. cd native-event-monitor-win && node verify-installation.js');
            console.log('2. npm start (启动应用程序测试集成)');
            console.log('3. npm run pack:win (测试打包流程)');
            console.log('');
            console.log('⚠️  提醒: 这是测试用的模拟模块，在生产环境中需要使用真实的预编译模块');

        } catch (error) {
            console.error('\n❌ 模拟预编译模块创建失败');
            console.error('错误详情:', error.message);
            process.exit(1);
        }
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    const creator = new MockPrecompiledCreator();
    creator.run();
}

module.exports = MockPrecompiledCreator;