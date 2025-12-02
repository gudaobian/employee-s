# native-event-monitor-linux

Linux native keyboard and mouse event monitor for the Employee Monitoring System.

## Overview

This module provides event monitoring capabilities on Linux using two backend strategies:

1. **libinput** (Preferred): Direct input device monitoring via libinput library
   - Works on both X11 and Wayland
   - Lower latency
   - Requires `input` group membership

2. **X11 XRecord** (Fallback): X11 extension-based monitoring
   - No special permissions required
   - X11 sessions only
   - Higher latency

## Prerequisites

### System Dependencies

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install -y libinput-dev libudev-dev libx11-dev libxtst-dev libxi-dev
```

#### Fedora/RHEL
```bash
sudo dnf install -y libinput-devel systemd-devel libX11-devel libXtst-devel libXi-devel
```

#### Arch Linux
```bash
sudo pacman -S libinput libx11 libxtst libxi
```

### User Permissions (for libinput backend)

To use the libinput backend, add your user to the `input` group:

```bash
sudo usermod -aG input $USER
```

Then log out and back in for the change to take effect.

## Installation

```bash
cd native-event-monitor-linux
npm install
npm run build
```

## Usage

### Basic Usage

```javascript
const LinuxEventMonitor = require('./native-event-monitor-linux');

const monitor = new LinuxEventMonitor();

// Check permissions
const perms = monitor.checkPermissions();
console.log('Input access:', perms.hasInputAccess);
console.log('X11 access:', perms.hasX11Access);

// Start monitoring
if (monitor.start()) {
    console.log('Backend:', monitor.getBackendType());

    // Get counts periodically
    setInterval(() => {
        const counts = monitor.getCounts();
        console.log('Keyboard:', counts.keyboard);
        console.log('Mouse:', counts.mouse);
        console.log('Scrolls:', counts.scrolls);
    }, 1000);
}

// Stop when done
monitor.stop();
```

### TypeScript Usage

```typescript
import { LinuxEventMonitor, EventCounts, PermissionStatus } from './native-event-monitor-linux/lib';

const monitor = new LinuxEventMonitor();

const perms: PermissionStatus = monitor.checkPermissions();
if (!perms.hasInputAccess && !perms.hasX11Access) {
    console.log('No monitoring available. Missing:', perms.missingPermissions);
}

if (monitor.start()) {
    const counts: EventCounts = monitor.getCounts();
    console.log(counts);
}

monitor.stop();
```

### Event-Based Usage

```javascript
const LinuxEventMonitor = require('./native-event-monitor-linux');

const monitor = new LinuxEventMonitor();

monitor.on('started', (backend) => {
    console.log('Monitoring started with', backend);
});

monitor.on('stopped', () => {
    console.log('Monitoring stopped');
});

monitor.on('counts', (counts) => {
    console.log('Update:', counts);
});

monitor.start();
monitor.startPolling(1000); // Poll every second

// Later...
monitor.stopPolling();
monitor.stop();
```

## API Reference

### `new LinuxEventMonitor()`

Creates a new event monitor instance.

### `monitor.start(): boolean`

Starts event monitoring. Returns `true` if successful.

### `monitor.stop(): boolean`

Stops event monitoring. Returns `true` if successful.

### `monitor.getCounts(): EventCounts`

Returns current event counts:
- `keyboard`: Number of key press events
- `mouse`: Number of mouse click events
- `scrolls`: Number of scroll events
- `isMonitoring`: Whether monitoring is active

### `monitor.resetCounts(): boolean`

Resets all counts to zero.

### `monitor.isMonitoring(): boolean`

Returns `true` if monitoring is currently active.

### `monitor.getBackendType(): string`

Returns the active backend: `'libinput'`, `'x11'`, or `'none'`.

### `monitor.checkPermissions(): PermissionStatus`

Returns permission status:
- `hasInputAccess`: Can access `/dev/input` devices
- `hasX11Access`: X11 display is available
- `currentBackend`: Currently selected backend
- `missingPermissions`: Array of missing permission names

### `monitor.isAvailable(): boolean`

Returns `true` if the native module loaded successfully.

### `monitor.startPolling(intervalMs: number)`

Starts emitting `'counts'` events at the specified interval.

### `monitor.stopPolling()`

Stops the polling interval.

## Events

- `'started'`: Emitted when monitoring starts (with backend name)
- `'stopped'`: Emitted when monitoring stops
- `'counts'`: Emitted during polling (with EventCounts)

## Building

### Development Build

```bash
npm run build
```

### Native Module Only

```bash
npm run build:native
```

### TypeScript Only

```bash
npm run build:ts
```

## Testing

```bash
# Quick sanity test
npm test

# Interactive test (requires display)
node test/basic.test.js
```

## Troubleshooting

### "Native module not found"

1. Install system dependencies (see Prerequisites)
2. Run `npm run build:native`

### "Failed to assign seat"

The user doesn't have permission to access input devices.

1. Add user to input group: `sudo usermod -aG input $USER`
2. Log out and back in
3. Verify: `groups | grep input`

### "Failed to open display"

X11 display is not available.

1. Ensure running in graphical session
2. Check `echo $DISPLAY` shows a value
3. For SSH: use `ssh -X` for X11 forwarding

### No events detected

1. Verify backend is correct: `monitor.getBackendType()`
2. For libinput: check input group membership
3. For X11: ensure XRecord extension is available

## Architecture

```
native-event-monitor-linux/
├── binding.gyp           # node-gyp build config
├── package.json          # npm package config
├── tsconfig.json         # TypeScript config
├── index.js              # Main entry point
├── src/
│   ├── addon.cpp         # N-API module entry
│   ├── event_monitor.h   # Main header
│   ├── event_monitor.cpp # Main implementation
│   ├── libinput_backend.h/.cpp  # libinput backend
│   └── x11_backend.h/.cpp       # X11 XRecord backend
├── lib/
│   └── index.ts          # TypeScript wrapper
├── test/
│   ├── basic.test.js     # Interactive test
│   └── quick.test.js     # Quick sanity test
└── bin/                  # Prebuilt binaries
```

## License

MIT
