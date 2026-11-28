"use strict";
// Uses the real settings IPC and capture code in an isolated profile. Reads
// track settings only: no audio is transcribed, saved or sent to a provider.
const {app}=require("electron");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const Module=require("node:module");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const packagedArg=process.argv.find(arg=>arg.startsWith("--packaged="));
const packageDir=packagedArg?path.resolve(packagedArg.slice(11)):null;
app.setPath("userData",fs.mkdtempSync(path.join(os.tmpdir(),"openflow-real-input-")));
process.env.OPENFLOW_SMOKE="1";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  let api;
  try {
    const filename=packageDir?path.join(packageDir,"resources/app.asar/electron/main.cjs"):path.join(root,"electron/main.cjs");
    let source=fs.readFileSync(filename,"utf8").replaceAll("\r\n","\n");
    source=source.replace('if (process.env.OPENFLOW_SMOKE === "1") {\n    const required','if (false) {\n    const required');
    source=source.replace('    watchPointer();','    // No desktop pointer polling in this test.');
    source+='\nmodule.exports={main:()=>mainWindow,overlay:()=>overlayWindow,actions,settings:()=>store.getSettings()};';
    const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(source,filename);api=mod.exports;
    for(let i=0;i<200&&(!api.overlay()||api.overlay().webContents.isLoading()||api.main().webContents.isLoading());i++)await sleep(20);
    await api.actions["settings.save"]({onboardingDone:true,aiFeaturesOnboardingDone:true});
    const main=api.main(), overlay=api.overlay();main.show();main.focus();await sleep(200);
    await main.webContents.executeJavaScript("state.view='settings';state.onboardingStep=null;render();refreshAudioInputs(true)");
    const devices=await main.webContents.executeJavaScript("(async()=>{const found=await OpenflowAudioInput.enumerate(navigator.mediaDevices,true);return found.filter(device=>device.deviceId && device.deviceId!=='default').map(device=>({id:device.deviceId,label:device.label}));})()");
    if(!devices.length) {console.log(JSON.stringify({verified:true,hardwareInputs:0,liveCapture:false,reason:"No microphone attached"}));app.exit(0);return;}
    const available=[];
    for(const device of devices) {
      try {
        await api.actions["settings.save"]({inputDeviceId:device.id,inputDeviceLabel:device.label});
        for(let i=0;i<100;i++) {if(await overlay.webContents.executeJavaScript(`inputDeviceId===${JSON.stringify(device.id)}`))break;await sleep(10);}
        const result=await overlay.webContents.executeJavaScript(`(async()=>{const current=await ensureCapture();return {requested:current.deviceId,actual:current.stream.getAudioTracks()[0].getSettings().deviceId,live:current.stream.getAudioTracks()[0].readyState};})()`);
        assert.equal(result.requested,device.id);assert.equal(result.actual,device.id,"Settings and Bubble share stable device IDs");assert.equal(result.live,"live");
        available.push(device);await overlay.webContents.executeJavaScript("releaseCapture()");
        if(available.length===2)break;
      }catch(error){await overlay.webContents.executeJavaScript("armed=false;releaseCapture()");if(error.code==="ERR_ASSERTION")throw error;}
    }
    assert.ok(available.length,"At least one enumerated microphone can be opened");
    const first=available[0], second=available[1]||available[0];
    await api.actions["settings.save"]({inputDeviceId:first.id,inputDeviceLabel:first.label});
    await sleep(50);
    await overlay.webContents.executeJavaScript("(async()=>{await ensureCapture();window.__firstCapture=capture;armed=true;})()");
    await api.actions["settings.save"]({inputDeviceId:second.id,inputDeviceLabel:second.label});
    await sleep(50);
    assert.equal(await overlay.webContents.executeJavaScript("capture===window.__firstCapture&&capture.stream.getAudioTracks()[0].readyState==='live'"),true,"Changing selection does not cut off an active recording");
    const switched=await overlay.webContents.executeJavaScript(`(async()=>{armed=false;await ensureCapture();return {id:capture.stream.getAudioTracks()[0].getSettings().deviceId,oldEnded:window.__firstCapture.stream.getAudioTracks()[0].readyState==='ended'};})()`);
    assert.equal(switched.id,second.id);
    if(first.id!==second.id)assert.equal(switched.oldEnded,true,"Next recording releases the previous device");
    await api.actions["settings.save"]({inputDeviceId:"",inputDeviceLabel:"System default"});await sleep(50);
    const systemDefault=await overlay.webContents.executeJavaScript("(async()=>{await ensureCapture();const result=capture.deviceId==='';releaseCapture();return result;})()");
    assert.equal(systemDefault,true);assert.equal(api.settings().inputDeviceId,"");
    const persisted=JSON.parse(fs.readFileSync(path.join(app.getPath("userData"),"openflow.json"),"utf8"));assert.equal(persisted.settings.inputDeviceId,"");
    console.log(JSON.stringify({verified:true,hardwareInputs:devices.length,liveCapture:true,selectedDevicesVerified:available.length,activeRecordingPreserved:true,systemDefault:true,persisted:true}));app.exit(0);
  }catch(error){console.error(error);if(api?.overlay()&&!api.overlay().isDestroyed())await api.overlay().webContents.executeJavaScript("armed=false;releaseCapture()").catch(()=>{});app.exit(1);}
});
