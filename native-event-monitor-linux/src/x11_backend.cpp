/**
 * X11 XRecord Backend Implementation
 *
 * Uses X11 XRecord extension for input event monitoring.
 * Fallback option when libinput is not available.
 */

#include "x11_backend.h"

#include <iostream>
#include <cstring>

// X11 headers
extern "C" {
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/record.h>
#include <X11/extensions/XInput2.h>
}

// ============================================================================
// X11Backend Implementation
// ============================================================================

X11Backend::X11Backend() {
    std::cout << "[X11] Backend instance created" << std::endl;
}

X11Backend::~X11Backend() {
    stop();
    std::cout << "[X11] Backend instance destroyed" << std::endl;
}

bool X11Backend::isAvailable() {
    // Try to open a display connection
    Display* display = XOpenDisplay(nullptr);
    if (!display) {
        return false;
    }

    // Check for XRecord extension
    int major, minor;
    if (!XRecordQueryVersion(display, &major, &minor)) {
        XCloseDisplay(display);
        return false;
    }

    XCloseDisplay(display);
    return true;
}

bool X11Backend::initializeX11() {
    std::lock_guard<std::mutex> lock(m_mutex);

    // Open two display connections
    // One for control operations, one for data callbacks
    m_controlDisplay = XOpenDisplay(nullptr);
    if (!m_controlDisplay) {
        std::cerr << "[X11] Failed to open control display" << std::endl;
        return false;
    }

    m_dataDisplay = XOpenDisplay(nullptr);
    if (!m_dataDisplay) {
        std::cerr << "[X11] Failed to open data display" << std::endl;
        cleanupX11();
        return false;
    }

    // Check for XRecord extension
    int major, minor;
    if (!XRecordQueryVersion(m_controlDisplay, &major, &minor)) {
        std::cerr << "[X11] XRecord extension not available" << std::endl;
        cleanupX11();
        return false;
    }

    std::cout << "[X11] XRecord version: " << major << "." << minor << std::endl;

    // Set up XRecord context
    XRecordRange* range = XRecordAllocRange();
    if (!range) {
        std::cerr << "[X11] Failed to allocate XRecord range" << std::endl;
        cleanupX11();
        return false;
    }

    // Record keyboard and pointer events
    range->device_events.first = KeyPress;
    range->device_events.last = MotionNotify;

    XRecordClientSpec clientSpec = XRecordAllClients;

    m_recordContext = XRecordCreateContext(
        m_controlDisplay, 0, &clientSpec, 1, &range, 1);

    XFree(range);

    if (!m_recordContext) {
        std::cerr << "[X11] Failed to create XRecord context" << std::endl;
        cleanupX11();
        return false;
    }

    // Sync displays
    XSync(m_controlDisplay, False);
    XSync(m_dataDisplay, False);

    std::cout << "[X11] Initialized successfully" << std::endl;
    return true;
}

void X11Backend::cleanupX11() {
    if (m_recordContext && m_controlDisplay) {
        XRecordFreeContext(m_controlDisplay, m_recordContext);
        m_recordContext = 0;
    }

    if (m_dataDisplay) {
        XCloseDisplay(m_dataDisplay);
        m_dataDisplay = nullptr;
    }

    if (m_controlDisplay) {
        XCloseDisplay(m_controlDisplay);
        m_controlDisplay = nullptr;
    }
}

bool X11Backend::start() {
    if (m_running.load()) {
        return true;
    }

    if (!initializeX11()) {
        return false;
    }

    m_running.store(true);
    m_thread = std::thread(&X11Backend::monitorThread, this);

    std::cout << "[X11] Monitoring started" << std::endl;
    return true;
}

bool X11Backend::stop() {
    if (!m_running.load()) {
        return true;
    }

    m_running.store(false);

    // Disable recording to break out of XRecordEnableContext
    if (m_controlDisplay && m_recordContext) {
        XRecordDisableContext(m_controlDisplay, m_recordContext);
        XFlush(m_controlDisplay);
    }

    if (m_thread.joinable()) {
        m_thread.join();
    }

    cleanupX11();

    std::cout << "[X11] Monitoring stopped" << std::endl;
    return true;
}

bool X11Backend::isRunning() const {
    return m_running.load();
}

void X11Backend::recordCallback(void* closure, XRecordInterceptData* data) {
    if (!data) {
        return;
    }

    X11Backend* self = static_cast<X11Backend*>(closure);
    if (!self || !self->m_running.load()) {
        XRecordFreeData(data);
        return;
    }

    if (data->category == XRecordFromServer) {
        self->handleRecordData(data);
    }

    XRecordFreeData(data);
}

void X11Backend::handleRecordData(void* rawData) {
    XRecordInterceptData* data = static_cast<XRecordInterceptData*>(rawData);

    if (data->data_len < 2) {
        return;
    }

    unsigned char type = data->data[0];

    switch (type) {
        case KeyPress:
            // Keyboard key pressed
            m_keyboardCount.fetch_add(1, std::memory_order_relaxed);
            break;

        case ButtonPress: {
            // Mouse button pressed
            unsigned char button = data->data[1];

            // Buttons 4 and 5 are scroll wheel in X11
            if (button == 4 || button == 5) {
                // Scroll up or down
                m_scrollCount.fetch_add(1, std::memory_order_relaxed);
            } else if (button >= 1 && button <= 3) {
                // Regular mouse button (left, middle, right)
                m_mouseCount.fetch_add(1, std::memory_order_relaxed);
            } else if (button == 6 || button == 7) {
                // Horizontal scroll
                m_scrollCount.fetch_add(1, std::memory_order_relaxed);
            }
            break;
        }

        default:
            // Ignore other events (KeyRelease, ButtonRelease, MotionNotify)
            break;
    }
}

void X11Backend::monitorThread() {
    std::cout << "[X11] Monitor thread started" << std::endl;

    // Enable XRecord - this will block and call the callback for each event
    // until XRecordDisableContext is called
    XRecordEnableContext(
        m_dataDisplay,
        m_recordContext,
        reinterpret_cast<XRecordInterceptProc>(&X11Backend::recordCallback),
        reinterpret_cast<XPointer>(this)
    );

    std::cout << "[X11] Monitor thread exiting" << std::endl;
}

uint64_t X11Backend::getKeyboardCount() const {
    return m_keyboardCount.load(std::memory_order_relaxed);
}

uint64_t X11Backend::getMouseCount() const {
    return m_mouseCount.load(std::memory_order_relaxed);
}

uint64_t X11Backend::getScrollCount() const {
    return m_scrollCount.load(std::memory_order_relaxed);
}

void X11Backend::resetCounts() {
    m_keyboardCount.store(0, std::memory_order_relaxed);
    m_mouseCount.store(0, std::memory_order_relaxed);
    m_scrollCount.store(0, std::memory_order_relaxed);
}
