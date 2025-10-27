# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the Employee Client component.

## Project Overview

Employee Monitoring System **Employee Client** - A cross-platform desktop application (Windows/macOS) built with Electron that monitors employee activities, captures screenshots, and communicates with the API server in real-time.

## Development Commands

```bash
# Development
npm run dev                # CLI development mode
npm run dev:cli            # CLI with TypeScript hot reload
npm run electron:dev       # Electron development mode

# Building
npm run build              # Full build process
npm run compile            # TypeScript compilation only
npm run clean              # Clean dist directory

# Electron Packaging
npm run pack:win           # Windows executable
npm run pack:mac           # macOS application  
npm run pack:all           # All platforms

# Native Module Building
npm run build:native:win   # Windows native modules
npm run build:native:mac   # macOS native modules

# Testing & Utilities
npm run test:health        # Health check CLI command
npm run device-id:info     # Device ID information
npm run device-id:validate # Validate device ID system

# Code Quality
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix ESLint issues
npm run typecheck          # TypeScript type checking
npm test                   # Jest tests
```

## Architecture - Three-Layer Design

The client follows a strict three-layer architecture:

```
main/                      # Application entry and platform factory
├── cli.ts                 # CLI interface and commands
├── index.ts               # Main application entry  
├── platform-factory.ts   # Platform-specific adapter factory
└── platform-adapter-bridge.ts  # Bridge to platform implementations

common/                    # Cross-platform shared components
├── config/               # Configuration management
├── interfaces/           # TypeScript interface definitions
├── services/            # Core business logic services
│   ├── fsm/             # Finite State Machine implementation
│   ├── auth-service.ts  # Authentication service
│   ├── data-sync-service.ts  # Data synchronization
│   └── websocket-service.ts  # WebSocket communication
├── types/               # Shared type definitions
└── utils/               # Utility functions and helpers

platforms/               # Platform-specific implementations
├── common/              # Base platform adapter
├── macos/              # macOS-specific implementations
├── windows/            # Windows-specific implementations  
└── platform-factory.ts # Platform detection and instantiation
```

### FSM (Finite State Machine) System

The client uses a sophisticated FSM to manage the device lifecycle:

**States**: `INIT → HEARTBEAT → REGISTER → BIND_CHECK → WS_CHECK → CONFIG_FETCH → DATA_COLLECT`

**Key FSM Features**:
- Automatic error recovery and state transitions
- Network disconnection handling (`DISCONNECT` state)
- Unbound device management (`UNBOUND` state)
- Comprehensive state history tracking
- Smart retry mechanisms with exponential backoff

### Technology Stack
- **Runtime**: Node.js ≥16.0.0
- **Language**: TypeScript with relaxed configuration
- **Desktop Framework**: Electron for cross-platform GUI
- **CLI Framework**: Commander.js for command-line interface
- **Path Aliases**: `@main/*`, `@common/*`, `@platforms/*`

### Native Module Handling
The Employee Client includes platform-specific native modules:
- **Windows**: `native-event-monitor-win/` (C++ event monitoring)
- **macOS**: `native-event-monitor/` (Objective-C event monitoring)
- Build scripts handle compilation and precompiled fallbacks

## Common Development Tasks

### Adding New CLI Commands
1. Add command definition in `main/cli.ts`
2. Implement command logic in appropriate service
3. Add help documentation and examples
4. Test command functionality

### Extending FSM States
1. Add state to `DeviceState` enum
2. Create state handler class implementing `StateHandler`
3. Register handler in FSM service
4. Update state transition logic

### Platform-Specific Features
1. Define interface in `common/interfaces/`
2. Implement service in `common/services/`
3. Add platform-specific code in `platforms/[platform]/`
4. Register in platform factory

This component focuses on cross-platform desktop application development with sophisticated state management and native system integration.