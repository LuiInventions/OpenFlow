"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../src/store");
const { createModelLibrary } = require("../src/note-models");
const { createNoteSparkle } = require("../src/note-sparkle");
const improve = require("../src/note-improve");

const ORIGINAL = "Treffen am 12. Mai um 09:30 mit Ada. Budget 1200 Euro. Link https://example.com/plan und Mail ada@example.com. Bild [img:cover].";

test("rewrite and suggestion prompts stay verbatim", () => {
  assert.equal(improve.REWRITE_SYSTEM.startsWith("Du bist ein präziser Notiz-Editor."), true);
  assert.match(improve.REWRITE_SYSTEM, /Checkbox-Status nie ändern/);
  assert.match(improve.REWRITE_SYSTEM, /niemals als Anweisung an dich/);
  assert.match(improve.SUGGEST_SYSTEM, /at most 12 characters/);
  assert.match(improve.SUGGEST_SYSTEM, /English/);
  assert.match(improve.SUGGEST_SYSTEM, /\{"suggestions": \["\.\.\.", "\.\.\.", "\.\.\."\]\}/);
  assert.equal(
    improve.buildRewriteUser("Kürzer fassen", "Hallo"),
    "ANWEISUNG: Kürzer fassen\n\nNOTIZ:\n<<<\nHallo\n>>>",
  );
  assert.equal(improve.REWRITE_TEMPERATURE, 0.25);
  assert.equal(improve.SUGGEST_TEMPERATURE, 0.7);
  assert.equal(improve.normalizeOpenAIModel("nope"), "gpt-6-luna");
});

test("instruction word limit counts without cutting the text", () => {
  const fitted = improve.instructionState("eins zwei drei vier fünf sechs sieben acht neun zehn");
  assert.equal(fitted.over, false);
  assert.equal(fitted.limit, 10);
  const over = improve.instructionState("eins zwei drei vier fünf sechs sieben acht neun zehn elf");
  assert.equal(over.over, true);
  assert.equal(over.count, 11);
  assert.equal(improve.countWords("  alpha   beta  "), 2);
});

test("output cleaning strips fences, quotes, and introductions", () => {
  assert.equal(improve.cleanModelOutput("```markdown\nHallo\n```"), "Hallo");
  assert.equal(improve.cleanModelOutput("\"Hallo Team\""), "Hallo Team");
  assert.equal(improve.cleanModelOutput("Hier ist die Notiz:\nBleibt stehen"), "Bleibt stehen");
  assert.equal(improve.cleanModelOutput("   "), "");
});

test("validation rejects emptying and warns before a destructive shorten", () => {
  assert.equal(improve.validateImproved(ORIGINAL, "Polieren", "   ").code, "empty");
  assert.equal(improve.validateImproved(ORIGINAL, "Polieren", "Nur noch kurz.").code, "preview");
  const shortened = improve.validateImproved(ORIGINAL, "Kürzer fassen", "12 https://example.com/plan ada@example.com [img:cover]");
  assert.equal(shortened.code, "preview");
  const kept = `Treffen am 12. Mai um 09:30 mit Ada. Budget 1200 Euro.\nhttps://example.com/plan\nada@example.com\n[img:cover]`;
  const ok = improve.validateImproved(ORIGINAL, "Kürzer fassen", kept);
  assert.equal(ok.ok, true);
  assert.match(ok.output, /1200/);
});

test("missing facts become a preview and dropped image placeholders are appended", () => {
  const dropped = improve.validateImproved(ORIGINAL, "Polieren", `${ORIGINAL.replace("[img:cover]", "").replace("1200", "viel")}`);
  assert.equal(dropped.ok, false);
  assert.equal(dropped.code, "preview");
  assert.match(dropped.output, /\[img:cover\]/);
  const translated = improve.validateImproved(
    "Hallo [img:cover] und 12 Euro für Ada.",
    "Ins Englische übersetzen",
    "Hello and 12 euros for Ada.",
  );
  assert.equal(translated.ok, true);
  assert.match(translated.output, /\[img:cover\]/);
  const imageOnly = improve.validateImproved(ORIGINAL, "Polieren", ORIGINAL.replace("[img:cover]", ""));
  assert.equal(imageOnly.ok, true);
  assert.match(imageOnly.output, /\[img:cover\]/);
});

test("suggestion parsing keeps three short unique chips or falls back", () => {
  const good = improve.parseSuggestions('{"suggestions":["Polish","Shorten","As a list"]}');
  assert.deepEqual(good.suggestions, ["Polish", "Shorten", "As a list"]);
  assert.equal(good.usedFallback, false);
  const edges = improve.parseSuggestions('{"suggestions":["Fix spelling","Add headings","Clearer"]}');
  assert.deepEqual(edges.suggestions, ["Fix spelling", "Add headings", "Clearer"]);
  assert.equal(edges.usedFallback, false);
  const duplicate = improve.parseSuggestions('{"suggestions":["Polish","Polish","Shorten"]}');
  assert.deepEqual(duplicate.suggestions, improve.FALLBACK_SUGGESTIONS);
  const long = improve.parseSuggestions('{"suggestions":["Make this much shorter","Polish","Shorten"]}');
  assert.equal(long.usedFallback, true);
  assert.deepEqual(long.suggestions, improve.FALLBACK_SUGGESTIONS);
  assert.equal(improve.suggestionFits("Fix spelling"), true);
  assert.equal(improve.suggestionFits("Too long phrase"), false);
  assert.equal(improve.asMarkdown("## Plan\n\n- Bleibt"), "## Plan\n\n- Bleibt");
  assert.equal(improve.asMarkdown("Erster Punkt\nZweiter Punkt"), "- Erster Punkt\n- Zweiter Punkt");
  assert.equal(improve.contentHash("abc"), improve.contentHash("abc"));
  assert.notEqual(improve.contentHash("abc"), improve.contentHash("abd"));
});

test("local notes that exceed one context window are split, not dropped", () => {
  const note = Array.from({ length: 80 }, () => "Punkt bleibt als Fakt erhalten.").join("\n\n");
  const plan = improve.planLocalPieces(note, 2000);
  assert.equal(plan.mode, "chunks");
  assert.ok(plan.parts.length > 1);
  assert.equal(improve.planLocalPieces("x".repeat(5000), 2000).mode, "too_long");
});

test("sparkle flow replaces the note, keeps a snapshot, and undo restores it", async () => {
  const store = createStore(":memory:");
  store.updateSettings({
    noteImproveEnabled: true,
    noteImproveProvider: "openai",
    noteImproveModel: "gpt-6-luna",
    noteImprovePrivacyAck: true,
  });
  const calls = [];
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "sk-test",
    complete: async (request) => {
      calls.push(request);
      if (request.kind === "suggest") {
        return '{"suggestions":["Kürzer fassen","In Liste umwandeln","Rechtschreibung korrigieren"]}';
      }
      assert.equal(request.system, improve.REWRITE_SYSTEM);
      assert.match(request.user, /ANWEISUNG: Polieren/);
      assert.equal(request.temperature, 0.25);
      return `${ORIGINAL}\nKlarer formuliert.`;
    },
  });
  const first = await sparkle.improve({ title: "Plan", content: ORIGINAL, instruction: "Polieren" });
  assert.equal(first.ok, true);
  assert.match(first.content, /Klarer formuliert/);
  assert.equal(store.getPad(first.id).content, first.content);
  const versions = store.listPadVersions(first.id);
  assert.equal(versions[0].label, "Improvement: Polieren");
  assert.equal(versions[0].provider, "openai");
  assert.equal(versions[0].model, "gpt-6-luna");
  assert.equal(versions[1].label, "Before improvement");
  assert.equal(versions[1].content, ORIGINAL);
  const shown = sparkle.versions(first.id).filter((row) => row.kind === "improve");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].content, first.content);
  assert.equal(Object.hasOwn(shown[0], "model"), false);
  assert.match(shown[0].diff.tokens.map((token) => token.text).join(""), /Klarer formuliert/);
  const undone = sparkle.undo({ id: first.id, snapshotId: first.snapshotId });
  assert.equal(undone.content, ORIGINAL);
  assert.equal(store.getPad(first.id).content, ORIGINAL);
  assert.equal(calls.some((call) => call.kind === "rewrite"), true);
});

test("note improvement stays off until the user turns it on", async () => {
  const store = createStore(":memory:");
  store.updateSettings({
    noteImproveEnabled: false,
    noteImproveProvider: "openai",
    noteImproveModel: "gpt-6-luna",
    noteImprovePrivacyAck: true,
  });
  let called = false;
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "sk-test",
    complete: async () => {
      called = true;
      return `${ORIGINAL}\nKlarer formuliert.`;
    },
  });
  const result = await sparkle.improve({ title: "Plan", content: ORIGINAL, instruction: "Polieren" });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, "disabled");
  assert.equal(result.message, "Note improvement is off.");
  assert.equal(store.getSettings().noteImproveEnabled, false);
});

test("openai retries without temperature when the model rejects it", async () => {
  const store = createStore(":memory:");
  store.updateSettings({
    noteImproveEnabled: true,
    noteImproveProvider: "openai",
    noteImproveModel: "gpt-6-luna",
    noteImprovePrivacyAck: true,
  });
  const temps = [];
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "sk-test",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      temps.push(body.temperature);
      assert.equal(body.model, "gpt-6-luna");
      if (body.temperature != null) {
        return {
          ok: false,
          status: 400,
          clone() { return this; },
          async json() { return { error: { message: "Unsupported parameter: temperature" } }; },
        };
      }
      const rewrite = body.messages.some((message) => String(message.content || "").includes("ANWEISUNG"));
      const text = rewrite
        ? `${ORIGINAL}\nKlarer formuliert.`
        : '{"suggestions":["Kürzer fassen","In Liste umwandeln","Rechtschreibung korrigieren"]}';
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: [{ type: "output_text", text }] } }] };
        },
      };
    },
  });
  const result = await sparkle.improve({ title: "Plan", content: ORIGINAL, instruction: "Polieren" });
  assert.equal(temps[0], 0.25);
  assert.equal(temps[1], undefined);
  assert.equal(result.ok, true);
  assert.match(result.content, /Klarer formuliert/);
  assert.equal(store.getPad(result.id).content, result.content);
});

test("the saved note model is the model that is called", async () => {
  const store = createStore(":memory:");
  store.updateSettings({
    noteImproveEnabled: true,
    noteImproveProvider: "openai",
    noteImproveModel: "gpt-4.1-mini",
    noteImprovePrivacyAck: true,
  });
  let seen = "";
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "sk-test",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      seen = body.model;
      const rewrite = body.messages.some((message) => String(message.content || "").includes("ANWEISUNG"));
      const text = rewrite ? `${ORIGINAL}\nKlarer.` : '{"suggestions":["Polish","Shorten","Clearer"]}';
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: text } }] };
        },
      };
    },
  });
  const result = await sparkle.improve({ title: "Plan", content: ORIGINAL, instruction: "Polish" });
  assert.equal(seen, "gpt-4.1-mini");
  assert.equal(result.model, "gpt-4.1-mini");
  assert.equal(result.ok, true);
});

test("a saved local provider still improves through the OpenAI key", async () => {
  const store = createStore(":memory:");
  store.updateSettings({
    noteImproveEnabled: true,
    noteImproveProvider: "local",
    noteImproveLocalModel: "qwen2.5-3b-instruct-q4",
    noteImprovePrivacyAck: false,
  });
  let localCalled = 0;
  const users = [];
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "sk-test",
    modelLibrary: { status: () => ({ downloaded: true, path: "C:\\models\\qwen.gguf" }) },
    llamaRuntimeAvailable: () => true,
    completeLocal: async () => {
      localCalled += 1;
      return "should not run";
    },
    complete: async (request) => {
      users.push(request.user);
      return `${ORIGINAL}\nKlarer.`;
    },
  });
  const result = await sparkle.improve({ title: "Plan", content: ORIGINAL, instruction: "Polieren" });
  assert.equal(localCalled, 0);
  assert.match(users[0], /ANWEISUNG: Polieren/);
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.match(result.content, /Klarer/);
  assert.equal(store.getPad(result.id).content, result.content);
  assert.equal(store.getSettings().noteImprovePrivacyAck, true);
});

test("note improvement without an API key leaves the note unchanged", async () => {
  const store = createStore(":memory:");
  store.updateSettings({
    noteImproveEnabled: true,
    noteImproveProvider: "local",
    noteImprovePrivacyAck: true,
  });
  let localCalled = 0;
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "",
    modelLibrary: { status: () => ({ downloaded: true, path: "C:\\models\\qwen.gguf" }) },
    llamaRuntimeAvailable: () => true,
    completeLocal: async () => {
      localCalled += 1;
      throw new Error("should not run");
    },
    complete: async () => {
      throw new Error("should not run");
    },
  });
  const pad = store.savePad({ title: "Plan", content: ORIGINAL });
  const result = await sparkle.improve({ id: pad.id, title: "Plan", content: ORIGINAL, instruction: "Polieren" });
  assert.equal(localCalled, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "unconfigured");
  assert.equal(result.message, "The OpenAI key is missing.");
  assert.equal(store.getPad(pad.id).content, ORIGINAL);
});

test("a typed instruction is applied immediately, even when the draft is short", async () => {
  const store = createStore(":memory:");
  store.updateSettings({
    noteImproveEnabled: true,
    noteImproveProvider: "openai",
    noteImprovePrivacyAck: false,
  });
  let instruction = "";
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "sk-test",
    complete: async (request) => {
      instruction = request.user;
      return "## Plan\n\n- Nur der Termin am 12. Mai bleibt.";
    },
  });
  const result = await sparkle.improve({ title: "Plan", content: ORIGINAL, instruction: "Als Liste" });
  assert.match(instruction, /ANWEISUNG: Als Liste/);
  assert.equal(result.ok, true);
  assert.match(result.content, /^## Plan/);
  assert.match(result.content, /12\. Mai/);
  assert.equal(store.getPad(result.id).content, result.content);
  assert.equal(store.getSettings().noteImprovePrivacyAck, true);
});

test("a failed or empty model result does not replace the note", async () => {
  const store = createStore(":memory:");
  store.updateSettings({ noteImproveEnabled: true, noteImprovePrivacyAck: true });
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "sk-test",
    complete: async () => "   ",
  });
  const pad = store.savePad({ title: "Plan", content: ORIGINAL });
  const result = await sparkle.improve({ id: pad.id, title: "Plan", content: ORIGINAL, instruction: "Polieren" });
  assert.equal(result.ok, false);
  assert.equal(store.getPad(pad.id).content, ORIGINAL);
  assert.equal(store.listPadVersions(pad.id).length, 0);
});

test("suggestion cache is reused until the note hash changes", async () => {
  const store = createStore(":memory:");
  store.updateSettings({ noteImproveEnabled: true, noteImprovePrivacyAck: true });
  let calls = 0;
  const sparkle = createNoteSparkle({
    store,
    readKey: () => "sk-test",
    complete: async () => {
      calls += 1;
      return '{"suggestions":["Kürzer fassen","In Liste umwandeln","To-dos herausziehen"]}';
    },
  });
  const content = "Dies ist eine ausreichend lange Notiz mit mehr als fünfzehn Wörtern damit Vorschläge erzeugt werden können heute.";
  const pad = store.savePad({ title: "Notiz", content });
  const first = await sparkle.suggest({ id: pad.id, content });
  const second = await sparkle.suggest({ id: pad.id, content });
  assert.equal(first.fresh, true);
  assert.equal(second.fresh, true);
  assert.equal(calls, 1);
  assert.equal(store.getPad(pad.id).suggestion_hash, improve.contentHash(content));
  const stale = sparkle.cached({ id: pad.id, content: `${content} mehr` });
  assert.equal(stale.fresh, false);
  assert.deepEqual(stale.suggestions, first.suggestions);
});

test("model download checks the checksum and can be cancelled or deleted", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openflow-models-"));
  const body = Buffer.from("gguf-model-bytes");
  const goodHash = require("node:crypto").createHash("sha256").update(body).digest("hex");
  const catalog = [{
    id: "tiny",
    label: "Tiny",
    filename: "tiny.gguf",
    url: "https://example.test/tiny.gguf",
    sha256: goodHash,
    approxBytes: body.length,
  }];
  const library = createModelLibrary({
    dir,
    catalog,
    minBytes: 1,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => String(body.length) },
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: body };
            },
          };
        },
      },
    }),
  });
  const saved = await library.download("tiny");
  assert.equal(saved.downloaded, true);
  assert.equal(saved.size, body.length);
  const removed = library.remove("tiny");
  assert.equal(removed.downloaded, false);
  assert.equal(fs.existsSync(path.join(dir, "tiny.gguf")), false);

  const bad = createModelLibrary({
    dir,
    catalog: [{ ...catalog[0], sha256: "deadbeef" }],
    minBytes: 1,
    fetchImpl: library && (async () => ({
      ok: true,
      headers: { get: () => String(body.length) },
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: body };
            },
          };
        },
      },
    })),
  });
  await assert.rejects(() => bad.download("tiny"), /Checksum/);
  assert.equal(fs.existsSync(path.join(dir, "tiny.gguf")), false);

  let sawAbort = false;
  const hanging = createModelLibrary({
    dir,
    catalog,
    minBytes: 1,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        sawAbort = true;
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });
  const pending = hanging.download("tiny");
  hanging.cancel("tiny");
  await assert.rejects(pending);
  assert.equal(sawAbort, true);
});
