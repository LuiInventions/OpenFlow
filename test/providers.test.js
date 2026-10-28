"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const providers = require("../src/providers");

test("transcription request stays on the selected host and keeps the key out of the body", async () => {
  const request = providers.transcriptionRequest({
    provider: "groq",
    apiKey: "test-key",
    audio: Buffer.from("abc"),
    filename: "aufnahme.webm",
    mime: "audio/webm",
    language: "de",
  });
  assert.equal(request.url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(request.init.headers.Authorization, "Bearer test-key");
  const form = request.init.body;
  assert.equal(form.get("model"), "whisper-large-v3-turbo");
  assert.equal(form.get("language"), "de");
  assert.equal(JSON.stringify(form).includes("test-key"), false);
});

test("openai speech request uses the speech endpoint and a documented voice", async () => {
  const request = providers.speechRequest({
    provider: "openai",
    apiKey: "sk-test",
    text: "Guten Tag",
  });
  assert.equal(request.url, "https://api.openai.com/v1/audio/speech");
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.model, "gpt-4o-mini-tts");
  assert.equal(payload.voice, "alloy");
  assert.equal(payload.input, "Guten Tag");
});

test("translation request asks only for the translation", () => {
  const request = providers.translationRequest({
    provider: "groq",
    apiKey: "gsk-test",
    text: "Hallo",
    targetLanguage: "Englisch",
  });
  assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions");
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.model, "llama-3.3-70b-versatile");
  assert.match(payload.messages[1].content, /Englisch/);
  assert.match(payload.messages[1].content, /Hallo/);
});

test("empty audio, missing key, and foreign hosts fail closed", () => {
  assert.throws(() => providers.transcriptionRequest({
    provider: "groq",
    apiKey: "k",
    audio: Buffer.alloc(0),
  }), /empty/);
  assert.throws(() => providers.speechRequest({
    provider: "openai",
    apiKey: "  ",
    text: "Hello",
  }), /API key/);
  assert.throws(() => providers.assertAllowedUrl("http://api.openai.com/v1/audio/speech"), /HTTPS/);
  assert.throws(() => providers.assertAllowedUrl("https://example.com/v1/audio/speech"), /API host/);
});

test("parsers read transcript text and chat content", () => {
  assert.equal(providers.parseTranscription({ text: "  eins  " }), "eins");
  assert.equal(providers.parseTranscription({ text: "   " }), "");
  assert.equal(providers.parseChatText({ choices: [{ message: { content: "two" } }] }), "two");
  assert.equal(providers.parseChatText({ choices: [{ message: { content: [{ type: "text", text: "drei" }] } }] }), "drei");
  assert.equal(providers.parseChatText({ choices: [{ message: { content: [{ type: "reasoning", text: "geheim" }, { type: "output_text", text: "vier" }] } }] }), "vier");
  assert.equal(providers.readChatUsage({ usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } } }).promptTokens, 12);
  assert.equal(providers.readChatUsage({ usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } } }).cachedTokens, 4);
  assert.equal(providers.readChatUsage({ usage: { input_tokens: 2, output_tokens: 1 } }).completionTokens, 1);
  assert.equal(providers.readChatUsage({}), null);
  assert.throws(() => providers.parseTranscription({}), /transcript text/);
  assert.equal(providers.detectedLanguage({ languages: [{ code: "ja" }, { code: "en" }] }), "ja");
});

test("openai transcription detects language instead of forcing one", () => {
  const request = providers.transcriptionRequest({
    provider: "openai",
    apiKey: "sk-test",
    audio: Buffer.from("abc"),
    filename: "aufnahme.wav",
    mime: "audio/wav",
    language: "de",
    languages: ["de", "en", "fr"],
  });
  assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
  const form = request.init.body;
  assert.equal(form.get("model"), "gpt-transcribe");
  assert.equal(form.get("language"), null);
  assert.deepEqual(form.getAll("languages"), ["de", "en", "fr"]);
  const file = form.get("file");
  assert.equal(file.name, "aufnahme.wav");
  assert.equal(file.type, "audio/wav");
});

test("transcription retries a server failure and then reads the transcript", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 503, json: async () => ({ error: { message: "busy" } }) };
    }
    return { ok: true, status: 200, json: async () => ({ text: "Hallo", languages: [{ code: "de" }] }) };
  };
  const body = await providers.postTranscription(fetchImpl, () => providers.transcriptionRequest({
    provider: "openai",
    apiKey: "sk-test",
    audio: Buffer.from("abc"),
    filename: "aufnahme.wav",
    mime: "audio/wav",
  }), { wait: async () => {} });
  assert.equal(calls, 2);
  assert.equal(providers.parseTranscription(body), "Hallo");
});
