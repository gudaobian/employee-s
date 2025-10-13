/**
 * Windows Native Event Monitor - Main Entry Point
 * 导出Windows原生事件监控模块的主要接口
 * 支持预编译模块自动加载
 */

const path = require('path');
const fs = require('fs');

let nativeModule = null;

/**
 * 智能加载原生模块
 * 按优先级尝试: 预编译模块 > Release构建 > Debug构建 > 备用接口
 */
function loadNativeModule() {
  if (nativeModule) {
    return nativeModule;
  }

  // 1. 优先尝试加载预编译模块
  try {
    const precompiledLoader = path.join(__dirname, 'precompiled', 'loader.js');
    if (fs.existsSync(precompiledLoader)) {
      console.log('[WIN-NATIVE] 🔍 检测到预编译模块，尝试加载...');
      const loader = require(precompiledLoader);
      if (loader.isAvailable()) {
        nativeModule = loader.load();
        console.log('[WIN-NATIVE] ✅ 预编译模块加载成功');
        return nativeModule;
      } else {
        console.log('[WIN-NATIVE] ⚠️ 预编译模块不可用，尝试其他方式');
      }
    }
  } catch (error) {
    console.warn('[WIN-NATIVE] ⚠️ 预编译模块加载失败:', error.message);
  }

  // 2. 尝试加载编译后的模块
  const possiblePaths = [
    path.join(__dirname, 'build', 'Release', 'event_monitor.node'),
    path.join(__dirname, 'build', 'Debug', 'event_monitor.node'),
    path.join(__dirname, 'event_monitor.node'), // 直接在当前目录
  ];

  for (const modulePath of possiblePaths) {
    if (fs.existsSync(modulePath)) {
      try {
        nativeModule = require(modulePath);
        console.log(`[WIN-NATIVE] ✅ 编译版本模块加载成功: ${path.relative(__dirname, modulePath)}`);
        return nativeModule;
      } catch (error) {
        console.warn(`[WIN-NATIVE] ⚠️ 尝试加载 ${path.relative(__dirname, modulePath)} 失败:`, error.message);
      }
    }
  }

  // 3. 如果都失败了，提供备用接口和详细错误信息
  console.error('[WIN-NATIVE] ❌ 无法加载Windows原生事件监控模块');
  console.error('[WIN-NATIVE] 💡 解决建议:');
  console.error('[WIN-NATIVE]   1. 生产环境: 确认安装包包含预编译模块');
  console.error('[WIN-NATIVE]   2. 开发环境: 运行 npm run build 重新编译');
  console.error('[WIN-NATIVE]   3. 检查系统是否支持原生模块编译');
  console.error('[WIN-NATIVE]   4. 确认Node.js版本兼容性 (需要 >= 16.0.0)');
  console.error('[WIN-NATIVE] 🔄 现在使用备用接口，功能受限');

  // 返回备用接口，避免应用程序崩溃
  nativeModule = {
    start: () => {
      console.warn('[WIN-NATIVE] 使用备用接口，无法启动真实事件监控');
      return false;
    },
    stop: () => {
      console.warn('[WIN-NATIVE] 使用备用接口，无法停止事件监控');
      return false;
    },
    getCounts: () => {
      return { keyboard: 0, mouseClicks: 0, idleTime: 0, isMonitoring: false };
    },
    resetCounts: () => {
      console.warn('[WIN-NATIVE] 使用备用接口，无法重置计数');
      return false;
    },
    isMonitoring: () => false,
    getActiveWindow: () => {
      console.warn('[WIN-NATIVE] 使用备用接口，无法获取活动窗口');
      return { isValid: false };
    }
  };

  return nativeModule;
}

// 执行加载
loadNativeModule();

module.exports = nativeModule;