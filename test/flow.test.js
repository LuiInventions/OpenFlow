"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const flow = require("../src/flow");

const library = {
  corrections: [{ source_text: "flow", corrected_text: "OpenFlow" }],
  dictionary: [
    { phrase: "OpenFlow", replacement: "Open Flow", is_snippet: false },
    { phrase: "adresse", replacement: "Musterweg 1, 10115 Berlin", is_snippet: true },
  ],
  automations: [
    { name: "Signatur", enabled: true, trigger_phrase: "signatur", action: "prefix", action_value: "Viele Grüße." },
    { name: "Englisch", enabled: true, trigger_phrase: "übersetze", action: "translate", action_value: "Englisch" },
  ],
};

test("prepareTranscript applies corrections, dictionary, snippets, and automations", () => {
  const prepared = flow.prepareTranscript("bitte übersetze flow und setze die signatur", library);
  assert.match(prepared.text, /Open Flow/);
  assert.match(prepared.text, /Viele Grüße/);
  assert.deepEqual(prepared.followUps, [{ type: "translate", language: "Englisch" }]);
  assert.ok(prepared.wordCount > 0);
});

test("a snippet replaces the whole utterance", () => {
  const prepared = flow.prepareTranscript("adresse", library);
  assert.equal(prepared.text, "Musterweg 1, 10115 Berlin");
  assert.equal(prepared.snippet, "adresse");
});

test("stats count local history only", () => {
  const stats = flow.computeStats([
    { formatted_text: "eins zwei", word_count: 2, duration_ms: 1000, archived: false, app_name: "Editor", language: "de" },
    { formatted_text: "drei", word_count: 1, duration_ms: 500, archived: true, app_name: "Editor", language: "en" },
  ]);
  assert.equal(stats.dictations, 2);
  assert.equal(stats.archived, 1);
  assert.equal(stats.words, 3);
  assert.equal(stats.durationMs, 1500);
  assert.equal(stats.byApp.Editor, 2);
});

test("usageReport sums the last 30 local days from history", () => {
  const now = new Date(2026, 9, 22, 15, 0, 0);
  const report = flow.usageReport([
    { created_at: new Date(2026, 9, 22, 9, 0, 0).toISOString(), word_count: 10, duration_ms: 60000, formatted_text: "hallo welt", stt_engine: "openai" },
    { created_at: new Date(2026, 9, 22, 10, 0, 0).toISOString(), word_count: 50, duration_ms: 120000, formatted_text: "lokal", stt_engine: "parakeet" },
    { created_at: new Date(2026, 8, 23, 12, 0, 0).toISOString(), word_count: 2, duration_ms: 30000 },
    { created_at: new Date(2026, 8, 22, 12, 0, 0).toISOString(), word_count: 99, duration_ms: 999999 },
    { created_at: "kein-datum", word_count: 5, duration_ms: 1000 },
  ], now);
  assert.equal(report.days.length, 30);
  assert.equal(report.from, "2026-09-23");
  assert.equal(report.to, "2026-10-22");
  assert.equal(report.words, 12);
  assert.equal(report.durationMs, 90000);
  assert.equal(report.dictations, 2);
  assert.equal(report.costUsd, 0.00675);
  assert.equal(report.model, "gpt-transcribe");
  assert.equal(report.pricePerMinute, flow.TRANSCRIBE_USD_PER_MINUTE);
  assert.equal(report.days[0].words, 2);
  assert.equal(report.days[29].words, 10);
  assert.equal(report.days[29].costUsd, 0.0045);
  const local = flow.localUsageReport([
    { created_at: new Date(2026, 9, 22, 9, 0, 0).toISOString(), word_count: 10, duration_ms: 60000, formatted_text: "hallo welt", stt_engine: "openai" },
    { created_at: new Date(2026, 9, 22, 10, 0, 0).toISOString(), word_count: 50, duration_ms: 120000, formatted_text: "lokal eins zwei", stt_engine: "parakeet" },
    { created_at: new Date(2026, 8, 23, 12, 0, 0).toISOString(), word_count: 2, duration_ms: 30000 },
    { created_at: new Date(2026, 8, 22, 12, 0, 0).toISOString(), word_count: 8, duration_ms: 10000, stt_engine: "parakeet" },
  ], now);
  assert.equal(local.days.length, 30);
  assert.equal(local.model, "parakeet");
  assert.equal(local.pricePerMinute, 0);
  assert.equal(local.words, 50);
  assert.equal(local.durationMs, 120000);
  assert.equal(local.dictations, 1);
  assert.equal(local.costUsd, 0);
  assert.equal(local.days[29].words, 50);
  assert.equal(local.days[0].words, 0);
});

test("noteImproveUsageReport prices saved note changes over 30 local days", () => {
  const now = new Date(2026, 9, 28, 12, 0, 0);
  const priced = flow.noteImproveCost("gpt-6-luna", 1000, 500, 0);
  assert.equal(priced, 0.00035);
  assert.equal(flow.noteImproveCost("gpt-6-luna", 1000, 500, 800), 0.000278);
  assert.equal(flow.noteImproveCost("gpt-6-luna", 272001, 0, 0), 0.0544);
  assert.equal(flow.noteImproveCost("gpt-4.1-mini", 100, 50, 0), 0.00012);
  assert.equal(flow.noteImproveCost("gpt-4o-mini", 1e6, 0, 1e6), 0.075);

  const before = "one two three four";
  const estimated = flow.measureNoteChange({
    before,
    after: "one two three four five",
    instruction: "Polish",
    model: "gpt-6-luna",
    usage: null,
  });
  assert.equal(estimated.words, 4);
  assert.equal(estimated.tokensEstimated, true);
  assert.equal(estimated.promptTokens, flow.estimateTokens(require("../src/note-improve").REWRITE_SYSTEM) + flow.estimateTokens(require("../src/note-improve").buildRewriteUser("Polish", before)));
  assert.equal(estimated.completionTokens, flow.estimateTokens("one two three four five"));

  const metered = flow.measureNoteChange({
    before,
    after: "done",
    instruction: "Polish",
    model: "gpt-4.1-mini",
    usage: { promptTokens: 100, completionTokens: 50, cachedTokens: 0 },
  });
  assert.equal(metered.tokensEstimated, false);
  assert.equal(metered.tokens, 150);
  assert.equal(metered.costUsd, 0.00012);

  const report = flow.noteImproveUsageReport([
    { pad_id: "a", seq: 1, kind: "snapshot", content: before, created_at: new Date(2026, 9, 28, 9).toISOString() },
    { pad_id: "a", seq: 2, kind: "improve", content: "one two three four five", instruction: "Polish", model: "gpt-6-luna", created_at: new Date(2026, 9, 28, 9).toISOString(), words: 4, prompt_tokens: 1000, completion_tokens: 500, cached_tokens: 0, cost_usd: 0.00035, tokens_estimated: false },
    { pad_id: "b", seq: 3, kind: "snapshot", content: "older note", created_at: new Date(2026, 8, 28, 9).toISOString() },
    { pad_id: "b", seq: 4, kind: "improve", content: "older note rewritten", instruction: "Polish", model: "gpt-6-luna", created_at: new Date(2026, 8, 28, 9).toISOString() },
    { pad_id: "c", seq: 5, kind: "improve", content: "no date", instruction: "Polish", created_at: "kein-datum" },
  ], now);
  assert.equal(report.days.length, 30);
  assert.equal(report.from, "2026-09-29");
  assert.equal(report.to, "2026-10-28");
  assert.equal(report.changes, 1);
  assert.equal(report.words, 4);
  assert.equal(report.tokens, 1500);
  assert.equal(report.costUsd, 0.00035);
  assert.equal(report.estimated, false);
  assert.equal(report.days[29].changes, 1);
  assert.equal(report.days[0].changes, 0);
});

test("tour lists every desk section", () => {
  const ids = flow.tourSteps().map((step) => step.id);
  for (const id of ["dictate", "history", "dictionary", "snippets", "notes", "meetings", "calendar", "todos", "folders", "polish", "translate", "instruct", "scratchpad", "corrections", "links", "automations", "stats", "style", "notifications", "settings"]) {
    assert.ok(ids.includes(id), id);
  }
});
