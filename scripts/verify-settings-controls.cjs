"use strict";
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { createStore } = require("../src/store");
const { TEXT_MODELS } = require("../src/note-improve");
const root = path.resolve(__dirname,"..");
app.setPath("userData",fs.mkdtempSync(path.join(os.tmpdir(),"openflow-controls-")));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:820,height:540,show:false,webPreferences:{offscreen:true}});
  const cache=path.join(root,".cache");fs.mkdirSync(cache,{recursive:true});
  try {
    const base=pathToFileURL(path.join(root,"renderer")+path.sep).href;
    const mock=`<base href="${base}"><script>
      window.__devices=[{kind:'audioinput',deviceId:'builtin',label:'Built-in microphone'},{kind:'audioinput',deviceId:'usb',label:'USB microphone'},{kind:'audiooutput',deviceId:'speaker',label:'Speakers'},{kind:'videoinput',deviceId:'camera',label:'Camera'}];
      window.__media=Object.assign(new EventTarget(),{enumerateDevices:async()=>window.__devices,getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})});
      Object.defineProperty(navigator,'mediaDevices',{value:window.__media,configurable:true});
    </script>`;
    fs.writeFileSync(path.join(cache,"settings-controls.html"),fs.readFileSync(path.join(root,"renderer/index.html"),"utf8").replace("<head>","<head>"+mock));
    await win.loadFile(path.join(cache,"settings-controls.html"));
    await win.webContents.insertCSS("*{transition:none!important;animation:none!important;}");
    const settings={...createStore(":memory:").getSettings(),textImprovementModels:TEXT_MODELS,onboardingDone:true,aiFeaturesOnboardingDone:true,hasKey:true,hasWorkingKey:true,inputDeviceId:"usb",inputDeviceLabel:"USB microphone"};
    await win.webContents.executeJavaScript(`window.__desk={settings:${JSON.stringify(settings)},commands:[],pads:[],history:[]};window.__updates=[];
      window.openflow={dispatch:async(action,payload)=>{if(action==='settings.save'){__updates.push(payload);Object.assign(__desk.settings,payload);return {settings:__desk.settings};}if(action==='desk.snapshot')return __desk;return {};}};
      state.desk=__desk;state.view='settings';render();`);
    const results=[];
    for(const width of [820,720]) {
      win.setContentSize(width,540);
      for(const theme of ["dark","light"]) {
        await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}';render();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        const layout=await win.webContents.executeJavaScript(`(() => {
          const models=document.querySelector('.models-settings-card'), grid=models.querySelector('.engine-grid'), notes=models.querySelector('.improvement-switches'), model=models.querySelector('.improvement-model-row'), api=models.querySelector('.api-key-block');
          const rows=[...notes.querySelectorAll('.mode-toggle-card')];
          const dictation=[...document.querySelectorAll('.settings-card')].find(card=>card.querySelector('.section-label').textContent==='Dictation');
          const reference=getComputedStyle(dictation.querySelector('.mode-toggle-card'));
          const before=(a,b)=>Boolean(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING);
          return {heading:models.querySelector('.section-label').textContent,order:before(grid,notes)&&before(notes,api)&&before(model,api),divider:getComputedStyle(api).borderTopWidth,oldDivider:getComputedStyle(notes).borderTopWidth,
            rows:rows.map(row=>{const css=getComputedStyle(row);return {background:css.backgroundColor,radius:css.borderRadius,padding:css.padding,border:css.borderWidth};}),
            reference:{background:reference.backgroundColor,radius:reference.borderRadius,padding:reference.padding,border:reference.borderWidth},inputLast:dictation.lastElementChild.classList.contains('input-device-card'),
            custom:document.querySelectorAll('[role=combobox]').length,native:document.querySelectorAll('select').length,triggerBorders:[...document.querySelectorAll('[role=combobox]')].map(el=>getComputedStyle(el).borderWidth)};
        })()`);
        assert.equal(layout.heading,"Models");assert.equal(layout.order,true);assert.equal(layout.divider,"1px");assert.equal(layout.oldDivider,"0px");
        assert.equal(layout.rows.length,3);for(const row of layout.rows)assert.deepEqual(row,layout.reference);
        assert.equal(layout.inputLast,true);assert.equal(layout.custom,2);assert.equal(layout.native,0);assert.deepEqual(layout.triggerBorders,["0px","0px"]);
        results.push({width,theme,layout:true});
        await win.webContents.executeJavaScript(`document.querySelector('#improvement-model').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        await win.webContents.executeJavaScript(`document.querySelector('#improvement-model').click()`);
        const popup=await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.settings-select-menu'),r=el.getBoundingClientRect();return {role:el.getAttribute('role'),options:el.querySelectorAll('[role=option]').length,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()`);
        assert.equal(popup.role,"listbox");assert.equal(popup.options,3);assert.equal(popup.inside,true);
        fs.writeFileSync(path.join(cache,`settings-model-menu-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript(`document.querySelector('#improvement-model').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.settings-select-menu')===null`),true);
      }
    }
    const behavior=await win.webContents.executeJavaScript(`(async()=>{
      const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Control update timed out');};
      const key=value=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
      let trigger=document.querySelector('#improvement-model');trigger.focus();key('ArrowDown');key('End');key('Home');key('ArrowDown');key('End');key('Enter');
      await wait(()=>document.querySelector('#improvement-model')?.dataset.value==='gpt-6-sol'&&!document.querySelector('#improvement-model').disabled);
      trigger=document.querySelector('#improvement-model');trigger.focus();key('ArrowDown');for(const letter of 'gpt-6 l')key(letter);key('Enter');
      await wait(()=>document.querySelector('#improvement-model')?.dataset.value==='gpt-6-luna'&&!document.querySelector('#improvement-model').disabled);
      trigger=document.querySelector('#input-device');trigger.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));trigger.click();
      await wait(()=>document.querySelector('.settings-select-menu')?.querySelectorAll('[role=option]').length===3);
      const deviceOptions=[...document.querySelectorAll('.settings-select-menu [role=option]')].map(el=>el.textContent.trim());
      document.querySelector('.settings-select-menu [data-select-index="1"]').click();
      await wait(()=>__desk.settings.inputDeviceId==='builtin'&&!document.querySelector('#input-device').disabled);
      __devices=__devices.filter(device=>device.deviceId!=='builtin');__media.dispatchEvent(new Event('devicechange'));
      await wait(()=>document.querySelector('#input-device-status').textContent.includes('unavailable'));
      const unavailable=document.querySelector('#input-device').textContent;
      __devices.push({kind:'audioinput',deviceId:'builtin',label:'Built-in microphone'});__media.dispatchEvent(new Event('devicechange'));
      await wait(()=>document.querySelector('#input-device-status').textContent==='');
      document.querySelector('#input-device').click();document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      const outsideClosed=!document.querySelector('.settings-select-menu');
      return {updates:__updates,deviceOptions,unavailable,outsideClosed,selected:__desk.settings.inputDeviceId};
    })()`);
    assert.deepEqual(behavior.updates,[{noteImproveModel:"gpt-6-sol"},{noteImproveModel:"gpt-6-luna"},{inputDeviceId:"builtin",inputDeviceLabel:"Built-in microphone"}]);
    assert.deepEqual(behavior.deviceOptions,["System default","Built-in microphone","USB microphone"]);
    assert.match(behavior.unavailable,/unavailable/);assert.equal(behavior.outsideClosed,true);assert.equal(behavior.selected,"builtin");
    win.setContentSize(820,540);
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark';document.querySelector('#input-device').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await win.webContents.executeJavaScript(`document.querySelector('#input-device').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(cache,'settings-input-menu-dark.png'),(await win.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({verified:true,results,keyboardAndMouse:true,hotplug:true,settingsPayloads:true}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
