#!/usr/bin/env node

/**
 * Universal macOS 打包脚本
 * 解决跨电脑兼容性问题
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Universal macOS 打包');
console.log('========================');

async function packUniversal() {
  try {
    // 1. 构建 x64 版本
    console.log('\n1. 📦 构建 x64 版本...');
    execSync(`npx @electron/packager . EmployeeSafety --app-bundle-id=com.company.employee-safety --platform=darwin --arch=x64 --out=release --overwrite --no-asar --icon=assets/icons/icon.icns --ignore="native-event-monitor-win|native-event-monitor/node_modules|native-event-monitor/\\.npm-cache|native-event-monitor/src|native-event-monitor/binding\\.gyp|^/debug/|^/doc/|^/docs/|^/release/|test-.*\\.js$|.*\\.test\\.js$|.*\\.spec\\.js$|.*\\.md$|^\\\\..*|Dockerfile$|tsconfig\\.json$|pnpm-.*|package.*\\.backup$|.*\\.log$|^/cache/|^/build/|^/claudedocs/|^/src/|^/platforms/|^/main/|^/common/|^/types/|^/scripts/|^/logs/|^/\\.npm-cache/|^/\\.claude/|^/\\.github/|electron-builder.*\\.yml$"`, {
      stdio: 'inherit'
    });

    // 2. 构建 arm64 版本
    console.log('\n2. 📦 构建 arm64 版本...');
    execSync(`npx @electron/packager . EmployeeSafety --app-bundle-id=com.company.employee-safety --platform=darwin --arch=arm64 --out=release --overwrite --no-asar --icon=assets/icons/icon.icns --ignore="native-event-monitor-win|native-event-monitor/node_modules|native-event-monitor/\\.npm-cache|native-event-monitor/src|native-event-monitor/binding\\.gyp|^/debug/|^/doc/|^/docs/|^/release/|test-.*\\.js$|.*\\.test\\.js$|.*\\.spec\\.js$|.*\\.md$|^\\\\..*|Dockerfile$|tsconfig\\.json$|pnpm-.*|package.*\\.backup$|.*\\.log$|^/cache/|^/build/|^/claudedocs/|^/src/|^/platforms/|^/main/|^/common/|^/types/|^/scripts/|^/logs/|^/\\.npm-cache/|^/\\.claude/|^/\\.github/|electron-builder.*\\.yml$"`, {
      stdio: 'inherit'
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
        
        // 自签名
        try {
          execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'pipe' });
          console.log(`   ✅ ${appPath} 修复完成`);
        } catch (error) {
          console.log(`   ⚠️  ${appPath} 签名失败，但应用仍可用`);
        }

        // 复制 app-update.yml 到 Resources 目录
        const updateYmlSource = path.join(__dirname, '..', 'app-update.yml');
        const updateYmlDest = path.join(appPath, 'Contents', 'Resources', 'app-update.yml');
        if (fs.existsSync(updateYmlSource)) {
          fs.copyFileSync(updateYmlSource, updateYmlDest);
          console.log(`   ✅ 已复制 app-update.yml`);
        }

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

    // 6. 创建一键安装脚本
    console.log('\n6. 🔧 创建一键安装脚本...');
    execSync('bash scripts/create-installer.sh', { stdio: 'inherit' });

    console.log('\n✅ Universal 打包完成！');
    console.log('\n📦 可用版本:');
    console.log('   • EmployeeMonitor-darwin-x64: 适用于 Intel Mac');
    console.log('   • EmployeeMonitor-darwin-arm64: 适用于 Apple Silicon Mac');
    console.log('\n📜 安装脚本:');
    console.log('   • 安装-Intel.command: Intel Mac 一键安装');
    console.log('   • 安装-AppleSilicon.command: Apple Silicon 一键安装');
    console.log('\n💡 用户双击对应的安装脚本即可自动完成安装');
    
  } catch (error) {
    console.error('❌ 打包失败:', error.message);
    process.exit(1);
  }
}

function createInstallGuide() {
  const guideContent = `# EmployeeMonitor 安装指南

## 系统要求
- macOS 10.15 或更高版本
- 管理员权限（用于设置辅助功能权限）

## 选择正确的版本

### 如何知道您的 Mac 类型？
1. 点击苹果菜单 > 关于本机
2. 查看"芯片"或"处理器"信息：
   - **Apple M1/M2/M3** → 下载 **EmployeeMonitor-darwin-arm64**
   - **Intel** → 下载 **EmployeeMonitor-darwin-x64**

## 安装步骤

### 1. 下载和解压
1. 下载对应您 Mac 类型的版本
2. 解压 zip 文件
3. 将 EmployeeMonitor.app 拖放到"应用程序"文件夹

### 2. 首次打开
**重要：** 首次打开时可能遇到安全提示

#### 方法 1：右键菜单打开
1. 右键点击 EmployeeMonitor.app
2. 选择"打开"
3. 在弹出对话框中点击"打开"

#### 方法 2：终端命令
1. 打开终端
2. 输入：\`xattr -cr /Applications/EmployeeMonitor.app\`
3. 然后正常打开应用

#### 方法 3：系统设置
1. 系统偏好设置 > 安全性与隐私 > 通用
2. 看到应用被阻止的提示后，点击"仍要打开"

### 3. 权限设置
应用需要以下权限才能正常工作：

#### 辅助功能权限
1. 系统偏好设置 > 安全性与隐私 > 辅助功能
2. 点击锁图标解锁
3. 勾选"EmployeeMonitor"

#### 屏幕录制权限
1. 系统偏好设置 > 安全性与隐私 > 屏幕录制
2. 点击锁图标解锁
3. 勾选"EmployeeMonitor"

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