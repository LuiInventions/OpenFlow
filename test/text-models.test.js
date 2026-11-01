"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../src/store");
const { createTextCompletion } = require("../src/text-completion");
const { createNoteSparkle } = require("../src/note-sparkle");
const { createDictationCleanup } = require("../src/dictation-cleanup");
const { TEXT_MODELS } = require("../src/note-improve");
const flow = require("../src/flow");

function response(text) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200 } } }) };
}

test("Nano is selected automatically for fresh and old default profiles; later manual choices persist", () => {
  assert.equal(createStore(":memory:").getSettings().noteImproveModel, "gpt-5.4-nano");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openflow-nano-default-"));
  try {
    const file = path.join(dir, "profile.json");
    for (const [previous, expected] of [[undefined, "gpt-5.4-nano"], ["gpt-6-luna", "gpt-5.4-nano"], ["gpt-6-sol", "gpt-6-sol"]]) {
      const usage = [{id:"existing",model:"gpt-6-luna",cost_usd:0.012345,prompt_tokens:1234,completion_tokens:567}];
      fs.writeFileSync(file, JSON.stringify({settings:{noteImproveModel:previous,noteImproveEnabled:false},dictationUsage:usage}));
      const store = createStore(file);
      assert.equal(store.getSettings().noteImproveModel, expected);
      assert.equal(store.getSettings().noteImproveEnabled, false);
      assert.deepEqual(store.listDictationUsage(), usage);
      store.updateSettings({noteImproveModel:"gpt-6-luna"});
      const reloaded = createStore(file);
      assert.equal(reloaded.getSettings().noteImproveModel, "gpt-6-luna", "Manual Luna choice survives restart after migration");
      assert.equal(reloaded.getSettings().textModelDefaultVersion, 1);
      assert.deepEqual(reloaded.listDictationUsage(), usage);
    }
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test("all shared text models persist while legacy and unknown selections fall back to Nano", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openflow-models-"));
  try {
    const file = path.join(dir, "profile.json");
    for (const model of TEXT_MODELS) {
      const store = createStore(file);
      store.updateSettings({ noteImproveModel: model.id });
      store.updateSettings({ sounds: false });
      assert.equal(createStore(file).getSettings().noteImproveModel, model.id);
    }
    const store = createStore(file);
    for (const model of ["gpt-4.1-mini", "unknown", "", "local"]) {
      store.updateSettings({ noteImproveModel: model });
      assert.equal(store.getSettings().noteImproveModel, "gpt-5.4-nano");
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("model selection controls requests, reasoning and per-model cached-token pricing", async () => {
  const expectedCosts = { "gpt-5.4-nano": 0.000289, "gpt-6-luna": 0.000132, "gpt-6-sol": 0.00264 };
  for (const model of TEXT_MODELS) {
    const store = createStore(":memory:");
    store.updateSettings({ noteImproveModel: model.id });
    const completion = createTextCompletion({ store, readKey: () => "test-key", fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, model.id);
      assert.equal(body.reasoning_effort, model.reasoning);
      assert.equal(body.temperature, undefined);
      return response("Hello.");
    } });
    assert.equal(completion.selection().model, model.id);
    await completion.complete({ system: "Edit.", user: "Hello." });
    assert.equal(flow.noteImproveCost(model.id, 1000, 100, 200), expectedCosts[model.id]);
  }
  assert.equal(flow.noteImproveCost("gpt-6-sol", 300000, 100, 200), 1.20078);
});

test("one selected model applies to notes and dictation; switching never reprices previous usage", async () => {
  const store = createStore(":memory:");
  store.updateSettings({ noteImproveEnabled: true, noteImprovePrivacyAck: true, dictationCleanupEnabled: true, dictationCleanupMode: "compact" });
  const completion = createTextCompletion({ store, readKey: () => "test-key", fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    return response(body.messages[0].content.includes("Notiz-Editor") ? "Hello world." : '{"text":"Hello world."}');
  } });
  const notes = createNoteSparkle({ store, textCompletion: completion });
  const dictation = createDictationCleanup({ store, completion });
  const savedCosts = [];
  for (const model of TEXT_MODELS) {
    store.updateSettings({ noteImproveModel: model.id });
    const note = await notes.improve({ content: "Hello world.", instruction: "Polish" });
    const cleaned = await dictation.clean("Um, hello world.");
    assert.equal(note.ok, true);
    assert.equal(note.model, model.id);
    assert.equal(cleaned.status, "cleaned");
    assert.equal(cleaned.model, model.id);
    const versions = store.listAllPadVersions().filter(row => row.kind === "improve");
    assert.equal(versions.at(-1).model, model.id);
    const usage = store.listDictationUsage();
    assert.equal(usage.at(-1).model, model.id);
    savedCosts.push(usage.at(-1).cost_usd);
    assert.deepEqual(usage.map(row => row.cost_usd), savedCosts);
  }
  const versions = store.listAllPadVersions();
  const usage = store.listDictationUsage();
  const report = flow.noteAndDictationUsageReport(versions, usage);
  const before = JSON.stringify({ versions, usage, report });
  for (const model of TEXT_MODELS) {
    store.updateSettings({ noteImproveModel: model.id });
    assert.equal(JSON.stringify({ versions: store.listAllPadVersions(), usage: store.listDictationUsage(),
      report: flow.noteAndDictationUsageReport(store.listAllPadVersions(), store.listDictationUsage()) }), before);
  }
  assert.equal(report.costUsd, 0.006122);
});

test("a pending note retains its starting model and price after the selection changes", async () => {
  const store = createStore(":memory:");
  store.updateSettings({ noteImproveEnabled: true, noteImprovePrivacyAck: true, noteImproveModel: "gpt-6-sol" });
  let finish;
  const completion = createTextCompletion({ store, readKey: () => "test-key", fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, "gpt-6-sol");
    await new Promise(resolve => { finish = resolve; });
    return response("Hello world.");
  } });
  const pending = createNoteSparkle({ store, textCompletion: completion }).improve({ content: "Hello world.", instruction: "Polish" });
  store.updateSettings({ noteImproveModel: "gpt-5.4-nano" });
  finish();
  const result = await pending;
  assert.equal(result.model, "gpt-6-sol");
  const row = store.listAllPadVersions().find(row => row.kind === "improve");
  assert.equal(row.model, "gpt-6-sol");
  assert.equal(row.cost_usd, 0.00264);
  assert.equal(store.getSettings().noteImproveModel, "gpt-5.4-nano");
});

test("queued dictation pieces keep the initial model instead of mixing models and prices", async () => {
  const store = createStore(":memory:");
  store.updateSettings({ noteImproveModel: "gpt-5.4-nano", dictationCleanupEnabled: true, dictationCleanupMode: "compact" });
  const seen = [], releases = [];
  const completion = createTextCompletion({ store, readKey: () => "test-key", fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); seen.push(body.model);
    if (seen.length <= 2) await new Promise(resolve => releases.push(resolve));
    const text = JSON.parse(body.messages[1].content.split("\n").slice(1).join("\n"));
    return response(JSON.stringify({ text: text.trim() }));
  } });
  const original = "A statement. ".repeat(1100).trim();
  const pending = createDictationCleanup({ store, completion }).clean(original);
  assert.equal(releases.length, 2);
  store.updateSettings({ noteImproveModel: "gpt-6-sol" });
  releases.forEach(release => release());
  const result = await pending;
  assert.equal(result.status, "cleaned");
  assert.ok(seen.length >= 3);
  assert.ok(seen.every(model => model === "gpt-5.4-nano"));
  assert.equal(result.model, "gpt-5.4-nano");
  assert.ok(store.listDictationUsage().every(row => row.model === "gpt-5.4-nano" && row.cost_usd === 0.000289));
});
