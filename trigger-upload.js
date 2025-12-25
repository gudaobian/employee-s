/**
 * 手动触发上传测试脚本
 *
 * 这个脚本用于测试上传功能
 * 实际应用中，应该在 WebSocket 重连或定期检查时自动触发
 */

console.log('='.repeat(60));
console.log('手动上传触发说明');
console.log('='.repeat(60));
console.log('');
console.log('当前问题：');
console.log('  - 上传管理器只在 WebSocket 首次连接时触发');
console.log('  - 如果连接时队列为空，上传循环立即退出');
console.log('  - 之后数据溢出到磁盘，但不会自动上传');
console.log('');
console.log('临时解决方案：');
console.log('  1. 在应用的开发者工具控制台中执行：');
console.log('     window.electronAPI.triggerUpload()');
console.log('');
console.log('  2. 或者重启应用（WebSocket 重连会触发上传）');
console.log('');
console.log('长期解决方案：');
console.log('  - 实现定期上传检查机制');
console.log('  - 在数据溢出到磁盘时触发上传');
console.log('  - WebSocket 重连时自动触发上传');
console.log('');
console.log('='.repeat(60));
