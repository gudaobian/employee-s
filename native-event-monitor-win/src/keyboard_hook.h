#ifndef KEYBOARD_HOOK_H
#define KEYBOARD_HOOK_H

#include <windows.h>

// 键盘Hook相关函数声明
extern DWORD keyboardCount;
extern HHOOK keyboardHook;

// 键盘Hook回调函数
LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam);

// 安装和卸载键盘Hook
bool InstallKeyboardHook();
void UninstallKeyboardHook();

#endif // KEYBOARD_HOOK_H