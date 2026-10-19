'use strict';
// Real panel/editor/CSS, synthetic content only; no user library or API opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-timeline-size-'));
const captures = path.join(os.tmpdir(), 'bex-timeline-size-captures');
fs.mkdirSync(captures, { recursive: true });
app.setPath('userData', profile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, window;
app.whenReady().then(async () => {
  try {
    const { createServer } = await import('vite');
    server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    window = new BrowserWindow({ width: 1200, height: 800, useContentSize: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const run = code => window.webContents.executeJavaScript(code);
    const until = async code => {
      for (let i = 0; i < 100; i++) { if (await run(code)) return; await wait(50); }
      throw new Error(`Timed out: ${code}`);
    };
    await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/timelineEditorSize.html`);
    await until('!!document.querySelector("[data-bex-global-editor] .ProseMirror")?.editor');
    const measure = () => run(`(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return { panel: box('.bex-tg-panel'), window: box('[data-testid=timegraph-description-editor]'),
        writing: box('.bex-tg-description-writing'), editor: box('[data-bex-global-editor]'), text: box('[data-bex-global-editor] .ProseMirror'),
        date: box('#tg-start'), width: innerWidth, height: innerHeight };
    })()`);
    const change = async label => {
      await run(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
      await wait(100);
      return measure();
    };
    const compact = await measure();
    assert.ok(compact.panel.width <= 321 && compact.writing.height <= 161);
    await run('window.originalTimelineEditor = document.querySelector("[data-bex-global-editor] .ProseMirror").editor; originalTimelineEditor.commands.setTextSelection({ from: 1, to: 9 })');
    const expanded = await change('Expanded');
    assert.ok(expanded.panel.width > compact.panel.width * 2, JSON.stringify(expanded));
    assert.ok(expanded.writing.height > compact.writing.height * 2);
    assert.ok(Math.abs(expanded.editor.height - expanded.writing.height) < 3);
    assert.ok(expanded.text.height >= expanded.writing.height - 4, 'Actual text surface must fill the expanded window');
    fs.writeFileSync(path.join(captures, 'expanded.png'), (await window.webContents.capturePage()).toPNG());
    const full = await change('Full screen');
    assert.ok(full.window.x === 0 && full.window.width === full.width && Math.abs(full.window.bottom - full.height) < 1, JSON.stringify(full));
    assert.ok(full.writing.height > expanded.writing.height);
    assert.ok(Math.abs(full.editor.height - full.writing.height) < 3);
    assert.ok(await run('document.querySelector("[data-bex-global-editor] .ProseMirror").editor === originalTimelineEditor && originalTimelineEditor.state.selection.from === 1 && originalTimelineEditor.state.selection.to === 9'));
    fs.writeFileSync(path.join(captures, 'fullscreen.png'), (await window.webContents.capturePage()).toPNG());
    await run('document.querySelector("[data-testid=timegraph-description-editor]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))');
    await wait(100);
    const restored = await measure();
    assert.equal(restored.panel.width, compact.panel.width);
    assert.equal(restored.writing.height, compact.writing.height);
    assert.ok(await run('document.querySelector("[data-bex-global-editor] .ProseMirror").editor === originalTimelineEditor && originalTimelineEditor.getText().includes("Preserve this text")'));
    await run('originalTimelineEditor.commands.insertContent(" Saved change")');
    await until('timelineSizeProof.event.description.includes("Saved change")');
    await run('originalTimelineEditor.commands.setContent("<p>Long writing</p>".repeat(100), true)');
    await change('Expanded');
    assert.ok(await run('(() => { const pane = document.querySelector("[data-bex-global-editor] > .overflow-y-auto"); pane.scrollTop = pane.scrollHeight; return pane.scrollTop > 0; })()'), 'Long writing must scroll inside the window');
    window.setContentSize(600, 760); await wait(150);
    const narrowExpanded = await measure();
    assert.ok(narrowExpanded.panel.width <= 600 && narrowExpanded.panel.height <= 760);
    await change('Compact');
    const narrowCompact = await measure();
    assert.ok(narrowCompact.panel.height < narrowExpanded.panel.height, 'Expanded bottom panel must grow in Split View');
    const narrowFull = await change('Full screen');
    assert.equal(narrowFull.window.width, 600);
    assert.ok(Math.abs(narrowFull.window.bottom - 760) < 1);
    console.log('PASS: compact, substantially wider expanded, and full-screen sizes resize the real writing window; fullscreen escapes transformed hosts, preserves editor/selection/content, and Split View fits');
    window.destroy(); await server.close(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(0);
  } catch (error) {
    console.error(error.stack); window?.destroy(); await server?.close(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(1);
  }
});
