"use strict";

const { wordCount } = require("./flow");

async function commitDictation(deps, raw, prepared, meta) {
  const { store } = deps;
  store.touchDictionary(prepared.usedPhrases, "used");
  const cleaned = meta.paste ? await deps.cleanup.clean(prepared.text) : { text: prepared.text, status: "raw" };
  let text = cleaned.text;
  if (cleaned.status === "fallback") store.addNotification({
    title: "Improve Dictation", body: "Cleanup unavailable — the original dictation was kept.",
  });
  const history = store.addHistory({
    prepared_text: prepared.text, cleanup_mode: cleaned.cleanupMode || "raw", cleanup_run_id: cleaned.cleanupRunId || "", cleanup_prompt_version: cleaned.promptVersion || "",
    asr_text: raw, formatted_text: text, stt_engine: meta.sttEngine,
    cleanup_status: cleaned.status, cleanup_provider: cleaned.provider || "", cleanup_model: cleaned.model || "",
    language: meta.language || "", app_name: meta.appName || "", url: meta.url || "",
    duration_ms: meta.durationMs || 0, word_count: wordCount(text), status: "done",
  });
  for (const follow of prepared.followUps) {
    if (follow.type === "translate") {
      text = await deps.translateText(text, follow.language);
      store.updateHistory(history.id, { formatted_text: text, word_count: wordCount(text) });
    }
  }
  store.addNotification({ title: "Dictation saved", body: text.slice(0, 180) });
  if (meta.paste && text.trim()) await deps.pasteText(text, meta.targetHwnd);
  return { raw, text, history, prepared };
}

module.exports = { commitDictation };
