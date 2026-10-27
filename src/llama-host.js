"use strict";

const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");

function llamaRuntimeAvailable() {
  try {
    require.resolve("node-llama-cpp");
    return true;
  } catch (_error) {
    return false;
  }
}

function createLlamaHost(options) {
  const workerPath = options.workerPath;
  const idleMs = options.idleMs == null ? 120000 : options.idleMs;
  let worker = null;
  let idleTimer = null;
  let status = "idle";
  const pending = new Map();

  function failAll(message) {
    for (const item of pending.values()) item.reject(new Error(message));
    pending.clear();
  }

  function dropWorker() {
    worker = null;
    status = "idle";
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(workerPath, {
      env: { ...process.env, NODE_LLAMA_CPP_SKIP_DOWNLOAD: "true" },
    });
    worker.on("message", (message) => {
      if (!message) return;
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.type === "error") item.reject(new Error(message.message || "The local model failed."));
      else item.resolve(message.text || "");
    });
    worker.on("error", (error) => {
      failAll(error && error.message ? error.message : "The local model failed.");
      dropWorker();
      status = "error";
    });
    worker.on("exit", () => {
      if (pending.size) failAll("The local model stopped.");
      dropWorker();
    });
    return worker;
  }

  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      unload().catch(() => {});
    }, idleMs);
    if (idleTimer.unref) idleTimer.unref();
  }

  async function complete(payload) {
    if (!llamaRuntimeAvailable()) {
      throw new Error("The local model runtime is not installed.");
    }
    status = "ready";
    bumpIdle();
    const id = crypto.randomUUID();
    const child = ensureWorker();
    const result = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    const signal = payload && payload.signal;
    const onAbort = () => {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      const error = new Error("aborted");
      error.name = "AbortError";
      item.reject(error);
      if (worker) worker.terminate().catch(() => {});
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.postMessage({
      type: "complete",
      id,
      modelPath: payload.modelPath,
      contextSize: payload.contextSize,
      system: payload.system,
      user: payload.user,
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
      jsonSchema: payload.jsonSchema || null,
    });
    try {
      return await result;
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  async function unload() {
    clearTimeout(idleTimer);
    const current = worker;
    worker = null;
    status = "idle";
    if (current) await current.terminate();
  }

  function getStatus() {
    return status;
  }

  return { complete, unload, getStatus };
}

module.exports = { createLlamaHost, llamaRuntimeAvailable };
