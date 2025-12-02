/**
 * Linux Event Monitor - Main Header
 *
 * Provides cross-backend event monitoring for Linux systems.
 * Supports libinput (preferred) and X11 XRecord (fallback) backends.
 */

#ifndef LINUX_EVENT_MONITOR_H
#define LINUX_EVENT_MONITOR_H

#include <napi.h>
#include <atomic>
#include <thread>
#include <memory>
#include <string>
#include <vector>

// Forward declarations for backend interfaces
class IEventBackend;
class LibinputBackend;
class X11Backend;

/**
 * Backend type enumeration
 */
enum class BackendType {
    NONE,       // No backend available
    LIBINPUT,   // libinput backend (requires input group membership)
    X11         // X11 XRecord backend (works in X11 sessions)
};

/**
 * Permission status structure
 */
struct PermissionStatus {
    bool hasInputAccess;      // Can access /dev/input devices
    bool hasX11Access;        // X11 display connection available
    BackendType currentBackend;
    std::vector<std::string> missingPermissions;
};

/**
 * Event counts structure
 */
struct EventCounts {
    uint64_t keyboard;
    uint64_t mouse;
    uint64_t scrolls;
    bool isMonitoring;
};

/**
 * Abstract backend interface
 */
class IEventBackend {
public:
    virtual ~IEventBackend() = default;

    virtual bool start() = 0;
    virtual bool stop() = 0;
    virtual bool isRunning() const = 0;
    virtual BackendType getType() const = 0;
    virtual std::string getName() const = 0;

    // Event counts - thread-safe accessors
    virtual uint64_t getKeyboardCount() const = 0;
    virtual uint64_t getMouseCount() const = 0;
    virtual uint64_t getScrollCount() const = 0;
    virtual void resetCounts() = 0;
};

/**
 * Linux Event Monitor - N-API wrapped class
 *
 * Main interface for Node.js addon. Manages backend selection
 * and provides unified API for event monitoring.
 */
class LinuxEventMonitor : public Napi::ObjectWrap<LinuxEventMonitor> {
public:
    /**
     * Initialize the N-API module exports
     */
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    /**
     * Constructor - called from JavaScript
     */
    LinuxEventMonitor(const Napi::CallbackInfo& info);

    /**
     * Destructor - cleanup resources
     */
    ~LinuxEventMonitor();

private:
    // N-API method bindings
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value GetCounts(const Napi::CallbackInfo& info);
    Napi::Value ResetCounts(const Napi::CallbackInfo& info);
    Napi::Value IsMonitoring(const Napi::CallbackInfo& info);
    Napi::Value GetBackendType(const Napi::CallbackInfo& info);
    Napi::Value CheckPermissions(const Napi::CallbackInfo& info);

    // Internal methods
    bool selectBackend();
    PermissionStatus checkPermissionsInternal();

    // Backend management
    std::unique_ptr<IEventBackend> m_backend;
    BackendType m_backendType{BackendType::NONE};

    // State tracking
    std::atomic<bool> m_initialized{false};
};

/**
 * Utility functions
 */
namespace LinuxEventUtils {
    /**
     * Check if current user has access to input devices
     * (member of 'input' group or root)
     */
    bool hasInputGroupAccess();

    /**
     * Check if X11 display is available
     */
    bool hasX11DisplayAccess();

    /**
     * Get current session type (x11, wayland, tty)
     */
    std::string getSessionType();

    /**
     * Convert BackendType to string
     */
    std::string backendTypeToString(BackendType type);
}

#endif // LINUX_EVENT_MONITOR_H
