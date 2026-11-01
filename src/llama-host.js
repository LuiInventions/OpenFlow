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
  let queue = Promise.resolve();

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
    const child = new Worker(workerPath, {
      env: { ...process.env, NODE_LLAMA_CPP_SKIP_DOWNLOAD: "true" },
    });
    worker = child;
    child.on("message", (message) => {
      if (!message) return;
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.type === "error") item.reject(new Error(message.message || "The local model failed."));
      else item.resolve(message.text || "");
    });
    child.on("error", (error) => {
      if (worker !== child) return;
      failAll(error && error.message ? error.message : "The local model failed.");
      dropWorker();
      status = "error";
    });
    child.on("exit", () => {
      if (worker !== child) return;
      if (pending.size) failAll("The local model stopped.");
      dropWorker();
    });
    return worker;
  }

  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (pending.size) { bumpIdle(); return; }
      unload().catch(() => {});
    }, idleMs);
    if (idleTimer.unref) idleTimer.unref();
  }

  async function runCompletion(payload) {
    if (payload.signal && payload.signal.aborted) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
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
      if (worker === child) {
        worker = null;
        status = "idle";
        child.terminate().catch(() => {});
      }
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
      bumpIdle();
    }
  }

  function complete(payload) {
    const run = queue.then(() => runCompletion(payload));
    queue = run.catch(() => {});
    return run;
  }

  async function unload() {
    clearTimeout(idleTimer);
    const current = worker;
    worker = null;
    status = "idle";
    if (pending.size) failAll("The local model stopped.");
    if (current) await current.terminate();
  }

  function getStatus() {
    return status;
  }

  return { complete, unload, getStatus };
}

module.exports = { createLlamaHost, llamaRuntimeAvailable };
