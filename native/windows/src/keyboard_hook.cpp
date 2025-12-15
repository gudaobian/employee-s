#include "keyboard_hook.h"
#include <iostream>

// 全局变量定义
DWORD keyboardCount = 0;
HHOOK keyboardHook = NULL;

// 键盘Hook回调函数实现
LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        // 只计算按键按下事件，避免重复计数
        if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
            keyboardCount++;

            // 诊断日志：每10次按键记录一次
            if (keyboardCount % 10 == 0) {
                std::cout << "[KEYBOARD_HOOK] ✅ Callback working - Count: " << keyboardCount << std::endl;
            }
        }
    }

    // 继续传递消息给下一个Hook
    return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
}

// 安装键盘Hook
bool InstallKeyboardHook() {
    if (keyboardHook != NULL) {
        std::cout << "[KEYBOARD_HOOK] ⚠️ Already installed" << std::endl;
        return true; // 已经安装
    }

    std::cout << "[KEYBOARD_HOOK] Installing keyboard hook..." << std::endl;

    keyboardHook = SetWindowsHookEx(
        WH_KEYBOARD_LL,      // Hook类型：低级键盘Hook
        KeyboardProc,        // Hook回调函数
        GetModuleHandle(NULL), // 当前模块句柄
        0                    // 全局Hook
    );

    if (keyboardHook == NULL) {
        DWORD error = GetLastError();
        std::cerr << "[KEYBOARD_HOOK] ❌ Failed to install. Error code: " << error << std::endl;

        // 常见错误码说明
        if (error == 1428) { // ERROR_HOOK_NEEDS_HMOD
            std::cerr << "[KEYBOARD_HOOK] Error 1428: Administrator privileges may be required" << std::endl;
        } else if (error == 5) { // ERROR_ACCESS_DENIED
            std::cerr << "[KEYBOARD_HOOK] Error 5: Access denied - Run as administrator" << std::endl;
        }

        return false;
    }

    std::cout << "[KEYBOARD_HOOK] ✅ Successfully installed (handle: " << keyboardHook << ")" << std::endl;
    return true;
}

// 卸载键盘Hook
void UninstallKeyboardHook() {
    if (keyboardHook != NULL) {
        if (UnhookWindowsHookEx(keyboardHook)) {
            keyboardHook = NULL;
        } else {
            DWORD error = GetLastError();
            std::cerr << "Failed to uninstall keyboard hook. Error code: " << error << std::endl;
        }
    }
}