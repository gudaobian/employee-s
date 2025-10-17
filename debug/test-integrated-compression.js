#!/usr/bin/env node
/**
 * 测试集成后的截图压缩功能
 * 直接调用 DarwinAdapter 的 takeScreenshot 方法
 */

const path = require('path');

async function testIntegratedCompression() {
  console.log('========================================');
  console.log('测试集成后的截图压缩功能');
  console.log('========================================\n');

  try {
    // 动态加载编译后的 DarwinAdapter
    console.log('步骤 1: 加载 DarwinAdapter...');

    const adapterPath = path.join(__dirname, '../dist/platforms/darwin/darwin-adapter.js');
    const { DarwinAdapter } = require(adapterPath);

    console.log('✅ DarwinAdapter 已加载\n');

    // 创建适配器实例
    console.log('步骤 2: 创建 DarwinAdapter 实例...');
    const adapter = new DarwinAdapter();
    await adapter.initialize();
    console.log('✅ 适配器已初始化\n');

    // 测试不同质量参数的截图
    const qualities = [60, 80, 90];
    const results = [];

    for (const quality of qualities) {
      console.log(`步骤 3.${qualities.indexOf(quality) + 1}: 测试质量 ${quality} 的截图...`);

      const result = await adapter.takeScreenshot({
        quality: quality,
        format: 'jpg'
      });

      if (result.success) {
        const sizeMB = (result.size / 1024 / 1024).toFixed(2);
        console.log(`✅ 质量 ${quality} 截图成功`);
        console.log(`   文件大小: ${result.size} bytes (${sizeMB} MB)`);
        console.log(`   格式: ${result.format}\n`);

        results.push({
          quality,
          size: result.size,
          sizeMB
        });
      } else {
        console.log(`❌ 质量 ${quality} 截图失败: ${result.error}\n`);
      }
    }

    // 清理
    await adapter.cleanup();

    // 输出对比结果
    console.log('========================================');
    console.log('不同质量参数对比');
    console.log('========================================\n');

    console.log('质量参数 | 文件大小 (MB) | 与质量80对比');
    console.log('---------|---------------|-------------');

    const baselineSize = results.find(r => r.quality === 80)?.size || 0;

    results.forEach(result => {
      const diff = baselineSize > 0
        ? ((result.size - baselineSize) / baselineSize * 100).toFixed(2)
        : '0.00';
      const diffSign = parseFloat(diff) > 0 ? '+' : '';
      console.log(`   ${result.quality}    |    ${result.sizeMB}     | ${diffSign}${diff}%`);
    });

    console.log('\n========================================');
    console.log('✅ 测试完成');
    console.log('========================================\n');

    console.log('建议：');
    console.log('- 质量 60: 文件最小，适合高频传输场景');
    console.log('- 质量 80: 平衡质量与大小，推荐默认值');
    console.log('- 质量 90: 高质量，适合需要清晰截图的场景\n');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
testIntegratedCompression().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
