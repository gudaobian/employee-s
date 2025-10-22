/**
 * UnifiedLogManager 测试脚本
 * 测试轮转、清理、压缩功能
 */

const fs = require('fs');
const path = require('path');

// 模拟 Electron app
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(__dirname, 'test-logs');
    }
  }
};

// 使用 mock app 替换 electron
require.cache[require.resolve('electron')] = {
  exports: { app: mockApp }
};

const UnifiedLogManager = require('./unified-log-manager');

// 测试配置
const TEST_CONFIG = {
  maxFileSize: 1024, // 1KB (小文件便于测试)
  maxFiles: 3,
  maxTotalSize: 5 * 1024, // 5KB
  maxRetentionDays: 1,
  enableCompression: false,
  enableConsole: true, // 启用控制台输出以便调试
  enableFile: true,
  enableAutoCleanup: false,
  cleanupOnStartup: false,
  flushInterval: 1000,
  logLevel: 'DEBUG',
  hijackConsole: false // 禁用console劫持,便于测试输出
};

// 清理测试目录
function cleanTestDir() {
  const testDir = path.join(__dirname, 'test-logs');
  if (fs.existsSync(testDir)) {
    const files = fs.readdirSync(testDir);
    files.forEach(file => {
      const filePath = path.join(testDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        // 递归删除子目录
        const subFiles = fs.readdirSync(filePath);
        subFiles.forEach(subFile => {
          fs.unlinkSync(path.join(filePath, subFile));
        });
        fs.rmdirSync(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    });
    fs.rmdirSync(testDir);
  }
}

// 测试1: 轮转功能
async function testRotation() {
  console.log('\n========== 测试1: 日志轮转 ==========');

  cleanTestDir();
  const logger = new UnifiedLogManager(TEST_CONFIG);

  // 生成足够的日志触发轮转
  for (let i = 0; i < 200; i++) {
    logger.log('INFO', `Test log entry ${i} - some content to fill up the file`);
  }

  // 立即写入
  logger.flush();

  // 等待轮转完成
  await new Promise(resolve => setTimeout(resolve, 500));

  const testDir = path.join(__dirname, 'test-logs');
  const files = fs.readdirSync(testDir).filter(f => f.includes('log'));

  console.log('日志文件列表:', files);
  console.log('文件数量:', files.length);

  // 验证
  if (files.length <= 4) {
    console.log('✅ 轮转测试通过：文件数量 <= 4');
  } else {
    console.log('❌ 轮转测试失败：文件数量过多');
  }

  // 验证文件命名
  const hasAppLog = files.includes('app.log');
  const hasRotated = files.some(f => /app\.log\.\d+/.test(f));

  if (hasAppLog && hasRotated) {
    console.log('✅ 文件命名正确');
  } else {
    console.log('❌ 文件命名错误');
  }

  logger.destroy();
}

// 测试2: 清理功能
async function testCleanup() {
  console.log('\n========== 测试2: 日志清理 ==========');

  cleanTestDir();
  const logger = new UnifiedLogManager(TEST_CONFIG);

  // 生成多个轮转文件
  for (let i = 0; i < 500; i++) {
    logger.log('INFO', `Test log entry ${i} - content for cleanup test`);
  }

  logger.flush();
  await new Promise(resolve => setTimeout(resolve, 500));

  const testDir = path.join(__dirname, 'test-logs');
  let files = fs.readdirSync(testDir).filter(f => f.includes('log'));
  console.log('清理前文件数量:', files.length);

  // 执行清理
  logger.comprehensiveCleanup();

  files = fs.readdirSync(testDir).filter(f => f.includes('log'));
  console.log('清理后文件数量:', files.length);

  if (files.length <= 4) {
    console.log('✅ 清理测试通过');
  } else {
    console.log('❌ 清理测试失败');
  }

  logger.destroy();
}

// 测试3: 压缩功能
async function testCompression() {
  console.log('\n========== 测试3: 日志压缩 ==========');

  cleanTestDir();

  const compressConfig = {
    ...TEST_CONFIG,
    enableCompression: true
  };

  const logger = new UnifiedLogManager(compressConfig);

  // 生成日志触发轮转和压缩
  for (let i = 0; i < 300; i++) {
    logger.log('INFO', `Compression test log ${i} - this is a longer message to make compression worthwhile`);
  }

  logger.flush();
  await new Promise(resolve => setTimeout(resolve, 1000));

  const testDir = path.join(__dirname, 'test-logs');
  const files = fs.readdirSync(testDir);

  console.log('文件列表:', files);

  const gzFiles = files.filter(f => f.endsWith('.gz'));
  console.log('压缩文件数量:', gzFiles.length);

  if (gzFiles.length > 0) {
    console.log('✅ 压缩测试通过');

    // 检查原文件是否被删除
    const uncompressedRotated = files.filter(f => /app\.log\.\d+$/.test(f));
    console.log('未压缩的轮转文件:', uncompressedRotated);

    if (uncompressedRotated.length === 0) {
      console.log('✅ 原文件已正确删除');
    }
  } else {
    console.log('❌ 压缩测试失败：没有生成压缩文件');
  }

  logger.destroy();
}

// 测试4: 日志级别控制
function testLogLevels() {
  console.log('\n========== 测试4: 日志级别控制 ==========');

  cleanTestDir();

  const levelConfig = {
    ...TEST_CONFIG,
    logLevel: 'WARN'
  };

  const logger = new UnifiedLogManager(levelConfig);

  // 写入不同级别的日志
  logger.log('DEBUG', 'This is debug - should be filtered');
  logger.log('INFO', 'This is info - should be filtered');
  logger.log('WARN', 'This is warn - should be logged');
  logger.log('ERROR', 'This is error - should be logged');

  logger.flush();

  const testDir = path.join(__dirname, 'test-logs');
  const logFile = path.join(testDir, 'app.log');

  if (fs.existsSync(logFile)) {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    console.log('日志行数:', lines.length);
    console.log('日志内容:');
    lines.forEach(line => console.log('  ', line));

    const hasDebug = content.includes('This is debug');
    const hasInfo = content.includes('This is info');
    const hasWarn = content.includes('This is warn');
    const hasError = content.includes('This is error');

    if (!hasDebug && !hasInfo && hasWarn && hasError) {
      console.log('✅ 日志级别控制测试通过');
    } else {
      console.log('❌ 日志级别控制测试失败');
      console.log('  DEBUG:', hasDebug ? '存在(错误)' : '不存在(正确)');
      console.log('  INFO:', hasInfo ? '存在(错误)' : '不存在(正确)');
      console.log('  WARN:', hasWarn ? '存在(正确)' : '不存在(错误)');
      console.log('  ERROR:', hasError ? '存在(正确)' : '不存在(错误)');
    }
  }

  logger.destroy();
}

// 测试5: 统计信息
function testStats() {
  console.log('\n========== 测试5: 统计信息 ==========');

  cleanTestDir();
  const logger = new UnifiedLogManager(TEST_CONFIG);

  // 生成一些日志
  for (let i = 0; i < 100; i++) {
    logger.log('INFO', `Stats test log ${i}`);
  }

  logger.flush();

  const stats = logger.getLogStats();
  console.log('统计信息:', JSON.stringify(stats, null, 2));

  if (stats && stats.fileCount >= 1) {
    console.log('✅ 统计信息测试通过');
  } else {
    console.log('❌ 统计信息测试失败');
  }

  logger.destroy();
}

// 运行所有测试
async function runAllTests() {
  console.log('开始测试 UnifiedLogManager...\n');

  try {
    await testRotation();
    await testCleanup();
    await testCompression();
    testLogLevels();
    testStats();

    console.log('\n========== 测试完成 ==========');
    console.log('✅ 所有测试已执行');

    // 清理测试目录
    console.log('\n清理测试文件...');
    cleanTestDir();
    console.log('✅ 测试文件已清理');

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 执行测试
runAllTests();
