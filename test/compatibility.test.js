"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore, blank } = require("../src/store");
const flow = require("../src/flow");
const { createNoteSparkle } = require("../src/note-sparkle");

test("upgrading a legacy profile preserves rules, old notes, versions and unknown data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openflow-compat-"));
  try {
    const file = path.join(dir, "profile.json");
    const profile = blank();
    profile.settings.noteImproveProvider = "local";
    profile.settings.noteImproveLocalModel = "qwen2.5-3b-instruct-q4";
    profile.settings.sounds = false;
    profile.settings.futureSetting = { keep: true };
    profile.dictionary = [{ phrase: "open flow", replacement: "OpenFlow", is_snippet: false }];
    profile.corrections = [{ source_text: "flou", corrected_text: "flow" }];
    profile.automations = [{ name: "Greeting", trigger_phrase: "hello", enabled: true, action: "prefix", action_value: "Hi" }];
    for (const key of ["notes", "noteVersions", "meetings", "events", "todos", "folders", "links", "pads", "padVersions"]) {
      profile[key] = [{ id: `old-${key}`, content: "Keep this", modified_at: "2026-11-23T09:00:00Z" }];
    }
    profile.futureCollection = [{ keep: true }];
    fs.writeFileSync(file, JSON.stringify(profile));
    const store = createStore(file);
    store.updateSettings({ dictationMode: "toggle" });
    const reloaded = createStore(file);
    const snapshot = reloaded.snapshot();
    for (const key of Object.keys(profile).filter(key => key !== "settings")) {
      assert.deepEqual(snapshot[key], profile[key], key);
    }
    assert.equal(snapshot.settings.noteImproveLocalModel, profile.settings.noteImproveLocalModel);
    assert.deepEqual(snapshot.settings.futureSetting, { keep: true });
    assert.equal(snapshot.settings.sounds, false);
    assert.equal(snapshot.settings.dictationMode, "toggle");
    const prepared = flow.prepareTranscript("hello open flow flou", {
      dictionary: reloaded.listDictionary(), corrections: reloaded.listCorrections(), automations: reloaded.listAutomations(),
    });
    assert.match(prepared.text, /Hi hello OpenFlow flow/);
  } finally {
    assert.equal(path.dirname(dir), os.tmpdir());
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("historical local text models retain zero cost and stay out of API usage", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  for (const model of ["qwen2.5-3b-instruct-q4", "llama-3.2-3b-instruct-q4"]) {
    const measured = flow.measureNoteChange({ before: "Old note", after: "Old improved note", instruction: "Polish", model });
    assert.equal(measured.model, model);
    assert.equal(measured.costUsd, 0);
    const report = flow.noteAndDictationUsageReport([
      { kind: "improve", provider: "local", model, created_at: now.toISOString(), words: 2, prompt_tokens: 10, completion_tokens: 5, cost_usd: 0 },
    ], [], now);
    assert.equal(report.noteChanges, 0);
    assert.equal(report.costUsd, 0);
    assert.equal(report.tokens, 0);
  }
});

test("cloud note improvement sends long notes in full after local chunking is removed", async () => {
  const store = createStore(":memory:");
  store.updateSettings({ noteImproveEnabled: true, noteImprovePrivacyAck: true });
  const content = "A complete paragraph stays in this note. ".repeat(500) + "Final important detail.";
  let request;
  const sparkle = createNoteSparkle({
    store, readKey: () => "test-key",
    complete: async args => { request = args; return content + " Polished."; },
  });
  const result = await sparkle.improve({ title: "Long note", content, instruction: "Polish" });
  assert.equal(result.ok, true);
  assert.ok(request.user.includes(content));
  assert.ok(result.content.endsWith("Final important detail. Polished."));
});
