'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, Menu } = require('electron');
const { installApplicationMenu } = require('../desktop/app-menu.cjs');
const windowOptions = require('../desktop/window-options.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-split-view-proof-'));
app.setPath('userData', path.join(temp, 'profile'));
app.setName('BEX Split View Proof');
const output = process.env.BEX_SPLIT_VIEW_PROOF_OUTPUT || path.join(temp, 'captures');
fs.mkdirSync(output, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
let window;
async function evaluate(code) { return window.webContents.executeJavaScript(code); }
async function ready(selector) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await wait(100);
  }
  throw new Error(`Missing ${selector}: ${await evaluate('document.body.innerText.slice(0, 2000)')}`);
}
async function resize(width, height = 780) {
  window.setContentSize(width, height);
  await wait(180);
  assert.equal(await evaluate('window.innerWidth'), width);
}
async function navigate(route, selector) {
  await window.loadURL(`http://127.0.0.1:${server.address().port}${route}`);
  // Each scenario starts from its own route, rather than the previous saved tab.
  await evaluate(`localStorage.setItem('bex_workspace_tabs_v1', ${JSON.stringify(JSON.stringify({ tabs: [{ id: 'proof', kind: 'study', title: 'Split View proof', path: route }], activeId: 'proof' }))})`);
  await window.loadURL(`http://127.0.0.1:${server.address().port}${route}`);
  await ready(selector);
  await evaluate('document.fonts.ready');
  await wait(250);
}
async function assertContained(selector) {
  const result = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  })()`);
  assert.ok(result.left >= -1 && result.right <= result.width + 1, `${selector} escapes window: ${JSON.stringify(result)}`);
  if (result.scrollWidth > result.clientWidth + 1) console.log('Overflow elements', await evaluate("Array.from(document.querySelectorAll('body *')).filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(el => ({tag: el.tagName, cls: el.className?.baseVal ?? el.className, right: el.getBoundingClientRect().right}))"));
  assert.ok(result.scrollWidth <= result.clientWidth + 1, `${selector} overflows horizontally: ${JSON.stringify(result)}`);
}
async function capture(name) { fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG()); }
async function assertNoteGutters(width) {
  const geometry = await evaluate(`(() => {
    const editor = document.querySelector('[data-testid="note-zoom-page"] .ProseMirror');
    const viewport = document.querySelector('[data-testid="note-zoom-viewport"]').getBoundingClientRect();
    const text = editor.getBoundingClientRect();
    const toggle = editor.querySelector('.toggle-block');
    const row = toggle.getBoundingClientRect();
    editor.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: row.left + 10, clientY: row.top + 10 }));
    const handle = document.querySelector('.bex-block-drag-handle.is-visible').getBoundingClientRect();
    const arrow = toggle.querySelector('.toggle-block__chevron').getBoundingClientRect();
    return { left: text.left - viewport.left, right: viewport.right - text.right,
      handleLeft: handle.left - viewport.left, handleRight: handle.right, arrowLeft: arrow.left };
  })()`);
  assert.ok(geometry.left >= 74 && geometry.right >= 74, `Both note gutters must remain usable at ${width}px: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.handleLeft >= 8 && geometry.handleRight <= geometry.arrowLeft - 5, 'Drag handle must clear the window edge and toggle arrow');
  await evaluate("document.querySelector('.ProseMirror .toggle-block__chevron').click()");
  await wait(220);
  assert.equal(await evaluate("!!document.querySelector('.ProseMirror .toggle-block.is-open')"), true);
  await evaluate("document.querySelector('.ProseMirror .toggle-block__chevron').click()");
  await wait(220);
  for (const side of ['left', 'right']) {
    await evaluate(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const viewport = document.querySelector('[data-testid="note-zoom-viewport"]');
      const box = viewport.getBoundingClientRect();
      const first = viewport.querySelector('.ProseMirror > .toggle-block').getBoundingClientRect();
      const last = viewport.querySelector('.ProseMirror > p').getBoundingClientRect();
      const x = ${JSON.stringify(side)} === 'left' ? box.left + 10 : box.right - 10;
      viewport.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: x, clientY: first.top + 2 }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: x, clientY: last.bottom - 2 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: x, clientY: last.bottom - 2 }));
    })()`);
    assert.ok(await evaluate("document.querySelectorAll('.ProseMirror .bex-block-selected').length >= 2"), `${side} gutter must support block selection at ${width}px`);
  }
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
}
async function desktopUnchanged(selector) {
  await resize(1440, 878);
  await evaluate("document.activeElement?.blur()");
  const animationStyle = await window.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; } .scripture-search__aura, .liquid-glow { visibility: hidden !important; }');
  await evaluate(`(() => {
    const style = document.createElement('style'); style.id = 'proof-static-frame';
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; } .scripture-search__aura, .liquid-glow { visibility: hidden !important; }';
    document.head.appendChild(style);
  })()`);
  await wait(1500);
  await capture('desktop-before-difference');
  const fingerprint = `Array.from(document.querySelectorAll('body *')).map(el => { const style = getComputedStyle(el); const rect = el.getBoundingClientRect(); return { tag: el.tagName, cls: el.className?.baseVal ?? el.className, rect: [rect.x, rect.y, rect.width, rect.height], styles: Object.fromEntries(['display', 'position', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'border-top-width', 'border-top-color', 'border-radius', 'box-shadow', 'opacity', 'overflow', 'flex-direction', 'grid-template-columns', 'gap', 'padding'].map(key => [key, style.getPropertyValue(key)])) };  })`;
  const before = await evaluate(fingerprint);
  assert.equal(await evaluate("matchMedia('(max-width: 1023px)').matches"), false);
  await assertContained(selector);
  // Remove the entire upgrade stylesheet from CSSOM for a real before/after
  // computed-style comparison, then restore it for narrow-window scenarios.
  await evaluate(`(() => {
    for (const sheet of document.styleSheets) {
      const rules = Array.from(sheet.cssRules);
      const index = rules.findIndex(rule => rule.cssText.includes(':root .bex-library-columns'));
      if (index < 0) continue;
      window.__splitViewRule = { sheet, index, text: rules[index].cssText };
      sheet.deleteRule(index);
      return;
    }
    throw new Error('Split View stylesheet missing');
  })()`);
  await wait(100);
  const after = await evaluate(fingerprint);
  assert.deepEqual(after, before, 'Expanded desktop geometry or appearance changed');
  await evaluate('window.__splitViewRule.sheet.insertRule(window.__splitViewRule.text, window.__splitViewRule.index)');
  await evaluate("document.getElementById('proof-static-frame').remove()");
  await window.webContents.removeInsertedCSS(animationStyle);
  await capture('desktop-' + selector.replace(/[^a-z]/gi, ''));

}
async function assertNativeNoteMarquee() {
  window.show(); window.focus(); await wait(100);
  for (const side of ['left', 'right']) {
    const points = await evaluate(`(() => {
      const viewport = document.querySelector('[data-testid="note-zoom-viewport"]');
      const box = viewport.getBoundingClientRect();
      const first = viewport.querySelector('.ProseMirror > .toggle-block').getBoundingClientRect();
      const last = viewport.querySelector('.ProseMirror > p').getBoundingClientRect();
      return { x: ${JSON.stringify(side)} === 'left' ? box.left + 10 : box.right - 10,
        startY: first.top + 2, endY: last.bottom - 2 };
    })()`);
    const x = Math.round(points.x), startY = Math.round(points.startY), endY = Math.round(points.endY);
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y: startY });
    window.webContents.sendInputEvent({ type: 'mouseDown', x, y: startY, button: 'left', clickCount: 1 });
    await wait(30);
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y: endY, modifiers: ['leftButtonDown'] });
    await wait(30);
    assert.ok(await evaluate("document.querySelectorAll('[data-testid=note-zoom-viewport] .ProseMirror .bex-block-selected').length >= 2"), `Real ${side} margin drag must select note blocks`);
    await evaluate('window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }))');
    window.webContents.sendInputEvent({ type: 'mouseUp', x, y: endY, button: 'left', clickCount: 1 });
    await wait(30);
  }
  console.log('PASS: real mouse marquee dragging starts in both far margins across the full Notes viewport');
}
app.whenReady().then(async () => {
  try {
    server = http.createServer((request, response) => {
      let file = path.resolve(root, 'dist', '.' + new URL(request.url, 'http://localhost').pathname);
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(403); response.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'dist/index.html');
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    window = new BrowserWindow({ ...windowOptions, show: false, webPreferences: { preload: path.join(root, 'desktop/split-view-proof-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    installApplicationMenu({ app, Menu });
    assert.deepEqual(window.getMinimumSize(), [480, 480]);
    assert.ok(window.isResizable() && window.isFullScreenable());
    assert.equal(Menu.getApplicationMenu().items.find(item => item.label === 'Window').role, 'windowmenu');
    console.log('PASS: native resize, fullscreen, 480px minimum, macOS Window menu');
    await navigate('/Study?chapter_id=1', '.bex-study-page');
    await desktopUnchanged('.bex-study-page');
    await evaluate(`(() => {
      const token = document.querySelector('[data-token-key]');
      token.scrollIntoView({ block: 'center' });
      const range = document.createRange(); range.selectNodeContents(token);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    })()`);
    await ready('[data-testid="button-popover-add-annotation"]');
    await evaluate("document.querySelector('[data-testid=button-popover-add-annotation]').click()");
    await ready('[data-testid="window-annotation"] .ProseMirror');
    const annotationRect = `(() => { const r = document.querySelector('[data-testid=window-annotation]').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`;
    const writingArea = await evaluate(`(() => {
      const editor = document.querySelector('[data-testid=window-annotation] [data-bex-global-editor]');
      const body = editor.parentElement;
      return { padding: getComputedStyle(body).padding, border: getComputedStyle(editor).borderTopWidth,
        radius: getComputedStyle(editor).borderRadius,
        placeholder: editor.querySelector('[data-placeholder]')?.getAttribute('data-placeholder') || '' };
    })()`);
    assert.deepEqual(writingArea, { padding: '0px', border: '0px', radius: '0px', placeholder: '' });
    await capture('annotation-empty');
    const small = await evaluate(annotationRect);
    assert.equal(small.width, 560); assert.equal(small.height, 360);
    await evaluate(`(() => {
      const title = document.querySelector('[data-testid=handle-window-drag]');
      title.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 500, clientY: 300 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 570, clientY: 330 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    })()`);
    await wait(100);
    const dropped = await evaluate(annotationRect);
    assert.equal(dropped.left, small.left + 70); assert.equal(dropped.top, small.top + 30);
    await evaluate(`(() => {
      const editor = document.querySelector('[data-testid=window-annotation] .ProseMirror'); editor.focus();
      const data = new DataTransfer(); data.setData('text/plain', 'x'.repeat(465));
      data.setData('text/html', '<p><strong>' + 'x'.repeat(465) + '</strong></p>');
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    })()`);
    await wait(80);
    assert.equal((await evaluate(annotationRect)).width, 560);
    await evaluate("document.execCommand('insertText', false, 'x')");
    let growing;
    for (let frame = 0; frame < 30; frame++) {
      await wait(16);
      growing = await evaluate(annotationRect);
      if (growing.width > 560) break;
    }
    assert.ok(growing.width > 560 && growing.width < 820, `Auto expansion must animate: ${JSON.stringify(growing)} transition=${await evaluate("getComputedStyle(document.querySelector('[data-testid=window-annotation]')).transition")}`);
    await wait(300);
    assert.equal((await evaluate(annotationRect)).width, 820);
    assert.equal(await evaluate("document.querySelector('[data-testid=window-annotation] .ProseMirror').textContent.length"), 466);
    await evaluate(`(() => {
      const grip = document.querySelector('[data-testid=handle-window-resize]');
      grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 800, clientY: 600 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 700, clientY: 550 }));
    })()`);
    const manual = await evaluate(annotationRect);
    assert.equal(manual.width, 720); assert.equal(manual.height, 510);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-testid=window-annotation]')).transitionDuration"), '0s');
    await evaluate("window.dispatchEvent(new MouseEvent('mouseup'))");
    await wait(80);
    assert.deepEqual(await evaluate(annotationRect), manual, 'Manual resize moves after release');
    await capture('annotation-expanded');
    await resize(480, 480);
    const narrow = await evaluate(annotationRect);
    assert.ok(narrow.left >= 16 && narrow.left + narrow.width <= 464 && narrow.top >= 52 && narrow.top + narrow.height <= 464);
    assert.equal(await evaluate("document.querySelector('[data-testid=window-annotation] .ProseMirror').textContent.length"), 466);
    await evaluate("document.querySelector('[data-testid=button-window-close]').click(); getSelection().removeAllRanges()");
    console.log('PASS: annotation drag release, 465/466 rich-paste and typing boundary, animated growth, immediate resize, and Split View draft retention');
    window.webContents.setBackgroundThrottling(true);
    for (const width of [960, 800, 683, 600, 480]) {
      await resize(width);
      await assertContained('.bex-study-page');
      await assertContained('[data-scripture-root], .verse-content-container');
      await capture(`study-${width}`);
    }
    console.log('PASS: study at 960, 800, 683, 600, 480px');
    await navigate('/LibraryHome', '.bex-library-columns');
    await desktopUnchanged('.bex-library-columns');
    for (const width of [960, 800, 683, 480]) {
      await resize(width);
      await assertContained('[data-testid="library-home"]');
      const cols = await evaluate("getComputedStyle(document.querySelector('.bex-library-columns')).gridTemplateColumns");
      assert.equal(cols.split(' ').length, 1);
    }
    await capture('library-480');
    console.log('PASS: library stacks without horizontal overflow');
    await navigate('/notes/split-view-1', '[data-testid="input-note-title"]');
    await desktopUnchanged('.bex-note-toolbar');
    const before = await evaluate("document.querySelector('.ProseMirror').innerHTML");
    for (const width of [960, 800, 683, 600, 480, 1440]) {
      await resize(width);
      assert.equal(await evaluate("!!document.querySelector('.bex-block-drag-handle.is-visible')"), false, 'Resizing must hide handles positioned for the previous window size');
      await assertContained('.bex-note-toolbar');
      await assertContained('[data-testid="note-zoom-page"]');
      await assertNoteGutters(width);
      assert.equal(await evaluate("document.querySelector('.ProseMirror').innerHTML"), before);
    }
    await assertNativeNoteMarquee();
    assert.equal(await evaluate("document.querySelector('.ProseMirror').innerHTML"), before);
    await resize(480); await capture('note-480');
    console.log('PASS: note gutters retain drag handles, toggle clicks, and left/right marquee selection without changing editor content');
    await navigate('/knowledge-webs/split-view-1', '[data-testid="knowledge-web-viewport"]');
    await desktopUnchanged('.bex-web-header');
    for (const width of [960, 683, 480]) { await resize(width); await assertContained('.bex-web-header'); }
    await capture('web-480');
    console.log('PASS: knowledge web tools fit narrow windows');
    await navigate('/timegraphs/split-view-1', '[data-testid="timegraph-editor"]');
    await desktopUnchanged('[data-testid=\"timegraph-editor\"]');
    await resize(480);
    await evaluate("document.querySelector('[data-testid=timegraph-new-event]').click()");
    await ready('[data-testid="timegraph-panel"]');
    await assertContained('[data-testid="timegraph-panel"]');
    await capture('timeline-480');
    console.log('PASS: timeline event panel fits narrow windows');
    console.log('PASS: expanded desktop geometry, typography, and colors unchanged across all five workspaces');
    console.log(`BEX_SPLIT_VIEW_PROOF ${output}`);
    window.destroy(); server.close(); fs.rmSync(temp, { force: true, recursive: true }); app.exit(0);
  } catch (error) {
    console.error(error.stack);
    if (window) window.destroy(); if (server) server.close(); fs.rmSync(temp, { force: true, recursive: true }); app.exit(1);
  }
});
