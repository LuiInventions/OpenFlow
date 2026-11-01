"use strict";

const providers = require("./providers");

function createTextCompletion(deps) {
  function selection() {
    return { provider: "openai", model: "gpt-6-luna" };
  }

  function usable() {
    return Boolean(deps.readKey && deps.readKey()) && (!deps.keyReady || deps.keyReady());
  }

  function blockedMessage() {
    return deps.readKey && deps.readKey() ? "A working OpenAI API key must be verified in Settings." : "The OpenAI key is missing.";
  }

  async function complete(request) {
    const config = selection();
    if (!usable(config)) throw new Error(blockedMessage(config));
    const apiKey = deps.readKey();
    const apiRequest = providers.chatRequest({
      provider: "openai", apiKey, model: config.model,
      system: request.system, user: request.user, temperature: request.temperature,
      responseFormat: request.responseFormat,
    });
    // Preserve Luna's default reasoning quality and avoid the rejected
    // temperature request/retry that otherwise adds a full network round trip.
    const requestBody = JSON.parse(apiRequest.init.body);
    delete requestBody.temperature;
    requestBody.reasoning_effort = "medium";
    requestBody.store = false;
    apiRequest.init.body = JSON.stringify(requestBody);
    const fetchImpl = deps.fetchImpl || fetch;
    let response = await fetchImpl(apiRequest.url, { ...apiRequest.init, signal: request.signal });
    if (!response.ok && response.status === 400) {
      let message = "";
      try { message = String((await response.json()).error?.message || "").toLowerCase(); } catch {}
      if (message.includes("temperature") || message.includes("response_format") || message.includes("json_schema")) {
        const body = JSON.parse(apiRequest.init.body);
        if (message.includes("temperature")) delete body.temperature;
        if (message.includes("response_format") || message.includes("json_schema")) delete body.response_format;
        response = await fetchImpl(apiRequest.url, { ...apiRequest.init, body: JSON.stringify(body), signal: request.signal });
      }
    }
    if (!response.ok) {
      const error = new Error("Improvement failed. Try again.");
      if (response.status === 401 || response.status === 403) error.safeMessage = "The OpenAI key was rejected.";
      if (response.status === 404) error.safeMessage = "This model is not available at OpenAI.";
      if (response.status === 429) {
        try {
          const details = await response.json();
          if (details.error?.code === "insufficient_quota" && deps.rejectKey) deps.rejectKey(apiKey, "API credit is unavailable. Check billing and verify the key again.");
        } catch {}
      }
      if ([401, 403, 404].includes(response.status) && deps.rejectKey) deps.rejectKey(apiKey, error.safeMessage);
      throw error;
    }
    const body = await response.json();
    return { text: providers.parseChatText(body), usage: providers.readChatUsage(body) };
  }

  return { selection, usable, blockedMessage, complete };
}

module.exports = { createTextCompletion };
