#include <node.h>
#include <windows.h>
#include <iostream>
#include "keyboard_hook.h"
#include "mouse_hook.h"
#include "idle_detector.h"
#include "message_pump.h"
#include "active_window.h"
#include "hardware_id.h"

using namespace v8;

// 全局变量
static bool isMonitoring = false;
static MessagePump* messagePump = nullptr;
// 使用外部定义的变量和钩子句柄
extern DWORD keyboardCount;
extern DWORD mouseClickCount;
extern HHOOK keyboardHook;
extern HHOOK mouseHook;

// 安装Hook
bool InstallHooks() {
    if (isMonitoring) {
        return true;
    }

    // 首先启动消息泵（Hook需要消息循环）
    if (!messagePump) {
        messagePump = new MessagePump();
    }

    if (!messagePump->Start()) {
        std::cerr << "[HOOK] Failed to start message pump" << std::endl;
        delete messagePump;
        messagePump = nullptr;
        return false;
    }

    std::cout << "[HOOK] Message pump started successfully" << std::endl;

    // 使用专门的安装函数
    if (!InstallKeyboardHook()) {
        messagePump->Stop();
        delete messagePump;
        messagePump = nullptr;
        return false;
    }

    if (!InstallMouseHook()) {
        UninstallKeyboardHook();
        messagePump->Stop();
        delete messagePump;
        messagePump = nullptr;
        return false;
    }

    isMonitoring = true;
    std::cout << "[HOOK] All hooks installed successfully" << std::endl;
    return true;
}

// 卸载Hook
void UninstallHooks() {
    if (!isMonitoring) {
        return;
    }

    // 使用专门的卸载函数
    UninstallKeyboardHook();
    UninstallMouseHook();

    // 停止消息泵
    if (messagePump) {
        messagePump->Stop();
        delete messagePump;
        messagePump = nullptr;
        std::cout << "[HOOK] Message pump stopped" << std::endl;
    }

    isMonitoring = false;
}

// 启动监听
void Start(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    
    if (isMonitoring) {
        args.GetReturnValue().Set(Boolean::New(isolate, true));
        return;
    }
    
    bool success = InstallHooks();
    args.GetReturnValue().Set(Boolean::New(isolate, success));
}

// 停止监听
void Stop(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    
    UninstallHooks();
    args.GetReturnValue().Set(Boolean::New(isolate, true));
}

// 获取计数
void GetCounts(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    Local<Context> context = isolate->GetCurrentContext();

    Local<Object> result = Object::New(isolate);

    // 添加键盘计数
    result->Set(context,
        String::NewFromUtf8(isolate, "keyboard").ToLocalChecked(),
        Number::New(isolate, keyboardCount));

    // 添加鼠标点击计数
    result->Set(context,
        String::NewFromUtf8(isolate, "mouseClicks").ToLocalChecked(),
        Number::New(isolate, mouseClickCount));

    // 添加系统空闲时间
    DWORD idleTime = GetSystemIdleTime();
    result->Set(context,
        String::NewFromUtf8(isolate, "idleTime").ToLocalChecked(),
        Number::New(isolate, idleTime));

    // 添加监听状态
    result->Set(context,
        String::NewFromUtf8(isolate, "isMonitoring").ToLocalChecked(),
        Boolean::New(isolate, isMonitoring));

    // 添加Hook句柄状态（用于诊断）
    result->Set(context,
        String::NewFromUtf8(isolate, "keyboardHookInstalled").ToLocalChecked(),
        Boolean::New(isolate, keyboardHook != NULL));

    result->Set(context,
        String::NewFromUtf8(isolate, "mouseHookInstalled").ToLocalChecked(),
        Boolean::New(isolate, mouseHook != NULL));

    result->Set(context,
        String::NewFromUtf8(isolate, "messagePumpRunning").ToLocalChecked(),
        Boolean::New(isolate, messagePump != nullptr && messagePump->IsRunning()));

    // 诊断日志
    static DWORD lastLogTime = 0;
    DWORD currentTime = GetTickCount();
    if (currentTime - lastLogTime >= 10000) { // 每10秒记录一次
        std::cout << "[EVENT_MONITOR] Status - Keyboard: " << keyboardCount
                  << ", Mouse: " << mouseClickCount
                  << ", Monitoring: " << (isMonitoring ? "YES" : "NO")
                  << ", Hooks: " << (keyboardHook != NULL ? "✅" : "❌")
                  << "/" << (mouseHook != NULL ? "✅" : "❌")
                  << ", MessagePump: " << (messagePump && messagePump->IsRunning() ? "✅" : "❌")
                  << std::endl;
        lastLogTime = currentTime;
    }

    args.GetReturnValue().Set(result);
}

// 重置计数
void ResetCounts(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    
    keyboardCount = 0;
    mouseClickCount = 0;
    
    args.GetReturnValue().Set(Boolean::New(isolate, true));
}

// 检查是否正在监听
void IsMonitoring(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    args.GetReturnValue().Set(Boolean::New(isolate, isMonitoring));
}

// 获取活动窗口信息
void GetActiveWindow(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    Local<Context> context = isolate->GetCurrentContext();

    ActiveWindowInfo windowInfo = GetActiveWindowInfo();

    Local<Object> result = Object::New(isolate);

    if (windowInfo.isValid) {
        // 转换宽字符串为UTF-8
        int titleLen = WideCharToMultiByte(CP_UTF8, 0, windowInfo.title.c_str(), -1, NULL, 0, NULL, NULL);
        std::string titleUtf8(titleLen, 0);
        WideCharToMultiByte(CP_UTF8, 0, windowInfo.title.c_str(), -1, &titleUtf8[0], titleLen, NULL, NULL);
        titleUtf8.resize(titleLen - 1); // 移除null终止符

        int processNameLen = WideCharToMultiByte(CP_UTF8, 0, windowInfo.processName.c_str(), -1, NULL, 0, NULL, NULL);
        std::string processNameUtf8(processNameLen, 0);
        WideCharToMultiByte(CP_UTF8, 0, windowInfo.processName.c_str(), -1, &processNameUtf8[0], processNameLen, NULL, NULL);
        processNameUtf8.resize(processNameLen - 1);

        result->Set(context,
            String::NewFromUtf8(isolate, "title").ToLocalChecked(),
            String::NewFromUtf8(isolate, titleUtf8.c_str()).ToLocalChecked());

        result->Set(context,
            String::NewFromUtf8(isolate, "application").ToLocalChecked(),
            String::NewFromUtf8(isolate, processNameUtf8.c_str()).ToLocalChecked());

        result->Set(context,
            String::NewFromUtf8(isolate, "pid").ToLocalChecked(),
            Number::New(isolate, windowInfo.processId));

        result->Set(context,
            String::NewFromUtf8(isolate, "isValid").ToLocalChecked(),
            Boolean::New(isolate, true));
    } else {
        result->Set(context,
            String::NewFromUtf8(isolate, "isValid").ToLocalChecked(),
            Boolean::New(isolate, false));
    }

    args.GetReturnValue().Set(result);
}

// 获取CPU ProcessorID
void GetCPUId(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    try {
        std::string cpuId = HardwareID::GetCPUProcessorID();
        args.GetReturnValue().Set(String::NewFromUtf8(isolate, cpuId.c_str()).ToLocalChecked());
    } catch (const std::exception& e) {
        isolate->ThrowException(Exception::Error(
            String::NewFromUtf8(isolate, e.what()).ToLocalChecked()));
    }
}

// 获取主板序列号
void GetBaseboardSerial(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();

    try {
        std::string serial = HardwareID::GetBaseboardSerial();
        args.GetReturnValue().Set(String::NewFromUtf8(isolate, serial.c_str()).ToLocalChecked());
    } catch (const std::exception& e) {
        isolate->ThrowException(Exception::Error(
            String::NewFromUtf8(isolate, e.what()).ToLocalChecked()));
    }
}

// 获取所有硬件信息 - v3.0 仅返回主板UUID
void GetHardwareInfo(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    Local<Context> context = isolate->GetCurrentContext();

    try {
        HardwareID::HardwareInfo info = HardwareID::GetAllHardwareInfo();

        Local<Object> result = Object::New(isolate);
        result->Set(context,
            String::NewFromUtf8(isolate, "uuid").ToLocalChecked(),
            String::NewFromUtf8(isolate, info.uuid.c_str()).ToLocalChecked());
        result->Set(context,
            String::NewFromUtf8(isolate, "success").ToLocalChecked(),
            Boolean::New(isolate, true));

        args.GetReturnValue().Set(result);
    } catch (const std::exception& e) {
        Local<Object> result = Object::New(isolate);
        result->Set(context,
            String::NewFromUtf8(isolate, "success").ToLocalChecked(),
            Boolean::New(isolate, false));
        result->Set(context,
            String::NewFromUtf8(isolate, "error").ToLocalChecked(),
            String::NewFromUtf8(isolate, e.what()).ToLocalChecked());

        args.GetReturnValue().Set(result);
    }
}

// 初始化模块
void InitAll(Local<Object> exports, Local<Value> module, Local<Context> context, void* priv) {
    NODE_SET_METHOD(exports, "start", Start);
    NODE_SET_METHOD(exports, "stop", Stop);
    NODE_SET_METHOD(exports, "getCounts", GetCounts);
    NODE_SET_METHOD(exports, "resetCounts", ResetCounts);
    NODE_SET_METHOD(exports, "isMonitoring", IsMonitoring);
    NODE_SET_METHOD(exports, "getActiveWindow", GetActiveWindow);

    // 硬件ID获取函数
    NODE_SET_METHOD(exports, "getCPUId", GetCPUId);
    NODE_SET_METHOD(exports, "getBaseboardSerial", GetBaseboardSerial);
    NODE_SET_METHOD(exports, "getHardwareInfo", GetHardwareInfo);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, InitAll)