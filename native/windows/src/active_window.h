#ifndef ACTIVE_WINDOW_H
#define ACTIVE_WINDOW_H

#include <windows.h>
#include <string>

struct ActiveWindowInfo {
    std::wstring title;
    std::wstring processName;
    DWORD processId;
    bool isValid;
};

// 获取当前活动窗口信息
ActiveWindowInfo GetActiveWindowInfo();

#endif // ACTIVE_WINDOW_H
