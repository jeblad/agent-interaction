/*
 * Agent Interaction - A GNOME extension for communicating with Hera agents.
 * Copyright (C) 2019-2024 John Erling Blad
 */

import { DropUtils } from './utils.js';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class DropResizeHandler {
    constructor(dialog, settings, options) {
        this._dialog = dialog;
        this._settings = settings;
        this._edge = options.edge; // 'top', 'bottom', 'left', 'right'
        this._callbacks = options.callbacks || {};
        this._edgeOffset = options.edgeOffset;
        this._minWidth = options.minWidth || 400;
        this._minHeight = options.minHeight || 400;
        
        this.isDragging = false;
        this._stageHandlers = [];
        this._dragTimeoutId = 0;
        this._hoverTimeoutId = 0;
        this._spacing = this._edgeOffset / 2;

        const isVertical = this._edge === 'left' || this._edge === 'right';

        this.handle = new St.Widget({ 
            style_class: 'drop-resize-handle',
            width: isVertical ? 2 * this._spacing : -1,
            height: isVertical ? -1 : 2 * this._spacing,
            reactive: true,
            track_hover: true,
            x_expand: !isVertical,
            y_expand: isVertical,
        });

        this.handle.connect('button-press-event', (actor, event) => this._onButtonPress(actor, event));
        this.handle.connect('notify::hover', DropUtils.safeCallback(() => {
            if (this.isDragging) return;
            if (this._hoverTimeoutId) {
                GLib.source_remove(this._hoverTimeoutId);
                this._hoverTimeoutId = 0;
            }

            if (this.handle.hover) {
                this._hoverTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, DropUtils.safeCallback(() => {
                    this.handle.add_style_class_name('drop-resize-handle-hover');
                    this._hoverTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                }, 'DropResizeHoverFinish'));
            } else {
                this.handle.remove_style_class_name('drop-resize-handle-hover');
            }
        }, 'DropResizeHover'));
    }

    _onButtonPress(actor, event) {
        if (this.isDragging) return Clutter.EVENT_STOP;
        this.isDragging = true;

        if (this._hoverTimeoutId) {
            GLib.source_remove(this._hoverTimeoutId);
            this._hoverTimeoutId = 0;
        }
        this.handle.add_style_class_name('drop-resize-handle-active');

        if (this._callbacks.onDragStart) this._callbacks.onDragStart();
 
        this._stageHandlers = [
            global.stage.connect('captured-event', DropUtils.safeCallback((s, e) => {
                const type = e.type();
                if (type === Clutter.EventType.MOTION) {
                    return this._onMotion(e);
                } else if (type === Clutter.EventType.BUTTON_RELEASE) {
                    return this._onButtonRelease();
                }
                return Clutter.EVENT_PROPAGATE;
            }, 'DropCapturedEvent'))
        ];

        this._dragTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 6000, DropUtils.safeCallback(() => {
            if (this.isDragging) this._onButtonRelease();
            return GLib.SOURCE_REMOVE;
        }, 'DropDragFailsafe'));

        return Clutter.EVENT_STOP;
    }

    _onButtonRelease() {
        if (this.isDragging) {
            this.isDragging = false;
            if (this._dragTimeoutId) { GLib.source_remove(this._dragTimeoutId); this._dragTimeoutId = 0; }
            if (this._stageHandlers.length > 0) {
                this._stageHandlers.forEach(id => global.stage.disconnect(id));
                this._stageHandlers = [];
            }

            this.handle.remove_style_class_name('drop-resize-handle-active');
            if (!this.handle.hover) this.handle.remove_style_class_name('drop-resize-handle-hover');

            this._settings.set_int('drop-window-x', Math.round(this._dialog.x));
            this._settings.set_int('drop-window-y', Math.round(this._dialog.y));
            this._settings.set_int('drop-window-width', Math.round(this._dialog.width));
            this._settings.set_int('drop-window-height', Math.round(this._dialog.height));

            if (this._callbacks.onDragEnd) this._callbacks.onDragEnd();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion(event) {
        const [x, y] = event.get_coords();
        const monitor = Main.layoutManager.primaryMonitor;
        const minW = this._minWidth + (this._edgeOffset * 2);
        const minH = this._minHeight + (this._edgeOffset * 2);

        if (this._edge === 'left' || this._edge === 'right') {
            if (this._edge === 'left') {
                const right = this._dialog.x + this._dialog.width;
                let newX = Math.max(monitor.x - this._edgeOffset, x - this._edgeOffset);
                if (right - newX < minW) newX = right - minW;
                this._dialog.set_x(newX);
                this._dialog.set_width(right - newX);
            } else {
                let newR = Math.min(monitor.x + monitor.width + this._edgeOffset, x + this._edgeOffset);
                if (newR - this._dialog.x < minW) newR = this._dialog.x + minW;
                this._dialog.set_width(newR - this._dialog.x);
            }
        } else {
            if (this._edge === 'top') {
                const bottom = this._dialog.y + this._dialog.height;
                const topLim = monitor.y + Main.panel.height - this._edgeOffset;
                let newY = Math.max(topLim, y - this._edgeOffset);
                if (bottom - newY < minH) newY = bottom - minH;
                this._dialog.set_y(newY);
                this._dialog.set_height(bottom - newY);
            } else {
                const botLim = monitor.y + monitor.height + this._edgeOffset;
                let newB = Math.min(botLim, y + this._edgeOffset);
                if (newB - this._dialog.y < minH) newB = this._dialog.y + minH;
                this._dialog.set_height(newB - this._dialog.y);
            }
        }

        if (this._callbacks.onResize) this._callbacks.onResize();
        return Clutter.EVENT_STOP;
    }

    attach(container) {
        this._container = container;
        this._dialog.add_child(this.handle);
        this.updateLayout();
    }

    updateLayout(container = this._container) {
        if (!container) return;
        const cw = container.width || 0;
        const ch = container.height || 0;
        const s = this._spacing;

        switch (this._edge) {
            case 'left':   this.handle.set_position(container.x - s, container.y); this.handle.set_size(2*s, ch); break;
            case 'right':  this.handle.set_position(container.x + cw - s, container.y); this.handle.set_size(2*s, ch); break;
            case 'top':    this.handle.set_position(container.x, container.y - s); this.handle.set_size(cw, 2*s); break;
            case 'bottom': this.handle.set_position(container.x, container.y + ch - s); this.handle.set_size(cw, 2*s); break;
        }
    }

    destroy() {
        if (this._hoverTimeoutId) { GLib.source_remove(this._hoverTimeoutId); this._hoverTimeoutId = 0; }
        if (this._dragTimeoutId) { GLib.source_remove(this._dragTimeoutId); this._dragTimeoutId = 0; }
        if (this._stageHandlers.length > 0) {
            this._stageHandlers.forEach(id => global.stage.disconnect(id));
            this._stageHandlers = [];
        }
    }
}