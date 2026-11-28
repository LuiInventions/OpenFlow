"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createFlameshot } = require("../src/flameshot");

function fixture(fail = false, native = false) {
  const events = [], children = [], waits = [];
  const tool = createFlameshot({
    exe: "C:/OpenFlow/flameshot.exe",
    spawn(exe, args) {
      events.push(["spawn", args]);
      const child = new EventEmitter();
      Object.assign(child, { exitCode: null, killed: false, unref() {}, kill() { this.killed = true; } });
      children.push(child);
      queueMicrotask(() => child.emit(fail ? "error" : "spawn", new Error("unavailable")));
      return child;
    },
    prepare: () => events.push(["prepare"]),
    hide: () => events.push(["hide"]),
    restore: () => events.push(["restore"]),
    onError: () => events.push(["error"]),
    delay: async ms => { waits.push(ms); },
    trigger: async pid => { events.push(["native", pid || 0]); return native; },
  });
  return { tool, events, children, waits };
}

test("warm capture dispatches gui after only two compositor frames, without reconfiguring or restarting", async () => {
  const f = fixture();
  f.tool.warm(); f.tool.warm();
  assert.equal(await f.tool.open(), true);
  assert.deepEqual(f.events, [["prepare"], ["spawn", []], ["hide"], ["native", 0], ["spawn", ["gui"]], ["restore"]]);
  assert.deepEqual(f.waits, [32, 800]);
  assert.equal(f.children[0].killed, false);
  assert.equal(await f.tool.open(), true);
  assert.equal(f.events.filter(([kind]) => kind === "prepare").length, 1);
});

test("first click and a click after a daemon crash can start capture directly", async () => {
  const f = fixture();
  assert.equal(await f.tool.open(), true);
  assert.deepEqual(f.events[3], ["spawn", ["gui"]]);
  f.tool.warm();
  f.children.at(-1).emit("exit", 1);
  assert.equal(await f.tool.open(), true);
  assert.deepEqual(f.events.at(-2), ["spawn", ["gui"]]);
});

test("resident native capture never starts a second Qt process", async () => {
  const f = fixture(false, true);
  f.tool.warm();
  assert.equal(await f.tool.open(), true);
  assert.deepEqual(f.events, [["prepare"], ["spawn", []], ["hide"], ["native", 0], ["restore"]]);
  assert.equal(f.children.length, 1);
});

test("rapid repeated clicks share a single capture request", async () => {
  const f = fixture();
  const first = f.tool.open(), second = f.tool.open();
  assert.equal(first, second);
  await first;
  assert.equal(f.children.length, 1);
});

test("launch failure restores the bubble and permits retry", async () => {
  const f = fixture(true);
  f.tool.warm();
  assert.equal(await f.tool.open(), false);
  assert.deepEqual(f.events.slice(-2), [["error"], ["restore"]]);
  assert.equal(await f.tool.open(), false);
});

test("shutdown only kills the daemon started by this controller", () => {
  const f = fixture();
  f.tool.warm(); f.tool.dispose();
  assert.equal(f.children[0].killed, true);
});
