/*
 * Agent Interaction - A GNOME extension for communicating with Hera agents.
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
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { HeraUtils } from './utils.js';

const MAX_DISPLAY_MESSAGES = 50;

/**
 * A floating, non-modal window built with St for communicating with an agent.
 */
export const HeraAccessDialog = GObject.registerClass(
    { GTypeName: 'HeraAccessDialog' },
class HeraAccessDialog extends St.BoxLayout {
    _init(agentData, settings) {
        this._settings = settings;
        this._showTimeoutId = 0;
        this._hideTimeoutId = 0;
        this._surfaceOffset = 0;
        this._surfaceFileIndex = 0; // 0 is current .log, 1 is .log.1, etc.
        this._loadingMore = false;
        this._attachments = []; // List of selected attachments: { file, selected }
        this._signalButtons = {}; // Stores references to buttons
        this._agent = agentData;

        // Calculate dimensions before initialization
        const monitor = Main.layoutManager.primaryMonitor;
        const windowWidth = Math.min(monitor.width * 0.4, 900);
        const panelHeight = Main.panel.height;
        this._marginTop = settings.get_int('drop-margin-top');
        const marginBottom = settings.get_int('drop-margin-bottom');
        this._side = settings.get_int('drop-side'); // 0 = Left, 1 = Right
        const edgeOffset = 8;
        const windowHeight = monitor.height - panelHeight - this._marginTop - marginBottom - edgeOffset;
        const totalWidth = windowWidth + edgeOffset;

        // Initialize the BoxLayout itself
        super._init({
            style_class: 'hera-drop-outer-container',
            style: 'background-color: transparent;',
            vertical: true,
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_expand: true,
            width: totalWidth,
            height: windowHeight,
        });
        
        this._setupWindowLayout();
        this._setupPaths();
        
        this._mainContent.add_child(this._createHeader());
        this._mainContent.add_child(this._createChatArea());
        this._mainContent.add_child(this._createFileBin());
        this._mainContent.add_child(this._createInputEntry());
        
        // Setup Menu Manager for signal dropdown
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        
        const actionRow = this._createActionRow();
        this._mainContent.add_child(actionRow);

        this._setupHoverLogic();
        // Initial load and setup
        this._loadSurfaceHistory();
        this._watchOutPipe();
        this._appendMessage('system', _('Session started. Communication: %s.in/out').format(agentData.uuid), null, false, false, true);
    }

    _setupWindowLayout() {
        const monitor = Main.layoutManager.primaryMonitor;
        const panelHeight = Main.panel.height;
        const isRight = this._side === 1;
        const totalWidth = this.width;
        const edgeOffset = 8;

        this._mainContent = new St.BoxLayout({
            style_class: 'hera-drop-window',
            style: `background-color: rgba(30, 30, 30, 0.95); 
                    border: 1px solid rgba(255,255,255,0.1); 
                    border-radius: 24px;
                    padding: 16px;
                    margin-${isRight ? 'right' : 'left'}: ${edgeOffset}px;`,
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._mainContent);

        const xPos = isRight 
            ? monitor.x + monitor.width - totalWidth
            : monitor.x;
        
        this.set_position(xPos, monitor.y + panelHeight + this._marginTop);

        // Start in "hidden" (collapsed) state
        this.translation_x = isRight ? (this.width - 1) : -(this.width - 1);
        this._isCollapsed = true;
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
        const header = new St.BoxLayout({ vertical: false, style: 'margin-bottom: 8px;' });

        const displayName = this._getAgentDisplayName();

        const titleLabel = new St.Label({
            text: displayName.toUpperCase(),
            style: 'font-weight: bold; font-size: 1.1em; color: #3584e4;',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            reactive: true,
            track_hover: true,
        });

        titleLabel.connect('button-press-event', () => {
            this._showAgentReport();
            return Clutter.EVENT_STOP;
        });

        header.add_child(titleLabel);
        return header;
    }

    _createChatArea() {
        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            y_expand: true,
            x_expand: true,
            style_class: 'hera-chat-scroll',
        });
        
        this._vAdj = this._scroll.get_vadjustment();
        this._vAdj.connect('notify::value', HeraUtils.safeCallback(() => {
            if (this._vAdj.value <= this._vAdj.lower && !this._loadingMore && this._surfaceOffset > 0) {
                this._loadMoreSurfaceHistory();
            }
        }, 'HeraScroll'));

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
            style: 'margin-top: 8px; padding: 4px; background: rgba(255,255,255,0.03); border-radius: 14px; spacing: 6px;',
            x_expand: true,
            y_expand: false,
            style_class: 'hera-file-bin'
        });

        this._chipsBox = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 6px;',
            x_expand: true,
        });
        this._fileBin.add_child(this._chipsBox);

        const attachBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'mail-attachment-symbolic',
                icon_size: 14,
                style: 'color: rgba(255,255,255,0.6);'
            }),
            style_class: 'button',
            style: 'border-radius: 12px; padding: 6px 10px;'
        });
        attachBtn.connect('clicked', () => this._onAttachClicked());
        this._fileBin.add_child(attachBtn);

        return this._fileBin;
    }

    _createInputEntry() {
        this._entry = new St.Entry({
            hint_text: _('Send message to agent...'),
            can_focus: true,
            reactive: true,
            x_expand: true,
            style: 'margin-top: 10px; background: rgba(255,255,255,0.05); border-radius: 20px; padding: 8px 15px;'
        });

        const clutterText = this._entry.clutter_text;
        clutterText.single_line_mode = false;
        clutterText.line_wrap = true;
        clutterText.line_wrap_mode = Pango.WrapMode.WORD;
        clutterText.editable = true;
        clutterText.reactive = true;

        this._entry.connect('button-press-event', HeraUtils.safeCallback(() => {
            clutterText.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        }, 'HeraEntryClick'));

        clutterText.connect('key-press-event', HeraUtils.safeCallback((actor, event) => {
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
        }, 'HeraKeyPress'));
        return this._entry;
    }

    _createActionRow() {
        const actionRow = new St.BoxLayout({
            vertical: false,
            style: 'margin-top: 10px; spacing: 8px;',
            x_expand: true
        });

        const createSignalBtn = (id, labelOrIcon, signal, isLeftGroup = false) => {
            const isIcon = labelOrIcon.endsWith('-symbolic');
            const content = new St.BoxLayout({ style: 'spacing: 0;' });
            
            let label = null;
            let icon = null;

            if (isIcon) {
                icon = new St.Icon({
                    icon_name: labelOrIcon,
                    icon_size: 14,
                    style: 'color: rgba(255,255,255,0.7);'
                });
                content.add_child(icon);
            } else {
                label = new St.Label({
                    text: labelOrIcon,
                    style: 'font-weight: bold; font-size: 0.85em; color: rgba(255,255,255,0.7);'
                });
                content.add_child(label);
            }

            const spinner = new St.Icon({
                icon_name: 'process-working-symbolic',
                icon_size: 14,
                visible: false,
                style: 'color: rgba(255,255,255,0.8);'
            });
            content.add_child(spinner);

            const borderRadius = isLeftGroup 
                ? 'border-radius: 16px 0 0 16px;' 
                : 'border-radius: 16px;';

            const btn = new St.Button({
                child: content,
                style_class: 'button',
                can_focus: true,
                style: `${borderRadius} padding: 8px 12px; ${isLeftGroup ? 'margin-right: 0;' : ''}`
            });

            btn.connect('clicked', () => this._sendSignal(signal));
            
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
        const sigGroup = new St.BoxLayout({ style: 'spacing: 0;' });
        actionRow.add_child(sigGroup);

        const intBtn = createSignalBtn('INT', _('Interrupt'), 'INT', true);
        sigGroup.add_child(intBtn);

        const menuBtn = new St.Button({
            style_class: 'button',
            child: new St.Icon({ 
                icon_name: 'pan-down-symbolic', 
                icon_size: 12, 
                style: 'color: rgba(255,255,255,0.6);' 
            }),
            style: 'border-radius: 0 16px 16px 0; padding: 8px 6px; margin-left: -1px;'
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
            { label: _('Interrupt (SIGINT)'), sig: 'INT' },
            { label: _('Terminate (SIGTERM)'), sig: 'TERM' },
            { label: _('Kill (SIGKILL)'), sig: 'KILL' },
        ].forEach(item => {
            const mi = new PopupMenu.PopupMenuItem(item.label);
            mi.connect('activate', () => this._sendSignal(item.sig));
            this._sigMenu.addMenuItem(mi);
        });
        menuBtn.connect('clicked', () => this._sigMenu.toggle());

        actionRow.add_child(createSignalBtn('STOP', 'media-playback-pause-symbolic', 'STOP'));
        actionRow.add_child(createSignalBtn('CONT', 'media-playback-start-symbolic', 'CONT'));

        const spacer = new St.Widget({ x_expand: true });
        actionRow.add_child(spacer);

        const aboutBtn = new St.Button({
            label: _('Agent Info'),
            style: 'color: #3584e4; text-decoration: underline; font-size: 0.85em;',
            y_align: Clutter.ActorAlign.CENTER
        });
        aboutBtn.connect('clicked', () => this._showAgentReport());
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
        this.connect('notify::hover', () => {
            if (this.hover)
                this._onMouseEnter();
            else
                this._onMouseLeave();
        });
    }

    _onAttachClicked() {
        const title = _('Select Context Files');
        // Use an async IIFE to handle the promise from selectFilesFromPortal
        (async () => {
            try {
                const uris = await HeraUtils.selectFilesFromPortal(title, true);
                for (const uri of uris) {
                    if (this._attachments.some(entry => entry.file.get_uri() === uri)) continue;
                    const file = Gio.File.new_for_uri(uri);
                    if (await HeraUtils.isPlainText(file)) {
                        this._attachments.push({ file, selected: true });
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
                    this._appendMessage('system', _('Hera: Portal error: %s').format(e.message), null, false);
                }
            }
        })();
    }

    _updateFileBin() {
        this._chipsBox.destroy_all_children();
        
        this._attachments.forEach(entry => {
            const chip = new St.BoxLayout({
                style_class: 'hera-file-chip',
                style: 'background: rgba(255,255,255,0.08); border-radius: 12px; padding: 6px 10px; spacing: 6px;',
                x_align: Clutter.ActorAlign.START,
                reactive: true,
                track_hover: true,
            });

            const statusIcon = new St.Icon({
                icon_name: entry.selected ? 'object-select-symbolic' : 'dialog-close-symbolic',
                icon_size: 12,
                style: `color: ${entry.selected ? '#7cfc00' : '#ff8c00'}; margin-right: 6px;`,
            });

            const label = new St.Label({ 
                text: entry.file.get_basename(),
                style: 'font-size: 0.8em; color: #ddd;'
            });

            chip.add_child(statusIcon);
            chip.add_child(label);
            chip.connect('button-press-event', () => {
                entry.selected = !entry.selected;
                this._updateFileBin();
                return Clutter.EVENT_STOP;
            });
            this._chipsBox.add_child(chip);
        });
    }

    _onMouseLeave() {
        if (this._entry.clutter_text.has_focus || (this._sigMenu && this._sigMenu.isOpen)) return;
        
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        
        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._hideTimeoutId = 0;
            const targetTranslation = this._side === 1 ? (this.width - 1) : -(this.width - 1);
            this.ease({
                translation_x: targetTranslation,
                duration: 500,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => { this._isCollapsed = true; }
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _onMouseEnter() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (this._showTimeoutId) return;
        this._showTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._showTimeoutId = 0;
            this.ease({
                translation_x: 0,
                duration: 500,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => { 
                    this._isCollapsed = false; 
                        // Give focus to the entry field when the window is fully expanded
                    this._entry.clutter_text.grab_key_focus();
                }
            });
            return GLib.SOURCE_REMOVE;
        });
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

        let sideMargin = isUser 
            ? `margin-left: 60px; ${isMetaMsg ? 'margin-right: 40px; opacity: 0.8;' : ''}` 
            : `margin-right: 60px; ${isMetaMsg ? 'margin-left: 40px; opacity: 0.8;' : ''}`;
        
        if (indent) sideMargin += isUser ? 'margin-left: 40px;' : 'margin-right: 40px;';

        const msgBox = new St.BoxLayout({
            vertical: true,
            style: `margin-bottom: 12px; padding: 10px; border-radius: 12px; 
                    ${sideMargin} 
                    background: ${isUser ? 'rgba(53, 132, 228, 0.2)' : 'rgba(255,255,255,0.05)'};`,
            x_align: isUser ? Clutter.ActorAlign.END : (isSystem ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START),
        });

        const senderName = isUser ? _('You') : this._getAgentDisplayName();
        const meta = new St.Label({
            text: _('%s • %s').format(senderName, displayTime),
            style: 'font-size: 0.75em; color: #888; margin-bottom: 2px;'
        });
        msgBox.add_child(meta);

        if (typeof text === 'object' && text !== null) {
            msgBox.add_child(this._createReportGrid(text));
        } else if (text && text.length > 0) {
            // Escape agent output to prevent Pango markup injection
            const displayedText = (sender === 'agent' || sender === 'system') ? HeraUtils.escapePango(text) : text;
            const content = new St.Label({
                text: displayedText,
                style_class: 'hera-message-content',
                x_expand: true,
            });
            content.clutter_text.line_wrap = true;
            content.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
            content.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            msgBox.add_child(content);
        }

        if (attachments.length > 0) {
            const attachmentsRow = new St.BoxLayout({ vertical: false, style: 'margin-top: 6px; spacing: 6px;', x_expand: true });
            attachments.forEach(file => {
                const chip = new St.BoxLayout({ vertical: false, style: 'background: rgba(255,255,255,0.08); border-radius: 12px; padding: 4px 10px;' });
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
        const grid = new St.BoxLayout({ vertical: true, style: 'margin-top: 4px; spacing: 2px;' });
        for (const [key, value] of Object.entries(data)) {
            const row = new St.BoxLayout({ vertical: false, style: 'spacing: 10px;' });
            const keyLabel = new St.Label({ 
                text: `${key}:`, 
                style: 'font-weight: bold; font-size: 0.85em; color: #888; width: 85px;' 
            });
            const valLabel = new St.Label({ text: String(value), style: 'font-size: 0.85em; color: #eee;' });
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
        // For user input, `HeraUtils.sendToAgent` already uses TextEncoder, which handles basic encoding for transport.
        // If specific filtering (e.g., removing certain characters or patterns) is needed *before* sending to the agent,
        // it should be implemented here or in HeraUtils.sendToAgent. For a general chat, usually all text is allowed.
        // The agent itself should be robust against malicious input.

        if (!skipLimit) {
            const children = this._logBin.get_children();
            if (children.length >= MAX_DISPLAY_MESSAGES) {
                if (prepend) children[children.length - 1].destroy();
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
                const msg = HeraUtils.parseLogLine(lines[i]);
                if (msg)
                    this._appendMessage(msg.sender, msg.text, msg.timestamp, false, true, true, msg.isMeta, msg.attachments);
            }
        } else {
            lines.forEach(line => {
                const msg = HeraUtils.parseLogLine(line);
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
        } catch (e) { console.error(`Hera: Failed to save surface log: ${e.message}`); }
    }

    _loadSurfaceHistory() {
        const file = Gio.File.new_for_path(this._surfaceLogPath);
        if (!file.query_exists(null)) return;
        this._surfaceFileIndex = 0;
        try {
            const [success, contents] = file.load_contents(null);
            if (success) {
                const allLines = new TextDecoder().decode(contents).split('\n').filter(l => l.trim());
                const recentLines = allLines.slice(-MAX_DISPLAY_MESSAGES);
                this._surfaceOffset = recentLines.length;
                this._renderLogLines(recentLines, false);
                this._appendMessage('system', _('--- Session Restored ---'), null, false, false, true);
            }
        } catch (e) { console.error(`Hera: Failed to load surface history: ${e.message}`); }
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

                    const res = HeraUtils.getLinesToDisplay(allLines, this._surfaceOffset, Math.floor(MAX_DISPLAY_MESSAGES / 2));
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
                console.error(`Hera: Error loading rotated surface history: ${e.message}`);
            }
            this._loadingMore = false;
        };

        attemptLoad();
    }

    show() {
        if (!this.get_parent()) Main.layoutManager.addChrome(this);

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
        if (HeraUtils.isStatusMatch(sInactive, status)) {
            this._setButtonState('STOP', 'active');
            this._setButtonState('CONT', 'idle');
        } else if (HeraUtils.isStatusMatch(sActive, status)) {
            this._setButtonState('CONT', 'active');
            this._setButtonState('STOP', 'idle');
        }
    }

    _watchOutPipe() {
        const file = Gio.File.new_for_path(this._outPipePath);
        file.read_async(GLib.PRIORITY_DEFAULT, null, (file, res) => {
            try {
                const stream = file.read_finish(res);
                const dataStream = new Gio.DataInputStream({ base_stream: stream, close_base_stream: true });
                this._readNextLine(dataStream);
            } catch (e) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => { this._watchOutPipe(); return GLib.SOURCE_REMOVE; });
            }
        });
    }

    _readNextLine(stream) {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            try {
                const [line] = stream.read_line_finish_utf8(res);
                if (line !== null) {
                    this._appendMessage('agent', line);
                    this._handleAgentResponse(line);
                    this._readNextLine(stream);
                } else this._watchOutPipe();
            } catch (e) { this._watchOutPipe(); }
        });
    }

    _handleAgentResponse(line) {
        const text = line.toLowerCase();
        if (text.includes('sigint handled')) {
            this._setButtonState('INT', 'active');
            this._appendMessage('agent', _('Signal %s handled').format('SIGINT'), null, true, false, false, true, [], true);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => { this._setButtonState('INT', 'idle'); return GLib.SOURCE_REMOVE; });
        } else if (text.includes('sigstop handled')) {
            this._setButtonState('STOP', 'active');
            this._appendMessage('agent', _('Signal %s handled').format('SIGSTOP'), null, true, false, false, true, [], true);
            this._setButtonState('CONT', 'idle');
        } else if (text.includes('sigcont handled')) {
            this._setButtonState('CONT', 'active');
            this._appendMessage('agent', _('Signal %s handled').format('SIGCONT'), null, true, false, false, true, [], true);
            this._setButtonState('STOP', 'idle');
        }
    }

    _setButtonState(id, state) {
        const data = this._signalButtons[id];
        if (!data) return;
        const { button, label, icon, spinner } = data;
        button.remove_style_class_name('button-pending');
        button.remove_style_class_name('button-active');
        button.set_style(null);
        
        const isInt = id === 'INT';
        const borderRadius = isInt ? 'border-radius: 16px 0 0 16px;' : 'border-radius: 16px;';
        const margin = isInt ? 'margin-right: 0;' : '';

        if (label) label.show();
        if (icon) icon.show();
        spinner.hide();

        if (state === 'pending') {
            if (label) label.hide();
            if (icon) icon.hide();
            spinner.show();
            button.add_style_class_name('button-pending');
            button.set_style(`background-color: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); ${borderRadius} padding: 8px 12px; ${margin}`);
        } else if (state === 'active') {
            button.add_style_class_name('button-active');
            button.set_style(`background-color: #3584e4; border: 1px solid #3584e4; ${borderRadius} padding: 8px 12px; color: white; ${margin}`);
            if (label) label.set_style('color: white;');
            if (icon) icon.set_style('color: white;');
        } else if (state === 'idle') {
            button.set_style(`background-color: rgba(255,255,255,0.05); border: 1px solid transparent; ${borderRadius} padding: 8px 12px; ${margin}`);
            if (label) label.set_style('color: rgba(255,255,255,0.7);');
            if (icon) icon.set_style('color: rgba(255,255,255,0.7);');
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
            await HeraUtils.sendToAgent(this._inPipePath, text, attachments);
        } catch (e) {
            this._appendMessage('system', _('Error sending to agent: %s').format(e.message));
        }
    }
});
