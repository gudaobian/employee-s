@echo off
echo ========================================
echo 重新编译 Windows 原生模块
echo ========================================
echo.

REM 检查环境
echo [1/5] 检查环境...
node --version
npm --version
echo.

REM 进入原生模块目录
echo [2/5] 进入原生模块目录...
cd native-event-monitor-win
echo.

REM 清理旧的构建
echo [3/5] 清理旧的构建...
if exist build rmdir /s /q build
if exist node_modules rmdir /s /q node_modules
echo.

REM 安装依赖
echo [4/5] 安装依赖...
call npm install
echo.

REM 编译原生模块
echo [5/5] 编译原生模块...
call npm run build
echo.

REM 验证编译结果
echo ========================================
echo 验证编译结果
echo ========================================
if exist build\Release\event_monitor.node (
    echo ✅ Release 版本编译成功
    dir build\Release\event_monitor.node
) else if exist build\Debug\event_monitor.node (
    echo ✅ Debug 版本编译成功
    dir build\Debug\event_monitor.node
) else (
    echo ❌ 编译失败，未找到 .node 文件
    pause
    exit /b 1
)

echo.
echo ========================================
echo 编译完成！
echo ========================================
echo.
echo 现在可以运行以下命令打包应用：
echo   npm run pack:win
echo.
pause
