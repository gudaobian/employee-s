#!/usr/bin/env node
/**
 * 修复pnpm在Electron打包中的符号链接问题
 * 参考: https://zhuanlan.zhihu.com/p/691084938
 */

const fs = require('fs');
const path = require('path');

const APP_PATH = './release/EmployeeMonitor-darwin-x64/EmployeeMonitor.app/Contents/Resources/app';
const NODE_MODULES_PATH = path.join(APP_PATH, 'node_modules');
const STORE_PATH = path.join(NODE_MODULES_PATH, '.store');

// 复制文件和目录的函数
function copyRecursiveSync(src, dest) {
    if (!fs.existsSync(src)) {
        console.log(`❌ Source does not exist: ${src}`);
        return false;
    }
    
    const stats = fs.statSync(src);
    const isDirectory = stats.isDirectory();
    
    if (isDirectory) {
        // 确保目标目录的父目录存在
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(childItemName => {
            copyRecursiveSync(
                path.join(src, childItemName),
                path.join(dest, childItemName)
            );
        });
    } else {
        // 确保目标文件的父目录存在
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(src, dest);
    }
    
    return true;
}

// 删除符号链接或目录
function removeIfExists(targetPath) {
    if (fs.existsSync(targetPath)) {
        const stats = fs.lstatSync(targetPath);
        if (stats.isSymbolicLink()) {
            fs.unlinkSync(targetPath);
            console.log(`🗑️  Removed symlink: ${path.basename(targetPath)}`);
        } else if (stats.isDirectory()) {
            fs.rmSync(targetPath, { recursive: true, force: true });
            console.log(`🗑️  Removed directory: ${path.basename(targetPath)}`);
        } else {
            fs.unlinkSync(targetPath);
            console.log(`🗑️  Removed file: ${path.basename(targetPath)}`);
        }
        return true;
    }
    return false;
}

// 将符号链接转换为真实文件
function convertSymlinkToReal(packageName, storePackageName) {
    const linkPath = path.join(NODE_MODULES_PATH, packageName);
    const storePath = path.join(STORE_PATH, storePackageName);
    const sourcePackagePath = path.join(storePath, 'node_modules', packageName);
    
    console.log(`\n🔧 处理包: ${packageName}`);
    console.log(`   Store路径: ${storePath}`);
    console.log(`   源包路径: ${sourcePackagePath}`);
    
    if (!fs.existsSync(sourcePackagePath)) {
        console.log(`❌ 源包不存在: ${sourcePackagePath}`);
        return false;
    }
    
    // 删除现有的符号链接或目录
    removeIfExists(linkPath);
    
    // 复制真实文件
    console.log(`📦 复制 ${packageName} 从 store 到 node_modules...`);
    const success = copyRecursiveSync(sourcePackagePath, linkPath);
    
    if (success) {
        console.log(`✅ 成功转换: ${packageName}`);
        return true;
    } else {
        console.log(`❌ 转换失败: ${packageName}`);
        return false;
    }
}

// Socket.IO相关的关键依赖包映射
const CRITICAL_PACKAGES = [
    { name: 'engine.io-client', store: 'engine.io-client@6.6.3' },
    { name: 'engine.io-parser', store: 'engine.io-parser@5.2.3' },
    { name: 'socket.io-parser', store: 'socket.io-parser@4.2.4' },
    { name: 'component-emitter', store: '@socket.io+component-emitter@3.1.2' },
    { name: 'ms', store: 'ms@2.1.3' },
    { name: 'debug', store: 'debug@4.3.7' }
];

console.log('🚀 开始修复pnpm符号链接问题...');
console.log(`📂 应用路径: ${APP_PATH}`);
console.log(`📦 node_modules路径: ${NODE_MODULES_PATH}`);
console.log(`🏪 Store路径: ${STORE_PATH}`);

if (!fs.existsSync(STORE_PATH)) {
    console.log('❌ .store 目录不存在，可能不是pnpm安装的依赖');
    process.exit(1);
}

console.log('\n🔍 开始处理关键依赖包...');

let successCount = 0;
let totalCount = CRITICAL_PACKAGES.length;

CRITICAL_PACKAGES.forEach(pkg => {
    if (convertSymlinkToReal(pkg.name, pkg.store)) {
        successCount++;
    }
});

console.log(`\n📊 处理结果: ${successCount}/${totalCount} 个包成功转换`);

// 特殊处理：确保socket.io-client内部也有必要的依赖
console.log('\n🔧 特殊处理socket.io-client内部依赖...');

const socketIOPath = path.join(NODE_MODULES_PATH, 'socket.io-client');
const socketIONodeModules = path.join(socketIOPath, 'node_modules');

if (fs.existsSync(socketIOPath)) {
    // 确保socket.io-client/node_modules目录存在
    if (!fs.existsSync(socketIONodeModules)) {
        fs.mkdirSync(socketIONodeModules, { recursive: true });
        console.log('📁 创建socket.io-client/node_modules目录');
    }
    
    // 在socket.io-client内部创建必要的依赖
    const internalDeps = ['engine.io-client', 'engine.io-parser', 'component-emitter', 'ms', 'debug'];
    
    internalDeps.forEach(depName => {
        const sourcePath = path.join(NODE_MODULES_PATH, depName);
        const targetPath = path.join(socketIONodeModules, depName);
        
        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
            console.log(`📦 复制 ${depName} 到 socket.io-client/node_modules/`);
            copyRecursiveSync(sourcePath, targetPath);
        }
    });
}

console.log('\n🎉 pnpm符号链接修复完成！');
console.log('\n📈 优化建议:');
console.log('  - 关键依赖已转换为真实文件，避免符号链接问题');
console.log('  - Socket.IO相关依赖已在内部正确放置');
console.log('  - 应用现在应该能正常加载主模块');

// 验证修复结果
console.log('\n🔍 验证修复结果...');
const criticalPaths = [
    'engine.io-client',
    'socket.io-client/node_modules/engine.io-client',
    'ms',
    'debug',
    'component-emitter'
];

criticalPaths.forEach(checkPath => {
    const fullPath = path.join(NODE_MODULES_PATH, checkPath);
    if (fs.existsSync(fullPath) && !fs.lstatSync(fullPath).isSymbolicLink()) {
        console.log(`✅ ${checkPath} - 真实文件存在`);
    } else {
        console.log(`❌ ${checkPath} - 仍是符号链接或不存在`);
    }
});

console.log('\n🎯 修复完成！请测试应用启动。');