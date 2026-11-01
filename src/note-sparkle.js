"use strict";

const { createTextCompletion } = require("./text-completion");
const improve = require("./note-improve");
const flow = require("./flow");

const GENERIC_ERROR = "Improvement failed. Try again.";

function createNoteSparkle(deps) {
  const store = deps.store;
  const jobs = new Map();
  const completion = deps.textCompletion || createTextCompletion(deps);

  function settings() {
    return store.getSettings();
  }

  function providerName() {
    return completion.selection().provider;
  }

  function modelName() {
    return completion.selection().model;
  }

  function privacyBlocks() {
    return providerName() === "openai" && !settings().noteImprovePrivacyAck;
  }

  function usable() {
    return completion.usable();
  }

  function configured() {
    return Boolean(settings().noteImproveEnabled) && usable();
  }

  function blockedMessage() {
    return completion.blockedMessage();
  }

  function fail(code, message) {
    return { ok: false, code, message: message || GENERIC_ERROR };
  }

  function ensurePad(payload) {
    return store.savePad({
      id: payload.id || undefined,
      title: payload.title || "Note",
      content: payload.content == null ? "" : String(payload.content),
    });
  }

  function finishJob(id) {
    const job = jobs.get(id);
    if (job) job.done = true;
    jobs.delete(id);
  }

  function beginJob(id) {
    if (id && jobs.has(id)) return null;
    const ctrl = new AbortController();
    const key = id || `job-${Date.now()}`;
    jobs.set(key, { ctrl, done: false });
    return { key, ctrl };
  }

  function normalizeUsage(usage) {
    if (!usage || typeof usage !== "object") return null;
    const prompt = usage.promptTokens != null ? usage.promptTokens : usage.prompt_tokens;
    const completion = usage.completionTokens != null ? usage.completionTokens : usage.completion_tokens;
    if (prompt == null && completion == null) return null;
    const cached = usage.cachedTokens != null ? usage.cachedTokens : usage.cached_tokens;
    const promptTokens = Math.max(0, Math.round(Number(prompt) || 0));
    return {
      promptTokens,
      completionTokens: Math.max(0, Math.round(Number(completion) || 0)),
      cachedTokens: Math.max(0, Math.min(promptTokens, Math.round(Number(cached) || 0))),
    };
  }

  function asCompletion(result) {
    if (result && typeof result === "object" && typeof result.text === "string") {
      return { text: result.text, usage: normalizeUsage(result.usage) };
    }
    return { text: result == null ? "" : String(result), usage: null };
  }

  function mergeUsage(parts) {
    if (!parts.length || parts.some((part) => !part.usage)) return null;
    return {
      promptTokens: parts.reduce((sum, part) => sum + part.usage.promptTokens, 0),
      completionTokens: parts.reduce((sum, part) => sum + part.usage.completionTokens, 0),
      cachedTokens: parts.reduce((sum, part) => sum + part.usage.cachedTokens, 0),
    };
  }

  async function complete(args, config = completion.selection()) {
    if (deps.complete) return asCompletion(await deps.complete(args));
    return asCompletion(await completion.complete(args, config));
  }

  async function rewriteOne(content, instruction, signal, timeoutMs, config) {
    const linked = improve.linkAbort(signal, timeoutMs);
    try {
      return await complete({
        kind: "rewrite",
        system: improve.REWRITE_SYSTEM,
        user: improve.buildRewriteUser(instruction, content),
        temperature: improve.REWRITE_TEMPERATURE,
        signal: linked.signal,
      }, config);
    } finally {
      linked.clear();
    }
  }

  async function rewrite(content, instruction, signal, config) {
    const local = config.provider === "local";
    const timeoutMs = local ? improve.REWRITE_TIMEOUT_LOCAL_MS : improve.REWRITE_TIMEOUT_MS;
    if (!local) return rewriteOne(content, instruction, signal, timeoutMs, config);
    const plan = improve.planLocalPieces(content, improve.LOCAL_MAX_INPUT_CHARS);
    if (plan.mode === "too_long") {
      const error = new Error("This note is too long for the local model.");
      error.code = "too_long";
      throw error;
    }
    if (plan.mode === "full") return rewriteOne(content, instruction, signal, timeoutMs, config);
    const parts = [];
    for (const part of plan.parts) {
      parts.push(await rewriteOne(part, instruction, signal, timeoutMs, config));
    }
    return {
      text: parts.map((part) => improve.cleanModelOutput(part.text)).filter(Boolean).join("\n\n"),
      usage: mergeUsage(parts),
    };
  }

  function commit(pad, before, output, instruction, measured, config) {
    const snapshot = store.addPadVersion(pad.id, {
      content: before,
      label: "Before improvement",
      kind: "snapshot",
      instruction,
      provider: config.provider,
      model: config.model,
    });
    const saved = store.savePad({ id: pad.id, title: pad.title, content: output });
    const usage = measured || {};
    store.addPadVersion(pad.id, {
      content: output,
      label: `Improvement: ${instruction}`,
      kind: "improve",
      instruction,
      provider: config.provider,
      model: config.model,
      words: usage.words,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      cached_tokens: usage.cachedTokens,
      cost_usd: usage.costUsd,
      tokens_estimated: usage.tokensEstimated,
    });
    return { pad: saved, snapshotId: snapshot.id };
  }

  async function improveNote(payload) {
    const instruction = String(payload.instruction || "").trim();
    const content = String(payload.content || "");
    const words = improve.instructionState(instruction);
    if (words.empty) return fail("error");
    if (!settings().noteImproveEnabled) return fail("disabled", "Note improvement is off.");
    if (!usable()) return fail("unconfigured", blockedMessage());
    if (privacyBlocks()) {
      store.updateSettings({
        noteImproveOnboardingDone: true,
        noteImprovePrivacyAck: true,
      });
    }
    const pad = ensurePad(payload);
    const job = beginJob(pad.id);
    if (!job) return fail("busy");
    const config = completion.selection();
    try {
      const done = await rewrite(content, instruction, job.ctrl.signal, config);
      const verdict = improve.validateImproved(content, instruction, done.text);
      if (!verdict.ok && verdict.code !== "preview") return fail("error");
      const output = improve.asMarkdown(verdict.output || "");
      if (!output) return fail("error");
      const measured = flow.measureNoteChange({
        before: content,
        after: output,
        instruction,
        model: config.model,
        usage: done.usage,
      });
      const committed = commit(pad, content, output, instruction, measured, config);
      const result = {
        ok: true,
        id: committed.pad.id,
        content: output,
        snapshotId: committed.snapshotId,
        provider: config.provider,
        model: config.model,
      };
      Promise.resolve().then(() => refreshSuggestions(committed.pad.id, output)).catch(() => {});
      return result;
    } catch (error) {
      if (improve.isAbortError(error) || (job.ctrl.signal && job.ctrl.signal.aborted)) return { ok: false, code: "aborted" };
      if (error && error.code === "too_long") return fail("error", error.message);
      if (error && error.safeMessage) return fail("error", error.safeMessage);
      if (error && error.message && error.message.length < 180 && /model|key|runtime|openai/i.test(error.message)) {
        return fail("error", error.message);
      }
      return fail("error");
    } finally {
      finishJob(job.key);
    }
  }

  async function applyPreview(payload) {
    const config = completion.selection();
    const instruction = String(payload.instruction || "").trim();
    const before = String(payload.content || "");
    const output = improve.cleanModelOutput(payload.output || "");
    if (!output || !settings().noteImproveEnabled) return fail("error");
    const pad = ensurePad({ id: payload.id, title: payload.title, content: before });
    const measured = flow.measureNoteChange({
      before,
      after: output,
      instruction,
      model: config.model,
      usage: null,
    });
    const committed = commit(pad, before, output, instruction, measured, config);
    Promise.resolve().then(() => refreshSuggestions(committed.pad.id, output)).catch(() => {});
    return {
      ok: true,
      id: committed.pad.id,
      content: output,
      snapshotId: committed.snapshotId,
      provider: config.provider,
      model: config.model,
    };
  }

  function undo(payload) {
    const pad = store.getPad(payload.id);
    if (!pad) return fail("error");
    const versions = store.listPadVersions(pad.id);
    const snapshot = versions.find((row) => row.id === payload.snapshotId);
    if (!snapshot) return fail("error");
    const saved = store.savePad({ id: pad.id, title: pad.title, content: snapshot.content });
    return { ok: true, id: saved.id, content: saved.content };
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (job) job.ctrl.abort();
    return { ok: true };
  }

  function cached(payload) {
    const content = String(payload.content || "");
    const hash = improve.contentHash(content);
    const pad = payload.id ? store.getPad(payload.id) : null;
    const stored = pad && Array.isArray(pad.suggestions) ? pad.suggestions : [];
    const fresh = Boolean(pad && pad.suggestion_hash === hash && stored.length === 3);
    if (fresh) return { suggestions: stored.slice(), fresh: true, hash, fallback: false };
    if (stored.length === 3) return { suggestions: stored.slice(), fresh: false, hash, fallback: false };
    return { suggestions: improve.FALLBACK_SUGGESTIONS.slice(), fresh: false, hash, fallback: true };
  }

  async function refreshSuggestions(padId, content) {
    const hash = improve.contentHash(content);
    const idle = { suggestions: improve.FALLBACK_SUGGESTIONS.slice(), fresh: false, hash, fallback: true, id: padId || "" };
    if (padId && jobs.has(padId)) return { ...cached({ id: padId, content }), pending: true };
    if (improve.countWords(content) < improve.MIN_SUGGEST_WORDS) return idle;
    if (!configured() || privacyBlocks()) return idle;
    const job = beginJob(padId || `suggest-${Date.now()}`);
    if (!job) return { ...cached({ id: padId, content }), pending: true };
    const local = providerName() === "local";
    const config = completion.selection();
    const timeoutMs = local ? improve.SUGGEST_TIMEOUT_LOCAL_MS : improve.SUGGEST_TIMEOUT_MS;
    const linked = improve.linkAbort(job.ctrl.signal, timeoutMs);
    try {
      let source = content;
      if (local && source.length > improve.LOCAL_MAX_INPUT_CHARS) source = source.slice(0, improve.LOCAL_MAX_INPUT_CHARS);
      const raw = await complete({
        kind: "suggest",
        system: improve.SUGGEST_SYSTEM,
        user: improve.buildSuggestUser(source),
        temperature: improve.SUGGEST_TEMPERATURE,
        responseFormat: improve.suggestionResponseFormat(),
        jsonSchema: improve.SUGGESTION_SCHEMA,
        signal: linked.signal,
      }, config);
      const parsed = improve.parseSuggestions(raw.text);
      if (padId) store.setPadSuggestions(padId, hash, parsed.suggestions);
      return { suggestions: parsed.suggestions, fresh: true, hash, fallback: parsed.usedFallback, id: padId || "" };
    } catch (_error) {
      return idle;
    } finally {
      linked.clear();
      finishJob(job.key);
    }
  }

  async function suggest(payload) {
    const content = String(payload.content || "");
    let padId = payload.id || "";
    if (payload.save) padId = ensurePad(payload).id;
    const current = cached({ id: padId, content });
    if (padId && jobs.has(padId)) return { ...current, id: padId, pending: true };
    if (!payload.force && (current.fresh || payload.onlyCached)) return { ...current, id: padId };
    const next = await refreshSuggestions(padId, content);
    return { ...next, id: padId };
  }

  function versions(id) {
    const rows = store.listPadVersions(id);
    return rows.map((row, index) => {
      const older = rows[index + 1];
      const diff = older ? improve.wordDiff(older.content, row.content) : { tokens: [], truncated: false };
      return {
        id: row.id,
        label: row.label,
        kind: row.kind,
        instruction: row.instruction,
        created_at: row.created_at,
        content: row.content,
        diff,
      };
    });
  }

  return {
    improve: improveNote,
    applyPreview,
    undo,
    cancel,
    suggest,
    cached,
    versions,
    configured,
    providerName,
    modelName,
  };
}

module.exports = { createNoteSparkle, GENERIC_ERROR };
