"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { downloadFile } = require("./model-download");

const MODEL_ID = "parakeet-tdt-0.6b-v3";
const MODEL_REVISION = "ed5d745623472f97cfc2e6c2916ee248798fc5a8";
const HF_BASE = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/${MODEL_REVISION}`;
const REQUIRED_FILES = [
  {
    "name": "tokens.txt",
    "expectedBytes": 93939,
    "sha256": "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"
  },
  {
    "name": "joiner.int8.onnx",
    "expectedBytes": 6355277,
    "sha256": "cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98"
  },
  {
    "name": "decoder.int8.onnx",
    "expectedBytes": 11845274,
    "sha256": "0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5"
  },
  {
    "name": "encoder.int8.onnx",
    "expectedBytes": 652282294,
    "sha256": "1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479"
  }
];
const LEGACY_FILE_BYTES = [93939, 6355277, 11845275, 652184281];
const TOTAL_EXPECTED_BYTES = REQUIRED_FILES.reduce((sum, file) => sum + file.expectedBytes, 0);

let recognizer = null;
let loadPromise = null;
let installPromise = null;
let downloadProgress = null;
let downloadController = null;
const progressListeners = new Set();
let engineState = "stopped";
let lastError = "";
let activeModelDir = "";

function dirHasModel(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return [REQUIRED_FILES.map(file => file.expectedBytes), LEGACY_FILE_BYTES].some(expected =>
    REQUIRED_FILES.every((file, index) => {
      try { return fs.statSync(path.join(dir, file.name)).size === expected[index]; } catch { return false; }
    }));
}

function candidateModelDirs(userDataPath) {
  const dirs = [];
  if (userDataPath) {
    dirs.push(path.join(userDataPath, "models", MODEL_ID));
  }
  if (process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, "OpenFlow", "models", MODEL_ID));
    dirs.push(path.join(process.env.LOCALAPPDATA, "openflow", "models", MODEL_ID));
  }
  if (process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, "openflow", "models", MODEL_ID));
    dirs.push(path.join(process.env.APPDATA, "OpenFlow", "models", MODEL_ID));
  }
  dirs.push(path.join(__dirname, "..", "vendor", MODEL_ID));
  return [...new Set(dirs)];
}

function mirrorModelHardlinks(sourceDir, targetDir) {
  if (!sourceDir || !targetDir) return;
  try {
    if (path.resolve(sourceDir).toLowerCase() === path.resolve(targetDir).toLowerCase()) return;
    if (dirHasModel(targetDir)) return;
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of REQUIRED_FILES) {
      const src = path.join(sourceDir, file.name);
      const dst = path.join(targetDir, file.name);
      if (fs.existsSync(dst)) {
        try {
          if (fs.statSync(dst).size === fs.statSync(src).size) continue;
          fs.unlinkSync(dst);
        } catch {}
      }
      try {
        fs.linkSync(src, dst);
      } catch {
        // Ignore if cross-device; sourceDir is already valid
      }
    }
  } catch {}
}

function resolveModelDir(userDataPath) {
  const candidates = candidateModelDirs(userDataPath);
  for (const dir of candidates) {
    if (dirHasModel(dir)) {
      return dir;
    }
  }
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "OpenFlow", "models", MODEL_ID);
  }
  if (userDataPath) {
    return path.join(userDataPath, "models", MODEL_ID);
  }
  return path.join(__dirname, "..", "vendor", MODEL_ID);
}

function isModelInstalled(userDataPath) {
  return candidateModelDirs(userDataPath).some((dir) => dirHasModel(dir));
}

function ensureModelFiles(userDataPath, onProgress, options = {}) {
  if (typeof onProgress === "function") progressListeners.add(onProgress);
  if (downloadProgress && onProgress) onProgress(downloadProgress);
  if (!installPromise) {
    const dir = resolveModelDir(userDataPath);
    downloadController = new AbortController();
    const publish = value => {
      downloadProgress = value;
      for (const listener of progressListeners) { try { listener(value); } catch {} }
    };
    installPromise = (async () => {
      engineState = "installing";
      lastError = "";
      if (dirHasModel(dir)) {
        engineState = "stopped";
        publish({ downloadedBytes: TOTAL_EXPECTED_BYTES, totalBytes: TOTAL_EXPECTED_BYTES,
          downloadedMb: +(TOTAL_EXPECTED_BYTES / 1048576).toFixed(1), totalMb: +(TOTAL_EXPECTED_BYTES / 1048576).toFixed(1),
          percent: 100, phase: "complete", done: true });
        return dir;
      }
      fs.mkdirSync(dir, { recursive: true });
      const storedBytes = new Map(REQUIRED_FILES.map(file => {
        const full = path.join(dir, file.name);
        let stored = 0;
        try { if (fs.statSync(full).size === file.expectedBytes) stored = file.expectedBytes; } catch {}
        if (!stored) { try { stored = Math.min(file.expectedBytes, fs.statSync(full + ".part").size); } catch {} }
        return [file.name, stored];
      }));
      const report = (extra = 0, currentFile = "", phase = "downloading") => {
        if (currentFile) storedBytes.set(currentFile, extra);
        const current = Math.min(TOTAL_EXPECTED_BYTES, [...storedBytes.values()].reduce((sum, bytes) => sum + bytes, 0));
        publish({ downloadedBytes: current, totalBytes: TOTAL_EXPECTED_BYTES,
          downloadedMb: +(current / 1048576).toFixed(1), totalMb: +(TOTAL_EXPECTED_BYTES / 1048576).toFixed(1),
          percent: Math.floor(current / TOTAL_EXPECTED_BYTES * 100), currentFile, phase, done: false });
      };
      report();
      for (const file of REQUIRED_FILES) {
        const destination = path.join(dir, file.name);
        if (fs.existsSync(destination) && fs.statSync(destination).size === file.expectedBytes) {
          report(file.expectedBytes, file.name);
          continue;
        }
        await downloadFile({ ...options, url: `${HF_BASE}/${file.name}`, destination, expectedBytes: file.expectedBytes, expectedSha256: file.sha256,
          signal: downloadController.signal,
          onProgress: value => report(value.receivedBytes, file.name, value.phase) });
        report(file.expectedBytes, file.name);
      }
      if (!dirHasModel(dir)) throw new Error("The downloaded model is incomplete. Please retry in Settings.");
      if (process.env.LOCALAPPDATA) mirrorModelHardlinks(dir, path.join(process.env.LOCALAPPDATA, "OpenFlow", "models", MODEL_ID));
      if (userDataPath) mirrorModelHardlinks(dir, path.join(userDataPath, "models", MODEL_ID));
      engineState = "stopped";
      publish({ downloadedBytes: TOTAL_EXPECTED_BYTES, totalBytes: TOTAL_EXPECTED_BYTES,
        downloadedMb: +(TOTAL_EXPECTED_BYTES / 1048576).toFixed(1), totalMb: +(TOTAL_EXPECTED_BYTES / 1048576).toFixed(1),
        percent: 100, phase: "complete", done: true });
      return dir;
    })().catch(error => {
      lastError = error.message || "Model download failed. Please retry in Settings.";
      engineState = "error";
      publish({ ...(downloadProgress || {}), done: false, phase: "error", error: lastError });
      throw error;
    }).finally(() => { installPromise = null; downloadController = null; progressListeners.clear(); });
  }
  return installPromise;
}

function cancelDownload() { downloadController?.abort(new Error("Download paused. It can be resumed in Settings.")); }

function decodeWavPcm16(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 44) return { samples: new Float32Array(0), sampleRate: 16000 };
  const riff = bytes.toString("ascii", 0, 4);
  const wave = bytes.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Invalid WAV audio format for Parakeet v3.");
  }
  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataStart = 44;
  let dataLength = bytes.length - 44;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;
    if (chunkId === "fmt " && bodyOffset + 16 <= bytes.length) {
      channels = Math.max(1, bytes.readUInt16LE(bodyOffset + 2));
      sampleRate = bytes.readUInt32LE(bodyOffset + 4) || 16000;
      bitsPerSample = bytes.readUInt16LE(bodyOffset + 14) || 16;
    } else if (chunkId === "data") {
      dataStart = bodyOffset;
      dataLength = Math.min(chunkSize, bytes.length - bodyOffset);
      break;
    }
    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }
  if (bitsPerSample !== 16 || dataLength <= 0) {
    return { samples: new Float32Array(0), sampleRate };
  }
  const frameSize = channels * 2;
  const frameCount = Math.floor(dataLength / frameSize);
  const samples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    const pos = dataStart + i * frameSize;
    const pcm = bytes.readInt16LE(pos);
    samples[i] = pcm < 0 ? pcm / 32768 : pcm / 32767;
  }
  return { samples, sampleRate };
}

function startBackground(userDataPath) {
  if (process.env.OPENFLOW_SMOKE === "1") {
    engineState = "ready";
    return Promise.resolve(null);
  }
  if (recognizer) {
    engineState = "ready";
    return Promise.resolve(recognizer);
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      lastError = "";
      if (!isModelInstalled(userDataPath)) throw new Error("Download Parakeet v3 in Settings or use an API key.");
      const modelDir = resolveModelDir(userDataPath);
      activeModelDir = modelDir;
      engineState = "loading";
      const sherpa = require("sherpa-onnx-node");
      const threads = Math.max(1, Math.min(4, Math.floor((os.cpus() || []).length / 2) || 2));
      const config = {
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: path.join(modelDir, "encoder.int8.onnx"),
            decoder: path.join(modelDir, "decoder.int8.onnx"),
            joiner: path.join(modelDir, "joiner.int8.onnx"),
          },
          tokens: path.join(modelDir, "tokens.txt"),
          numThreads: threads,
          provider: "cpu",
          debug: 0,
          modelType: "nemo_transducer",
        },
      };
      recognizer = await sherpa.OfflineRecognizer.createAsync(config);
      engineState = "ready";
      return recognizer;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      engineState = "error";
      throw error;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

function stopBackground() {
  recognizer = null;
  loadPromise = null;
  engineState = "stopped";
}

async function transcribeWav(wavBuffer, userDataPath) {
  const inst = await startBackground(userDataPath);
  if (!inst) return { text: "", language: "" };
  const { samples, sampleRate } = decodeWavPcm16(wavBuffer);
  if (!samples.length) return { text: "", language: "" };
  const stream = inst.createStream();
  stream.acceptWaveform({ samples, sampleRate });
  const result = await inst.decodeAsync(stream);
  const text = result && typeof result.text === "string" ? result.text.trim() : "";
  const language = result && typeof result.lang === "string" ? result.lang.replace(/^<\|?|\|?>$/g, "") : "";
  return { text, language };
}

function getStatus(userDataPath) {
  const dir = activeModelDir || resolveModelDir(userDataPath);
  return {
    model: MODEL_ID,
    totalBytes: TOTAL_EXPECTED_BYTES,
    installed: dirHasModel(dir),
    state: engineState,
    error: lastError,
    progress: downloadProgress,
    downloading: Boolean(installPromise),
  };
}

module.exports = {
  MODEL_ID,
  MODEL_REVISION,
  MODEL_FILES: REQUIRED_FILES,
  TOTAL_EXPECTED_BYTES,
  resolveModelDir,
  dirHasModel,
  isModelInstalled,
  ensureModelFiles,
  cancelDownload,
  decodeWavPcm16,
  startBackground,
  stopBackground,
  transcribeWav,
  getStatus,
};
