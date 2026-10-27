"use strict";

const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, session, shell, Tray } = require("electron");
const { spawn, execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { createStore } = require("../src/store");
const providers = require("../src/providers");
const flow = require("../src/flow");
const audio = require("../src/audio");
const parakeet = require("../src/parakeet");
const commands = require("../src/commands");
const { createNoteSparkle } = require("../src/note-sparkle");
const { createModelLibrary } = require("../src/note-models");
const { createLlamaHost, llamaRuntimeAvailable } = require("../src/llama-host");
const { normalizeOpenAIModel, normalizeLocalModel } = require("../src/note-improve");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("ignore-certificate-errors");

let mainWindow = null;
let overlayWindow = null;
let noteWindow = null;
let noteSessions = [];
let voiceNoteWindow = null;
let noteDownloadWindow = null;
let noteHistoryWindow = null;
let noteHistoryNoteId = "";
let selectLocalWhenReady = false;
let tray = null;
let chord = null;
let store = null;
let noteSparkle = null;
let noteModels = null;
let noteLlama = null;
let quitting = false;
let overlayTimer = null;
let dictating = false;
let dictateSource = "";
let voiceNoteTarget = "note";
let pointerTimer = null;
let pointerNear = false;
let barMenuOpen = false;
let chordStarts = 0;
let targetHwnd = 0;
let notePadId = "";
let hidingBar = false;
let flameshotDaemon = null;
let pendingRefresh = null;
let speechChain = Promise.resolve();
const speechSessions = new Map();
const root = path.join(__dirname, "..");

function decodeChunk(chunk) {
  let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) buffer = buffer.subarray(2);
  if (buffer.length >= 4 && buffer[1] === 0 && buffer[3] === 0) return buffer.toString("utf16le");
  return buffer.toString("utf8");
}

function takeLines(buffer, chunk) {
  const next = buffer + decodeChunk(chunk);
  const lines = next.split(/\r?\n/);
  return { buffer: lines.pop() || "", lines };
}

function sendBar(message) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const deliver = () => {
    if (!overlayWindow.isDestroyed()) overlayWindow.webContents.send("bar-command", message);
  };
  if (overlayWindow.webContents.isLoading()) overlayWindow.webContents.once("did-finish-load", deliver);
  else deliver();
}

function toggleDictate() {
  if (dictating) endDictate();
  else beginDictate();
}

function scriptCopy(name) {
  const target = path.join(app.getPath("userData"), name);
  fs.copyFileSync(path.join(__dirname, name), target);
  return target;
}

function unmuteMic() {
  if (process.platform !== "win32") return;
  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptCopy("unmute.ps1")], {
    windowsHide: true,
    stdio: "ignore",
    cwd: app.getPath("userData"),
  });
}

function runPowershell(args) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: app.getPath("userData"),
    });
    child.on("error", () => resolve(1));
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    child.on("exit", (code) => resolve(code == null ? 1 : code));
  });
}

let microphoneRepair = null;

function ensureMicrophone() {
  if (process.platform !== "win32" || process.env.OPENFLOW_SMOKE === "1") {
    return Promise.resolve({ ok: true, changed: false });
  }
  if (!microphoneRepair) {
    microphoneRepair = repairMicrophone().finally(() => {
      microphoneRepair = null;
    });
  }
  return microphoneRepair;
}

async function repairMicrophone() {
  try {
    const script = scriptCopy("micrepair.ps1");
    const detected = await runPowershell(["-File", script]);
    if (detected === 0) return { ok: true, changed: false };
    if (detected !== 10) return { ok: false, changed: false };
    const launcher = path.join(app.getPath("userData"), "micrepair-run.ps1");
    const quoted = script.replace(/'/g, "''");
    fs.writeFileSync(launcher, [
      "$script = '" + quoted + "'",
      "$arg = \"-NoProfile -ExecutionPolicy Bypass -File `\"$script`\" -Apply\"",
      "$proc = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList $arg",
      "if ($null -eq $proc) { exit 1 }",
      "exit $proc.ExitCode",
      "",
    ].join("\r\n"));
    const applied = await runPowershell(["-File", launcher]);
    return { ok: applied === 0, changed: applied === 0 };
  } catch (_error) {
    return { ok: false, changed: false };
  }
}

function rememberTarget(hwnd) {
  const value = Number(hwnd);
  if (Number.isFinite(value) && value > 0) targetHwnd = value;
}

function beginDictate(hwnd, source) {
  const mode = store && store.getSettings().dictationMode === "toggle" ? "toggle" : "hold";
  const next = source === "symbol" || source === "voicenote" ? source : (mode === "toggle" ? "toggle" : "chord");
  if (dictating) {
    if ((dictateSource === "symbol" || dictateSource === "toggle" || dictateSource === "voicenote") && next !== "symbol" && next !== "voicenote") {
      endDictate();
    }
    return;
  }
  rememberTarget(hwnd);
  dictating = true;
  dictateSource = next;
  unmuteMic();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (!overlayWindow.isVisible()) overlayWindow.showInactive();
    overlayWindow.setOpacity(1);
    overlayWindow.setIgnoreMouseEvents(false);
  }
  sendBar({ type: "start", source: next });
}

function endDictate() {
  if (!dictating) return;
  const source = dictateSource;
  dictating = false;
  dictateSource = "";
  if (source === "symbol" || source === "voicenote") pointerNear = false;
  if (source === "voicenote") sendNoteVoice({ type: "stopped" });
  sendBar({ type: "stop", source });
}

function sendNoteVoice(message) {
  // Voice notes stream either into the floating note pad or into the note editor of the main app.
  const target = voiceNoteTarget === "desk" ? mainWindow : (voiceNoteWindow || primaryNoteWindow());
  if (!target || target.isDestroyed()) return;
  const deliver = () => {
    if (target && !target.isDestroyed()) target.webContents.send("note-voice", message);
  };
  if (target.webContents.isLoading()) target.webContents.once("did-finish-load", deliver);
  else deliver();
}

// Voice note: open a fresh note pad and stream the dictation into it instead of pasting.
// With target "desk" the dictation streams into the note editor of the main app window instead.
function startVoiceNote(target) {
  if (dictating) return false;
  if (target === "desk") {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    voiceNoteTarget = "desk";
  } else {
    voiceNoteTarget = "note";
    let win = primaryNoteWindow();
    if (!win || win.isDestroyed() || !win.isVisible()) win = showNotePad("");
    else win.focus();
    voiceNoteWindow = win;
  }
  sendNoteVoice({ type: "start" });
  beginDictate(0, "voicenote");
  return true;
}

function needsKeyPrompt() {
  if (process.env.OPENFLOW_SMOKE === "1" || !store) return false;
  const settings = store.getSettings();
  return settings.sttEngine === "openai" && !readKey();
}

function needsOnboarding() {
  if (process.env.OPENFLOW_SMOKE === "1" || !store) return false;
  return !store.getSettings().onboardingDone;
}

function syncSttEngine() {
  if (!store || process.env.OPENFLOW_SMOKE === "1") return;
  const settings = store.getSettings();
  if (settings.sttEngine === "openai") {
    parakeet.stopBackground();
  } else {
    parakeet.startBackground(app.getPath("userData")).catch(() => {});
  }
}

function showMain(refresh) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
  const payload = { ...(refresh || {}) };
  if (needsOnboarding()) payload.onboarding = true;
  else if (needsKeyPrompt()) payload.askKey = true;
  pendingRefresh = payload;
  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("desk-refresh", pendingRefresh || {});
  };
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
  else send();
}

function placeBar(width, height) {
  if (hidingBar) return;
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  const safeWidth = Math.max(56, Math.min(640, Math.round(Number(width) || 72)));
  const safeHeight = Math.max(18, Math.min(460, Math.round(Number(height) || 18)));
  const next = {
    x: Math.round(area.x + (area.width - safeWidth) / 2),
    y: Math.round(area.y + area.height - safeHeight - 12),
    width: safeWidth,
    height: safeHeight,
  };
  const current = overlayWindow.getBounds();
  if (current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height) return;
  overlayWindow.setBounds(next);
}

const NOTE_WIDTH = 620;
const NOTE_HEIGHT = 450;

function liveNoteSessions() {
  noteSessions = noteSessions.filter((session) => session.win && !session.win.isDestroyed());
  return noteSessions;
}

function rememberNoteWindow(win) {
  if (win && !win.isDestroyed()) noteWindow = win;
  else {
    const sessions = liveNoteSessions();
    noteWindow = sessions.length ? sessions[sessions.length - 1].win : null;
  }
}

function sessionForWindow(win) {
  if (!win) return null;
  return liveNoteSessions().find((session) => session.win === win) || null;
}

function sessionByPad(id) {
  if (!id) return null;
  return liveNoteSessions().find((session) => session.padId === id) || null;
}

function primaryNoteWindow() {
  const sessions = liveNoteSessions();
  const focused = sessions.find((session) => session.win.isFocused());
  if (focused) return focused.win;
  const visible = [...sessions].reverse().find((session) => session.win.isVisible());
  if (visible) return visible.win;
  return sessions.length ? sessions[sessions.length - 1].win : null;
}

function getNoteBounds() {
  try {
    const display = screen.getPrimaryDisplay();
    const area = display ? display.workArea : { x: 0, y: 0, width: 1920, height: 1080 };
    return {
      x: Math.round(area.x + (area.width - NOTE_WIDTH) / 2),
      y: Math.round(area.y + area.height - NOTE_HEIGHT - 88),
      width: NOTE_WIDTH,
      height: NOTE_HEIGHT,
    };
  } catch (_e) {
    return { x: 100, y: 100, width: NOTE_WIDTH, height: NOTE_HEIGHT };
  }
}

function boundsBeside(anchor) {
  if (!anchor || anchor.isDestroyed()) return getNoteBounds();
  const current = anchor.getBounds();
  const display = screen.getDisplayNearestPoint({ x: current.x, y: current.y });
  const area = display.workArea;
  const gap = 16;
  let x = current.x + current.width + gap;
  let y = current.y;
  if (x + NOTE_WIDTH > area.x + area.width) x = current.x - NOTE_WIDTH - gap;
  if (x < area.x) x = area.x;
  if (y + NOTE_HEIGHT > area.y + area.height) y = area.y + area.height - NOTE_HEIGHT;
  if (y < area.y) y = area.y;
  return { x: Math.round(x), y: Math.round(y), width: NOTE_WIDTH, height: NOTE_HEIGHT };
}

function padPayload(id) {
  let padData = { id: "", title: "Note", content: "" };
  if (id && store) {
    const found = store.listPads().find((row) => row.id === id);
    if (found) padData = { id: found.id, title: found.title || "Note", content: found.content || "" };
  }
  return padData;
}

function deliverNote(session, padData) {
  if (!session || !session.win || session.win.isDestroyed()) return;
  const deliver = () => {
    if (!session.win || session.win.isDestroyed()) return;
    session.win.webContents.send("note-show", padData);
  };
  if (session.win.webContents.isLoading()) session.win.webContents.once("did-finish-load", deliver);
  else deliver();
}

function revealNote(win) {
  if (!win || win.isDestroyed()) return;
  const show = () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.moveTop();
    win.focus();
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", show);
  else show();
}

function senderWindow(event) {
  if (!event || !event.sender) return null;
  try {
    return BrowserWindow.fromWebContents(event.sender);
  } catch (_error) {
    return null;
  }
}

function createNoteSession(bounds, padId) {
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    thickFrame: false,
    title: "Note",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const session = { win, padId: padId || "" };
  noteSessions.push(session);
  rememberNoteWindow(win);
  win.webContents.setBackgroundThrottling(false);
  win.on("focus", () => rememberNoteWindow(win));
  win.on("closed", () => {
    noteSessions = noteSessions.filter((item) => item.win !== win);
    if (voiceNoteWindow === win) voiceNoteWindow = null;
    if (noteWindow === win) rememberNoteWindow(null);
  });
  win.loadFile(path.join(root, "renderer", "note.html"));
  return session;
}

function showNotePad(id) {
  const wanted = id || "";
  if (wanted) {
    const existing = sessionByPad(wanted);
    if (existing) {
      existing.padId = wanted;
      notePadId = wanted;
      rememberNoteWindow(existing.win);
      deliverNote(existing, padPayload(wanted));
      revealNote(existing.win);
      return existing.win;
    }
  } else {
    const visible = primaryNoteWindow();
    if (visible && visible.isVisible()) {
      rememberNoteWindow(visible);
      revealNote(visible);
      return visible;
    }
  }
  const anchor = wanted ? primaryNoteWindow() : null;
  const bounds = anchor ? boundsBeside(anchor) : getNoteBounds();
  const session = createNoteSession(bounds, wanted);
  notePadId = wanted;
  deliverNote(session, padPayload(wanted));
  revealNote(session.win);
  return session.win;
}

function openFreshNote(anchor) {
  const base = anchor && !anchor.isDestroyed() ? anchor : primaryNoteWindow();
  const bounds = base ? boundsBeside(base) : getNoteBounds();
  const session = createNoteSession(bounds, "");
  notePadId = "";
  deliverNote(session, padPayload(""));
  revealNote(session.win);
  return { id: "", isDraft: true, title: "Note", content: "" };
}

function historyRows(id) {
  return ensureNoteSparkle().versions(id)
    .filter((row) => row.kind === "improve")
    .map((row) => ({
      id: row.id,
      label: row.label,
      created_at: row.created_at,
      content: row.content,
      diff: row.diff,
    }));
}

function placeNoteHistory(anchor) {
  const pad = 14;
  const gap = 12;
  const point = { x: Math.round(Number(anchor.x) || 0), y: Math.round(Number(anchor.y) || 0) };
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  const cardWidth = Math.max(300, Math.min(380, Math.round((Number(anchor.width) || 480) * 0.72)));
  const cardHeight = Math.max(320, Math.round(Number(anchor.height) || 520));
  let width = cardWidth + pad * 2;
  let height = cardHeight + pad * 2;
  let x = Math.round(point.x + (Number(anchor.width) || 0) + gap - pad);
  let y = Math.round(point.y - pad);
  if (height > area.height) {
    height = area.height;
    y = area.y;
  }
  if (y < area.y) y = area.y;
  if (y + height > area.y + area.height) y = area.y + area.height - height;
  if (x + width > area.x + area.width - 8) x = area.x + area.width - width - 8;
  if (x < area.x + 8) x = area.x + 8;
  return { x, y, width, height };
}

function deliverHistory(id) {
  if (!noteHistoryWindow || noteHistoryWindow.isDestroyed()) return;
  const payload = { id, rows: historyRows(id) };
  const send = () => {
    if (!noteHistoryWindow || noteHistoryWindow.isDestroyed()) return;
    noteHistoryWindow.webContents.send("note-history", payload);
  };
  if (noteHistoryWindow.webContents.isLoading()) noteHistoryWindow.webContents.once("did-finish-load", send);
  else send();
}

function closeNoteHistory() {
  noteHistoryNoteId = "";
  if (noteHistoryWindow && !noteHistoryWindow.isDestroyed()) noteHistoryWindow.close();
  noteHistoryWindow = null;
  return { open: false };
}

function openNoteHistory(payload) {
  const id = String((payload && payload.id) || "");
  if (!id) return { open: false };
  if (noteHistoryWindow && !noteHistoryWindow.isDestroyed() && noteHistoryWindow.isVisible() && noteHistoryNoteId === id) {
    return closeNoteHistory();
  }
  const bounds = placeNoteHistory((payload && payload.anchor) || {});
  if (!noteHistoryWindow || noteHistoryWindow.isDestroyed()) {
    noteHistoryWindow = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      thickFrame: false,
      title: "History",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    noteHistoryWindow.on("closed", () => {
      noteHistoryWindow = null;
      noteHistoryNoteId = "";
    });
    noteHistoryWindow.loadFile(path.join(root, "renderer", "note-history.html"));
  } else {
    noteHistoryWindow.setBounds(bounds);
  }
  noteHistoryNoteId = id;
  deliverHistory(id);
  const win = noteHistoryWindow;
  const reveal = () => {
    if (!win || win.isDestroyed()) return;
    win.show();
    win.moveTop();
    win.focus();
  };
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", reveal);
  else reveal();
  return { open: true };
}

async function runModelInstallerIfNeeded() {
  const userData = app.getPath("userData");
  if (process.env.OPENFLOW_SMOKE === "1" || parakeet.isModelInstalled(userData)) {
    return;
  }
  const win = new BrowserWindow({
    width: 480,
    height: 230,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    center: true,
    show: false,
    title: "Installing open-source STT model",
    icon: path.join(root, "build", "icon.png"),
    backgroundColor: "#faf9f7",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(root, "renderer", "model-install.html"));
  if (!win.isDestroyed()) {
    win.show();
    win.focus();
  }
  try {
    await parakeet.ensureModelFiles(userData, (progress) => {
      if (!win.isDestroyed()) {
        win.webContents.send("model-install-progress", progress);
      }
    });
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send("model-install-progress", {
        error: error instanceof Error ? error.message : String(error),
      });
      await delay(1800);
    }
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

function pipeName() {
  return `OpenFlowPaste-${process.pid}`;
}

function syncChordShortcut(shortcut) {
  if (process.platform !== "win32" || process.env.OPENFLOW_SMOKE === "1") return;
  const socket = net.connect(`\\\\.\\pipe\\${pipeName()}`);
  const timer = setTimeout(() => socket.destroy(), 1500);
  socket.on("connect", () => {
    socket.write(`chord ${shortcut || "ctrl+win"}\n`);
  });
  socket.on("data", () => {
    clearTimeout(timer);
    socket.destroy();
  });
  socket.on("error", () => {
    clearTimeout(timer);
    socket.destroy();
  });
}

function startChord() {
  if (process.platform !== "win32" || process.env.OPENFLOW_SMOKE === "1" || chordStarts >= 3) return;
  chordStarts += 1;
  const initialChord = store ? (store.getSettings().dictationShortcut || "ctrl+win") : "ctrl+win";
  chord = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptCopy("chord.ps1")], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: app.getPath("userData"),
    env: Object.assign({}, process.env, {
      OPENFLOW_PIPE: pipeName(),
      OPENFLOW_CHORD: initialChord,
      OPENFLOW_PARENT_PID: String(process.pid),
      OPENFLOW_LOG: path.join(app.getPath("userData"), "paste.log"),
    }),
  });
  let buffer = "";
  chord.stderr.on("data", () => {});
  chord.stdout.on("data", (chunk) => {
    const parsed = takeLines(buffer, chunk);
    buffer = parsed.buffer;
    for (const line of parsed.lines) {
      const text = line.trim();
      if (text.startsWith("focus ")) {
        if (!dictating) rememberTarget(text.slice(6));
      } else if (text.startsWith("dictate-down")) {
        beginDictate(text.slice("dictate-down".length), "chord");
      } else if (text === "dictate-up") {
        if (dictateSource === "chord") endDictate();
      }
    }
  });
  chord.on("exit", (code) => {
    chord = null;
    if (!quitting && code) setTimeout(startChord, 600);
  });
}

function watchPointer() {
  if (pointerTimer) clearInterval(pointerTimer);
  pointerTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || dictating) return;
    const settings = store ? store.getSettings() : {};
    if (settings.floatingBubble === "hidden") {
      if (pointerNear) {
        pointerNear = false;
        sendBar({ type: "far" });
      }
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getPrimaryDisplay().workArea;
    const center = area.x + area.width / 2;
    const bottom = area.y + area.height;
    const reachX = pointerNear ? (barMenuOpen ? 156 : 140) : 44;
    const reachY = pointerNear ? (barMenuOpen ? 330 : 58) : 36;
    const hit = Math.abs(cursor.x - center) <= reachX && bottom - cursor.y <= reachY && bottom - cursor.y >= -18;
    if (hit === pointerNear) return;
    pointerNear = hit;
    if (!hit) barMenuOpen = false;
    sendBar({ type: hit ? "near" : "far" });
  }, 50);
}

function stopChord() {
  if (chord && !chord.killed) chord.kill();
  chord = null;
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(root, "renderer", "tray.png")).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("OpenFlow");
  const menu = Menu.buildFromTemplate([
    { label: "Listen", click: () => toggleDictate() },
    { label: "New Note", click: () => openFreshNote() },
    { label: "Open Window", click: () => showMain() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.on("click", () => showMain());
  tray.on("double-click", () => showMain());
  tray.on("right-click", () => tray.popUpContextMenu(menu));
}

function keyPath() {
  return path.join(app.getPath("userData"), "api-key.bin");
}

function readKey() {
  const file = keyPath();
  if (!fs.existsSync(file)) return "";
  try {
    const payload = fs.readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(payload);
    return payload.toString("utf8");
  } catch (_error) {
    return "";
  }
}

function writeKey(value) {
  const file = keyPath();
  const text = String(value || "");
  if (!text) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(text)
    : Buffer.from(text, "utf8");
  fs.writeFileSync(file, payload);
}

const baseBubbleElements = ["voice", "note", "tune", "shot"];

function commandsDir() {
  return path.join(app.getPath("userData"), "commands");
}

// Built-in elements plus one "cmd:<id>" element per stored command.
function validBubbleIds() {
  return [...baseBubbleElements, ...(store ? store.listCommands().map((row) => `cmd:${row.id}`) : [])];
}

function ensureCommandsScripts() {
  if (!store) return;
  const dir = commandsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const cmd of store.listCommands()) {
      const p = commands.scriptPath(dir, cmd);
      if (!fs.existsSync(p)) {
        commands.writeScript(dir, cmd);
      }
    }
  } catch {}
}

function ensureNoteModels() {
  if (!noteModels) noteModels = createModelLibrary({ dir: path.join(app.getPath("userData"), "note-models") });
  return noteModels;
}

function ensureNoteLlama() {
  if (!noteLlama) noteLlama = createLlamaHost({ workerPath: path.join(root, "src", "llama-worker.js") });
  return noteLlama;
}

function sendImproveProgress(payload) {
  const targets = [mainWindow, noteDownloadWindow, ...liveNoteSessions().map((session) => session.win)];
  const seen = new Set();
  for (const win of targets) {
    if (!win || win.isDestroyed() || seen.has(win)) continue;
    seen.add(win);
    win.webContents.send("note-improve-progress", payload);
  }
}

function refreshDesk() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desk-refresh", {});
}

function selectDownloadedLocalModel(id) {
  if (!store || !selectLocalWhenReady) return;
  store.updateSettings({
    noteImproveProvider: "local",
    noteImproveLocalModel: normalizeLocalModel(id),
  });
  selectLocalWhenReady = false;
  refreshDesk();
}

function showNoteDownloadWindow(id) {
  const deliver = () => {
    const row = ensureNoteModels().status(id);
    if (!row) return;
    if (row.progress) sendImproveProgress(row.progress);
    else if (row.downloaded) {
      sendImproveProgress({
        id,
        percent: 100,
        received: row.size,
        total: row.size || row.approxBytes,
        bps: 0,
        done: true,
      });
    }
  };
  if (noteDownloadWindow && !noteDownloadWindow.isDestroyed()) {
    if (noteDownloadWindow.isMinimized()) noteDownloadWindow.restore();
    noteDownloadWindow.show();
    noteDownloadWindow.focus();
    deliver();
    return;
  }
  noteDownloadWindow = new BrowserWindow({
    width: 480,
    height: 280,
    resizable: false,
    minimizable: true,
    maximizable: false,
    closable: true,
    center: true,
    show: false,
    title: "Downloading local note model",
    icon: path.join(root, "build", "icon.png"),
    backgroundColor: "#faf9f7",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  noteDownloadWindow.on("closed", () => {
    noteDownloadWindow = null;
  });
  noteDownloadWindow.webContents.setBackgroundThrottling(false);
  noteDownloadWindow.webContents.once("did-finish-load", deliver);
  noteDownloadWindow.loadFile(path.join(root, "renderer", "note-model-download.html"), { query: { id } });
  noteDownloadWindow.once("ready-to-show", () => {
    if (!noteDownloadWindow || noteDownloadWindow.isDestroyed()) return;
    noteDownloadWindow.show();
    noteDownloadWindow.focus();
  });
}

function beginNoteModelDownload(id, selectWhenReady) {
  const modelId = normalizeLocalModel(id || "qwen2.5-3b-instruct-q4");
  selectLocalWhenReady = Boolean(selectWhenReady);
  const row = ensureNoteModels().status(modelId);
  showNoteDownloadWindow(modelId);
  if (row && row.downloaded) {
    selectDownloadedLocalModel(modelId);
    sendImproveProgress({
      id: modelId,
      percent: 100,
      received: row.size,
      total: row.size || row.approxBytes,
      bps: 0,
      done: true,
    });
    return ensureNoteModels().statusList();
  }
  if (row && row.progress && !row.progress.done && !row.progress.error) {
    sendImproveProgress(row.progress);
    return ensureNoteModels().statusList();
  }
  ensureNoteModels().download(modelId, {
    onProgress: (progress) => sendImproveProgress(progress),
  }).then((saved) => {
    if (!saved || !saved.downloaded) return;
    selectDownloadedLocalModel(modelId);
    sendImproveProgress({
      id: modelId,
      percent: 100,
      received: saved.size || saved.received,
      total: saved.size || saved.approxBytes,
      bps: 0,
      done: true,
    });
  }).catch((error) => {
    selectLocalWhenReady = false;
    const aborted = error && error.name === "AbortError";
    sendImproveProgress({
      id: modelId,
      error: aborted ? "Download cancelled." : "Download failed.",
    });
  });
  return ensureNoteModels().statusList();
}

function ensureNoteSparkle() {
  if (!noteSparkle) {
    noteSparkle = createNoteSparkle({
      store,
      readKey,
      fetchImpl: fetch,
      modelLibrary: ensureNoteModels(),
      llamaRuntimeAvailable,
      completeLocal: (payload) => ensureNoteLlama().complete(payload),
    });
  }
  return noteSparkle;
}

function publicSettings() {
  try { ensureNoteModels(); } catch (_error) { /* userData is ready with the app */ }
  const settings = store.getSettings();
  const preset = providers.defaultsFor(settings.provider);
  const sttEngine = settings.sttEngine === "openai" ? "openai" : "parakeet";
  const validShortcuts = ["ctrl+win", "ctrl+space", "ctrl+alt", "ctrl+shift"];
  const dictationShortcut = validShortcuts.includes(settings.dictationShortcut) ? settings.dictationShortcut : "ctrl+win";
  const dictationMode = settings.dictationMode === "toggle" ? "toggle" : "hold";
  const validFloatingBubble = ["active", "dimmed", "hidden"];
  const floatingBubble = validFloatingBubble.includes(settings.floatingBubble) ? settings.floatingBubble : "active";
  const defaultElements = baseBubbleElements;
  const validIds = validBubbleIds();
  const bubbleElements = Array.isArray(settings.bubbleElements)
    ? settings.bubbleElements.filter((id) => validIds.includes(id))
    : defaultElements;
  return {
    ...settings,
    sttEngine,
    dictationShortcut,
    dictationMode,
    floatingBubble,
    bubbleElements: bubbleElements.length ? bubbleElements : defaultElements,
    voiceNoteButton: settings.voiceNoteButton !== false,
    onboardingDone: Boolean(settings.onboardingDone),
    hasKey: Boolean(readKey()),
    noteModels: noteModels ? noteModels.statusList() : [],
    noteDisk: noteModels ? noteModels.disk() : { freeBytes: null },
    llamaRuntime: llamaRuntimeAvailable(),
    llamaState: noteLlama ? noteLlama.getStatus() : "idle",
    parakeet: parakeet.getStatus(app.getPath("userData")),
    effective: {
      sttModel: settings.sttModel || preset.sttModel,
      ttsModel: settings.ttsModel || preset.ttsModel,
      ttsVoice: settings.ttsVoice || preset.ttsVoice,
      textModel: settings.textModel || preset.textModel,
      voices: preset.voices,
    },
  };
}

function applyFloatingBubbleState() {
  if (!store || !overlayWindow || overlayWindow.isDestroyed()) return;
  const settings = store.getSettings();
  const mode = settings.floatingBubble || "active";
  const validIds = validBubbleIds();
  const filtered = Array.isArray(settings.bubbleElements) ? settings.bubbleElements.filter((id) => validIds.includes(id)) : [];
  const elements = filtered.length ? filtered : baseBubbleElements;
  overlayWindow.setOpacity(1);
  if (mode === "hidden" && !dictating) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    overlayWindow.setIgnoreMouseEvents(false);
  }
  if (!overlayWindow.isVisible()) overlayWindow.showInactive();
  sendBar({
    type: "config",
    floatingBubble: mode,
    bubbleElements: elements,
    voiceNoteButton: settings.voiceNoteButton !== false,
    commands: store.listCommands().map((row) => ({ id: row.id, name: row.name, type: row.type, icon: row.icon })),
  });
}

function sendOverlay(state) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  clearTimeout(overlayTimer);
  const mode = !state || !state.mode || state.mode === "hidden" ? "idle" : state.mode;
  const next = { ...state, mode, sounds: true };
  if (!overlayWindow.isVisible()) overlayWindow.showInactive();
  const deliver = () => {
    if (!overlayWindow.isDestroyed()) overlayWindow.webContents.send("overlay-state", next);
  };
  if (overlayWindow.webContents.isLoading()) overlayWindow.webContents.once("did-finish-load", deliver);
  else deliver();
  if (mode === "result" || mode === "error") {
    overlayTimer = setTimeout(() => sendOverlay({ mode: "idle" }), 1400);
  }
}

function library() {
  return {
    corrections: store.listCorrections(),
    dictionary: store.listDictionary(),
    automations: store.listAutomations(),
  };
}

async function completeChat(requestFactory) {
  const request = requestFactory({
    provider: "openai",
    apiKey: readKey(),
  });
  const body = await providers.postJson(fetch, request);
  return providers.parseChatText(body);
}

const polishStyles = {
  concise: "more concise, same meaning",
  clarity: "clear written language, remove filler words",
  reorder: "same statements in a more readable order",
  structure: "same meaning, structured with paragraphs or lists where helpful",
  tone: "same meaning and tone, cleanly written",
};

async function applyTransform(text, kind) {
  if (kind === "prompt") {
    return completeChat((base) => providers.instructRequest({
      ...base,
      prompt: "Turn the spoken input into a clear prompt. Organize intent, context, and desired outcome. Return only the prompt.",
      context: text,
    }));
  }
  const style = polishStyles[store.getSettings().polishStyle] || polishStyles.clarity;
  return completeChat((base) => providers.rewriteRequest({
    ...base,
    text,
    style,
  }));
}

async function translateText(text, targetLanguage) {
  const output = await completeChat((base) => providers.translationRequest({
    ...base,
    text,
    targetLanguage: targetLanguage || store.getSettings().targetLanguage,
  }));
  store.addTranslation({ source_text: text, output_text: output, target_language: targetLanguage || store.getSettings().targetLanguage });
  return output;
}

let pasteChain = Promise.resolve();

function waitUntilListeningStops() {
  if (!dictating) return Promise.resolve();
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!dictating || Date.now() - started > 120000) {
        clearInterval(timer);
        resolve();
      }
    }, 40);
  });
}

function pasteLog(line) {
  try {
    const file = path.join(app.getPath("userData"), "paste.log");
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch (error) {
    console.error(error);
  }
}

function pasteWithScript(text) {
  return new Promise((resolve) => {
    pasteLog(`fallback hwnd=${targetHwnd || 0} chars=${String(text).length}`);
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptCopy("paste.ps1"),
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: app.getPath("userData"),
      env: Object.assign({}, process.env, {
        OPENFLOW_PASTE_HWND: String(targetHwnd || 0),
        OPENFLOW_PASTE_B64: Buffer.from(String(text), "utf8").toString("base64"),
        OPENFLOW_LOG: path.join(app.getPath("userData"), "paste.log"),
      }),
    });
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve("error");
    }, 8000);
    child.stdout.on("data", (chunk) => {
      buffer += decodeChunk(chunk);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("error");
    });
    child.on("exit", () => {
      clearTimeout(timer);
      const line = buffer.trim();
      if (line === "ok") resolve("ok");
      else if (line === "miss") resolve("miss");
      else resolve("error");
    });
  });
}

function askPipeOnce(text) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const socket = net.connect(`\\\\.\\pipe\\${pipeName()}`);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish("error"), 8000);
    socket.on("connect", () => {
      const payload = Buffer.from(String(text), "utf8").toString("base64");
      socket.write(`paste ${targetHwnd || 0} ${payload}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += decodeChunk(chunk);
      const line = buffer.trim();
      if (line.startsWith("ok")) finish("ok");
      else if (line.startsWith("miss")) finish("miss");
    });
    socket.on("error", () => finish("error"));
    socket.on("end", () => {
      const line = buffer.trim();
      if (line.startsWith("ok")) finish("ok");
      else if (line.startsWith("miss")) finish("miss");
      else finish("error");
    });
  });
}

function saveTranscriptNote(text) {
  const body = String(text || "").trim();
  const created = store.savePad({ title: "Note", content: body });
  store.addNotification({ title: "Note", body: "No text field focused — saved as note" });
  showNotePad(created.id);
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.webContents.send("desk-refresh", {});
  }
  return created;
}

function pasteText(text) {
  const value = String(text || "");
  if (!value.trim()) return Promise.resolve();
  const typed = /\s$/.test(value) ? value : `${value} `;
  const run = pasteChain.then(async () => {
    await waitUntilListeningStops();
    clipboard.writeText(typed);
    if (process.platform !== "win32") return;
    let outcome = "error";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      outcome = await askPipeOnce(typed);
      pasteLog(`pipe hwnd=${targetHwnd || 0} attempt=${attempt} ${outcome}`);
      if (outcome !== "error") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (outcome === "error") outcome = await pasteWithScript(typed);
    pasteLog(`result ${outcome}`);
    if (outcome !== "ok") saveTranscriptNote(value);
  });
  pasteChain = run.then(() => {}, () => {});
  return run;
}

function audioBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && Array.isArray(value.data)) return Buffer.from(value.data);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("Recording is unreadable.");
}

function enqueueSpeech(work) {
  const run = speechChain.then(work, work);
  speechChain = run.then(() => {}, () => {});
  return run;
}

function openSpeechSession(payload) {
  const token = crypto.randomUUID();
  const now = Date.now();
  for (const [key, session] of speechSessions) {
    if (now - session.created > 6 * 60 * 60 * 1000) speechSessions.delete(key);
  }
  const sttEngine = store && store.getSettings().sttEngine === "openai" ? "openai" : "parakeet";
  speechSessions.set(token, {
    created: now,
    sttEngine,
    texts: [],
    language: "",
    pending: Promise.resolve(),
    failed: null,
    voice: Boolean(payload && payload.voice),
  });
  return { token };
}

function liveVoiceText(raw) {
  let text = String(raw || "").trim();
  try {
    text = flow.prepareTranscript(text, library()).text || text;
  } catch (_error) {}
  if (text) sendNoteVoice({ type: "text", text });
}

async function commitTranscript(raw, prepared, meta) {
  store.touchDictionary(prepared.usedPhrases, "used");
  let text = prepared.text;
  const sttEngine = (meta && meta.sttEngine) || (store && store.getSettings().sttEngine === "openai" ? "openai" : "parakeet");
  const history = store.addHistory({
    asr_text: raw,
    formatted_text: text,
    stt_engine: sttEngine,
    language: meta.language || "",
    app_name: meta.appName || "",
    url: meta.url || "",
    duration_ms: meta.durationMs || 0,
    word_count: flow.wordCount(text),
    status: "done",
  });
  for (const follow of prepared.followUps) {
    if (follow.type === "translate") {
      text = await translateText(text, follow.language);
      store.updateHistory(history.id, { formatted_text: text, word_count: flow.wordCount(text) });
    }
  }
  store.addNotification({ title: "Dictation saved", body: text.slice(0, 180) });
  if (meta.paste) await pasteText(text);
  return { raw, text, history, prepared };
}

function registerHotkey() {
  return true;
}

function createWindows() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 540,
    minWidth: 680,
    minHeight: 440,
    show: false,
    title: "OpenFlow",
    icon: path.join(root, "build", "icon.png"),
    backgroundColor: "#faf9f7",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.loadFile(path.join(root, "renderer", "index.html"));
  mainWindow.on("close", (event) => {
    if (quitting || process.env.OPENFLOW_SMOKE === "1") return;
    event.preventDefault();
    closeNoteHistory();
    mainWindow.hide();
  });
  mainWindow.on("hide", () => closeNoteHistory());
  mainWindow.on("show", () => {
    if (process.env.OPENFLOW_SMOKE === "1") return;
    if (needsOnboarding()) {
      pendingRefresh = { ...(pendingRefresh || {}), onboarding: true };
    } else if (needsKeyPrompt()) {
      pendingRefresh = { ...(pendingRefresh || {}), askKey: true };
    } else {
      return;
    }
    const send = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("desk-refresh", pendingRefresh || {});
    };
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
    else send();
  });
  mainWindow.once("ready-to-show", () => {
    const smoke = process.env.OPENFLOW_SMOKE === "1";
    const openOnStart = smoke || needsOnboarding() || needsKeyPrompt() || process.argv.includes("--installed");
    if (openOnStart) mainWindow.show();
    if (!smoke && openOnStart) {
      showMain({
        onboarding: needsOnboarding(),
        askKey: !needsOnboarding() && needsKeyPrompt(),
      });
    }
  });
  if (process.env.OPENFLOW_SMOKE === "1") {
    const required = ["Dictation", "Notes", "Usage", "Settings"];
    mainWindow.webContents.on("did-fail-load", () => app.exit(1));
    mainWindow.webContents.on("did-finish-load", async () => {
      try {
        const text = await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => {
          const start = Date.now();
          const timer = setInterval(() => {
            const nav = document.querySelector("#nav");
            const value = nav ? nav.textContent : "";
            if (value.includes("Dictation") && value.includes("Settings")) {
              clearInterval(timer);
              resolve(value);
            } else if (Date.now() - start > 5000) {
              clearInterval(timer);
              resolve(value);
            }
          }, 50);
        })`);
        const missing = required.filter((label) => !String(text).includes(label));
        if (missing.length) {
          console.error(`SMOKE_MISSING ${missing.join(",")}`);
          app.exit(2);
          return;
        }
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  }

  overlayWindow = new BrowserWindow({
    width: 72,
    height: 18,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlayWindow.webContents.setBackgroundThrottling(false);
  overlayWindow.loadFile(path.join(root, "renderer", "overlay.html"));
  overlayWindow.once("ready-to-show", () => {
    placeBar(72, 18);
    applyFloatingBubbleState();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function restoreBar() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setOpacity(1);
  if (!overlayWindow.isVisible()) overlayWindow.showInactive();
  const isHidden = (store && store.getSettings().floatingBubble) === "hidden";
  if (isHidden && !dictating) overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  else overlayWindow.setIgnoreMouseEvents(false);
}

function writeIniPairs(file, pairs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { text = ""; }
  const lines = text.split(/\r?\n/);
  let general = lines.findIndex((line) => line.trim().toLowerCase() === "[general]");
  if (general < 0) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push("[General]");
    general = lines.length - 1;
  }
  const wanted = new Map(Object.entries(pairs).map(([key, value]) => [key.toLowerCase(), [key, value]]));
  let sectionEnd = lines.length;
  for (let index = general + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
    const match = /^\s*([A-Za-z0-9_]+)\s*=/.exec(lines[index]);
    if (!match) continue;
    const found = wanted.get(match[1].toLowerCase());
    if (!found) continue;
    lines[index] = `${found[0]}=${found[1]}`;
    wanted.delete(match[1].toLowerCase());
  }
  const insert = [];
  for (const [, pair] of wanted) insert.push(`${pair[0]}=${pair[1]}`);
  lines.splice(general + 1, 0, ...insert);
  fs.writeFileSync(file, `${lines.join("\r\n").replace(/\s+$/, "")}\r\n`);
}

function flameshotTheme() {
  return {
    uiColor: "#000000",
    contrastUiColor: "#ffffff",
    drawColor: "#000000",
    userColors: "#000000, #ffffff, #4d4d4d, #b3b3b3, #808080",
    showHelp: "false",
    showStartupLaunchMessage: "false",
    disabledTrayIcon: "true",
    checkForUpdates: "false",
    startupLaunch: "false",
    autoCloseIdleDaemon: "false",
    saveAfterCopy: "false",
    copyPathAfterSave: "false",
    useJpgForClipboard: "false",
  };
}

function writeFlameshotTheme(exe) {
  const files = [path.join(path.dirname(exe), "flameshot.ini")];
  if (process.env.APPDATA) files.push(path.join(process.env.APPDATA, "flameshot", "flameshot.ini"));
  for (const file of files) {
    try { writeIniPairs(file, flameshotTheme()); } catch { /* the other location can still apply */ }
  }
}

function flameshotAlive() {
  return Boolean(flameshotDaemon && flameshotDaemon.exitCode == null && !flameshotDaemon.killed);
}

function stopBundledFlameshot(exe) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, 4000);
    execFile("powershell.exe", [
      "-NoProfile",
      "-Command",
      "$want = [IO.Path]::GetFullPath($env:OF_FLAMESHOT); Get-CimInstance Win32_Process -Filter \"Name = 'flameshot.exe'\" | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $want) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ], {
      windowsHide: true,
      env: { ...process.env, OF_FLAMESHOT: exe },
    }, () => {
      clearTimeout(timer);
      finish();
    });
  });
}

async function ensureFlameshot(exe) {
  writeFlameshotTheme(exe);
  if (flameshotAlive()) return;
  await stopBundledFlameshot(exe);
  flameshotDaemon = spawn(exe, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    cwd: path.dirname(exe),
  });
  flameshotDaemon.on("error", () => {});
  flameshotDaemon.unref();
  await delay(700);
}

function flameshotExe() {
  const roots = [
    path.join(process.resourcesPath, "flameshot"),
    path.join(root, "vendor", "flameshot", "flameshot-14.0.0-win64"),
  ];
  for (const base of roots) {
    const exe = path.join(base, "bin", "flameshot.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return "";
}

async function openFlameshot() {
  const exe = flameshotExe();
  if (!exe) {
    store.addNotification({ title: "Screenshot", body: "Flameshot missing" });
    return false;
  }
  await ensureFlameshot(exe);
  hidingBar = true;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  await delay(160);
  const child = spawn(exe, ["gui"], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    cwd: path.dirname(exe),
  });
  child.unref();
  await delay(800);
  hidingBar = false;
  restoreBar();
  return true;
}

function refreshMain() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.webContents.send("desk-refresh", {});
  }
}

function reportCommandFailure(result) {
  store.addNotification({ title: "Command", body: result.error });
  sendOverlay({ mode: "error" });
  dialog.showMessageBox({
    type: result.code === "denied" ? "warning" : "error",
    title: "OpenFlow Commands",
    message: result.code === "denied" ? "Administrator permission declined" : "Command could not be run",
    detail: result.error,
    buttons: ["OK"],
  }).catch(() => {});
}

const actions = {
  "mic.repair": () => ensureMicrophone(),
  "settings.get": () => publicSettings(),
  "settings.save": (payload) => {
    if (payload && Object.prototype.hasOwnProperty.call(payload, "apiKey")) writeKey(payload.apiKey);
    const patch = { provider: "openai", sttModel: "", ttsModel: "", ttsVoice: "", textModel: "" };
    if (payload && (payload.sttEngine === "parakeet" || payload.sttEngine === "openai")) {
      patch.sttEngine = payload.sttEngine;
    }
    const validShortcuts = ["ctrl+win", "ctrl+space", "ctrl+alt", "ctrl+shift"];
    if (payload && validShortcuts.includes(payload.dictationShortcut)) {
      patch.dictationShortcut = payload.dictationShortcut;
    }
    if (payload && (payload.dictationMode === "hold" || payload.dictationMode === "toggle")) {
      patch.dictationMode = payload.dictationMode;
    }
    const validFloatingBubble = ["active", "dimmed", "hidden"];
    if (payload && validFloatingBubble.includes(payload.floatingBubble)) {
      patch.floatingBubble = payload.floatingBubble;
    }
    if (payload && Array.isArray(payload.bubbleElements)) {
      const validIds = validBubbleIds();
      const filtered = payload.bubbleElements.filter((id, index, list) => validIds.includes(id) && list.indexOf(id) === index);
      if (filtered.length) patch.bubbleElements = filtered;
    }
    if (payload && typeof payload.voiceNoteButton === "boolean") {
      patch.voiceNoteButton = payload.voiceNoteButton;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "onboardingDone")) {
      patch.onboardingDone = Boolean(payload.onboardingDone);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "noteImproveEnabled")) {
      patch.noteImproveEnabled = Boolean(payload.noteImproveEnabled) && Boolean(readKey());
    }
    if (payload && (payload.noteImproveProvider === "openai" || payload.noteImproveProvider === "local")) {
      patch.noteImproveProvider = "openai";
      selectLocalWhenReady = false;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "noteImproveModel")) {
      patch.noteImproveModel = normalizeOpenAIModel(payload.noteImproveModel);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "noteImproveLocalModel")) {
      patch.noteImproveLocalModel = normalizeLocalModel(payload.noteImproveLocalModel);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "noteImproveAutoSuggestions")) {
      patch.noteImproveAutoSuggestions = Boolean(payload.noteImproveAutoSuggestions);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "noteImproveOnboardingDone")) {
      patch.noteImproveOnboardingDone = Boolean(payload.noteImproveOnboardingDone);
    }
    if (payload && payload.noteImproveOnboardingRelease === "1.5.6") {
      patch.noteImproveOnboardingRelease = "1.5.6";
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "noteImprovePrivacyAck")) {
      patch.noteImprovePrivacyAck = Boolean(payload.noteImprovePrivacyAck);
    }
    store.updateSettings(patch);
    if (patch.dictationShortcut) syncChordShortcut(patch.dictationShortcut);
    syncSttEngine();
    applyFloatingBubbleState();
    return { settings: publicSettings(), hotkeyRegistered: true };
  },
  "transform.set": (payload) => {
    const kind = payload.transform === "prompt" ? "prompt" : "polish";
    const polishStyle = Object.prototype.hasOwnProperty.call(polishStyles, payload.polishStyle)
      ? payload.polishStyle
      : store.getSettings().polishStyle;
    store.updateSettings({
      transform: kind,
      transformAuto: Boolean(payload.transformAuto),
      polishStyle,
    });
    return publicSettings();
  },
  "dictate.toggle": (payload) => {
    if (dictating) endDictate();
    else beginDictate(targetHwnd, payload && payload.source === "symbol" ? "symbol" : "chord");
    return true;
  },
  "bar.mode": (payload) => {
    if (payload && Object.prototype.hasOwnProperty.call(payload, "menuOpen")) {
      barMenuOpen = Boolean(payload.menuOpen);
    }
    if (hidingBar) return true;
    placeBar(payload.width, payload.height);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (!overlayWindow.isVisible()) overlayWindow.showInactive();
      const isHidden = (store && store.getSettings().floatingBubble) === "hidden";
      if (isHidden && !dictating) overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      else overlayWindow.setIgnoreMouseEvents(false);
    }
    return true;
  },
  "note.open": () => openFreshNote(),
  "notes.spawn": (_payload, event) => openFreshNote(senderWindow(event)),
  "notes.openHere": (payload, event) => {
    const id = payload && payload.id ? String(payload.id) : "";
    const sender = senderWindow(event);
    const other = sessionByPad(id);
    if (other && other.win !== sender) {
      rememberNoteWindow(other.win);
      deliverNote(other, padPayload(id));
      revealNote(other.win);
      return { focused: true };
    }
    const session = sessionForWindow(sender);
    if (!session) return { focused: false };
    session.padId = id;
    notePadId = id;
    rememberNoteWindow(session.win);
    deliverNote(session, padPayload(id));
    return { focused: false };
  },
  "notes.bind": (payload, event) => {
    const session = sessionForWindow(senderWindow(event));
    if (session) {
      session.padId = payload && payload.id ? String(payload.id) : "";
      notePadId = session.padId;
    }
    return true;
  },
  "desk.open": () => {
    showMain();
    return true;
  },
  "shot.open": () => openFlameshot(),
  "voicenote.start": (payload) => startVoiceNote(payload && payload.target === "desk" ? "desk" : "note"),
  "voicenote.stop": () => {
    if (dictating && dictateSource === "voicenote") endDictate();
    return true;
  },
  "voicenote.done": (payload) => {
    if (dictating && dictateSource === "voicenote") {
      dictating = false;
      dictateSource = "";
    }
    sendNoteVoice({ type: "done", error: payload && payload.error ? String(payload.error) : "" });
    return true;
  },
  "note.close": (_payload, event) => {
    const win = sessionForWindow(senderWindow(event)) ? sessionForWindow(senderWindow(event)).win : noteWindow;
    if (win && voiceNoteWindow === win && dictating && dictateSource === "voicenote" && voiceNoteTarget === "note") endDictate();
    if (win && !win.isDestroyed()) {
      win.webContents.send("note-reset", {});
      win.close();
    }
    return true;
  },
  "notes.sparkle.history.open": (payload) => openNoteHistory(payload || {}),
  "notes.sparkle.history.close": () => closeNoteHistory(),
  "desk.pending": () => {
    const value = pendingRefresh;
    pendingRefresh = null;
    return value || {};
  },
  "commands.validateName": (payload) => commands.validateName(payload && payload.name, store.listCommands()),
  "commands.create": (payload) => {
    const saved = store.createCommand(payload || {});
    try {
      commands.writeScript(commandsDir(), saved);
    } catch (error) {
      store.deleteCommand(saved.id);
      throw error;
    }
    applyFloatingBubbleState();
    refreshMain();
    return saved;
  },
  "commands.save": (payload) => {
    const saved = store.saveCommand(payload || {});
    commands.writeScript(commandsDir(), saved);
    applyFloatingBubbleState();
    refreshMain();
    return saved;
  },
  "commands.delete": (payload) => {
    const removed = store.deleteCommand(payload && payload.id);
    if (removed) commands.removeScript(commandsDir(), removed);
    applyFloatingBubbleState();
    refreshMain();
    return true;
  },
  // Only ever triggered by a click on the bubble element; never run automatically.
  "commands.run": async (payload) => {
    const row = store.getCommand(payload && payload.id);
    if (!row) {
      const result = { ok: false, code: "missing", error: "This command no longer exists." };
      reportCommandFailure(result);
      return result;
    }
    const result = await commands.run(commandsDir(), row);
    if (!result.ok) reportCommandFailure(result);
    return result;
  },
  "pads.list": () => store.listPads(),
  "pads.save": (payload) => {
    const saved = store.savePad(payload || {});
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.webContents.send("desk-refresh", {});
    }
    return saved;
  },
  "pads.delete": (payload) => {
    store.deletePad(payload.id);
    return true;
  },
  "speech.transform": async (payload) => ({ text: await applyTransform(payload.text, payload.kind || "polish") }),
  "desk.snapshot": () => ({
    settings: publicSettings(),
    dictionary: store.listDictionary(),
    history: store.listHistory(),
    pads: store.listPads(),
    commands: store.listCommands(),
    usage: flow.usageReport(store.listHistory()),
    notes: store.listNotes(),
    meetings: store.listMeetings(),
    events: store.listEvents(),
    todos: store.listTodos(),
    folders: store.listFolders(),
    corrections: store.listCorrections(),
    links: store.listLinks(),
    automations: store.listAutomations(),
    polish: store.listPolish(),
    instruct: store.listInstruct(),
    translations: store.listTranslations(),
    notifications: store.listNotifications(),
    scratchpad: store.getScratchpad(),
    tour: flow.tourSteps(),
    stats: flow.computeStats(store.listHistory()),
  }),
  "dictionary.save": (payload) => store.upsertDictionary(payload),
  "dictionary.delete": (payload) => store.deleteDictionary(payload.phrase),
  "history.update": (payload) => store.updateHistory(payload.id, payload.patch || {}),
  "history.delete": (payload) => store.deleteHistory(payload.id),
  "notes.sparkle.improve": (payload) => ensureNoteSparkle().improve(payload || {}),
  "notes.sparkle.apply": (payload) => ensureNoteSparkle().applyPreview(payload || {}),
  "notes.sparkle.undo": (payload) => ensureNoteSparkle().undo(payload || {}),
  "notes.sparkle.cancel": (payload) => ensureNoteSparkle().cancel(payload && payload.id),
  "notes.sparkle.suggest": (payload) => ensureNoteSparkle().suggest(payload || {}),
  "notes.sparkle.cached": (payload) => ensureNoteSparkle().cached(payload || {}),
  "notes.sparkle.versions": (payload) => ensureNoteSparkle().versions(payload && payload.id),
  "notes.model.download": (payload) => beginNoteModelDownload(payload && payload.id, Boolean(payload && payload.selectWhenReady)),
  "notes.model.openDownload": (payload) => beginNoteModelDownload(payload && payload.id, payload ? payload.selectWhenReady !== false : true),
  "notes.model.minimizeDownload": () => {
    if (noteDownloadWindow && !noteDownloadWindow.isDestroyed()) noteDownloadWindow.minimize();
    return { ok: true };
  },
  "notes.model.closeDownload": () => {
    if (noteDownloadWindow && !noteDownloadWindow.isDestroyed()) noteDownloadWindow.close();
    return { ok: true };
  },
  "notes.model.cancel": (payload) => {
    selectLocalWhenReady = false;
    return ensureNoteModels().cancel(payload && payload.id);
  },
  "notes.model.delete": async (payload) => {
    const id = payload && payload.id;
    if (noteLlama) await noteLlama.unload();
    const removed = ensureNoteModels().remove(id);
    const settings = store.getSettings();
    if (settings.noteImproveProvider === "local" && normalizeLocalModel(settings.noteImproveLocalModel) === normalizeLocalModel(id)) {
      selectLocalWhenReady = false;
      store.updateSettings({ noteImproveProvider: "openai" });
    }
    return removed;
  },
  "notes.model.testKey": async () => {
    const apiKey = readKey();
    if (!apiKey) return { ok: false, message: "No API key is saved." };
    const url = "https://api.openai.com/v1/models";
    try {
      providers.assertAllowedUrl(url);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) return { ok: false, message: "Key test failed." };
      return { ok: true, message: "Key is valid." };
    } catch (_error) {
      return { ok: false, message: "Key test failed." };
    }
  },
  "notes.save": (payload) => store.saveNote(payload),
  "notes.versions": (payload) => store.listNoteVersions(payload.id),
  "notes.delete": (payload) => store.deleteNote(payload.id),
  "meetings.save": (payload) => store.saveMeeting(payload),
  "meetings.delete": (payload) => store.deleteMeeting(payload.id),
  "events.save": (payload) => store.saveEvent(payload),
  "events.delete": (payload) => store.deleteEvent(payload.id),
  "todos.save": (payload) => store.saveTodo(payload),
  "todos.delete": (payload) => store.deleteTodo(payload.id),
  "folders.save": (payload) => store.saveFolder(payload),
  "folders.delete": (payload) => store.deleteFolder(payload.id),
  "corrections.add": (payload) => store.addCorrection(payload),
  "corrections.delete": (payload) => store.deleteCorrection(payload.id),
  "links.save": (payload) => store.saveLink(payload),
  "links.delete": (payload) => store.deleteLink(payload.id),
  "links.open": async (payload) => {
    const url = new URL(payload.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only web URLs are allowed.");
    await shell.openExternal(url.toString());
  },
  "automations.save": (payload) => store.saveAutomation(payload),
  "automations.delete": (payload) => store.deleteAutomation(payload.id),
  "scratchpad.set": (payload) => store.setScratchpad(payload.content),
  "notifications.read": (payload) => store.markNotification(payload.id),
  "notifications.add": (payload) => store.addNotification({
    title: payload.title || "Feedback",
    body: payload.body || "",
  }),
  "overlay.set": (payload) => {
    sendOverlay(payload);
    return true;
  },
  "clipboard.copy": (payload) => {
    clipboard.writeText(String(payload.text || ""));
    return true;
  },
  "clipboard.paste": (payload) => {
    pasteText(String(payload.text || ""));
    return true;
  },
  "text.prepare": async (payload) => {
    const raw = String(payload.text || "").trim();
    if (!raw) throw new Error("No text.");
    const prepared = flow.prepareTranscript(raw, library());

    if (typeof session !== "undefined" && session.voice && prepared.text) sendNoteVoice({ type: "final", text: prepared.text });
    return commitTranscript(raw, prepared, {
      appName: payload.appName,
      url: payload.url,
      durationMs: 0,
      paste: false,
      overlay: false,
    });
  },
  "speech.session": (payload) => openSpeechSession(payload),
  "speech.part": (payload) => {
    const session = speechSessions.get(payload.token);
    if (!session) throw new Error("Recording session expired.");
    if (session.failed) return false;
    const bytes = audioBytes(payload.audio);
    if (bytes.length < 45) return true;
    const mime = payload.mime || "audio/wav";
    const filename = payload.filename || (String(mime).includes("wav") ? "recording.wav" : "recording.webm");
    const sttEngine = store.getSettings().sttEngine === "openai" ? "openai" : "parakeet";
    session.sttEngine = sttEngine;
    session.pending = session.pending.then(async () => {
      if (session.failed) return;
      try {
        if (sttEngine === "parakeet") {
          const result = await parakeet.transcribeWav(bytes, app.getPath("userData"));
          if (result.text) session.texts.push(result.text);
          if (result.text && session.voice) liveVoiceText(result.text);
          if (result.language) session.language = result.language;
        } else {
          const body = await providers.postTranscription(fetch, () => providers.transcriptionRequest({
            provider: "openai",
            apiKey: readKey(),
            audio: bytes,
            mime,
            filename,
          }));
          const text = providers.parseTranscription(body);
          const language = providers.detectedLanguage(body);
          if (text) session.texts.push(text);
          if (text && session.voice) liveVoiceText(text);
          if (language) session.language = language;
        }
      } catch (error) {
        session.failed = error instanceof Error ? error : new Error(String(error));
      }
    });
    return true;
  },
  "speech.finish": (payload) => enqueueSpeech(async () => {
    const session = speechSessions.get(payload.token);
    if (!session) throw new Error("Recording session expired.");
    speechSessions.delete(payload.token);
    await session.pending;
    if (session.failed) throw session.failed;
    const raw = audio.joinTranscripts(session.texts);
    if (!raw) return { empty: true, text: "" };
    const prepared = flow.prepareTranscript(raw, library());

    if (typeof session !== "undefined" && session.voice && prepared.text) sendNoteVoice({ type: "final", text: prepared.text });
    return commitTranscript(raw, prepared, {
      appName: session.voice ? "Voice note" : payload.appName,
      url: payload.url,
      durationMs: payload.durationMs || 0,
      language: session.language,
      sttEngine: session.sttEngine,
      paste: !session.voice,
      overlay: false,
    });
  }),
  "speech.speak": async (payload) => {
    const settings = store.getSettings();
    const request = providers.speechRequest({
      provider: settings.provider,
      apiKey: readKey(),
      text: payload.text,
      voice: settings.ttsVoice || undefined,
      model: settings.ttsModel || undefined,
    });
    const audio = await providers.postAudio(fetch, request);
    return { base64: audio.bytes.toString("base64"), type: audio.type };
  },
  "speech.translate": async (payload) => {
    const text = await translateText(payload.text, payload.targetLanguage);
    return { text };
  },
  "speech.rewrite": async (payload) => {
    const settings = store.getSettings();
    const local = flow.polishLocal(payload.text);
    if (!payload.useApi) return { text: local, local: true };
    const output = await completeChat((base) => providers.rewriteRequest({
      ...base,
      text: payload.text,
      style: payload.style || settings.tone,
    }));
    store.addPolish({ input_text: payload.text, output_text: output, style: payload.style || settings.tone });
    return { text: output, local: false };
  },
  "speech.instruct": async (payload) => {
    const output = await completeChat((base) => providers.instructRequest({
      ...base,
      prompt: payload.prompt,
      context: payload.context || "",
    }));
    const row = store.addInstruct({ prompt: payload.prompt, response: output });
    return row;
  },
  "speech.summarize": async (payload) => {
    const output = await completeChat((base) => providers.summaryRequest({
      ...base,
      transcript: payload.transcript,
    }));
    return store.saveMeeting({ ...payload.meeting, summary: output, status: "summarized" });
  },
  "file.export": async () => {
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: "Export OpenFlow",
      defaultPath: "openflow-export.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    fs.writeFileSync(choice.filePath, JSON.stringify(store.snapshot(), null, 2));
    return { canceled: false, filePath: choice.filePath };
  },
  "file.import": async () => {
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Import local data",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
    const parsed = JSON.parse(fs.readFileSync(choice.filePaths[0], "utf8"));
    if (parsed && parsed.settings) delete parsed.settings.apiKey;
    if (parsed) delete parsed.apiKey;
    store.replaceAll(parsed);
    return { canceled: false };
  },
};

function ipcFloat32(samples) {
  if (samples instanceof Float32Array) return samples;
  if (ArrayBuffer.isView(samples)) return Float32Array.from(samples);
  if (Array.isArray(samples)) return Float32Array.from(samples);
  if (samples && Array.isArray(samples.data)) return Float32Array.from(samples.data);
  return new Float32Array(0);
}

ipcMain.handle("audio-codec", (_event, payload) => {
  const body = payload || {};
  if (body.op === "flush") return audio.flushSampleCount(body.sampleRate);
  const samples = ipcFloat32(body.samples);
  if (body.op === "audible") return audio.audible(samples, body.sampleRate);
  if (body.op === "slices" || body.op === "pack") {
    const loud = audio.audible(samples, body.sampleRate);
    if (body.op === "pack" && !loud && !body.force) return { audible: false, slices: [] };
    const slices = audio.wavSlices(samples, body.sampleRate).map((part) => Uint8Array.from(part));
    if (body.op === "pack") return { audible: loud, slices };
    return slices;
  }
  throw new Error("Unknown action.");
});

ipcMain.handle("dispatch", async (event, action, payload) => {
  const handler = actions[action];
  if (!handler) throw new Error("Unknown action.");
  try {
    return await handler(payload || {}, event);
  } catch (error) {
    store.addNotification({ title: "Error", body: error.message || "Unknown error" });
    if (!String(action).startsWith("speech.")) sendOverlay({ mode: "hidden" });
    throw error;
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());
  app.whenReady().then(async () => {
    const allowMedia = (_contents, permission) => permission === "media" || permission === "microphone" || permission === "audioCapture";
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowMedia(null, permission));
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(allowMedia(null, permission));
    });
    if (typeof session.defaultSession.setDevicePermissionHandler === "function") {
      session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === "microphone" || details.deviceType === "audio");
    }
    store = createStore(path.join(app.getPath("userData"), "openflow.json"));
    ensureCommandsScripts();
    await runModelInstallerIfNeeded();
    syncSttEngine();
    applyFloatingBubbleState();
    createWindows();
    createTray();
    await ensureMicrophone();
    startChord();
    watchPointer();
  });
}

app.on("before-quit", () => {
  quitting = true;
  if (pointerTimer) clearInterval(pointerTimer);
  stopChord();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {});
