"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("listening cues are original short wav files", () => {
  for (const name of ["listen-start.wav", "done.wav", "error.wav"]) {
    const bytes = fs.readFileSync(path.join(__dirname, "..", "renderer", "sounds", name));
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.ok(bytes.length > 44 && bytes.length < 40000, name);
  }
  const icon = fs.readFileSync(path.join(__dirname, "..", "build", "icon.png"));
  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
  const tray = fs.readFileSync(path.join(__dirname, "..", "renderer", "tray.png"));
  assert.equal(tray.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
