/**
 * X11 XRecord Backend Header
 *
 * Event monitoring backend using X11 XRecord extension.
 * Fallback option when libinput is not available.
 *
 * Advantages:
 * - No special permissions required
 * - Works with standard X11 sessions
 *
 * Limitations:
 * - X11 only (not Wayland compatible)
 * - Higher latency than libinput
 * - May miss some events in certain configurations
 *
 * Requirements:
 * - X11 display server
 * - libX11, libXtst, libXi
 */

#ifndef X11_BACKEND_H
#define X11_BACKEND_H

#include "event_monitor.h"
#include <atomic>
#include <thread>
#include <mutex>

// Forward declarations for X11 types
typedef struct _XDisplay Display;
typedef unsigned long XRecordContext;

/**
 * X11 XRecord-based event monitoring backend
 */
class X11Backend : public IEventBackend {
public:
    X11Backend();
    ~X11Backend() override;

    // IEventBackend interface implementation
    bool start() override;
    bool stop() override;
    bool isRunning() const override;
    BackendType getType() const override { return BackendType::X11; }
    std::string getName() const override { return "x11"; }

    // Event counts
    uint64_t getKeyboardCount() const override;
    uint64_t getMouseCount() const override;
    uint64_t getScrollCount() const override;
    void resetCounts() override;

    /**
     * Check if X11 backend is available on this system
     */
    static bool isAvailable();

private:
    // Event processing
    void monitorThread();
    static void recordCallback(void* closure, void* data);
    void handleRecordData(void* data);

    // X11 context management
    bool initializeX11();
    void cleanupX11();

    // State
    std::atomic<bool> m_running{false};
    std::thread m_thread;

    // X11 handles
    Display* m_dataDisplay{nullptr};
    Display* m_controlDisplay{nullptr};
    XRecordContext m_recordContext{0};

    // Event counters (atomic for thread safety)
    std::atomic<uint64_t> m_keyboardCount{0};
    std::atomic<uint64_t> m_mouseCount{0};
    std::atomic<uint64_t> m_scrollCount{0};

    // Synchronization
    mutable std::mutex m_mutex;
};

#endif // X11_BACKEND_H
