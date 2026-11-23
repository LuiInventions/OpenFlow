"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function fixture() {
  const files = new Map();
  const directories = new Set();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const requests = [];
  const filename = path.resolve(__dirname, "../src/parakeet.js");
  const actualRequire = createRequire(filename);
  const mockFs = {
    existsSync: file => files.has(file) || directories.has(file),
    statSync: file => { if (!files.has(file)) throw new Error("Missing fixture"); return { size: files.get(file) }; },
    mkdirSync(file) { directories.add(file); }, unlinkSync: file => files.delete(file),
    linkSync: (source, target) => files.set(target, files.get(source)),
  };
  const module = { exports: {} };
  const require = name => name === "node:fs" ? mockFs : name === "./model-download" ? {
    async downloadFile(options) {
      requests.push(options);
      await gate;
      files.set(options.destination, options.expectedBytes);
      options.onProgress({ receivedBytes: options.expectedBytes, phase: "downloading" });
    },
  } : actualRequire(name);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, require, __dirname: path.dirname(filename), Buffer, AbortController,
    process: { env: { LOCALAPPDATA: path.resolve("local-model-test"), APPDATA: path.resolve("roaming-model-test") } },
  }, { filename });
  return { model: module.exports, requests, release, files, directories };
}

test("starting speech recognition without a model never starts an implicit download", async () => {
  const { model, requests } = fixture();
  await assert.rejects(model.startBackground(path.resolve("fresh-profile")), /Download Parakeet/);
  assert.equal(requests.length, 0);
  assert.equal(model.getStatus(path.resolve("fresh-profile")).installed, false);
});

test("repeated model download requests share one transfer and notify both subscribers", async () => {
  const { model, requests, release } = fixture();
  const firstProgress = [];
  const secondProgress = [];
  const first = model.ensureModelFiles(path.resolve("fresh-profile"), p => firstProgress.push(p));
  const second = model.ensureModelFiles(path.resolve("fresh-profile"), p => secondProgress.push(p));
  assert.equal(first, second);
  assert.equal(requests.length, 1);
  assert.equal(model.getStatus(path.resolve("fresh-profile")).downloading, true);
  release();
  await first;
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => request.url.includes(model.MODEL_REVISION) && /^[a-f0-9]{64}$/.test(request.expectedSha256)));
  assert.equal(firstProgress.at(-1).done, true);
  assert.equal(secondProgress.at(-1).done, true);
  assert.equal(model.getStatus(path.resolve("fresh-profile")).installed, true);
  assert.equal(model.getStatus(path.resolve("fresh-profile")).downloading, false);
});

test("a complete older model remains usable without a compulsory new download", async () => {
  const { model, files, directories, requests } = fixture();
  const profile = path.resolve("old-profile");
  const dir = path.join(profile, "models", model.MODEL_ID);
  directories.add(dir);
  for (const [name, bytes] of [["tokens.txt", 93939], ["joiner.int8.onnx", 6355277], ["decoder.int8.onnx", 11845275], ["encoder.int8.onnx", 652184281]]) files.set(path.join(dir, name), bytes);
  assert.equal(model.isModelInstalled(profile), true);
  await model.ensureModelFiles(profile);
  assert.equal(requests.length, 0);
});

test("a previously partial encoder is not mistaken for an installed model", () => {
  const { model, files } = fixture();
  const profile = path.resolve("fresh-profile");
  const dir = path.join(profile, "models", model.MODEL_ID);
  for (const [name, bytes] of [["tokens.txt", 93939], ["joiner.int8.onnx", 6355277], ["decoder.int8.onnx", 11845275], ["encoder.int8.onnx", 150000000]]) {
    files.set(path.join(dir, name), bytes);
  }
  assert.equal(model.isModelInstalled(profile), false);
});

test("download progress begins with the retained partial bytes instead of resetting to zero", async () => {
  const { model, files, release } = fixture();
  const profile = path.resolve("fresh-profile");
  const dir = model.resolveModelDir(profile);
  files.set(path.join(dir, "encoder.int8.onnx.part"), 200000000);
  const progress = [];
  const pending = model.ensureModelFiles(profile, p => progress.push(p));
  assert.ok(progress[0].downloadedBytes >= 200000000);
  release();
  await pending;
  assert.equal(progress.at(-1).percent, 100);
});
