/*
 * Agent Interaction - A GNOME extension for communicating with AI agents.
 * Copyright (C) 2019-2024 John Erling Blad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { AgentUtils } from './utils.js';
import { AgentAccessDialog } from './dialog.js';
/**
 * A standard item inside the submenu list.
 */
const AgentMenuItem = GObject.registerClass(
class AgentMenuItem extends PopupMenu.PopupMenuItem {
    _init(agentData, isConnected = false, onActivate, settings, gicon) {
        super._init('', {
            style_class: 'quick-settings-menu-item',
            reactive: true,
        });

        this._settings = settings;
        const shortId = agentData.short || (agentData.uuid ? agentData.uuid.substring(0, 4) : null);
        let displayText = _('Unknown Agent');

        if (agentData.callsign) {
            displayText = shortId ? _('%s (%s)').format(agentData.callsign, shortId) : agentData.callsign;
        } else if (agentData.uuid) {
            displayText = agentData.uuid;
        } else if (agentData.model) {
            displayText = agentData.model;
        }

        this.label.x_expand = false;
        this.label.set_text(displayText);

        // 1. Status icon
        const status = agentData.status || 'unknown';
        const statusColor = AgentUtils.getStatusColor(this._settings, status);
        this._statusIcon = new St.Icon({
            gicon: gicon,
            icon_size: 14,
            style: `color: ${statusColor}; margin-right: 8px;`,
        });
        this.insert_child_at_index(this._statusIcon, 0);

        // 2. Lock icon for system agents
        if (agentData.isSystem) {
            this._lockIcon = new St.Icon({
                icon_name: 'changes-prevent-symbolic',
                icon_size: 12,
                style_class: 'popup-menu-icon',
            });
            this.insert_child_at_index(this._lockIcon, 1);
        }

        // 3. Selection checkmark
        if (isConnected) {
            this._checkIcon = new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: 14,
                style_class: 'popup-menu-icon',
                style: 'margin-left: 6px;',
            });
            this.add_child(this._checkIcon);
        }

        // 4. Status text aligned to right
        const statusText = agentData.status || '';
        this._statusLabel = new St.Label({
            text: statusText.charAt(0).toUpperCase() + statusText.slice(1),
            style_class: 'popup-inactive-menu-item',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        this.add_child(this._statusLabel);

        this.connect('activate', AgentUtils.safeCallback(() => onActivate(), 'AgentMenuItem'));
    }
});
/**
 * The Toggle Button in the Quick Settings grid.
 */
const AgentMenuToggle = GObject.registerClass(
class AgentMenuToggle extends QuickSettings.QuickMenuToggle {
    _init(extension, indicator) {
        this._indicator = indicator;
        this._settings = extension.getSettings();
        this._lastAgentsHash = '';
        
        this._stateGIcon = Gio.FileIcon.new(extension.dir.get_child('icons').get_child('agent-interaction-state-symbolic.svg'));

        super._init({
            title: _('Agent Interaction'),
            gicon: this._stateGIcon,
            toggleMode: true,
        });

        if (this._icon) {
            this._icon.margin_top = 1;
        }

        this.menu.setHeader(this._stateGIcon, _('Agent Interaction'), _('Available agents'));
        this._agentSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._agentSection);

        this.connect('clicked', AgentUtils.safeCallback(() => this._indicator.toggleConnection(), 'AgentMenuToggle'));

        this.menu.connect('open-state-changed', AgentUtils.safeCallback((menu, isOpen) => {
            if (isOpen) this._indicator._updateFromDisk();
        }, 'AgentMenuOpen'));
    }

    updateState(isConnected, activeAgent, agents = []) {
        const status = activeAgent ? activeAgent.status : 'disconnected';

        if (isConnected && activeAgent) {
            const prefix = activeAgent.isSystem ? '🔒 ' : '';
            const shortId = activeAgent.short || (activeAgent.uuid ? activeAgent.uuid.substring(0, 4) : null);
            let name = _('Unknown Agent');

            if (activeAgent.callsign) {
                name = shortId ? _('%s (%s)').format(activeAgent.callsign, shortId) : activeAgent.callsign;
            } else if (activeAgent.uuid) {
                name = activeAgent.uuid;
            } else if (activeAgent.model) {
                name = activeAgent.model;
            }
            this.title = `${prefix}${name}`;
        } else {
            this.title = _('Agent Interaction');
        }

        this.gicon = this._stateGIcon;
        this.checked = isConnected;

        let statusStyle = '';
        if (isConnected) {
            const hex = AgentUtils.getStatusColor(this._settings, status);
            if (hex !== '#9a9996')
                statusStyle = `color: ${hex} !important; background-color: transparent !important;`;
        }

        if (this._icon) {
            this._icon.set_style(statusStyle);
        }

        if (this._indicator?._indicator) {
            this._indicator._indicator.set_style(statusStyle);
        }

        // Performance optimization: Only rebuild the menu if the agent list has actually changed.
        const agentsHash = JSON.stringify(agents.map(a => ({ uuid: a.uuid, status: a.status })));
        if (this._lastAgentsHash !== agentsHash) {
            this._lastAgentsHash = agentsHash;
            this._rebuildMenu(isConnected, activeAgent, agents);
        }
    }

    _rebuildMenu(isConnected, activeAgent, agents) {
        this._agentSection.removeAll();

        if (isConnected && activeAgent && activeAgent.description) {
            const descItem = new PopupMenu.PopupMenuItem(activeAgent.description, {
                reactive: false,
            });
            descItem.label.style = 'font-size: 0.85em; font-style: italic; opacity: 0.7;';
            this._agentSection.addMenuItem(descItem);
        }

        if (agents.length > 0) {
            agents.forEach(agent => {
                const isThisActive = activeAgent && agent.uuid === activeAgent.uuid;
                this._agentSection.addMenuItem(new AgentMenuItem(
                    agent,
                    isConnected && isThisActive,
                    () => {
                        this._indicator.connectToAgent(agent.uuid);
                        this.menu.close();
                    },
                    this._settings,
                    this._stateGIcon
                ));
            });
        } else {
            const noAgentsItem = new PopupMenu.PopupMenuItem(_('No agents found'));
            noAgentsItem.sensitive = false;
            this._agentSection.addMenuItem(noAgentsItem);
        }

        this._agentSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem(_('Agent Interaction Settings...'));
        settingsItem.connect('activate', AgentUtils.safeCallback(() => {
            if (Main.panel.statusArea.quickSettings.menu.isOpen)
                Main.panel.statusArea.quickSettings.menu.close();
            this.menu.close();

            // Using idle_add ensures the menu is fully closed and that
            // Shell has cleaned up the focus stack before we open the prefs window.
            // This allows the window to "rise to the top" as expected.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, AgentUtils.safeCallback(() => {
                this._indicator._extension.openPreferences();
                return GLib.SOURCE_REMOVE;
            }, 'AgentSettingsIdle'));
        }, 'DropSettingsItem'));
        this._agentSection.addMenuItem(settingsItem);
    }
});

/**
 * The System Indicator that lives in the top panel.
 */
const AgentIndicator = GObject.registerClass(
class AgentIndicator extends QuickSettings.SystemIndicator {
    _init(extension) {
        super._init();
        this._extension = extension;
        this._settings = extension.getSettings();

        this._stateGIcon = Gio.FileIcon.new(extension.dir.get_child('icons').get_child('agent-interaction-state-symbolic.svg'));
        this._wasConnected = false;
        this._lastActiveUuid = null;

        this._activeAgentUuid = null;
        this._manualDisconnect = false;
        this._accessWindows = new Map();

        this._runDirs = [
            Gio.File.new_for_path('/run/hera'),
            Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_runtime_dir(), 'hera']))
        ];
        this._monitors = new Map();

        this._indicator = this._addIndicator();
        this._indicator.icon_size = 16;
        this._indicator.margin_top = 1;
        this._indicator.visible = false;

        this._toggle = new AgentMenuToggle(extension, this);
        this.quickSettingsItems.push(this._toggle);

        Main.panel.statusArea.quickSettings.addExternalIndicator(this);

        this._runDirs.forEach(dir => this._setupDirectoryMonitor(dir));
        this._updateFromDisk();
    }

    _setupDirectoryMonitor(dir) {
        const path = dir.get_path();
        if (this._monitors.has(path) || !dir.query_exists(null))
            return;

        try {
            const monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            monitor.connect('changed', AgentUtils.safeCallback(() => this._updateFromDisk(), 'AgentDirMonitor'));
            this._monitors.set(path, monitor);
        } catch (e) {
            console.error(`AgentInteraction: Monitor error for ${path}: ${e.message}`);
        }
    }

    _prepareAccessWindow(agentData) {
        let win = this._accessWindows.get(agentData.uuid);
        try {
            if (!win) {
                win = new AgentAccessDialog(agentData, this._settings);
                win.connect('destroy', AgentUtils.safeCallback(() => this._accessWindows.delete(agentData.uuid), 'AgentDialogDestroy'));
                this._accessWindows.set(agentData.uuid, win);
                // Legger vinduet til i chrome-laget umiddelbart, men siden det er
                // sammenfoldet (collapsed) i konstruktøren, vises det kun som en 1px stripe.
                Main.layoutManager.addChrome(win);
            }
            win.updateState(agentData);
            return win;
        } catch (e) {
            console.error(`AgentInteraction: Error preparing access dialog: ${e.message}`);
            return null;
        }
    }

    openAccessWindow(agentData) {
        let win = this._prepareAccessWindow(agentData);
        if (win)
            win.show();
    }

    _closeAllAccessWindows() {
        this._accessWindows.forEach(win => {
            try {
                if (win.get_parent()) {
                    Main.layoutManager.removeChrome(win);
                }
                win.destroy();
            } catch (e) {
                console.error(`AgentInteraction: Failed to close access window: ${e.message}`);
            }
        });
        this._accessWindows.clear();
    }

    toggleConnection() {
        this._manualDisconnect = !this._manualDisconnect;
        this._updateFromDisk();
    }

    connectToAgent(uuid) {
        this._activeAgentUuid = uuid;
        this._manualDisconnect = false;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, AgentUtils.safeCallback(() => {
            this._updateFromDisk();
            return GLib.SOURCE_REMOVE;
        }, 'HeraConnectToAgent'));
    }

    _updateFromDisk() {
        let allAgents = [];
        this._runDirs.forEach(dir => {
            const path = dir.get_path();
            const isSystemDir = path === '/run/hera';

            this._setupDirectoryMonitor(dir);

            if (!dir.query_exists(null)) return;
            try {
                let enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let fileInfo;
                while ((fileInfo = enumerator.next_file(null))) {
                    if (!fileInfo.get_name().endsWith('.json')) continue;
                    let file = dir.get_child(fileInfo.get_name());
                    try {
                        let [success, contents] = file.load_contents(null);
                        if (success) {
                            const decoder = new TextDecoder();
                            const decodedText = decoder.decode(contents);
                            if (!decodedText || decodedText.trim() === '') {
                                continue;
                            }
                            
                            let data = JSON.parse(decodedText);
                            data.isSystem = isSystemDir;

                            if (data.pid) {
                                let procDir = Gio.File.new_for_path(`/proc/${data.pid}`);
                                if (!procDir.query_exists(null)) {
                                    data.status = 'gone';
                                }
                            }

                            allAgents.push(data);
                        }
                    } catch (e) {
                        console.warn(`AgentInteracion: Error reading ${fileInfo.get_name()}: ${e.message}`);
                    }
                }
            } catch (e) {
                console.warn(`AgentInteraction: Could not read directory ${dir.get_path()}: ${e.message}`);
            }
        });

        if (!this._activeAgentUuid && allAgents.length > 0) {
            const firstActive = allAgents.find(a => a.status === 'active');
            this._activeAgentUuid = firstActive ? firstActive.uuid : allAgents[0].uuid;
        }

        const activeAgent = allAgents.find(a => a.uuid === this._activeAgentUuid);
        const isConnected = !!activeAgent && !this._manualDisconnect;

        this.updateState(isConnected, activeAgent, allAgents);
    }

    updateState(isConnected, activeAgent, agents = []) {
        this._indicator.visible = isConnected;
        const status = activeAgent ? activeAgent.status : 'disconnected';

        this._indicator.gicon = this._stateGIcon;

        if (isConnected) {
            const hex = AgentUtils.getStatusColor(this._settings, status);
            this._indicator.set_style(hex !== '#9a9996' ? `color: ${hex};` : '');
        } else {
            this._indicator.set_style('');
        }

        this._toggle.updateState(isConnected, activeAgent, agents);

        const currentUuid = activeAgent ? activeAgent.uuid : null;
        const isNewSession = isConnected && activeAgent && (!this._wasConnected || currentUuid !== this._lastActiveUuid);

        if (!isConnected) {
            this._closeAllAccessWindows();
        } else if (isNewSession) {
            // Gjenoppretter logikken for "tidligere valgt", men i stedet for å tvinge
            // frem vinduet med .show(), sørger vi bare for at det er lastet og
            // ligger klart (skjult) ved kanten.
            this._prepareAccessWindow(activeAgent);
        }

        this._wasConnected = isConnected;
        this._lastActiveUuid = currentUuid;
    }

    destroy() {
        if (this._monitors) {
            this._monitors.forEach(m => m.cancel());
            this._monitors.clear();
        }
        if (this._accessWindows) {
            this._accessWindows.forEach(win => win.destroy());
            this._accessWindows.clear();
        }
        this._toggle.destroy();
        super.destroy();
    }
});

export default class AgentInteractionExtension extends Extension {
    enable() {
        this.initTranslations();
        this._indicator = new AgentIndicator(this);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}