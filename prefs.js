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

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import system from 'system'; // Import system for process ID
import GLib from 'gi://GLib';

export default class AgentPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Gjenopprett vindusstørrelse fra innstillinger
        let width = settings.get_int('prefs-window-width');
        let height = settings.get_int('prefs-window-height');
        if (width < 400) width = 800;
        if (height < 400) height = 600;
        window.set_default_size(width, height);

        const saveWindowSize = () => {
            const savedWidth = window.get_allocated_width();
            const savedHeight = window.get_allocated_height();
            if (savedWidth > 100 && savedHeight > 100) {
                settings.set_int('prefs-window-width', savedWidth);
                settings.set_int('prefs-window-height', savedHeight);
            }
        };

        window.connect('close-request', () => { saveWindowSize(); });

        // Create a page and a group for settings
        const page = new Adw.PreferencesPage();

        // Test tools section
        const testGroup = new Adw.PreferencesGroup({
            title: _('Test Tools (Schrödinger)')
        });

        // Bryter for å aktivere test-modus
        const testModeRow = new Adw.SwitchRow({
            title: _('Enable override'),
            subtitle: _('Ignore actual process status'),
        });
        settings.bind('test-mode-enabled', testModeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        testGroup.add(testModeRow);

        // Update group description dynamically
        const updateDescription = () => {
            testGroup.description = testModeRow.active 
                ? _('Override status for debugging') 
                : '';
        };
        testModeRow.connect('notify::active', updateDescription);
        updateDescription(); // Set initial state

        // Bryter for Dead/Alive
        const forceAliveRow = new Adw.SwitchRow({
            title: _('Agent status (Schrödinger)'),
            subtitle: _('Determine if the agent should be perceived as alive or dead'),
        });
        settings.bind('test-force-alive', forceAliveRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        testModeRow.bind_property('active', forceAliveRow, 'visible', GObject.BindingFlags.SYNC_CREATE);
        testGroup.add(forceAliveRow);

        // Button to create a fake PID file
        const jsonActionRow = new Adw.ActionRow({
            title: _('Generate Test Agent'),
            subtitle: _('Create a fake .json file in /run/user/$UID/hera'),
        });

        const createJsonFile = (status) => {
            try {
                const userRunDir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'hera']);
                const folder = Gio.File.new_for_path(userRunDir);
                
                // Create directory if it doesn't exist
                if (!folder.query_exists(null)) {
                    folder.make_directory_with_parents(null);
                }

                const filePath = GLib.build_filenamev([userRunDir, 'test-agent-1.json']);
                const file = Gio.File.new_for_path(filePath);
                
                const testObject = {
                    pid: system.pid, // Use system.pid for current process ID
                    callsign: "Schrödinger",
                    uuid: "hera-test-123",
                    status: status,
                    description: _('Last updated: %s').format(new Date().toLocaleTimeString())
                };
                const testData = JSON.stringify(testObject, null, 2);
                const contents = new TextEncoder().encode(testData);

                // Use Gio to write the file (more robust in sandboxes)
                file.replace_contents(contents, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                console.log(`AgentInteraction: Test file created in ${filePath}`);
            } catch (e) {
                console.error(`AgentInteraction: Could not create PID file (Check permissions): ${e.message}`);
            }
        };

        const activeBtn = new Gtk.Button({
            label: _('Active (Green)'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        activeBtn.connect('clicked', () => createJsonFile(settings.get_string('status-active')));

        const inactiveBtn = new Gtk.Button({
            label: _('Inactive (Yellow)'),
            valign: Gtk.Align.CENTER,
            margin_start: 6,
        });
        inactiveBtn.connect('clicked', () => createJsonFile(settings.get_string('status-inactive')));

        jsonActionRow.add_suffix(activeBtn);
        jsonActionRow.add_suffix(inactiveBtn);
        testModeRow.bind_property('active', jsonActionRow, 'visible', GObject.BindingFlags.SYNC_CREATE);
        testGroup.add(jsonActionRow);

        // Verktøy for å generere en lang test-logg
        const logActionRow = new Adw.ActionRow({
            title: _('Generate Test Log'),
            subtitle: _('Create a log file with 200 entries for hera-test-123'),
        });

        const createLogFile = () => {
            try {
                const logDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'hera', 'logs']);
                const folder = Gio.File.new_for_path(logDir);
                if (!folder.query_exists(null)) {
                    folder.make_directory_with_parents(null);
                }

                const filePath = GLib.build_filenamev([logDir, 'hera-test-123.log']);
                const file = Gio.File.new_for_path(filePath);

                const loremIpsumText = _("Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\n" +
                                         "Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris. Integer in mauris eu nibh euismod gravida. Duis ac tellus et risus vulputate vehicula. Donec lobortis risus a elit. Etiam tempor. Ut ullamcorper massa eu ligula. Cras porttitor ornare massa.\n\n" +
                                         "Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor sit amet, ante. Donec eu libero sit amet quam egestas semper. Aenean ultricies mi vitae est. Mauris placerat eleifend leo. Quisque sit amet est et sapien ullamcorper pharetra. Vestibulum erat wisi, condimentum sed, commodo vitae, ornare sit amet, wisi. Aenean fermentum, elit eget tincidunt condimentum, eros ipsum rutrum orci, sagittis tempus lacus enim ac dui. Donec non enim in turpis pulvinar facilisis. Ut felis. Praesent dapibus, neque id cursus faucibus, tortor neque egestas augu, eu vulputate magna eros eu erat. Aliquam erat volutpat. Nam dui ligula, fringilla a, euismod sodales, sollicitudin vel, wisi. Morbi auctor lorem non justo. Nam lacus libero, dignissim sit amet, adipiscing nec, dolor.");
                const paragraphs = loremIpsumText.split('\n\n');

                let logData = '';
                const now = Date.now();
                // Generate 200 messages with 10-second intervals
                for (let i = 1; i <= 200; i++) {
                    const sender = i % 2 === 0 ? 'agent' : 'user';
                    const text = paragraphs[(i - 1) % paragraphs.length];
                    // Agenten sender to paragrafer for å teste multiline-effekt, mens brukeren sender én for å se vanlig wrap
                    const formattedText = sender === 'agent' ? (text + '\n\n' + paragraphs[i % paragraphs.length]) : text;

                    const entry = {
                        sender: sender,
                        text: formattedText,
                        timestamp: new Date(now - (201 - i) * 10000).toISOString()
                    };
                    logData += JSON.stringify(entry) + '\n';
                }

                const contents = new TextEncoder().encode(logData);
                file.replace_contents(contents, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                console.log(`AgentInteraction: Test log created at ${filePath}`);
            } catch (e) {
                console.error(`AgentInteraction: Could not create log file: ${e.message}`);
            }
        };

        const logBtn = new Gtk.Button({
            label: _('Generate 200 Lines'),
            valign: Gtk.Align.CENTER,
        });
        logBtn.connect('clicked', () => createLogFile());
        logActionRow.add_suffix(logBtn);
        testModeRow.bind_property('active', logActionRow, 'visible', GObject.BindingFlags.SYNC_CREATE);
        testGroup.add(logActionRow);

        // Knapp for å slette testdata
        const resetTestBtn = new Gtk.Button({
            label: _('Reset Test Data'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetTestBtn.connect('clicked', () => {
            try {
                const userRunDir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'hera']);
                const logDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'hera', 'logs']);

                // Delete test-agent-1.json
                const testAgentFile = Gio.File.new_for_path(GLib.build_filenamev([userRunDir, 'test-agent-1.json']));
                if (testAgentFile.query_exists(null)) testAgentFile.delete(null);

                // Delete hera-test-123.log
                const testLogFile = Gio.File.new_for_path(GLib.build_filenamev([logDir, 'hera-test-123.log']));
                if (testLogFile.query_exists(null)) testLogFile.delete(null);

                console.log('AgentInteraction: Test data reset successfully.');
            } catch (e) {
                console.error(`AgentInteraction: Failed to reset test data: ${e.message}`);
            }
        });
        const resetActionRow = new Adw.ActionRow({ title: _('Clear all generated test files') });
        resetActionRow.add_suffix(resetTestBtn);
        testModeRow.bind_property('active', resetActionRow, 'visible', GObject.BindingFlags.SYNC_CREATE);
        testGroup.add(resetActionRow);

        // Status Mapping Seksjon
        const mappingGroup = new Adw.PreferencesGroup({
            title: _('Status Mapping'),
            description: _('Map agent status strings to signal colors'),
        });

        const mappingList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        mappingGroup.add(mappingList);

        const saveMappings = () => {
            let active = [], inactive = [], failed = [];
            let row = mappingList.get_first_child();
            while (row) {
                if (row._statusText && row._getCategory) {
                    const cat = row._getCategory();
                    if (cat === 0) active.push(row._statusText);
                    else if (cat === 1) inactive.push(row._statusText);
                    else if (cat === 2) failed.push(row._statusText);
                }
                row = row.get_next_sibling();
            }
            settings.set_string('status-active', active.join(','));
            settings.set_string('status-inactive', inactive.join(','));
            settings.set_string('status-failed', failed.join(','));
        };

        const addStatusRow = (status, categoryIndex) => {
            const row = new Adw.ActionRow({ title: status });
            row._statusText = status;

            const dropDown = new Gtk.DropDown({
                model: Gtk.StringList.new([_('Active (Green)'), _('Inactive (Yellow)'), _('Failed (Red)')]),
                selected: categoryIndex,
                valign: Gtk.Align.CENTER,
            });
            dropDown.connect('notify::selected', () => saveMappings());
            row._getCategory = () => dropDown.selected;

            const delBtn = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            delBtn.connect('clicked', () => {
                mappingList.remove(row);
                saveMappings();
            });

            row.add_suffix(dropDown);
            row.add_suffix(delBtn);
            mappingList.append(row);
        };

        // Initialize list from GSettings
        settings.get_string('status-active').split(',').filter(s => s.trim()).forEach(s => addStatusRow(s.trim(), 0));
        settings.get_string('status-inactive').split(',').filter(s => s.trim()).forEach(s => addStatusRow(s.trim(), 1));
        settings.get_string('status-failed').split(',').filter(s => s.trim()).forEach(s => addStatusRow(s.trim(), 2));

        const newEntryRow = new Adw.EntryRow({
            title: _('Add status string...'),
            show_apply_button: true,
        });
        newEntryRow.connect('apply', () => {
            const text = newEntryRow.text.trim().toLowerCase();
            if (text) {
                addStatusRow(text, 0);
                saveMappings();
                newEntryRow.text = '';
            }
        });
        mappingGroup.add(newEntryRow);

        // Agent Layout seksjon
        const layoutGroup = new Adw.PreferencesGroup({
            title: _('Agent Window Layout'),
            description: _('Manage the layout and size of the floating dialog window'),
        });

        const resetLayoutRow = new Adw.ActionRow({
            title: _('Reset Layout'),
            subtitle: _('Restore default placement and size'),
        });
        const resetBtn = new Gtk.Button({
            label: _('Reset to Defaults'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetBtn.connect('clicked', () => {
            settings.reset('agent-window-x');
            settings.reset('agent-window-y');
            settings.reset('agent-window-width');
            settings.reset('agent-window-height');
            settings.reset('agent-window-top-margin');
            settings.reset('agent-window-bottom-margin');
            settings.reset('agent-window-edge-offset');
            settings.reset('agent-window-min-width');
            settings.reset('agent-window-min-height');
            settings.reset('agent-window-max-display-messages');
            settings.reset('agent-window-default-scale-width');
            settings.reset('agent-window-default-max-width');
            settings.set_boolean('agent-force-reset', true); // Trigger the hard reset in dialog.js
        });
        resetLayoutRow.add_suffix(resetBtn);
        layoutGroup.add(resetLayoutRow);

        // Informasjonsgruppe (About)
        const infoGroup = new Adw.PreferencesGroup({
            title: _('Information'),
        });

        // Read version number from metadata.json
        let extensionVersion = 'Unknown';
        try {
            const extensionDir = this.extension.dir;
            const metadataFile = extensionDir.get_child('metadata.json');
            const [success, contents] = metadataFile.load_contents(null);
            if (success) {
                const metadata = JSON.parse(new TextDecoder().decode(contents));
                extensionVersion = metadata.version.toString();
            }
        } catch (e) {
            console.error(`AgentInteraction: Could not read extension version from metadata.json: ${e.message}`);
        }

        const aboutRow = new Adw.ActionRow({
            title: _('About Agent Interaction'),
            subtitle: _('Agent Interaction Version %s').format(extensionVersion),
            activatable: true,
        });
        aboutRow.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }));
        aboutRow.connect('activated', () => {
            const aboutWindow = new Adw.AboutWindow({
                transient_for: window,
                application_name: _('Agent Interaction'),
                application_icon: 'agent-interaction-state-symbolic',
                developer_name: 'John Erling Blad',
                developers: ['John Erling Blad'],
                translator_credits: 'John Erling Blad',
                version: '1.0.0',
                website: 'https://github.com/jeblad/hera',
                copyright: '© 2019-2024 John Erling Blad',
                license_type: Gtk.License.GPL_3_0,
            });
            aboutWindow.present();
        });
        infoGroup.add(aboutRow);

        page.add(layoutGroup);
        page.add(mappingGroup);
        page.add(testGroup);
        page.add(infoGroup);
        window.add(page);
    }
}
