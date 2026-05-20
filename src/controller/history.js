/*
 * Agent Interaction - A GNOME extension for communicating with Hera agents.
 * Copyright (C) 2019-2024 John Erling Blad
 */

import { AgentUtils } from '../../utils.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// In a GNOME Shell extension, _ (gettext) is made global by initTranslations().
// For tests, globalThis._ is mocked.
const _ = globalThis._ || ((s) => s);

export class AgentSurfaceHistory {
    constructor(view, logBin, vAdj, agentData, settings) {
        this._view = view;
        this._logBin = logBin;
        this._vAdj = vAdj;
        this._agent = agentData;
        this._settings = settings;

        this.offset = 0;
        this.fileIndex = 0;
        this.loadingMore = false;
        this.maxDisplayMessages = settings.get_int('agent-window-max-display-messages');

        this._setupPaths();
    }

    _setupPaths() {
        const logDir = AgentUtils.getLogDir(this._agent.isSystem);
        if (!this._agent.isSystem) {
            GLib.mkdir_with_parents(logDir, 0o700);
        }
        this.surfaceLogPath = GLib.build_filenamev([logDir, `${this._agent.uuid}.log`]);
    }

    appendMessage(sender, text, options = {}) {
        const {
            time = null,
            save = true,
            prepend = false,
            skipLimit = false,
            isMeta = false,
            attachments = [],
            indent = false
        } = options;

        const date = time ? new Date(time) : new Date();
        const timestamp = date.toISOString();
        const displayTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (!skipLimit) {
            const children = this._logBin.get_children();
            if (children.length >= this.maxDisplayMessages) {
                if (prepend) children[children.length - 1].destroy();
                else children[0].destroy();
            }
        }

        const msgBox = this._view.createMessageBubble(sender, text, displayTime, isMeta, attachments, indent);
        
        if (prepend) this._logBin.insert_child_at_index(msgBox, 0);
        else this._logBin.add_child(msgBox);

        if (!prepend) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._vAdj.value = this._vAdj.upper - this._vAdj.page_size;
                return GLib.SOURCE_REMOVE;
            });
        }

        if (save && sender !== 'system') {
            this._saveToFile(sender, text, timestamp, isMeta, attachments);
        }
    }

    _saveToFile(sender, text, timestamp, isMeta, attachments) {
        try {
            const attachmentNames = attachments.map(file => file.get_basename());
            const entry = JSON.stringify({ sender, text, timestamp, isMeta, attachments: attachmentNames }) + '\n';
            const file = Gio.File.new_for_path(this.surfaceLogPath);
            const outputStream = file.append_to(Gio.FileCreateFlags.NONE, null);
            outputStream.write_all(entry, null);
            outputStream.close(null);
        } catch (e) {
            console.error(`AgentInteraction: Failed to save log: ${e.message}`);
        }
    }

    loadInitialHistory() {
        const file = Gio.File.new_for_path(this.surfaceLogPath);
        if (!file.query_exists(null)) return;
        
        this.fileIndex = 0;
        try {
            const [success, contents] = file.load_contents(null);
            if (success) {
                const allLines = new TextDecoder().decode(contents).split('\n').filter(l => l.trim());
                const recentLines = allLines.slice(-this.maxDisplayMessages);
                this.offset = recentLines.length;
                this._renderLogLines(recentLines, false);
                this.appendMessage('system', _('--- Session Restored ---'), { save: false, skipLimit: true });
            }
        } catch (e) {
            console.error(`AgentInteraction: Failed to load initial history: ${e.message}`);
        }
    }

    loadMoreHistory() {
        if (this.loadingMore) return;
        this.loadingMore = true;

        const attemptLoad = () => {
            const currentPath = this.fileIndex === 0
                ? this.surfaceLogPath
                : `${this.surfaceLogPath}.${this.fileIndex}`;
            
            const file = Gio.File.new_for_path(currentPath);
            if (!file.query_exists(null)) {
                this.loadingMore = false;
                return;
            }

            try {
                const [success, contents] = file.load_contents(null);
                if (success) {
                    const allLines = new TextDecoder().decode(contents).split('\n').filter(l => l.trim());
                    
                    if (this.offset >= allLines.length) {
                        this.fileIndex++;
                        this.offset = 0;
                        attemptLoad();
                        return;
                    }

                    const res = AgentUtils.getLinesToDisplay(allLines, this.offset, Math.floor(this.maxDisplayMessages / 2));
                    if (res.lines.length > 0) {
                        this._renderLogLines(res.lines, true);
                        this.offset = res.newOffset;
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                            if (this._vAdj.value <= this._vAdj.lower) this._vAdj.value = 20;
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            } catch (e) {
                console.error(`AgentInteraction: Error loading historical log: ${e.message}`);
            }
            this.loadingMore = false;
        };

        attemptLoad();
    }

    _renderLogLines(lines, prepend) {
        if (prepend) {
            for (let i = lines.length - 1; i >= 0; i--) {
                const msg = AgentUtils.parseLogLine(lines[i]);
                if (msg) {
                    this.appendMessage(msg.sender, msg.text, {
                        time: msg.timestamp, save: false, prepend: true, skipLimit: true, isMeta: msg.isMeta, attachments: msg.attachments
                    });
                }
            }
        } else {
            lines.forEach(line => {
                const msg = AgentUtils.parseLogLine(line);
                if (msg) {
                    this.appendMessage(msg.sender, msg.text, {
                        time: msg.timestamp, save: false, prepend: false, skipLimit: true, isMeta: msg.isMeta, attachments: msg.attachments
                    });
                }
            });
        }
    }
}