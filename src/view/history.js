/*
 * Agent Interaction - A GNOME extension for communicating with AI agents.
 * Copyright (C) 2019-2024 John Erling Blad
 */

import { AgentUtils } from '../../utils.js';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

// In a GNOME Shell extension, _ (gettext) is made global by initTranslations().
// For tests, globalThis._ is mocked.
const _ = globalThis._ || ((s) => s);

/**
 * Handles the visual representation of messages and agent data.
 */
export class AgentSurfaceView {
    constructor(agentData) {
        this._agent = agentData;
    }

    getDisplayName() {
        const agent = this._agent;
        if (agent.callsign) {
            const shortId = agent.short || (agent.uuid ? agent.uuid.substring(0, 4) : null);
            return shortId ? _('%s (%s)').format(agent.callsign, shortId) : agent.callsign;
        }
        return agent.uuid || agent.model || _('Unknown Agent');
    }

    /**
     * Creates a message bubble widget.
     */
    createMessageBubble(sender, text, displayTime, isMeta, attachments, indent) {
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

        const senderName = isUser ? _('You') : this.getDisplayName();
        const meta = new St.Label({
            text: _('%s • %s').format(senderName, displayTime),
            style_class: 'agent-message-meta-label'
        });
        msgBox.add_child(meta);

        if (typeof text === 'object' && text !== null) {
            msgBox.add_child(this._createReportGrid(text));
        } else if (text && text.length > 0) {
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
}