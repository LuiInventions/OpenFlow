"use strict";
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "openflow-settings-")));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 820, height: 540, show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadFile(path.join(root, "renderer/index.html"));
    const results = [];
    for (const width of [820, 720]) {
      win.setContentSize(width, 540);
      for (const theme of ["dark", "light"]) {
        for (const installed of [true, false]) {
          const result = await win.webContents.executeJavaScript(`(() => {
            document.documentElement.dataset.theme = ${JSON.stringify(theme)};
            state.desk = { settings: { parakeet: { installed: ${installed} }, textImprovementModels: [] }, commands: [] };
            state.draftBubbleElements = ['voice']; state.draftVoiceNote = false;
            document.querySelector('#view').innerHTML = settingsHtml();
            const cards = [...document.querySelectorAll('.engine-option')].map(card => {
              const r = card.getBoundingClientRect(), label = card.querySelector('.engine-multilingual').getBoundingClientRect();
              return {height:r.height, bottomGap:r.bottom-label.bottom, overflow:card.scrollHeight>card.clientHeight+1};
            });
            const removed = [...document.querySelectorAll('.removed-elem-btn')].map(button => {
              const css=getComputedStyle(button);
              return {green:css.backgroundColor, left:css.paddingLeft, right:css.paddingRight, spans:button.querySelectorAll('span').length, draggable:button.draggable};
            });
            return { cards, removed, plus:document.querySelector('.elem-plus-badge')!==null };
          })()`);
          for (const card of result.cards) {
            assert.ok(!card.overflow, JSON.stringify({width,theme,installed,card}));
            assert.ok(card.bottomGap <= 20, JSON.stringify({width,theme,installed,card}));
            assert.ok(card.bottomGap >= 10);
          }
          assert.equal(result.plus, false);
          assert.equal(result.removed.length, 4);
          for (const item of result.removed) {
            assert.equal(item.green, "rgb(16, 185, 129)");
            assert.equal(item.left, item.right);
            assert.equal(item.spans, 1);
            assert.equal(item.draggable, true);
          }
          results.push({width,theme,installed,cards:result.cards});
        }
        await win.webContents.executeJavaScript(`document.querySelector('.manage-elements-card').scrollIntoView(); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        fs.mkdirSync(path.join(root, ".cache"), {recursive:true});
        fs.writeFileSync(path.join(root, ".cache", `settings-${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
      }
    }
    console.log(JSON.stringify({verified:true,results})); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
