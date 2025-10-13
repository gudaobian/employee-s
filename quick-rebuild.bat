@echo off
echo ========================================
echo 快速重新编译并打包
echo ========================================
echo.

REM 检查 Node.js 版本
echo [检查] Node.js 版本...
node --version
echo.

REM 警告：必须使用 Node.js 18
for /f "tokens=1 delims=." %%v in ('node --version') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:~1%

if not "%NODE_MAJOR%"=="18" (
    echo ========================================
    echo ❌ 错误：当前 Node.js 版本不是 18.x
    echo.
    echo 当前版本:
    node --version
    echo.
    echo Electron 25 需要 Node.js 18.x
    echo.
    echo 请安装 Node.js 18 LTS:
    echo https://nodejs.org/dist/latest-v18.x/
    echo ========================================
    pause
    exit /b 1
)

echo ✅ Node.js 版本正确 (18.x)
echo.

REM 清理旧构建
echo [1/4] 清理旧构建...
if exist native-event-monitor-win\build rmdir /s /q native-event-monitor-win\build
if exist dist rmdir /s /q dist
if exist release rmdir /s /q release
echo.

REM 编译原生模块
echo [2/4] 编译原生模块...
cd native-event-monitor-win
call npm install
call npm run build
cd ..

if not exist native-event-monitor-win\build\Release\event_monitor.node (
    echo ❌ 原生模块编译失败
    pause
    exit /b 1
)
echo ✅ 原生模块编译成功
echo.

REM 编译 TypeScript
echo [3/4] 编译 TypeScript...
call npm run compile
echo.

REM 打包应用
echo [4/4] 打包应用...
call npm run pack:win
echo.

REM 检查输出
echo ========================================
if exist release\*.exe (
    echo ✅ 打包成功！
    echo.
    echo 安装包位置:
    dir /b release\*.exe
    echo.
    echo 下一步:
    echo 1. 卸载旧版本
    echo 2. 安装 release 目录中的新安装包
) else (
    echo ❌ 打包失败，未找到安装包
)
echo ========================================
pause
