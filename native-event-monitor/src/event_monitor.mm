#include <node.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ApplicationServices/ApplicationServices.h>

using namespace v8;

// 全局变量
static CFMachPortRef eventTap = nullptr;
static CFRunLoopSourceRef runLoopSource = nullptr;
static bool isMonitoring = false;
static int keyboardCount = 0;
static int mouseCount = 0;

// 事件回调函数
CGEventRef EventCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void* refcon) {
    switch (type) {
        case kCGEventKeyDown:
        case kCGEventKeyUp:
            keyboardCount++;
            break;
            
        case kCGEventLeftMouseDown:
        case kCGEventRightMouseDown:
        case kCGEventOtherMouseDown:
            mouseCount++;
            break;
            
        default:
            break;
    }
    
    return event;
}

// 启动监听
void Start(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    
    if (isMonitoring) {
        args.GetReturnValue().Set(v8::Boolean::New(isolate, true));
        return;
    }
    
    // 检查辅助功能权限
    if (!AXIsProcessTrusted()) {
        // 提示用户授权
        CFStringRef keys[] = { kAXTrustedCheckOptionPrompt };
        CFBooleanRef values[] = { kCFBooleanTrue };
        CFDictionaryRef options = CFDictionaryCreate(NULL, 
                                                   (const void**)keys, 
                                                   (const void**)values, 
                                                   1, 
                                                   &kCFTypeDictionaryKeyCallBacks, 
                                                   &kCFTypeDictionaryValueCallBacks);
        AXIsProcessTrustedWithOptions(options);
        CFRelease(options);
        
        args.GetReturnValue().Set(v8::Boolean::New(isolate, false));
        return;
    }
    
    // 创建事件监听
    CGEventMask eventMask = (
        CGEventMaskBit(kCGEventKeyDown) | 
        CGEventMaskBit(kCGEventKeyUp) |
        CGEventMaskBit(kCGEventLeftMouseDown) |
        CGEventMaskBit(kCGEventRightMouseDown) |
        CGEventMaskBit(kCGEventOtherMouseDown)
    );
    
    eventTap = CGEventTapCreate(
        kCGSessionEventTap,
        kCGHeadInsertEventTap,
        kCGEventTapOptionListenOnly,
        eventMask,
        EventCallback,
        NULL
    );
    
    if (!eventTap) {
        args.GetReturnValue().Set(v8::Boolean::New(isolate, false));
        return;
    }
    
    runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
    CGEventTapEnable(eventTap, true);
    
    isMonitoring = true;
    args.GetReturnValue().Set(v8::Boolean::New(isolate, true));
}

// 停止监听
void Stop(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    
    if (!isMonitoring) {
        args.GetReturnValue().Set(v8::Boolean::New(isolate, true));
        return;
    }
    
    if (eventTap) {
        CGEventTapEnable(eventTap, false);
        CFRelease(eventTap);
        eventTap = nullptr;
    }
    
    if (runLoopSource) {
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
        CFRelease(runLoopSource);
        runLoopSource = nullptr;
    }
    
    isMonitoring = false;
    args.GetReturnValue().Set(v8::Boolean::New(isolate, true));
}

// 获取计数
void GetCounts(const FunctionCallbackInfo<Value>& args) {
    Isolate* isolate = args.GetIsolate();
    Local<Context> context = isolate->GetCurrentContext();
    
    Local<Object> result = Object::New(isolate);
    (void)result->Set(context, 
                String::NewFromUtf8(isolate, "keyboard").ToLocalChecked(), 
                Number::New(isolate, keyboardCount));
    (void)result->Set(context, 
                String::NewFromUtf8(isolate, "mouse").ToLocalChecked(), 
                Number::New(isolate, mouseCount));
    (void)result->Set(context, 
                String::NewFromUtf8(isolate, "isMonitoring").ToLocalChecked(), 
                v8::Boolean::New(isolate, isMonitoring));
    
    args.GetReturnValue().Set(result);
}

// 重置计数
void ResetCounts(const FunctionCallbackInfo<Value>& args) {
    keyboardCount = 0;
    mouseCount = 0;
    args.GetReturnValue().Set(v8::Boolean::New(args.GetIsolate(), true));
}

// 初始化模块
void InitAll(Local<Object> exports, Local<Value> module, Local<Context> context, void* priv) {
    NODE_SET_METHOD(exports, "start", Start);
    NODE_SET_METHOD(exports, "stop", Stop);
    NODE_SET_METHOD(exports, "getCounts", GetCounts);
    NODE_SET_METHOD(exports, "resetCounts", ResetCounts);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, InitAll)