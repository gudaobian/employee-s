/**
 * libinput Backend Header
 *
 * Event monitoring backend using libinput library.
 * Provides direct access to input devices, requires 'input' group membership.
 *
 * Advantages:
 * - Works on both X11 and Wayland
 * - Lower latency, direct kernel access
 * - More reliable event capture
 *
 * Requirements:
 * - libinput library installed
 * - User must be in 'input' group or run as root
 * - libudev for device enumeration
 */

#ifndef LIBINPUT_BACKEND_H
#define LIBINPUT_BACKEND_H

#include "event_monitor.h"
#include <atomic>
#include <thread>
#include <mutex>

// Forward declarations for libinput types
struct libinput;
struct libinput_device;
struct udev;

/**
 * libinput-based event monitoring backend
 */
class LibinputBackend : public IEventBackend {
public:
    LibinputBackend();
    ~LibinputBackend() override;

    // IEventBackend interface implementation
    bool start() override;
    bool stop() override;
    bool isRunning() const override;
    BackendType getType() const override { return BackendType::LIBINPUT; }
    std::string getName() const override { return "libinput"; }

    // Event counts
    uint64_t getKeyboardCount() const override;
    uint64_t getMouseCount() const override;
    uint64_t getScrollCount() const override;
    void resetCounts() override;

    /**
     * Check if libinput backend is available on this system
     */
    static bool isAvailable();

    // libinput interface callbacks (must be public for struct initialization)
    static int openRestricted(const char* path, int flags, void* userData);
    static void closeRestricted(int fd, void* userData);

private:
    // Event processing
    void monitorThread();
    void processEvents();
    void handleKeyboardEvent(struct libinput_event* event);
    void handlePointerEvent(struct libinput_event* event);

    // libinput context management
    bool initializeLibinput();
    void cleanupLibinput();

    // State
    std::atomic<bool> m_running{false};
    std::thread m_thread;

    // libinput handles
    struct libinput* m_libinput{nullptr};
    struct udev* m_udev{nullptr};
    int m_epollFd{-1};

    // Event counters (atomic for thread safety)
    std::atomic<uint64_t> m_keyboardCount{0};
    std::atomic<uint64_t> m_mouseCount{0};
    std::atomic<uint64_t> m_scrollCount{0};

    // Synchronization
    mutable std::mutex m_mutex;
};

#endif // LIBINPUT_BACKEND_H
