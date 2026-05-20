/*
 * Agent Interaction - Logic tests for AgentSurfaceHistory
 */

import { AgentSurfaceHistory } from '../src/controller/history.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import system from 'system';

// Mock gettext
globalThis._ = (s) => s;

function assert(condition, message) {
    if (!condition) {
        print(`[FAIL] ${message}`);
        return false;
    }
    print(`[PASS] ${message}`);
    return true;
}

// Mocks for UI components
class MockView {
    constructor() { this.bubblesCreated = 0; }
    createMessageBubble(sender, text) {
        this.bubblesCreated++;
        const widget = {
            sender,
            text,
            type: 'mock-widget',
            destroy: () => {
                if (widget.parent) widget.parent.remove_child(widget);
            }
        };
        return widget;
    }
}

class MockLogBin {
    constructor() { this.children = []; }
    add_child(c) {
        this.children.push(c);
        c.parent = this;
    }
    insert_child_at_index(c, i) {
        this.children.splice(i, 0, c);
        c.parent = this;
    }
    get_children() { return this.children; }
    remove_child(c) {
        const idx = this.children.indexOf(c);
        if (idx !== -1) this.children.splice(idx, 1);
    }
}

class MockVAdj {
    constructor() {
        this.value = 0; this.upper = 100; this.lower = 0; this.page_size = 10;
    }
}

class MockSettings {
    get_int(key) {
        if (key === 'agent-window-max-display-messages') return 5;
        return 0;
    }
}

async function runTests() {
    print("Starting AgentSurfaceHistory tests...");
    let allPassed = true;

    const tmpDir = GLib.get_tmp_dir();
    const testUuid = `test-agent-${Date.now()}`;
    const agentData = { uuid: testUuid, isSystem: false };
    
    // Vi må overstyre banen for testformål så vi ikke skriver i brukerens ekte logg
    const originalUserDir = GLib.get_user_data_dir();
    // Mocking GLib.get_user_data_dir er vanskelig, så vi stoler på at _setupPaths 
    // lager en mappe i /tmp hvis vi trikser litt med miljøet eller bare sletter etterpå.

    const view = new MockView();
    const logBin = new MockLogBin();
    const vAdj = new MockVAdj();
    const settings = new MockSettings();

    const history = new AgentSurfaceHistory(view, logBin, vAdj, agentData, settings);

    // 1. Test appendMessage og UI-oppdatering
    history.appendMessage('user', 'Hello Test', { save: false });
    allPassed &= assert(logBin.children.length === 1, "Message added to logBin");
    allPassed &= assert(view.bubblesCreated === 1, "View was asked to create bubble");
    allPassed &= assert(logBin.children[0].text === 'Hello Test', "Correct content in widget");

    // 2. Test Max Messages Limit
    // Vi har satt limit til 5 i MockSettings
    history.appendMessage('agent', '1', { save: false });
    history.appendMessage('agent', '2', { save: false });
    history.appendMessage('agent', '3', { save: false });
    history.appendMessage('agent', '4', { save: false }); // Nå er det 5 totalt
    history.appendMessage('agent', '5', { save: false }); // Nå skal den første ('Hello Test') forsvinne
    
    allPassed &= assert(logBin.children.length === 5, "Strictly respects maxDisplayMessages");
    allPassed &= assert(logBin.children[0].text === '1', "Oldest message was pruned");

    // 3. Test Filsystem-interaksjon (Lagring)
    const testMsg = "Persistence test content";
    history.appendMessage('user', testMsg, { save: true });
    
    const logFile = Gio.File.new_for_path(history.surfaceLogPath);
    allPassed &= assert(logFile.query_exists(null), "Log file was created on disk");

    const [success, contents] = logFile.load_contents(null);
    const decoded = new TextDecoder().decode(contents);
    allPassed &= assert(decoded.includes(testMsg), "File contains the saved message");

    // 4. Test Lasting av historikk
    // Lag en kontrollert loggfil
    const manualLogPath = history.surfaceLogPath;
    const entries = [
        JSON.stringify({sender: 'user', text: 'Old 1', timestamp: new Date().toISOString()}),
        JSON.stringify({sender: 'agent', text: 'Old 2', timestamp: new Date().toISOString()})
    ].join('\n') + '\n';
    
    const file = Gio.File.new_for_path(manualLogPath);
    file.replace_contents(new TextEncoder().encode(entries), null, false, 0, null);

    // Tøm logBin før vi laster
    logBin.children = [];
    history.loadInitialHistory();

    // loadInitialHistory legger også til en "Session Restored"-melding
    allPassed &= assert(logBin.children.length === 3, "Loaded 2 messages + 1 system restore message");
    allPassed &= assert(logBin.children[0].text === 'Old 1', "Messages loaded in correct order");

    // Opprydding
    try {
        logFile.delete(null);
        // Slett mappen hvis den er tom (valgfritt for tmp)
    } catch (e) {}

    if (allPassed) {
        print("\n✅ AgentSurfaceHistory tests passed!");
    } else {
        print("\n❌ AgentSurfaceHistory tests failed.");
        system.exit(1);
    }
}

runTests().catch(e => {
    print(`[FATAL] History test runner crashed: ${e.message}\n${e.stack}`);
    system.exit(1);
});