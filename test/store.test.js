"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../src/store");

test("background settings default to a resident desk", () => {
  const store = createStore(":memory:");
  const settings = store.getSettings();
  assert.equal(settings.startInTray, true);
  assert.equal(settings.sounds, true);
  assert.equal(settings.openAtLogin, false);
  assert.equal(settings.showHotkey, "CommandOrControl+Alt+O");
  assert.equal(settings.floatingBubble, "active");
  assert.deepEqual(settings.bubbleElements, ["voice", "note", "tune", "shot"]);
});

test("dictionary, history, and notes round-trip in memory", () => {
  const store = createStore(":memory:");
  const entry = store.upsertDictionary({ phrase: "api", replacement: "API", is_snippet: false, starred: true });
  assert.equal(entry.starred, true);
  store.touchDictionary(["api"], "used");
  assert.equal(store.listDictionary()[0].frequency_used, 1);

  const history = store.addHistory({ asr_text: "roh", formatted_text: "Roh", word_count: 1, app_name: "Editor" });
  const archived = store.updateHistory(history.id, { archived: true, edited_text: "Rohtext" });
  assert.equal(archived.archived, true);
  assert.equal(store.listHistory({ archived: true }).length, 1);

  const note = store.saveNote({ title: "Plan", content: "erste" });
  store.saveNote({ id: note.id, title: "Plan", content: "zweite", pinned: true });
  assert.equal(store.listNoteVersions(note.id).length, 1);
  assert.equal(store.listNotes()[0].pinned, true);
  store.deleteNote(note.id);
  assert.equal(store.listNotes().length, 0);
});

test("folders, meetings, and file reload keep local data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openflow-"));
  const file = path.join(dir, "openflow.json");
  const store = createStore(file);
  const folder = store.saveFolder({ name: "Kunden" });
  const meeting = store.saveMeeting({ title: "Kickoff", transcript: "Start", folder_id: folder.id, participants: "Ada" });
  store.saveTodo({ title: "Protokoll", meeting_id: meeting.id });
  store.saveEvent({ title: "Folge", starts_at: "2026-10-22T09:00:00.000Z", meeting_id: meeting.id });
  store.addCorrection({ source_text: "kikof", corrected_text: "Kickoff" });
  store.saveLink({ title: "Notiz", url: "https://example.com" });
  store.saveAutomation({ name: "Gruß", trigger_phrase: "gruß", action: "prefix", action_value: "Hallo" });
  store.setScratchpad("zwischendrin");

  const reloaded = createStore(file);
  assert.equal(reloaded.listMeetings()[0].folder_id, folder.id);
  assert.equal(reloaded.listTodos()[0].title, "Protokoll");
  assert.equal(reloaded.listEvents()[0].meeting_id, meeting.id);
  assert.equal(reloaded.getScratchpad(), "zwischendrin");
  reloaded.deleteFolder(folder.id);
  assert.equal(reloaded.listMeetings()[0].folder_id, "");
});

test("old dictation selections migrate to Compact while Original, Polish and disabled settings survive reload", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-compact-'));
  try {
    const file = path.join(dir, 'profile.json');
    for (const [mode, enabled, expected] of [
      ['fillers', true, 'compact'], ['polished', true, 'polished'],
      ['raw', true, 'raw'], ['compact', true, 'compact'],
      ['fillers', false, 'raw'], ['unknown', true, 'raw'],
    ]) {
      const history = [{id:'old', cleanup_mode:'fillers', formatted_text:'Historical text.'}];
      fs.writeFileSync(file, JSON.stringify({settings:{dictationCleanupEnabled:enabled, dictationCleanupMode:mode}, history}));
      const store = createStore(file);
      assert.equal(store.getSettings().dictationCleanupMode, expected);
      assert.equal(store.getSettings().dictationCleanupEnabled, enabled);
      assert.deepEqual(store.listHistory(), history);
      store.updateSettings({sounds:false});
      assert.equal(createStore(file).getSettings().dictationCleanupMode, expected);
    }
    const store = createStore(':memory:');
    store.updateSettings({dictationCleanupEnabled:true, dictationCleanupMode:'fillers'});
    assert.equal(store.getSettings().dictationCleanupMode, 'raw', 'Removed mode cannot be selected again');
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
