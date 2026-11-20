'use strict';
// Real home UI and production IPC/preload, with temporary credentials and
// offline library records. No user's vault or existing credentials are opened.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-scripture-'));
    await require('esbuild').build({
      entryPoints: [path.join(project, 'tests/fixtures/scriptureHome.jsx')],
      outfile: path.join(temp, 'fixture.js'), jsx: 'automatic', bundle: true, platform: 'browser', format: 'iife',
      alias: { '@/api/desktopClient': path.join(project, 'tests/fixtures/scriptureDesktopStub.js'), '@shared': path.join(project, 'shared'), '@': path.join(project, 'src') },
      loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.png': 'file' }, logLevel: 'warning',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const styles = fs.readdirSync(path.join(project, 'dist/assets')).filter(name => name.endsWith('.css'))
      .map(name => `<link rel="stylesheet" href="file://${path.join(project, 'dist/assets', name)}">`).join('');
    fs.writeFileSync(path.join(temp, 'index.html'), `<!doctype html><html class="dark"><head>${styles}<link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column;overflow:hidden}body{background:#0f111a;color:#eee;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
      env, cwd: project, encoding: 'utf8', timeout: 75000,
    });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.error) console.error(result.error);
    process.exitCode = result.status === 0 ? 0 : 1;
    if (result.status === 0) {
      const receiptPath = path.join(temp, 'restart-complete.json');
      const deadline = Date.now() + 20000;
      while (!fs.existsSync(receiptPath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(fs.existsSync(receiptPath), 'The new app process must report a successful relaunch');
      const receipt = JSON.parse(fs.readFileSync(receiptPath));
      assert.equal(receipt.ok, true);
      console.log('PASS: full Electron quit/relaunch, different process ID, pending edit saved before close, scripture setup recovered');
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
  const { ScriptureSettings } = require('../desktop/scripture-settings.cjs');
  const { registerScriptureHandlers } = require('../desktop/scripture-ipc.cjs');
  const { registerAppRestartHandler } = require('../desktop/app-restart-ipc.cjs');
  const { createNormalCloseHandler } = require('../desktop/normal-close-backup.cjs');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'user-data'));
  app.whenReady().then(async () => {
    const credentials = path.join(temp, 'scripture-credentials.json');
    const url = require('node:url').pathToFileURL(path.join(temp, 'index.html')).href;
    registerAppRestartHandler({ appUrl: url, ipcMain, app });
    const win = new BrowserWindow({ width: 1440, height: 900, show: false,
      webPreferences: { preload: path.join(project, 'desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on('console-message', (event) => { if (event.level === 'error') console.error('RENDERER:', event.message); });
    win.webContents.on('render-process-gone', (_event, details) => console.error('RENDERER EXIT:', details.reason));
    const js = source => win.webContents.executeJavaScript(source);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async condition => {
      const deadline = Date.now() + 12000;
      while (!await js(condition)) { assert.ok(Date.now() < deadline, 'Timed out: ' + condition); await pause(35); }
    };
    const click = async selector => {
      const p = await js(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...p });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...p });
      await pause(100);
    };
    const openSetup = async () => {
      await click('.scripture-search__unlock');
      await until("document.querySelector('[aria-label=\"API.Bible API key\"]')?.disabled === false");
      await pause(300);
      assert.ok(await js("document.activeElement === document.querySelector('[aria-label=\"API.Bible API key\"]')"));
    };
    const homeReady = "document.querySelector('[data-testid=scripture-search]')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('[data-testid^=\"library-item-\"]').length >= 6";
    try {
      const restartStatePath = path.join(temp, 'restart-request.json');
      if (fs.existsSync(restartStatePath)) {
        const restartState = JSON.parse(fs.readFileSync(restartStatePath));
        assert.notEqual(process.pid, restartState.pid, 'Restart must use a new process, not reload the renderer');
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp, 'restart-stages.json'))), ['write', 'close-database', 'close-services']);
        assert.equal(fs.readFileSync(path.join(temp, 'pending-edit.txt'), 'utf8'), 'latest debounced edit');
        registerScriptureHandlers({ appUrl: url, ipcMain, settings: new ScriptureSettings({ filePath: credentials, safeStorage }) });
        await win.loadURL(url); await until(homeReady); await openSetup();
        assert.equal(await js("Boolean(document.querySelector('[role=alert]'))"), false);
        await win.webContents.insertText('synthetic-restarted-process-key');
        await click('[aria-label="Save API key"]');
        await until("Boolean(document.querySelector('[aria-label=\"Search scripture\"]'))");
        fs.writeFileSync(path.join(temp, 'restart-complete.json'), JSON.stringify({ ok: true, oldPid: restartState.pid, newPid: process.pid }));
        win.destroy(); app.exit(0); return;
      }
      await win.loadURL(url);
      await until(homeReady);
      assert.equal(await js("Boolean(document.querySelector('[role=alert]'))"), false, 'A missing startup handler must not open an error popup');
      assert.equal(await js("Boolean(document.querySelector('[aria-label=\"API.Bible API key\"]'))"), false, 'The key input belongs in the popup');
      // Reproduce a newer renderer in an older running main process.
      await openSetup();
      await win.webContents.insertText('synthetic-old-process-key');
      await pause(100);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await until("Boolean(document.querySelector('[role=alert]'))");
      const recoveryMessage = await js("document.querySelector('[role=alert]').textContent");
      assert.match(recoveryMessage, /Restart BEX once/);
      assert.ok(await js("Boolean(document.querySelector('.scripture-key__restart'))"));
      assert.doesNotMatch(recoveryMessage, /No handler|remote method|scripture:/);
      assert.ok(!fs.existsSync(credentials));
      registerScriptureHandlers({ appUrl: url, ipcMain, settings: new ScriptureSettings({ filePath: credentials, safeStorage }) });
      await win.reload();
      await until(homeReady);
      await pause(350);
      assert.equal(await js("Boolean(document.querySelector('[data-testid=library-create-study]'))"), false);
      const geometry = await js(`(() => {
        const fields=[...document.querySelector('[data-testid=library-search-bars]').children].map(e=>e.getBoundingClientRect().toJSON());
        const columns=['web','note','timeline'].map(c=>document.querySelector('[data-testid=library-create-'+c+']').getBoundingClientRect().toJSON());
        return {fields,columns,body:document.body.scrollWidth,viewport:innerWidth};
      })()`);
      assert.equal(geometry.fields[0].top, geometry.fields[1].top);
      assert.ok(geometry.fields[1].left > geometry.fields[0].right);
      assert.ok(geometry.columns.every(r => Math.abs(r.width - geometry.columns[0].width) < 1));
      assert.equal(geometry.columns[0].top, geometry.columns[2].top);
      assert.ok(geometry.body <= geometry.viewport);
      fs.writeFileSync(path.join(temp, 'locked-home.png'), (await win.webContents.capturePage()).toPNG());
      assert.equal(await js("document.querySelector('.scripture-search__label').textContent"), 'unlock scripture reading here');
      assert.equal(await js("document.querySelectorAll('.scripture-search__particle').length"), 16);
      const reducedMotion = await js("matchMedia('(prefers-reduced-motion: reduce)').matches");
      if (!reducedMotion) {
        const sampleMotion = "(() => { const e=document.querySelector('.scripture-search__particle'); return {particle:getComputedStyle(e).transform,mist:getComputedStyle(document.querySelector('.scripture-search__aura'),'::before').transform}; })()";
        const before = await js(sampleMotion); await pause(850); const after = await js(sampleMotion);
        assert.notEqual(before.particle, after.particle, 'Particles must visibly move between frames');
        assert.notEqual(before.mist, after.mist, 'Mist must drift between frames');
        fs.writeFileSync(path.join(temp, 'locked-home-moving.png'), (await win.webContents.capturePage()).toPNG());
      }
      await openSetup();
      await until("document.querySelector('.scripture-key__logo')?.naturalWidth === 512");
      assert.equal(await js("document.querySelector('.scripture-key__title a').href"), 'https://bible.helloao.org/docs/?ref=faith.tools');
      assert.ok(await js("(() => { const s=getComputedStyle(document.querySelector('.scripture-key__veil')); return s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.backdropFilter === 'none'; })()"), 'The background must stay visible without dimming or blur');
      assert.equal(await js("document.querySelector('[role=dialog]').getBoundingClientRect().width"), 600, 'The desktop card must be larger');
      fs.writeFileSync(path.join(temp, 'key-popup.png'), (await win.webContents.capturePage()).toPNG());
      const moveOnCard = async (fraction) => {
        const p = await js(`(() => { const r=document.querySelector('.scripture-key__card').getBoundingClientRect(); return {x:Math.round(r.left+r.width*${fraction}),y:Math.round(r.top+r.height*${fraction})}; })()`);
        win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
        await pause(300);
        return js("(() => { const surface=document.querySelector('.scripture-key__surface'); return {tilt:surface.style.transform,paint:getComputedStyle(surface).transform}; })()");
      };
      const upperLeft = await moveOnCard(.2);
      const lowerRight = await moveOnCard(.8);
      assert.match(upperLeft.tilt, /rotateX\([\d.]+deg\) rotateY\(-[\d.]+deg\)/);
      assert.match(lowerRight.tilt, /rotateX\(-[\d.]+deg\) rotateY\([\d.]+deg\)/);
      assert.equal(await js("document.querySelectorAll('.scripture-key__surface [data-card-glow], .scripture-key__surface .liquid-glow').length"), 0, 'The popup must retain tilt without cursor glow or particles');
      if (!reducedMotion) assert.notEqual(upperLeft.paint, lowerRight.paint, 'The card must visibly tilt');
      else assert.equal(lowerRight.paint, 'none', 'Reduced motion must disable card rotation');
      fs.writeFileSync(path.join(temp, 'key-popup-tilted.png'), (await win.webContents.capturePage()).toPNG());
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 12, y: 150 });
      await pause(300);
      assert.ok(await js("document.querySelector('.scripture-key__surface').style.transform.includes('rotateX(0deg) rotateY(0deg)')"), 'The card must return to rest on mouse leave');
      await win.webContents.insertText('unsaved-synthetic-draft');
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await until("!document.querySelector('[role=dialog]')");
      await until("document.activeElement === document.querySelector('.scripture-search__unlock')");
      await openSetup();
      assert.equal(await js("document.querySelector('[aria-label=\"API.Bible API key\"]').value"), '');
      await win.webContents.insertText('synthetic-isolated-proof-key');
      await pause(100);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await pause(80);
      assert.ok(await js("document.activeElement === document.querySelector('[aria-label=\"Save API key\"]')"));
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] });
      await pause(80);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await until("Boolean(document.querySelector('[aria-label=\"Search scripture\"]'))");
      assert.ok(!fs.readFileSync(credentials, 'utf8').includes('synthetic-isolated-proof-key'));
      // Verify the production OS decryptor can read the saved envelope, but
      // never print or return the key to the renderer.
      const encrypted = Buffer.from(JSON.parse(fs.readFileSync(credentials, 'utf8')).encryptedKey, 'base64');
      assert.equal(safeStorage.decryptString(encrypted), 'synthetic-isolated-proof-key');
      await win.reload();
      await until("Boolean(document.querySelector('[aria-label=\"Search scripture\"]'))");
      assert.equal(await js("document.querySelector('[aria-label=\"Search scripture\"]').value"), '');
      await click('[aria-label="Manage scripture API key"]');
      await until("Boolean(document.querySelector('[aria-label=\"API.Bible API key\"]'))");
      assert.equal(await js("document.querySelector('[aria-label=\"API.Bible API key\"]').value"), '');
      await click('.scripture-key__footer button');
      await until("document.querySelector('[data-testid=scripture-search]')?.dataset.locked === 'true'");
      assert.ok(!fs.existsSync(credentials));
      win.setSize(680, 760); await pause(300);
      assert.ok(await js('document.body.scrollWidth <= innerWidth'));
      assert.ok(await js("(() => { const label=document.querySelector('.scripture-search__label'); return label.scrollWidth <= label.clientWidth; })()"), 'Compact layout must show the entire unlock label');
      fs.writeFileSync(path.join(temp, 'compact-home.png'), (await win.webContents.capturePage()).toPNG());
      win.setSize(390, 700); await pause(200); await openSetup();
      assert.ok(await js("(() => { const r=document.querySelector('[role=dialog]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()"));
      fs.writeFileSync(path.join(temp, 'compact-popup.png'), (await win.webContents.capturePage()).toPNG());
      win.setSize(390, 340); await pause(300);
      assert.ok(await js("(() => { const r=document.querySelector('[role=dialog]').getBoundingClientRect(); const content=document.querySelector('.scripture-key__content'); return r.top >= 0 && r.bottom <= innerHeight && content.scrollHeight > content.clientHeight; })()"), 'Short viewports must keep the card visible with scrollable content');
      await js("document.querySelector('.scripture-key__content').scrollTop = 1000");
      assert.ok(await js("(() => { const r=document.querySelector('.scripture-key__submit').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"), 'The save button must stay reachable in short viewports');
      console.log('PASS: larger card, clear backdrop, native mouse tilt without popup glow or particles');
      console.log('PASS: unavailable startup handler stays quiet; explicit save shows a safe recovery message');
      console.log('PASS: moving mist and 16 animated particles' + (reducedMotion ? ' (system reduced motion respected)' : ' (different animation frames verified)'));
      console.log('PASS: native popup focus, Tab, Escape, discarded drafts, and compact popup layout');
      console.log('PASS: three equal library columns, adjacent search bars, and responsive layout');
      console.log('PASS: native Enter saves key via trusted IPC, actual OS encryption and decryption verified');
      console.log('PASS: reopening remembers setup without revealing the key; removal returns to the locked state');
      console.log('SCREENSHOTS: ' + temp);
      // Exercise the actual recovery button and production relaunch API.
      // The reopened process verifies both cleanup and the last pending edit.
      ipcMain.removeHandler('scripture:save-key');
      win.setSize(1440, 900); await pause(300);
      await click('[aria-label="API.Bible API key"]');
      await win.webContents.insertText('synthetic-restart-recovery-key');
      await click('[aria-label="Save API key"]');
      await until("Boolean(document.querySelector('.scripture-key__restart'))");
      const stages = [];
      const record = stage => { stages.push(stage); fs.writeFileSync(path.join(temp, 'restart-stages.json'), JSON.stringify(stages)); };
      ipcMain.handle('local-entity:update', async (_event, _type, id, patch) => {
        await pause(450);
        fs.writeFileSync(path.join(temp, 'pending-edit.txt'), patch.content);
        record('write');
        return { ok: true, record: { id, ...patch } };
      });
      app.on('before-quit', createNormalCloseHandler({
        app,
        closeDatabase: () => { assert.equal(stages[0], 'write'); record('close-database'); },
        closeServices: () => record('close-services'),
      }));
      fs.writeFileSync(restartStatePath, JSON.stringify({ pid: process.pid }));
      await js('window.queueRestartProofEdit()');
      await click('.scripture-key__restart');
    } catch (error) {
      console.error(error);
      fs.writeFileSync(path.join(temp, 'failure.png'), (await win.webContents.capturePage()).toPNG());
      console.error('DOM:', await js('document.body.innerText'));
      console.error('SCREENSHOTS: ' + temp); win.destroy(); app.exit(1);
    }
  });
}
