#ifndef IDLE_DETECTOR_H
#define IDLE_DETECTOR_H

#include <windows.h>

// 系统空闲时间检测函数
DWORD GetSystemIdleTime();

// 获取最后输入时间
DWORD GetLastInputTime();

// 重置空闲时间计数器
void ResetIdleTimer();

#endif // IDLE_DETECTOR_H