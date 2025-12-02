/**
 * Linux Event Monitor - Main Implementation
 *
 * Provides the N-API interface and backend management for
 * cross-platform event monitoring on Linux systems.
 */

#include "event_monitor.h"
#include "libinput_backend.h"
#include "x11_backend.h"

#include <unistd.h>
#include <grp.h>
#include <pwd.h>
#include <cstring>
#include <cstdlib>
#include <iostream>
#include <fstream>
#include <sys/stat.h>

// ============================================================================
// LinuxEventUtils Implementation
// ============================================================================

namespace LinuxEventUtils {

bool hasInputGroupAccess() {
    // Root always has access
    if (geteuid() == 0) {
        return true;
    }

    // Check if user is in 'input' group
    struct group* inputGroup = getgrnam("input");
    if (!inputGroup) {
        return false;
    }

    gid_t inputGid = inputGroup->gr_gid;

    // Check primary group
    if (getegid() == inputGid) {
        return true;
    }

    // Check supplementary groups
    int ngroups = getgroups(0, nullptr);
    if (ngroups <= 0) {
        return false;
    }

    std::vector<gid_t> groups(ngroups);
    if (getgroups(ngroups, groups.data()) == -1) {
        return false;
    }

    for (int i = 0; i < ngroups; i++) {
        if (groups[i] == inputGid) {
            return true;
        }
    }

    // Also check if we can access /dev/input/event0 directly
    struct stat st;
    if (stat("/dev/input/event0", &st) == 0) {
        if (access("/dev/input/event0", R_OK) == 0) {
            return true;
        }
    }

    return false;
}

bool hasX11DisplayAccess() {
    const char* display = std::getenv("DISPLAY");
    return display != nullptr && display[0] != '\0';
}

std::string getSessionType() {
    // Check XDG_SESSION_TYPE first
    const char* sessionType = std::getenv("XDG_SESSION_TYPE");
    if (sessionType) {
        return std::string(sessionType);
    }

    // Check if WAYLAND_DISPLAY is set
    const char* waylandDisplay = std::getenv("WAYLAND_DISPLAY");
    if (waylandDisplay && waylandDisplay[0] != '\0') {
        return "wayland";
    }

    // Check if DISPLAY is set (X11)
    const char* x11Display = std::getenv("DISPLAY");
    if (x11Display && x11Display[0] != '\0') {
        return "x11";
    }

    return "tty";
}

std::string backendTypeToString(BackendType type) {
    switch (type) {
        case BackendType::LIBINPUT:
            return "libinput";
        case BackendType::X11:
            return "x11";
        case BackendType::NONE:
        default:
            return "none";
    }
}

} // namespace LinuxEventUtils

// ============================================================================
// LinuxEventMonitor Implementation
// ============================================================================

Napi::Object LinuxEventMonitor::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LinuxEventMonitor", {
        InstanceMethod<&LinuxEventMonitor::Start>("start"),
        InstanceMethod<&LinuxEventMonitor::Stop>("stop"),
        InstanceMethod<&LinuxEventMonitor::GetCounts>("getCounts"),
        InstanceMethod<&LinuxEventMonitor::ResetCounts>("resetCounts"),
        InstanceMethod<&LinuxEventMonitor::IsMonitoring>("isMonitoring"),
        InstanceMethod<&LinuxEventMonitor::GetBackendType>("getBackendType"),
        InstanceMethod<&LinuxEventMonitor::CheckPermissions>("checkPermissions"),
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    exports.Set("LinuxEventMonitor", func);

    // Export convenience functions directly on module
    exports.Set("createMonitor", Napi::Function::New(env, [constructor](const Napi::CallbackInfo& info) {
        return constructor->New({});
    }));

    return exports;
}

LinuxEventMonitor::LinuxEventMonitor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<LinuxEventMonitor>(info) {
    // Constructor - backend is selected on first start()
    std::cout << "[LINUX_EVENT] LinuxEventMonitor instance created" << std::endl;
}

LinuxEventMonitor::~LinuxEventMonitor() {
    if (m_backend && m_backend->isRunning()) {
        m_backend->stop();
    }
    std::cout << "[LINUX_EVENT] LinuxEventMonitor instance destroyed" << std::endl;
}

bool LinuxEventMonitor::selectBackend() {
    if (m_backend) {
        return true;
    }

    std::string sessionType = LinuxEventUtils::getSessionType();
    std::cout << "[LINUX_EVENT] Session type: " << sessionType << std::endl;

    // Strategy 1: Try libinput first (works on both X11 and Wayland)
    if (LinuxEventUtils::hasInputGroupAccess()) {
        std::cout << "[LINUX_EVENT] Trying libinput backend..." << std::endl;
        if (LibinputBackend::isAvailable()) {
            m_backend = std::make_unique<LibinputBackend>();
            m_backendType = BackendType::LIBINPUT;
            std::cout << "[LINUX_EVENT] Selected libinput backend" << std::endl;
            return true;
        }
        std::cout << "[LINUX_EVENT] libinput not available" << std::endl;
    } else {
        std::cout << "[LINUX_EVENT] No input group access" << std::endl;
    }

    // Strategy 2: Fall back to X11 XRecord
    if (sessionType == "x11" || LinuxEventUtils::hasX11DisplayAccess()) {
        std::cout << "[LINUX_EVENT] Trying X11 backend..." << std::endl;
        if (X11Backend::isAvailable()) {
            m_backend = std::make_unique<X11Backend>();
            m_backendType = BackendType::X11;
            std::cout << "[LINUX_EVENT] Selected X11 backend" << std::endl;
            return true;
        }
        std::cout << "[LINUX_EVENT] X11 not available" << std::endl;
    }

    std::cerr << "[LINUX_EVENT] No suitable backend available!" << std::endl;
    m_backendType = BackendType::NONE;
    return false;
}

PermissionStatus LinuxEventMonitor::checkPermissionsInternal() {
    PermissionStatus status;
    status.hasInputAccess = LinuxEventUtils::hasInputGroupAccess();
    status.hasX11Access = LinuxEventUtils::hasX11DisplayAccess();
    status.currentBackend = m_backendType;

    if (!status.hasInputAccess) {
        status.missingPermissions.push_back("input_group");
    }
    if (!status.hasX11Access) {
        status.missingPermissions.push_back("x11_display");
    }

    return status;
}

// ============================================================================
// N-API Method Implementations
// ============================================================================

Napi::Value LinuxEventMonitor::Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Select backend if not already done
    if (!m_backend) {
        if (!selectBackend()) {
            return Napi::Boolean::New(env, false);
        }
    }

    // Start the backend
    bool success = m_backend->start();
    if (success) {
        std::cout << "[LINUX_EVENT] Monitoring started with "
                  << m_backend->getName() << " backend" << std::endl;
    } else {
        std::cerr << "[LINUX_EVENT] Failed to start monitoring" << std::endl;
    }

    return Napi::Boolean::New(env, success);
}

Napi::Value LinuxEventMonitor::Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!m_backend) {
        return Napi::Boolean::New(env, true);
    }

    bool success = m_backend->stop();
    if (success) {
        std::cout << "[LINUX_EVENT] Monitoring stopped" << std::endl;
    }

    return Napi::Boolean::New(env, success);
}

Napi::Value LinuxEventMonitor::GetCounts(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);

    if (m_backend) {
        result.Set("keyboard", Napi::Number::New(env, m_backend->getKeyboardCount()));
        result.Set("mouse", Napi::Number::New(env, m_backend->getMouseCount()));
        result.Set("scrolls", Napi::Number::New(env, m_backend->getScrollCount()));
        result.Set("isMonitoring", Napi::Boolean::New(env, m_backend->isRunning()));
    } else {
        result.Set("keyboard", Napi::Number::New(env, 0));
        result.Set("mouse", Napi::Number::New(env, 0));
        result.Set("scrolls", Napi::Number::New(env, 0));
        result.Set("isMonitoring", Napi::Boolean::New(env, false));
    }

    return result;
}

Napi::Value LinuxEventMonitor::ResetCounts(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (m_backend) {
        m_backend->resetCounts();
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value LinuxEventMonitor::IsMonitoring(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool monitoring = m_backend ? m_backend->isRunning() : false;
    return Napi::Boolean::New(env, monitoring);
}

Napi::Value LinuxEventMonitor::GetBackendType(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::String::New(env, LinuxEventUtils::backendTypeToString(m_backendType));
}

Napi::Value LinuxEventMonitor::CheckPermissions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    PermissionStatus status = checkPermissionsInternal();

    Napi::Object result = Napi::Object::New(env);
    result.Set("hasInputAccess", Napi::Boolean::New(env, status.hasInputAccess));
    result.Set("hasX11Access", Napi::Boolean::New(env, status.hasX11Access));
    result.Set("currentBackend", Napi::String::New(env,
        LinuxEventUtils::backendTypeToString(status.currentBackend)));

    Napi::Array missingPerms = Napi::Array::New(env, status.missingPermissions.size());
    for (size_t i = 0; i < status.missingPermissions.size(); i++) {
        missingPerms.Set(i, Napi::String::New(env, status.missingPermissions[i]));
    }
    result.Set("missingPermissions", missingPerms);

    return result;
}
