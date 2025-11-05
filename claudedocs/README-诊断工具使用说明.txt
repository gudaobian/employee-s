================================================================
Employee Safety 版本诊断工具使用说明
================================================================

文件位置：
  claudedocs/verify-installed-version.ps1

用途：
  检查当前安装的Employee Safety应用程序版本
  验证是否包含URL采集功能（getActiveURL方法）

================================================================
使用方法
================================================================

方法1：PowerShell执行（推荐）
-------------------------------
1. 打开PowerShell（以管理员身份运行）
   - 按Win键，输入"PowerShell"
   - 右键 -> "以管理员身份运行"

2. 进入脚本所在目录：
   cd C:\path\to\employee-client\claudedocs

3. 允许脚本执行（如果首次运行）：
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

4. 运行脚本：
   .\verify-installed-version.ps1

方法2：直接右键运行
-------------------------------
1. 找到文件：
   claudedocs\verify-installed-version.ps1

2. 右键点击文件

3. 选择"使用PowerShell运行"

如果看到执行策略错误：
  运行以下命令后再试：
  powershell -ExecutionPolicy Bypass -File .\verify-installed-version.ps1

================================================================
诊断结果说明
================================================================

[OK] - 正常，功能可用
[WARNING] - 警告，版本可能过旧
[ERROR] - 错误，功能不可用或文件缺失

关键检查项：
1. WindowsAdapter VERSION
   - 期望：包含 "with-url-collection" 或 "1.0.78" 或更高版本
   - 如果是 "UNKNOWN" 或未找到 -> 版本太旧

2. getActiveURL method
   - 期望：EXISTS（存在）
   - 如果 NOT FOUND（未找到）-> URL采集功能不可用

================================================================
如果诊断失败（getActiveURL方法不存在）
================================================================

立即解决步骤：

步骤1：完全卸载
--------------
1. 停止所有Employee Safety进程：
   - 按 Ctrl+Shift+Esc 打开任务管理器
   - 找到 "EmployeeSafety.exe"
   - 右键 -> 结束任务

2. 卸载应用程序：
   - 设置 -> 应用 -> 已安装的应用
   - 找到 "Employee Safety"
   - 点击 -> 卸载

3. 清理残留文件：
   打开PowerShell（管理员），运行：

   Remove-Item "$env:LOCALAPPDATA\Programs\EmployeeSafety" -Recurse -Force -ErrorAction SilentlyContinue
   Remove-Item "$env:APPDATA\employee-monitor" -Recurse -Force -ErrorAction SilentlyContinue

4. 清理注册表：
   reg delete "HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run" /v EmployeeSafety /f

步骤2：重启计算机
--------------
重启以清除所有系统缓存

步骤3：下载最新版本
--------------
1. 访问GitHub releases页面：
   https://github.com/zhangxiaoyu2000/employee-s/releases/latest

2. 确认版本号：
   - 应该是 v1.0.81 或更高
   - 检查发布时间（应该是2025-11-04或更晚）

3. 下载文件：
   - 文件名：EmployeeSafety-Setup-1.0.81.exe
   - 大小：约50-100MB

步骤4：重新安装
--------------
1. 右键点击安装包
2. 选择"以管理员身份运行"
3. 安装到默认位置
4. 完成后启动应用

步骤5：再次运行诊断
--------------
再次运行 verify-installed-version.ps1
应该看到：
  [OK] WindowsAdapter VERSION: 1.0.78-with-url-collection
  [OK] getActiveURL method EXISTS

================================================================
常见问题
================================================================

Q: 脚本显示 "asar tool not installed"
A: 脚本会自动安装asar工具，如果失败请手动运行：
   npm install -g asar

Q: 脚本显示 "Application not found"
A: Employee Safety未安装或安装路径不正确
   默认路径：C:\Users\你的用户名\AppData\Local\Programs\EmployeeSafety

Q: 诊断显示版本正确但应用仍报错
A: 可能是应用缓存问题：
   1. 完全关闭应用（任务管理器确认）
   2. 删除：%APPDATA%\employee-monitor\
   3. 重新启动应用

Q: 无法运行PowerShell脚本（执行策略错误）
A: 以管理员身份运行PowerShell，执行：
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   然后再运行脚本

================================================================
获取帮助
================================================================

如果问题仍然存在，请提供以下信息：
1. 诊断脚本的完整输出
2. 应用日志文件路径：
   %APPDATA%\employee-monitor\logs\
3. Windows版本：
   运行：winver

提交Issue：
https://github.com/zhangxiaoyu2000/employee-s/issues

================================================================
