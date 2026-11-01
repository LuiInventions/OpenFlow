"use strict";

const crypto = require("node:crypto");
const providers = require("./providers");
const { DEFAULT_OPENAI_MODEL } = require("./note-improve");

function createApiKeyStatus({ readKey, fetchImpl = fetch, onChange = () => {}, retryDelay = 400 }) {
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
      const request = providers.chatRequest({ provider: "openai", apiKey: key, model: DEFAULT_OPENAI_MODEL, system: "Return exactly OK.", user: "Key check." });
      const body = JSON.parse(request.init.body);
      delete body.temperature;
      Object.assign(body, { reasoning_effort: "none", max_completion_tokens: 16, store: false });
      const current = () => id === fingerprint && id === identify(readKey());
      async function probe() {
        let response;
        try {
          response = await fetchImpl(request.url, { ...request.init, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        } catch (error) {
          const code = String(error.cause?.code || error.code || "");
          const certificate = /CERT|TLS|SSL/.test(code) || /ERR_CERT/.test(String(error.message));
          const timeout = ["TimeoutError", "AbortError"].includes(error.name);
          return { state: "unavailable", retryable: !certificate, message: certificate
            ? "OpenAI's secure connection could not be verified. Check your system certificates or proxy, then retry."
            : timeout ? "OpenAI verification timed out. Retry with the saved key."
              : "Could not connect to OpenAI. Check your connection and retry with the saved key." };
        }
        if (response.ok) {
          try {
            if (providers.parseChatText(await response.json()).trim()) return { state: "valid", message: "" };
          } catch {}
          return { state: "unavailable", retryable: true, message: "OpenAI returned an incomplete verification response. Retry with the saved key." };
        }
        if ([401, 403].includes(response.status)) return { state: "invalid", message: "API key rejected. Check the key and its permissions." };
        if (response.status === 404) return { state: "invalid", message: "This key cannot access the improvement model." };
        if (response.status === 429) {
          let quota = false;
          try { quota = (await response.json()).error?.code === "insufficient_quota"; } catch {}
          return { state: "unavailable", retryable: !quota, message: quota
            ? "API credit is unavailable. Check billing, then retry with the saved key."
            : "OpenAI is rate limiting verification. Please retry shortly." };
        }
        return { state: "unavailable", retryable: response.status === 408 || response.status >= 500,
          message: "OpenAI could not verify the key right now. Retry with the saved key." };
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const next = await probe();
        if (!current()) break;
        if (next.retryable && attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          if (!current()) break;
          continue;
        }
        publish({ state: next.state, message: next.message });
        break;
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
