"use strict";

const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "openflow-format-")));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 820, height: 540, show: false, webPreferences: { offscreen: true } });
  try {
    for (const standalone of [true, false]) {
      const base = pathToFileURL(path.join(root, "renderer") + path.sep).href;
      const fixture = `<!doctype html><html data-theme="dark"><head><base href="${base}"><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="sparkle.css"><link rel="stylesheet" href="theme.css"></head><body><div class="${standalone ? "card" : ""} note-shell" ${standalone ? "" : 'id="editor"'} style="height:440px"><div class="note-rail"></div><div class="note-main"><div class="note-write"><textarea></textarea></div><div data-sparkle-dock></div></div></div><script src="note-chrome.js"></script><script src="sparkle-client.js"></script></body></html>`;
      const fixtureFile = path.join(root, ".cache", "note-format-fixture.html");
      fs.mkdirSync(path.dirname(fixtureFile), { recursive: true });
      fs.writeFileSync(fixtureFile, fixture);
      await win.loadFile(fixtureFile);
      const result = await win.webContents.executeJavaScript(`(async () => {
        const shell = document.querySelector('.note-shell'), textarea = shell.querySelector('textarea');
        OpenflowNoteChrome.bind({shell, textarea});
        OpenflowSparkle.attach({host:shell.querySelector('.sparkle-host'), root:shell, textarea, getSettings:()=>({noteImproveEnabled:false}), getNote:()=>({content:textarea.value}), dispatch:async()=>({})});
        const view = shell.querySelector('.note-md');
        const click = el => { el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); el.click(); };
        click(shell.querySelector('[data-format-toggle]'));
        const states = [];
        for (const collapsed of [true, false]) {
          for (const kind of ['bold','italic','underline']) {
            textarea.value = 'Sample text'; OpenflowSparkle.sync(textarea); view.focus();
            const selection = getSelection(), range = document.createRange();
            range.selectNodeContents(view); if (collapsed) range.collapse(false);
            selection.removeAllRanges(); selection.addRange(range);
            const button = shell.querySelector('[data-format="'+kind+'"]');
            for (let i=0;i<6;i++) {
              click(button);
              await new Promise(resolve=>setTimeout(resolve,0));
              states.push({collapsed,kind,click:i+1,active:document.queryCommandState(kind),pressed:button.getAttribute('aria-pressed'),selected:getSelection().toString()});
            }
          }
        }
        textarea.value = 'Typing: '; OpenflowSparkle.sync(textarea); view.focus();
        const selection = getSelection(), range = document.createRange(); range.selectNodeContents(view); range.collapse(false); selection.removeAllRanges(); selection.addRange(range);
        click(shell.querySelector('[data-format="bold"]'));
        document.execCommand('insertText',false,'bold');
        click(shell.querySelector('[data-format="bold"]'));
        const off = shell.querySelector('[data-format="bold"]').getAttribute('aria-pressed');
        document.execCommand('insertText',false,' plain');
        const text = textarea.value;
        const toolbar = getComputedStyle(shell.querySelector('.format-bar'));
        return {states,off,text,background:toolbar.backgroundColor,color:getComputedStyle(shell.querySelector('[data-format="bold"]')).color};
      })()`);
      for (const state of result.states) {
        const on = state.click % 2 === 1;
        assert.equal(state.active, on, JSON.stringify({standalone,...state}));
        assert.equal(state.pressed, String(on), JSON.stringify({standalone,...state}));
        if (!state.collapsed) assert.equal(state.selected, "Sample text");
      }
      assert.equal(result.off, "false");
      assert.match(result.text, /\*\*bold\*\* plain$/);
      assert.equal(result.background, "rgb(0, 0, 0)");
      assert.equal(result.color, "rgb(240, 242, 236)");
      fs.writeFileSync(path.join(root, ".cache", `note-format-dark-${standalone ? "standalone" : "embedded"}.png`), (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({verified:true,standalone,toggles:result.states.length,text:result.text,background:result.background}));
    }
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
