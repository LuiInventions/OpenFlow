"use strict";

const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");

async function verifyHash(file, expected, signal) {
  if (!expected) return true;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex") === expected;
}

async function size(file) {
  try { return (await fs.stat(file)).size; } catch { return 0; }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason || new Error("Download cancelled.")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

// A stable partial file survives disconnects and application restarts.
async function downloadFile({ url, destination, expectedBytes, expectedSha256, fetchImpl = fetch, onProgress = () => {}, signal, maxAttempts = 4, retryDelayMs = 500, stallTimeoutMs = 30000 }) {
  const partial = `${destination}.part`;
  const metadata = `${partial}.json`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();
    let received = await size(partial);
    let validator = "";
    try {
      const saved = JSON.parse(await fs.readFile(metadata, "utf8"));
      if (saved.url !== url || saved.expectedBytes !== expectedBytes) {
        await fs.truncate(partial, 0);
        received = 0;
      } else validator = saved.validator || "";
    } catch { /* A partial from an interrupted first response can still resume. */ }
    if (received > expectedBytes) { await fs.truncate(partial, 0); received = 0; }
    if (received === expectedBytes) {
      if (await verifyHash(partial, expectedSha256, signal)) {
        await fs.rename(partial, destination);
        await fs.unlink(metadata).catch(() => {});
        onProgress({ receivedBytes: received, totalBytes: expectedBytes, attempt, phase: "downloading" });
        return;
      }
      await fs.truncate(partial, 0);
      received = 0;
    }
    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer;
    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error("Download connection timed out.")), stallTimeoutMs);
    };
    let handle;
    let reader;
    try {
      armTimeout();
      const headers = { "Accept-Encoding": "identity" };
      if (received) {
        headers.Range = `bytes=${received}-`;
        if (validator) headers["If-Range"] = validator;
      }
      onProgress({ receivedBytes: received, totalBytes: expectedBytes, attempt, phase: "downloading" });
      const response = await fetchImpl(url, { headers, redirect: "follow", signal: requestSignal });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 416 && received) await fs.truncate(partial, 0);
        const error = new Error(`Model download failed (HTTP ${response.status}).`);
        error.retryable = [408, 416, 429].includes(response.status) || response.status >= 500;
        throw error;
      }
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
        if (!range || Number(range[1]) !== received || Number(range[3]) !== expectedBytes) {
          await response.body.cancel();
          throw Object.assign(new Error("The model server returned an invalid download range."), { retryable: false });
        }
      } else {
        // A server may ignore Range or change its entity. Never append a full response.
        received = 0;
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (contentLength && contentLength !== expectedBytes - received) {
        await response.body.cancel();
        throw Object.assign(new Error("The model file size does not match its download manifest."), { retryable: false });
      }
      const etag = response.headers.get("etag");
      const nextValidator = etag && !etag.startsWith("W/") ? etag : response.headers.get("last-modified") || "";
      await fs.writeFile(metadata, JSON.stringify({ url, expectedBytes, validator: nextValidator }));
      handle = await fs.open(partial, received ? "a" : "w");
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armTimeout();
        if (!value?.byteLength) continue;
        if (received + value.byteLength > expectedBytes) throw Object.assign(new Error("The model response is larger than expected."), { retryable: false });
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
          if (!bytesWritten) throw new Error("Could not write the downloaded model.");
          offset += bytesWritten;
        }
        received += value.byteLength;
        onProgress({ receivedBytes: received, totalBytes: expectedBytes, attempt, phase: "downloading" });
      }
      if (received !== expectedBytes) throw new Error("Model download was interrupted before the file was complete.");
      await handle.close();
      handle = null;
      clearTimeout(timer);
      onProgress({ receivedBytes: received, totalBytes: expectedBytes, attempt, phase: "verifying" });
      if (!await verifyHash(partial, expectedSha256, signal)) throw new Error("Model checksum verification failed. Retrying the file.");
      await fs.rename(partial, destination);
      await fs.unlink(metadata).catch(() => {});
      return;
    } catch (error) {
      signal?.throwIfAborted();
      if (error.retryable === false || attempt === maxAttempts) throw error;
      onProgress({ receivedBytes: received, totalBytes: expectedBytes, attempt, phase: "retrying" });
    } finally {
      clearTimeout(timer);
      await reader?.cancel().catch(() => {});
      await handle?.close().catch(() => {});
    }
    await delay(Math.min(4000, retryDelayMs * 2 ** (attempt - 1)), signal);
  }
}

module.exports = { downloadFile };
