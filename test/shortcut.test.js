"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCustom, resolveShortcut, chordSpec } = require("../src/shortcut");

test("presets resolve to their two keys", () => {
  assert.deepEqual(resolveShortcut({ dictationShortcut: "ctrl+space" }), { id: "ctrl+space", keys: [17, 32], labels: ["Ctrl", "Space"] });
  assert.equal(chordSpec({ dictationShortcut: "ctrl+alt" }), "keys:17+18");
  assert.equal(chordSpec({}), "keys:17+91");
  assert.equal(resolveShortcut({ dictationShortcut: "bogus" }).id, "ctrl+win");
});

test("legacy Ctrl + Shift becomes the custom shortcut pre-filled with Ctrl + Shift", () => {
  assert.deepEqual(resolveShortcut({ dictationShortcut: "ctrl+shift" }), { id: "custom", keys: [17, 16], labels: ["Ctrl", "Shift"] });
  assert.equal(chordSpec({ dictationShortcut: "custom" }), "keys:17+16");
});

test("custom shortcuts need Ctrl, Alt or Win and are stored modifier first", () => {
  assert.deepEqual(normalizeCustom({ keys: [75, 17], labels: ["K", "Ctrl"] }), { keys: [17, 75], labels: ["Ctrl", "K"] });
  assert.deepEqual(normalizeCustom({ keys: [32, 18], labels: ["Space", "Alt"] }), { keys: [18, 32], labels: ["Alt", "Space"] });
  assert.deepEqual(normalizeCustom({ keys: [91, 16] }), { keys: [16, 91], labels: ["Shift", "Win"] });
  assert.equal(normalizeCustom({ keys: [65, 83], labels: ["A", "S"] }), null, "two letters would fire while typing");
  assert.equal(normalizeCustom({ keys: [16, 65], labels: ["Shift", "A"] }), null, "Shift + letter would block capitals");
  assert.equal(normalizeCustom({ keys: [17, 17] }), null);
  assert.equal(normalizeCustom({ keys: [17, 27] }), null, "Escape is reserved");
  assert.equal(normalizeCustom({ keys: [17] }), null);
  assert.equal(normalizeCustom({ keys: [17, 300] }), null);
});

test("saved custom shortcut is used and invalid data falls back to Ctrl + Shift", () => {
  const settings = { dictationShortcut: "custom", customShortcut: { keys: [17, 75], labels: ["Ctrl", "K"] } };
  assert.deepEqual(resolveShortcut(settings).labels, ["Ctrl", "K"]);
  assert.equal(chordSpec(settings), "keys:17+75");
  assert.deepEqual(resolveShortcut({ dictationShortcut: "custom", customShortcut: { keys: [65, 66] } }).keys, [17, 16]);
});

test("recorded keys use modifier families and readable labels", () => {
  const { recordedKey } = require("../src/shortcut");
  assert.deepEqual(recordedKey(162, 0), { key: 17, label: "Ctrl" });
  assert.deepEqual(recordedKey(165, 0), { key: 18, label: "Alt" });
  assert.deepEqual(recordedKey(92, 0), { key: 91, label: "Win" });
  assert.deepEqual(recordedKey(75, 75), { key: 75, label: "K" });
  assert.deepEqual(recordedKey(186, 252), { key: 186, label: "Ü" }, "layout character from the hook");
  assert.deepEqual(recordedKey(32, 32), { key: 32, label: "Space" });
  assert.deepEqual(recordedKey(116, 0), { key: 116, label: "F5" });
  assert.deepEqual(recordedKey(101, 53), { key: 101, label: "Num 5" });
});
