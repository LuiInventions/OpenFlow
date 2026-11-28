"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OpenflowAudioInput = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalizeId(value) {
    const id = typeof value === "string" && value.length <= 2048 ? value.trim() : "";
    return id === "default" ? "" : id;
  }

  function options(devices, selectedId = "", selectedLabel = "") {
    const items = [{ value: "", label: "System default" }];
    for (const device of devices || []) {
      const value = normalizeId(device.deviceId);
      if (device.kind !== "audioinput" || !value || items.some(item => item.value === value)) continue;
      items.push({ value, label: device.label || `Microphone ${items.length}` });
    }
    const selected = normalizeId(selectedId);
    if (selected && !items.some(item => item.value === selected)) {
      items.push({ value: selected, label: `${selectedLabel || "Selected microphone"} (unavailable)`, disabled: true });
    }
    return items;
  }

  async function enumerate(media, requestLabels = false) {
    if (!media?.enumerateDevices) throw new Error("Audio input devices are unavailable.");
    let devices = await media.enumerateDevices();
    if (requestLabels && devices.some(device => device.kind === "audioinput" && !device.label)) {
      let stream;
      try {
        stream = await media.getUserMedia({ audio: true });
        devices = await media.enumerateDevices();
      } finally {
        stream?.getTracks().forEach(track => track.stop());
      }
    }
    return devices.filter(device => device.kind === "audioinput");
  }

  function constraints(value, strict = false) {
    const id = normalizeId(value);
    if (!strict && !id) return { audio: true };
    return { audio: {
      ...(id ? { deviceId: { exact: id } } : {}),
      ...(strict ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } : {}),
    } };
  }

  async function acquire(media, value = "", repair) {
    const id = normalizeId(value);
    const attempt = async () => {
      let first;
      try { return await media.getUserMedia(constraints(id)); }
      catch (error) {
        first = error;
        if (id && ["NotFoundError", "OverconstrainedError"].includes(error.name)) {
          throw new Error("Selected input device is unavailable. Connect it or choose another input device in Settings.");
        }
      }
      try { return await media.getUserMedia(constraints(id, true)); }
      catch { throw first; }
    };
    try { return await attempt(); }
    catch (error) {
      if (id && /Selected input device/.test(error.message)) throw error;
      if (repair && (await repair())?.changed) return attempt();
      throw error;
    }
  }

  function reusable(capture, id) {
    return Boolean(!capture?.stale && capture?.stream?.getTracks().some(track => track.readyState === "live") && capture.deviceId === normalizeId(id));
  }

  return { normalizeId, options, enumerate, constraints, acquire, reusable };
});
