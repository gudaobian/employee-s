#include "message_pump.h"
#include <iostream>

MessagePump::MessagePump() : isRunning(false), threadId(0) {
}

MessagePump::~MessagePump() {
    Stop();
}

bool MessagePump::Start() {
    if (isRunning) {
        return true;
    }

    try {
        isRunning = true;
        pumpThread = std::thread(&MessagePump::MessagePumpThread, this);

        // 等待线程启动完成
        while (threadId == 0 && isRunning) {
            Sleep(10);
        }

        return threadId != 0;
    } catch (const std::exception& e) {
        std::cerr << "Failed to start message pump thread: " << e.what() << std::endl;
        isRunning = false;
        return false;
    }
}

void MessagePump::Stop() {
    if (!isRunning) {
        return;
    }

    isRunning = false;

    // 向消息泵线程发送退出消息
    if (threadId != 0) {
        PostThreadMessage(threadId, WM_QUIT, 0, 0);
    }

    // 等待线程结束
    if (pumpThread.joinable()) {
        pumpThread.join();
    }

    threadId = 0;
}

bool MessagePump::IsRunning() const {
    return isRunning;
}

void MessagePump::MessagePumpThread() {
    // 保存线程ID
    threadId = GetCurrentThreadId();

    std::cout << "[MESSAGE_PUMP] ✅ Thread started with ID: " << threadId << std::endl;

    // 创建消息队列（调用PeekMessage会自动创建）
    MSG msg;
    PeekMessage(&msg, NULL, 0, 0, PM_NOREMOVE);

    std::cout << "[MESSAGE_PUMP] ✅ Message queue created, entering loop..." << std::endl;

    // 诊断计数器
    DWORD messageCount = 0;
    DWORD loopCount = 0;
    DWORD lastHeartbeat = GetTickCount();

    // 消息循环
    while (isRunning) {
        // 处理所有待处理的消息
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            if (msg.message == WM_QUIT) {
                std::cout << "[MESSAGE_PUMP] Received WM_QUIT, exiting..." << std::endl;
                isRunning = false;
                break;
            }

            messageCount++;

            // 转换和分发消息（这会触发Hook回调）
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        // 每5秒输出一次心跳日志
        loopCount++;
        DWORD currentTime = GetTickCount();
        if (currentTime - lastHeartbeat >= 5000) {
            std::cout << "[MESSAGE_PUMP] 💓 Heartbeat - Thread running (loops: " << loopCount
                      << ", messages: " << messageCount << ")" << std::endl;
            lastHeartbeat = currentTime;
        }

        // 短暂休眠以避免CPU占用过高
        // Hook消息会自动唤醒线程，所以休眠时间可以稍长
        Sleep(10);
    }

    std::cout << "[MESSAGE_PUMP] Thread exiting (processed " << messageCount << " messages)" << std::endl;
    threadId = 0;
}
