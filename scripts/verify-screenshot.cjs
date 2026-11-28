"use strict";
// Runs the real bubble click handler and measures when Windows exposes the
// native Flameshot capture window. Test-owned processes close each sample.
const { app, desktopCapturer } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { execFileSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const baseline = process.argv.includes("--baseline");
const packagedArg = process.argv.find(arg => arg.startsWith("--packaged="));
const packageDir = packagedArg ? path.resolve(packagedArg.slice("--packaged=".length)) : null;
const countArg = process.argv.find(arg => arg.startsWith("--count="));
const count = countArg ? Number(countArg.split("=")[1]) : 3;
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "openflow-shot-")));
process.env.OPENFLOW_SMOKE = "1";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const captureWindows = async () => (await desktopCapturer.getSources({types:["window"], thumbnailSize:{width:0,height:0}})).filter(source => /flameshot/i.test(source.name));
app.whenReady().then(async () => {
  let api, observer;
  const owned=[];
  const cleanup=()=>{api?.cleanup();for(const child of owned)if(child.exitCode==null&&!child.killed)child.kill();};
  try {
    const filename = packageDir ? path.join(packageDir,"resources/app.asar/electron/main.cjs") : path.join(root, "electron/main.cjs");
    let source = baseline ? execFileSync("git", ["show", "v1.5.41:electron/main.cjs"], {cwd:root, encoding:"utf8"}) : fs.readFileSync(filename,"utf8");
    source = source.replaceAll("\r\n", "\n");
    if (packageDir) source = source.replace("const roots = [", "const roots = ["+JSON.stringify(path.join(packageDir,"resources/flameshot"))+",");
    // Disable the smoke test's auto-exit and pointer tracking only in this
    // in-memory test module. App code, IPC and the bubble handler stay real.
    source = source.replace('if (process.env.OPENFLOW_SMOKE === "1") {\n    const required', 'if (false) {\n    const required');
    source = source.replace('    watchPointer();', '    // Pointer tracking disabled in test harness.');
    if (!baseline) source = source.replace('process.env.OPENFLOW_SMOKE === "1" || chordStarts', 'false || chordStarts');
    source += `\nmodule.exports = { overlay:()=>overlayWindow, main:()=>mainWindow, warm:()=>${baseline ? "null" : "getScreenshotTool()?.warm()"}, cleanup:()=>${baseline ? "flameshotDaemon?.kill()" : "screenshotTool?.dispose()"} };`;
    const mod = new Module(filename, module); mod.filename=filename; mod.paths=Module._nodeModulePaths(path.dirname(filename));
    const load=mod.require.bind(mod);
    mod.require=name=>{
      const value=load(name);
      if(name!=="node:child_process")return value;
      return {...value,spawn(...args){const child=value.spawn(...args);if(/flameshot\.exe$/i.test(args[0]))owned.push(child);return child;}};
    };
    mod._compile(source,filename); api=mod.exports;
    for (let i=0;i<200 && (!api.overlay() || api.overlay().webContents.isLoading());i++) await sleep(25);
    assert.ok(api.overlay(), "Bubble created");
    api.warm(); await sleep(4000);

    observer=spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"scripts/observe-screenshot.ps1")],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let pendingLine, input="";
    const nextLine=()=>new Promise(resolve=>{pendingLine=resolve;});
    const ready=nextLine();
    observer.stdout.on("data",chunk=>{ input+=chunk.toString(); const lines=input.split(/\r?\n/); input=lines.pop(); for(const line of lines){if(pendingLine){const resolve=pendingLine;pendingLine=null;resolve(line);}} });
    observer.stderr.on("data",chunk=>console.error(String(chunk)));
    assert.equal(await ready,"ready");
    const results=[];
    for(let attempt=1; attempt<=count;attempt++) {
      const existing = new Set((await captureWindows()).map(s=>s.id));
      assert.equal(existing.size,0,"A previous capture must be closed before timing a new click");
      const overlay=api.overlay();
      await overlay.webContents.executeJavaScript("near=true; paint();");
      await sleep(100);
      const point=await overlay.webContents.executeJavaScript("(() => {const r=document.querySelector('#shot').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
      assert.ok(point.x>0 && point.y>0);
      const visible=nextLine();
      observer.stdin.write("arm\n");
      const start=performance.now();
      await overlay.webContents.executeJavaScript("document.querySelector('#shot').click()");
      const native=await Promise.race([visible,sleep(15000).then(()=>{throw new Error("Native capture timed out");})]);
      assert.match(native,/^visible /);
      const elapsedMs=Math.round(performance.now()-start);
      results.push({attempt,elapsedMs,window:native.split(" ")[1]});
      fs.mkdirSync(path.join(root,".cache"),{recursive:true});
      const shotSources=await desktopCapturer.getSources({types:["window"],thumbnailSize:{width:1280,height:720}});
      for(const s of shotSources.filter(s=>/flameshot/i.test(s.name))) if(!s.thumbnail.isEmpty()) fs.writeFileSync(path.join(root,".cache","native-selection.png"),s.thumbnail.toPNG());
      fs.mkdirSync(path.join(root,".cache"),{recursive:true});
      fs.writeFileSync(path.join(root,".cache",`screenshot-${baseline?"baseline":packageDir?"packaged":"optimized"}.json`),JSON.stringify({baseline,results},null,2));
      console.log(JSON.stringify({baseline,attempt,elapsedMs,action:"Native capture window ready; visual proof saved"}));
      if(!baseline) assert.ok(elapsedMs<1200,`Capture readiness exceeded 1200 ms: ${elapsedMs}`);
      // End this test-owned daemon to close capture without touching the user's
      // keyboard/mouse. Restart it before the next sample: this also verifies
      // that the native bridge recovers from a changed daemon PID.
      cleanup();
      for(let i=0;i<100 && (await captureWindows()).some(s=>!existing.has(s.id));i++) await sleep(20);
      if(attempt<count) { api.warm(); await sleep(1500); }
    }
    console.log(JSON.stringify({verified:true,baseline,results}));
    observer.kill(); cleanup(); app.exit(0);
  }catch(error){ console.error(error); observer?.kill(); cleanup(); app.exit(1); }
});
