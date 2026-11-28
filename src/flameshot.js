"use strict";

const path = require("node:path");

// Keep Qt loaded between screenshots. The native shortcut bridge asks the
// resident daemon to capture; the CLI remains a cold-start/crash fallback.
function createFlameshot({ exe, spawn, prepare, hide, restore, delay, onError, trigger = async () => false }) {
  let prepared = false;
  let daemon = null;
  let opening = null;

  function configure() {
    if (prepared) return;
    prepare(exe);
    prepared = true;
  }

  function launch(args) {
    const child = spawn(exe, args, {
      detached: true, stdio: "ignore", windowsHide: false,
      cwd: path.dirname(exe),
    });
    child.unref();
    return child;
  }

  function warm() {
    if (daemon && daemon.exitCode == null && !daemon.killed) return;
    try {
      configure();
      daemon = launch([]);
      const child = daemon;
      child.once("error", () => { if (daemon === child) daemon = null; });
      child.once("exit", () => { if (daemon === child) daemon = null; });
    } catch { daemon = null; } // A click can still cold-start Flameshot.
  }

  function open() {
    if (opening) return opening;
    opening = (async () => {
      try {
        configure();
        hide();
        // Two compositor frames let the bubble disappear from the captured
        // desktop. No process scan, daemon restart or Qt startup sleep here.
        await delay(32);
        const captured = await trigger(daemon?.pid || 0, exe);
        if (!captured) {
          await new Promise((resolve, reject) => {
            const child = launch(["gui"]);
            child.once("error", reject);
            child.once("spawn", resolve);
          });
        }
        // This only restores the bubble; capture is already running.
        await delay(800);
        return true;
      } catch (error) {
        onError(error);
        return false;
      } finally {
        restore();
      }
    })().finally(() => { opening = null; });
    return opening;
  }

  function dispose() {
    if (daemon && daemon.exitCode == null && !daemon.killed) daemon.kill();
    daemon = null;
  }

  return { warm, open, dispose };
}

module.exports = { createFlameshot };
