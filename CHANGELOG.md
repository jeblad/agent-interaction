# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2024-05-14

### Added
- Initial release of the **Agent Interaction** GNOME Shell extension.
- **Quick Settings Integration**: Real-time status monitoring and agent switching directly from the system menu.
- **Drop Window**: A collapsible, side-attached chat interface for agent communication.
- **Process Management**: Ability to send signals (SIGINT, SIGTERM, SIGKILL) and control execution (STOP/CONT) from the UI.
- **Context Injection**: Support for attaching plain-text files as context using the XDG Desktop Portal.
- **Status Mapping**: Configurable mapping of agent status strings to visual signal colors (Green, Yellow, Red).
- **Session Restoration**: Automatic loading of previous dialogue history from agent-specific log files.
- **Test Suite**: Lightweight unit tests for core utility logic and protocol adherence.
- **Development Tools**: Built-in simulators (Schrödinger agent) for UI testing without a full Hera backend.

### Changed
- Renamed extension from "Hera Access" to "Agent Interaction".

### Technical
- Implemented using ESM for GNOME 45+.
- Uses named pipes (`.in`/`.out`) for asynchronous communication.
