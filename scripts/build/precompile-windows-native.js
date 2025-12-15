#!/usr/bin/env node

/**
 * Windows原生模块预编译脚本
 * 用于在CI/CD或本地环境中为Windows预编译native模块
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

class WindowsNativePrecompiler {
    constructor() {
        this.projectRoot = path.resolve(__dirname, '..');
        this.nativeModuleDir = path.join(this.projectRoot, 'native-event-monitor-win');
        this.precompiledDir = path.join(this.nativeModuleDir, 'precompiled');
        this.releaseDir = path.join(this.nativeModuleDir, 'build', 'Release');
        
        console.log('🔨 Windows原生模块预编译器 v2.0');
        console.log(`📁 项目根目录: ${this.projectRoot}`);
        console.log(`📁 原生模块目录: ${this.nativeModuleDir}`);
        console.log(`📁 预编译输出目录: ${this.precompiledDir}`);
    }

    /**
     * 检查编译环境
     */
    checkEnvironment() {
        console.log('\n🔍 检查编译环境...');
        
        const requirements = [
            {
                name: 'Node.js',
                command: 'node --version',
                expected: 'v'
            },
            {
                name: 'npm',
                command: 'npm --version',
                expected: /\d+\.\d+\.\d+/
            },
            {
                name: 'Python',
                command: 'python --version',
                expected: 'Python',
                fallback: 'python3 --version'
            },
            {
                name: 'node-gyp',
                command: 'npx node-gyp --version',
                expected: 'v'
            }
        ];

        for (const req of requirements) {
            try {
                let output;
                try {
                    output = execSync(req.command, { encoding: 'utf8' }).trim();
                } catch (error) {
                    if (req.fallback) {
                        output = execSync(req.fallback, { encoding: 'utf8' }).trim();
                    } else {
                        throw error;
                    }
                }
                
                // Check if expected is regex or string
                const isExpectedValid = typeof req.expected === 'string' 
                    ? output.includes(req.expected)
                    : req.expected.test(output);
                    
                if (isExpectedValid) {
                    console.log(`✅ ${req.name}: ${output}`);
                } else {
                    throw new Error(`Unexpected output: ${output}`);
                }
            } catch (error) {
                console.error(`❌ ${req.name}: 未找到或版本不兼容`);
                console.error(`   命令: ${req.command}`);
                console.error(`   错误: ${error.message}`);
                throw new Error(`${req.name} 环境检查失败`);
            }
        }

        // Windows特定检查
        if (process.platform === 'win32') {
            this.checkWindowsTools();
        } else {
            console.log('ℹ️  当前不在Windows环境，将跳过Windows特定工具检查');
        }
    }

    /**
     * 检查Windows编译工具
     */
    checkWindowsTools() {
        console.log('\n🔍 检查Windows编译工具...');
        
        const windowsTools = [
            {
                name: 'Visual Studio Build Tools',
                check: () => {
                    // 检查多个可能的VS安装位置
                    const vsPaths = [
                        'C:\\\\Program Files (x86)\\\\Microsoft Visual Studio\\\\2019\\\\BuildTools',
                        'C:\\\\Program Files (x86)\\\\Microsoft Visual Studio\\\\2022\\\\BuildTools',
                        'C:\\\\Program Files\\\\Microsoft Visual Studio\\\\2019\\\\Community',
                        'C:\\\\Program Files\\\\Microsoft Visual Studio\\\\2022\\\\Community'
                    ];
                    
                    for (const vsPath of vsPaths) {
                        if (fs.existsSync(vsPath)) {
                            return vsPath;
                        }
                    }
                    
                    // 检查命令行工具
                    try {
                        execSync('cl', { encoding: 'utf8' });
                        return 'Command line tools available';
                    } catch {
                        return null;
                    }
                }
            }
        ];

        for (const tool of windowsTools) {
            const result = tool.check();
            if (result) {
                console.log(`✅ ${tool.name}: ${result}`);
            } else {
                console.warn(`⚠️  ${tool.name}: 未找到，将尝试使用默认配置`);
            }
        }
    }

    /**
     * 清理旧的编译产物
     */
    cleanOldBuilds() {
        console.log('\n🧹 清理旧的编译产物...');
        
        const dirsToClean = [
            path.join(this.nativeModuleDir, 'build'),
            path.join(this.nativeModuleDir, 'node_modules'),
            this.precompiledDir
        ];

        for (const dir of dirsToClean) {
            if (fs.existsSync(dir)) {
                console.log(`🗑️  删除: ${path.relative(this.projectRoot, dir)}`);
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    }

    /**
     * 安装依赖并编译
     */
    buildNativeModule() {
        console.log('\n🔨 编译Windows原生模块...');
        
        const buildCommands = [
            {
                name: '安装npm依赖',
                command: 'npm install',
                cwd: this.nativeModuleDir
            },
            {
                name: '编译原生模块',
                command: 'npm run build',
                cwd: this.nativeModuleDir
            }
        ];

        for (const step of buildCommands) {
            console.log(`\n📋 ${step.name}...`);
            console.log(`💻 执行: ${step.command}`);
            console.log(`📁 工作目录: ${step.cwd}`);
            
            try {
                const output = execSync(step.command, {
                    cwd: step.cwd,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                console.log('✅ 命令执行成功');
                if (output.trim()) {
                    console.log('📤 输出:');
                    console.log(output.trim());
                }
            } catch (error) {
                console.error(`❌ ${step.name}失败`);
                console.error('📤 错误输出:');
                console.error(error.stdout?.toString() || '');
                console.error(error.stderr?.toString() || '');
                throw new Error(`编译步骤"${step.name}"失败: ${error.message}`);
            }
        }
    }

    /**
     * 验证编译结果
     */
    validateBuild() {
        console.log('\n🔍 验证编译结果...');
        
        const expectedFiles = [
            'event_monitor.node'
        ];

        const missingFiles = [];
        const foundFiles = [];

        for (const file of expectedFiles) {
            const filePath = path.join(this.releaseDir, file);
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                foundFiles.push({
                    name: file,
                    path: filePath,
                    size: (stats.size / 1024).toFixed(2) + ' KB',
                    modified: stats.mtime.toISOString()
                });
            } else {
                missingFiles.push(file);
            }
        }

        if (missingFiles.length > 0) {
            console.warn('⚠️ 编译结果验证失败，将创建fallback模式');
            console.warn('🚫 缺失文件:');
            missingFiles.forEach(file => console.warn(`   - ${file}`));
            
            // 创建fallback模式的文件结构
            return this.createFallbackMode();
        }

        console.log('✅ 编译结果验证成功');
        console.log('📋 编译产物:');
        foundFiles.forEach(file => {
            console.log(`   📄 ${file.name} (${file.size})`);
            console.log(`      修改时间: ${file.modified}`);
        });

        return foundFiles;
    }

    /**
     * 创建fallback模式（编译失败时的备选方案）
     */
    createFallbackMode() {
        console.log('\n🔄 创建fallback模式...');
        
        // 检查是否存在现有的模拟文件
        const mockModulePath = path.join(this.nativeModuleDir, 'precompiled', 'event_monitor_mock.js');
        
        if (fs.existsSync(mockModulePath)) {
            console.log('✅ 找到现有模拟模块，将使用fallback模式');
            
            // 返回模拟文件信息
            const stats = fs.statSync(mockModulePath);
            return [{
                name: 'event_monitor_mock.js',
                path: mockModulePath,
                size: (stats.size / 1024).toFixed(2) + ' KB',
                modified: stats.mtime.toISOString(),
                isFallback: true
            }];
        } else {
            throw new Error('编译产物不完整且没有fallback选项');
        }
    }

    /**
     * 创建预编译包
     */
    createPrecompiledPackage(compiledFiles) {
        console.log('\n📦 创建预编译包...');
        
        // 创建预编译目录
        if (!fs.existsSync(this.precompiledDir)) {
            fs.mkdirSync(this.precompiledDir, { recursive: true });
        }

        // 复制编译产物
        const copiedFiles = [];
        for (const file of compiledFiles) {
            const destPath = path.join(this.precompiledDir, file.name);
            fs.copyFileSync(file.path, destPath);
            copiedFiles.push({
                source: file.path,
                dest: destPath,
                name: file.name
            });
            console.log(`📋 复制: ${file.name} -> precompiled/`);
        }

        // 检查是否为fallback模式
        const isFallbackMode = compiledFiles.some(f => f.isFallback);
        
        // 生成元数据文件
        const metadata = {
            buildTime: new Date().toISOString(),
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            electronVersion: this.getElectronVersion(),
            isFallback: isFallbackMode,
            compilationSuccess: !isFallbackMode,
            files: compiledFiles.map(f => ({
                name: f.name,
                size: f.size,
                modified: f.modified,
                isFallback: f.isFallback || false
            })),
            buildEnvironment: {
                os: os.type(),
                release: os.release(),
                hostname: os.hostname()
            }
        };

        const metadataPath = path.join(this.precompiledDir, 'build-metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        console.log('📋 生成元数据: build-metadata.json');

        // 生成加载器脚本
        this.generateLoader();

        return {
            files: copiedFiles,
            metadata,
            precompiledDir: this.precompiledDir
        };
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
     * 生成预编译模块加载器
     */
    generateLoader() {
        const loaderContent = `/**
 * 预编译Windows原生模块加载器
 * 此文件在安装时自动生成，用于加载预编译的native模块
 */

const path = require('path');
const fs = require('fs');

class PrecompiledNativeLoader {
    constructor() {
        this.moduleDir = __dirname;  // __dirname is already the precompiled directory
        this.precompiledDir = this.moduleDir;
        this.metadataPath = path.join(this.precompiledDir, 'build-metadata.json');
        this.nativeModulePath = path.join(this.precompiledDir, 'event_monitor.node');
        this.fallbackModulePath = path.join(this.precompiledDir, 'event_monitor_mock.js');
    }

    /**
     * 检查预编译模块是否可用
     */
    isAvailable() {
        // 检查是否有真实的native模块或fallback模块
        const hasNative = fs.existsSync(this.nativeModulePath);
        const hasFallback = fs.existsSync(this.fallbackModulePath);
        const hasMetadata = fs.existsSync(this.metadataPath);
        
        return (hasNative || hasFallback) && hasMetadata;
    }

    /**
     * 检查是否为fallback模式
     */
    isFallbackMode() {
        if (!fs.existsSync(this.metadataPath)) {
            return false;
        }
        
        try {
            const metadata = JSON.parse(fs.readFileSync(this.metadataPath, 'utf8'));
            return metadata.isFallback === true;
        } catch {
            return false;
        }
    }

    /**
     * 加载预编译模块
     */
    load() {
        if (!this.isAvailable()) {
            throw new Error('预编译的Windows原生模块不可用');
        }

        try {
            const metadata = JSON.parse(fs.readFileSync(this.metadataPath, 'utf8'));
            
            // 检查是否为fallback模式
            if (metadata.isFallback) {
                console.log('[PRECOMPILED] ⚠️ 加载fallback模式的Windows原生模块');
                console.log(\`[PRECOMPILED] 构建时间: \${metadata.buildTime}\`);
                console.log(\`[PRECOMPILED] Node版本: \${metadata.nodeVersion}\`);
                console.log(\`[PRECOMPILED] 编译状态: fallback模式 (原生编译失败)\`);
                
                const fallbackModule = require(this.fallbackModulePath);
                console.log('[PRECOMPILED] ✅ Fallback模块加载成功');
                console.log('[PRECOMPILED] 🔬 注意: 这是模拟模块，不提供真实的事件监控');
                return fallbackModule;
            } else {
                console.log('[PRECOMPILED] 加载预编译Windows原生模块');
                console.log(\`[PRECOMPILED] 构建时间: \${metadata.buildTime}\`);
                console.log(\`[PRECOMPILED] Node版本: \${metadata.nodeVersion}\`);
                console.log(\`[PRECOMPILED] Electron版本: \${metadata.electronVersion}\`);
                
                const nativeModule = require(this.nativeModulePath);
                console.log('[PRECOMPILED] ✅ Windows原生模块加载成功');
                return nativeModule;
            }
        } catch (error) {
            console.error('[PRECOMPILED] ❌ 预编译模块加载失败:', error.message);
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

module.exports = new PrecompiledNativeLoader();
`;

        const loaderPath = path.join(this.precompiledDir, 'loader.js');
        fs.writeFileSync(loaderPath, loaderContent);
        console.log('📋 生成加载器: loader.js');
    }

    /**
     * 生成安装验证脚本
     */
    generateInstallVerification() {
        console.log('\n🔍 生成安装验证脚本...');
        
        const verificationContent = `#!/usr/bin/env node

/**
 * Windows原生模块安装验证脚本
 */

const loader = require('./precompiled/loader');

console.log('🔍 验证Windows原生模块安装...');

try {
    console.log('1. 检查预编译模块可用性...');
    if (!loader.isAvailable()) {
        throw new Error('预编译模块不可用');
    }
    console.log('✅ 预编译模块可用');

    console.log('2. 获取构建信息...');
    const buildInfo = loader.getBuildInfo();
    if (buildInfo) {
        console.log(\`✅ 构建时间: \${buildInfo.buildTime}\`);
        console.log(\`✅ Node版本: \${buildInfo.nodeVersion}\`);
        console.log(\`✅ 平台架构: \${buildInfo.platform}/\${buildInfo.arch}\`);
    }

    console.log('3. 测试模块加载...');
    const nativeModule = loader.load();
    console.log('✅ 模块加载成功');

    console.log('4. 测试模块功能...');
    const hasStart = typeof nativeModule.start === 'function';
    const hasStop = typeof nativeModule.stop === 'function';
    const hasCounts = typeof nativeModule.getCounts === 'function' || typeof nativeModule.getEventCounts === 'function';
    
    if (hasStart && hasStop && hasCounts) {
        console.log('✅ 模块接口验证成功');
        console.log(\`   - start: \${hasStart ? '✅' : '❌'}\`);
        console.log(\`   - stop: \${hasStop ? '✅' : '❌'}\`);
        console.log(\`   - getCounts/getEventCounts: \${hasCounts ? '✅' : '❌'}\`);
    } else {
        console.error('❌ 模块接口不完整:');
        console.error(\`   - start: \${hasStart ? '✅' : '❌'}\`);
        console.error(\`   - stop: \${hasStop ? '✅' : '❌'}\`);
        console.error(\`   - getCounts/getEventCounts: \${hasCounts ? '✅' : '❌'}\`);
        throw new Error('模块接口不完整');
    }

    console.log('\\n🎉 Windows原生模块验证完成！');
    console.log('模块已正确安装并可以使用。');
    
} catch (error) {
    console.error('\\n❌ 验证失败:', error.message);
    console.error('\\n💡 解决建议:');
    console.error('1. 确认安装包完整性');
    console.error('2. 重新运行安装程序');
    console.error('3. 检查系统兼容性');
    process.exit(1);
}
`;

        const verificationPath = path.join(this.nativeModuleDir, 'verify-installation.js');
        fs.writeFileSync(verificationPath, verificationContent);
        console.log('📋 生成验证脚本: verify-installation.js');
    }

    /**
     * 主执行流程
     */
    async run() {
        try {
            console.log('🚀 开始Windows原生模块预编译流程');
            console.log('=' .repeat(50));

            // 1. 环境检查
            this.checkEnvironment();

            // 2. 清理旧构建
            this.cleanOldBuilds();

            // 3. 编译模块
            this.buildNativeModule();

            // 4. 验证编译结果
            const compiledFiles = this.validateBuild();

            // 5. 创建预编译包
            const precompiledPackage = this.createPrecompiledPackage(compiledFiles);

            // 6. 生成验证脚本
            this.generateInstallVerification();

            console.log('\n' + '=' .repeat(50));
            console.log('🎉 预编译流程完成！');
            console.log('📁 预编译目录:', path.relative(this.projectRoot, precompiledPackage.precompiledDir));
            console.log('📋 编译文件数量:', precompiledPackage.files.length);
            console.log('📅 构建时间:', precompiledPackage.metadata.buildTime);
            console.log('');
            console.log('🔄 下一步:');
            console.log('1. 更新electron-builder配置以包含预编译文件');
            console.log('2. 修改应用代码以使用预编译模块');
            console.log('3. 重新构建Windows安装包');
            console.log('4. 测试安装包在无Node环境的Windows设备上的表现');

        } catch (error) {
            console.error('\n❌ 预编译流程失败');
            console.error('错误详情:', error.message);
            console.error('\n🔧 故障排除建议:');
            console.error('1. 检查编译环境是否完整');
            console.error('2. 确认Visual Studio Build Tools已安装');
            console.error('3. 验证Node.js和Python版本兼容性');
            console.error('4. 检查磁盘空间和权限');
            process.exit(1);
        }
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    const precompiler = new WindowsNativePrecompiler();
    precompiler.run();
}

module.exports = WindowsNativePrecompiler;