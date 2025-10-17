#!/usr/bin/env node
/**
 * 截图压缩测试脚本
 * 测试原始截图 vs 压缩截图的文件大小对比
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function testScreenshotCompression() {
  console.log('========================================');
  console.log('截图压缩测试');
  console.log('========================================\n');

  const debugDir = __dirname;
  const timestamp = Date.now();
  const originalPath = path.join(debugDir, `screenshot-original-${timestamp}.png`);
  const compressedPath = path.join(debugDir, `screenshot-compressed-${timestamp}.jpg`);

  try {
    // 步骤 1: 使用系统命令截取原始截图
    console.log('步骤 1: 捕获原始截图...');
    console.log(`输出路径: ${originalPath}`);

    execSync(`screencapture -t png -x "${originalPath}"`);

    if (!fs.existsSync(originalPath)) {
      throw new Error('原始截图文件未创建');
    }

    const originalStats = fs.statSync(originalPath);
    const originalSize = originalStats.size;
    const originalSizeMB = (originalSize / 1024 / 1024).toFixed(2);

    console.log(`✅ 原始截图已保存`);
    console.log(`   文件大小: ${originalSize} bytes (${originalSizeMB} MB)\n`);

    // 步骤 2: 检查 sharp 是否可用
    console.log('步骤 2: 加载 sharp 图片处理库...');
    let sharp;
    try {
      sharp = require('sharp');
      console.log('✅ sharp 库已加载\n');
    } catch (error) {
      console.log('❌ sharp 库未安装');
      console.log('   请运行: npm install sharp');
      console.log('   跳过压缩测试，仅保留原始截图\n');

      printSummary({
        originalPath,
        originalSize,
        compressedPath: null,
        compressedSize: null,
        compressionRatio: null,
        error: 'sharp 库未安装'
      });
      return;
    }

    // 步骤 3: 压缩图片
    console.log('步骤 3: 压缩图片 (质量: 80)...');
    console.log(`输出路径: ${compressedPath}`);

    await sharp(originalPath)
      .jpeg({
        quality: 80,
        mozjpeg: true  // 使用 mozjpeg 引擎获得更好的压缩率
      })
      .toFile(compressedPath);

    const compressedStats = fs.statSync(compressedPath);
    const compressedSize = compressedStats.size;
    const compressedSizeMB = (compressedSize / 1024 / 1024).toFixed(2);

    console.log(`✅ 压缩截图已保存`);
    console.log(`   文件大小: ${compressedSize} bytes (${compressedSizeMB} MB)\n`);

    // 步骤 4: 计算压缩率
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);
    const savedBytes = originalSize - compressedSize;
    const savedMB = (savedBytes / 1024 / 1024).toFixed(2);

    // 输出汇总结果
    printSummary({
      originalPath,
      originalSize,
      compressedPath,
      compressedSize,
      compressionRatio,
      savedBytes,
      savedMB
    });

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function printSummary(results) {
  console.log('========================================');
  console.log('测试结果汇总');
  console.log('========================================\n');

  console.log('📄 原始截图:');
  console.log(`   路径: ${results.originalPath}`);
  console.log(`   大小: ${results.originalSize} bytes (${(results.originalSize / 1024 / 1024).toFixed(2)} MB)\n`);

  if (results.compressedPath) {
    console.log('📦 压缩截图:');
    console.log(`   路径: ${results.compressedPath}`);
    console.log(`   大小: ${results.compressedSize} bytes (${(results.compressedSize / 1024 / 1024).toFixed(2)} MB)\n`);

    console.log('📊 压缩效果:');
    console.log(`   压缩率: ${results.compressionRatio}%`);
    console.log(`   节省空间: ${results.savedBytes} bytes (${results.savedMB} MB)\n`);

    if (parseFloat(results.compressionRatio) > 50) {
      console.log('✅ 压缩效果显著，建议启用压缩功能');
    } else if (parseFloat(results.compressionRatio) > 30) {
      console.log('✅ 压缩效果良好');
    } else {
      console.log('⚠️  压缩效果一般，考虑调整质量参数');
    }
  } else {
    console.log('⚠️  未进行压缩测试');
    if (results.error) {
      console.log(`   原因: ${results.error}`);
    }
  }

  console.log('\n========================================\n');
}

// 运行测试
testScreenshotCompression().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
