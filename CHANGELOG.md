# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.2.0](https://github.com/jeblad/agent-interaction/compare/v0.1.0...v0.2.0) (2026-05-19)


### ⚠ BREAKING CHANGES

* migrate to modular DropResizeHandler and consolidate CSS

* migrate to modular DropResizeHandler and consolidate CSS ([1ef26ea](https://github.com/jeblad/agent-interaction/commit/1ef26eab03799871c060b738f20c5408762a7d8f))


### Bug Fixes

* changed testdata and the visualization ([4c50214](https://github.com/jeblad/agent-interaction/commit/4c50214dd6c56c6bf7b651fcdff87321b9c70ea0))
* include stylesheet.css, but not quite yet ([19a9382](https://github.com/jeblad/agent-interaction/commit/19a9382d77a1a411e9a2e3e7bf8e81f40482a32a))
* Two errors, wrong function names and location ([f759d03](https://github.com/jeblad/agent-interaction/commit/f759d030777cf08c9a1a7baf6a529bfd22f69c33))
* updated ,gitignore ([ae8eb95](https://github.com/jeblad/agent-interaction/commit/ae8eb9566fa49c86715a730bc27bc6148e2ec9e0))
* updates extension.js, this should be safe. ([a6bbba3](https://github.com/jeblad/agent-interaction/commit/a6bbba31bb1f338fc98a343eb162801206b2e1ca))

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
