"use strict";

const OUTPUT_RATE = 16000;
const MAX_SLICE_SECONDS = 480;
const SILENCE_RMS = 0.003;
const MIN_AUDIBLE_SECONDS = 0.12;

function asFloat32(samples) {
  if (samples instanceof Float32Array) return samples;
  if (!samples || typeof samples.length !== "number") return new Float32Array(0);
  const out = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) out[index] = Number(samples[index]) || 0;
  return out;
}

function resample(samples, fromRate, toRate) {
  const input = asFloat32(samples);
  const sourceRate = Number(fromRate);
  const targetRate = Number(toRate);
  if (!input.length) return input;
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error("Invalid sample rate.");
  if (!Number.isFinite(targetRate) || targetRate <= 0) throw new Error("Invalid sample rate.");
  if (sourceRate === targetRate) return input;
  const length = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const out = new Float32Array(length);
  const scale = sourceRate / targetRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * scale;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const mix = position - left;
    out[index] = input[left] * (1 - mix) + input[right] * mix;
  }
  return out;
}

function rms(samples) {
  const input = asFloat32(samples);
  if (!input.length) return 0;
  const step = Math.max(1, Math.floor(input.length / 8000));
  let sum = 0;
  let count = 0;
  for (let index = 0; index < input.length; index += step) {
    const sample = input[index];
    sum += sample * sample;
    count += 1;
  }
  return Math.sqrt(sum / count);
}

// Below this, even the loudest moments are only hiss or a muted microphone.
const VOICE_FLOOR_RMS = 0.0004;

function audible(samples, sampleRate) {
  const input = asFloat32(samples);
  const rate = Number(sampleRate) || OUTPUT_RATE;
  if (input.length < rate * MIN_AUDIBLE_SECONDS) return false;
  if (rms(input) >= SILENCE_RMS) return true;
  // Quiet microphones (common on laptops): speech still shows as loud 30 ms windows
  // over a quieter floor between syllables, while steady fan noise stays flat.
  const size = Math.max(1, Math.floor(rate * 0.03));
  const levels = [];
  for (let start = 0; start + size <= input.length; start += size) {
    let sum = 0;
    for (let index = start; index < start + size; index += 2) sum += input[index] * input[index];
    levels.push(Math.sqrt(sum / Math.ceil(size / 2)));
  }
  if (!levels.length) return false;
  levels.sort((a, b) => a - b);
  const floor = levels[Math.floor(levels.length * 0.2)];
  const peak = levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.95))];
  return peak >= VOICE_FLOOR_RMS && peak >= floor * 3;
}

function quietCut(samples, start, end, sampleRate) {
  const window = Math.max(1, Math.floor(sampleRate * 0.02));
  const search = Math.floor(sampleRate * 8);
  const from = Math.max(start + window, end - search);
  let best = end;
  let bestScore = Infinity;
  for (let index = from; index + window <= end; index += window) {
    let score = 0;
    for (let offset = 0; offset < window; offset += 4) score += Math.abs(samples[index + offset]);
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  }
  if (best <= start) return end;
  return best;
}

function splitSamples(samples, sampleRate, maxSeconds) {
  const input = asFloat32(samples);
  const rate = Number(sampleRate) || OUTPUT_RATE;
  const limit = Math.max(1, Math.floor((Number(maxSeconds) || MAX_SLICE_SECONDS) * rate));
  if (!input.length) return [];
  if (input.length <= limit) return [input];
  const parts = [];
  let offset = 0;
  while (offset < input.length) {
    let end = Math.min(input.length, offset + limit);
    if (end < input.length) end = quietCut(input, offset, end, rate);
    if (end <= offset) end = Math.min(input.length, offset + limit);
    parts.push(input.subarray(offset, end));
    offset = end;
  }
  return parts;
}

function writeAscii(buffer, offset, text) {
  buffer.write(text, offset, text.length, "ascii");
}

function encodeWav(samples, sampleRate) {
  const input = asFloat32(samples);
  const rate = Math.round(Number(sampleRate) || OUTPUT_RATE);
  const buffer = Buffer.alloc(44 + input.length * 2);
  writeAscii(buffer, 0, "RIFF");
  buffer.writeUInt32LE(36 + input.length * 2, 4);
  writeAscii(buffer, 8, "WAVE");
  writeAscii(buffer, 12, "fmt ");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  writeAscii(buffer, 36, "data");
  buffer.writeUInt32LE(input.length * 2, 40);
  for (let index = 0; index < input.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, input[index]));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

function wavSlices(samples, sampleRate, maxSeconds) {
  const rate = Number(sampleRate) || OUTPUT_RATE;
  const pcm = resample(samples, rate, OUTPUT_RATE);
  return splitSamples(pcm, OUTPUT_RATE, maxSeconds || MAX_SLICE_SECONDS).map((part) => encodeWav(part, OUTPUT_RATE));
}

function flushSampleCount(sampleRate) {
  const rate = Number(sampleRate) || OUTPUT_RATE;
  const maxBytes = 15 * 1024 * 1024;
  const outputSamples = Math.floor(maxBytes / 2);
  return Math.max(1, Math.floor(outputSamples * rate / OUTPUT_RATE));
}

function joinTranscripts(parts) {
  return (parts || []).map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

module.exports = {
  OUTPUT_RATE,
  MAX_SLICE_SECONDS,
  asFloat32,
  resample,
  rms,
  audible,
  splitSamples,
  encodeWav,
  wavSlices,
  flushSampleCount,
  joinTranscripts,
};
