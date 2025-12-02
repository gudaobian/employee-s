/**
 * N-API Addon Entry Point
 *
 * Initializes and exports the Linux Event Monitor module to Node.js.
 */

#include <napi.h>
#include "event_monitor.h"

/**
 * Module initialization function
 * Called when the module is loaded by Node.js
 */
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
    return LinuxEventMonitor::Init(env, exports);
}

// Register the module
NODE_API_MODULE(linux_event_monitor, InitModule)
