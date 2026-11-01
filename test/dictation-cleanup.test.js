"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../src/store");
const { createTextCompletion } = require("../src/text-completion");
const { createDictationCleanup, COMPACT_SYSTEM, parseCleaned, pieces } = require("../src/dictation-cleanup");
const { commitDictation } = require("../src/dictation");
const { createLlamaHost } = require("../src/llama-host");

function enabledStore() {
  const store = createStore(":memory:");
  store.updateSettings({ dictationCleanupEnabled: true, dictationCleanupMode: "compact" });
  return store;
}

test("disabled and raw modes perform no model request; disabling clears selection across reload", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openflow-cleanup-"));
  try {
    const file = path.join(dir, "data.json");
    const store = createStore(file);
    const cleanup = createDictationCleanup({ store, completion: { selection() { throw new Error("Must not contact model"); } } });
    assert.equal((await cleanup.clean("Ähm, hallo.")).text, "Ähm, hallo.");
    store.updateSettings({ dictationCleanupEnabled: true });
    assert.equal((await cleanup.clean("Ähm, hallo.")).status, "raw");
    store.updateSettings({ dictationCleanupMode: "compact" });
    store.updateSettings({ dictationCleanupEnabled: false });
    assert.equal(store.getSettings().dictationCleanupMode, "raw");
    const reloaded = createStore(file);
    reloaded.updateSettings({ dictationCleanupEnabled: true });
    assert.equal(reloaded.getSettings().dictationCleanupMode, "raw");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("compact defaults to GPT-5.4 nano and uses the exact compact system prompt", async () => {
  const store = enabledStore();
  store.updateSettings({ noteImproveProvider: "openai", noteImproveModel: "gpt-4.1-mini" });
  let calls = 0;
  const completion = createTextCompletion({ store, readKey: () => "test-key", fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-5.4-nano");
    assert.equal(body.messages[0].content, COMPACT_SYSTEM);
    assert.match(body.messages[1].content, /^Dictation content \(keep its language and literal details; do not translate\):\n/);
    assert.equal(body.response_format.json_schema.name, "dictation_cleanup");
    assert.match(body.messages[1].content, /Ähm/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"text":"Wir treffen uns um 14:30 Uhr."}' } }] }) };
  } });
  const result = await createDictationCleanup({ store, completion }).clean("Ähm, wir treffen uns um 14:30 Uhr.");
  assert.equal(result.text, "Wir treffen uns um 14:30 Uhr.");
  assert.equal(result.status, "cleaned");
  assert.equal(calls, 1);
});

test("legacy local settings cannot enable local cleanup or bypass the API key", async () => {
  const store = enabledStore();
  store.updateSettings({ noteImproveProvider: "local", noteImproveModel: "gpt-4.1-mini" });
  const completion = createTextCompletion({
    store, readKey: () => "",
    modelLibrary: { status() { throw new Error("Must not inspect local models"); } },
    completeLocal() { throw new Error("Must not use local inference"); },
    fetchImpl() { throw new Error("Must not call OpenAI without a key"); },
  });
  assert.deepEqual(completion.selection(), { provider: "openai", model: "gpt-5.4-nano" });
  assert.equal(completion.usable(), false);
  const result = await createDictationCleanup({ store, completion }).clean("Ähm, bitte nicht absagen.");
  assert.equal(result.status, "fallback");
  assert.equal(result.text, "Ähm, bitte nicht absagen.");
});

test("missing model, failed requests and invalid results preserve the original dictation", async () => {
  for (const value of [new Error("offline"), "invalid json", '{"text":""}', '{"text":"Bestätigt."}', '{"text":"Bitte absagen um 16 Uhr."}']) {
    const store = enabledStore();
    const completion = { selection: () => ({ provider: "openai", model: "test" }), complete: async () => {
      if (value instanceof Error) throw value;
      return { text: value };
    } };
    const original = "Ähm, bitte nicht absagen um 14 Uhr.";
    const result = await createDictationCleanup({ store, completion }).clean(original);
    assert.equal(result.text, original);
    assert.equal(result.status, "fallback");
  }
  const store = enabledStore();
  store.updateSettings({ noteImproveProvider: "local" });
  const completion = createTextCompletion({ store, modelLibrary: { status: () => null }, llamaRuntimeAvailable: () => true });
  assert.equal((await createDictationCleanup({ store, completion }).clean("Ähm, Hallo.")).status, "fallback");
});

test("turning off or cancelling pending cleanup discards a late model response", async () => {
  for (const cancel of [false, true]) {
    const store = enabledStore();
    let finish;
    const completion = { selection: () => ({ provider: "openai" }), complete: () => new Promise(resolve => { finish = resolve; }) };
    const cleanup = createDictationCleanup({ store, completion });
    const pending = cleanup.clean("Ähm, Hallo.");
    if (cancel) cleanup.cancel();
    else store.updateSettings({ dictationCleanupEnabled: false });
    finish({ text: '{"text":"Hallo."}' });
    assert.deepEqual(await pending, { text: "Ähm, Hallo.", status: "raw" });
  }
});

test("a noise-only dictation can become empty; meaningful content, links and numbers are protected", () => {
  assert.equal(parseCleaned("Ähm, äh.", '{"text":""}'), "");
  assert.throws(() => parseCleaned("Bitte nicht absagen.", '{"text":"Bitte absagen."}'));
  assert.throws(() => parseCleaned("Link https://example.com um 14 Uhr", '{"text":"Link um 15 Uhr"}'));
  assert.equal(parseCleaned("Vielleicht morgen.", '{"text":"Vielleicht morgen."}'), "Vielleicht morgen.");
});

test("long dictations keep ordered fragments and never split a long URL", async () => {
  const original = "Erster Satz. ".repeat(650) + "Ende.";
  assert.equal(pieces(original).join(""), original);
  assert.equal(pieces("https://example.com/" + "a".repeat(6500)).length, 1);
  const store = enabledStore();
  let calls = 0;
  const completion = { selection: () => ({ provider: "local" }), complete: async request => {
    calls++;
    const input = JSON.parse(request.user.slice(request.user.indexOf("\n") + 1));
    return { text: JSON.stringify({ text: input.trim() }) };
  } };
  const result = await createDictationCleanup({ store, completion }).clean(original);
  assert.equal(result.status, "cleaned");
  assert.equal(result.text, original);
  assert.ok(calls > 1);
});

test("dictation commit waits for cleanup, pastes exactly once to its original target and retains raw history", async () => {
  const store = enabledStore();
  let finish;
  const pasted = [];
  const original = "Ähm, hallo.";
  const pending = commitDictation({ store, cleanup: { clean: () => new Promise(resolve => { finish = resolve; }) }, pasteText: async (...args) => pasted.push(args) }, original,
    { text: original, usedPhrases: [], followUps: [] }, { paste: true, targetHwnd: 123, sttEngine: "parakeet" });
  assert.equal(pasted.length, 0);
  finish({ text: "Hallo.", status: "cleaned", provider: "local", model: "qwen" });
  await pending;
  assert.deepEqual(pasted, [["Hallo.", 123]]);
  const row = store.listHistory()[0];
  assert.equal(row.asr_text, original);
  assert.equal(row.formatted_text, "Hallo.");
  assert.equal(row.cleanup_status, "cleaned");
  assert.equal(row.cleanup_provider, "local");
});

test("failed cleanup pastes the original once; empty noise does not paste", async () => {
  for (const result of [{ text: "Ähm, hallo.", status: "fallback" }, { text: "", status: "cleaned" }]) {
    const store = enabledStore();
    const pasted = [];
    await commitDictation({ store, cleanup: { clean: async () => result }, pasteText: async text => pasted.push(text) }, "Ähm, hallo.",
      { text: "Ähm, hallo.", usedPhrases: [], followUps: [] }, { paste: true, sttEngine: "parakeet" });
    assert.deepEqual(pasted, result.text ? [result.text] : []);
    assert.equal(store.listHistory().length, 1);
  }
});

test("shared local runtime serializes notes and cleanup and survives cancellation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openflow-worker-"));
  const workerPath = path.join(dir, "worker.cjs");
  fs.writeFileSync(workerPath, `
    const {parentPort}=require('node:worker_threads');
    let busy=false;
    parentPort.on('message', m=>{
      if(busy) { parentPort.postMessage({type:'error',id:m.id,message:'overlapping inference'}); return; }
      busy=true;
      setTimeout(()=>{busy=false;parentPort.postMessage({type:'result',id:m.id,text:m.user})},m.user==='slow'?1000:30);
    });
  `);
  const host = createLlamaHost({ workerPath, idleMs: 1000 });
  try {
    assert.deepEqual(await Promise.all([host.complete({ user: "note" }), host.complete({ user: "cleanup" })]), ["note", "cleanup"]);
    const controller = new AbortController();
    const cancelled = host.complete({ user: "slow", signal: controller.signal });
    const rejected = assert.rejects(cancelled, { name: "AbortError" });
    await new Promise(resolve => setTimeout(resolve, 30));
    controller.abort();
    const next = host.complete({ user: "after cancellation" });
    await rejected;
    assert.equal(await next, "after cancellation");
  } finally {
    await host.unload();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("polish has a separate prompt, uses one request, retains details and records its mode", async () => {
  const { POLISH_SYSTEM, PROMPT_VERSION } = require('../src/dictation-cleanup');
  const store = enabledStore();store.updateSettings({dictationCleanupMode:'polished'});
  let calls=0;
  const completion={selection:()=>({provider:'openai',model:'gpt-6-luna'}),complete:async request=>{
    calls++;assert.equal(request.system,POLISH_SYSTEM);
    assert.match(request.user,/^Diktat \(nur Inhalt\):\n/);
    return {text:JSON.stringify({text:'Der Termin bleibt am Freitag um 14 Uhr. Bitte nicht absagen.'})};
  }};
  const result=await createDictationCleanup({store,completion}).clean('Ähm, ich ich wollte dir sagen, der Termin bleibt am Freitag um 14 Uhr und bitte nicht absagen.');
  assert.equal(result.status,'cleaned');assert.equal(result.cleanupMode,'polished');assert.equal(result.promptVersion,PROMPT_VERSION);assert.equal(calls,1);
  assert.equal(store.getSettings().dictationCleanupMode,'polished');
  store.updateSettings({dictationCleanupEnabled:false});assert.equal(store.getSettings().dictationCleanupMode,'raw');
});

test("switching between cleanup levels discards a late response",async()=>{
  const store=enabledStore();let finish;
  const completion={selection:()=>({provider:'openai'}),complete:()=>new Promise(r=>finish=r)};
  const pending=createDictationCleanup({store,completion}).clean('Ähm, Hallo.');
  store.updateSettings({dictationCleanupMode:'polished'});finish({text:'{"text":"Hallo."}'});
  assert.deepEqual(await pending,{text:'Ähm, Hallo.',status:'raw'});
});

test("long cleanup overlaps at most two pieces, preserves order and paragraph separators",async()=>{
  const store=enabledStore();store.updateSettings({dictationCleanupMode:'polished'});
  const original=('Erster Satz. '.repeat(420)+'\n\n')+('Zweiter Satz. '.repeat(420)+'\n\n')+'Letzter Satz.';
  let concurrent=0,peak=0,calls=0;
  const completion={selection:()=>({provider:'openai'}),complete:async request=>{
    calls++;concurrent++;peak=Math.max(peak,concurrent);
    const text=JSON.parse(request.user.slice(request.user.indexOf('\n')+1));
    await new Promise(r=>setTimeout(r,text.includes('Erster')?25:5));concurrent--;
    return {text:JSON.stringify({text:text.trim()})};
  }};
  const result=await createDictationCleanup({store,completion}).clean(original);
  assert.equal(result.status,'cleaned');assert.equal(peak,2);assert.ok(calls>1);assert.equal(result.text,original);
});

test("both cleanup levels protect uncertainty, negations, facts and literal code",()=>{
  for(const mode of ['compact','polished']){
    assert.throws(()=>parseCleaned('Maybe send 14 euros.',JSON.stringify({text:'Send 14 euros.'}),mode));
    assert.throws(()=>parseCleaned('Please run `git status` now.',JSON.stringify({text:'Please run `git reset` now.'}),mode));
    assert.throws(()=>parseCleaned('Bitte nicht absagen um 14 Uhr.',JSON.stringify({text:'Bitte absagen um 14 Uhr.'}),mode));
    assert.equal(parseCleaned('Maybe send 14 euros.',JSON.stringify({text:'Maybe send 14 euros.'}),mode),'Maybe send 14 euros.');
  }
});

test("long leading whitespace cannot stall cleanup splitting",()=>{
  const input=' '.repeat(7000)+'Hello.';
  assert.equal(pieces(input).join(''),input);
  assert.ok(pieces(input).every(part=>part.length>0));
});

test("compact prompt matches the supplied artifact and Polish keeps its exact prompt and version", () => {
  const { POLISH_SYSTEM, PROMPT_VERSION, CLEANUP_MODES, active } = require('../src/dictation-cleanup');
  assert.equal(COMPACT_SYSTEM, fs.readFileSync(path.join(__dirname, '../docs/dictation-compact-system-prompt.txt'), 'utf8').replace(/\r\n/g, '\n').trim());
  assert.equal(POLISH_SYSTEM, fs.readFileSync(path.join(__dirname, '../docs/dictation-polish-system-prompt.txt'), 'utf8').replace(/\r\n/g, '\n').trim());
  assert.equal(PROMPT_VERSION, '2026-11-01.2');
  assert.equal(require('../src/dictation-cleanup').COMPACT_PROMPT_VERSION, '2026-11-01.5');
  assert.deepEqual(CLEANUP_MODES, ['compact', 'polished']);
  assert.equal(active({dictationCleanupEnabled:true, dictationCleanupMode:'fillers'}), false);
});

test("compact accepts strong meaning-preserving compression without a fixed ratio and records its prompt version", async () => {
  const { COMPACT_PROMPT_VERSION } = require('../src/dictation-cleanup');
  const original = 'I just wanted to say, basically, you know, please send the report to Alice tomorrow. '.repeat(12).trim();
  const text = 'Send report to Alice tomorrow.';
  assert.ok(text.length < original.length * 0.1);
  const store = enabledStore();
  let calls = 0;
  const completion = { selection: () => ({provider:'openai', model:'gpt-6-luna'}), complete: async request => {
    calls++;
    assert.equal(request.system, COMPACT_SYSTEM);
    return {text:JSON.stringify({text})};
  }};
  const result = await createDictationCleanup({store, completion}).clean(original);
  assert.equal(result.status, 'cleaned');
  assert.equal(result.text, text);
  assert.equal(result.cleanupMode, 'compact');
  assert.equal(result.promptVersion, COMPACT_PROMPT_VERSION);
  assert.equal(store.listDictationUsage()[0].mode, 'compact');
  assert.equal(calls, 1);
  assert.throws(() => parseCleaned(original, JSON.stringify({text}), 'polished'));
});

test("compact requires exactly one JSON string field and preserves quotes, code, URLs, emails and numbers", () => {
  for (const response of ['{"text":"Hello.","extra":true}', '{"text":null}', '```json\n{"text":"Hello."}\n```', '[]', '{"text":""}']) {
    assert.throws(() => parseCleaned('Hello.', response, 'compact'));
  }
  const original = 'Um, send 14 euros to ada@example.com via https://example.com/pay. Keep `git status` and "do not delete".';
  const kept = original.replace('Um, send', 'Send');
  assert.equal(parseCleaned(original, JSON.stringify({text:kept})), kept);
  for (const [before, after] of [['14','15'], ['ada@example.com','bob@example.com'], ['https://example.com/pay','https://example.com'], ['git status','git reset'], ['do not delete','do not remove']]) {
    assert.throws(() => parseCleaned(original, JSON.stringify({text:kept.replace(before, after)})));
  }
  for (const text of ['Hello.', 'Hallo.', 'Bonjour.', 'Maybe tomorrow.']) {
    assert.equal(parseCleaned(text, JSON.stringify({text})), text);
  }
});

test("changing from Polish to Compact discards the pending Polish response", async () => {
  const store = enabledStore();
  store.updateSettings({dictationCleanupMode:'polished'});
  let finish;
  const completion = {selection:()=>({provider:'openai'}), complete:()=>new Promise(resolve=>{finish=resolve})};
  const pending = createDictationCleanup({store,completion}).clean('Ähm, Hallo.');
  store.updateSettings({dictationCleanupMode:'compact'});
  finish({text:'{"text":"Hallo."}'});
  assert.deepEqual(await pending, {text:'Ähm, Hallo.', status:'raw'});
});

test("compact accepts terse fixture results without falling back to the padded original", async () => {
  for (const sample of require('./fixtures/compact-dictation.json')) {
    const store = enabledStore();
    const completion = {selection:()=>({provider:'openai',model:'gpt-6-luna'}), complete:async()=>({text:JSON.stringify({text:sample.expected})})};
    const pasted = [];
    const result = await commitDictation({store,cleanup:createDictationCleanup({store,completion}),pasteText:async text=>pasted.push(text)},sample.input,
      {text:sample.input,usedPhrases:[],followUps:[]},{paste:true,sttEngine:'parakeet'});
    assert.equal(result.history.cleanup_status,'cleaned',sample.id);
    assert.equal(result.text,sample.expected,sample.id);
    assert.deepEqual(pasted,sample.expected?[sample.expected]:[],sample.id);
    assert.equal(result.history.asr_text,sample.input,sample.id);
  }
});
