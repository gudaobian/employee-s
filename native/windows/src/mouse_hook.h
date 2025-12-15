#ifndef MOUSE_HOOK_H
#define MOUSE_HOOK_H

#include <windows.h>

// 鼠标Hook相关函数声明
extern DWORD mouseClickCount;
extern DWORD mouseScrollCount; // 鼠标滚轮滚动计数
extern HHOOK mouseHook;

// 鼠标Hook回调函数
LRESULT CALLBACK MouseProc(int nCode, WPARAM wParam, LPARAM lParam);

// 安装和卸载鼠标Hook
bool InstallMouseHook();
void UninstallMouseHook();

#endif // MOUSE_HOOK_H