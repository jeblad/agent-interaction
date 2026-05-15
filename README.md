# Agent Interaction

An advanced GNOME Shell extension for seamless communication with **Hera** (Heuristic Reasoning Agent) through the system's Quick Settings.

This project facilitates real-time monitoring and interaction with autonomous agents, providing a discreet "drop window" that glides out from the screen edge for focused dialogue without breaking your workflow.

## Features

- **Quick Settings Integration**: Monitor agent health and switch between active contexts directly from the GNOME system menu.
- **Drop Window Dialogue**: A non-intrusive, collapsible chat interface designed for episodic memory exploration.
- **Process Control**: Send signals (SIGINT, SIGTERM, SIGKILL) and manage agent execution (STOP/CONT) directly from the UI.
- **Context Injection**: Attach plain-text files as context for the agent using the XDG Desktop Portal.
- **Custom Status Mapping**: Map arbitrary agent status strings to visual signal colors (Green/Yellow/Red) through preferences.
- **Session Restoration**: Automatically reloads previous dialogue history from agent logs.

## Architecture & Requirements

Agent Interaction acts as a frontend for agents adhering to the communication protocol used by hera, that is Heuristic Reasoning Agent. It expects agents to be present in:

- `/run/hera/` (System-wide agents)
- `/run/user/$UID/hera/` (User-specific agents)

The protocol is fairly lightweight. Communication is handled via named pipes (`.in` and `.out`), control signals are used for urgent out-of-band actions, and the state of the agent is tracked through `.json` metadata files. Those files act as pid-files with additional data, in particular status (the state), identification, and pid code. Signals sent to the agents are assumed to trigger state changes that can be monitored in those files, but due to load issues there might be a delay before the change is visible, and thus we use tri-state buttons for control flows.

## Experimental Status & Development

This is an **experimental project** with roots dating back to late 2019 (*AgentInspector*). It is designed for developers exploring agentic workflows.

If you do not have a full Hera backend running, you can use the built-in **Test Tools** in the Preferences window to:

- Generate simulated agents ("Schrödinger").
- Toggle simulated liveness/death.
- Generate massive test logs (200+ entries) to verify UI performance and scrolling.

## Testing

Automated unit tests are available for the core logic and utility functions in `tests/unit_tests.js`.

The testing strategy is intentionally lightweight to avoid heavy dependencies and complex mock environments for UI integration. We prioritize internal consistency and protocol adherence over heavy end-to-end UI testing frameworks.

To run the tests:

```bash
make test
```

## Installation

```bash
make install
```

*Note: Restart GNOME Shell (Log out/in on Wayland) after installation, then enable the extension via `gnome-extensions enable agent-interaction@jeblad.github.com`.*

## License

Licensed under the **GNU General Public License v3.0 only**.
See the `LICENSE` file for the full text.

Copyright © 2019-2024 John Erling Blad

*This extension is a continuation of work started in December 2019 (romjula), inheriting concepts and code from earlier agent monitoring experiments dating back to the summer of 2019.*
