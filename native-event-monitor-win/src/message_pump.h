#ifndef MESSAGE_PUMP_H
#define MESSAGE_PUMP_H

#include <windows.h>
#include <thread>
#include <atomic>

/**
 * Windows消息泵线程
 * Hook需要消息循环才能接收事件，此类提供独立的消息处理线程
 */
class MessagePump {
public:
    MessagePump();
    ~MessagePump();

    // 启动消息泵
    bool Start();

    // 停止消息泵
    void Stop();

    // 检查是否正在运行
    bool IsRunning() const;

private:
    // 消息泵线程函数
    void MessagePumpThread();

    // 线程对象
    std::thread pumpThread;

    // 运行状态标志
    std::atomic<bool> isRunning;

    // 线程ID（用于PostThreadMessage）
    DWORD threadId;
};

#endif // MESSAGE_PUMP_H
