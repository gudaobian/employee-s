# macOS浏览器URL采集测试指南

本文档提供macOS URL采集功能的完整测试指南，包括浏览器兼容性、隐私保护和性能稳定性测试。

---

## 目录

1. [测试准备](#测试准备)
2. [浏览器兼容性测试](#浏览器兼容性测试)
3. [隐私保护测试](#隐私保护测试)
4. [性能与稳定性测试](#性能与稳定性测试)
5. [结果分析](#结果分析)
6. [故障排查](#故障排查)

---

## 测试准备

### 前置条件

1. **系统要求**
   - macOS 10.15+
   - Node.js 16+
   - 已安装待测试浏览器（Safari, Chrome, Edge, Firefox, Brave）

2. **应用权限**
   ```bash
   # 确认辅助功能权限已授予
   # 路径: 系统偏好设置 → 安全性与隐私 → 辅助功能
   # 添加: employee-client 或 Terminal
   ```

3. **应用启动**
   ```bash
   cd employee-client
   npm run dev

   # 或者使用打包后的应用
   open -a "Employee Monitor"
   ```

4. **日志确认**
   ```bash
   # 确保日志目录存在且可写
   ls -la logs/
   tail -f logs/app.log  # 实时监控日志
   ```

### 环境准备

```bash
# 1. 清理旧日志（可选）
rm logs/app.log
touch logs/app.log

# 2. 创建测试报告目录
mkdir -p doc/test-reports

# 3. 给测试脚本添加执行权限
chmod +x test/manual/*.sh

# 4. 验证应用运行状态
pgrep -f "employee-client"  # 应返回进程ID
```

---

## 浏览器兼容性测试

### 测试目标

验证每个浏览器的URL采集成功率是否达到目标。

**目标成功率**:
- Safari: ≥95% (19/20)
- Chrome: ≥90% (18/20)
- Edge: ≥85% (17/20)
- Firefox: ≥40% (8/20) - 已知限制
- Brave: ≥85% (17/20)

### 自动化测试

```bash
# 运行完整兼容性测试（约100分钟）
./test/manual/browser-compatibility-test.sh

# 测试单个浏览器（修改脚本中的循环）
# 编辑 browser-compatibility-test.sh，只保留需要测试的浏览器
```

### 手动测试步骤

如果需要手动验证或调试特定浏览器：

#### 1. Safari测试

```bash
# 1. 打开Safari
open -a Safari "https://github.com"

# 2. 等待60秒（一个采集周期）
sleep 60

# 3. 检查日志
tail -20 logs/app.log | grep "Safari"

# 预期输出:
# ✅ URL collected: https://github.com [Safari] in 45ms
```

#### 2. Chrome测试

```bash
# 1. 打开Chrome
open -a "Google Chrome" "https://stackoverflow.com"

# 2. 等待60秒
sleep 60

# 3. 检查日志
tail -20 logs/app.log | grep "Chrome"

# 预期输出:
# ✅ URL collected: https://stackoverflow.com [Chrome] in 52ms
```

#### 3. Firefox测试

**注意**: Firefox成功率较低（40-60%），这是已知限制。

```bash
# 1. 打开Firefox
open -a Firefox "https://mozilla.org"

# 2. 等待60秒
sleep 60

# 3. 检查日志
tail -20 logs/app.log | grep "Firefox"

# 预期输出（可能失败）:
# ✅ URL collected: https://mozilla.org [Firefox] in 123ms
# 或
# ⚠️ Firefox URL collection: AppleScript failed, trying fallback...
```

### 测试验证清单

- [ ] Safari: 20次测试中≥19次成功
- [ ] Chrome: 20次测试中≥18次成功
- [ ] Edge: 20次测试中≥17次成功
- [ ] Firefox: 20次测试中≥8次成功
- [ ] Brave: 20次测试中≥17次成功
- [ ] 日志中无崩溃或严重错误
- [ ] 采集延迟合理（P95 < 250ms）
- [ ] 测试报告已生成

---

## 隐私保护测试

### 测试目标

验证系统正确过滤敏感信息，包括：
- 查询参数（token, api_key, password等）
- 敏感域名（邮件、金融、医疗）
- URL fragments (#)
- 信用卡号、会话ID等模式

### 自动化测试

```bash
# 运行完整隐私保护测试（约20分钟）
./test/manual/privacy-protection-test.sh
```

### 手动测试步骤

#### 1. 查询参数过滤测试

```bash
# 1. 打开包含敏感参数的URL
open -a Safari "https://example.com?token=abc123&api_key=secret&page=1"

# 2. 等待70秒
sleep 70

# 3. 检查日志
tail -20 logs/app.log | grep "example.com"

# 预期输出:
# ✅ URL collected: https://example.com?page=1 [Safari]
# 注意: token和api_key已被移除，page保留（在白名单中）
```

#### 2. 敏感域名保护测试

```bash
# 1. 打开敏感域名
open -a Safari "https://mail.google.com"

# 2. 等待70秒
sleep 70

# 3. 检查日志
tail -20 logs/app.log

# 预期输出:
# ✅ URL collected: REDACTED [Safari]
# 注意: 完整URL已被替换为"REDACTED"
```

#### 3. 模式检测测试

```bash
# 测试信用卡号检测
open -a Safari "https://example.com?card=4532123456789012"
sleep 70
tail -20 logs/app.log | grep "example.com"

# 预期: 信用卡号已被移除
# ✅ URL collected: https://example.com [Safari]
```

### 隐私测试案例矩阵

| 测试案例 | 输入URL | 预期输出 | 验证方法 |
|----------|---------|----------|----------|
| Token移除 | `?token=abc123` | 无token参数 | 检查日志 |
| API Key移除 | `?api_key=secret` | 无api_key参数 | 检查日志 |
| Password移除 | `?password=123` | 无password参数 | 检查日志 |
| 白名单保留 | `?page=1&lang=en` | 保留page和lang | 检查日志 |
| 邮件域名 | `mail.google.com` | `REDACTED` | 检查日志 |
| 金融域名 | `chase.com` | `REDACTED` | 检查日志 |
| Fragment移除 | `#section` | 无fragment | 检查日志 |
| 信用卡号 | `4532-1234-5678-9012` | 号码已移除 | 检查日志 |

### 隐私测试验证清单

- [ ] 非白名单查询参数被移除
- [ ] 白名单参数（page, lang, tab, view）被保留
- [ ] 敏感域名替换为"REDACTED"
- [ ] URL fragments被移除
- [ ] 信用卡号模式被检测并移除
- [ ] API密钥模式被检测并移除
- [ ] 会话ID被移除
- [ ] 隐私配置可自定义

---

## 性能与稳定性测试

### 测试目标

验证系统长期运行的性能和稳定性：
- 内存增长 ≤ 50MB（8小时）
- P50延迟 ≤ 60ms
- P95延迟 ≤ 250ms
- P99延迟 ≤ 1000ms
- 无崩溃或内存泄漏

### 自动化测试（长时间运行）

```bash
# 默认8小时测试
./test/manual/performance-test.sh

# 自定义测试时长（单位：小时）
./test/manual/performance-test.sh 4  # 4小时测试
./test/manual/performance-test.sh 24 # 24小时测试
```

**注意**: 性能测试需要长时间运行，请确保：
- Mac不会进入睡眠状态
- 应用持续运行
- 有足够的磁盘空间存储日志
- 网络连接稳定

### 测试监控

在测试运行期间，可以实时监控：

```bash
# 终端1: 监控内存使用
while true; do
  ps aux | grep -i "employee.*client" | grep -v grep | awk '{print $6 " KB"}'
  sleep 600  # 每10分钟检查一次
done

# 终端2: 监控日志
tail -f logs/app.log

# 终端3: 监控延迟
grep "URL collected in" logs/app.log | tail -20
```

### 手动性能验证

#### 1. 内存使用检查

```bash
# 获取进程ID
PID=$(pgrep -f "employee-client" | head -1)

# 检查初始内存
ps -o rss= -p $PID | awk '{printf "%.2f MB\n", $1/1024}'

# 等待一段时间后再次检查
sleep 3600  # 1小时
ps -o rss= -p $PID | awk '{printf "%.2f MB\n", $1/1024}'
```

#### 2. 延迟分析

```bash
# 提取最近100次采集的延迟
grep "URL collected in" logs/app.log | \
  tail -100 | \
  grep -oE "[0-9]+ms" | \
  sed 's/ms//' | \
  sort -n > /tmp/latency.txt

# 计算P50（中位数）
awk 'BEGIN{c=0} {total[c]=$1; c++;} END{print "P50: " total[int(c*0.5)-1] "ms"}' /tmp/latency.txt

# 计算P95
awk 'BEGIN{c=0} {total[c]=$1; c++;} END{print "P95: " total[int(c*0.95)-1] "ms"}' /tmp/latency.txt

# 计算P99
awk 'BEGIN{c=0} {total[c]=$1; c++;} END{print "P99: " total[int(c*0.99)-1] "ms"}' /tmp/latency.txt
```

#### 3. 错误率检查

```bash
# 统计成功和失败次数
echo "Successes: $(grep -c '✅ URL collected' logs/app.log)"
echo "Failures: $(grep -c '❌ URL collection failed' logs/app.log)"

# 成功率
TOTAL=$(grep -c 'Attempting URL collection' logs/app.log)
SUCCESS=$(grep -c '✅ URL collected' logs/app.log)
echo "Success Rate: $(echo "scale=2; $SUCCESS * 100 / $TOTAL" | bc)%"
```

### 性能测试验证清单

- [ ] 初始内存记录
- [ ] 8小时后内存增长 ≤ 50MB
- [ ] P50延迟 ≤ 60ms
- [ ] P95延迟 ≤ 250ms
- [ ] P99延迟 ≤ 1000ms
- [ ] 无应用崩溃
- [ ] 无内存泄漏迹象
- [ ] 日志文件大小合理（有轮转）
- [ ] CPU使用率稳定

---

## 结果分析

### 自动生成的测试报告

测试脚本会在 `doc/test-reports/` 目录生成详细报告：

```bash
# 查看最新的测试报告
ls -lt doc/test-reports/

# 报告类型:
# - browser-compatibility-report_YYYYMMDD_HHMMSS.md
# - privacy-protection-report_YYYYMMDD_HHMMSS.md
# - performance-report_YYYYMMDD_HHMMSS.md
```

### 报告解读

#### 1. 浏览器兼容性报告

**关键指标**:
- 成功次数 vs 目标次数
- 实际成功率 vs 目标成功率
- 失败迭代编号
- 失败原因分析

**合格标准**:
- Safari: ≥95% ✅
- Chrome/Edge/Brave: ≥85% ✅
- Firefox: ≥40% ✅

#### 2. 隐私保护报告

**关键指标**:
- 通过/失败/需人工验证的测试数
- 实际输出 vs 预期输出
- 敏感信息处理正确性

**合格标准**:
- 所有敏感参数被移除 ✅
- 敏感域名被REDACTED ✅
- 白名单参数被保留 ✅

#### 3. 性能报告

**关键指标**:
- 内存增长趋势
- 延迟百分位数
- 错误率统计
- 稳定性评估

**合格标准**:
- 内存增长 ≤ 50MB ✅
- P50 ≤ 60ms, P95 ≤ 250ms, P99 ≤ 1000ms ✅
- 无崩溃 ✅

### 手动验证步骤

除了自动报告，还应进行手动验证：

#### 1. 日志审查

```bash
# 查找错误和警告
grep -E "(ERROR|WARNING|FAIL)" logs/app.log

# 查找崩溃信息
grep -i "crash\|fatal\|panic" logs/app.log

# 查找异常的延迟
grep "URL collected in" logs/app.log | grep -E "[0-9]{4,}ms"  # >1000ms
```

#### 2. 系统日志检查

```bash
# macOS系统日志
log show --predicate 'process == "employee-client"' --last 1h

# 查找权限问题
log show --predicate 'eventMessage contains "Accessibility"' --last 1h
```

#### 3. 权限状态验证

```bash
# 验证辅助功能权限
osascript -e 'tell application "System Events" to get properties'

# 如果返回错误，说明权限未授予
```

---

## 故障排查

### 常见问题及解决方案

#### 问题1: 应用无法启动

**症状**: `pgrep -f "employee-client"` 无输出

**排查步骤**:
```bash
# 1. 检查Node.js版本
node --version  # 应该 ≥16.0.0

# 2. 检查依赖安装
cd employee-client
npm install

# 3. 查看启动错误
npm run dev 2>&1 | tee startup.log

# 4. 检查端口占用
lsof -i :3000  # API服务器端口
```

**解决方案**:
- 更新Node.js版本
- 重新安装依赖: `rm -rf node_modules && npm install`
- 检查配置文件: `common/config/`

---

#### 问题2: 权限不足

**症状**: 日志显示 "Permission denied" 或无法采集URL

**排查步骤**:
```bash
# 1. 检查辅助功能权限
osascript -e 'tell application "System Events" to get properties'

# 2. 查看系统日志
log show --predicate 'eventMessage contains "Accessibility"' --last 10m
```

**解决方案**:
1. 打开 **系统偏好设置** → **安全性与隐私** → **隐私** → **辅助功能**
2. 点击左下角锁图标解锁
3. 添加应用: `employee-client` 或 `Terminal.app`
4. 重启应用

---

#### 问题3: Firefox采集失败率高

**症状**: Firefox成功率 < 40%

**排查步骤**:
```bash
# 1. 检查Firefox日志
grep "Firefox" logs/app.log | grep -E "failed|error"

# 2. 查看fallback机制是否生效
grep "fallback" logs/app.log

# 3. 测试AppleScript
osascript -e 'tell application "Firefox" to get URL of active tab of front window'
```

**解决方案**:
- Firefox的低成功率是已知限制（AppleScript支持不完善）
- 确保fallback机制正常工作
- 考虑使用浏览器扩展替代方案（未来实现）

---

#### 问题4: 延迟过高

**症状**: P95 > 250ms 或 P99 > 1000ms

**排查步骤**:
```bash
# 1. 分析慢请求
grep "URL collected in [0-9]\{4,\}ms" logs/app.log

# 2. 检查系统负载
top -l 1 | head -10

# 3. 检查网络延迟
ping -c 5 google.com
```

**解决方案**:
- 关闭不必要的后台应用
- 检查网络连接
- 优化浏览器检测逻辑（开发任务）
- 增加缓存或减少重试次数

---

#### 问题5: 内存持续增长

**症状**: 内存增长 > 50MB/8小时

**排查步骤**:
```bash
# 1. 监控内存增长趋势
while true; do
  date
  ps aux | grep -i "employee.*client" | grep -v grep | awk '{print $6 " KB"}'
  sleep 600
done

# 2. 检查日志文件大小
ls -lh logs/app.log

# 3. 查找大对象或缓存
# （需要内存分析工具，如Node.js --inspect）
```

**解决方案**:
- 实现日志轮转
- 清理旧缓存
- 优化数据结构
- 使用内存分析工具定位泄漏点

---

#### 问题6: 隐私保护未生效

**症状**: 敏感信息未被正确过滤

**排查步骤**:
```bash
# 1. 检查隐私配置
cat common/config/privacy-config.ts

# 2. 查看日志中的原始URL
grep "Raw URL:" logs/app.log | tail -10

# 3. 验证sanitizeUrl函数
node -e "
const { sanitizeUrl } = require('./common/utils/privacy-helper');
console.log(sanitizeUrl('https://example.com?token=abc123'));
"
```

**解决方案**:
- 更新隐私配置
- 修复privacy-helper.ts逻辑
- 添加遗漏的敏感模式

---

### 调试技巧

#### 1. 详细日志输出

```bash
# 临时启用DEBUG日志级别
export LOG_LEVEL=debug
npm run dev

# 或在代码中修改日志级别
# common/utils/logger.ts
```

#### 2. 单步调试

```bash
# 使用Node.js调试器
node --inspect-brk dist/main/cli.js test:health

# 然后在Chrome中打开: chrome://inspect
```

#### 3. 性能分析

```bash
# 生成CPU profile
node --prof dist/main/cli.js

# 分析profile
node --prof-process isolate-*.log > profile.txt
```

---

## 附录

### A. 测试脚本快速参考

| 脚本 | 用途 | 预计时长 |
|------|------|----------|
| `browser-compatibility-test.sh` | 浏览器兼容性 | ~100分钟 |
| `privacy-protection-test.sh` | 隐私保护 | ~20分钟 |
| `performance-test.sh` | 性能稳定性 | 8小时+ |

### B. 关键文件路径

| 文件 | 说明 |
|------|------|
| `logs/app.log` | 应用日志 |
| `common/config/privacy-config.ts` | 隐私配置 |
| `common/utils/privacy-helper.ts` | 隐私过滤实现 |
| `platforms/darwin/url-collector.ts` | URL采集实现 |
| `platforms/macos/permission-checker.ts` | 权限检查 |
| `doc/test-reports/` | 测试报告目录 |

### C. 性能指标定义

| 指标 | 定义 | 目标值 |
|------|------|--------|
| P50 | 50%的请求响应时间 | ≤ 60ms |
| P95 | 95%的请求响应时间 | ≤ 250ms |
| P99 | 99%的请求响应时间 | ≤ 1000ms |
| 内存增长 | 8小时内存使用增量 | ≤ 50MB |
| 成功率 | 采集成功次数/总次数 | ≥ 85% (Firefox ≥40%) |

### D. 相关文档

- [部署指南](../../docs/deployment-guide.md)
- [故障排查手册](../../docs/troubleshooting.md)
- [API文档](../../docs/api-doc/)
- [隐私保护设计](../design/privacy-protection.md)

---

**文档版本**: 1.0.0
**最后更新**: 2025-11-03
**维护者**: Development Team
