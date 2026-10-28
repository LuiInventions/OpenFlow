"use strict";

const views = [
  ["dictate", "Dictation", '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="6" y="1.5" width="4" height="7.5" rx="2"></rect><path d="M4 8a4 4 0 0 0 8 0M8 12v2"></path></svg>'],
  ["notes", "Notes", '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h5.5L12 5v8.5H4z"></path><path d="M9.2 2.6V5.2H12"></path></svg>'],
  ["commands", "Commands", '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2.2"></rect><path d="M4.5 5.5l2.5 2.5-2.5 2.5M8.5 10.5h3"></path></svg>'],
  ["usage", "Usage", '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5V9M6.5 12.5V6.5M10 12.5V4M13.5 12.5V8"></path></svg>'],
  ["settings", "Settings", '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.1"></circle><path d="M8 2.2v1.5M8 12.3v1.5M2.2 8h1.5M12.3 8h1.5M3.9 3.9l1.1 1.1M11 11l1.1 1.1M12.1 3.9 11 5M5 11l-1.1 1.1"></path></svg>'],
];

const state = {
  desk: null,
  view: "dictate",
  editor: null,
  commandEditor: null,
  commandWizard: null,
  iconPicker: null,
  commandSearch: "",
  noteSearch: "",
  confirmDeleteId: null,
  confirmDeleteCommandId: null,
  confirmSttEngine: null,
  confirmNoteProvider: null,
  askKey: false,
  onboardingStep: null,
  draftBubbleElements: null,
  draftFloatingBubble: null,
  draftVoiceNote: null,
  sttInfoParakeet: false,
  sttInfoOpenai: false,
  noteInfoLocal: false,
  noteInfoOpenai: false,
  noteKeyTest: "",
  noteModelProgress: null,
  usageKind: "stt",
  usageMenuOpen: false,
};
let loadGeneration = 0;
let draggedElemId = null;
let draggedShelfId = null;

const NOTE_IMPROVE_ONBOARDING_RELEASE = "1.5.6";
// Live voice dictation into the note editor (streamed from the main process as "note-voice").
const editorVoice = { state: "idle", waiters: [], base: "", transcript: "", key: "" };

// "Take voice note" is not a standalone element: it always sits attached to the left of the mic.
const VOICE_NOTE_DEF = {
  id: "vnote",
  name: "Take Voice Note",
  miniIcon: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.1" stroke="currentColor" stroke-width="1.7"></circle><circle cx="8" cy="8" r="2.7" fill="currentColor"></circle></svg>`,
};

function voiceComboHtml(withVoiceNote, removable) {
  if (!withVoiceNote) {
    return `<div class="elem-voice-combo no-vnote" aria-hidden="true"><div class="elem-mic"><svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.25" y="1.75" width="5.5" height="9" rx="2.75"></rect><path d="M3.75 8.25a5.25 5.25 0 0 0 10.5 0M9 13.5V16"></path></svg></div></div>`;
  }
  const minus = removable
    ? `<button type="button" class="elem-minus-btn elem-minus-vnote" data-vnote-remove title="Remove ${VOICE_NOTE_DEF.name}" aria-label="Remove ${VOICE_NOTE_DEF.name}">−</button>`
    : "";
  return `<div class="elem-voice-combo"><div class="elem-vtrack" aria-hidden="true"></div><div class="elem-vnote" title="${VOICE_NOTE_DEF.name}"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.1" stroke="currentColor" stroke-width="1.7"></circle><circle cx="8" cy="8" r="2.7" fill="currentColor"></circle></svg>${minus}</div><div class="elem-mic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.25" y="1.75" width="5.5" height="9" rx="2.75"></rect><path d="M3.75 8.25a5.25 5.25 0 0 0 10.5 0M9 13.5V16"></path></svg></div></div>`;
}


const CMD_TYPE_INFO = {
  powershell: {
    id: "powershell",
    title: "PowerShell",
    extension: ".ps1",
    desc: "Windows PowerShell script. Executes via powershell.exe with visible console.",
    logo: '<svg width="40" height="40" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="#012456"/><path d="M12 16L22 24L12 32" stroke="#4db2ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 32H36" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/></svg>',
  },
  bat: {
    id: "bat",
    title: "Bat",
    extension: ".bat",
    desc: "Windows batch script. Executes via cmd.exe with visible console.",
    logo: '<svg width="40" height="40" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="#2d3748"/><path d="M14 14H28L34 20V34H14V14Z" fill="#edf2f7" stroke="#cbd5e0" stroke-width="1.5"/><path d="M28 14V20H34" fill="#cbd5e0"/><circle cx="24" cy="27" r="4" fill="#3182ce"/><path d="M24 20V22M24 32V34M17 27H19M29 27H31M19 22L20.5 23.5M27.5 30.5L29 32M19 32L20.5 30.5M27.5 23.5L29 22" stroke="#3182ce" stroke-width="2" stroke-linecap="round"/></svg>',
  },
  cmd: {
    id: "cmd",
    title: "CMD",
    extension: ".cmd",
    desc: "Windows command script. Executes via cmd.exe with visible console.",
    logo: '<svg width="40" height="40" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="10" fill="#1e1e1e"/><rect x="2" y="2" width="44" height="44" rx="8" stroke="#333333" stroke-width="1.5"/><path d="M12 18L18 24L12 30" stroke="#f5f5f5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 30H32" stroke="#22c55e" stroke-width="3.5" stroke-linecap="round"/><text x="34" y="20" fill="#a3a3a3" font-size="9" font-family="monospace" font-weight="bold">CMD</text></svg>',
  },
};


const COMMAND_ICONS = [
  { id: "terminal", label: "Terminal", svg: '<rect x="2.5" y="2.5" width="13" height="13" rx="2.5"></rect><path d="M5.5 6.5l2.75 2.5-2.75 2.5M10 11.5h2.5"></path>' },
  { id: "bolt", label: "Lightning", svg: '<path d="M9.5 2L4 10h4.5l-1 6 6-8H9l.5-6z"></path>' },
  { id: "gear", label: "Settings", svg: '<circle cx="9" cy="9" r="2.75"></circle><path d="M9 2.25v1.75M9 14v1.75M2.25 9H4M14 9h1.75M4.22 4.22l1.24 1.24M12.54 12.54l1.24 1.24M4.22 13.78l1.24-1.24M12.54 5.46l1.24-1.24"></path>' },
  { id: "rocket", label: "Rocket", svg: '<path d="M9 2.5c2.5 1.5 4 4.5 4 7.5l-2 1.5-2-2-2 2-2-1.5c0-3 1.5-6 4-7.5z"></path><path d="M5 11.5L3 14l3.5-.5M13 11.5L15 14l-3.5-.5M9 11.5v4"></path>' },
  { id: "bug", label: "Bug", svg: '<rect x="6" y="5.5" width="6" height="8" rx="3"></rect><path d="M9 5.5V3.5M6.5 3.5 8 5M11.5 3.5 10 5M4 8h2M12 8h2M4 11.5h2M12 11.5h2"></path>' },
  { id: "trash", label: "Cleanup", svg: '<path d="M3.5 5h11M7 5V3.5c0-.6.4-1 1-1h2c.6 0 1 .4 1 1V5M5.5 5l.5 9c0 .6.4 1 1 1h4c.6 0 1-.4 1-1l.5-9"></path>' },
  { id: "refresh", label: "Refresh", svg: '<path d="M3.5 8.5A5.5 5.5 0 0 1 13.5 5l1.5-1.5M15 3.5V7h-3.5"></path><path d="M14.5 9.5A5.5 5.5 0 0 1 4.5 13L3 14.5M3 14.5V11h3.5"></path>' },
  { id: "shield", label: "Security", svg: '<path d="M9 2.5l5.5 2.5v4.5c0 3.5-3.5 5.8-5.5 6.5-2-0.7-5.5-3-5.5-6.5V5L9 2.5z"></path>' },
  { id: "globe", label: "Network", svg: '<circle cx="9" cy="9" r="6.5"></circle><path d="M2.5 9h13M9 2.5a10 10 0 0 1 2.5 6.5 10 10 0 0 1-2.5 6.5A10 10 0 0 1 6.5 9 10 10 0 0 1 9 2.5z"></path>' },
  { id: "database", label: "Database", svg: '<ellipse cx="9" cy="4.5" rx="5.5" ry="2"></ellipse><path d="M3.5 4.5v4.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4.5"></path><path d="M3.5 9v4.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V9"></path>' },
  { id: "server", label: "Server", svg: '<rect x="3" y="3" width="12" height="4.5" rx="1.5"></rect><rect x="3" y="10.5" width="12" height="4.5" rx="1.5"></rect><circle cx="5.5" cy="5.25" r=".75" fill="currentColor"></circle><circle cx="5.5" cy="12.75" r=".75" fill="currentColor"></circle>' },
  { id: "folder", label: "Folder", svg: '<path d="M2.5 4.5c0-.6.4-1 1-1h3.2l1.6 1.8H14.5c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1v-8.8z"></path>' },
  { id: "code", label: "Code", svg: '<path d="M6 5.5L2.5 9 6 12.5M12 5.5l3.5 3.5-3.5 3.5M10.5 4l-3 10"></path>' },
  { id: "cpu", label: "CPU", svg: '<rect x="5" y="5" width="8" height="8" rx="1.8"></rect><path d="M7 5V2.5M11 5V2.5M7 15.5V13M11 15.5V13M5 7H2.5M5 11H2.5M15.5 7H13M15.5 11H13"></path>' },
  { id: "robot", label: "Robot", svg: '<rect x="4" y="5" width="10" height="9" rx="2.5"></rect><path d="M9 2.5V5M2.5 9.5H4M14 9.5h1.5"></path><circle cx="6.5" cy="8.5" r=".8" fill="currentColor"></circle><circle cx="11.5" cy="8.5" r=".8" fill="currentColor"></circle><path d="M6.5 11.5h5"></path>' },
  { id: "wrench", label: "Wrench", svg: '<path d="M14.5 3.5a3.5 3.5 0 0 0-4.5.5L4 10l-.5 4.5 4.5-.5 6-6a3.5 3.5 0 0 0 .5-4.5z"></path>' },
  { id: "bell", label: "Bell", svg: '<path d="M9 2.5a3.5 3.5 0 0 0-3.5 3.5c0 3-1.5 4.5-1.5 4.5h10s-1.5-1.5-1.5-4.5a3.5 3.5 0 0 0-3.5-3.5z"></path><path d="M7.5 14a1.8 1.8 0 0 0 3 0"></path>' },
  { id: "power", label: "Power", svg: '<path d="M9 2.5v5M5 4.5a6 6 0 1 0 8 0"></path>' },
  { id: "sparkles", label: "Sparkles", svg: '<path d="M9 2.5l1.2 3.3L13.5 7 10.2 8.2 9 11.5 7.8 8.2 4.5 7l3.3-1.2L9 2.5z"></path><path d="M13.5 12l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4z"></path>' },
  { id: "play", label: "Play", svg: '<polygon points="5.5,3.5 14,9 5.5,14.5" fill="none" stroke="currentColor"></polygon>' },
];

function getCommandSvg(iconId, w = 18, h = 18) {
  const item = COMMAND_ICONS.find((c) => c.id === iconId) || COMMAND_ICONS[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${item.svg}</svg>`;
}

const SCRIPT_BUBBLE_HTML = '<div class="elem-single" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="13" height="13" rx="2.2"></rect><path d="M5.5 6.5l2.75 2.5-2.75 2.5M10 11.5h2.5"></path></svg></div>';
const SCRIPT_MINI_ICON = '<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="13" height="13" rx="2.2"></rect><path d="M5.5 6.5l2.75 2.5-2.75 2.5M10 11.5h2.5"></path></svg>';

function getBubbleElementDef(key) {
  if (BUBBLE_ELEMENT_DEFS[key]) return BUBBLE_ELEMENT_DEFS[key];
  if (key && key.startsWith("cmd:")) {
    const cmdId = key.slice(4);
    const cmd = ((state.desk && state.desk.commands) || []).find((c) => c.id === cmdId);
    if (cmd) {
      const iconId = cmd.icon || "terminal";
      return {
        id: key,
        name: cmd.name,
        html: `<div class="elem-single" aria-hidden="true">${getCommandSvg(iconId, 17, 17)}</div>`,
        miniIcon: getCommandSvg(iconId, 14, 14),
      };
    }
  }
  return null;
}

function validateCommandName(name, existing, editingId) {
  const val = String(name == null ? "" : name);
  if (!val.trim()) return "Please enter a name.";
  if (val !== val.trim()) return "The name must not start or end with a space.";
  if (val.length > 48) return "The name may have at most 48 characters.";
  if (!/^[\p{L}\p{N} _-]+$/u.test(val)) return "Use only letters, numbers, spaces, hyphens and underscores.";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(val)) return "This name is reserved by Windows.";
  const lower = val.toLowerCase();
  const list = (existing || []).filter((item) => !editingId || item.id !== editingId);
  if (list.some((item) => String(item.name).toLowerCase() === lower)) return "A command with this name already exists.";
  return "";
}

const BUBBLE_ELEMENT_DEFS = {
  voice: {
    id: "voice",
    name: "Voice & Note",
    html: `<div class="elem-voice-combo" aria-hidden="true"><div class="elem-vtrack"></div><div class="elem-vnote"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.1" stroke="currentColor" stroke-width="1.7"></circle><circle cx="8" cy="8" r="2.7" fill="currentColor"></circle></svg></div><div class="elem-mic"><svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.25" y="1.75" width="5.5" height="9" rx="2.75"></rect><path d="M3.75 8.25a5.25 5.25 0 0 0 10.5 0M9 13.5V16"></path></svg></div></div>`,
    miniIcon: `<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.25" y="1.75" width="5.5" height="9" rx="2.75"></rect><path d="M3.75 8.25a5.25 5.25 0 0 0 10.5 0M9 13.5V16"></path></svg>`,
  },
  note: {
    id: "note",
    name: "Notes",
    html: `<div class="elem-single" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.75" y="2.25" width="10.5" height="13.5" rx="1.6"></rect><path d="M6.25 6.75h5.5M6.25 10h5.5"></path></svg></div>`,
    miniIcon: `<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.75" y="2.25" width="10.5" height="13.5" rx="1.6"></rect><path d="M6.25 6.75h5.5M6.25 10h5.5"></path></svg>`,
  },
  tune: {
    id: "tune",
    name: "Hub",
    html: `<div class="elem-single" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 7.75 9 2.5l6.25 5.25"></path><path d="M4.25 6.75v7.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-7.5"></path><path d="M7.25 15.25v-4.25h3.5v4.25"></path></svg></div>`,
    miniIcon: `<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.75 7.75 9 2.5l6.25 5.25"></path><path d="M4.25 6.75v7.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-7.5"></path><path d="M7.25 15.25v-4.25h3.5v4.25"></path></svg>`,
  },
  shot: {
    id: "shot",
    name: "Screenshot",
    html: `<div class="elem-single" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 6.4V3.2H6.4M11.6 3.2h3.2v3.2M14.8 11.6v3.2h-3.2M6.4 14.8H3.2v-3.2"></path><circle cx="9" cy="9" r="1.7"></circle></svg></div>`,
    miniIcon: `<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 6.4V3.2H6.4M11.6 3.2h3.2v3.2M14.8 11.6v3.2h-3.2M6.4 14.8H3.2v-3.2"></path><circle cx="9" cy="9" r="1.7"></circle></svg>`,
  },
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function when(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso) {
  const parts = String(iso || "").split("-");
  if (parts.length !== 3) return "";
  return `${parts[1]}/${parts[2]}`;
}

function money(value) {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value) || 0)} USD`;
}

function minutes(durationMs) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((Number(durationMs) || 0) / 60000);
}

function captureEditor() {
  if (state.editor) {
    const editor = document.querySelector("#editor");
    const expectedKey = state.editor.id || "__draft__";
    if (editor && editor.dataset.id === expectedKey) {
      const title = editor.querySelector("#editor-title");
      const body = editor.querySelector("#editor-body");
      if (title && body) state.editor = { ...state.editor, title: title.value, content: body.value };
    }
  }
  if (state.commandEditor) {
    const body = document.querySelector("#cmd-editor-body");
    if (body) state.commandEditor.content = body.value;
  }
}

async function load(pending) {
  const generation = loadGeneration + 1;
  loadGeneration = generation;
  captureEditor();
  const desk = await window.openflow.dispatch("desk.snapshot");
  if (generation !== loadGeneration) return;
  state.desk = desk;
  const settings = desk.settings || {};
  if (!state.draftBubbleElements) {
    const defaultElements = ["voice", "note", "tune", "shot"];
    const saved = Array.isArray(settings.bubbleElements) ? [...settings.bubbleElements] : defaultElements;
    const allValid = [...defaultElements, ...((desk.commands || []).map((c) => `cmd:${c.id}`))];
    state.draftBubbleElements = saved.filter((k) => allValid.includes(k));
  }
  if (!state.draftFloatingBubble) {
    state.draftFloatingBubble = settings.floatingBubble || "active";
  }
  if (state.draftVoiceNote === null) {
    state.draftVoiceNote = settings.voiceNoteButton !== false;
  }
  if ((pending && pending.onboarding) || !settings.onboardingDone) {
    if (!state.onboardingStep) state.onboardingStep = "choose";
  } else if (settings.noteImproveOnboardingRelease !== NOTE_IMPROVE_ONBOARDING_RELEASE) {
    if (state.onboardingStep !== "note-improve-key") state.onboardingStep = "note-improve";
  } else {
    state.onboardingStep = null;
  }
  if (pending && pending.newDraftPad) {
    state.view = "notes";
    state.askKey = false;
    state.confirmDeleteId = null;
    state.editor = { id: "", isDraft: true, title: "Note", content: "" };
    const editor = document.querySelector("#editor");
    if (editor) editor.dataset.id = "";
  } else if (pending && pending.openPadId) {
    const pad = (desk.pads || []).find((row) => row.id === pending.openPadId);
    if (pad) {
      state.view = "notes";
      state.askKey = false;
      state.confirmDeleteId = null;
      state.editor = { id: pad.id, isDraft: false, title: pad.title || "Note", content: pad.content || "" };
      const editor = document.querySelector("#editor");
      if (editor) editor.dataset.id = "";
    }
  } else if (settings.onboardingDone && ((pending && pending.askKey) || (settings.sttEngine === "openai" && !settings.hasKey))) {
    if (!settings.hasKey) {
      state.view = "settings";
      state.askKey = true;
      state.editor = null;
    }
  }
  render();
  if (state.askKey && state.view === "settings" && !state.onboardingStep) {
    const key = document.querySelector("#api-key");
    if (key) key.focus();
  }
}

async function saveApiKey() {
  const key = document.querySelector("#api-key");
  if (!key) return;
  const value = key.value.trim();
  if (!value) return;
  const saveKeyBtn = document.querySelector("#save-key");
  if (saveKeyBtn) {
    saveKeyBtn.disabled = true;
    saveKeyBtn.textContent = "Saved";
    saveKeyBtn.classList.add("saved");
  }
  await window.openflow.dispatch("settings.save", { apiKey: value, onboardingDone: true });
  key.value = "";
  state.askKey = false;
  await new Promise((r) => setTimeout(r, 600));
  await load();
}

function render() {
  const nav = document.querySelector("#nav");
  nav.innerHTML = views.map(([id, label, icon]) => {
    const current = id === state.view ? ' aria-current="page"' : "";
    return `<button type="button" data-nav="${id}"${current}>${icon}${label}</button>`;
  }).join("");
  document.querySelector("#title").textContent = views.find(([id]) => id === state.view)[1];
  const viewHead = document.querySelector(".view-head");
  const view = document.querySelector("#view");
  const showingEditor = (state.view === "notes" && Boolean(state.editor)) ||
                        (state.view === "commands" && Boolean(state.commandEditor));
  if (viewHead) viewHead.hidden = showingEditor;
  view.hidden = showingEditor;
  const main = document.querySelector("main");
  if (main) main.classList.toggle("is-usage", state.view === "usage" && !showingEditor);
  paintUsageSwitch(viewHead, state.view === "usage" && !showingEditor);
  if (!showingEditor) {
    if (state.view === "notes") view.innerHTML = notesHtml();
    else if (state.view === "commands") view.innerHTML = commandsHtml();
    else if (state.view === "usage") view.innerHTML = usageHtml();
    else if (state.view === "settings") view.innerHTML = settingsHtml();
    else view.innerHTML = dictateHtml();
  }
  paintEditor();
  paintCommandEditor();
  paintCommandWizard();
  paintIconPicker();
  paintOnboarding();
  paintConfirmModal();

  const key = view.querySelector("#api-key");
  if (key) {
    key.addEventListener("change", saveApiKey);
    key.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveApiKey();
      }
    });
  }
  const saveKeyBtn = view.querySelector("#save-key");
  if (saveKeyBtn) {
    saveKeyBtn.addEventListener("click", saveApiKey);
  }
}

function shortcutKeysHtml(shortcut) {
  if (shortcut === "ctrl+space") return "<kbd>Ctrl</kbd> + <kbd>Space</kbd>";
  if (shortcut === "ctrl+alt") return "<kbd>Ctrl</kbd> + <kbd>Alt</kbd>";
  if (shortcut === "ctrl+shift") return "<kbd>Ctrl</kbd> + <kbd>Shift</kbd>";
  return "<kbd>Ctrl</kbd> + <kbd>Win</kbd>";
}

function dictateHtml() {
  const history = state.desk.history || [];
  const last = history[0];
  const text = last ? (last.edited_text || last.formatted_text || last.asr_text) : "";
  const settings = state.desk.settings || {};
  const engine = settings.sttEngine === "openai" ? "gpt-transcribe" : "Parakeet v3 (Local)";
  const shortcut = settings.dictationShortcut || "ctrl+win";
  const isToggle = settings.dictationMode === "toggle";
  const headline = isToggle ? "Press shortcut to start and stop dictation" : "Hold shortcut to dictate anywhere";
  const subline = isToggle
    ? `Active engine: ${esc(engine)}. Press once to start speaking and press a second time to finish.`
    : `Active engine: ${esc(engine)}. Speak naturally while holding and release to paste or save as a note.`;
  const hero = `<div class="hero-card"><div class="hero-copy"><strong>${headline}</strong><p>${subline}</p></div><p class="shortcut">${shortcutKeysHtml(shortcut)}</p></div>`;
  const latest = text
    ? `<div class="section-label">Latest Dictation</div><div class="transcript-card"><p class="lead">${esc(text)}</p><time>${esc(when(last.created_at))}</time></div>`
    : `<p class="empty">No dictations yet. Use ${shortcutKeysHtml(shortcut)} or click the microphone in the bottom bar to start.</p>`;
  const recent = history.slice(1, 5);
  const recentHtml = recent.length
    ? `<div class="section-label">Recent History</div><div class="history-list">${recent.map((row) => {
      const body = row.edited_text || row.formatted_text || row.asr_text || "";
      return `<div class="history-row"><p>${esc(body)}</p><time>${esc(when(row.created_at))}</time></div>`;
    }).join("")}</div>`
    : "";
  return `${hero}${latest}${recentHtml}`;
}


function listSearchHtml(inputId, clearId, placeholder, value) {
  const clear = value
    ? `<button type="button" class="search-clear-btn" id="${clearId}" title="Clear search">✕</button>`
    : "";
  return `<div class="commands-search-bar"><div class="commands-search-input-wrap"><svg class="search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="7" cy="7" r="4.5"></circle><path d="M10.5 10.5L14 14"></path></svg><input type="search" id="${inputId}" placeholder="${esc(placeholder)}" value="${esc(value || "")}" autocomplete="off" spellcheck="false">${clear}</div></div>`;
}

function inlineNotePreview(line) {
  let text = String(line || "").trim();
  if (!text || /^(-{3,}|\*{3,}|_{3,})$/.test(text) || /^```/.test(text)) return "";
  text = text.replace(/^#{1,6}\s+/, "");
  text = text.replace(/^>\s?/, "");
  text = text.replace(/^[-*+]\s+\[[ xX]\]\s+/, "");
  text = text.replace(/^[-*+]\s+/, "");
  text = text.replace(/^\d+[.)]\s+/, "");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[img:[^\]]*\]/g, "");
  text = text.trim();
  if (!text) return "";
  let html = esc(text);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  html = html.replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g, "<u>$1</u>");
  html = html.replace(/`([^`]+)`/g, "$1");
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  const plain = html.replace(/<[^>]+>/g, "").trim();
  return plain ? html : "";
}

function notePreviewHtml(content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const html = inlineNotePreview(line);
    if (html) return html;
  }
  return esc("Empty note — click to edit");
}

function commandsHtml() {
  const allCommands = (state.desk && state.desk.commands) || [];
  const query = (state.commandSearch || "").trim().toLowerCase();
  const list = query
    ? allCommands.filter((c) => (`${c.name} ${c.extension} ${c.content}`).toLowerCase().includes(query))
    : allCommands;

  const searchHtml = listSearchHtml("commands-search-input", "commands-search-clear", "Search commands...", state.commandSearch || "");

  const fab = `<button type="button" class="notes-fab commands-fab" data-new-command aria-label="Erstellen" title="Erstellen"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M8 3v10M3 8h10"></path></svg></button>`;

  if (!allCommands.length) {
    return `${searchHtml}<p class="empty">No commands yet. Tap the button in the bottom right to create your first script.</p>${fab}`;
  }
  if (!list.length) {
    return `${searchHtml}<p class="empty">No commands match "${esc(state.commandSearch)}".</p>${fab}`;
  }

  const trashSvg = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 5h11M7 5V3.6c0-.6.5-1.1 1.1-1.1h1.8c.6 0 1.1.5 1.1 1.1V5M5.2 5l.6 9.4c.05.9.8 1.6 1.7 1.6h3c.9 0 1.65-.7 1.7-1.6L12.8 5M7.6 8.2v4.5M10.4 8.2v4.5"></path></svg>';
  const playSvg = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M4.5 3.5v9l8-4.5z"></path></svg>';

  const itemsHtml = list.map((cmd) => {
    const preview = String(cmd.content || "").trim().replace(/\s+/g, " ") || "Empty script — click to edit";
    const runTitle = cmd.runAsAdmin ? "Run with Administrator privileges" : "Run command";
    const iconId = cmd.icon || "terminal";
    return `<div class="note-box command-box" role="listitem">
      <button type="button" class="command-symbol-btn" data-command-icon-btn="${esc(cmd.id)}" title="Change symbol (${esc(iconId)})" aria-label="Change command symbol">
        ${getCommandSvg(iconId)}
      </button>
      <button type="button" class="note-open-btn command-open-btn" data-command-open="${esc(cmd.id)}">
        <strong>${esc(cmd.name)}<span class="command-ext-suffix">${esc(cmd.extension)}</span></strong>
        <span>${esc(preview)}</span>
      </button>
      <button type="button" class="command-run-btn" data-command-run="${esc(cmd.id)}" title="${runTitle}" aria-label="${runTitle}">${playSvg}</button>
      <button type="button" class="note-delete-btn" data-command-delete="${esc(cmd.id)}" title="Delete command" aria-label="Delete command">${trashSvg}</button>
    </div>`;
  }).join("");

  return `${searchHtml}<div class="notes-list" role="list">${itemsHtml}</div>${fab}`;
}

function notesHtml() {
  const allPads = [...(state.desk.pads || [])].reverse();
  const query = (state.noteSearch || "").trim().toLowerCase();
  const pads = query
    ? allPads.filter((pad) => (`${pad.title || ""} ${pad.content || ""}`).toLowerCase().includes(query))
    : allPads;
  const searchHtml = listSearchHtml("notes-search-input", "notes-search-clear", "Search notes...", state.noteSearch || "");
  const penPaperSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  const fab = `<button type="button" class="notes-fab" data-new-pad aria-label="New Note" title="New Note">${penPaperSvg}</button>`;
  if (!allPads.length) return `${searchHtml}<p class="empty">No notes yet. Tap the button in the bottom right or dictate without a focused text field.</p>${fab}`;
  if (!pads.length) return `${searchHtml}<p class="empty">No notes match "${esc(state.noteSearch)}".</p>${fab}`;
  const trashSvg = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 5h11M7 5V3.6c0-.6.5-1.1 1.1-1.1h1.8c.6 0 1.1.5 1.1 1.1V5M5.2 5l.6 9.4c.05.9.8 1.6 1.7 1.6h3c.9 0 1.65-.7 1.7-1.6L12.8 5M7.6 8.2v4.5M10.4 8.2v4.5"></path></svg>';
  const list = `<div class="notes-list" role="list">${pads.map((pad) => {
    const title = pad.title || "Note";
    return `<div class="note-box" role="listitem"><button type="button" class="note-open-btn" data-pad-open="${esc(pad.id)}"><strong>${esc(title)}</strong><span>${notePreviewHtml(pad.content)}</span></button><button type="button" class="note-delete-btn" data-pad-delete="${esc(pad.id)}" title="Delete note" aria-label="Delete note">${trashSvg}</button></div>`;
  }).join("")}</div>`;
  return `${searchHtml}${list}${fab}`;
}

function usageKind() {
  if (state.usageKind === "local" || state.usageKind === "improve") return state.usageKind;
  return "stt";
}

function paintUsageSwitch(head, show) {
  if (!head) return;
  const existing = head.querySelector(".usage-menu");
  if (!show) {
    state.usageMenuOpen = false;
    if (existing) existing.remove();
    return;
  }
  const kind = usageKind();
  const options = [
    ["stt", "OpenAI STT"],
    ["local", "Local Usage"],
    ["improve", "Note Improvement Usage"],
  ];
  const current = options.find((option) => option[0] === kind)[1];
  const open = Boolean(state.usageMenuOpen);
  const chevron = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5 8 10.5 12 6.5"></path></svg>';
  const items = options.map(([id, label]) => `<button type="button" role="option" data-usage-kind="${id}" aria-selected="${kind === id ? "true" : "false"}">${label}</button>`).join("");
  const html = `<div class="usage-menu${open ? " is-open" : ""}"><button type="button" class="usage-menu-btn" data-usage-menu aria-haspopup="listbox" aria-expanded="${open ? "true" : "false"}" aria-label="Usage source"><span>${current}</span>${chevron}</button><div class="usage-menu-list" role="listbox" aria-label="Usage source"${open ? "" : " hidden"}>${items}</div></div>`;
  if (existing) existing.outerHTML = html;
  else head.insertAdjacentHTML("beforeend", html);
}

function usageBars(days, basis, titleFor) {
  const rows = Array.isArray(days) ? days : [];
  const peak = rows.reduce((max, day) => Math.max(max, Number(day[basis]) || 0), 0);
  return rows.map((day) => {
    const height = peak ? Math.max(4, Math.round(((Number(day[basis]) || 0) / peak) * 100)) : 4;
    return `<i style="height:${height}%" title="${esc(titleFor(day))}"></i>`;
  }).join("");
}

function usageBoard(statsHtml, bars, label, from, to) {
  return `<div class="usage-board"><div class="stats">${statsHtml}</div><div class="chart-card"><div class="chart" role="img" aria-label="${esc(label)}">${bars}</div><div class="axis"><span>${esc(dayLabel(from))}</span><span>${esc(dayLabel(to))}</span></div></div></div>`;
}

function sttUsageHtml(report, label) {
  const source = report || { days: [], words: 0, durationMs: 0, costUsd: 0, from: "", to: "", dictations: 0 };
  const days = source.days || [];
  const basis = days.some((day) => day.durationMs > 0) ? "durationMs" : "words";
  const bars = usageBars(days, basis, (day) => `${day.date}: ${day.words} words, ${day.dictations} dictations`);
  const stats = `<article class="stat"><b>${minutes(source.durationMs)} min</b><span>Audio, ${source.dictations || 0} dictations</span></article><article class="stat"><b>${money(source.costUsd)}</b><span>Estimated API cost</span></article><article class="stat"><b>${new Intl.NumberFormat("en-US").format(source.words || 0)}</b><span>Spoken words</span></article>`;
  return usageBoard(stats, bars, label, source.from, source.to);
}

function usageHtml() {
  const kind = usageKind();
  if (kind === "improve") {
    const report = state.desk.improveUsage || { days: [], words: 0, tokens: 0, costUsd: 0, changes: 0, from: "", to: "" };
    const days = report.days || [];
    const basis = days.some((day) => day.words > 0) ? "words" : "tokens";
    const bars = usageBars(days, basis, (day) => `${day.date}: ${day.words} words, ${day.tokens} tokens, ${day.changes} changes`);
    const words = new Intl.NumberFormat("en-US").format(report.words || 0);
    const tokens = new Intl.NumberFormat("en-US").format(report.tokens || 0);
    const stats = `<article class="stat"><b>${words}</b><span>Words, ${report.changes || 0} changes</span></article><article class="stat"><b>${money(report.costUsd)}</b><span>Estimated API cost</span></article><article class="stat"><b>${tokens}</b><span>Tokens</span></article>`;
    return usageBoard(stats, bars, "Note improvement over the last 30 days", report.from, report.to);
  }
  if (kind === "local") return sttUsageHtml(state.desk.localUsage, "Local usage over the last 30 days");
  return sttUsageHtml(state.desk.usage, "Usage over the last 30 days");
}

function settingsHtml() {
  const settings = state.desk.settings || {};
  const sttEngine = settings.sttEngine === "openai" ? "openai" : "parakeet";
  const shortcut = settings.dictationShortcut || "ctrl+win";
  const isToggle = settings.dictationMode === "toggle";
  const shortcuts = [
    { id: "ctrl+win", keys: "<kbd>Ctrl</kbd> + <kbd>Win</kbd>" },
    { id: "ctrl+space", keys: "<kbd>Ctrl</kbd> + <kbd>Space</kbd>" },
    { id: "ctrl+alt", keys: "<kbd>Ctrl</kbd> + <kbd>Alt</kbd>" },
    { id: "ctrl+shift", keys: "<kbd>Ctrl</kbd> + <kbd>Shift</kbd>" },
  ];
  const shortcutHtml = shortcuts.map((item) => {
    const checked = shortcut === item.id ? "true" : "false";
    return `<button type="button" class="shortcut-option" role="radio" data-shortcut-select="${item.id}" aria-checked="${checked}"><span class="shortcut-keys">${item.keys}</span></button>`;
  }).join("");
  const modeTitle = isToggle ? "Press Once to Start / Second Time to Stop" : "Hold Shortcut to Dictate";
  const modeDesc = isToggle
    ? "Press the shortcut once to start recording, and press it a second time to finish."
    : "Keep the shortcut held down while speaking and release to finish dictation.";
  const dictationCard = `<div class="settings-card"><div class="section-label">Dictation</div><div class="shortcut-grid" role="radiogroup" aria-label="Dictation Shortcut">${shortcutHtml}</div><div class="mode-toggle-card"><div class="mode-toggle-copy"><strong>${modeTitle}</strong><span>${modeDesc}</span></div><div class="mode-slider-wrap"><span class="mode-slider-label${!isToggle ? " active" : ""}">Hold</span><button type="button" class="switch-btn" role="switch" data-dictation-mode-toggle aria-checked="${isToggle ? "true" : "false"}" aria-label="Toggle between Hold to Dictate and Press to Start/Stop"><span class="switch-thumb"></span></button><span class="mode-slider-label${isToggle ? " active" : ""}">Start / Stop</span></div></div></div>`;
  const hint = settings.hasKey ? "Saved locally (enter a new key to replace)" : "sk-... (optional with Parakeet v3)";
  const ask = (sttEngine === "openai" && (state.askKey || !settings.hasKey))
    ? `<div class="prompt-banner">Please enter your OpenAI API key to use cloud speech recognition, or switch to Parakeet v3 (Local).</div>`
    : "";
function sttInfoIcon(active) {
  if (active) {
    return `<svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="3" x2="13" y2="13"></line><line x1="13" y1="3" x2="3" y2="13"></line></svg>`;
  }
  return `<svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3.5" r="1.5"/><rect x="6.5" y="7" width="3" height="6" rx="1"/></svg>`;
}

function parakeetCardHtml(sttEngine) {
  const isChecked = sttEngine === "parakeet";
  const isPinned = Boolean(state.sttInfoParakeet);
  return `<div role="radio" tabindex="0" class="engine-option${isPinned ? " is-pinned" : ""}" data-stt-select="parakeet" aria-checked="${isChecked ? "true" : "false"}"><div class="engine-normal-view"><div class="engine-head"><strong>Parakeet v3 (Open-Source)</strong><button type="button" class="engine-info-btn" data-stt-info="parakeet" title="Model details" aria-label="Model details">${sttInfoIcon(false)}</button></div><p>Runs locally on your PC in the background. Free and requires no API key.</p></div><div class="engine-info-view"><div class="engine-info-head"><div class="engine-info-meta"><strong class="engine-info-title">Parakeet v3</strong><span class="engine-info-tagline">Deployed on your CPU &mdash; 0.6B model</span></div><button type="button" class="engine-info-btn active" data-stt-info="parakeet" title="Close details" aria-label="Close details">${sttInfoIcon(true)}</button></div><div class="engine-metrics"><div class="engine-metric-row"><div class="engine-metric-labels"><span>Accuracy</span><strong>94%</strong></div><div class="engine-bar-track"><div class="engine-bar-fill" style="width: 94%;"></div></div></div><div class="engine-metric-row"><div class="engine-metric-labels"><span>Speed (CPU)</span><strong>22×</strong></div><div class="engine-bar-track"><div class="engine-bar-fill" style="width: 60%;"></div></div></div></div></div></div>`;
}

function openaiCardHtml(sttEngine) {
  const isChecked = sttEngine === "openai";
  const isPinned = Boolean(state.sttInfoOpenai);
  return `<div role="radio" tabindex="0" class="engine-option${isPinned ? " is-pinned" : ""}" data-stt-select="openai" aria-checked="${isChecked ? "true" : "false"}"><div class="engine-normal-view"><div class="engine-head"><strong>gpt-transcribe</strong><button type="button" class="engine-info-btn" data-stt-info="openai" title="Model details" aria-label="Model details">${sttInfoIcon(false)}</button></div><p>Uses OpenAI gpt-transcribe with your personal API key.</p></div><div class="engine-info-view"><div class="engine-info-head"><div class="engine-info-meta"><strong class="engine-info-title">gpt-transcribe</strong><span class="engine-info-tagline">Automatic AI error correction</span></div><button type="button" class="engine-info-btn active" data-stt-info="openai" title="Close details" aria-label="Close details">${sttInfoIcon(true)}</button></div><div class="engine-metrics"><div class="engine-metric-row"><div class="engine-metric-labels"><span>Accuracy</span><strong>93%</strong></div><div class="engine-bar-track"><div class="engine-bar-fill" style="width: 93%;"></div></div></div><div class="engine-metric-row"><div class="engine-metric-labels"><span>Speed (API)</span><strong>34×</strong></div><div class="engine-bar-track"><div class="engine-bar-fill" style="width: 80%;"></div></div></div></div></div></div>`;
}

  const sttCard = `<div class="settings-card">${ask}<div class="section-label">Speech-to-Text Engine</div><div class="engine-grid" role="radiogroup" aria-label="Speech-to-Text Engine">${parakeetCardHtml(sttEngine)}${openaiCardHtml(sttEngine)}</div>${noteImproveToggle(settings)}<label class="key">OpenAI API Key ${sttEngine === "parakeet" ? "(Optional)" : ""}<div class="key-row"><input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(hint)}"><button type="button" id="save-key" class="btn-primary">Save Key</button></div></label></div>`;

  // Floating Bubble Appearance
  const bubbleStyle = state.draftFloatingBubble || settings.floatingBubble || "active";
  const bubbleOptions = [
    { id: "active", title: "Active", desc: "Default visible bubble on your desktop" },
    { id: "dimmed", title: "Grayed Out", desc: "Dimmed bubble, highlights on hover" },
    { id: "hidden", title: "Hidden", desc: "No bubble; use keyboard shortcut only" },
  ];
  const bubbleOptionsHtml = bubbleOptions.map((opt) => {
    const checked = bubbleStyle === opt.id ? "true" : "false";
    return `<button type="button" class="bubble-style-option" role="radio" data-bubble-select="${opt.id}" aria-checked="${checked}"><strong class="bubble-opt-title">${esc(opt.title)}</strong><span class="bubble-opt-desc">${esc(opt.desc)}</span></button>`;
  }).join("");
  const bubbleCard = `<div class="settings-card"><div class="section-label">Floating Bubble Appearance</div><div class="bubble-style-grid" role="radiogroup" aria-label="Floating Bubble Appearance">${bubbleOptionsHtml}</div></div>`;

  // Manage Elements Preview and Customization
  const allCommands = (state.desk && state.desk.commands) || [];
  const commandKeys = allCommands.map((c) => `cmd:${c.id}`);
  const allKeys = ["voice", "note", "tune", "shot", ...commandKeys];
  const currentElems = (state.draftBubbleElements || ["voice", "note", "tune", "shot"]).filter((k) => allKeys.includes(k));
  const removedKeys = allKeys.filter((k) => !currentElems.includes(k));

  const voiceNoteOn = state.draftVoiceNote !== false;
  const previewItemsHtml = currentElems.map((key) => {
    const def = getBubbleElementDef(key);
    if (!def) return "";
    const canRemove = currentElems.length > 1;
    const minusBtn = canRemove
      ? `<button type="button" class="elem-minus-btn" data-elem-remove="${key}" title="Remove ${esc(def.name)}" aria-label="Remove ${esc(def.name)}">−</button>`
      : "";
    const html = key === "voice" ? voiceComboHtml(voiceNoteOn, true) : def.html;
    return `<div class="bubble-preview-item" draggable="true" data-elem-id="${key}" title="${esc(def.name)} (drag to reorder)">${minusBtn}${html}</div>`;
  }).join("");

  const shelfItems = removedKeys.map((k) => {
    const def = getBubbleElementDef(k);
    if (!def) return "";
    return `<button type="button" class="removed-elem-btn" draggable="true" data-shelf-elem="${k}" data-elem-add="${k}" title="Add back ${esc(def.name)} (click or drag onto the bubble)">${def.miniIcon}<span>${esc(def.name)}</span><span class="elem-plus-badge">+</span></button>`;
  });
  if (!voiceNoteOn && currentElems.includes("voice")) {
    shelfItems.push(`<button type="button" class="removed-elem-btn" draggable="true" data-shelf-elem="vnote" data-vnote-add title="Add back ${VOICE_NOTE_DEF.name} (click or drop anywhere on the bubble — it snaps back to the mic)">${VOICE_NOTE_DEF.miniIcon}<span>${VOICE_NOTE_DEF.name}</span><span class="elem-plus-badge">+</span></button>`);
  }
  const removedShelfHtml = shelfItems.length > 0
    ? `<div class="removed-elements-shelf"><div class="shelf-head"><span class="shelf-label">Removed Elements</span></div><div class="removed-elements-list">${shelfItems.join("")}</div></div>`
    : "";

  const manageCard = `<div class="settings-card manage-elements-card"><div class="section-label">Manage Elements</div><div class="bubble-preview-wrap"><div class="bubble-preview-pill" id="bubble-preview-pill">${previewItemsHtml}</div></div>${removedShelfHtml}<div class="bubble-manage-actions"><button type="button" class="btn-secondary" id="bubble-reset">Reset to Default</button><button type="button" class="btn-primary" id="bubble-save">Save Changes</button></div></div>`;

  return `${sttCard}${dictationCard}${bubbleCard}${manageCard}`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function noteModelLine(model) {
  const progress = state.noteModelProgress;
  if (progress && progress.id === model.id && progress.error) return progress.error;
  if (progress && progress.id === model.id && !progress.done && progress.percent != null) {
    const received = formatBytes(progress.received);
    const speed = progress.bps ? `${(progress.bps / (1024 * 1024)).toFixed(1)} MB/s` : "";
    return `Downloading ${progress.percent}%${received ? ` · ${received}` : ""}${speed ? ` · ${speed}` : ""}`;
  }
  if (model.downloaded) return "Ready on this PC. The note stays on this device.";
  return "Download required before this model can be selected.";
}

async function openLocalDownload(id) {
  const current = state.noteModelProgress;
  state.noteModelProgress = current && current.id === id && !current.done && !current.error
    ? current
    : { id, percent: 0, received: 0, bps: 0 };
  await window.openflow.dispatch("notes.model.openDownload", { id, selectWhenReady: true });
  render();
}

function noteInfoIcon(active) {
  if (active) {
    return `<svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="3" x2="13" y2="13"></line><line x1="13" y1="3" x2="3" y2="13"></line></svg>`;
  }
  return `<svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3.5" r="1.5"/><rect x="6.5" y="7" width="3" height="6" rx="1"/></svg>`;
}

function noteModelChoice(settings) {
  const localId = settings.noteImproveLocalModel || "qwen2.5-3b-instruct-q4";
  const openaiId = settings.noteImproveModel || "gpt-6-luna";
  const localRow = (settings.noteModels || []).find((model) => model.id === localId) || {
    id: localId,
    downloaded: false,
    approxBytes: localId === "llama-3.2-3b-instruct-q4" ? 2000000000 : 2100000000,
  };
  const llama = localId === "llama-3.2-3b-instruct-q4";
  return {
    localId,
    openaiId,
    localRow,
    localTitle: llama ? "Llama 3.2 3B Instruct" : "Qwen2.5 3B Instruct",
    localInfo: llama ? "Llama 3.2 3B" : "Qwen2.5 3B",
    localTagline: llama ? "On this PC · Q4_K_M" : "On this PC · Q4_K_M",
    localSize: llama ? "~2.0 GB" : "~2.1 GB",
  };
}

function noteEngineCard(provider, title, detail, infoTitle, tagline, facts, selected, pinned, statusAttr, extra) {
  const rows = facts.map((fact) => `<div class="engine-metric-row"><div class="engine-metric-labels"><span>${esc(fact.label)}</span><strong>${esc(fact.value)}</strong></div></div>`).join("");
  const status = statusAttr ? ` ${statusAttr}` : "";
  const extras = extra || {};
  const locked = extras.locked ? " is-locked" : "";
  const bar = extras.bar || "";
  return `<div role="radio" tabindex="0" class="engine-option${pinned ? " is-pinned" : ""}${locked}" data-note-provider="${esc(provider)}" aria-checked="${selected ? "true" : "false"}"><div class="engine-normal-view"><div class="engine-head"><strong>${esc(title)}</strong><button type="button" class="engine-info-btn" data-note-info="${esc(provider)}" title="Model details" aria-label="Model details">${noteInfoIcon(false)}</button></div><p${status}>${esc(detail)}</p>${bar}</div><div class="engine-info-view"><div class="engine-info-head"><div class="engine-info-meta"><strong class="engine-info-title">${esc(infoTitle)}</strong><span class="engine-info-tagline">${esc(tagline)}</span></div><button type="button" class="engine-info-btn active" data-note-info="${esc(provider)}" title="Close details" aria-label="Close details">${noteInfoIcon(true)}</button></div><div class="engine-metrics">${rows}</div></div></div>`;
}

function noteImproveToggle(settings) {
  const hasKey = Boolean(settings.hasKey);
  const on = settings.noteImproveEnabled !== false;
  const hint = hasKey ? "" : `<p class="note-improve-hint">Add an OpenAI API key below to use note improvement.</p>`;
  return `<div class="note-improve-inline${hasKey ? "" : " is-unavailable"}"><div class="mode-toggle-card"><div class="mode-toggle-copy"><strong>Note improvement</strong><span>${hasKey ? "Rewrite notes with OpenAI. Model gpt-6-luna." : "An OpenAI API key is required."}</span></div><div class="mode-slider-wrap"><span class="mode-slider-label${on ? "" : " active"}">Off</span><button type="button" class="switch-btn" role="switch" data-note-improve-enabled aria-checked="${on ? "true" : "false"}" aria-label="Turn note improvement on or off"${hasKey ? "" : " disabled"}><span class="switch-thumb"></span></button><span class="mode-slider-label${on ? " active" : ""}">On</span></div></div></div>${hint}`;
}

function paintCommandEditor() {
  const editor = document.querySelector("#editor");
  if (!state.commandEditor || state.view !== "commands") {
    if (state.view !== "notes" || !state.editor) {
      editor.hidden = true;
      editor.dataset.id = "";
    }
    return;
  }
  const cmd = state.commandEditor;
  const editorKey = `cmd_${cmd.id || "__new__"}`;
  if (editor.dataset.id === editorKey && editor.querySelector("#cmd-editor-body")) {
    editor.classList.remove("note-shell");
    editor.hidden = false;
    return;
  }
  editor.dataset.id = editorKey;
  editor.classList.remove("note-shell");
  editor.classList.remove("is-expanded");
  if (editor._chrome) {
    editor._chrome.destroy();
    editor._chrome = null;
  }
  if (editor._sparkle) {
    editor._sparkle.destroy();
    editor._sparkle = null;
  }
  editor.hidden = false;
  const closeIcon = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3.5" y1="3.5" x2="12.5" y2="12.5"></line><line x1="12.5" y1="3.5" x2="3.5" y2="12.5"></line></svg>';
  const runAsAdmin = Boolean(cmd.runAsAdmin);
  const runTitle = runAsAdmin ? "Run with Administrator privileges" : "Run command";
  const toggleChecked = runAsAdmin ? "true" : "false";
  editor.innerHTML = `<header class="note-bubble-head cmd-editor-head"><div class="cmd-title-display"><strong>${esc(cmd.name)}</strong><span class="cmd-fixed-ext">${esc(cmd.extension)}</span></div><button type="button" class="editor-close-btn" id="cmd-editor-back" title="Close" aria-label="Close">${closeIcon}</button></header><textarea id="cmd-editor-body" placeholder="Write or paste your script here..." spellcheck="false" aria-label="Script content">${esc(cmd.content || "")}</textarea><footer class="note-bubble-foot cmd-editor-foot"><label class="cmd-admin-toggle" id="cmd-admin-toggle-label" title="Run as administrator"><button type="button" class="switch-btn" role="switch" id="cmd-editor-admin-toggle" aria-checked="${toggleChecked}" aria-label="Run as administrator"><span class="switch-thumb"></span></button><span class="cmd-admin-label">Run as administrator</span></label><div class="cmd-editor-actions">${cmd.id ? `<button type="button" id="cmd-editor-run" class="btn-secondary" title="${runTitle}"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4.5 3.5v9l8-4.5z"></path></svg><span>Run</span></button>` : ''}<button type="button" id="cmd-editor-save">Save</button></div></footer>`;
  const body = editor.querySelector("#cmd-editor-body");
  if (body) body.focus();
}

function paintCommandWizard() {
  const host = document.querySelector("#command-modal");
  if (!host) return;
  if (!state.commandWizard) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  const wizard = state.commandWizard;
  if (wizard.step === 1) {
    host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true" style="max-width: 580px;"><div><h2>Create Command</h2><p class="sub">Step 1 of 3: Select the script type.</p></div><div class="cmd-types-grid"><div class="cmd-type-card" role="button" tabindex="0" data-cmd-type-choose="bat"><div class="cmd-type-logo">${CMD_TYPE_INFO.bat.logo}</div><div class="cmd-type-title">Bat <span class="cmd-type-ext-badge">.bat</span></div><p class="cmd-type-desc">Windows Batch Script. Runs in cmd.exe with a visible console.</p></div><div class="cmd-type-card" role="button" tabindex="0" data-cmd-type-choose="powershell"><div class="cmd-type-logo">${CMD_TYPE_INFO.powershell.logo}</div><div class="cmd-type-title">PowerShell <span class="cmd-type-ext-badge">.ps1</span></div><p class="cmd-type-desc">Windows PowerShell Script. Runs in powershell.exe with a visible console.</p></div><div class="cmd-type-card" role="button" tabindex="0" data-cmd-type-choose="cmd"><div class="cmd-type-logo">${CMD_TYPE_INFO.cmd.logo}</div><div class="cmd-type-title">CMD <span class="cmd-type-ext-badge">.cmd</span></div><p class="cmd-type-desc">Windows Command File. Runs in cmd.exe with a visible console.</p></div></div><div class="onboarding-actions" style="margin-top: 6px;"><button type="button" class="btn-secondary" data-cmd-wizard-cancel>Cancel</button></div></div>`;
    return;
  }

  const typeInfo = CMD_TYPE_INFO[wizard.type] || CMD_TYPE_INFO.powershell;
  if (wizard.step === 3) {
    const currentIcon = wizard.icon || "terminal";
    const iconsHtml = COMMAND_ICONS.map((icon) => {
      const isSelected = icon.id === currentIcon;
      return `<button type="button" class="cmd-icon-btn-compact${isSelected ? " selected" : ""}" role="radio" aria-checked="${isSelected ? "true" : "false"}" data-cmd-wizard-icon="${esc(icon.id)}" aria-label="${esc(icon.id)}">
        <div class="cmd-icon-bubble-preview">${getCommandSvg(icon.id, 16, 16)}</div>
      </button>`;
    }).join("");

    host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true" style="max-width: 320px; padding: 16px 18px;">
      <div>
        <h2>Choose a Symbol</h2>
        <p class="sub">Step 3 of 3: Select an icon for <strong>${esc(wizard.name)}${esc(typeInfo.extension)}</strong>.</p>
      </div>
      <div class="cmd-icon-picker-grid-compact" role="radiogroup" aria-label="Command Symbol Collection">
        ${iconsHtml}
      </div>
      <div class="onboarding-actions" style="margin-top: 6px;">
        <button type="button" class="btn-secondary" data-cmd-wizard-back>Back</button>
        <button type="button" class="btn-primary" data-cmd-wizard-finish>Continue</button>
      </div>
    </div>`;
    return;
  }

  host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Name Your Command</h2><p class="sub">Step 2 of 3: Enter a name for your ${esc(typeInfo.title)} script. The name, type and extension will be permanent.</p></div><div><div class="cmd-name-input-group"><input type="text" id="cmd-name-input" placeholder="e.g. Restart Spooler" value="${esc(wizard.name)}" autocomplete="off" spellcheck="false" maxlength="48"><span class="cmd-name-ext">${esc(typeInfo.extension)}</span></div><div class="cmd-input-error" id="cmd-name-error">${esc(wizard.error || "")}</div></div><div class="onboarding-actions"><button type="button" class="btn-secondary" data-cmd-wizard-back>Back</button><button type="button" class="btn-primary" data-cmd-wizard-next>Continue</button></div></div>`;
  const input = host.querySelector("#cmd-name-input");
  if (input) {
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function paintIconPicker() {
  const host = document.querySelector("#icon-picker-modal");
  if (!host) return;
  if (!state.iconPicker) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  const currentIcon = state.iconPicker.currentIcon || "terminal";
  const closeIcon = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3.5" y1="3.5" x2="12.5" y2="12.5"></line><line x1="12.5" y1="3.5" x2="3.5" y2="12.5"></line></svg>';
  const iconsHtml = COMMAND_ICONS.map((icon) => {
    const isSelected = icon.id === currentIcon;
    return `<button type="button" class="cmd-icon-btn-compact${isSelected ? " selected" : ""}" role="radio" aria-checked="${isSelected ? "true" : "false"}" data-cmd-icon-choice="${esc(icon.id)}" aria-label="${esc(icon.id)}">
      <div class="cmd-icon-bubble-preview">${getCommandSvg(icon.id, 16, 16)}</div>
    </button>`;
  }).join("");

  host.innerHTML = `<div class="cmd-icon-picker-card" role="dialog" aria-modal="true">
    <div class="cmd-icon-picker-head">
      <div class="cmd-icon-picker-title">
        <h3>Change Symbol</h3>
        <p class="sub">${esc(state.iconPicker.name || "Command")}</p>
      </div>
      <button type="button" class="editor-close-btn" data-icon-picker-close title="Close" aria-label="Close">${closeIcon}</button>
    </div>
    <div class="cmd-icon-picker-grid-compact" role="radiogroup" aria-label="Command Symbol Collection">
      ${iconsHtml}
    </div>
  </div>`;
}

function paintEditor() {
  const editor = document.querySelector("#editor");
  if (!state.editor || state.view !== "notes") {
    if (editor._sparkle && editor._sparkle.closeHistory) editor._sparkle.closeHistory();
    if (state.view !== "commands" || !state.commandEditor) {
      editor.hidden = true;
      editor.dataset.id = "";
      editor.classList.remove("note-shell");
    }
    return;
  }
  const editorKey = state.editor.id || "__draft__";
  if (editor.dataset.id === editorKey && editor.querySelector("#editor-title")) {
    editor.classList.add("note-shell");
    editor.hidden = false;
    if (editor._chrome) editor._chrome.setShortcut((state.desk && state.desk.settings && state.desk.settings.dictationShortcut) || "");
    if (editor._sparkle && editor._sparkle.paintAvailability) editor._sparkle.paintAvailability();
    return;
  }
  if (editor._sparkle) {
    editor._sparkle.destroy();
    editor._sparkle = null;
  }
  if (editor._chrome) {
    editor._chrome.destroy();
    editor._chrome = null;
  }
  editor.dataset.id = editorKey;
  editor.classList.add("note-shell");
  editor.hidden = false;
  const titleVal = state.editor.title || "Note";
  const closeIcon = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3.5" y1="3.5" x2="12.5" y2="12.5"></line><line x1="12.5" y1="3.5" x2="3.5" y2="12.5"></line></svg>';
  const shortcut = (state.desk && state.desk.settings && state.desk.settings.dictationShortcut) || "";
  const rail = window.OpenflowNoteChrome ? window.OpenflowNoteChrome.railHtml() : `<div class="sparkle-host"></div>`;
  const hint = window.OpenflowNoteChrome ? window.OpenflowNoteChrome.hintHtml(shortcut) : "";
  const formatDock = window.OpenflowNoteChrome ? window.OpenflowNoteChrome.formatDockHtml() : "";
  editor.innerHTML = `<div class="note-rail">${rail}</div><div class="note-top"><input id="editor-title" value="${esc(titleVal)}" placeholder="Note title" aria-label="Title"><button type="button" class="editor-close-btn" id="editor-back" title="Close" aria-label="Close">${closeIcon}</button></div><div class="note-main"><div class="note-write"><textarea id="editor-body" aria-label="Note" spellcheck="false" autocorrect="off" autocapitalize="off">${esc(state.editor.content || "")}</textarea>${hint}</div><div class="note-foot"><button type="button" id="editor-copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M4 16V5a1 1 0 0 1 1-1h11"></path></svg><span>Copy</span></button><button type="button" id="editor-save">Save</button></div><div class="sparkle-dock" data-sparkle-dock></div>${formatDock}</div><div class="note-lip"></div>`;
  mountEditorSparkle(editor);
  wireEditorChrome(editor);
  paintEditorVoice();
  const body = editor.querySelector("#editor-body");
  if (body) body.focus();
}

function mountEditorSparkle(editor) {
  if (!window.OpenflowSparkle || !editor) return;
  const host = editor.querySelector(".sparkle-host");
  const textarea = editor.querySelector("#editor-body");
  if (!host || !textarea) return;
  editor._sparkle = window.OpenflowSparkle.attach({
    host,
    root: editor,
    textarea,
    getNote() {
      const title = editor.querySelector("#editor-title");
      const body = editor.querySelector("#editor-body");
      return {
        id: state.editor && state.editor.id ? state.editor.id : "",
        title: title ? title.value : "Note",
        content: body ? body.value : "",
      };
    },
    setContent(text) {
      const body = editor.querySelector("#editor-body");
      if (body) body.value = text;
      if (state.editor) state.editor.content = text;
      if (window.OpenflowSparkle) window.OpenflowSparkle.sync(body, { reveal: true });
    },
    setNoteId(id) {
      if (!state.editor) return;
      state.editor.id = id;
      state.editor.isDraft = false;
      editor.dataset.id = id || "__draft__";
    },
    getSettings() {
      return (state.desk && state.desk.settings) || {};
    },
    async onSettings(partial) {
      const saved = await window.openflow.dispatch("settings.save", partial);
      if (state.desk && saved && saved.settings) state.desk.settings = saved.settings;
    },
    onSaved(pad) {
      if (!state.desk) return;
      const pads = state.desk.pads || (state.desk.pads = []);
      const index = pads.findIndex((row) => row.id === pad.id);
      if (index >= 0) pads[index] = { ...pads[index], ...pad };
      else pads.push(pad);
    },
    openSettings() {
      if (editor._sparkle) editor._sparkle.destroy();
      state.editor = null;
      state.view = "settings";
      render();
    },
    dispatch: (action, payload) => window.openflow.dispatch(action, payload),
  });
}

function currentEditorKey() {
  return state.editor ? (state.editor.id || "__draft__") : "";
}

function wireEditorChrome(editor) {
  if (!window.OpenflowNoteChrome || !editor) return;
  if (editor._chrome) editor._chrome.destroy();
  editor._chrome = window.OpenflowNoteChrome.bind({
    shell: editor,
    textarea: editor.querySelector("#editor-body"),
    shortcut: (state.desk && state.desk.settings && state.desk.settings.dictationShortcut) || "",
    getPads: async () => {
      if (!window.openflow) return (state.desk && state.desk.pads) || [];
      const pads = await window.openflow.dispatch("pads.list");
      if (state.desk && Array.isArray(pads)) state.desk.pads = pads;
      return pads || [];
    },
    getCurrentId: () => (state.editor && state.editor.id) || "",
    getSparkle: () => editor._sparkle,
    onNew: () => {
      if (window.openflow) window.openflow.dispatch("notes.spawn").catch(() => {});
    },
    onOpen: (id) => {
      const pad = ((state.desk && state.desk.pads) || []).find((item) => item.id === id);
      if (!pad) return;
      state.editor = { id: pad.id, isDraft: false, title: pad.title || "Note", content: pad.content || "" };
      editor.dataset.id = "";
      render();
    },
  });
}

function paintEditorVoice() {
  const editor = document.querySelector("#editor");
  if (editor && editor._chrome) editor._chrome.setListening(editorVoice.state === "active");
}

function setEditorVoiceState(next) {
  editorVoice.state = next;
  paintEditorVoice();
  if (next === "idle") {
    const waiters = editorVoice.waiters;
    editorVoice.waiters = [];
    waiters.forEach((resolve) => resolve());
    const editor = document.querySelector("#editor");
    if (editor && editor._sparkle) editor._sparkle.onExternalChange();
  }
}

function writeEditorVoiceText(text) {
  const body = document.querySelector("#editor-body");
  if (!body || editorVoice.key !== currentEditorKey()) return;
  const base = editorVoice.base;
  const prefix = base ? (/\s$/.test(base) ? base : `${base} `) : "";
  body.value = prefix + text;
  body.scrollTop = body.scrollHeight;
  if (window.OpenflowSparkle) window.OpenflowSparkle.sync(body);
  if (document.activeElement === body) body.selectionStart = body.selectionEnd = body.value.length;
  if (state.editor) state.editor.content = body.value;
}

function onEditorVoice(message) {
  if (!message) return;
  if (message.type === "start") {
    const body = document.querySelector("#editor-body");
    editorVoice.key = currentEditorKey();
    editorVoice.base = body ? body.value : (state.editor ? state.editor.content || "" : "");
    editorVoice.transcript = "";
    setEditorVoiceState("active");
  }
  if (message.type === "text") {
    const clean = String(message.text || "").trim();
    if (clean) {
      editorVoice.transcript = (editorVoice.transcript ? `${editorVoice.transcript} ` : "") + clean;
      writeEditorVoiceText(editorVoice.transcript);
    }
  }
  if (message.type === "final") {
    const clean = String(message.text || "").trim();
    if (clean) {
      editorVoice.transcript = clean;
      writeEditorVoiceText(clean);
    }
  }
  if (message.type === "stopped" && editorVoice.state === "active") setEditorVoiceState("busy");
  if (message.type === "done") setEditorVoiceState("idle");
}

function stopEditorVoice() {
  if (editorVoice.state === "active" && window.openflow) window.openflow.dispatch("voicenote.stop").catch(() => {});
}

// Stop a running dictation and wait until its last words have landed in the editor.
function finishEditorVoice() {
  if (editorVoice.state === "idle" || !window.openflow) return Promise.resolve();
  const done = new Promise((resolve) => {
    editorVoice.waiters.push(resolve);
    setTimeout(resolve, 20000);
  });
  stopEditorVoice();
  return done;
}

function paintOnboarding() {
  const host = document.querySelector("#onboarding");
  if (!host) return;
  if (!state.onboardingStep) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  if (state.onboardingStep === "note-improve" || state.onboardingStep === "note-improve-key") {
    host.innerHTML = noteImproveOnboardingHtml();
    return;
  }
  if (state.onboardingStep === "apikey") {
    host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Enter OpenAI API Key</h2><p class="sub">Enter your OpenAI API key to start dictating with gpt-transcribe.</p></div><div class="key-row"><input id="onboard-api-key" class="onboard-input" type="password" autocomplete="off" spellcheck="false" placeholder="sk-..."></div><div class="onboarding-actions"><button type="button" class="btn-secondary" data-onboard-back>Back</button><button type="button" class="btn-primary" data-onboard-save-key>Save & Start</button></div></div>`;
    const input = host.querySelector("#onboard-api-key");
    if (input) input.focus();
    return;
  }
  host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Welcome to OpenFlow</h2><p class="sub">Choose how you want to transcribe your voice. You can change this anytime in Settings.</p></div><div class="onboarding-choices"><button type="button" class="onboarding-choice" data-onboard-choose="parakeet"><strong><span>Parakeet v3 (Local Open-Source)</span><span class="engine-badge ready">Recommended · Free</span></strong><span>Installed with OpenFlow. Runs locally on your PC in the background — start immediately without an API key.</span></button><button type="button" class="onboarding-choice" data-onboard-choose="openai"><strong><span>OpenAI API (gpt-transcribe)</span><span class="engine-badge">Cloud API</span></strong><span>Transcribe in the cloud using your own OpenAI API key.</span></button></div></div>`;
}

function noteImproveOnboardingHtml() {
  if (state.onboardingStep === "note-improve-key") {
    return `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Improve notes with AI</h2><p class="sub">OpenAI uses the same API key as dictation.</p></div><div class="key-row"><input id="note-onboard-key" class="onboard-input" type="password" autocomplete="off" spellcheck="false" placeholder="sk-..."></div><div class="onboarding-actions"><button type="button" class="btn-secondary" data-note-onboard="later">Later</button><button type="button" class="btn-secondary" data-note-onboard="test">Test key</button><button type="button" class="btn-primary" data-note-onboard="save-key">Save</button></div>${state.noteKeyTest ? `<p class="sub">${esc(state.noteKeyTest)}</p>` : ""}</div>`;
  }
  return `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Improve notes with AI</h2><p class="sub">A sparkle button can rewrite notes with your OpenAI API key. You can change this anytime in Settings.</p></div><div class="onboarding-choices"><button type="button" class="onboarding-choice" data-note-onboard="openai"><strong>Use OpenAI</strong><span>Uses the saved API key. Model gpt-6-luna.</span></button><button type="button" class="onboarding-choice" data-note-onboard="later"><strong>Skip</strong><span>Note improvement stays off until you turn it on in Settings.</span></button></div></div>`;
}

function paintConfirmModal() {
  const host = document.querySelector("#confirm-modal");
  if (!host) return;
  if (state.confirmSttEngine) {
    const label = state.confirmSttEngine === "openai"
      ? "gpt-transcribe"
      : "Parakeet v3 (Open-Source, Local)";
    host.hidden = false;
    host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Switch Speech-to-Text Model?</h2><p class="sub">Use <strong>${esc(label)}</strong> for all dictation sessions?</p></div><div class="onboarding-actions"><button type="button" class="btn-secondary" data-confirm-cancel>Cancel</button><button type="button" class="btn-primary" data-confirm-stt-ok>OK</button></div></div>`;
    return;
  }
  if (state.confirmNoteProvider) {
    const settings = (state.desk && state.desk.settings) || {};
    const choice = noteModelChoice(settings);
    const label = state.confirmNoteProvider === "local" ? choice.localTitle : choice.openaiId;
    host.hidden = false;
    host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Switch note model?</h2><p class="sub">Use <strong>${esc(label)}</strong> for note improvement?</p></div><div class="onboarding-actions"><button type="button" class="btn-secondary" data-confirm-cancel>Cancel</button><button type="button" class="btn-primary" data-confirm-note-ok>OK</button></div></div>`;
    return;
  }
  if (state.confirmDeleteCommandId) {
    const cmd = ((state.desk && state.desk.commands) || []).find((row) => row.id === state.confirmDeleteCommandId);
    const title = cmd && cmd.name ? `${cmd.name}${cmd.extension}` : "this command";
    host.hidden = false;
    host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Delete Command?</h2><p class="sub">Are you sure you want to delete "${esc(title)}"? This will also remove it from the Bubble and cannot be undone.</p></div><div class="onboarding-actions"><button type="button" class="btn-secondary" data-confirm-cancel>Cancel</button><button type="button" class="btn-danger" data-confirm-delete-command>Delete</button></div></div>`;
    return;
  }
  if (!state.confirmDeleteId) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  const pad = (state.desk && state.desk.pads || []).find((row) => row.id === state.confirmDeleteId);
  const title = pad && pad.title ? pad.title : "this note";
  host.hidden = false;
  host.innerHTML = `<div class="onboarding-card" role="dialog" aria-modal="true"><div><h2>Delete Note?</h2><p class="sub">Are you sure you want to delete "${esc(title)}"? This action cannot be undone.</p></div><div class="onboarding-actions"><button type="button" class="btn-secondary" data-confirm-cancel>Cancel</button><button type="button" class="btn-danger" data-confirm-delete>Delete</button></div></div>`;
}

document.addEventListener("DOMContentLoaded", () => {
  const viewEl = document.querySelector("#view");
  if (viewEl) {
    viewEl.addEventListener("dragstart", (event) => {
      const shelfItem = event.target.closest("[data-shelf-elem]");
      if (shelfItem) {
        draggedShelfId = shelfItem.dataset.shelfElem;
        shelfItem.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", draggedShelfId);
        }
        return;
      }
      const item = event.target.closest(".bubble-preview-item");
      if (!item) return;
      draggedElemId = item.dataset.elemId;
      item.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedElemId);
      }
    });

    viewEl.addEventListener("dragover", (event) => {
      if (draggedShelfId) {
        const pill = event.target.closest("#bubble-preview-pill");
        viewEl.querySelectorAll(".bubble-preview-pill.drop-active").forEach((el) => {
          if (el !== pill) el.classList.remove("drop-active");
        });
        if (pill) {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          pill.classList.add("drop-active");
        }
        return;
      }
      const item = event.target.closest(".bubble-preview-item");
      if (item && draggedElemId) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        if (item.dataset.elemId !== draggedElemId) {
          viewEl.querySelectorAll(".bubble-preview-item.drop-target").forEach((el) => {
            if (el !== item) el.classList.remove("drop-target");
          });
          item.classList.add("drop-target");
        }
      }
    });

    viewEl.addEventListener("dragleave", (event) => {
      const item = event.target.closest(".bubble-preview-item");
      if (item) item.classList.remove("drop-target");
    });

    viewEl.addEventListener("dragend", () => {
      draggedElemId = null;
      draggedShelfId = null;
      viewEl.querySelectorAll(".bubble-preview-item, [data-shelf-elem]").forEach((el) => el.classList.remove("dragging", "drop-target"));
      viewEl.querySelectorAll(".bubble-preview-pill.drop-active").forEach((el) => el.classList.remove("drop-active"));
    });

    viewEl.addEventListener("drop", (event) => {
      if (draggedShelfId) {
        const shelfId = draggedShelfId;
        draggedShelfId = null;
        const pill = event.target.closest("#bubble-preview-pill");
        if (pill) {
          event.preventDefault();
          if (shelfId === "vnote") {
            // Wherever it lands on the bubble, the voice note button snaps back onto the mic.
            state.draftVoiceNote = true;
          } else {
            const list = [...(state.draftBubbleElements || ["voice", "note", "tune", "shot"])];
            if (!list.includes(shelfId)) {
              const target = event.target.closest(".bubble-preview-item");
              const toIdx = target ? list.indexOf(target.dataset.elemId) : -1;
              if (toIdx === -1) list.push(shelfId);
              else list.splice(toIdx, 0, shelfId);
              state.draftBubbleElements = list;
            }
          }
          render();
        }
        return;
      }
      const item = event.target.closest(".bubble-preview-item");
      if (item && draggedElemId && item.dataset.elemId !== draggedElemId) {
        event.preventDefault();
        const targetId = item.dataset.elemId;
        const list = [...(state.draftBubbleElements || ["voice", "note", "tune", "shot"])];
        const fromIdx = list.indexOf(draggedElemId);
        const toIdx = list.indexOf(targetId);
        if (fromIdx !== -1 && toIdx !== -1) {
          list.splice(fromIdx, 1);
          list.splice(toIdx, 0, draggedElemId);
          state.draftBubbleElements = list;
          render();
        }
      }
      draggedElemId = null;
      viewEl.querySelectorAll(".bubble-preview-item").forEach((el) => el.classList.remove("dragging", "drop-target"));
    });
  }

  document.querySelector(".view-head").addEventListener("click", (event) => {
    const option = event.target.closest("[data-usage-kind]");
    if (option) {
      event.stopPropagation();
      const next = option.dataset.usageKind;
      state.usageKind = next === "local" || next === "improve" ? next : "stt";
      state.usageMenuOpen = false;
      render();
      return;
    }
    const toggle = event.target.closest("[data-usage-menu]");
    if (!toggle) return;
    event.stopPropagation();
    state.usageMenuOpen = !state.usageMenuOpen;
    render();
  });
  document.querySelector(".view-head").addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.usageMenuOpen) return;
    state.usageMenuOpen = false;
    render();
  });
  document.addEventListener("click", (event) => {
    if (!state.usageMenuOpen) return;
    if (event.target.closest(".usage-menu")) return;
    state.usageMenuOpen = false;
    render();
  });

  document.querySelector("#nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-nav]");
    if (!button) return;
    stopEditorVoice();
    state.view = button.dataset.nav;
    state.editor = null;
    state.commandEditor = null;
    state.commandWizard = null;
    state.confirmDeleteId = null;
    state.confirmDeleteCommandId = null;
    if (state.view === "notes" || state.view === "commands" || state.view === "usage" || state.view === "settings") load().catch(() => {});
    else render();
  });

  document.querySelector("#view").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const option = event.target.closest(".engine-option");
      if (option && !event.target.closest(".engine-info-btn")) {
        event.preventDefault();
        option.click();
      }
    }
  });

  document.querySelector("#view").addEventListener("click", async (event) => {
    
    const newCmdBtn = event.target.closest("[data-new-command]");
    if (newCmdBtn) {
      state.commandWizard = { step: 1, type: "powershell", name: "", error: "" };
      paintCommandWizard();
      return;
    }

    const clearSearch = event.target.closest("#commands-search-clear");
    if (clearSearch) {
      state.commandSearch = "";
      render();
      return;
    }

    const clearNotes = event.target.closest("#notes-search-clear");
    if (clearNotes) {
      state.noteSearch = "";
      render();
      return;
    }

    const iconBtn = event.target.closest("[data-command-icon-btn]");
    if (iconBtn) {
      const cmd = ((state.desk && state.desk.commands) || []).find((c) => c.id === iconBtn.dataset.commandIconBtn);
      if (cmd) {
        state.iconPicker = { commandId: cmd.id, currentIcon: cmd.icon || "terminal", name: cmd.name };
        render();
      }
      return;
    }

    const openCmd = event.target.closest("[data-command-open]");
    if (openCmd) {
      const cmd = ((state.desk && state.desk.commands) || []).find((c) => c.id === openCmd.dataset.commandOpen);
      if (cmd) {
        state.commandEditor = {
          id: cmd.id,
          isNew: false,
          name: cmd.name,
          type: cmd.type,
          extension: cmd.extension,
          content: cmd.content,
          runAsAdmin: Boolean(cmd.runAsAdmin),
          icon: cmd.icon || "terminal",
        };
        render();
      }
      return;
    }

    const runCmd = event.target.closest("[data-command-run]");
    if (runCmd && window.openflow) {
      const cmdId = runCmd.dataset.commandRun;
      runCmd.disabled = true;
      const originalHtml = runCmd.innerHTML;
      runCmd.innerHTML = '<span class="note-spin" style="width:12px;height:12px;display:inline-block;border:1.5px solid var(--muted);border-top-color:var(--fg);border-radius:50%;animation:ofspin .7s linear infinite;"></span>';
      window.openflow.dispatch("commands.run", { id: cmdId }).then((res) => {
        if (res && res.ok) {
          runCmd.innerHTML = '✓';
          setTimeout(() => { runCmd.innerHTML = originalHtml; runCmd.disabled = false; }, 1200);
        } else {
          runCmd.innerHTML = originalHtml;
          runCmd.disabled = false;
        }
      }).catch(() => {
        runCmd.innerHTML = originalHtml;
        runCmd.disabled = false;
      });
      return;
    }

    const delCmd = event.target.closest("[data-command-delete]");
    if (delCmd) {
      state.confirmDeleteCommandId = delCmd.dataset.commandDelete;
      paintConfirmModal();
      return;
    }

    const copyBtn = event.target.closest("[data-copy-text]");
    if (copyBtn && window.openflow) {
      await window.openflow.dispatch("clipboard.copy", { text: copyBtn.dataset.copyText });
      copyBtn.textContent = "Copied ✓";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1000);
      return;
    }

    const sttInfo = event.target.closest("[data-stt-info]");
    if (sttInfo) {
      event.stopPropagation();
      event.preventDefault();
      const engine = sttInfo.dataset.sttInfo;
      if (engine === "parakeet") {
        state.sttInfoParakeet = !state.sttInfoParakeet;
      } else if (engine === "openai") {
        state.sttInfoOpenai = !state.sttInfoOpenai;
      }
      render();
      return;
    }

    const sttSelect = event.target.closest("[data-stt-select]");
    if (sttSelect && window.openflow) {
      const nextEngine = sttSelect.dataset.sttSelect === "openai" ? "openai" : "parakeet";
      state.confirmDeleteId = null;
      state.confirmSttEngine = nextEngine;
      paintConfirmModal();
      return;
    }

    const shortcutSelect = event.target.closest("[data-shortcut-select]");
    if (shortcutSelect && window.openflow) {
      const nextShortcut = shortcutSelect.dataset.shortcutSelect;
      await window.openflow.dispatch("settings.save", { dictationShortcut: nextShortcut });
      await load();
      return;
    }

    const modeToggle = event.target.closest("[data-dictation-mode-toggle]");
    if (modeToggle && window.openflow) {
      const currentMode = (state.desk && state.desk.settings && state.desk.settings.dictationMode) || "hold";
      const nextMode = currentMode === "toggle" ? "hold" : "toggle";
      await window.openflow.dispatch("settings.save", { dictationMode: nextMode });
      await load();
      return;
    }

    const noteEnabled = event.target.closest("[data-note-improve-enabled]");
    if (noteEnabled && window.openflow) {
      const settings = (state.desk && state.desk.settings) || {};
      if (!settings.hasKey || noteEnabled.disabled) return;
      await window.openflow.dispatch("settings.save", { noteImproveEnabled: !settings.noteImproveEnabled });
      await load();
      return;
    }
    const noteInfo = event.target.closest("[data-note-info]");
    if (noteInfo) {
      event.stopPropagation();
      event.preventDefault();
      if (noteInfo.dataset.noteInfo === "local") state.noteInfoLocal = !state.noteInfoLocal;
      else state.noteInfoOpenai = !state.noteInfoOpenai;
      render();
      return;
    }
    const noteProvider = event.target.closest("[data-note-provider]");
    if (noteProvider && window.openflow) {
      const next = noteProvider.dataset.noteProvider === "local" ? "local" : "openai";
      const settings = (state.desk && state.desk.settings) || {};
      const current = settings.noteImproveProvider === "local" ? "local" : "openai";
      const choice = noteModelChoice(settings);
      if (next === "local" && !choice.localRow.downloaded) {
        await openLocalDownload(choice.localId);
        return;
      }
      if (next === current) return;
      state.confirmDeleteId = null;
      state.confirmSttEngine = null;
      state.confirmNoteProvider = next;
      paintConfirmModal();
      return;
    }
    const noteOpenAIModel = event.target.closest("[data-note-openai-model]");
    if (noteOpenAIModel && window.openflow) {
      await window.openflow.dispatch("settings.save", { noteImproveModel: noteOpenAIModel.dataset.noteOpenaiModel });
      await load();
      return;
    }
    const noteLocalModel = event.target.closest("[data-note-local-model]");
    if (noteLocalModel && window.openflow) {
      await window.openflow.dispatch("settings.save", { noteImproveLocalModel: noteLocalModel.dataset.noteLocalModel });
      await load();
      return;
    }
    const noteAuto = event.target.closest("[data-note-auto]");
    if (noteAuto && window.openflow) {
      const current = !state.desk || !state.desk.settings || state.desk.settings.noteImproveAutoSuggestions !== false;
      await window.openflow.dispatch("settings.save", { noteImproveAutoSuggestions: !current });
      await load();
      return;
    }
    const noteDownload = event.target.closest("[data-note-download]");
    if (noteDownload && window.openflow) {
      await openLocalDownload(noteDownload.dataset.noteDownload);
      return;
    }
    const noteCancel = event.target.closest("[data-note-cancel]");
    if (noteCancel && window.openflow) {
      await window.openflow.dispatch("notes.model.cancel", { id: noteCancel.dataset.noteCancel });
      state.noteModelProgress = null;
      await load();
      return;
    }
    const noteDelete = event.target.closest("[data-note-delete]");
    if (noteDelete && window.openflow) {
      await window.openflow.dispatch("notes.model.delete", { id: noteDelete.dataset.noteDelete });
      state.noteModelProgress = null;
      await load();
      return;
    }
    const noteTest = event.target.closest("[data-note-test-key]");
    if (noteTest && window.openflow) {
      const result = await window.openflow.dispatch("notes.model.testKey");
      state.noteKeyTest = result && result.message ? result.message : "Key test failed.";
      render();
      return;
    }

    const bubbleSelect = event.target.closest("[data-bubble-select]");
    if (bubbleSelect && window.openflow) {
      const nextStyle = bubbleSelect.dataset.bubbleSelect;
      state.draftFloatingBubble = nextStyle;
      await window.openflow.dispatch("settings.save", { floatingBubble: nextStyle });
      render();
      return;
    }

    if (event.target.closest("[data-vnote-remove]")) {
      state.draftVoiceNote = false;
      render();
      return;
    }

    if (event.target.closest("[data-vnote-add]")) {
      state.draftVoiceNote = true;
      render();
      return;
    }

    const elemRemove = event.target.closest("[data-elem-remove]");
    if (elemRemove) {
      const key = elemRemove.dataset.elemRemove;
      const list = state.draftBubbleElements || ["voice", "note", "tune", "shot"];
      if (list.length > 1) {
        state.draftBubbleElements = list.filter((k) => k !== key);
        render();
      }
      return;
    }

    const elemAdd = event.target.closest("[data-elem-add]");
    if (elemAdd) {
      const key = elemAdd.dataset.elemAdd;
      const list = state.draftBubbleElements || ["voice", "note", "tune", "shot"];
      if (!list.includes(key)) {
        state.draftBubbleElements = [...list, key];
        render();
      }
      return;
    }

    const bubbleReset = event.target.closest("#bubble-reset");
    if (bubbleReset) {
      state.draftBubbleElements = ["voice", "note", "tune", "shot"];
      state.draftFloatingBubble = "active";
      state.draftVoiceNote = true;
      render();
      return;
    }

    const bubbleSave = event.target.closest("#bubble-save");
    if (bubbleSave && window.openflow) {
      bubbleSave.disabled = true;
      bubbleSave.textContent = "Saving...";
      await window.openflow.dispatch("settings.save", {
        bubbleElements: state.draftBubbleElements || ["voice", "note", "tune", "shot"],
        floatingBubble: state.draftFloatingBubble || "active",
        voiceNoteButton: state.draftVoiceNote !== false,
      });
      bubbleSave.textContent = "Saved";
      bubbleSave.classList.add("saved");
      await new Promise((r) => setTimeout(r, 600));
      state.draftBubbleElements = null;
      state.draftFloatingBubble = null;
      state.draftVoiceNote = null;
      await load();
      return;
    }

    const created = event.target.closest("[data-new-pad]");
    if (created) {
      state.view = "notes";
      state.confirmDeleteId = null;
      state.editor = { id: "", isDraft: true, title: "Note", content: "" };
      const editor = document.querySelector("#editor");
      if (editor) editor.dataset.id = "";
      render();
      return;
    }

    const remove = event.target.closest("[data-pad-delete]");
    if (remove) {
      state.confirmDeleteId = remove.dataset.padDelete;
      paintConfirmModal();
      return;
    }

    const open = event.target.closest("[data-pad-open]");
    if (open) {
      const pad = (state.desk.pads || []).find((item) => item.id === open.dataset.padOpen);
      if (!pad) return;
      state.confirmDeleteId = null;
      state.editor = { id: pad.id, isDraft: false, title: pad.title || "Note", content: pad.content || "" };
      const editor = document.querySelector("#editor");
      if (editor) editor.dataset.id = "";
      render();
    }
  });

  
  const viewElement = document.querySelector("#view");
  if (viewElement) {
    viewElement.addEventListener("input", (event) => {
      const notesSearch = event.target && event.target.id === "notes-search-input";
      const commandsSearch = event.target && event.target.id === "commands-search-input";
      if (notesSearch || commandsSearch) {
        if (notesSearch) state.noteSearch = event.target.value;
        else state.commandSearch = event.target.value;
        const viewEl = document.querySelector("#view");
        const active = notesSearch ? "notes" : "commands";
        if (viewEl && state.view === active) {
          viewEl.innerHTML = notesSearch ? notesHtml() : commandsHtml();
          const nextInput = viewEl.querySelector(notesSearch ? "#notes-search-input" : "#commands-search-input");
          if (nextInput) {
            nextInput.focus();
            nextInput.selectionStart = nextInput.selectionEnd = nextInput.value.length;
          }
        }
      }
    });
  }

  document.querySelector("#confirm-modal").addEventListener("click", async (event) => {
    if (event.target.closest("[data-confirm-cancel]") || event.target === document.querySelector("#confirm-modal")) {
      state.confirmDeleteId = null;
      state.confirmSttEngine = null;
      state.confirmNoteProvider = null;
      paintConfirmModal();
      return;
    }
    if (event.target.closest("[data-confirm-stt-ok]") && state.confirmSttEngine) {
      const nextEngine = state.confirmSttEngine;
      state.confirmSttEngine = null;
      await window.openflow.dispatch("settings.save", { sttEngine: nextEngine, onboardingDone: true });
      if (nextEngine === "parakeet") state.askKey = false;
      await load();
      return;
    }
    if (event.target.closest("[data-confirm-note-ok]") && state.confirmNoteProvider) {
      const next = state.confirmNoteProvider;
      state.confirmNoteProvider = null;
      const settings = (state.desk && state.desk.settings) || {};
      const choice = noteModelChoice(settings);
      if (next === "local") {
        if (!choice.localRow.downloaded) {
          await openLocalDownload(choice.localId);
          paintConfirmModal();
          return;
        }
        await window.openflow.dispatch("settings.save", {
          noteImproveProvider: "local",
          noteImproveLocalModel: choice.localId,
        });
      } else {
        await window.openflow.dispatch("settings.save", {
          noteImproveProvider: "openai",
          noteImproveModel: choice.openaiId,
        });
      }
      await load();
      return;
    }
    if (event.target.closest("[data-confirm-delete]") && state.confirmDeleteId) {
      const deletingId = state.confirmDeleteId;
      state.confirmDeleteId = null;
      if (state.editor && state.editor.id === deletingId) state.editor = null;
      await window.openflow.dispatch("pads.delete", { id: deletingId });
      await load();
      return;
    }
    if (event.target.closest("[data-confirm-delete-command]") && state.confirmDeleteCommandId) {
      const deletingId = state.confirmDeleteCommandId;
      state.confirmDeleteCommandId = null;
      if (state.commandEditor && state.commandEditor.id === deletingId) state.commandEditor = null;
      await window.openflow.dispatch("commands.delete", { id: deletingId });
      await load();
    }
  });

  
  
  const iconModal = document.querySelector("#icon-picker-modal");
  if (iconModal) {
    iconModal.addEventListener("click", async (event) => {
      if (event.target.closest("[data-icon-picker-close]") || event.target === iconModal) {
        state.iconPicker = null;
        paintIconPicker();
        return;
      }
      const choice = event.target.closest("[data-cmd-icon-choice]");
      if (choice && state.iconPicker) {
        const newIcon = choice.dataset.cmdIconChoice;
        const targetCmdId = state.iconPicker.commandId;
        const isEditor = state.iconPicker.isEditor;
        state.iconPicker = null;
        paintIconPicker();
        if (isEditor && state.commandEditor) {
          state.commandEditor.icon = newIcon;
          if (state.commandEditor.id) {
            await window.openflow.dispatch("commands.save", { id: state.commandEditor.id, icon: newIcon });
            await load();
          } else {
            render();
          }
        } else if (targetCmdId) {
          await window.openflow.dispatch("commands.save", { id: targetCmdId, icon: newIcon });
          await load();
        }
      }
    });
  }

  const cmdModal = document.querySelector("#command-modal");
  if (cmdModal) {
    cmdModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-cmd-wizard-cancel]") || event.target === cmdModal) {
        state.commandWizard = null;
        paintCommandWizard();
        return;
      }
      const typeChoose = event.target.closest("[data-cmd-type-choose]");
      if (typeChoose && state.commandWizard) {
        state.commandWizard.type = typeChoose.dataset.cmdTypeChoose;
        state.commandWizard.step = 2;
        paintCommandWizard();
        return;
      }
      if (event.target.closest("[data-cmd-wizard-back]") && state.commandWizard) {
        if (state.commandWizard.step === 3) {
          state.commandWizard.step = 2;
        } else {
          state.commandWizard.step = 1;
          state.commandWizard.error = "";
        }
        paintCommandWizard();
        return;
      }
      if (event.target.closest("[data-cmd-wizard-next]") && state.commandWizard) {
        const input = cmdModal.querySelector("#cmd-name-input");
        const val = input ? input.value : state.commandWizard.name;
        const error = validateCommandName(val, (state.desk && state.desk.commands) || []);
        if (error) {
          state.commandWizard.name = val;
          state.commandWizard.error = error;
          const errEl = cmdModal.querySelector("#cmd-name-error");
          if (errEl) errEl.textContent = error;
          if (input) input.focus();
          return;
        }
        state.commandWizard.name = val.trim();
        state.commandWizard.step = 3;
        state.commandWizard.icon = state.commandWizard.icon || "terminal";
        paintCommandWizard();
        return;
      }
      const wizardIcon = event.target.closest("[data-cmd-wizard-icon]");
      if (wizardIcon && state.commandWizard) {
        state.commandWizard.icon = wizardIcon.dataset.cmdWizardIcon;
        paintCommandWizard();
        return;
      }
      if (event.target.closest("[data-cmd-wizard-finish]") && state.commandWizard) {
        const typeInfo = CMD_TYPE_INFO[state.commandWizard.type] || CMD_TYPE_INFO.powershell;
        state.commandEditor = {
          id: "",
          isNew: true,
          name: state.commandWizard.name,
          type: typeInfo.id,
          extension: typeInfo.extension,
          content: "",
          icon: state.commandWizard.icon || "terminal",
          runAsAdmin: false,
        };
        state.commandWizard = null;
        render();
        return;
      }
    });

    cmdModal.addEventListener("input", (event) => {
      if (event.target && event.target.id === "cmd-name-input" && state.commandWizard) {
        state.commandWizard.name = event.target.value;
        const error = validateCommandName(event.target.value, (state.desk && state.desk.commands) || []);
        state.commandWizard.error = error;
        const errEl = cmdModal.querySelector("#cmd-name-error");
        if (errEl) errEl.textContent = error;
      }
    });

    cmdModal.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target && event.target.id === "cmd-name-input") {
        event.preventDefault();
        const nextBtn = cmdModal.querySelector("[data-cmd-wizard-next]");
        if (nextBtn) nextBtn.click();
      } else if (event.key === "Escape") {
        state.commandWizard = null;
        paintCommandWizard();
      }
    });
  }

  document.querySelector("#editor").addEventListener("click", async (event) => {
    if (event.target.closest("#cmd-editor-back")) {
      state.commandEditor = null;
      render();
      return;
    }
    const adminToggle = event.target.closest("#cmd-editor-admin-toggle, #cmd-admin-toggle-label");
    if (adminToggle && state.commandEditor) {
      state.commandEditor.runAsAdmin = !state.commandEditor.runAsAdmin;
      const toggleBtn = document.querySelector("#cmd-editor-admin-toggle");
      if (toggleBtn) {
        toggleBtn.setAttribute("aria-checked", state.commandEditor.runAsAdmin ? "true" : "false");
      }
      const runBtn = document.querySelector("#cmd-editor-run");
      if (runBtn) {
        const nextTitle = state.commandEditor.runAsAdmin ? "Run with Administrator privileges" : "Run command";
        runBtn.setAttribute("title", nextTitle);
        runBtn.setAttribute("aria-label", nextTitle);
      }
      return;
    }
    const cmdRun = event.target.closest("#cmd-editor-run");
    if (cmdRun && window.openflow && state.commandEditor) {
      cmdRun.disabled = true;
      const originalText = cmdRun.textContent;
      cmdRun.textContent = "Running...";
      // If unsaved or content changed, save first
      const body = document.querySelector("#cmd-editor-body");
      const content = body ? body.value : (state.commandEditor.content || "");
      let cmdId = state.commandEditor.id;
      if (!cmdId) {
        const saved = await window.openflow.dispatch("commands.create", {
          name: state.commandEditor.name,
          type: state.commandEditor.type,
          content,
          runAsAdmin: Boolean(state.commandEditor.runAsAdmin),
          icon: state.commandEditor.icon || "terminal",
        });
        cmdId = saved.id;
        state.commandEditor.id = saved.id;
        state.commandEditor.isNew = false;
      } else {
        await window.openflow.dispatch("commands.save", {
          id: cmdId,
          content,
          runAsAdmin: Boolean(state.commandEditor.runAsAdmin),
          icon: state.commandEditor.icon || "terminal",
        });
      }
      const res = await window.openflow.dispatch("commands.run", { id: cmdId });
      cmdRun.disabled = false;
      if (res && res.ok) {
        cmdRun.textContent = "Started ✓";
        setTimeout(() => { cmdRun.textContent = originalText; }, 1200);
      } else {
        cmdRun.textContent = originalText;
      }
      return;
    }
    const cmdSave = event.target.closest("#cmd-editor-save");
    if (cmdSave && state.commandEditor && window.openflow) {
      cmdSave.disabled = true;
      const body = document.querySelector("#cmd-editor-body");
      const content = body ? body.value : (state.commandEditor.content || "");
      cmdSave.textContent = "Saved";
      cmdSave.classList.add("saved");
      if (state.commandEditor.isNew) {
        await window.openflow.dispatch("commands.create", {
          name: state.commandEditor.name,
          type: state.commandEditor.type,
          content,
          runAsAdmin: Boolean(state.commandEditor.runAsAdmin),
          icon: state.commandEditor.icon || "terminal",
        });
      } else {
        await window.openflow.dispatch("commands.save", {
          id: state.commandEditor.id,
          content,
          runAsAdmin: Boolean(state.commandEditor.runAsAdmin),
          icon: state.commandEditor.icon || "terminal",
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 260));
      state.commandEditor = null;
      await load();
      return;
    }

    if (event.target.closest("#editor-back")) {
      stopEditorVoice();
      const editor = document.querySelector("#editor");
      if (editor && editor._sparkle) editor._sparkle.destroy();
      state.editor = null;
      render();
      return;
    }
    if (event.target.closest("#editor-voice") && window.openflow) {
      if (editorVoice.state === "active") {
        stopEditorVoice();
      } else if (editorVoice.state === "idle") {
        window.openflow.dispatch("voicenote.start", { target: "desk" }).catch(() => {});
      }
      const body = document.querySelector("#editor-body");
      if (body) body.focus();
      return;
    }
    const copyBtn = event.target.closest("#editor-copy");
    if (copyBtn && window.openflow) {
      const body = document.querySelector("#editor-body");
      await window.openflow.dispatch("clipboard.copy", { text: body ? body.value : "" });
      const copyLabel = copyBtn.querySelector("span");
      if (copyLabel) copyLabel.textContent = "Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => {
        if (copyLabel) copyLabel.textContent = "Copy";
        copyBtn.classList.remove("copied");
      }, 1000);
      return;
    }
    const button = event.target.closest("#editor-save");
    if (!button || !state.editor) return;
    button.disabled = true;
    await finishEditorVoice();
    if (!state.editor) return;
    const title = document.querySelector("#editor-title");
    const body = document.querySelector("#editor-body");
    const nextTitle = (title && title.value.trim()) ? title.value.trim() : "Note";
    const nextContent = body ? body.value : state.editor.content;
    button.textContent = "Saved";
    button.classList.add("saved");
    const saved = await window.openflow.dispatch("pads.save", {
      id: state.editor.id || undefined,
      title: nextTitle,
      content: nextContent,
    });
    state.editor = { id: saved.id, isDraft: false, title: nextTitle, content: nextContent };
    await new Promise((resolve) => setTimeout(resolve, 260));
    state.editor = null;
    await load();
  });

  let editorTitleBefore = "";

  document.querySelector("#editor").addEventListener("focusin", (event) => {
    if (event.target && event.target.id === "editor-title") {
      editorTitleBefore = event.target.value;
    }
  });

  document.querySelector("#editor").addEventListener("keydown", async (event) => {
    if (event.target && event.target.id === "editor-title") {
      if (event.key === "Enter") {
        event.preventDefault();
        const val = event.target.value.trim() || editorTitleBefore || "Note";
        event.target.value = val;
        editorTitleBefore = val;
        if (state.editor) {
          state.editor.title = val;
          if (state.editor.id && window.openflow) {
            const body = document.querySelector("#editor-body");
            const nextContent = body ? body.value : (state.editor.content || "");
            await window.openflow.dispatch("pads.save", {
              id: state.editor.id,
              title: val,
              content: nextContent,
            });
            const found = (state.desk.pads || []).find((p) => p.id === state.editor.id);
            if (found) found.title = val;
          }
        }
        event.target.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.target.value = editorTitleBefore;
        if (state.editor) state.editor.title = editorTitleBefore;
        event.target.blur();
      }
    }
  });

  document.querySelector("#editor").addEventListener("focusout", async (event) => {
    if (event.target && event.target.id === "editor-title") {
      const val = event.target.value.trim() || editorTitleBefore || "Note";
      event.target.value = val;
      editorTitleBefore = val;
      if (state.editor) {
        state.editor.title = val;
        if (state.editor.id && window.openflow) {
          const body = document.querySelector("#editor-body");
          const nextContent = body ? body.value : (state.editor.content || "");
          await window.openflow.dispatch("pads.save", {
            id: state.editor.id,
            title: val,
            content: nextContent,
          });
          const found = (state.desk.pads || []).find((p) => p.id === state.editor.id);
          if (found) found.title = val;
        }
      }
    }
  });

  document.querySelector("#editor").addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      const saveBtn = document.querySelector("#editor-save");
      if (saveBtn && !saveBtn.disabled) saveBtn.click();
    }
  });

  document.querySelector("#onboarding").addEventListener("click", async (event) => {
    const choose = event.target.closest("[data-onboard-choose]");
    if (choose) {
      const choice = choose.dataset.onboardChoose;
      if (choice === "parakeet") {
        state.onboardingStep = null;
        state.askKey = false;
        state.view = "dictate";
        await window.openflow.dispatch("settings.save", { sttEngine: "parakeet", onboardingDone: true });
        await load();
      } else {
        state.onboardingStep = "apikey";
        paintOnboarding();
      }
      return;
    }
    const noteOnboard = event.target.closest("[data-note-onboard]");
    if (noteOnboard && window.openflow) {
      const choice = noteOnboard.dataset.noteOnboard;
      if (choice === "later") {
        state.onboardingStep = null;
        state.noteKeyTest = "";
        await window.openflow.dispatch("settings.save", { noteImproveEnabled: false, noteImproveOnboardingDone: true, noteImproveOnboardingRelease: NOTE_IMPROVE_ONBOARDING_RELEASE });
        await load();
        return;
      }
      if (choice === "openai") {
        const hasKey = state.desk && state.desk.settings && state.desk.settings.hasKey;
        if (!hasKey) {
          state.onboardingStep = "note-improve-key";
          paintOnboarding();
          return;
        }
        state.onboardingStep = null;
        await window.openflow.dispatch("settings.save", {
          noteImproveEnabled: true,
          noteImproveProvider: "openai",
          noteImproveModel: "gpt-6-luna",
          noteImproveOnboardingDone: true,
          noteImproveOnboardingRelease: NOTE_IMPROVE_ONBOARDING_RELEASE,
        });
        await load();
        return;
      }
      if (choice === "test") {
        const input = document.querySelector("#note-onboard-key");
        const value = input ? input.value.trim() : "";
        if (value) await window.openflow.dispatch("settings.save", { apiKey: value });
        const result = await window.openflow.dispatch("notes.model.testKey");
        state.noteKeyTest = result && result.message ? result.message : "Key test failed.";
        paintOnboarding();
        return;
      }
      if (choice === "save-key") {
        const input = document.querySelector("#note-onboard-key");
        const value = input ? input.value.trim() : "";
        if (!value && !(state.desk && state.desk.settings && state.desk.settings.hasKey)) {
          if (input) input.focus();
          return;
        }
        state.onboardingStep = null;
        state.noteKeyTest = "";
        const patch = {
          noteImproveEnabled: true,
          noteImproveProvider: "openai",
          noteImproveModel: "gpt-6-luna",
          noteImproveOnboardingDone: true,
          noteImproveOnboardingRelease: NOTE_IMPROVE_ONBOARDING_RELEASE,
        };
        if (value) patch.apiKey = value;
        await window.openflow.dispatch("settings.save", patch);
        await load();
      }
      return;
    }
    if (event.target.closest("[data-onboard-back]")) {
      state.onboardingStep = "choose";
      paintOnboarding();
      return;
    }
    if (event.target.closest("[data-onboard-save-key]")) {
      const input = document.querySelector("#onboard-api-key");
      const val = input ? input.value.trim() : "";
      if (!val) {
        if (input) input.focus();
        return;
      }
      state.onboardingStep = null;
      state.askKey = false;
      state.view = "dictate";
      await window.openflow.dispatch("settings.save", { sttEngine: "openai", apiKey: val, onboardingDone: true });
      await load();
    }
  });

  document.querySelector("#onboarding").addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && event.target.closest("#onboard-api-key")) {
      event.preventDefault();
      const saveBtn = document.querySelector("[data-onboard-save-key]");
      if (saveBtn) saveBtn.click();
    }
  });

  if (!window.openflow) return;
  window.openflow.on("note-voice", onEditorVoice);
  window.openflow.on("note-improve-progress", (payload) => {
    state.noteModelProgress = payload || null;
    const status = document.querySelector("[data-note-local-status]");
    const track = document.querySelector("[data-note-local-track]");
    const bar = document.querySelector("[data-note-local-bar]");
    if (payload && payload.done) {
      if (track) track.hidden = true;
      load().catch(() => {});
      return;
    }
    if (!status || !payload) return;
    if (payload.error) {
      status.textContent = payload.error;
      if (track) track.hidden = true;
      return;
    }
    if (track) track.hidden = false;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(payload.percent) || 0))}%`;
    const received = formatBytes(payload.received);
    const speed = payload.bps ? `${(payload.bps / (1024 * 1024)).toFixed(1)} MB/s` : "";
    status.textContent = `Downloading ${payload.percent || 0}%${received ? ` · ${received}` : ""}${speed ? ` · ${speed}` : ""}`;
  });
  window.openflow.on("desk-refresh", (payload) => {
    load(payload).catch(() => {});
  });
  window.openflow.dispatch("desk.pending").then((pending) => load(pending)).catch(() => {});
});
