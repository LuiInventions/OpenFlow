"use strict";

// Feeds key sequences into the real shortcut state machine from electron/chord.ps1
// (compiled by PowerShell, without installing the keyboard hook).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CASES = {
  ctrlWin: ["ctrl+win", [["d", 0xA2], ["d", 0x5B], ["d", 0x5B], ["u", 0x5B], ["u", 0xA2]]],
  winFirst: ["keys:17+91", [["d", 0x5B], ["d", 0xA2], ["u", 0xA2], ["u", 0x5B]]],
  customCtrlK: ["keys:17+75", [["d", 0xA3], ["d", 0x4B], ["u", 0x4B], ["u", 0xA3]]],
  letterAlone: ["keys:17+75", [["d", 0x4B], ["u", 0x4B]]],
  spaceThenAlt: ["keys:18+32", [["d", 0x20], ["d", 0xA4], ["u", 0xA4], ["u", 0x20]]],
  paused: ["off", [["d", 0xA2], ["d", 0x5B], ["u", 0x5B], ["u", 0xA2]]],
  recording: ["record", [["d", 0x5B], ["d", 0x4B], ["d", 0x4B], ["u", 0x4B], ["u", 0x5B]]],
};

function run() {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "chord.ps1"), "utf8").replace(/\[OpenFlowChord\]::Run\(\)\s*$/, "");
  const lines = [source, "$out = @{}"];
  for (const [name, [spec, events]] of Object.entries(CASES)) {
    lines.push(`[OpenFlowChord]::SetChordMode('${spec}')`, "[OpenFlowChord]::FakeHeld = New-Object 'System.Collections.Generic.HashSet[int]'", "[OpenFlowChord]::Trace = New-Object 'System.Collections.Generic.List[string]'", "$sw = @()", "$t = 1");
    for (const [kind, vk] of events) {
      lines.push(kind === "d" ? `[void][OpenFlowChord]::FakeHeld.Add(${vk})` : `[void][OpenFlowChord]::FakeHeld.Remove(${vk})`);
      lines.push(`$sw += [OpenFlowChord]::Feed(${vk}, 0, $${kind === "d"}, $${kind === "u"}, $t); $t++`);
    }
    lines.push(`$out['${name}'] = @{ swallow = $sw; trace = @([OpenFlowChord]::Trace) }`);
  }
  lines.push("$out | ConvertTo-Json -Depth 4 -Compress");
  const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "openflow-chord-")), "chord-test.ps1");
  fs.writeFileSync(script, lines.join("\n"));
  const out = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { encoding: "utf8" }));
  // The window handle after dictate-down varies; keep only the event name.
  for (const value of Object.values(out)) value.trace = value.trace.map(line => (line.startsWith("dictate-down") ? "dictate-down" : line));
  return out;
}

test("dictation shortcut hook swallows only the completing key and masks Win/Alt", { skip: process.platform !== "win32" }, () => {
  const out = run();
  // Ctrl first: Win (completing key), its repeat and release are swallowed.
  assert.deepEqual(out.ctrlWin, { swallow: [false, true, true, true, false], trace: ["dictate-down", "dictate-up"] });
  // Win first: Ctrl is swallowed; Win's release passes after a mask key (no Start menu).
  assert.deepEqual(out.winFirst, { swallow: [false, true, true, false], trace: ["dictate-down", "dictate-up", "mask"] });
  // Custom Ctrl + K with right Ctrl.
  assert.deepEqual(out.customCtrlK, { swallow: [false, true, true, false], trace: ["dictate-down", "dictate-up"] });
  // K alone keeps typing normally.
  assert.deepEqual(out.letterAlone, { swallow: [false, false], trace: [] });
  // Space first, then Alt: Alt is swallowed, Space passes.
  assert.deepEqual(out.spaceThenAlt, { swallow: [false, true, true, false], trace: ["dictate-down", "dictate-up"] });
  // "off" disables the shortcut entirely.
  assert.deepEqual(out.paused, { swallow: [false, false, false, false], trace: [] });
  // Recording: every event is swallowed; each key is reported once with its character.
  assert.deepEqual(out.recording, { swallow: [true, true, true, true, true], trace: ["rec-key 91 0", "rec-key 75 75"] });
});
