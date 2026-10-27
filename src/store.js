"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const commands = require("./commands");

function blank() {
  return {
    settings: {
      provider: "openai",
      sttEngine: "parakeet",
      onboardingDone: false,
      dictationShortcut: "ctrl+win",
      dictationMode: "hold",
      floatingBubble: "active",
      bubbleElements: ["voice", "note", "tune", "shot"],
      transform: "polish",
      transformAuto: false,
      polishStyle: "clarity",
      sttModel: "",
      ttsModel: "",
      ttsVoice: "",
      textModel: "",
      spokenLanguage: "en",
      targetLanguage: "English",
      hotkey: "CommandOrControl+Alt+Space",
      showHotkey: "CommandOrControl+Alt+O",
      autoPaste: false,
      startInTray: true,
      openAtLogin: false,
      sounds: true,
      tone: "clear",
      styleInstructions: "",
      tourIndex: 0,
      noteImproveEnabled: true,
      noteImproveOnboardingRelease: "",
      noteImproveProvider: "openai",
      noteImproveModel: "gpt-6-luna",
      noteImproveLocalModel: "qwen2.5-3b-instruct-q4",
      noteImproveAutoSuggestions: true,
      noteImproveOnboardingDone: false,
      noteImprovePrivacyAck: false,
    },
    dictionary: [],
    history: [],
    notes: [],
    noteVersions: [],
    meetings: [],
    events: [],
    todos: [],
    folders: [],
    corrections: [],
    links: [],
    automations: [],
    polish: [],
    instruct: [],
    translations: [],
    notifications: [],
    scratchpad: "",
    pads: [],
    padVersions: [],
    commands: [],
  };
}

function createStore(filePath) {
  const memory = filePath === ":memory:";
  let data = blank();
  if (!memory && filePath && fs.existsSync(filePath)) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    data = { ...blank(), ...parsed, settings: { ...blank().settings, ...(parsed.settings || {}) } };
  }

  function save() {
    if (memory) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, filePath);
  }

  function id() {
    return crypto.randomUUID();
  }

  function now() {
    return new Date().toISOString();
  }

  function queryMatch(value, query) {
    if (!query) return true;
    return String(value || "").toLowerCase().includes(String(query).toLowerCase());
  }

  function publicPad(row) {
    return {
      ...row,
      suggestions: Array.isArray(row.suggestions) ? row.suggestions.slice() : [],
      suggestion_hash: row.suggestion_hash || "",
    };
  }

  return {
    filePath,
    getSettings() {
      return { ...data.settings };
    },
    updateSettings(partial) {
      data.settings = { ...data.settings, ...partial };
      save();
      return this.getSettings();
    },
    listDictionary(query) {
      return data.dictionary
        .filter((row) => queryMatch(`${row.phrase} ${row.replacement || ""}`, query))
        .sort((a, b) => a.phrase.localeCompare(b.phrase));
    },
    upsertDictionary(input) {
      const phrase = String(input.phrase || "").trim();
      if (!phrase) throw new Error("An entry requires a phrase.");
      const existing = data.dictionary.find((row) => row.phrase.toLowerCase() === phrase.toLowerCase());
      const row = {
        phrase,
        replacement: String(input.replacement || "").trim(),
        is_snippet: Boolean(input.is_snippet),
        starred: Boolean(input.starred),
        frequency_used: existing ? existing.frequency_used : 0,
        frequency_seen: existing ? existing.frequency_seen : 0,
        manually_added: true,
        last_used: existing ? existing.last_used : null,
        last_seen: existing ? existing.last_seen : null,
      };
      data.dictionary = data.dictionary.filter((item) => item.phrase.toLowerCase() !== phrase.toLowerCase());
      data.dictionary.push(row);
      save();
      return row;
    },
    touchDictionary(phrases, kind) {
      const stamp = now();
      for (const phrase of phrases || []) {
        const row = data.dictionary.find((item) => item.phrase.toLowerCase() === String(phrase).toLowerCase());
        if (!row) continue;
        if (kind === "used") {
          row.frequency_used += 1;
          row.last_used = stamp;
        } else {
          row.frequency_seen += 1;
          row.last_seen = stamp;
        }
      }
      save();
    },
    deleteDictionary(phrase) {
      data.dictionary = data.dictionary.filter((row) => row.phrase !== phrase);
      save();
    },
    listHistory(filter) {
      const query = filter && filter.query;
      const archived = filter && filter.archived;
      return data.history
        .filter((row) => (archived == null ? true : Boolean(row.archived) === Boolean(archived)))
        .filter((row) => queryMatch(`${row.asr_text} ${row.formatted_text} ${row.edited_text} ${row.app_name}`, query))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    addHistory(input) {
      const row = {
        id: id(),
        asr_text: input.asr_text || "",
        formatted_text: input.formatted_text || "",
        edited_text: input.edited_text || "",
        language: input.language || "",
        app_name: input.app_name || "",
        url: input.url || "",
        status: input.status || "done",
        stt_engine: input.stt_engine || "openai",
        duration_ms: Number(input.duration_ms) || 0,
        word_count: Number(input.word_count) || 0,
        archived: false,
        created_at: now(),
      };
      data.history.push(row);
      save();
      return row;
    },
    updateHistory(entryId, partial) {
      const row = data.history.find((item) => item.id === entryId);
      if (!row) throw new Error("History entry missing.");
      Object.assign(row, partial);
      save();
      return { ...row };
    },
    deleteHistory(entryId) {
      data.history = data.history.filter((row) => row.id !== entryId);
      save();
    },
    listNotes(query) {
      return data.notes
        .filter((row) => !row.deleted && queryMatch(`${row.title} ${row.content}`, query))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.modified_at.localeCompare(a.modified_at));
    },
    saveNote(input) {
      const stamp = now();
      let row = input.id ? data.notes.find((item) => item.id === input.id) : null;
      if (!row) {
        row = { id: id(), created_at: stamp, deleted: false, pinned: false };
        data.notes.push(row);
      }
      const content = String(input.content || "");
      if (row.content && row.content !== content) {
        data.noteVersions.push({ id: id(), note_id: row.id, content: row.content, created_at: stamp });
      }
      row.title = String(input.title || "Untitled").trim() || "Untitled";
      row.content = content;
      row.pinned = input.pinned == null ? Boolean(row.pinned) : Boolean(input.pinned);
      row.modified_at = stamp;
      save();
      return { ...row };
    },
    listNoteVersions(noteId) {
      return data.noteVersions.filter((row) => row.note_id === noteId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    deleteNote(noteId) {
      const row = data.notes.find((item) => item.id === noteId);
      if (row) row.deleted = true;
      save();
    },
    listMeetings(query) {
      return data.meetings
        .filter((row) => queryMatch(`${row.title} ${row.transcript} ${row.summary} ${row.participants}`, query))
        .sort((a, b) => b.modified_at.localeCompare(a.modified_at));
    },
    saveMeeting(input) {
      const stamp = now();
      let row = input.id ? data.meetings.find((item) => item.id === input.id) : null;
      if (!row) {
        row = { id: id(), created_at: stamp, status: "draft" };
        data.meetings.push(row);
      }
      row.title = String(input.title || "Meeting").trim();
      row.transcript = input.transcript == null ? row.transcript || "" : String(input.transcript);
      row.summary = input.summary == null ? row.summary || "" : String(input.summary);
      row.participants = input.participants == null ? row.participants || "" : String(input.participants);
      row.folder_id = input.folder_id == null ? row.folder_id || "" : String(input.folder_id);
      row.status = input.status || row.status || "draft";
      row.modified_at = stamp;
      save();
      return { ...row };
    },
    deleteMeeting(meetingId) {
      data.meetings = data.meetings.filter((row) => row.id !== meetingId);
      save();
    },
    listEvents() {
      return [...data.events].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    },
    saveEvent(input) {
      let row = input.id ? data.events.find((item) => item.id === input.id) : null;
      if (!row) {
        row = { id: id() };
        data.events.push(row);
      }
      row.title = String(input.title || "Event").trim();
      row.starts_at = input.starts_at || new Date().toISOString();
      row.ends_at = input.ends_at || "";
      row.location = input.location || "";
      row.notes = input.notes || "";
      row.meeting_id = input.meeting_id || "";
      save();
      return { ...row };
    },
    deleteEvent(eventId) {
      data.events = data.events.filter((row) => row.id !== eventId);
      save();
    },
    listTodos() {
      return [...data.todos].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
    },
    saveTodo(input) {
      let row = input.id ? data.todos.find((item) => item.id === input.id) : null;
      if (!row) {
        row = { id: id(), sort_order: data.todos.length, done: false };
        data.todos.push(row);
      }
      row.title = String(input.title || "Task").trim();
      row.details = input.details || "";
      row.done = input.done == null ? Boolean(row.done) : Boolean(input.done);
      row.due_at = input.due_at || "";
      row.meeting_id = input.meeting_id || "";
      if (input.sort_order != null) row.sort_order = Number(input.sort_order);
      save();
      return { ...row };
    },
    deleteTodo(todoId) {
      data.todos = data.todos.filter((row) => row.id !== todoId);
      save();
    },
    listFolders() {
      return [...data.folders].sort((a, b) => a.name.localeCompare(b.name));
    },
    saveFolder(input) {
      let row = input.id ? data.folders.find((item) => item.id === input.id) : null;
      if (!row) {
        row = { id: id() };
        data.folders.push(row);
      }
      row.name = String(input.name || "Folder").trim();
      row.kind = input.kind || "meetings";
      save();
      return { ...row };
    },
    deleteFolder(folderId) {
      data.folders = data.folders.filter((row) => row.id !== folderId);
      for (const meeting of data.meetings) {
        if (meeting.folder_id === folderId) meeting.folder_id = "";
      }
      save();
    },
    listCorrections() {
      return [...data.corrections].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    addCorrection(input) {
      const source = String(input.source_text || "").trim();
      const corrected = String(input.corrected_text || "").trim();
      if (!source || !corrected) throw new Error("Correction requires source text and replacement.");
      const row = { id: id(), source_text: source, corrected_text: corrected, created_at: now() };
      data.corrections.push(row);
      save();
      return row;
    },
    deleteCorrection(correctionId) {
      data.corrections = data.corrections.filter((row) => row.id !== correctionId);
      save();
    },
    listLinks(query) {
      return data.links
        .filter((row) => queryMatch(`${row.title} ${row.url} ${row.note}`, query))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title));
    },
    saveLink(input) {
      let row = input.id ? data.links.find((item) => item.id === input.id) : null;
      if (!row) {
        row = { id: id(), pinned: false };
        data.links.push(row);
      }
      row.title = String(input.title || input.url || "Link").trim();
      row.url = String(input.url || "").trim();
      row.note = input.note || "";
      row.pinned = input.pinned == null ? Boolean(row.pinned) : Boolean(input.pinned);
      if (!row.url) throw new Error("A link requires a URL.");
      save();
      return { ...row };
    },
    deleteLink(linkId) {
      data.links = data.links.filter((row) => row.id !== linkId);
      save();
    },
    listAutomations() {
      return [...data.automations];
    },
    saveAutomation(input) {
      let row = input.id ? data.automations.find((item) => item.id === input.id) : null;
      if (!row) {
        row = { id: id(), enabled: true };
        data.automations.push(row);
      }
      row.name = String(input.name || "Rule").trim();
      row.trigger_phrase = String(input.trigger_phrase || "").trim();
      row.action = input.action || "replace";
      row.action_value = input.action_value || "";
      row.enabled = input.enabled == null ? Boolean(row.enabled) : Boolean(input.enabled);
      if (!row.trigger_phrase) throw new Error("A rule requires a trigger.");
      save();
      return { ...row };
    },
    deleteAutomation(ruleId) {
      data.automations = data.automations.filter((row) => row.id !== ruleId);
      save();
    },
    listPolish() {
      return [...data.polish].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    addPolish(input) {
      const row = {
        id: id(),
        input_text: input.input_text || "",
        output_text: input.output_text || "",
        style: input.style || "",
        created_at: now(),
      };
      data.polish.push(row);
      save();
      return row;
    },
    listInstruct() {
      return [...data.instruct].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    addInstruct(input) {
      const row = { id: id(), prompt: input.prompt || "", response: input.response || "", created_at: now() };
      data.instruct.push(row);
      save();
      return row;
    },
    listTranslations() {
      return [...data.translations].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    addTranslation(input) {
      const row = {
        id: id(),
        source_text: input.source_text || "",
        output_text: input.output_text || "",
        target_language: input.target_language || "",
        created_at: now(),
      };
      data.translations.push(row);
      save();
      return row;
    },
    listNotifications() {
      return [...data.notifications].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    addNotification(input) {
      const row = { id: id(), title: input.title || "Notice", body: input.body || "", read: false, created_at: now() };
      data.notifications.push(row);
      save();
      return row;
    },
    markNotification(notificationId) {
      const row = data.notifications.find((item) => item.id === notificationId);
      if (row) row.read = true;
      save();
    },
    listPads() {
      return data.pads.map((row) => publicPad(row));
    },
    getPad(padId) {
      const row = data.pads.find((item) => item.id === padId);
      return row ? publicPad(row) : null;
    },
    savePad(input) {
      let row = input.id ? data.pads.find((item) => item.id === input.id) : null;
      if (!row) {
        row = { id: id(), title: "Note", content: "", suggestions: [], suggestion_hash: "" };
        data.pads.push(row);
      }
      if (input.title != null) row.title = String(input.title || "Note").trim() || "Note";
      if (input.content != null) row.content = String(input.content);
      save();
      return publicPad(row);
    },
    setPadSuggestions(padId, hash, suggestions) {
      const row = data.pads.find((item) => item.id === padId);
      if (!row) return null;
      row.suggestion_hash = String(hash || "");
      row.suggestions = Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
      save();
      return publicPad(row);
    },
    addPadVersion(padId, input) {
      const row = data.pads.find((item) => item.id === padId);
      if (!row) throw new Error("Note missing.");
      const version = {
        id: id(),
        pad_id: padId,
        content: String(input.content == null ? "" : input.content),
        label: String(input.label || ""),
        kind: input.kind || "snapshot",
        instruction: String(input.instruction || ""),
        provider: String(input.provider || ""),
        model: String(input.model || ""),
        created_at: now(),
        seq: data.padVersions.length,
      };
      data.padVersions.push(version);
      save();
      return { ...version };
    },
    listPadVersions(padId) {
      return data.padVersions
        .filter((row) => row.pad_id === padId)
        .sort((a, b) => (b.seq - a.seq) || b.created_at.localeCompare(a.created_at))
        .map((row) => ({ ...row }));
    },
    deletePad(padId) {
      data.pads = data.pads.filter((row) => row.id !== padId);
      data.padVersions = data.padVersions.filter((row) => row.pad_id !== padId);
      save();
    },
    listCommands(query) {
      return data.commands
        .filter((row) => queryMatch(`${row.name}${row.extension} ${row.content}`, query))
        .sort((a, b) => b.modified_at.localeCompare(a.modified_at))
        .map((row) => ({ ...row, runAsAdmin: Boolean(row.runAsAdmin), icon: commands.normalizeIcon(row.icon) }));
    },
    getCommand(commandId) {
      const row = data.commands.find((item) => item.id === commandId);
      return row ? { ...row, runAsAdmin: Boolean(row.runAsAdmin), icon: commands.normalizeIcon(row.icon) } : null;
    },
    createCommand(input) {
      const type = commands.typeOf(input.type);
      if (!type) throw new Error("Unknown command type.");
      const name = String(input.name == null ? "" : input.name);
      const error = commands.validateName(name, data.commands);
      if (error) throw new Error(error);
      const content = String(input.content || "");
      if (content.length > commands.MAX_CONTENT) throw new Error("The script is too large.");
      const stamp = now();
      const runAsAdmin = Boolean(input && input.runAsAdmin);
      const icon = commands.normalizeIcon(input && input.icon);
      const row = { id: id(), name, type: type.id, extension: type.extension, content, runAsAdmin, icon, created_at: stamp, modified_at: stamp };
      data.commands.push(row);
      save();
      return { ...row };
    },
    // Only the script text, runAsAdmin flag and icon can change; name, type and extension stay fixed.
    saveCommand(input) {
      const row = data.commands.find((item) => item.id === input.id);
      if (!row) throw new Error("Command missing.");
      const content = String(input.content || "");
      if (content.length > commands.MAX_CONTENT) throw new Error("The script is too large.");
      row.content = content;
      if (input && input.runAsAdmin !== undefined) {
        row.runAsAdmin = Boolean(input.runAsAdmin);
      }
      if (input && input.icon !== undefined) {
        row.icon = commands.normalizeIcon(input.icon);
      }
      row.modified_at = now();
      save();
      return { ...row, runAsAdmin: Boolean(row.runAsAdmin), icon: commands.normalizeIcon(row.icon) };
    },
    deleteCommand(commandId) {
      const row = data.commands.find((item) => item.id === commandId);
      data.commands = data.commands.filter((item) => item.id !== commandId);
      if (Array.isArray(data.settings.bubbleElements)) {
        data.settings.bubbleElements = data.settings.bubbleElements.filter((item) => item !== `cmd:${commandId}`);
      }
      save();
      return row ? { ...row, runAsAdmin: Boolean(row.runAsAdmin), icon: commands.normalizeIcon(row.icon) } : null;
    },
    getScratchpad() {
      return data.scratchpad || "";
    },
    setScratchpad(content) {
      data.scratchpad = String(content || "");
      save();
      return data.scratchpad;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(data));
    },
    replaceAll(next) {
      const fresh = blank();
      data = { ...fresh, ...next, settings: { ...fresh.settings, ...(next.settings || {}) } };
      save();
    },
  };
}

module.exports = { createStore, blank };
