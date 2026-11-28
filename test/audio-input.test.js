"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const input = require("../src/audio-input");
const { createStore } = require("../src/store");

test("device list includes every distinct audio input and retains an unavailable selection", () => {
  const list = input.options([
    {kind:"audioinput",deviceId:"default",label:"Default"},
    {kind:"audioinput",deviceId:"usb",label:"USB microphone"},
    {kind:"audioinput",deviceId:"usb",label:"Duplicate"},
    {kind:"audioinput",deviceId:"built-in",label:""},
    {kind:"audiooutput",deviceId:"speaker",label:"Speaker"},
    {kind:"videoinput",deviceId:"camera",label:"Camera"},
  ],"removed","Desk mic");
  assert.deepEqual(list.map(row=>row.value),["","usb","built-in","removed"]);
  assert.equal(list[2].label,"Microphone 2");
  assert.equal(list[3].label,"Desk mic (unavailable)"); assert.equal(list[3].disabled,true);
});

test("label discovery stops its temporary stream and never records video", async () => {
  let count=0,stopped=0;
  const media={enumerateDevices:async()=>[{kind:"audioinput",deviceId:"usb",label:count?"USB":""}],getUserMedia:async constraints=>{
    assert.deepEqual(constraints,{audio:true});count++;
    return {getTracks:()=>[{stop:()=>stopped++}]};
  }};
  assert.equal((await input.enumerate(media,false))[0].label,"");
  assert.equal((await input.enumerate(media,true))[0].label,"USB");
  assert.equal(stopped,1);
});

test("selected input survives normal and compatibility retries, including repair", async () => {
  const calls=[];let repaired=0;
  const media={getUserMedia:async request=>{calls.push(request);if(calls.length<3)throw new Error("driver");return "selected-stream";}};
  assert.equal(await input.acquire(media,"usb",async()=>{repaired++;return {changed:true};}),"selected-stream");
  assert.equal(repaired,1);
  for(const request of calls) assert.deepEqual(request.audio.deviceId,{exact:"usb"});
  assert.equal(calls[1].audio.noiseSuppression,false);
});

test("missing selected microphone is reported without silently capturing another device", async () => {
  let calls=0;
  await assert.rejects(input.acquire({getUserMedia:async request=>{
    calls++; assert.deepEqual(request.audio.deviceId,{exact:"unplugged"});
    throw Object.assign(new Error("missing"),{name:"OverconstrainedError"});
  }},"unplugged",async()=>{throw new Error("Must not repair an unavailable selection");}),/Selected input device is unavailable/);
  assert.equal(calls,1);
});

test("capture cache is reused only for the current live device", () => {
  const capture={deviceId:"a",stream:{getTracks:()=>[{readyState:"live"}]}};
  assert.equal(input.reusable(capture,"a"),true);
  assert.equal(input.reusable(capture,"b"),false);
  capture.stale=true; assert.equal(input.reusable(capture,"a"),false);
  assert.equal(input.reusable({deviceId:"a",stream:{getTracks:()=>[{readyState:"ended"}]}},"a"),false);
});

test("input choice persists across application restarts and default device stays the default", () => {
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"openflow-input-")),"settings.json");
  let store=createStore(file); assert.equal(store.getSettings().inputDeviceId,"");
  store.updateSettings({inputDeviceId:"usb",inputDeviceLabel:"USB microphone"});
  store=createStore(file); assert.equal(store.getSettings().inputDeviceId,"usb");
  assert.equal(store.getSettings().inputDeviceLabel,"USB microphone");
  store.updateSettings({inputDeviceId:" default "}); assert.equal(store.getSettings().inputDeviceId,"");
  assert.equal(store.getSettings().inputDeviceLabel,"");
  assert.deepEqual(input.constraints(""),{audio:true});
  assert.equal(input.normalizeId("x".repeat(3000)),"");
});
