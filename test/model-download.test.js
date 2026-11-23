"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { downloadFile } = require("../src/model-download");

async function fixture(t, handler) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-download-"));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(dir), os.tmpdir());
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { destination: path.join(dir, "model.onnx"), url: `http://127.0.0.1:${server.address().port}/model`, retryDelayMs: 0 };
}

test("a dropped model connection resumes the existing bytes within the same download", async t => {
  const bytes = Buffer.from("complete-model-file");
  const ranges = [];
  let interruptedResponse;
  const options = await fixture(t, (req, res) => {
    ranges.push(req.headers.range || "");
    if (ranges.length === 1) {
      res.writeHead(200, { "content-length": bytes.length, etag: '"version-1"' });
      res.write(bytes.subarray(0, 6));
      interruptedResponse = res;
    } else {
      assert.equal(req.headers["if-range"], '"version-1"');
      res.writeHead(206, { "content-length": bytes.length - 6, "content-range": `bytes 6-${bytes.length - 1}/${bytes.length}` });
      res.end(bytes.subarray(6));
    }
  });
  const progress = [];
  await downloadFile({ ...options, expectedBytes: bytes.length, onProgress: p => { progress.push(p); if (p.attempt === 1 && p.receivedBytes === 6) interruptedResponse.destroy(); } });
  assert.deepEqual(await fs.readFile(options.destination), bytes);
  assert.deepEqual(ranges, ["", "bytes=6-"]);
  assert.ok(progress.some(p => p.phase === "retrying"));
});

test("a later application session resumes its saved partial file", async t => {
  const bytes = Buffer.from("keep-partial-bytes");
  let requests = 0;
  let interruptedResponse;
  const options = await fixture(t, (req, res) => {
    requests++;
    if (requests === 1) {
      res.writeHead(200, { "content-length": bytes.length });
      res.write(bytes.subarray(0, 4));
      interruptedResponse = res;
    } else {
      assert.equal(req.headers.range, "bytes=4-");
      res.writeHead(206, { "content-range": `bytes 4-${bytes.length - 1}/${bytes.length}`, "content-length": bytes.length - 4 });
      res.end(bytes.subarray(4));
    }
  });
  await assert.rejects(downloadFile({ ...options, expectedBytes: bytes.length, maxAttempts: 1, onProgress: p => { if (p.receivedBytes === 4) interruptedResponse.destroy(); } }));
  assert.deepEqual(await fs.readFile(options.destination + ".part"), bytes.subarray(0, 4));
  await assert.rejects(fs.stat(options.destination));
  await downloadFile({ ...options, expectedBytes: bytes.length });
  assert.deepEqual(await fs.readFile(options.destination), bytes);
});

test("ignoring a Range request replaces the partial instead of corrupting the model", async t => {
  const bytes = Buffer.from("fresh-model-data");
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { "content-length": bytes.length }); res.end(bytes); });
  await fs.writeFile(options.destination + ".part", "stale");
  await downloadFile({ ...options, expectedBytes: bytes.length });
  assert.deepEqual(await fs.readFile(options.destination), bytes);
});

test("temporary server failures retry without accepting an incomplete model", async t => {
  let requests = 0;
  const options = await fixture(t, (_req, res) => {
    if (++requests < 3) { res.writeHead(503); res.end(); }
    else { res.writeHead(200, { "content-length": 5 }); res.end("model"); }
  });
  await downloadFile({ ...options, expectedBytes: 5 });
  assert.equal(requests, 3);
  assert.equal(await fs.readFile(options.destination, "utf8"), "model");
});

test("an invalid resumed range never produces an installed model", async t => {
  const options = await fixture(t, (_req, res) => {
    res.writeHead(206, { "content-length": 3, "content-range": "bytes 1-3/5" }); res.end("bad");
  });
  await fs.writeFile(options.destination + ".part", "mo");
  await assert.rejects(downloadFile({ ...options, expectedBytes: 5 }), /range/);
  await assert.rejects(fs.stat(options.destination));
  assert.equal(await fs.readFile(options.destination + ".part", "utf8"), "mo");
});

test("a size mismatch and permanent HTTP error do not loop or install bad data", async t => {
  let requests = 0;
  const options = await fixture(t, (_req, res) => { requests++; res.writeHead(200, { "content-length": 3 }); res.end("bad"); });
  await assert.rejects(downloadFile({ ...options, expectedBytes: 5 }), /size/);
  assert.equal(requests, 1);
  await assert.rejects(fs.stat(options.destination));
});

test("a stalled connection times out and recovers automatically", async t => {
  let requests = 0;
  const options = await fixture(t, (_req, res) => {
    if (++requests === 1) return;
    res.writeHead(200, { "content-length": 5 }); res.end("model");
  });
  await downloadFile({ ...options, expectedBytes: 5, stallTimeoutMs: 40 });
  assert.equal(await fs.readFile(options.destination, "utf8"), "model");
});

test("cancelling does not restart a model download", async t => {
  let requests = 0;
  const options = await fixture(t, () => { requests++; });
  const controller = new AbortController();
  const pending = downloadFile({ ...options, expectedBytes: 5, signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending);
  assert.equal(requests, 1);
});

test("a corrupt response with the right size is retried and never promoted to the model", async t => {
  let requests = 0;
  const options = await fixture(t, (_req, res) => { res.writeHead(200, { "content-length": 5 }); res.end(++requests === 1 ? "wrong" : "model"); });
  const expectedSha256 = createHash("sha256").update("model").digest("hex");
  await downloadFile({ ...options, expectedBytes: 5, expectedSha256 });
  assert.equal(requests, 2);
  assert.equal(await fs.readFile(options.destination, "utf8"), "model");
});

test("a complete partial file still needs a valid checksum before it is installed", async t => {
  let requests = 0;
  const options = await fixture(t, (_req, res) => { requests++; res.writeHead(200, { "content-length": 5 }); res.end("model"); });
  await fs.writeFile(options.destination + ".part", "wrong");
  await downloadFile({ ...options, expectedBytes: 5, expectedSha256: createHash("sha256").update("model").digest("hex") });
  assert.equal(requests, 1);
  assert.equal(await fs.readFile(options.destination, "utf8"), "model");
});
