"use strict";

const { parentPort } = require("node:worker_threads");

let llama = null;
let llamaModule = null;
let model = null;
let context = null;
let loadedPath = "";

function safeError(error) {
  const text = error && error.message ? String(error.message) : "The local model failed.";
  if (/cannot find module/i.test(text) && /node-llama-cpp/i.test(text)) {
    return "The local model runtime is not installed.";
  }
  if (text.length > 180) return "The local model failed.";
  return text;
}

async function library() {
  if (!llamaModule) llamaModule = await import("node-llama-cpp");
  if (!llama) {
    llama = await llamaModule.getLlama({
      gpu: false,
      build: "never",
      skipDownload: true,
      usePrebuiltBinaries: true,
      progressLogs: false,
    });
  }
  return llamaModule;
}

async function ensureModel(modelPath, contextSize) {
  const lib = await library();
  if (loadedPath !== modelPath) {
    if (context && context.dispose) await context.dispose();
    if (model && model.dispose) await model.dispose();
    context = null;
    model = await llama.loadModel({ modelPath });
    loadedPath = modelPath;
  }
  if (!context) context = await model.createContext({ contextSize: contextSize || 8192 });
  return lib;
}

async function complete(payload) {
  const lib = await ensureModel(payload.modelPath, payload.contextSize);
  const sequence = context.getSequence();
  try {
    const session = new lib.LlamaChatSession({
      contextSequence: sequence,
      systemPrompt: payload.system,
    });
    const options = {
      temperature: payload.temperature,
      maxTokens: payload.maxTokens || 2048,
    };
    if (payload.jsonSchema) {
      if (typeof llama.createGrammarForJsonSchema === "function") {
        options.grammar = await llama.createGrammarForJsonSchema(payload.jsonSchema);
      } else if (lib.LlamaJsonSchemaGrammar) {
        options.grammar = new lib.LlamaJsonSchemaGrammar(llama, payload.jsonSchema);
      }
      options.maxTokens = payload.maxTokens || 256;
    }
    const text = await session.prompt(payload.user, options);
    return String(text || "");
  } finally {
    if (sequence && sequence.dispose) await sequence.dispose();
  }
}

async function unload() {
  if (context && context.dispose) await context.dispose();
  if (model && model.dispose) await model.dispose();
  context = null;
  model = null;
  loadedPath = "";
}

parentPort.on("message", async (message) => {
  try {
    if (!message || message.type === "unload") {
      await unload();
      parentPort.postMessage({ type: "unloaded", id: message && message.id });
      return;
    }
    if (message.type === "complete") {
      const text = await complete(message);
      parentPort.postMessage({ type: "result", id: message.id, text });
    }
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      id: message && message.id,
      message: safeError(error),
    });
  }
});
