#include "mouse_hook.h"
#include <iostream>

// 全局变量定义
DWORD mouseClickCount = 0;
DWORD mouseScrollCount = 0; // 鼠标滚轮滚动计数
HHOOK mouseHook = NULL;

// 鼠标Hook回调函数实现
LRESULT CALLBACK MouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        // 只计算鼠标按下事件，不包括移动事件
        switch (wParam) {
            case WM_LBUTTONDOWN:
            case WM_RBUTTONDOWN:
            case WM_MBUTTONDOWN:
                mouseClickCount++;

                // 诊断日志：每10次点击记录一次
                if (mouseClickCount % 10 == 0) {
                    std::cout << "[MOUSE_HOOK] ✅ Callback working - Clicks: " << mouseClickCount << std::endl;
                }
                break;

            case WM_MOUSEWHEEL:
                // 鼠标滚轮滚动事件
                mouseScrollCount++;

                // 诊断日志：每10次滚动记录一次
                if (mouseScrollCount % 10 == 0) {
                    std::cout << "[MOUSE_HOOK] ✅ Scroll detected - Scrolls: " << mouseScrollCount << std::endl;
                }
                break;

            // 注意：不监听鼠标移动事件以避免过多的事件触发
            // case WM_MOUSEMOVE:
            //     break;
        }
    }

    // 继续传递消息给下一个Hook
    return CallNextHookEx(mouseHook, nCode, wParam, lParam);
}

// 安装鼠标Hook
bool InstallMouseHook() {
    if (mouseHook != NULL) {
        std::cout << "[MOUSE_HOOK] ⚠️ Already installed" << std::endl;
        return true; // 已经安装
    }

    std::cout << "[MOUSE_HOOK] Installing mouse hook..." << std::endl;

    mouseHook = SetWindowsHookEx(
        WH_MOUSE_LL,         // Hook类型：低级鼠标Hook
        MouseProc,           // Hook回调函数
        GetModuleHandle(NULL), // 当前模块句柄
        0                    // 全局Hook
    );

    if (mouseHook == NULL) {
        DWORD error = GetLastError();
        std::cerr << "[MOUSE_HOOK] ❌ Failed to install. Error code: " << error << std::endl;

        // 常见错误码说明
        if (error == 1428) { // ERROR_HOOK_NEEDS_HMOD
            std::cerr << "[MOUSE_HOOK] Error 1428: Administrator privileges may be required" << std::endl;
        } else if (error == 5) { // ERROR_ACCESS_DENIED
            std::cerr << "[MOUSE_HOOK] Error 5: Access denied - Run as administrator" << std::endl;
        }

        return false;
    }

    std::cout << "[MOUSE_HOOK] ✅ Successfully installed (handle: " << mouseHook << ")" << std::endl;
    return true;
}

// 卸载鼠标Hook
void UninstallMouseHook() {
    if (mouseHook != NULL) {
        if (UnhookWindowsHookEx(mouseHook)) {
            mouseHook = NULL;
        } else {
            DWORD error = GetLastError();
            std::cerr << "Failed to uninstall mouse hook. Error code: " << error << std::endl;
        }
    }
}