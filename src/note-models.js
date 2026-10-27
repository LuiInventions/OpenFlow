"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { LOCAL_MODELS } = require("./note-improve");

function createModelLibrary(options) {
  const dir = options.dir;
  const fetchImpl = options.fetchImpl || fetch;
  const catalog = options.catalog || LOCAL_MODELS;
  const minBytes = options.minBytes == null ? 1000000 : options.minBytes;
  const jobs = new Map();
  const progress = new Map();

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  function modelFile(model) {
    return path.join(dir, model.filename);
  }

  function sidecar(file) {
    return `${file}.sha256`;
  }

  function readSidecar(file) {
    const side = sidecar(file);
    if (!fs.existsSync(side)) return "";
    return fs.readFileSync(side, "utf8").trim().toLowerCase();
  }

  function fileState(model) {
    const file = modelFile(model);
    if (!fs.existsSync(file)) return { downloaded: false, size: 0, file, checksum: "" };
    const size = fs.statSync(file).size;
    const checksum = readSidecar(file);
    const expected = String(model.sha256 || "").toLowerCase();
    const checksumOk = expected ? checksum === expected : Boolean(checksum) || size >= minBytes;
    return {
      downloaded: size > 0 && checksumOk,
      size,
      file,
      checksum,
    };
  }

  function statusList() {
    ensureDir();
    return catalog.map((model) => {
      const state = fileState(model);
      return {
        id: model.id,
        label: model.label,
        filename: model.filename,
        approxBytes: model.approxBytes || 0,
        sha256: model.sha256 || "",
        downloaded: state.downloaded,
        size: state.size,
        path: state.downloaded ? state.file : "",
        progress: progress.get(model.id) || null,
      };
    });
  }

  function status(id) {
    return statusList().find((model) => model.id === id) || null;
  }

  function disk() {
    ensureDir();
    try {
      const stats = fs.statfsSync(dir);
      return { freeBytes: Number(stats.bavail) * Number(stats.bsize) };
    } catch (_error) {
      return { freeBytes: null };
    }
  }

  async function download(id, hooks) {
    const model = catalog.find((item) => item.id === id);
    if (!model) throw new Error("Unknown model.");
    if (jobs.has(id)) return status(id);
    ensureDir();
    const ctrl = new AbortController();
    const external = hooks && hooks.signal;
    if (external) {
      if (external.aborted) ctrl.abort();
      else external.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    const onProgress = hooks && hooks.onProgress;
    jobs.set(id, ctrl);
    const file = modelFile(model);
    const partial = `${file}.part`;
    const started = Date.now();
    try {
      const response = await fetchImpl(model.url, { signal: ctrl.signal, redirect: "follow" });
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const total = Number(response.headers.get("content-length")) || model.approxBytes || 0;
      const hash = crypto.createHash("sha256");
      const stream = fs.createWriteStream(partial);
      let received = 0;
      const reader = response.body.getReader();
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        const chunk = Buffer.from(step.value);
        hash.update(chunk);
        received += chunk.length;
        if (!stream.write(chunk)) await once(stream, "drain");
        const seconds = Math.max((Date.now() - started) / 1000, 0.001);
        const snapshot = {
          id,
          received,
          total,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
          bps: received / seconds,
        };
        progress.set(id, snapshot);
        if (onProgress) onProgress(snapshot);
      }
      stream.end();
      await once(stream, "finish");
      const digest = hash.digest("hex");
      const expected = String(model.sha256 || "").toLowerCase();
      if (expected && digest !== expected) {
        fs.rmSync(partial, { force: true });
        throw new Error("Checksum does not match.");
      }
      if (received < minBytes) {
        fs.rmSync(partial, { force: true });
        throw new Error("Download is incomplete.");
      }
      fs.renameSync(partial, file);
      fs.writeFileSync(sidecar(file), `${digest}\n`);
      progress.delete(id);
      const done = { id, received, total: received, percent: 100, bps: 0, done: true };
      if (onProgress) onProgress(done);
      return status(id);
    } catch (error) {
      fs.rmSync(partial, { force: true });
      progress.delete(id);
      if (ctrl.signal.aborted) {
        const aborted = new Error("aborted");
        aborted.name = "AbortError";
        throw aborted;
      }
      throw error;
    } finally {
      jobs.delete(id);
    }
  }

  function cancel(id) {
    const ctrl = jobs.get(id);
    if (ctrl) ctrl.abort();
    progress.delete(id);
    return status(id);
  }

  function remove(id) {
    const model = catalog.find((item) => item.id === id);
    if (!model) throw new Error("Unknown model.");
    cancel(id);
    const file = modelFile(model);
    fs.rmSync(file, { force: true });
    fs.rmSync(sidecar(file), { force: true });
    fs.rmSync(`${file}.part`, { force: true });
    return status(id);
  }

  return { statusList, status, disk, download, cancel, remove, dir };
}

module.exports = { createModelLibrary };
