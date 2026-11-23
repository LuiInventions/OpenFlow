"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const audio = require("../src/audio");

test("wav is mono 16 kHz pcm and keeps every sample", () => {
  const wav = audio.encodeWav(Float32Array.of(0, 1, -1), 16000);
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readInt16LE(44), 0);
  assert.equal(wav.readInt16LE(46), 32767);
  assert.equal(wav.readInt16LE(48), -32768);
  assert.equal(wav.length, 44 + 6);
});

test("long audio is split into bounded wav slices without empty pieces", () => {
  const samples = new Float32Array(16000 * 3 + 50);
  samples.fill(0.2);
  const parts = audio.splitSamples(samples, 16000, 1);
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((part) => part.length > 0 && part.length <= 16000));
  const wavs = audio.wavSlices(samples, 16000, 1);
  assert.equal(wavs.length, parts.length);
  assert.ok(wavs.every((wav) => wav.length <= 44 + 16000 * 2));
});

test("silence is not sent and a real voice is", () => {
  assert.equal(audio.audible(new Float32Array(16000), 16000), false);
  const voice = new Float32Array(16000);
  voice.fill(0.05);
  assert.equal(audio.audible(voice, 16000), true);
  assert.equal(audio.audible(voice.subarray(0, 100), 16000), false);
});

test("quiet laptop speech counts as audible, steady noise does not", () => {
  // Syllables at RMS ~0.002 with pauses at ~0.0002: overall RMS stays below 0.003.
  const rate = 16000;
  const quiet = new Float32Array(rate * 2);
  for (let index = 0; index < quiet.length; index += 1) {
    const syllable = Math.floor(index / (rate * 0.18)) % 2 === 0;
    quiet[index] = Math.sin(index * 0.07) * (syllable ? 0.0028 : 0.0003);
  }
  assert.equal(audio.audible(quiet, rate), true);
  const fan = new Float32Array(rate * 2);
  for (let index = 0; index < fan.length; index += 1) fan[index] = Math.sin(index * 0.9) * 0.0015 * (1 + 0.1 * Math.sin(index * 0.001));
  assert.equal(audio.audible(fan, rate), false, "steady fan noise");
  const hiss = new Float32Array(rate * 2);
  for (let index = 0; index < hiss.length; index += 1) hiss[index] = (index % 2 ? 1 : -1) * 0.00005;
  assert.equal(audio.audible(hiss, rate), false, "muted microphone hiss");
});

test("resample and transcript joins keep order", () => {
  const down = audio.resample(Float32Array.of(0, 1), 8000, 16000);
  assert.equal(down.length, 4);
  assert.equal(audio.joinTranscripts([" Hallo ", "", "Welt "]), "Hallo Welt");
});
