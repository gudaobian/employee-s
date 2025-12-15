#include "idle_detector.h"
#include <iostream>

// 获取系统空闲时间（毫秒）
DWORD GetSystemIdleTime() {
    LASTINPUTINFO lastInputInfo;
    lastInputInfo.cbSize = sizeof(LASTINPUTINFO);
    
    if (GetLastInputInfo(&lastInputInfo)) {
        DWORD currentTime = GetTickCount();
        DWORD idleTime = currentTime - lastInputInfo.dwTime;
        
        return idleTime;
    } else {
        DWORD error = GetLastError();
        std::cerr << "Failed to get last input info. Error code: " << error << std::endl;
        return 0;
    }
}

// 获取最后输入时间戳
DWORD GetLastInputTime() {
    LASTINPUTINFO lastInputInfo;
    lastInputInfo.cbSize = sizeof(LASTINPUTINFO);
    
    if (GetLastInputInfo(&lastInputInfo)) {
        return lastInputInfo.dwTime;
    } else {
        DWORD error = GetLastError();
        std::cerr << "Failed to get last input info. Error code: " << error << std::endl;
        return GetTickCount(); // 返回当前时间作为默认值
    }
}

// 重置空闲时间计数器（通过模拟一个无害的输入事件）
void ResetIdleTimer() {
    // 注意：这个函数会重置系统的空闲计时器
    // 在实际应用中需要谨慎使用
    
    // 获取当前鼠标位置
    POINT currentPos;
    GetCursorPos(&currentPos);
    
    // 模拟一个微小的鼠标移动（移动1像素然后移回原位）
    SetCursorPos(currentPos.x + 1, currentPos.y);
    SetCursorPos(currentPos.x, currentPos.y);
    
    // 或者使用更直接的方法：
    // keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0);
}