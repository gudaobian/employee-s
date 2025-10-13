/**
 * Windows Native Event Monitor Build Script
 * 用于编译Windows原生事件监控模块的构建脚本
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔨 开始编译Windows原生事件监控模块...');

// 检查node-gyp是否已安装
function checkNodeGyp() {
  return new Promise((resolve, reject) => {
    const gyp = spawn('node-gyp', ['--version'], { shell: true });
    
    gyp.on('close', (code) => {
      if (code === 0) {
        console.log('✅ node-gyp 已安装');
        resolve(true);
      } else {
        console.log('❌ node-gyp 未安装，正在安装...');
        installNodeGyp().then(resolve).catch(reject);
      }
    });
    
    gyp.on('error', () => {
      console.log('❌ node-gyp 未安装，正在安装...');
      installNodeGyp().then(resolve).catch(reject);
    });
  });
}

// 安装node-gyp
function installNodeGyp() {
  return new Promise((resolve, reject) => {
    console.log('📦 安装 node-gyp...');
    const install = spawn('npm', ['install', '-g', 'node-gyp'], { 
      shell: true,
      stdio: 'inherit'
    });
    
    install.on('close', (code) => {
      if (code === 0) {
        console.log('✅ node-gyp 安装成功');
        resolve(true);
      } else {
        console.error('❌ node-gyp 安装失败');
        reject(new Error('Failed to install node-gyp'));
      }
    });
  });
}

// 清理构建目录
function cleanBuild() {
  return new Promise((resolve, reject) => {
    console.log('🧹 清理构建目录...');
    const clean = spawn('node-gyp', ['clean'], { 
      shell: true,
      stdio: 'inherit',
      cwd: __dirname
    });
    
    clean.on('close', (code) => {
      console.log('✅ 构建目录已清理');
      resolve();
    });
    
    clean.on('error', (error) => {
      console.warn('⚠️ 清理构建目录失败，继续构建:', error.message);
      resolve(); // 继续，即使清理失败
    });
  });
}

// 配置构建环境
function configure() {
  return new Promise((resolve, reject) => {
    console.log('⚙️ 配置构建环境...');
    const configure = spawn('node-gyp', ['configure'], { 
      shell: true,
      stdio: 'inherit',
      cwd: __dirname
    });
    
    configure.on('close', (code) => {
      if (code === 0) {
        console.log('✅ 构建环境配置成功');
        resolve();
      } else {
        console.error('❌ 构建环境配置失败');
        reject(new Error('Configuration failed'));
      }
    });
    
    configure.on('error', (error) => {
      console.error('❌ 配置过程出错:', error);
      reject(error);
    });
  });
}

// 编译模块
function build() {
  return new Promise((resolve, reject) => {
    console.log('🔨 开始编译原生模块...');
    const build = spawn('node-gyp', ['build'], { 
      shell: true,
      stdio: 'inherit',
      cwd: __dirname
    });
    
    build.on('close', (code) => {
      if (code === 0) {
        console.log('✅ 原生模块编译成功');
        checkBuildOutput();
        resolve();
      } else {
        console.error('❌ 原生模块编译失败');
        reject(new Error('Build failed'));
      }
    });
    
    build.on('error', (error) => {
      console.error('❌ 编译过程出错:', error);
      reject(error);
    });
  });
}

// 检查构建输出
function checkBuildOutput() {
  const releasePath = path.join(__dirname, 'build', 'Release', 'event_monitor.node');
  const debugPath = path.join(__dirname, 'build', 'Debug', 'event_monitor.node');
  
  if (fs.existsSync(releasePath)) {
    console.log('✅ Release版本构建成功:', releasePath);
  } else if (fs.existsSync(debugPath)) {
    console.log('✅ Debug版本构建成功:', debugPath);
  } else {
    console.warn('⚠️ 未找到构建输出文件');
  }
}

// 主构建流程
async function main() {
  try {
    await checkNodeGyp();
    await cleanBuild();
    await configure();
    await build();
    
    console.log('🎉 Windows原生事件监控模块构建完成！');
    console.log('');
    console.log('使用方法:');
    console.log('const eventMonitor = require("./native-event-monitor-win");');
    console.log('eventMonitor.start();');
    console.log('');
    
  } catch (error) {
    console.error('💥 构建失败:', error.message);
    console.error('');
    console.error('故障排除建议:');
    console.error('1. 确保安装了 Visual Studio Build Tools');
    console.error('2. 确保安装了 Python 2.7 或 3.x');
    console.error('3. 尝试以管理员权限运行');
    console.error('4. 检查网络连接（可能需要下载依赖）');
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = { main, checkNodeGyp, cleanBuild, configure, build };