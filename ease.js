/*
 * Agent Interaction - A GNOME extension for communicating with Hera agents.
 * Copyright (C) 2019-2024 John Erling Blad
 */

import { AgentUtils } from './utils.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class AgentEaseHandler {
    constructor(dialog, settings) {
        this._dialog = dialog;
        this._settings = settings;
        this.isAnimating = false;
        this.isCollapsed = true;
        this.side = 0; // 0=left, 1=right
        this.expandedX = 0;
    }

    syncState(geo) {
        const monitor = Main.layoutManager.primaryMonitor;
        this.side = (geo.x + geo.width / 2 > monitor.x + monitor.width / 2) ? 1 : 0;
        this.expandedX = geo.x;
    }

    refreshLayout(geo, edgeOffset, onComplete) {
        const monitor = Main.layoutManager.primaryMonitor;
        this.syncState(geo);

        let targetTranslation = 0;
        if (this.isCollapsed) {
            targetTranslation = (this.side === 1)
                ? (monitor.x + monitor.width - geo.x - edgeOffset)
                : -(geo.x + geo.width - monitor.x - edgeOffset);
        }

        this._dialog.remove_all_transitions();
        this.isAnimating = true;

        this._dialog.ease({
            x: geo.x,
            y: geo.y,
            width: geo.width,
            height: geo.height,
            translation_x: targetTranslation,
            duration: this.isCollapsed ? 0 : 500,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: AgentUtils.safeCallback(() => {
                this.isAnimating = false;
                if (onComplete) onComplete();
            }, 'AgentEaseRefresh')
        });
    }

    collapse(edgeOffset, onSync) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!this.isCollapsed) this.expandedX = this._dialog.x;
        this.isAnimating = true;

        const isRight = (this._dialog.x + this._dialog.width / 2 > monitor.x + monitor.width / 2);
        const targetTranslation = isRight
            ? (monitor.x + monitor.width - this._dialog.x - edgeOffset)
            : -(this._dialog.x + this._dialog.width - monitor.x - edgeOffset);

        this._dialog.ease({
            x: this._dialog.x,
            translation_x: targetTranslation,
            duration: 500,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: AgentUtils.safeCallback(() => {
                this.isCollapsed = true;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, AgentUtils.safeCallback(() => {
                    this.isAnimating = false;
                    if (onSync) onSync();
                    return GLib.SOURCE_REMOVE;
                }, 'AgentEaseCollapseCooldown'));
            }, 'AgentEaseCollapse')
        });
    }

    expand(onComplete, onSync) {
        this.isAnimating = true;
        this._dialog.ease({
            x: this.expandedX,
            translation_x: 0,
            duration: 500,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: AgentUtils.safeCallback(() => {
                this.isCollapsed = false;
                if (onComplete) onComplete();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, AgentUtils.safeCallback(() => {
                    this.isAnimating = false;
                    if (onSync) onSync();
                    return GLib.SOURCE_REMOVE;
                }, 'AgentEaseExpandCooldown'));
            }, 'AgentEaseExpand')
        });
    }
}