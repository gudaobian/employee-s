#include "active_window.h"
#include <tlhelp32.h>
#include <psapi.h>
#include <iostream>
#include <vector>

#pragma comment(lib, "psapi.lib")

// 获取进程名称（通过进程ID）
std::wstring GetProcessNameById(DWORD processId) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processId);
    if (hProcess == NULL) {
        return L"Unknown";
    }

    WCHAR processName[MAX_PATH] = L"<unknown>";
    HMODULE hMod;
    DWORD cbNeeded;

    if (EnumProcessModules(hProcess, &hMod, sizeof(hMod), &cbNeeded)) {
        GetModuleBaseNameW(hProcess, hMod, processName, sizeof(processName) / sizeof(WCHAR));
    }

    CloseHandle(hProcess);
    return std::wstring(processName);
}

// 获取活动窗口信息
ActiveWindowInfo GetActiveWindowInfo() {
    ActiveWindowInfo info;
    info.isValid = false;
    info.processId = 0;

    try {
        // 获取前台窗口句柄
        HWND hwnd = GetForegroundWindow();
        if (hwnd == NULL) {
            std::cerr << "[ACTIVE_WINDOW] GetForegroundWindow returned NULL" << std::endl;
            return info;
        }

        // 获取窗口标题
        int titleLength = GetWindowTextLengthW(hwnd);
        if (titleLength > 0) {
            std::vector<WCHAR> titleBuffer(titleLength + 1);
            if (GetWindowTextW(hwnd, titleBuffer.data(), titleLength + 1) > 0) {
                info.title = titleBuffer.data();
            }
        }

        // 如果没有标题，设置默认值
        if (info.title.empty()) {
            info.title = L"No Title";
        }

        // 获取窗口所属进程ID
        DWORD processId = 0;
        GetWindowThreadProcessId(hwnd, &processId);
        info.processId = processId;

        if (processId == 0) {
            std::cerr << "[ACTIVE_WINDOW] GetWindowThreadProcessId returned 0" << std::endl;
            return info;
        }

        // 获取进程名称
        info.processName = GetProcessNameById(processId);

        // 特殊处理UWP应用（ApplicationFrameHost）
        if (info.processName == L"ApplicationFrameHost.exe") {
            // 尝试查找真实的UWP应用窗口
            HWND childWindow = FindWindowExW(hwnd, NULL, L"Windows.UI.Core.CoreWindow", NULL);
            if (childWindow != NULL) {
                DWORD childProcessId = 0;
                GetWindowThreadProcessId(childWindow, &childProcessId);

                if (childProcessId != 0 && childProcessId != processId) {
                    std::wstring uwpProcessName = GetProcessNameById(childProcessId);
                    if (!uwpProcessName.empty() && uwpProcessName != L"Unknown") {
                        info.processName = uwpProcessName;
                        info.processId = childProcessId;
                    }
                }
            }
        }

        info.isValid = true;

    } catch (const std::exception& e) {
        std::cerr << "[ACTIVE_WINDOW] Exception: " << e.what() << std::endl;
    } catch (...) {
        std::cerr << "[ACTIVE_WINDOW] Unknown exception" << std::endl;
    }

    return info;
}
