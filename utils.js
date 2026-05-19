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

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Pure logic utilities for Hera that can be tested independently of the GNOME Shell UI.
 */
export const AgentUtils = {
    _config: {
        tight: "\\/:;!?\"'`<>|*$&()[]{}@~# ",
        loose: "\\/:?\"<>|*",
    },

    /**
     * Check if a status matches a comma-separated list from GSettings.
     */
    isStatusMatch(settingString, currentStatus) {
        if (!settingString || !currentStatus) return false;
        const targets = settingString.split(',').map(s => s.trim().toLowerCase());
        return targets.includes(currentStatus.toLowerCase());
    },

    /**
     * Returns the hex color associated with a status.
     */
    getStatusColor(settings, status) {
        const sActive = settings.get_string('status-active');
        const sInactive = settings.get_string('status-inactive');
        const sFailed = settings.get_string('status-failed');

        if (this.isStatusMatch(sActive, status)) return '#2ec27e'; // Green
        if (this.isStatusMatch(sInactive, status)) return '#f5c211'; // Yellow
        if (this.isStatusMatch(sFailed, status) || status === 'gone') return '#e01b24'; // Red
        return '#9a9996'; // Grey
    },

    /**
     * Encodes a message and attachments into a multipart/form-data payload.
     */
    buildMultipartPayload(text, attachments, boundary) {
        let chunks = [];
        const encoder = new TextEncoder();

        // Add text part
        chunks.push(encoder.encode(`--${boundary}\r\n`));
        chunks.push(encoder.encode('Content-Disposition: form-data; name="text"\r\n\r\n'));
        chunks.push(encoder.encode(`${text}\r\n`));

        // Add file parts
        for (const fileData of attachments) {
            chunks.push(encoder.encode(`--${boundary}\r\n`));
            chunks.push(encoder.encode(`Content-Disposition: form-data; name="file"; filename="${fileData.name}"\r\n`));
            chunks.push(encoder.encode('Content-Type: application/octet-stream\r\n\r\n'));
            chunks.push(fileData.contents);
            chunks.push(encoder.encode('\r\n'));
        }
        chunks.push(encoder.encode(`--${boundary}--\r\n`));

        let totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        let payload = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            payload.set(chunk, offset);
            offset += chunk.length;
        }
        return payload;
    },

    /**
     * Logic for history slicing and display limits.
     */
    getLinesToDisplay(allLines, offset, limit) {
        const start = Math.max(0, allLines.length - offset - limit);
        const end = Math.max(0, allLines.length - offset);
        const lines = allLines.slice(start, end);
        return {
            lines,
            newOffset: offset + lines.length
        };
    },

    /**
     * Parses a single line from a log file (JSON format).
     */
    parseLogLine(line) {
        try {
            const data = JSON.parse(line);
            return {
                sender: data.sender || 'unknown',
                text: data.text !== undefined ? data.text : '',
                timestamp: data.timestamp || new Date().toISOString(),
                isMeta: !!data.isMeta,
                attachments: (data.attachments || []).map(name => ({ get_basename: () => name }))
            };
        } catch (e) {
            return null;
        }
    },

    /**
     * Port of the C++ rewrite logic. Replaces forbidden characters.
     * @param {string} text - The string to sanitize.
     * @param {boolean} tight - Whether to use the strict character set.
     * @param {string} replacement - The character to use as replacement.
     */
    sanitize(text, tight = true, replacement = '_') {
        if (!text) return '';
        if (text === '.' || text === '..') return replacement;

        const illegal = tight ? this._config.tight : this._config.loose;
        let result = '';

        for (const char of text) {
            const cp = char.codePointAt(0);
            if (cp < 32 || cp === 127 || illegal.includes(char)) {
                result += replacement;
            } else {
                result += char;
            }
        }
        return result;
    },

    /**
     * Validates a string against the forbidden character sets.
     */
    validate(text, tight = true) {
        if (!text) return true;
        if (text === '.' || text === '..') return false;

        const illegal = tight ? this._config.tight : this._config.loose;
        for (const char of text) {
            const cp = char.codePointAt(0);
            if (cp < 32 || cp === 127 || illegal.includes(char))
                return false;
        }
        return true;
    },

    /**
     * Escapes a string to prevent Pango markup injection.
     * Useful when displaying untrusted text in St.Label.
     */
    escapePango(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;');
    },
    /**
     * Sends a message and optional files to the agent's input pipe.
     * This encapsulates both the encoding and the asynchronous I/O.
     */
    async sendToAgent(pipePath, text, attachmentFiles = []) {
        let payload;
        if (!attachmentFiles || attachmentFiles.length === 0) {
            payload = new TextEncoder().encode(text + '\n');
        } else {
            const boundary = `----AgentBoundary${Math.floor(Math.random() * 1000000)}`;
            let attachmentData = [];
            for (const file of attachmentFiles) {
                const [success, contents] = await new Promise((resolve, reject) => {
                    file.load_contents_async(null, (f, res) => {
                        try { resolve(f.load_contents_finish(res)); }
                        catch (e) { reject(e); }
                    });
                });
                if (success) attachmentData.push({ name: file.get_basename(), contents });
            }
            payload = this.buildMultipartPayload(text, attachmentData, boundary);
        }

        const pipe = Gio.File.new_for_path(pipePath);
        return new Promise((resolve, reject) => {
            pipe.replace_contents_async(payload, null, false, Gio.FileCreateFlags.NONE, null, (f, res) => {
                try {
                    f.replace_contents_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    },

    /**
     * Checks if a Gio.File points to a plain text file.
     * This uses GNOME's MIME-type detection (content type).
     * @param {Gio.File} file 
     * @returns {Promise<boolean>}
     */
    async isPlainText(file) {
        try {
            const info = await new Promise((resolve, reject) => {
                file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
                    Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (f, res) => {
                        try { resolve(f.query_info_finish(res)); }
                        catch (e) { reject(e); }
                    });
            });
            const contentType = info.get_content_type();
            return Gio.content_type_is_a(contentType, 'text/plain');
        } catch (e) {
            return false;
        }
    },

    /**
     * Opens a file chooser dialog via XDG Desktop Portal and returns selected file URIs.
     * @param {string} title - The title for the file chooser dialog.
     * @param {boolean} multiple - Whether to allow multiple file selections.
     * @returns {Promise<string[]>} A promise that resolves with an array of selected file URIs,
     *                               or rejects if the dialog is cancelled or an error occurs.
     */
    async selectFilesFromPortal(title, multiple = true) {
        const connection = Gio.DBus.session;
        const options = {
            'multiple': GLib.Variant.new_boolean(multiple),
            'modal': GLib.Variant.new_boolean(true)
        };

        return new Promise((resolve, reject) => {
            connection.call(
                'org.freedesktop.portal.Desktop',
                '/org/freedesktop/portal/desktop',
                'org.freedesktop.portal.FileChooser',
                'OpenFile',
                GLib.Variant.new('(ssa{sv})', ['', title, options]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                AgentUtils.safeCallback((conn, res) => {
                    try {
                        const result = conn.call_finish(res);
                        const [handlePath] = result.recursiveUnpack();

                        const signalId = connection.signal_subscribe(
                            null, 'org.freedesktop.portal.Request', 'Response', handlePath, null, Gio.DBusSignalFlags.NONE, // eslint-disable-line max-len
                            AgentUtils.safeCallback((c, sender, path, iface, signal, params) => {
                                const [response, results] = params.recursiveUnpack();
                                connection.signal_unsubscribe(signalId);
                                if (response === 0 && results.uris) resolve(results.uris);
                                else reject(new Error(_('File selection cancelled or failed.')));
                            }, 'AgentPortalResponse')
                        );
                    } catch (e) { reject(e); }
                }, 'AgentPortalCall')
            );
        });
    },

    /**
     * Wraps a callback to catch and log errors to the journal before re-throwing.
     * In GNOME Shell, 'logError' is the preferred way to log exceptions.
     */
    safeCallback(callback, prefix = 'Agent') {
        return (...args) => {
            try {
                return callback(...args);
            } catch (e) {
                if (typeof logError === 'function') logError(e, `${prefix} Exception`);
                else console.error(`${prefix} Exception: ${e.message}\n${e.stack}`);
                throw e;
            }
        };
    }
};