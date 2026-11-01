"use strict";

const crypto = require("node:crypto");
const providers = require("./providers");

function createApiKeyStatus({ readKey, fetchImpl = fetch, onChange = () => {} }) {
  let fingerprint = "";
  let state = { state: "missing", message: "" };
  let pending = null;
  let pendingId = "";
  const identify = key => key ? crypto.createHash("sha256").update(key).digest("hex") : "";
  function publish(next) { state = next; onChange(); }
  function status() {
    if (identify(readKey()) !== fingerprint) return { state: readKey() ? "unchecked" : "missing", message: "" };
    return { ...state };
  }
  function ready() { return status().state === "valid"; }
  function reject(key, message = "The API key was rejected.") {
    if (identify(key) === fingerprint) publish({ state: "invalid", message });
  }
  async function validate(force = false) {
    const key = readKey();
    const id = identify(key);
    if (id === pendingId && pending) return pending;
    if (!force && id === fingerprint && state.state === "valid") return status();
    fingerprint = id;
    if (!key) { publish({ state: "missing", message: "" }); return status(); }
    publish({ state: "checking", message: "Checking API key…" });
    const work = (async () => {
      try {
        const request = providers.chatRequest({ provider: "openai", apiKey: key, model: "gpt-6-luna", system: "Return exactly OK.", user: "Key check." });
        const body = JSON.parse(request.init.body);
        delete body.temperature;
        Object.assign(body, { reasoning_effort: "none", max_completion_tokens: 16, store: false });
        const response = await fetchImpl(request.url, { ...request.init, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
        let next;
        if (response.ok && providers.parseChatText(await response.json()).trim()) next = { state: "valid", message: "API key verified." };
        else if ([401, 403].includes(response.status)) next = { state: "invalid", message: "API key rejected. Check the key and its permissions." };
        else if (response.status === 429) next = { state: "unavailable", message: "Key could not be verified. Check API credit or try again shortly." };
        else if (response.status === 404) next = { state: "invalid", message: "This key cannot access the improvement model." };
        else next = { state: "unavailable", message: "Key could not be verified. Please try again." };
        if (id === fingerprint && id === identify(readKey())) publish(next);
      } catch {
        if (id === fingerprint && id === identify(readKey())) publish({ state: "unavailable", message: "Could not reach OpenAI. Save the key again to retry." });
      }
      return status();
    })();
    pending = work;
    pendingId = id;
    try { return await work; } finally { if (pending === work) pending = null; }
  }
  return { status, ready, validate, reject };
}

module.exports = { createApiKeyStatus };
