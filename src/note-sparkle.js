"use strict";

const providers = require("./providers");
const improve = require("./note-improve");

const GENERIC_ERROR = "Improvement failed. Try again.";

function createNoteSparkle(deps) {
  const store = deps.store;
  const jobs = new Map();

  function settings() {
    return store.getSettings();
  }

  function providerName() {
    return "openai";
  }

  function modelName() {
    return improve.normalizeOpenAIModel(settings().noteImproveModel);
  }

  function privacyBlocks() {
    return !settings().noteImprovePrivacyAck;
  }

  function usable() {
    return Boolean(deps.readKey && deps.readKey());
  }

  function configured() {
    return Boolean(settings().noteImproveEnabled) && usable();
  }

  function blockedMessage() {
    return "The OpenAI key is missing.";
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

  async function openAIErrorHint(response) {
    try {
      const source = typeof response.clone === "function" ? response.clone() : response;
      const body = await source.json();
      const message = String(body && body.error && body.error.message || "").toLowerCase();
      return {
        temperature: message.includes("temperature"),
        format: message.includes("response_format") || message.includes("json_schema"),
      };
    } catch (_error) {
      return { temperature: false, format: false };
    }
  }

  function openAIFailure(response) {
    const error = new Error(GENERIC_ERROR);
    if (response.status === 401 || response.status === 403) error.safeMessage = "The OpenAI key was rejected.";
    else if (response.status === 404) error.safeMessage = "This model is not available at OpenAI.";
    return error;
  }

  async function completeOpenAI({ kind, system, user, temperature, responseFormat, signal }) {
    const request = providers.chatRequest({
      provider: "openai",
      apiKey: deps.readKey(),
      model: modelName(),
      system,
      user,
      temperature,
      responseFormat,
    });
    const fetchImpl = deps.fetchImpl || fetch;
    let response = await fetchImpl(request.url, { ...request.init, signal });
    if (!response.ok && response.status === 400) {
      const hint = await openAIErrorHint(response);
      if (hint.temperature || hint.format) {
        const body = JSON.parse(request.init.body);
        if (hint.temperature) delete body.temperature;
        if (hint.format) delete body.response_format;
        response = await fetchImpl(request.url, {
          ...request.init,
          body: JSON.stringify(body),
          signal,
        });
      }
    }
    if (!response.ok) throw openAIFailure(response);
    const body = await response.json();
    return providers.parseChatText(body);
  }

  async function completeLocal({ kind, system, user, temperature, jsonSchema, signal }) {
    if (!deps.completeLocal) throw new Error("The local model runtime is not installed.");
    const model = improve.localModel(modelName());
    const row = deps.modelLibrary ? deps.modelLibrary.status(model.id) : null;
    if (!row || !row.path) throw new Error("The local model is not downloaded.");
    return deps.completeLocal({
      modelPath: row.path,
      contextSize: model.contextTokens,
      system,
      user,
      temperature,
      jsonSchema: jsonSchema || null,
      maxTokens: kind === "suggest" ? 256 : 2048,
      signal,
    });
  }

  async function complete(args) {
    if (deps.complete) return deps.complete(args);
    if (providerName() === "local") return completeLocal(args);
    return completeOpenAI(args);
  }

  async function rewriteOne(content, instruction, signal, timeoutMs) {
    const linked = improve.linkAbort(signal, timeoutMs);
    try {
      return await complete({
        kind: "rewrite",
        system: improve.REWRITE_SYSTEM,
        user: improve.buildRewriteUser(instruction, content),
        temperature: improve.REWRITE_TEMPERATURE,
        signal: linked.signal,
      });
    } finally {
      linked.clear();
    }
  }

  async function rewrite(content, instruction, signal) {
    const local = providerName() === "local";
    const timeoutMs = local ? improve.REWRITE_TIMEOUT_LOCAL_MS : improve.REWRITE_TIMEOUT_MS;
    if (!local) return rewriteOne(content, instruction, signal, timeoutMs);
    const plan = improve.planLocalPieces(content, improve.LOCAL_MAX_INPUT_CHARS);
    if (plan.mode === "too_long") {
      const error = new Error("This note is too long for the local model.");
      error.code = "too_long";
      throw error;
    }
    if (plan.mode === "full") return rewriteOne(content, instruction, signal, timeoutMs);
    const parts = [];
    for (const part of plan.parts) {
      parts.push(await rewriteOne(part, instruction, signal, timeoutMs));
    }
    return parts.map((part) => improve.cleanModelOutput(part)).filter(Boolean).join("\n\n");
  }

  function commit(pad, before, output, instruction) {
    const snapshot = store.addPadVersion(pad.id, {
      content: before,
      label: "Before improvement",
      kind: "snapshot",
      instruction,
      provider: providerName(),
      model: modelName(),
    });
    const saved = store.savePad({ id: pad.id, title: pad.title, content: output });
    store.addPadVersion(pad.id, {
      content: output,
      label: `Improvement: ${instruction}`,
      kind: "improve",
      instruction,
      provider: providerName(),
      model: modelName(),
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
    try {
      const raw = await rewrite(content, instruction, job.ctrl.signal);
      const verdict = improve.validateImproved(content, instruction, raw);
      if (!verdict.ok && verdict.code !== "preview") return fail("error");
      const output = improve.asMarkdown(verdict.output || "");
      if (!output) return fail("error");
      const committed = commit(pad, content, output, instruction);
      const result = {
        ok: true,
        id: committed.pad.id,
        content: output,
        snapshotId: committed.snapshotId,
        provider: providerName(),
        model: modelName(),
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
    const instruction = String(payload.instruction || "").trim();
    const before = String(payload.content || "");
    const output = improve.cleanModelOutput(payload.output || "");
    if (!output || !settings().noteImproveEnabled) return fail("error");
    const pad = ensurePad({ id: payload.id, title: payload.title, content: before });
    const committed = commit(pad, before, output, instruction);
    Promise.resolve().then(() => refreshSuggestions(committed.pad.id, output)).catch(() => {});
    return {
      ok: true,
      id: committed.pad.id,
      content: output,
      snapshotId: committed.snapshotId,
      provider: providerName(),
      model: modelName(),
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
      });
      const parsed = improve.parseSuggestions(raw);
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
    if (current.fresh || payload.onlyCached || (padId && jobs.has(padId))) return { ...current, id: padId };
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
