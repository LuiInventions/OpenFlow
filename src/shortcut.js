"use strict";

// Dictation shortcuts are two Windows virtual keys. Modifier families use one
// code each (left/right variants are matched by the keyboard hook).
const CTRL = 17;
const SHIFT = 16;
const ALT = 18;
const WIN = 91;
const MODIFIER_LABELS = { [CTRL]: "Ctrl", [ALT]: "Alt", [SHIFT]: "Shift", [WIN]: "Win" };
const MODIFIER_ORDER = [CTRL, ALT, SHIFT, WIN];
// A custom shortcut needs one of these, so it cannot fire while typing text.
const ANCHORS = [CTRL, ALT, WIN];
const RESERVED = [27]; // Escape cancels recording.

const PRESETS = {
  "ctrl+win": [CTRL, WIN],
  "ctrl+space": [CTRL, 32],
  "ctrl+alt": [CTRL, ALT],
};
const PRESET_LABELS = { 32: "Space" };
const DEFAULT_CUSTOM = { keys: [CTRL, SHIFT], labels: ["Ctrl", "Shift"] };

function labelFor(key, given) {
  if (MODIFIER_LABELS[key]) return MODIFIER_LABELS[key];
  if (PRESET_LABELS[key]) return PRESET_LABELS[key];
  const text = typeof given === "string" ? given.trim().slice(0, 12) : "";
  return text || `Key ${key}`;
}

// Returns a clean { keys, labels } pair or null when the combination is not allowed.
function normalizeCustom(raw) {
  if (!raw || !Array.isArray(raw.keys) || raw.keys.length !== 2) return null;
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const pairs = raw.keys.map((key, index) => ({ key: Number(key), label: labels[index] }));
  if (pairs.some(({ key }) => !Number.isInteger(key) || key < 1 || key > 254 || RESERVED.includes(key))) return null;
  if (pairs[0].key === pairs[1].key) return null;
  if (!pairs.some(({ key }) => ANCHORS.includes(key))) return null;
  const rank = key => (MODIFIER_ORDER.includes(key) ? MODIFIER_ORDER.indexOf(key) : MODIFIER_ORDER.length);
  pairs.sort((a, b) => rank(a.key) - rank(b.key));
  return { keys: pairs.map(({ key }) => key), labels: pairs.map(({ key, label }) => labelFor(key, label)) };
}

// Effective shortcut for stored settings. The former "Ctrl + Shift" preset is now
// the custom shortcut, pre-filled with Ctrl + Shift.
function resolveShortcut(settings) {
  const id = settings && settings.dictationShortcut;
  if (PRESETS[id]) return { id, keys: PRESETS[id], labels: PRESETS[id].map(key => labelFor(key)) };
  if (id === "custom" || id === "ctrl+shift") {
    const custom = normalizeCustom(settings.customShortcut) || DEFAULT_CUSTOM;
    return { id: "custom", keys: custom.keys, labels: custom.labels };
  }
  return { id: "ctrl+win", keys: PRESETS["ctrl+win"], labels: ["Ctrl", "Win"] };
}

const KEY_NAMES = {
  8: "Backspace", 9: "Tab", 13: "Enter", 19: "Pause", 20: "Caps", 32: "Space", 33: "PgUp", 34: "PgDn",
  35: "End", 36: "Home", 37: "←", 38: "↑", 39: "→", 40: "↓", 44: "PrtSc", 45: "Ins", 46: "Del",
  93: "Menu", 106: "Num *", 107: "Num +", 109: "Num -", 110: "Num .", 111: "Num /", 144: "NumLk", 145: "ScrLk",
};
const FAMILY = { 160: SHIFT, 161: SHIFT, 162: CTRL, 163: CTRL, 164: ALT, 165: ALT, 92: WIN };

// Key reported by the hook while recording ("rec-key <vk> <char>") as { key, label }.
function recordedKey(vk, charCode) {
  const key = FAMILY[vk] || vk;
  let label = MODIFIER_LABELS[key] || KEY_NAMES[key];
  if (!label && key >= 112 && key <= 135) label = `F${key - 111}`;
  if (!label && key >= 96 && key <= 105) label = `Num ${key - 96}`;
  if (!label && charCode > 32) label = String.fromCharCode(charCode).toUpperCase();
  return { key, label: label || `Key ${key}` };
}

// Line understood by chord.ps1.
function chordSpec(settings) {
  const { keys } = resolveShortcut(settings);
  return `keys:${keys[0]}+${keys[1]}`;
}

module.exports = { DEFAULT_CUSTOM, PRESETS, normalizeCustom, resolveShortcut, chordSpec, recordedKey };
