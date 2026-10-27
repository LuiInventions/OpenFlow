"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function floatSamples(samples) {
  if (samples instanceof Float32Array) return samples;
  if (samples && typeof samples.length === "number") return Float32Array.from(samples);
  return new Float32Array(0);
}

contextBridge.exposeInMainWorld("openflow", {
  wavSlices(samples, sampleRate) {
    return ipcRenderer.invoke("audio-codec", { op: "slices", samples: floatSamples(samples), sampleRate });
  },
  audible(samples, sampleRate) {
    return ipcRenderer.invoke("audio-codec", { op: "audible", samples: floatSamples(samples), sampleRate });
  },
  pack(samples, sampleRate, force) {
    return ipcRenderer.invoke("audio-codec", {
      op: "pack",
      samples: floatSamples(samples),
      sampleRate,
      force: Boolean(force),
    });
  },
  flushSampleCount(sampleRate) {
    return ipcRenderer.invoke("audio-codec", { op: "flush", sampleRate });
  },
  dispatch(action, payload) {
    return ipcRenderer.invoke("dispatch", action, payload || {});
  },
  on(channel, listener) {
    if (channel !== "overlay-state" && channel !== "dictate-toggle" && channel !== "bar-command" && channel !== "note-show" && channel !== "note-voice" && channel !== "shot-clear" && channel !== "desk-refresh" && channel !== "model-install-progress" && channel !== "note-improve-progress" && channel !== "note-history") return () => {};
    const wrapped = (_event, data) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
