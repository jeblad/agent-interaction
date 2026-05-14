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

import { HeraUtils } from '../utils.js';
import system from 'system';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function assert(condition, message) {
    if (!condition) {
        print(`[FAIL] ${message}`);
        return false;
    }
    print(`[PASS] ${message}`);
    return true;
}

async function runTests() {
print("Starting Hera logic tests...");
let allPassed = true;

// 1. Test isStatusMatch
allPassed &= assert(HeraUtils.isStatusMatch("active,running", "active") === true, "Match single status");
allPassed &= assert(HeraUtils.isStatusMatch("active,running", "RUNNING") === true, "Case insensitive match");
allPassed &= assert(HeraUtils.isStatusMatch("active,running", "failed") === false, "Handle no match");

// 2. Test getLinesToDisplay
const mockLines = ["L1", "L2", "L3", "L4", "L5"];
const result = HeraUtils.getLinesToDisplay(mockLines, 0, 2);
allPassed &= assert(result.lines.length === 2 && result.lines[1] === "L5", "Slice recent lines correctly");
allPassed &= assert(result.newOffset === 2, "Update offset correctly");

const result2 = HeraUtils.getLinesToDisplay(mockLines, 2, 2);
allPassed &= assert(result2.lines.length === 2 && result2.lines[1] === "L3", "Slice historical lines correctly");

// 3. Test buildMultipartPayload
const text = "Hello Agent";
const boundary = "TestBoundary";
const attachments = [
    { name: "test.txt", contents: new Uint8Array([72, 101, 108, 108, 111]) } // "Hello"
];

const payload = HeraUtils.buildMultipartPayload(text, attachments, boundary);
const decoder = new TextDecoder();
const decodedString = decoder.decode(payload);

allPassed &= assert(decodedString.includes(boundary), "Payload contains boundary");
allPassed &= assert(decodedString.includes("name=\"text\""), "Payload contains text part header");
allPassed &= assert(decodedString.includes(text), "Payload contains the actual text message");
allPassed &= assert(decodedString.includes("filename=\"test.txt\""), "Payload contains file part header");
allPassed &= assert(decodedString.includes("Hello\r\n"), "Payload contains file binary content as string");
allPassed &= assert(payload instanceof Uint8Array, "Result is a Uint8Array");

// 4. Test safeCallback
let errorLogged = false;
const originalLogError = globalThis.logError;
globalThis.logError = () => { errorLogged = true; };

try {
    const buggy = HeraUtils.safeCallback(() => { throw new Error("Boom"); }, "TestLabel");
    buggy();
} catch (e) {
    allPassed &= assert(e.message === "Boom", "safeCallback re-throws correctly");
    allPassed &= assert(errorLogged === true, "safeCallback logs to journal");
}
globalThis.logError = originalLogError;

// 5. Test escapePango
allPassed &= assert(HeraUtils.escapePango("Hello & World") === "Hello &amp; World", "escapePango: escapes ampersand");
allPassed &= assert(HeraUtils.escapePango("1 < 2 > 0") === "1 &lt; 2 &gt; 0", "escapePango: escapes angle brackets");
allPassed &= assert(HeraUtils.escapePango("No special chars") === "No special chars", "escapePango: no change for safe string");
allPassed &= assert(HeraUtils.escapePango(null) === "", "escapePango: handles null input");
allPassed &= assert(HeraUtils.escapePango("") === "", "escapePango: handles empty string");

// 5. Test sanitize (Port of C++ rewrite logic)
allPassed &= assert(HeraUtils.sanitize("file/name.txt", true, '_') === "file_name.txt", "Sanitize tight: replaces slash");
allPassed &= assert(HeraUtils.sanitize("file:name.txt", false, '_') === "file_name.txt", "Sanitize loose: replaces colon");
allPassed &= assert(HeraUtils.sanitize("normal_file.txt", true, '_') === "normal_file.txt", "Sanitize: keeps normal chars");
allPassed &= assert(HeraUtils.sanitize("control\x00char", true, '_') === "control_char", "Sanitize: replaces null byte");
allPassed &= assert(HeraUtils.sanitize("control\x1fchar", true, '_') === "control_char", "Sanitize: replaces unit separator");
allPassed &= assert(HeraUtils.sanitize("control\x7fchar", true, '_') === "control_char", "Sanitize: replaces DEL");
allPassed &= assert(HeraUtils.sanitize(".", true, '_') === "_", "Sanitize: replaces single dot");
allPassed &= assert(HeraUtils.sanitize("..", true, '_') === "_", "Sanitize: replaces double dot");
allPassed &= assert(HeraUtils.sanitize("My File Name", true, '_') === "My_File_Name", "Sanitize tight: replaces space");
allPassed &= assert(HeraUtils.sanitize("My File Name", false, '_') === "My File Name", "Sanitize loose: keeps space");

// 6. Test validate (Port of C++ validate logic)
allPassed &= assert(HeraUtils.validate("valid_filename.txt", true) === true, "Validate tight: valid filename");
allPassed &= assert(HeraUtils.validate("valid filename.txt", true) === false, "Validate tight: invalid filename (space)");
allPassed &= assert(HeraUtils.validate("valid filename.txt", false) === true, "Validate loose: valid filename (space)");
allPassed &= assert(HeraUtils.validate("file/name.txt", true) === false, "Validate tight: invalid filename (slash)");
allPassed &= assert(HeraUtils.validate("file:name.txt", false) === false, "Validate loose: invalid filename (colon)");
allPassed &= assert(HeraUtils.validate("control\x00char", true) === false, "Validate: detects null byte");
allPassed &= assert(HeraUtils.validate("control\x1fchar", true) === false, "Validate: detects unit separator");
allPassed &= assert(HeraUtils.validate("control\x7fchar", true) === false, "Validate: detects DEL");
allPassed &= assert(HeraUtils.validate(".", true) === false, "Validate: detects single dot");
allPassed &= assert(HeraUtils.validate("..", true) === false, "Validate: detects double dot");

// 5. Test sendToAgent (Integration test with file system)
const tmpDir = GLib.get_tmp_dir();
const pipePath = GLib.build_filenamev([tmpDir, `hera_test_pipe_${Date.now()}`]);
const attachPath = GLib.build_filenamev([tmpDir, `hera_test_attach_${Date.now()}.txt`]);

try {
    // Lag et falskt vedlegg
    const attachFile = Gio.File.new_for_path(attachPath);
    attachFile.replace_contents(new TextEncoder().encode("File Content"), null, false, 0, null);

    await HeraUtils.sendToAgent(pipePath, "Integration Test", [attachFile]);
    
    const [success, contents] = Gio.File.new_for_path(pipePath).load_contents(null);
    const decoded = new TextDecoder().decode(contents);
    
    allPassed &= assert(success, "Pipe file was created asynchronously");
    allPassed &= assert(decoded.includes("Integration Test"), "Pipe contains the message");
    allPassed &= assert(decoded.includes("File Content"), "Pipe contains attachment content");
    allPassed &= assert(decoded.includes("filename=\"hera_test_attach_"), "Pipe contains filename in header");

} catch (e) {
    print(`[FAIL] sendToAgent threw error: ${e.message}`);
    allPassed = false;
} finally {
    // Cleanup
    try { Gio.File.new_for_path(pipePath).delete(null); } catch (e) {}
    try { Gio.File.new_for_path(attachPath).delete(null); } catch (e) {}
}

// 7. Test isPlainText
const txtPath = GLib.build_filenamev([tmpDir, `hera_test_${Date.now()}.txt`]);
const binPath = GLib.build_filenamev([tmpDir, `hera_test_${Date.now()}.bin`]);

try {
    const txtFile = Gio.File.new_for_path(txtPath);
    txtFile.replace_contents(new TextEncoder().encode("This is plain text."), null, false, 0, null);
    const isTxt = await HeraUtils.isPlainText(txtFile);
    allPassed &= assert(isTxt === true, "isPlainText identifies .txt as plain text");

    const binFile = Gio.File.new_for_path(binPath);
    // Write ELF header bytes to trigger binary detection
    const elfHeader = new Uint8Array([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
    binFile.replace_contents(elfHeader, null, false, 0, null);
    const isBin = await HeraUtils.isPlainText(binFile);
    allPassed &= assert(isBin === false, "isPlainText identifies ELF binary as not plain text");

} catch (e) {
    print(`[FAIL] isPlainText test threw error: ${e.message}`);
    allPassed = false;
} finally {
    try { Gio.File.new_for_path(txtPath).delete(null); } catch (e) {}
    try { Gio.File.new_for_path(binPath).delete(null); } catch (e) {}
}

// 8. Test parseHistoryLine
const validLine = JSON.stringify({
    sender: "agent",
    text: "Logic test",
    timestamp: "2024-01-01T12:00:00Z",
    isMeta: true,
    attachments: ["test.pdf"]
});
const parsed = HeraUtils.parseLogLine(validLine);
allPassed &= assert(parsed !== null, "parseHistoryLine: valid line is parsed");
allPassed &= assert(parsed.sender === "agent", "parseHistoryLine: sender extracted");
allPassed &= assert(parsed.isMeta === true, "parseHistoryLine: isMeta flag extracted");
allPassed &= assert(parsed.attachments.length === 1, "parseHistoryLine: attachments extracted");
allPassed &= assert(parsed.attachments[0].get_basename() === "test.pdf", "parseHistoryLine: attachment helper works");

const malformed = "{ invalid json }";
allPassed &= assert(HeraUtils.parseLogLine(malformed) === null, "parseHistoryLine: returns null on error");

if (allPassed) {
    print("\n✅ All logic tests passed!");
} else {
    print("\n❌ Some tests failed.");
    system.exit(1);
}
}

runTests().catch(e => {
    print(`[FATAL] Test runner crashed: ${e.message}\n${e.stack}`);
    system.exit(1);
});