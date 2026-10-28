"use strict";

const HOSTS = {
  groq: "api.groq.com",
  openai: "api.openai.com",
};

const DEFAULTS = {
  groq: {
    sttModel: "whisper-large-v3-turbo",
    ttsModel: "canopylabs/orpheus-v1-english",
    ttsVoice: "troy",
    textModel: "llama-3.3-70b-versatile",
    voices: ["troy", "hannah", "austin"],
  },
  openai: {
    sttModel: "gpt-transcribe",
    ttsModel: "gpt-4o-mini-tts",
    ttsVoice: "alloy",
    textModel: "gpt-4o-mini",
    voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"],
  },
};

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_SPEECH_CHARS = 4000;

function defaultsFor(provider) {
  if (!DEFAULTS[provider]) {
    throw new Error("Unknown provider. Allowed values are groq and openai.");
  }
  return DEFAULTS[provider];
}

function assertAllowedUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS is allowed.");
  if (!Object.values(HOSTS).includes(parsed.hostname)) {
    throw new Error("Unknown API host.");
  }
  return parsed;
}

function requireKey(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Missing API key. Please enter your API key in Settings.");
  return key;
}

function audioFile(audio, filename, mime) {
  const bytes = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
  if (bytes.length === 0) throw new Error("Recording is empty.");
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("Recording exceeds 25 MB.");
  const type = mime || "audio/webm";
  const name = filename || "recording.webm";
  return { bytes, type, name };
}

function transcriptionRequest({ provider, apiKey, audio, filename, mime, language, languages, model }) {
  const preset = defaultsFor(provider);
  const { bytes, type, name } = audioFile(audio, filename, mime);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  form.append("model", model || preset.sttModel);
  form.append("response_format", "json");
  if (provider === "openai") {
    const codes = Array.isArray(languages) ? languages.map((code) => String(code || "").trim()).filter(Boolean) : [];
    for (const code of codes) form.append("languages", code);
  } else if (language) {
    form.append("language", language);
  }
  const url = provider === "openai"
    ? "https://api.openai.com/v1/audio/transcriptions"
    : "https://api.groq.com/openai/v1/audio/transcriptions";
  assertAllowedUrl(url);
  return {
    url,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${requireKey(apiKey)}` },
      body: form,
    },
  };
}

function speechRequest({ provider, apiKey, text, voice, model, responseFormat }) {
  const preset = defaultsFor(provider);
  const input = String(text || "").trim();
  if (!input) throw new Error("No text to read aloud.");
  if (input.length > MAX_SPEECH_CHARS) {
    throw new Error(`Text exceeds ${MAX_SPEECH_CHARS} characters.`);
  }
  const url = provider === "openai"
    ? "https://api.openai.com/v1/audio/speech"
    : "https://api.groq.com/openai/v1/audio/speech";
  assertAllowedUrl(url);
  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireKey(apiKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || preset.ttsModel,
        voice: voice || preset.ttsVoice,
        input,
        response_format: responseFormat || (provider === "groq" ? "wav" : "mp3"),
      }),
    },
  };
}

function chatRequest({ provider, apiKey, model, system, user, temperature, responseFormat }) {
  const preset = defaultsFor(provider);
  const url = provider === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  assertAllowedUrl(url);
  const body = {
    model: model || preset.textModel,
    temperature: temperature == null ? 0.2 : temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (responseFormat) body.response_format = responseFormat;
  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireKey(apiKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

function translationRequest({ provider, apiKey, text, targetLanguage, model }) {
  const input = String(text || "").trim();
  if (!input) throw new Error("No text to translate.");
  const target = String(targetLanguage || "").trim() || "English";
  return chatRequest({
    provider,
    apiKey,
    model,
    system: "Translate the text into the requested language. Return only the translation, without quotes or explanations.",
    user: `Target language: ${target}\n\n${input}`,
  });
}

function rewriteRequest({ provider, apiKey, text, style, model }) {
  const input = String(text || "").trim();
  if (!input) throw new Error("No text to rewrite.");
  return chatRequest({
    provider,
    apiKey,
    model,
    system: "Rewrite the text in the requested style while preserving its meaning. Return only the rewritten text.",
    user: `Style: ${style || "clear and concise"}\n\n${input}`,
  });
}

function instructRequest({ provider, apiKey, prompt, context, model }) {
  const input = String(prompt || "").trim();
  if (!input) throw new Error("Missing instruction.");
  return chatRequest({
    provider,
    apiKey,
    model,
    system: "You help formulate and refine text. Respond directly without preamble.",
    user: context ? `Context:\n${context}\n\nInstruction:\n${input}` : input,
  });
}

function summaryRequest({ provider, apiKey, transcript, model }) {
  const input = String(transcript || "").trim();
  if (!input) throw new Error("Missing transcript.");
  return chatRequest({
    provider,
    apiKey,
    model,
    system: "Summarize the transcript in concise bullet points in English. Do not invent decisions.",
    user: input,
  });
}

function parseTranscription(body) {
  if (typeof body === "string") return body.trim();
  if (body && typeof body.text === "string") return body.text.trim();
  throw new Error("The API did not return transcript text.");
}

function detectedLanguage(body) {
  const list = body && Array.isArray(body.languages) ? body.languages : [];
  for (const entry of list) {
    const code = typeof entry === "string" ? entry : entry && entry.code;
    if (typeof code === "string" && /^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(code)) return code.toLowerCase();
  }
  return "";
}

function flattenChatContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part.text !== "string") return "";
    const type = part.type ? String(part.type) : "text";
    if (type !== "text" && type !== "output_text") return "";
    return part.text;
  }).join("");
}

function readChatUsage(body) {
  const usage = body && body.usage;
  if (!usage || typeof usage !== "object") return null;
  const prompt = usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens;
  const completion = usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens;
  if (prompt == null && completion == null) return null;
  const promptTokens = Math.max(0, Math.round(Number(prompt) || 0));
  const completionTokens = Math.max(0, Math.round(Number(completion) || 0));
  const details = usage.prompt_tokens_details || usage.input_tokens_details || {};
  const cached = details.cached_tokens != null ? details.cached_tokens : usage.cached_tokens;
  return {
    promptTokens,
    completionTokens,
    cachedTokens: Math.max(0, Math.min(promptTokens, Math.round(Number(cached) || 0))),
  };
}

function parseChatText(body) {
  const choice = body && body.choices && body.choices[0];
  const message = choice && choice.message;
  const text = flattenChatContent(message ? message.content : (choice && choice.text));
  if (!text.trim()) {
    throw new Error("The API did not return text.");
  }
  return text.trim();
}

async function errorMessage(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = (body && body.error && (body.error.message || body.error)) || "";
  } catch (_error) {
    detail = "";
  }
  const suffix = detail ? `: ${String(detail).slice(0, 280)}` : "";
  return `API ${response.status}${suffix}`;
}

async function postJson(fetchImpl, request) {
  assertAllowedUrl(request.url);
  const response = await fetchImpl(request.url, request.init);
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postTranscription(fetchImpl, buildRequest, options) {
  const attempts = options && options.attempts ? options.attempts : 3;
  const pause = options && options.wait ? options.wait : (attempt) => wait(600 * attempt);
  let last = new Error("Transcription failed.");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const request = buildRequest();
    assertAllowedUrl(request.url);
    let response;
    try {
      response = await fetchImpl(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(240000),
      });
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (attempt === attempts) break;
      await pause(attempt);
      continue;
    }
    if (response.ok) return response.json();
    last = new Error(await errorMessage(response));
    const retry = response.status === 429 || response.status >= 500;
    if (!retry || attempt === attempts) break;
    await pause(attempt);
  }
  throw last;
}

async function postAudio(fetchImpl, request) {
  assertAllowedUrl(request.url);
  const response = await fetchImpl(request.url, request.init);
  if (!response.ok) throw new Error(await errorMessage(response));
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "audio/wav";
  return { bytes, type };
}

module.exports = {
  DEFAULTS,
  HOSTS,
  MAX_AUDIO_BYTES,
  MAX_SPEECH_CHARS,
  defaultsFor,
  assertAllowedUrl,
  transcriptionRequest,
  speechRequest,
  chatRequest,
  translationRequest,
  rewriteRequest,
  instructRequest,
  summaryRequest,
  parseTranscription,
  detectedLanguage,
  parseChatText,
  readChatUsage,
  postJson,
  postTranscription,
  postAudio,
};
