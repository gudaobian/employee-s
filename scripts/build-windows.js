/**
 * Windows平台完整构建脚本
 * 处理TypeScript编译、原生模块构建和Electron打包
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

console.log('🏗️ Windows平台完整构建流程');
console.log('==============================\n');

const ROOT_DIR = path.resolve(__dirname, '..');
const IS_WINDOWS = os.platform() === 'win32';

// 构建步骤配置
const BUILD_STEPS = [
  {
    name: '清理构建目录',
    command: 'npm',
    args: ['run', 'clean'],
    cwd: ROOT_DIR,
    required: true
  },
  {
    name: '清理electron-builder缓存',
    custom: async () => {
      console.log('\n🧹 清理electron-builder缓存...');
      const cacheLocations = [];

      if (IS_WINDOWS) {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
          cacheLocations.push(
            path.join(localAppData, 'electron-builder'),
            path.join(localAppData, 'electron'),
            path.join(localAppData, 'electron-builder', 'Cache', 'nsis')
          );
        }
        const temp = process.env.TEMP;
        if (temp) {
          // 清理临时目录中的electron-builder缓存
          const tempFiles = fs.readdirSync(temp).filter(f => f.startsWith('electron-builder-'));
          tempFiles.forEach(f => {
            cacheLocations.push(path.join(temp, f));
          });
        }
      } else {
        // macOS
        const home = process.env.HOME;
        if (home) {
          cacheLocations.push(
            path.join(home, 'Library', 'Caches', 'electron-builder'),
            path.join(home, 'Library', 'Caches', 'electron')
          );
        }
      }

      // 清理 node_modules 缓存
      const nodeModulesCache = path.join(ROOT_DIR, 'node_modules', '.cache', 'electron-builder');
      if (fs.existsSync(nodeModulesCache)) {
        cacheLocations.push(nodeModulesCache);
      }

      let cleaned = 0;
      for (const loc of cacheLocations) {
        if (fs.existsSync(loc)) {
          try {
            fs.rmSync(loc, { recursive: true, force: true });
            console.log(`  ✅ 已清理: ${loc}`);
            cleaned++;
          } catch (error) {
            console.log(`  ⚠️ 清理失败: ${loc} (${error.message})`);
          }
        }
      }

      if (cleaned === 0) {
        console.log('  ℹ️ 未找到需要清理的缓存');
      } else {
        console.log(`  ✅ 共清理 ${cleaned} 个缓存位置`);
      }
    },
    required: false
  },
  {
    name: '编译TypeScript',
    command: 'npm',
    args: ['run', 'compile'],
    cwd: ROOT_DIR,
    required: true
  },
  {
    name: '安装macOS原生模块依赖',
    command: 'npm',
    args: ['install'],
    cwd: path.join(ROOT_DIR, 'native-event-monitor'),
    required: false,
    skipOnWindows: true
  },
  {
    name: '编译macOS原生模块',
    command: 'npm',
    args: ['run', 'build'],
    cwd: path.join(ROOT_DIR, 'native-event-monitor'),
    required: false,
    skipOnWindows: true
  },
  // ❌ 不再在打包阶段编译原生模块
  // CI/CD 已经在 Stage 1 用 electron-rebuild 正确编译了
  // 这里重新编译会用 node-gyp 导致 ABI 不匹配
  // {
  //   name: '安装Windows原生模块依赖',
  //   command: 'npm',
  //   args: ['install'],
  //   cwd: path.join(ROOT_DIR, 'native-event-monitor-win'),
  //   required: true
  // },
  // {
  //   name: '编译Windows原生模块',
  //   command: 'npm',
  //   args: ['run', 'build'],
  //   cwd: path.join(ROOT_DIR, 'native-event-monitor-win'),
  //   required: true
  // },
  // 验证步骤改为检查文件是否存在（而不是运行测试）
  // 因为我们跳过了编译步骤
];

async function runCommand(step) {
  return new Promise(async (resolve, reject) => {
    console.log(`\n📋 ${step.name}...`);

    // 跳过条件检查
    if (step.skipOnWindows && IS_WINDOWS) {
      console.log('⏭️ 跳过 (Windows平台不适用)');
      resolve(true);
      return;
    }

    // 如果是自定义函数，直接执行
    if (step.custom && typeof step.custom === 'function') {
      try {
        await step.custom();
        console.log(`✅ ${step.name} 完成`);
        resolve(true);
      } catch (error) {
        console.log(`❌ ${step.name} 出错:`, error.message);
        if (step.required) {
          reject(error);
        } else {
          console.log(`⚠️ 非关键步骤出错，继续构建...`);
          resolve(false);
        }
      }
      return;
    }

    // 检查目录是否存在
    if (step.cwd && !fs.existsSync(step.cwd)) {
      if (step.required) {
        console.log(`❌ 目录不存在: ${step.cwd}`);
        reject(new Error(`Required directory not found: ${step.cwd}`));
        return;
      } else {
        console.log(`⏭️ 跳过 (目录不存在): ${step.cwd}`);
        resolve(true);
        return;
      }
    }

    const process = spawn(step.command, step.args, {
      cwd: step.cwd || ROOT_DIR,
      stdio: 'inherit',
      shell: true
    });

    process.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${step.name} 完成`);
        resolve(true);
      } else {
        console.log(`❌ ${step.name} 失败 (退出码: ${code})`);
        if (step.required) {
          reject(new Error(`${step.name} failed with code ${code}`));
        } else {
          console.log(`⚠️ 非关键步骤失败，继续构建...`);
          resolve(false);
        }
      }
    });

    process.on('error', (error) => {
      console.log(`❌ ${step.name} 出错:`, error.message);
      if (step.required) {
        reject(error);
      } else {
        console.log(`⚠️ 非关键步骤出错，继续构建...`);
        resolve(false);
      }
    });
  });
}

async function checkPrerequisites() {
  console.log('🔍 检查构建前提条件...');
  
  const checks = [
    { name: 'Node.js', command: 'node --version' },
    { name: 'npm', command: 'npm --version' },
    { name: 'TypeScript', command: 'npx tsc --version' }
  ];
  
  if (IS_WINDOWS) {
    checks.push(
      { name: 'node-gyp', command: 'npx node-gyp --version' },
      { name: 'Python', command: 'python --version' }
    );
  }
  
  for (const check of checks) {
    try {
      const version = execSync(check.command, { encoding: 'utf8', stdio: 'pipe' });
      console.log(`✅ ${check.name}: ${version.trim()}`);
    } catch (error) {
      console.log(`❌ ${check.name}: 未安装或不可用`);
      if (check.name === 'node-gyp' && IS_WINDOWS) {
        console.log('💡 提示: 运行 npm install -g node-gyp 安装');
      }
      if (check.name === 'Python' && IS_WINDOWS) {
        console.log('💡 提示: Windows原生模块编译需要Python');
      }
    }
  }
}

async function verifyBuildOutput() {
  console.log('\n🔍 验证构建输出...');

  const checkPaths = [
    { path: 'dist', name: 'TypeScript编译输出', required: true },
    { path: 'native-event-monitor-win/build', name: 'Windows原生模块', required: true },
    { path: 'native-event-monitor/build', name: 'macOS原生模块', required: false }
  ];

  let allRequired = true;

  for (const check of checkPaths) {
    const fullPath = path.join(ROOT_DIR, check.path);
    if (fs.existsSync(fullPath)) {
      console.log(`✅ ${check.name}: ${fullPath}`);
    } else {
      console.log(`❌ ${check.name}: 未找到 ${fullPath}`);
      if (check.required) {
        allRequired = false;
      }
    }
  }

  // 验证编译后的代码内容（关键！）
  console.log('\n🔍 验证编译后的代码内容...');
  const adapterPath = path.join(ROOT_DIR, 'dist/platforms/windows/windows-adapter.js');
  if (fs.existsSync(adapterPath)) {
    const content = fs.readFileSync(adapterPath, 'utf8');

    // 检查关键方法
    if (content.includes('getActiveURL')) {
      console.log('✅ getActiveURL 方法存在');
    } else {
      console.log('❌ CRITICAL: getActiveURL 方法不存在！');
      console.log('🚨 这意味着编译了旧代码，必须停止构建！');
      allRequired = false;
    }

    // 检查版本标识
    const versionMatch = content.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (versionMatch) {
      console.log(`✅ WindowsAdapter VERSION: ${versionMatch[1]}`);
    } else {
      console.log('⚠️ 无法找到 VERSION 标识');
    }
  } else {
    console.log(`❌ WindowsAdapter 不存在: ${adapterPath}`);
    allRequired = false;
  }

  return allRequired;
}

async function runElectronBuilder() {
  console.log('\n📦 运行Electron Builder...');
  
  return new Promise((resolve, reject) => {
    const builderProcess = spawn('npx', ['electron-builder', '--win'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true
    });
    
    builderProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Electron Builder 完成');
        resolve(true);
      } else {
        console.log(`❌ Electron Builder 失败 (退出码: ${code})`);
        reject(new Error(`Electron Builder failed with code ${code}`));
      }
    });
    
    builderProcess.on('error', (error) => {
      console.log('❌ Electron Builder 出错:', error.message);
      reject(error);
    });
  });
}

async function main() {
  try {
    // 检查前提条件
    await checkPrerequisites();
    
    console.log('\n🚀 开始构建流程...');
    
    // 执行构建步骤
    for (const step of BUILD_STEPS) {
      await runCommand(step);
    }
    
    // 验证构建输出
    const verified = await verifyBuildOutput();
    if (!verified) {
      throw new Error('构建输出验证失败');
    }
    
    // 运行Electron Builder
    await runElectronBuilder();
    
    // 检查最终输出
    const releaseDir = path.join(ROOT_DIR, 'release');
    if (fs.existsSync(releaseDir)) {
      console.log('\n🎉 构建完成！');
      console.log(`📁 输出目录: ${releaseDir}`);
      
      // 列出生成的文件
      const files = fs.readdirSync(releaseDir);
      console.log('\n📄 生成的文件:');
      files.forEach(file => {
        const filePath = path.join(releaseDir, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          const size = (stats.size / 1024 / 1024).toFixed(2);
          console.log(`  📦 ${file} (${size} MB)`);
        }
      });
    } else {
      console.log('⚠️ 未找到release目录');
    }
    
    console.log('\n✨ Windows客户端构建成功完成！');
    console.log('\n📋 后续步骤:');
    console.log('1. 将release目录中的安装包传输到Windows机器');
    console.log('2. 以管理员权限安装应用程序');
    console.log('3. 测试原生事件监控功能');
    
  } catch (error) {
    console.error('\n💥 构建失败:', error.message);
    console.error('\n🔧 故障排除建议:');
    console.error('1. 检查所有前提条件是否满足');
    console.error('2. 确保网络连接正常（需要下载依赖）');
    console.error('3. 清理node_modules并重新安装依赖');
    console.error('4. 检查磁盘空间是否充足');
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = { main, runCommand, checkPrerequisites, verifyBuildOutput };