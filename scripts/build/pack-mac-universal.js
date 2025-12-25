#!/usr/bin/env node

/**
 * Universal macOS 打包脚本
 * 解决跨电脑兼容性问题
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const packager = require('@electron/packager');

console.log('🚀 Universal macOS 打包');
console.log('========================');

async function packUniversal() {
  try {
    // 设置 Electron 镜像环境变量（国内镜像）
    process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
    process.env.ELECTRON_CUSTOM_DIR = '{{ version }}';
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';

    // 通用配置
    const commonConfig = {
      dir: '.',
      name: 'EmployeeSafety',
      appBundleId: 'com.company.employee-safety',
      platform: 'darwin',
      out: 'release',
      overwrite: true,
      icon: 'assets/icons/icon.icns',
      // 🔒 禁用自动代码签名（macOS 15+ taskgated拒绝ad-hoc签名）
      osxSign: false,
      asar: {
        // ✅ unpack 必需的 native 二进制文件和热更新依赖
        // - native/: 自定义原生模块 (macos.node)
        // - node_modules/sharp/: sharp 原生模块
        // - node_modules/@img/: sharp 依赖的动态库 (libvips-cpp.8.17.2.dylib)
        // - node_modules/@electron/: @electron/asar 等热更新工具（不能打包进ASAR）
        // 使用glob模式（minimatch格式）
        unpack: '**/{native,node_modules/sharp,node_modules/@img,node_modules/@electron}/**'
      },
      // ✅ 添加安装脚本到打包（修复全量更新不重启问题）
      extraResource: [
        path.join(__dirname, '../../scripts/installer/macos/auto-install-update-macos.sh')
      ],
      ignore: [
        /native-event-monitor-win/,
        /native-event-monitor\/node_modules/,
        /native-event-monitor\/\.npm-cache/,
        /native-event-monitor\/src/,
        /native-event-monitor\/binding\.gyp/,
        /^\/debug\//,
        /^\/doc\//,
        /^\/docs\//,
        /^\/release\//,
        /test-.*\.js$/,
        /.*\.test\.js$/,
        /.*\.spec\.js$/,
        /.*\.md$/,
        /^\..*/,
        /Dockerfile$/,
        /tsconfig\.json$/,
        /pnpm-.*/,
        /package.*\.backup$/,
        /.*\.log$/,
        /^\/cache\//,
        /^\/build\//,
        /^\/claudedocs\//,
        /^\/src\//,
        /^\/platforms\//,
        /^\/main\//,
        /^\/common\//,
        /^\/types\//,
        /^\/scripts\//,
        /^\/logs\//,
        /^\/\.npm-cache\//,
        /\/\.npm-cache\//,  // ⚡ 排除所有 .npm-cache 目录
        /\.npm-cache$/,      // ⚡ 排除 .npm-cache 目录本身
        /^\/native\/windows$/,   // ⚡ macOS 包排除 Windows 原生模块目录
        /^\/native\/windows\//,  // ⚡ macOS 包排除 Windows 原生模块文件
        /^\/native\/macos\/bin\/\.npm-cache\//,  // ⚡ 排除 macOS native 中的 npm cache
        /^\/\.claude\//,
        /^\/\.github\//,
        /electron-builder.*\.yml$/,
        // ✅ 新增：排除编译中间产物和锁文件（后端建议）
        /\.package-lock\.json$/,  // npm 锁文件
        /binding\.gyp$/,          // node-gyp 构建配置
        /\.o$/,                   // C++ 编译中间文件
        /\.o\.d$/,                // 依赖追踪文件
        /\.mk$/,                  // Makefile
        /\.forge-meta$/,          // electron-forge 元数据
        /\/build\/Release\/\.deps\//,  // 构建依赖目录
        /\/build\/.*\.target\.mk$/,    // gyp 生成的目标文件
        /\/build\/config\.gypi$/,      // gyp 配置
        /\/build\/gyp-mac-tool$/,      // gyp 工具
        /\/build\/binding\.Makefile$/  // gyp 生成的 Makefile
      ],
      // ✅ 打包后钩子：复制 libvips 动态库到 Frameworks 目录
      afterCopy: [(buildPath, electronVersion, platform, arch, callback) => {
        console.log(`   🔧 afterCopy 钩子: 处理 ${arch} 架构的原生依赖...`);

        try {
          // buildPath 是 Electron.app/Contents/Resources/app
          // app.asar.unpacked 在打包完成后会和 app.asar 在同一目录

          // 1. 根据架构确定正确的包名
          const archSuffix = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
          const dylibRelPath = `node_modules/@img/sharp-libvips-${archSuffix}/lib/libvips-cpp.8.17.2.dylib`;

          // 2. 源文件路径：尝试多个可能的位置
          const possibleSources = [
            path.join(buildPath, '..', 'app.asar.unpacked', dylibRelPath), // 相对于Resources目录
            path.join(buildPath, 'app.asar.unpacked', dylibRelPath),       // 相对于app目录
            path.join(buildPath, dylibRelPath)                              // 直接在buildPath下
          ];

          let dylibSrc = null;
          for (const src of possibleSources) {
            if (fs.existsSync(src)) {
              dylibSrc = src;
              console.log(`   ✓ 找到 dylib: ${src}`);
              break;
            }
          }

          // 3. 目标路径：Frameworks 目录
          const frameworksDir = path.join(buildPath, '..', '..', 'Frameworks');
          const dylibDest = path.join(frameworksDir, 'libvips-cpp.8.17.2.dylib');

          // 4. 如果源文件存在，复制到 Frameworks
          if (dylibSrc && fs.existsSync(dylibSrc)) {
            if (!fs.existsSync(frameworksDir)) {
              fs.mkdirSync(frameworksDir, { recursive: true });
            }
            fs.copyFileSync(dylibSrc, dylibDest);
            console.log(`   ✅ libvips-cpp.8.17.2.dylib (${arch}) 已复制到 Frameworks/`);
          } else {
            // ℹ️  跨架构构建时，当前主机架构的包可能不存在（例如 arm64 主机构建 x64）
            // 这是正常的，运行时会使用 app.asar.unpacked 中的文件
            if (arch !== process.arch) {
              console.log(`   ℹ️  跨架构构建 (${process.arch} → ${arch})，跳过架构特定文件`);
            } else {
              console.log(`   ⚠️  libvips dylib 未找到 (${arch})`);
              console.log(`   已检查的路径:`);
              possibleSources.forEach(src => console.log(`     - ${src}`));
            }
          }

          // 5. 添加 Frameworks rpath 到 .node 文件
          const nodeRelPath = `node_modules/@img/sharp-${archSuffix}/lib/sharp-${archSuffix}.node`;
          const possibleNodeSources = [
            path.join(buildPath, '..', 'app.asar.unpacked', nodeRelPath),
            path.join(buildPath, 'app.asar.unpacked', nodeRelPath),
            path.join(buildPath, nodeRelPath)
          ];

          let nodeSrc = null;
          for (const src of possibleNodeSources) {
            if (fs.existsSync(src)) {
              nodeSrc = src;
              break;
            }
          }

          if (nodeSrc) {
            try {
              execSync(`install_name_tool -add_rpath "@executable_path/../Frameworks" "${nodeSrc}"`, { stdio: 'pipe' });
              console.log(`   ✅ 已添加 Frameworks rpath 到 ${archSuffix}.node`);
            } catch (error) {
              // rpath 可能已存在，忽略错误
              console.log(`   ⚠️  rpath 添加失败或已存在: ${error.message}`);
            }
          } else {
            // ℹ️  跨架构构建时，.node 文件可能不存在
            if (arch !== process.arch) {
              console.log(`   ℹ️  跨架构构建，跳过 .node 文件 rpath 配置`);
            } else {
              console.log(`   ⚠️  .node 文件未找到 (${arch})，运行时将使用 ASAR unpacked 版本`);
            }
          }

          callback();
        } catch (error) {
          console.error(`   ❌ afterCopy 钩子执行失败:`, error.message);
          callback(error);
        }
      }]
    };

    // 1. 构建 x64 版本
    console.log('\n1. 📦 构建 x64 版本（启用 ASAR 压缩）...');
    await packager({
      ...commonConfig,
      arch: 'x64'
    });

    // 2. 构建 arm64 版本
    console.log('\n2. 📦 构建 arm64 版本（启用 ASAR 压缩）...');
    await packager({
      ...commonConfig,
      arch: 'arm64'
    });
    
    // 3. 修复两个版本的兼容性问题
    console.log('\n3. 🔧 修复兼容性问题...');
    
    const apps = [
      'release/EmployeeSafety-darwin-x64/EmployeeSafety.app',
      'release/EmployeeSafety-darwin-arm64/EmployeeSafety.app'
    ];
    
    for (const appPath of apps) {
      if (fs.existsSync(appPath)) {
        console.log(`   修复: ${appPath}`);
        
        // 移除隔离属性
        execSync(`xattr -cr "${appPath}"`, { stdio: 'pipe' });
        
        // 设置执行权限
        const executablePath = path.join(appPath, 'Contents/MacOS/EmployeeSafety');
        if (fs.existsSync(executablePath)) {
          execSync(`chmod +x "${executablePath}"`, { stdio: 'pipe' });
        }
        
        // 设置 LSUIElement 到 Info.plist（允许显示 Dock 图标）
        const infoPlistPath = path.join(appPath, 'Contents/Info.plist');
        if (fs.existsSync(infoPlistPath)) {
          try {
            execSync(`/usr/libexec/PlistBuddy -c "Add :LSUIElement bool false" "${infoPlistPath}"`, { stdio: 'pipe' });
            console.log(`   ✅ 已添加 LSUIElement（显示 Dock 图标）`);
          } catch (error) {
            // 可能已经存在，尝试设置值
            try {
              execSync(`/usr/libexec/PlistBuddy -c "Set :LSUIElement false" "${infoPlistPath}"`, { stdio: 'pipe' });
              console.log(`   ✅ 已设置 LSUIElement（显示 Dock 图标）`);
            } catch (e) {
              console.log(`   ⚠️  LSUIElement 设置失败: ${e.message}`);
            }
          }
        }

        // 动态生成 app-update.yml（包含正确的版本号和必需字段）
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const isArm64 = appPath.includes('arm64');
        const updateYmlContent = {
          version: packageJson.version,
          releaseDate: new Date().toISOString(),
          releaseNotes: `版本 ${packageJson.version} 更新`,
          path: `EmployeeSafety-${isArm64 ? 'arm64-' : ''}mac.zip`,
          sha512: '',
          updaterCacheDirName: packageJson.name  // 添加缓存目录名
        };

        const updateYmlDest = path.join(appPath, 'Contents', 'Resources', 'app-update.yml');
        const yamlContent = Object.entries(updateYmlContent)
          .map(([key, value]) => {
            if (key === 'releaseNotes') {
              return `${key}: |\n  ${value}`;
            }
            return `${key}: ${typeof value === 'string' && value.includes(':') ? `'${value}'` : value}`;
          })
          .join('\n');

        fs.writeFileSync(updateYmlDest, yamlContent + '\n');
        console.log(`   ✅ 已生成 app-update.yml (version: ${packageJson.version}, updaterCacheDirName: ${packageJson.name})`);


        // 复制 installer-scripts 到 Resources 目录
        const scriptsSourceDir = path.join(__dirname, '..', 'installer-scripts');
        const scriptsDestDir = path.join(appPath, 'Contents', 'Resources', 'installer-scripts');
        if (fs.existsSync(scriptsSourceDir)) {
          if (!fs.existsSync(scriptsDestDir)) {
            fs.mkdirSync(scriptsDestDir, { recursive: true });
          }
          const scripts = [
            'auto-install-update-macos.sh',
            'cleanup-macos.sh',
            'uninstall-macos.sh'
          ];
          scripts.forEach(script => {
            const source = path.join(scriptsSourceDir, script);
            const dest = path.join(scriptsDestDir, script);
            if (fs.existsSync(source)) {
              fs.copyFileSync(source, dest);
              fs.chmodSync(dest, '755'); // Make executable
            }
          });
          console.log(`   ✅ 已复制 installer-scripts`);
        }

        // 🔒 移除codesign签名（开发环境，taskgated拒绝ad-hoc签名）
        // Ad-hoc签名（codesign --sign -）会被taskgated在运行时拒绝，导致SIGKILL
        // 在开发环境中，macOS允许运行未签名的应用
        console.log(`   ⚠️  跳过codesign（开发环境）- taskgated拒绝ad-hoc签名`);
        console.log(`   ✅ ${appPath} 修复完成（未签名）`);
      }
    }

    // 4. 生成统计信息
    console.log('\n4. 📊 构建统计:');

    for (const appPath of apps) {
      if (fs.existsSync(appPath)) {
        try {
          const size = execSync(`du -sh "${appPath}"`, { encoding: 'utf8' }).trim();
          console.log(`   ${path.basename(path.dirname(appPath))}: ${size}`);
        } catch (error) {
          console.log(`   ${path.basename(path.dirname(appPath))}: 大小未知`);
        }
      }
    }

    // 5. 创建用户安装指南
    console.log('\n5. 📖 生成安装指南...');
    createInstallGuide();

    console.log('\n✅ Universal 打包完成！');
    console.log('\n📦 可用版本:');
    console.log('   • EmployeeSafety-darwin-x64: 适用于 Intel Mac');
    console.log('   • EmployeeSafety-darwin-arm64: 适用于 Apple Silicon Mac');
    console.log('\n💡 应用已打包到 release 目录，可直接使用或分发');
    
  } catch (error) {
    console.error('❌ 打包失败:', error.message);
    process.exit(1);
  }
}

function createInstallGuide() {
  const guideContent = `# EmployeeSafety 安装指南

## 系统要求
- macOS 10.15 或更高版本
- 管理员权限（用于设置辅助功能权限）

## 选择正确的版本

### 如何知道您的 Mac 类型？
1. 点击苹果菜单 > 关于本机
2. 查看"芯片"或"处理器"信息：
   - **Apple M1/M2/M3** → 下载 **EmployeeSafety-darwin-arm64**
   - **Intel** → 下载 **EmployeeSafety-darwin-x64**

## 安装步骤

### 1. 下载和解压
1. 下载对应您 Mac 类型的版本
2. 解压 zip 文件
3. 将 EmployeeSafety.app 拖放到"应用程序"文件夹

### 2. 首次打开
**重要：** 首次打开时可能遇到安全提示

#### 方法 1：右键菜单打开
1. 右键点击 EmployeeSafety.app
2. 选择"打开"
3. 在弹出对话框中点击"打开"

#### 方法 2：终端命令
1. 打开终端
2. 输入：\`xattr -cr /Applications/EmployeeSafety.app\`
3. 然后正常打开应用

#### 方法 3：系统设置
1. 系统偏好设置 > 安全性与隐私 > 通用
2. 看到应用被阻止的提示后，点击"仍要打开"

### 3. 权限设置
应用需要以下权限才能正常工作：

#### 辅助功能权限
1. 系统偏好设置 > 安全性与隐私 > 辅助功能
2. 点击锁图标解锁
3. 勾选"EmployeeSafety"

#### 屏幕录制权限
1. 系统偏好设置 > 安全性与隐私 > 屏幕录制
2. 点击锁图标解锁
3. 勾选"EmployeeSafety"

## 常见问题

### Q: 应用无法打开？
A: 这是 macOS 安全机制。请按照"首次打开"步骤操作。

### Q: 功能不正常？
A: 请检查是否已授予所有必要权限。

### Q: 需要管理员密码？
A: 某些权限设置需要管理员权限。

## 卸载
1. 将应用从"应用程序"文件夹移至废纸篓
2. 在系统偏好设置中移除相关权限（可选）

## 技术支持
如遇问题，请联系技术支持团队。
`;

  fs.writeFileSync('release/安装指南.md', guideContent, 'utf8');
  console.log('   ✅ 安装指南已生成: release/安装指南.md');
}

// 运行打包
packUniversal();