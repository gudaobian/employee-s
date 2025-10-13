/**
 * Windows Native Event Monitor Test Script
 * 测试Windows原生事件监控功能
 */

const path = require('path');
const fs = require('fs');

console.log('🧪 Windows原生事件监控测试');
console.log('==============================\n');

// 测试配置
const TEST_DURATION = 10000; // 10秒测试
const CHECK_INTERVAL = 1000;  // 每秒检查一次

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testModuleLoading() {
  console.log('📦 测试1: 模块加载');
  console.log('------------------');
  
  try {
    // 尝试加载编译后的模块
    let nativeModule = null;
    let modulePath = '';
    
    // 检查Release版本
    const releasePath = path.join(__dirname, 'build', 'Release', 'event_monitor.node');
    if (fs.existsSync(releasePath)) {
      modulePath = releasePath;
      console.log('✅ 找到Release版本:', releasePath);
    } else {
      // 检查Debug版本
      const debugPath = path.join(__dirname, 'build', 'Debug', 'event_monitor.node');
      if (fs.existsSync(debugPath)) {
        modulePath = debugPath;
        console.log('✅ 找到Debug版本:', debugPath);
      } else {
        console.log('❌ 未找到编译后的模块文件');
        console.log('💡 请先运行: npm run build');
        return null;
      }
    }
    
    // 加载模块
    nativeModule = require(modulePath);
    console.log('✅ 原生模块加载成功');
    
    // 检查方法是否存在
    const methods = ['start', 'stop', 'getCounts', 'resetCounts', 'isMonitoring'];
    for (const method of methods) {
      if (typeof nativeModule[method] === 'function') {
        console.log(`✅ 方法 ${method} 存在`);
      } else {
        console.log(`❌ 方法 ${method} 不存在`);
        return null;
      }
    }
    
    return nativeModule;
    
  } catch (error) {
    console.log('❌ 模块加载失败:', error.message);
    return null;
  }
}

async function testBasicFunctionality(nativeModule) {
  console.log('\n🔧 测试2: 基本功能');
  console.log('------------------');
  
  try {
    // 检查初始状态
    const initialState = nativeModule.isMonitoring();
    console.log('📊 初始监控状态:', initialState ? '监控中' : '未监控');
    
    // 启动监控
    console.log('🚀 启动事件监控...');
    const startResult = nativeModule.start();
    if (startResult) {
      console.log('✅ 事件监控启动成功');
    } else {
      console.log('❌ 事件监控启动失败');
      return false;
    }
    
    // 检查状态
    const monitoringState = nativeModule.isMonitoring();
    console.log('📊 当前监控状态:', monitoringState ? '监控中' : '未监控');
    
    if (!monitoringState) {
      console.log('⚠️ 警告: 启动命令成功但状态显示未监控');
    }
    
    return true;
    
  } catch (error) {
    console.log('❌ 基本功能测试失败:', error.message);
    return false;
  }
}

async function testEventDetection(nativeModule) {
  console.log('\n⌨️ 测试3: 事件检测');
  console.log('------------------');
  
  try {
    // 重置计数
    nativeModule.resetCounts();
    console.log('🔄 已重置事件计数');
    
    console.log(`⏱️ 开始 ${TEST_DURATION/1000} 秒事件监控测试...`);
    console.log('💡 请在测试期间按键盘和点击鼠标');
    console.log('');
    
    const startTime = Date.now();
    let lastKeyboard = 0;
    let lastMouse = 0;
    
    // 定期检查事件计数
    const checkInterval = setInterval(() => {
      try {
        const counts = nativeModule.getCounts();
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        
        // 检测增量
        const keyboardDelta = counts.keyboard - lastKeyboard;
        const mouseDelta = counts.mouseClicks - lastMouse;
        
        console.log(`[${elapsed}s] 键盘: ${counts.keyboard} (+${keyboardDelta}) | 鼠标: ${counts.mouseClicks} (+${mouseDelta}) | 空闲: ${counts.idleTime}ms`);
        
        lastKeyboard = counts.keyboard;
        lastMouse = counts.mouseClicks;
        
      } catch (error) {
        console.log('⚠️ 获取计数时出错:', error.message);
      }
    }, CHECK_INTERVAL);
    
    // 等待测试完成
    await sleep(TEST_DURATION);
    clearInterval(checkInterval);
    
    // 获取最终结果
    const finalCounts = nativeModule.getCounts();
    console.log('\n📊 测试结果:');
    console.log(`- 键盘事件总数: ${finalCounts.keyboard}`);
    console.log(`- 鼠标点击总数: ${finalCounts.mouseClicks}`);
    console.log(`- 最终空闲时间: ${finalCounts.idleTime}ms`);
    console.log(`- 监控状态: ${finalCounts.isMonitoring ? '活跃' : '非活跃'}`);
    
    // 分析结果
    if (finalCounts.keyboard > 0 || finalCounts.mouseClicks > 0) {
      console.log('✅ 事件检测功能正常工作');
      return true;
    } else {
      console.log('⚠️ 未检测到任何事件 - 可能是权限问题或者测试期间没有输入');
      return false;
    }
    
  } catch (error) {
    console.log('❌ 事件检测测试失败:', error.message);
    return false;
  }
}

async function testPermissions() {
  console.log('\n🔐 测试4: 权限检查');
  console.log('------------------');
  
  try {
    // 加载UAC助手（如果可用）
    const { spawn } = require('child_process');
    
    // 检查是否有管理员权限
    try {
      const { execSync } = require('child_process');
      execSync('net session >nul 2>&1', { stdio: 'ignore' });
      console.log('✅ 当前进程具有管理员权限');
    } catch (error) {
      console.log('⚠️ 当前进程没有管理员权限');
      console.log('💡 某些功能可能需要管理员权限才能正常工作');
    }
    
    // 检查Windows版本
    try {
      const os = require('os');
      console.log('🖥️ 操作系统:', os.platform(), os.release());
      console.log('🏗️ 架构:', os.arch());
    } catch (error) {
      console.log('⚠️ 无法获取系统信息');
    }
    
    return true;
    
  } catch (error) {
    console.log('❌ 权限检查失败:', error.message);
    return false;
  }
}

async function testCleanup(nativeModule) {
  console.log('\n🧹 测试5: 清理');
  console.log('------------------');
  
  try {
    // 停止监控
    console.log('🛑 停止事件监控...');
    const stopResult = nativeModule.stop();
    if (stopResult) {
      console.log('✅ 事件监控停止成功');
    } else {
      console.log('❌ 事件监控停止失败');
    }
    
    // 检查最终状态
    const finalState = nativeModule.isMonitoring();
    console.log('📊 最终监控状态:', finalState ? '监控中' : '未监控');
    
    if (finalState) {
      console.log('⚠️ 警告: 停止命令成功但状态显示仍在监控');
    }
    
    return true;
    
  } catch (error) {
    console.log('❌ 清理测试失败:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('开始Windows原生事件监控完整测试...\n');
  
  const results = {
    moduleLoading: false,
    basicFunctionality: false,
    eventDetection: false,
    permissions: false,
    cleanup: false
  };
  
  // 测试1: 模块加载
  const nativeModule = await testModuleLoading();
  results.moduleLoading = !!nativeModule;
  
  if (!nativeModule) {
    console.log('\n💥 测试中止: 无法加载原生模块');
    return results;
  }
  
  // 测试2: 基本功能
  results.basicFunctionality = await testBasicFunctionality(nativeModule);
  
  if (!results.basicFunctionality) {
    console.log('\n💥 测试中止: 基本功能测试失败');
    return results;
  }
  
  // 测试3: 事件检测
  results.eventDetection = await testEventDetection(nativeModule);
  
  // 测试4: 权限检查
  results.permissions = await testPermissions();
  
  // 测试5: 清理
  results.cleanup = await testCleanup(nativeModule);
  
  // 输出测试总结
  console.log('\n📋 测试总结');
  console.log('=============');
  console.log(`模块加载: ${results.moduleLoading ? '✅ 通过' : '❌ 失败'}`);
  console.log(`基本功能: ${results.basicFunctionality ? '✅ 通过' : '❌ 失败'}`);
  console.log(`事件检测: ${results.eventDetection ? '✅ 通过' : '⚠️ 需要检查'}`);
  console.log(`权限检查: ${results.permissions ? '✅ 通过' : '❌ 失败'}`);
  console.log(`清理操作: ${results.cleanup ? '✅ 通过' : '❌ 失败'}`);
  
  const passedTests = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;
  
  console.log(`\n🎯 测试结果: ${passedTests}/${totalTests} 通过`);
  
  if (passedTests === totalTests) {
    console.log('🎉 所有测试通过！Windows原生事件监控功能正常');
  } else if (results.moduleLoading && results.basicFunctionality) {
    console.log('⚠️ 部分测试通过，基本功能可用');
  } else {
    console.log('💥 关键测试失败，需要检查配置和权限');
  }
  
  return results;
}

// 如果直接运行此脚本
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('测试执行出错:', error);
    process.exit(1);
  });
}

module.exports = { runAllTests, testModuleLoading, testBasicFunctionality, testEventDetection };