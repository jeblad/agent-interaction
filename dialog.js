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

import { AgentUtils } from './utils.js';
import { AgentResizeHandler } from './resize.js';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
/**
 * A floating, non-modal window built with St for communicating with an agent.
 */
export const AgentAccessDialog = GObject.registerClass(
    { GTypeName: 'AgentAccessDialog' },
class AgentAccessDialog extends St.Widget {
    _init(agentData, settings) {
        this._settings = settings;
        this._showTimeoutId = 0;
        this._hideTimeoutId = 0;
        this._animating = false;
        this._surfaceOffset = 0;
        this._surfaceFileIndex = 0; // 0 is current .log, 1 is .log.1, etc.
        this._loadingMore = false;
        this._attachments = []; // List of selected attachments: { file, selected }
        this._signalButtons = {}; // Stores references to buttons
        this._windowSignals = [];
        this._agent = agentData;
        
        this._settingsHandlerId = this._settings.connect('changed', (s, key) => { // eslint-disable-line no-unused-vars
            if (key === 'agent-force-reset') {
                if (this._settings.get_boolean('agent-force-reset')) {
                    this._performHardReset();
                    this._settings.set_boolean('agent-force-reset', false); // Reset the trigger
                }
            } else if (key.startsWith('agent-')) {
                // Samle opp flere endringer (som ved reset) og kjør refresh én gang
                if (this._refreshId) GLib.source_remove(this._refreshId);
                this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this._refreshLayoutFromSettings();
                    this._refreshId = 0;
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        this._edgeOffset = this._settings.get_int('agent-window-edge-offset');
        this._minWidth = this._settings.get_int('agent-window-min-width');
        this._minHeight = this._settings.get_int('agent-window-min-height');
        const geo = this._calculateGeometry(false);
        this._expandedX = geo.x;

        // Initialize the Widget
        super._init({
            style_class: 'agent-outer-container',
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_expand: true,
            width: geo.width,
            height: geo.height,
        });

        // Utled side for initial tilstand (0=venstre, 1=høyre)
        const monitor = Main.layoutManager.primaryMonitor;
        this._side = (geo.x + geo.width / 2 > monitor.x + monitor.width / 2) ? 1 : 0;
        this._expandedX = geo.x;

        this._maxDisplayMessages = this._settings.get_int('agent-window-max-display-messages');
        this._setupResizers(settings, this._edgeOffset);
        this._setupWindowLayout(geo);

        // Add main content to the dialog, then attach resizers
        this.add_child(this._mainContent);
        this._resizers.forEach(resizer => resizer.attach(this._mainContent));

        this._setupPaths();
        
        this._mainContent.add_child(this._createHeader()); // Wrapped in safeCallback
        this._mainContent.add_child(this._createChatArea()); // Wrapped in safeCallback
        this._mainContent.add_child(this._createFileBin()); // Wrapped in safeCallback
        this._mainContent.add_child(this._createInputEntry()); // Wrapped in safeCallback

        this._calculateGeometry(true);

        // Setup Menu Manager for signal dropdown
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        
        const actionRow = this._createActionRow();
        this._mainContent.add_child(actionRow);

        this._setupHoverLogic();
        this._setupWindowTracking();
        this._syncHoverState();
        // Initial load and setup
        this._loadSurfaceHistory();
        this._watchOutPipe();
        this._appendMessage('system', _('Session started. Communication: %s.in/out').format(agentData.uuid), null, false, false, true);
    }

    _setupResizers(settings, edgeOffset) {
        const common = {
            onDragStart: () => {
                this.remove_all_transitions();
                if (this._hideTimeoutId) { GLib.source_remove(this._hideTimeoutId); this._hideTimeoutId = 0; }
                if (this._showTimeoutId) { GLib.source_remove(this._showTimeoutId); this._showTimeoutId = 0; }
            },
            onDragEnd: () => { if (!this.hover) this._onMouseLeave(); }
        };

        this._resizers = [];
        const updateContentAndResizers = () => {
            this._mainContent.set_width(this.width - (this._edgeOffset * 2));
            this._mainContent.set_height(this.height - (this._edgeOffset * 2));
            this._resizers.forEach(r => r.updateLayout());
            if (this.x !== this._expandedX) this._expandedX = this.x; // Keep _expandedX in sync if dialog moves
        };

        // 1. Inner Side Resizer
        this._resizers.push(new AgentResizeHandler(this, settings, {
            ...common,
            minWidth: this._minWidth, minHeight: this._minHeight,
            edge: (this._side === 1) ? 'left' : 'right',
            edgeOffset,
            callbacks: { onResize: updateContentAndResizers }
        }));

        // 2. Top Resizer
        this._resizers.push(new AgentResizeHandler(this, settings, {
            ...common,
            minWidth: this._minWidth, minHeight: this._minHeight,
            edge: 'top',
            edgeOffset,
            callbacks: { onResize: updateContentAndResizers }
        }));

        // 3. Bottom Resizer
        this._resizers.push(new AgentResizeHandler(this, settings, {
            ...common,
            minWidth: this._minWidth, minHeight: this._minHeight,
            edge: 'bottom',
            edgeOffset,
            callbacks: { onResize: updateContentAndResizers }
        }));

        // 4. Outer Side Resizer
        this._resizers.push(new AgentResizeHandler(this, settings, {
            ...common,
            minWidth: this._minWidth, minHeight: this._minHeight,
            edge: (this._side === 1) ? 'right' : 'left',
            edgeOffset,
            callbacks: { onResize: updateContentAndResizers }
        }));
    }

    /**
     * Beregner ideell geometri for vinduet basert på gjeldende eller standard innstillinger.
     * Dette sikrer en konsistent "clean slate" både ved oppstart og reset.
     * @param {boolean} useDefaults - Om standardverdier fra schema skal brukes.
     */
    _calculateGeometry(useDefaults = false) {
        if (!useDefaults) {
            const x = this._settings.get_int('agent-window-x');
            const y = this._settings.get_int('agent-window-y');
            const width = this._settings.get_int('agent-window-width');
            const height = this._settings.get_int('agent-window-height');
            
            if (x !== -1 && y !== -1 && width !== -1 && height !== -1)
                return { x, y, width, height };
        }

        // Fallback / Reset (Clean Slate): Beregn geometri fra monitor/panel
        const monitor = Main.layoutManager.primaryMonitor;
        const panelHeight = Main.panel.height;

        const topMargin = this._settings.get_int('agent-window-top-margin');
        const bottomMargin = this._settings.get_int('agent-window-bottom-margin');

        // Get configurable default width parameters
        const defaultWidthScale = this._settings.get_double('agent-window-default-scale-width');
        const maxDefaultWidth = this._settings.get_int('agent-window-default-max-width');
        const width = Math.min(monitor.width * defaultWidthScale, maxDefaultWidth) + (2 * this._edgeOffset);
        
        let y = monitor.y + panelHeight - this._edgeOffset;
        if (y < monitor.y + topMargin)
            y = monitor.y + topMargin;

        const height = (monitor.y + monitor.height) - bottomMargin - y + this._edgeOffset;

        const x = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL
            ? monitor.x - this._edgeOffset
            : monitor.x + monitor.width - width + this._edgeOffset;

        return { x, y, width, height };
    }

    _performHardReset() {
        this._refreshLayoutFromSettings(true);
    }

    /**
     * Sjekker om Drop-vinduet overlapper med andre applikasjonsvinduer
     * på nåværende monitor og workspace.
     * @returns {boolean} true hvis vinduet er okludert eller okluderer andre.
     */
    _checkOcclusion() {
        const monitor = Main.layoutManager.primaryMonitor;
        const workspace = global.workspace_manager.get_active_workspace();

        // Sjekk mot arealet der vinduet faktisk vises (ekspandert tilstand)
        // Vi legger til en liten margin (2px) for å unngå "kant-i-kant" problemer
        const myRect = {
            x1: this._expandedX + this._edgeOffset + 2,
            y1: this.y + this._edgeOffset + 2,
            x2: this._expandedX + this.width - this._edgeOffset - 2,
            y2: this.y + this.height - this._edgeOffset - 2
        };

        const NORMAL_WINDOW_TYPES = [0, 3, 4]; // Normal, Dialog, Modal
        const windowActors = global.get_window_actors().filter(actor => {
            const win = actor.get_meta_window();
            return win &&
                   win.get_monitor() === monitor.index &&
                   (win.get_workspace() === workspace || win.is_on_all_workspaces()) &&
                   win.showing_on_its_workspace() &&
                   !win.is_skip_taskbar() &&
                   NORMAL_WINDOW_TYPES.includes(win.get_window_type());
        });

        return windowActors.some(actor => {
            const rect = actor.get_meta_window().get_frame_rect();
            // AABB kollisjonsdeteksjon mellom Meta.Rectangle og vårt målområde
            return !(rect.x >= myRect.x2 ||
                     (rect.x + rect.width) <= myRect.x1 ||
                     rect.y >= myRect.y2 ||
                     (rect.y + rect.height) <= myRect.y1);
        });
    }

    _setupWindowTracking() {
        const trackWindow = (win) => {
            if (!win) return;
            this._windowSignals.push({ win, id: win.connect('position-changed', () => this._syncHoverState()) });
            this._windowSignals.push({ win, id: win.connect('size-changed', () => this._syncHoverState()) });
        };

        this._displaySignals = [
            global.display.connect('window-created', (d, win) => trackWindow(win)),
            global.display.connect('restacked', () => this._syncHoverState()),
            global.window_manager.connect('switch-workspace', () => this._syncHoverState()),
        ];

        // Start sporing av eksisterende vinduer
        global.get_window_actors().forEach(actor => trackWindow(actor.get_meta_window()));
    }

    _clearWindowTracking() {
        if (this._displaySignals)
            this._displaySignals.forEach(id => global.display.disconnect(id));
        if (this._windowSignals)
            this._windowSignals.forEach(obj => obj.win.disconnect(obj.id));
    }

    _refreshLayoutFromSettings(forceDefaults = false) {
        const geo = this._calculateGeometry(forceDefaults);
        const monitor = Main.layoutManager.primaryMonitor;
        
        this._side = (geo.x + geo.width / 2 > monitor.x + monitor.width / 2) ? 1 : 0;
        this._expandedX = geo.x;

        // Beregn translation som flytter vinduet helt ut av skjermen fra der det står
        let targetTranslation = 0;
        if (this._isCollapsed) {
            targetTranslation = (this._side === 1)
                ? (monitor.x + monitor.width - geo.x - this._edgeOffset) 
                : -(geo.x + geo.width - monitor.x - this._edgeOffset);
        }

        this.remove_all_transitions();
        this._animating = true;

        this.ease({
            x: geo.x,
            y: geo.y,
            width: geo.width,
            height: geo.height,
            translation_x: targetTranslation,
            duration: this._isCollapsed ? 0 : 500,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._mainContent.set_size(geo.width - (this._edgeOffset * 2), geo.height - (this._edgeOffset * 2));
                this._resizers.forEach(r => r.updateLayout());
                this._animating = false;
            }
        });
    }

    _setupWindowLayout(geo) {
        this._mainContent = new St.BoxLayout({
            style_class: 'agent-window',
            vertical: true,
            x: this._edgeOffset,
            y: this._edgeOffset,
            width: geo.width - (this._edgeOffset * 2),
            height: geo.height - (this._edgeOffset * 2),
        });

        this.set_position(geo.x, geo.y);
        this._expandedX = geo.x;
        this.translation_x = (this._side === 1) ? (geo.width - this._edgeOffset * 2) : -(geo.width - this._edgeOffset * 2);
        this._isCollapsed = true; // Ensure it starts collapsed
    }

    _setupPaths() {
        const agentData = this._agent;
        const runDir = agentData.isSystem ? '/run/hera' : GLib.build_filenamev([GLib.get_user_runtime_dir(), 'hera']);
        this._inPipePath = GLib.build_filenamev([runDir, `${agentData.uuid}.in`]);
        this._outPipePath = GLib.build_filenamev([runDir, `${agentData.uuid}.out`]);

        let logDir;
        if (agentData.isSystem) {
            logDir = '/var/log/hera';
        } else {
            logDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'hera', 'logs']);
            GLib.mkdir_with_parents(logDir, 0o700);
        }
        
        // Surface log: The visible "effects" and communication
        this._surfaceLogPath = GLib.build_filenamev([logDir, `${agentData.uuid}.log`]);
        // Observation log: Future placeholder for agent-side internal observations
        this._observationLogPath = GLib.build_filenamev([logDir, `${agentData.uuid}.obs`]);
    }

    _getAgentDisplayName() {
        const agent = this._agent;
        if (agent.callsign) {
            const shortId = agent.short || (agent.uuid ? agent.uuid.substring(0, 4) : null);
            return shortId ? _('%s (%s)').format(agent.callsign, shortId) : agent.callsign;
        }
        return agent.uuid || agent.model || _('Unknown Agent');
    }

    _createHeader() {
        const header = new St.BoxLayout({ vertical: false, style_class: 'drop-header' });

        const displayName = this._getAgentDisplayName();

        const titleLabel = new St.Label({
            text: displayName.toUpperCase(),
            style_class: 'drop-title',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            reactive: true,
            track_hover: true,
        });

        titleLabel.connect('button-press-event', AgentUtils.safeCallback(() => {
            this._showAgentReport();
            return Clutter.EVENT_STOP;
        }, 'AgentHeaderClick'));

        header.add_child(titleLabel);
        return header;
    }

    _createChatArea() {
        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            y_expand: true,
            x_expand: true,
            style_class: 'agent-chat-scroll',
        });
        
        this._vAdj = this._scroll.get_vadjustment(); // eslint-disable-line no-unused-vars
        this._vAdj.connect('notify::value', AgentUtils.safeCallback(() => {
            if (this._vAdj.value <= this._vAdj.lower && !this._loadingMore && this._surfaceOffset > 0) {
                this._loadMoreSurfaceHistory();
            }
        }, 'AgentScroll'));

        this._logBin = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: false,
            y_align: Clutter.ActorAlign.START,
        });
        this._scroll.set_child(this._logBin);
        return this._scroll;
    }

    _createFileBin() {
        this._fileBin = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_expand: false,
            style_class: 'agent-file-bin'
        });
        
        this._chipsBox = new St.BoxLayout({
            vertical: false,
            style_class: 'agent-file-chips-box',
            x_expand: true,
        });
        this._fileBin.add_child(this._chipsBox);

        const attachBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'mail-attachment-symbolic',
                icon_size: 14,
            }),
            style_class: 'agent-button',
        });
        attachBtn.connect('clicked', AgentUtils.safeCallback(() => this._onAttachClicked(), 'AgentAttachClick'));
        this._fileBin.add_child(attachBtn);

        return this._fileBin;
    }

    _createInputEntry() {
        this._entry = new St.Entry({
            hint_text: _('Send message to agent...'),
            can_focus: true,
            reactive: true,
            x_expand: true,
            style_class: 'agent-input-entry'
        });

        const clutterText = this._entry.clutter_text;
        clutterText.single_line_mode = false;
        clutterText.line_wrap = true;
        clutterText.line_wrap_mode = Pango.WrapMode.WORD;
        clutterText.editable = true;
        clutterText.reactive = true;

        this._entry.connect('button-press-event', AgentUtils.safeCallback(() => {
            clutterText.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        }, 'AgentEntryClick'));
        
        clutterText.connect('key-press-event', AgentUtils.safeCallback((actor, event) => {
            const symbol = event.get_key_symbol();
            const modifiers = event.get_state();
            const hasShift = (modifiers & Clutter.ModifierType.SHIFT_MASK) !== 0;

            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                if (hasShift) {
                    return Clutter.EVENT_PROPAGATE;
                } else {
                    this._handleSend();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }, 'AgentKeyPress'));
        return this._entry;
    }

    _createActionRow() {
        const actionRow = new St.BoxLayout({
            vertical: false,
            style_class: 'agent-action-row',
            x_expand: true
        });

        const createSignalBtn = (id, labelOrIcon, signal, isLeftGroup = false) => {
            const isIcon = labelOrIcon.endsWith('-symbolic');
            const content = new St.BoxLayout({ style_class: 'drop-signal-content' });
            
            let label = null;
            let icon = null;

            if (isIcon) {
                icon = new St.Icon({ icon_name: labelOrIcon, icon_size: 14 });
                content.add_child(icon);
            } else {
                label = new St.Label({ text: labelOrIcon, style_class: 'agent-signal-label' });
                content.add_child(label);
            }

            const spinner = new St.Icon({
                icon_name: 'process-working-symbolic',
                icon_size: 14,
                visible: false,
            });
            content.add_child(spinner);

            const btn = new St.Button({
                child: content,
                style_class: `agent-button agent-signal-button ${isLeftGroup ? 'agent-signal-button-left' : ''}`,
                can_focus: true,
            });

            btn.connect('clicked', AgentUtils.safeCallback(() => this._sendSignal(signal), `AgentSignalBtn_${id}`));
            
            this._signalButtons[id] = {
                button: btn,
                label: label,
                icon: icon,
                spinner: spinner,
                signal: signal
            };
            
            return btn;
        };

        // Create a grouped signal button (Main action + Dropdown)
        const sigGroup = new St.BoxLayout({ style_class: 'agent-signal-group' });
        actionRow.add_child(sigGroup);

        const intBtn = createSignalBtn('INT', _('Interrupt'), 'INT', true);
        sigGroup.add_child(intBtn);

        const menuBtn = new St.Button({
            style_class: 'agent-button agent-signal-dropdown-button',
            child: new St.Icon({ 
                icon_name: 'pan-down-symbolic', 
                icon_size: 12, 
            }),
        });
        sigGroup.add_child(menuBtn);

        // Setup the signal ladder menu
        this._sigMenu = new PopupMenu.PopupMenu(menuBtn, 0, St.Side.BOTTOM);
        this._sigMenu.connect('open-state-changed', (menu, isOpen) => {
            if (!isOpen && !this.hover)
                this._onMouseLeave();
        });
        this._menuManager.addMenu(this._sigMenu);
        Main.uiGroup.add_child(this._sigMenu.actor);
        this._sigMenu.actor.hide();

        [
            { label: _('Interrupt (SIGINT)'), sig: 'INT' }, // This line is not changed, but it's in the context
            { label: _('Terminate (SIGTERM)'), sig: 'TERM' },
            { label: _('Kill (SIGKILL)'), sig: 'KILL' },
        ].forEach(AgentUtils.safeCallback(item => {
            const mi = new PopupMenu.PopupMenuItem(item.label);
            mi.connect('activate', () => this._sendSignal(item.sig));
            this._sigMenu.addMenuItem(mi);
        }, 'AgentSignalMenuItem'));
        menuBtn.connect('clicked', AgentUtils.safeCallback(() => this._sigMenu.toggle(), 'AgentSignalMenuToggle'));

        actionRow.add_child(createSignalBtn('STOP', 'media-playback-pause-symbolic', 'STOP'));
        actionRow.add_child(createSignalBtn('CONT', 'media-playback-start-symbolic', 'CONT'));

        const spacer = new St.Widget({ x_expand: true });
        actionRow.add_child(spacer);

        const aboutBtn = new St.Button({
            label: _('Agent Info'),
            style_class: 'agent-about-button',
            y_align: Clutter.ActorAlign.CENTER
        });
        aboutBtn.connect('clicked', AgentUtils.safeCallback(() => this._showAgentReport(), 'AgentAboutBtn'));
        actionRow.add_child(aboutBtn);
        return actionRow;
    }

    _showAgentReport() {
        const report = {
            [_('Agent')]: this._agent.callsign || _('N/A'),
            [_('UUID')]: this._agent.uuid || _('N/A'),
            [_('PID')]: this._agent.pid || _('N/A'),
            [_('System')]: this._agent.isSystem ? _('Yes') : _('No'),
            [_('Description')]: this._agent.description || _('No description available.')
        };
        this._appendMessage('system', report);
    }

    _setupHoverLogic() {
        this._isCollapsed = true;
        this.connect('notify::hover', AgentUtils.safeCallback(() => {
            this._syncHoverState();
        }, 'AgentHoverNotify'));
    }

    _syncHoverState() {
        if (this._animating) return;
        const isAnyDragging = this._resizers.some(r => r.isDragging);
        if (isAnyDragging) return;

        const occluded = this._checkOcclusion();

        if (this.hover) {
            if (this._isCollapsed) this._onMouseEnter();
        } else {
            if (occluded && !this._isCollapsed) this._onMouseLeave();
            else if (!occluded && this._isCollapsed) this._onMouseEnter();
        }
    }

    _onAttachClicked() {
        const title = _('Select Context Files');
        // Use an async IIFE to handle the promise from selectFilesFromPortal
        (async () => {
            try { // eslint-disable-line no-empty
                const uris = await AgentUtils.selectFilesFromPortal(title, true);
                for (const uri of uris) {
                    if (this._attachments.some(entry => entry.file.get_uri() === uri)) continue; // This is fine
                    const file = Gio.File.new_for_uri(uri);
                    if (await AgentUtils.isPlainText(file)) {
                        this._attachments.push({ file, selected: true }); // eslint-disable-line max-len
                    } else {
                        this._appendMessage('system', _('File “%s” is not plain text and was ignored.').format(file.get_basename()), null, false);
                    }
                }
                this._updateFileBin();
            } catch (e) {
                // User cancelled the dialog or an error occurred.
                // The error is already logged by safeCallback in HeraUtils, or it's a user cancellation.
                // No need to show an error message to the user for cancellation.
                if (e.message !== _('File selection cancelled or failed.')) {
                    this._appendMessage('system', _('AgentInteraction: Portal error: %s').format(e.message), null, false);
                }
            }
        })();
    }

    _updateFileBin() {
        this._chipsBox.destroy_all_children();
        
        this._attachments.forEach(entry => {
            const chip = new St.BoxLayout({
                style_class: 'agent-file-chip',
                x_align: Clutter.ActorAlign.START,
                reactive: true,
                track_hover: true,
            });

            const statusIcon = new St.Icon({
                icon_name: entry.selected ? 'object-select-symbolic' : 'dialog-close-symbolic',
                icon_size: 12,
                style_class: entry.selected ? 'agent-file-chip-icon-selected' : 'agent-file-chip-icon-deselected',
                style: 'margin-right: 6px;'
            });

            const label = new St.Label({ 
                text: entry.file.get_basename(),
                style: 'font-size: 0.8em; color: #ddd;'
            });

            chip.add_child(statusIcon);
            chip.add_child(label);
            chip.connect('button-press-event', AgentUtils.safeCallback(() => {
                entry.selected = !entry.selected;
                this._updateFileBin();
                return Clutter.EVENT_STOP;
            }, 'AgentFileChipClick'));
            this._chipsBox.add_child(chip);
        });
    }

    _onMouseLeave() {
        if (this._animating || this._isCollapsed) return;
        const isAnyDragging = this._resizers.some(r => r.isDragging);
        if (isAnyDragging || this._entry.clutter_text.has_focus || (this._sigMenu && this._sigMenu.isOpen) || !this._checkOcclusion())
            return;
        
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        
        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, AgentUtils.safeCallback(() => {
            this._hideTimeoutId = 0;
            const stillOccluded = this._checkOcclusion();
            if (this._resizers.some(r => r.isDragging) || !stillOccluded || this.hover) 
                return GLib.SOURCE_REMOVE;

            const monitor = Main.layoutManager.primaryMonitor; // eslint-disable-line no-unused-vars
            if (!this._isCollapsed) this._expandedX = this.x;
            this._animating = true; // Sett flagget FØR GSettings for å blokkere "changed"-loop

            // Utled skjul-retning fra nåværende posisjon
            const isRight = (this.x + this.width / 2 > monitor.x + monitor.width / 2);
            const targetTranslation = isRight 
                ? (monitor.x + monitor.width - this.x - this._edgeOffset) 
                : -(this.x + this.width - monitor.x - this._edgeOffset);

            this.ease({
                x: this.x,
                translation_x: targetTranslation,
                duration: 500,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: AgentUtils.safeCallback(() => {
                    this._isCollapsed = true;
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, AgentUtils.safeCallback(() => {
                        this._animating = false;
                        this._syncHoverState();
                        return GLib.SOURCE_REMOVE;
                    }, 'AgentHideCooldown'));
                }, 'AgentHideComplete')
            });
            return GLib.SOURCE_REMOVE;
        }, 'AgentHideTimeout'));
    }

    _onMouseEnter() {
        if (this._animating || !this._isCollapsed || this._resizers.some(r => r.isDragging)) return;

        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (this._showTimeoutId) return; // eslint-disable-line no-empty
        this._showTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, AgentUtils.safeCallback(() => {
            this._showTimeoutId = 0;
            this._animating = true;
            this.ease({
                x: this._expandedX,
                translation_x: 0,
                duration: 500,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: AgentUtils.safeCallback(() => {
                    this._isCollapsed = false;
                    this._entry.clutter_text.grab_key_focus();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, AgentUtils.safeCallback(() => {
                        this._animating = false;
                        this._syncHoverState();
                        return GLib.SOURCE_REMOVE;
                    }, 'AgentShowCooldown'));
                }, 'AgentShowComplete')
            });
            return GLib.SOURCE_REMOVE;
        }, 'AgentShowTimeout'));
    }

    /**
     * Creates and returns a St.BoxLayout representing a single message bubble.
     * Handles styling, sender info, message text, and attachments.
     * @param {string} sender - 'user', 'agent', or 'system'.
     * @param {string} text - The message text.
     * @param {string} displayTime - Formatted time string.
     * @param {boolean} isMeta - True if this is a meta-message (e.g., signal confirmation).
     * @param {Array<Gio.File|object>} attachments - List of attachment files or objects with get_basename().
     * @param {boolean} indent - True if the message should be indented (e.g., for signal confirmations).
     * @returns {St.BoxLayout} The constructed message bubble.
     */
    _createMessageBubble(sender, text, displayTime, isMeta, attachments, indent) {
        const isUser = sender === 'user';
        const isSystem = sender === 'system';
        const isMetaMsg = isMeta || isSystem;

        const styleClasses = ['agent-message-bubble'];
        if (isUser) styleClasses.push('agent-message-user');
        else if (isSystem) styleClasses.push('agent-message-system');
        else styleClasses.push('agent-message-agent');
        
        if (isMetaMsg) styleClasses.push('agent-message-meta');
        if (indent) styleClasses.push('agent-message-indented');

        const msgBox = new St.BoxLayout({
            vertical: true,
            style_class: styleClasses.join(' '),
            x_align: isUser ? Clutter.ActorAlign.END : (isSystem ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START),
        });

        const senderName = isUser ? _('You') : this._getAgentDisplayName();
        const meta = new St.Label({
            text: _('%s • %s').format(senderName, displayTime),
            style_class: 'agent-message-meta-label'
        });
        msgBox.add_child(meta);

        if (typeof text === 'object' && text !== null) {
            msgBox.add_child(this._createReportGrid(text));
        } else if (text && text.length > 0) {
            // Escape agent output to prevent Pango markup injection
            const displayedText = (sender === 'agent' || sender === 'system') ? AgentUtils.escapePango(text) : text;
            const content = new St.Label({
                text: displayedText,
                style_class: 'agent-message-content',
                x_expand: true,
            });
            content.clutter_text.line_wrap = true;
            content.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
            content.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            msgBox.add_child(content);
        }

        if (attachments.length > 0) {
            const attachmentsRow = new St.BoxLayout({ vertical: false, style_class: 'agent-message-attachments', x_expand: true });
            attachments.forEach(file => {
                const chip = new St.BoxLayout({ vertical: false, style_class: 'agent-message-attachment-chip' });
                // Ensure basename is available, or use a placeholder
                const fileName = file.get_basename ? file.get_basename() : String(file);
                chip.add_child(new St.Label({ text: fileName, style: 'font-size: 0.8em; color: #ddd;' }));
                attachmentsRow.add_child(chip);
            });
            msgBox.add_child(attachmentsRow);
        }
        return msgBox;
    }

    _createReportGrid(data) {
        const grid = new St.BoxLayout({ vertical: true, style_class: 'agent-report-grid' });
        for (const [key, value] of Object.entries(data)) {
            const row = new St.BoxLayout({ vertical: false, style_class: 'agent-report-row' });
            const keyLabel = new St.Label({ 
                text: `${key}:`, 
                style_class: 'agent-report-key'
            });
            const valLabel = new St.Label({ text: String(value), style_class: 'agent-report-val' });
            row.add_child(keyLabel);
            row.add_child(valLabel);
            grid.add_child(row);
        }
        return grid;
    }

    _appendMessage(sender, text, time = null, save = true, prepend = false, skipLimit = false, isMeta = false, attachments = [], indent = false) {
        const date = time ? new Date(time) : new Date();
        const timestamp = date.toISOString();
        const displayTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // --- Input Filtering (User to Agent) ---
        // For user input, `HeraUtils.sendToAgent` already uses TextEncoder, which handles basic encoding for transport. // eslint-disable-line max-len
        // If specific filtering (e.g., removing certain characters or patterns) is needed *before* sending to the agent,
        // it should be implemented here or in HeraUtils.sendToAgent. For a general chat, usually all text is allowed.
        // The agent itself should be robust against malicious input.

        if (!skipLimit) {
            const children = this._logBin.get_children();
            if (children.length >= this._maxDisplayMessages) {
                if (prepend) children[children.length - 1].destroy(); // eslint-disable-line max-len
                else children[0].destroy();
            }
        }
        const msgBox = this._createMessageBubble(sender, text, displayTime, isMeta, attachments, indent);
        
        if (prepend) this._logBin.insert_child_at_index(msgBox, 0);
        else this._logBin.add_child(msgBox);

        if (!prepend) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._vAdj.value = this._vAdj.upper - this._vAdj.page_size;
                return GLib.SOURCE_REMOVE;
            });
        }
        if (save && sender !== 'system') this._saveToSurfaceLog(sender, text, timestamp, isMeta, attachments);
    }

    /**
     * Renders a batch of history lines.
     * @param {string[]} lines - Array of JSON strings.
     * @param {boolean} prepend - Whether to prepend or append.
     */
    _renderLogLines(lines, prepend) {
        if (prepend) {
            for (let i = lines.length - 1; i >= 0; i--) {
                const msg = AgentUtils.parseLogLine(lines[i]);
                if (msg) // eslint-disable-line no-empty
                    this._appendMessage(msg.sender, msg.text, msg.timestamp, false, true, true, msg.isMeta, msg.attachments);
            }
        } else {
            lines.forEach(line => {
                const msg = AgentUtils.parseLogLine(line);
                if (msg)
                    this._appendMessage(msg.sender, msg.text, msg.timestamp, false, false, true, msg.isMeta, msg.attachments);
            });
        }
    }

    _saveToSurfaceLog(sender, text, timestamp, isMeta = false, attachments = []) {
        try {
            const attachmentNames = attachments.map(file => file.get_basename());
            const entry = JSON.stringify({ sender, text, timestamp, isMeta, attachments: attachmentNames }) + '\n';
            const file = Gio.File.new_for_path(this._surfaceLogPath);
            const outputStream = file.append_to(Gio.FileCreateFlags.NONE, null);
            outputStream.write_all(entry, null);
            outputStream.close(null);
        } catch (e) { console.error(`Drop: Failed to save surface log: ${e.message}`); }
    }

    _loadSurfaceHistory() {
        const file = Gio.File.new_for_path(this._surfaceLogPath);
        if (!file.query_exists(null)) return;
        this._surfaceFileIndex = 0;
        try {
            const [success, contents] = file.load_contents(null);
            if (success) {
                const allLines = new TextDecoder().decode(contents).split('\n').filter(l => l.trim());
                const recentLines = allLines.slice(-this._maxDisplayMessages);
                this._surfaceOffset = recentLines.length;
                this._renderLogLines(recentLines, false);
                this._appendMessage('system', _('--- Session Restored ---'), null, false, false, true);
            }
        } catch (e) { console.error(`Drop: Failed to load surface history: ${e.message}`); }
    }

    _loadMoreSurfaceHistory() {
        if (this._loadingMore) return;
        this._loadingMore = true;

        const attemptLoad = () => {
            const currentPath = this._surfaceFileIndex === 0
                ? this._surfaceLogPath
                : `${this._surfaceLogPath}.${this._surfaceFileIndex}`;
            
            const file = Gio.File.new_for_path(currentPath);

            if (!file.query_exists(null)) {
                this._loadingMore = false;
                return;
            }

            try {
                const [success, contents] = file.load_contents(null);
                if (success) {
                    const allLines = new TextDecoder().decode(contents).split('\n').filter(l => l.trim());
                    
                    if (this._surfaceOffset >= allLines.length) {
                        // Reached the top of this file, try the next rotation (.log.N)
                        this._surfaceFileIndex++;
                        this._surfaceOffset = 0;
                        attemptLoad();
                        return;
                    }

                const res = AgentUtils.getLinesToDisplay(allLines, this._surfaceOffset, Math.floor(this._maxDisplayMessages / 2)); // eslint-disable-line max-len
                    if (res.lines.length > 0) {
                        this._renderLogLines(res.lines, true);
                        this._surfaceOffset = res.newOffset;
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                            if (this._vAdj.value <= this._vAdj.lower) this._vAdj.value = 20;
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            } catch (e) {
                console.error(`Drop: Error loading rotated surface history: ${e.message}`);
            }
            this._loadingMore = false;
        };

        attemptLoad();
    }

    show() {
        if (!this.get_parent()) Main.layoutManager.addChrome(this, { trackHover: true });

        const parent = this.get_parent();
        if (parent) {
            // Move the window to the top of the stack (Z-order) in the chrome layer.
            this.raise_top();
        }

        // If the window is hidden on the side, animate it forward.
        // Otherwise, just give focus to the text field.
        if (this._isCollapsed)
            this._onMouseEnter();
        else
            this._entry.clutter_text.grab_key_focus();
    }

    destroy() {
        if (this._hideTimeoutId) GLib.source_remove(this._hideTimeoutId);
        if (this._showTimeoutId) GLib.source_remove(this._showTimeoutId);

        if (this._settingsHandlerId) {
            this._settings.disconnect(this._settingsHandlerId);
            this._settingsHandlerId = 0;
        }
        this._clearWindowTracking();

        this._resizers.forEach(r => r.destroy());

        if (this._sigMenu) {
            this._sigMenu.destroy();
            this._sigMenu = null;
        }

        if (this.get_parent()) Main.layoutManager.removeChrome(this);
        super.destroy();
    }

    updateState(agentData) {
        this._agent = agentData;
        const status = agentData.status;
        const sActive = this._settings.get_string('status-active');
        const sInactive = this._settings.get_string('status-inactive');
        if (AgentUtils.isStatusMatch(sInactive, status)) {
            this._setButtonState('STOP', 'active');
            this._setButtonState('CONT', 'idle');
        } else if (AgentUtils.isStatusMatch(sActive, status)) {
            this._setButtonState('CONT', 'active');
            this._setButtonState('STOP', 'idle');
        }
    }

    _watchOutPipe() {
        const file = Gio.File.new_for_path(this._outPipePath);
        file.read_async(GLib.PRIORITY_DEFAULT, null, AgentUtils.safeCallback((file, res) => {
            try {
                const stream = file.read_finish(res); // eslint-disable-line no-empty
                const dataStream = new Gio.DataInputStream({ base_stream: stream, close_base_stream: true });
                this._readNextLine(dataStream);
            } catch (e) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, AgentUtils.safeCallback(() => { this._watchOutPipe(); return GLib.SOURCE_REMOVE; }, 'AgentWatchRetry'));
            }
        }, 'AgentOutPipeReadAsync'));
    }

    _readNextLine(stream) {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, null, AgentUtils.safeCallback((stream, res) => {
            try { // eslint-disable-line no-empty
                const [line] = stream.read_line_finish_utf8(res);
                if (line !== null) {
                    this._appendMessage('agent', line);
                    this._handleAgentResponse(line);
                    this._readNextLine(stream);
                } else this._watchOutPipe();
            } catch (e) { this._watchOutPipe(); }
        }, 'AgentReadLineAsync'));
    }

    _handleAgentResponse(line) {
        const text = line.toLowerCase();
        if (text.includes('sigint handled')) {
            this._setButtonState('INT', 'active'); // eslint-disable-line max-len
            this._appendMessage('agent', _('Signal %s handled').format('SIGINT'), null, true, false, false, true, [], true); // eslint-disable-line max-len
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => { this._setButtonState('INT', 'idle'); return GLib.SOURCE_REMOVE; });
        } else if (text.includes('sigstop handled')) {
            this._setButtonState('STOP', 'active'); // eslint-disable-line max-len
            this._appendMessage('agent', _('Signal %s handled').format('SIGSTOP'), null, true, false, false, true, [], true); // eslint-disable-line max-len
            this._setButtonState('CONT', 'idle');
        } else if (text.includes('sigcont handled')) {
            this._setButtonState('CONT', 'active'); // eslint-disable-line max-len
            this._appendMessage('agent', _('Signal %s handled').format('SIGCONT'), null, true, false, false, true, [], true); // eslint-disable-line max-len
            this._setButtonState('STOP', 'idle');
        }
    }

    _setButtonState(id, state) {
        const data = this._signalButtons[id];
        if (!data) return;
        const { button, label, icon, spinner } = data;
        button.remove_style_class_name('button-pending');
        button.remove_style_class_name('button-active');
        button.remove_style_class_name('button-idle');

        if (label) label.show();
        if (icon) icon.show();
        spinner.hide();

        if (state === 'pending') {
            if (label) label.hide();
            if (icon) icon.hide();
            spinner.show();
            button.add_style_class_name('button-pending');
        } else if (state === 'active') {
            button.add_style_class_name('button-active');
        } else {
            button.add_style_class_name('button-idle');
        }
    }

    _sendSignal(sig) {
        if (!this._agent.pid) { this._appendMessage('system', _('Cannot send signal %s because the PID is unavailable').format(sig), null, true, false, false, true); return; }
        
        // Visual feedback on the main button for destructive signals as well
        const feedbackId = (sig === 'TERM' || sig === 'KILL') ? 'INT' : sig;
        this._setButtonState(feedbackId, 'pending');

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
            const data = this._signalButtons[feedbackId];
            if (data && data.button.has_style_class_name('button-pending')) this._setButtonState(feedbackId, 'idle');
            return GLib.SOURCE_REMOVE;
        });
        this._appendMessage('user', _('Sent signal %s to process with PID %s').format(sig, this._agent.pid), null, true, false, false, true, [], true);
        GLib.spawn_command_line_async(`kill -s ${sig} ${this._agent.pid}`);
    }

    async _handleSend() {
        const text = this._entry.text;
        const attachments = this._attachments.filter(entry => entry.selected).map(entry => entry.file);
        if (!text && attachments.length === 0) return;
        this._appendMessage('user', text, null, true, false, false, true, attachments);
        this._entry.text = ''; this._attachments = []; this._updateFileBin();

        try {
            await AgentUtils.sendToAgent(this._inPipePath, text, attachments);
        } catch (e) {
            this._appendMessage('system', _('Error sending to agent: %s').format(e.message));
        }
    }
});
