"use strict";

// Runs the dictation level meter from renderer/overlay.html against quiet and loud
// microphones: speech must move the bars whatever the input gain.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "renderer", "overlay.html"), "utf8");
const source = html.match(/function createVoiceMeter\(\) \{[\s\S]*?\n    \}\r?\n/)[0];
const createVoiceMeter = new Function(`${source}; return createVoiceMeter;`)();

// 60 frames of room noise, then alternating speech syllables and short gaps.
function run(noise, speech) {
  const measure = createVoiceMeter();
  const quiet = [];
  const voiced = [];
  for (let frame = 0; frame < 60; frame += 1) quiet.push(measure(noise * (0.8 + 0.4 * ((frame * 7) % 5) / 5)));
  for (let frame = 0; frame < 240; frame += 1) {
    const syllable = frame % 12 < 9;
    const result = measure(syllable ? speech * (0.6 + 0.4 * ((frame * 3) % 7) / 7) : noise);
    if (syllable) voiced.push(result);
  }
  return { quiet, voiced };
}

for (const [name, noise, speech] of [
  ["quiet laptop microphone", 0.0002, 0.002],
  ["average microphone", 0.001, 0.02],
  ["loud headset", 0.004, 0.25],
]) {
  test(`level meter reacts to speech on a ${name}`, () => {
    const { quiet, voiced } = run(noise, speech);
    const noiseVoice = quiet.slice(5).filter(row => row.voice).length;
    assert.ok(noiseVoice <= 2, `room noise counted as voice ${noiseVoice} times`);
    const detected = voiced.filter(row => row.voice).length / voiced.length;
    assert.ok(detected > 0.95, `speech detected in ${Math.round(detected * 100)} % of frames`);
    const mean = voiced.reduce((sum, row) => sum + row.level, 0) / voiced.length;
    assert.ok(mean > 0.45, `bars too small for speech (mean level ${mean.toFixed(2)})`);
  });
}
