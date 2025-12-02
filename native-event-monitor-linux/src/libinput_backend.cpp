/**
 * libinput Backend Implementation
 *
 * Uses libinput library for direct input device monitoring.
 * Provides keyboard, mouse click, and scroll wheel event counting.
 */

#include "libinput_backend.h"

#include <iostream>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>
#include <sys/epoll.h>
#include <linux/input.h>
#include <errno.h>

// libinput headers
extern "C" {
#include <libinput.h>
#include <libudev.h>
}

// ============================================================================
// libinput Interface Callbacks
// ============================================================================

int LibinputBackend::openRestricted(const char* path, int flags, void* userData) {
    int fd = open(path, flags);
    if (fd < 0) {
        std::cerr << "[LIBINPUT] Failed to open " << path
                  << ": " << strerror(errno) << std::endl;
    }
    return fd < 0 ? -errno : fd;
}

void LibinputBackend::closeRestricted(int fd, void* userData) {
    close(fd);
}

static const struct libinput_interface libinput_interface = {
    .open_restricted = &LibinputBackend::openRestricted,
    .close_restricted = &LibinputBackend::closeRestricted,
};

// ============================================================================
// LibinputBackend Implementation
// ============================================================================

LibinputBackend::LibinputBackend() {
    std::cout << "[LIBINPUT] Backend instance created" << std::endl;
}

LibinputBackend::~LibinputBackend() {
    stop();
    std::cout << "[LIBINPUT] Backend instance destroyed" << std::endl;
}

bool LibinputBackend::isAvailable() {
    // Check if we can create a udev context
    struct udev* udev = udev_new();
    if (!udev) {
        return false;
    }

    // Try to create libinput context
    struct libinput* li = libinput_udev_create_context(
        &libinput_interface, nullptr, udev);

    if (!li) {
        udev_unref(udev);
        return false;
    }

    // Try to assign seat
    int ret = libinput_udev_assign_seat(li, "seat0");
    bool available = (ret == 0);

    libinput_unref(li);
    udev_unref(udev);

    return available;
}

bool LibinputBackend::initializeLibinput() {
    std::lock_guard<std::mutex> lock(m_mutex);

    // Create udev context
    m_udev = udev_new();
    if (!m_udev) {
        std::cerr << "[LIBINPUT] Failed to create udev context" << std::endl;
        return false;
    }

    // Create libinput context
    m_libinput = libinput_udev_create_context(
        &libinput_interface, this, m_udev);

    if (!m_libinput) {
        std::cerr << "[LIBINPUT] Failed to create libinput context" << std::endl;
        cleanupLibinput();
        return false;
    }

    // Assign seat
    if (libinput_udev_assign_seat(m_libinput, "seat0") != 0) {
        std::cerr << "[LIBINPUT] Failed to assign seat" << std::endl;
        cleanupLibinput();
        return false;
    }

    // Create epoll for event loop
    m_epollFd = epoll_create1(EPOLL_CLOEXEC);
    if (m_epollFd < 0) {
        std::cerr << "[LIBINPUT] Failed to create epoll fd" << std::endl;
        cleanupLibinput();
        return false;
    }

    // Add libinput fd to epoll
    int libinputFd = libinput_get_fd(m_libinput);
    struct epoll_event ev;
    ev.events = EPOLLIN;
    ev.data.fd = libinputFd;

    if (epoll_ctl(m_epollFd, EPOLL_CTL_ADD, libinputFd, &ev) < 0) {
        std::cerr << "[LIBINPUT] Failed to add fd to epoll" << std::endl;
        cleanupLibinput();
        return false;
    }

    std::cout << "[LIBINPUT] Initialized successfully" << std::endl;
    return true;
}

void LibinputBackend::cleanupLibinput() {
    if (m_epollFd >= 0) {
        close(m_epollFd);
        m_epollFd = -1;
    }

    if (m_libinput) {
        libinput_unref(m_libinput);
        m_libinput = nullptr;
    }

    if (m_udev) {
        udev_unref(m_udev);
        m_udev = nullptr;
    }
}

bool LibinputBackend::start() {
    if (m_running.load()) {
        return true;
    }

    if (!initializeLibinput()) {
        return false;
    }

    m_running.store(true);
    m_thread = std::thread(&LibinputBackend::monitorThread, this);

    std::cout << "[LIBINPUT] Monitoring started" << std::endl;
    return true;
}

bool LibinputBackend::stop() {
    if (!m_running.load()) {
        return true;
    }

    m_running.store(false);

    // Wake up epoll by closing the fd
    if (m_epollFd >= 0) {
        // Create a pipe to signal thread exit
        int pipeFds[2];
        if (pipe(pipeFds) == 0) {
            ssize_t __attribute__((unused)) ret = write(pipeFds[1], "x", 1);
            close(pipeFds[0]);
            close(pipeFds[1]);
        }
    }

    if (m_thread.joinable()) {
        m_thread.join();
    }

    cleanupLibinput();

    std::cout << "[LIBINPUT] Monitoring stopped" << std::endl;
    return true;
}

bool LibinputBackend::isRunning() const {
    return m_running.load();
}

void LibinputBackend::monitorThread() {
    std::cout << "[LIBINPUT] Monitor thread started" << std::endl;

    struct epoll_event events[8];

    while (m_running.load()) {
        int nfds = epoll_wait(m_epollFd, events, 8, 100); // 100ms timeout

        if (nfds < 0) {
            if (errno == EINTR) {
                continue;
            }
            std::cerr << "[LIBINPUT] epoll_wait error: " << strerror(errno) << std::endl;
            break;
        }

        if (nfds > 0) {
            processEvents();
        }
    }

    std::cout << "[LIBINPUT] Monitor thread exiting" << std::endl;
}

void LibinputBackend::processEvents() {
    std::lock_guard<std::mutex> lock(m_mutex);

    if (!m_libinput) {
        return;
    }

    libinput_dispatch(m_libinput);

    struct libinput_event* event;
    while ((event = libinput_get_event(m_libinput)) != nullptr) {
        enum libinput_event_type type = libinput_event_get_type(event);

        switch (type) {
            case LIBINPUT_EVENT_KEYBOARD_KEY:
                handleKeyboardEvent(event);
                break;

            case LIBINPUT_EVENT_POINTER_BUTTON:
            case LIBINPUT_EVENT_POINTER_SCROLL_WHEEL:
            case LIBINPUT_EVENT_POINTER_SCROLL_FINGER:
            case LIBINPUT_EVENT_POINTER_SCROLL_CONTINUOUS:
                handlePointerEvent(event);
                break;

            default:
                // Ignore other events
                break;
        }

        libinput_event_destroy(event);
    }
}

void LibinputBackend::handleKeyboardEvent(struct libinput_event* event) {
    struct libinput_event_keyboard* kbEvent =
        libinput_event_get_keyboard_event(event);

    if (!kbEvent) {
        return;
    }

    // Only count key press events (not releases)
    enum libinput_key_state state = libinput_event_keyboard_get_key_state(kbEvent);
    if (state == LIBINPUT_KEY_STATE_PRESSED) {
        m_keyboardCount.fetch_add(1, std::memory_order_relaxed);
    }
}

void LibinputBackend::handlePointerEvent(struct libinput_event* event) {
    enum libinput_event_type type = libinput_event_get_type(event);

    switch (type) {
        case LIBINPUT_EVENT_POINTER_BUTTON: {
            struct libinput_event_pointer* ptrEvent =
                libinput_event_get_pointer_event(event);
            if (ptrEvent) {
                enum libinput_button_state state =
                    libinput_event_pointer_get_button_state(ptrEvent);
                if (state == LIBINPUT_BUTTON_STATE_PRESSED) {
                    m_mouseCount.fetch_add(1, std::memory_order_relaxed);
                }
            }
            break;
        }

        case LIBINPUT_EVENT_POINTER_SCROLL_WHEEL:
        case LIBINPUT_EVENT_POINTER_SCROLL_FINGER:
        case LIBINPUT_EVENT_POINTER_SCROLL_CONTINUOUS: {
            // Count each scroll event
            m_scrollCount.fetch_add(1, std::memory_order_relaxed);
            break;
        }

        default:
            break;
    }
}

uint64_t LibinputBackend::getKeyboardCount() const {
    return m_keyboardCount.load(std::memory_order_relaxed);
}

uint64_t LibinputBackend::getMouseCount() const {
    return m_mouseCount.load(std::memory_order_relaxed);
}

uint64_t LibinputBackend::getScrollCount() const {
    return m_scrollCount.load(std::memory_order_relaxed);
}

void LibinputBackend::resetCounts() {
    m_keyboardCount.store(0, std::memory_order_relaxed);
    m_mouseCount.store(0, std::memory_order_relaxed);
    m_scrollCount.store(0, std::memory_order_relaxed);
}
