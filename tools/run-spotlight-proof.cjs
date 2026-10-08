'use strict';
// Real Chromium layout + native interruption, using the actual shared editor.
// Temporary offline data only; never starts the user's workspace or library.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-spotlight-'));
    await require('esbuild').build({
      entryPoints: [path.join(project, 'tests/fixtures/spotlightJourney.jsx')],
      outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
      alias: { '@/api/desktopClient': path.join(project, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(project, 'src') },
      loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, logLevel: 'warning',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    fs.copyFileSync(path.join(project, 'tests/fixtures/spotlightJourney.html'), path.join(temp, 'index.html'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
      env, cwd: project, encoding: 'utf8', timeout: 45000,
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.signal) console.error('Signal:', result.signal);
    if (result.error) console.error(result.error);
    process.exitCode = result.status === 0 ? 0 : 1;
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'user-data'));
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1100, height: 730, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = source => win.webContents.executeJavaScript(source);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async condition => {
      const deadline = Date.now() + 12000;
      while (!await js(condition)) {
        assert.ok(Date.now() < deadline, 'Timed out: ' + condition);
        await pause(35);
      }
    };
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      await until('window.spotlightProof?.ready()');
      await pause(120);
      await js('spotlightProof.start()');
      await pause(280);
      let state = await js('spotlightProof.snapshot()');
      assert.ok(state.scroll > 0 && !state.sections[0].open);
      console.log('PASS: the real scroll moves over time while the distant dropdown stays closed');
      await until('spotlightProof.snapshot().hit');
      state = await js('spotlightProof.snapshot()');
      assert.equal(state.hit, 'conscience');
      assert.ok(state.hitY > 100 && state.hitY < 650, JSON.stringify(state));
      const samples = await js('spotlightProof.samples()');
      for (let index = 0; index < 2; index += 1) {
        const opening = samples.find(sample => sample.sections[index]?.open);
        assert.ok(opening.sections[index].y > 90 && opening.sections[index].y < 650, JSON.stringify(opening));
      }
      assert.ok(samples.findIndex(sample => sample.sections[0]?.open) < samples.findIndex(sample => sample.sections[1]?.open));
      console.log('PASS: each nested dropdown opens only after its summary enters the viewport');
      assert.ok(samples.filter(sample => sample.scroll > 0 && !sample.hit).length > 10);
      console.log('PASS: the exact word lights up only after the scroll and unfold sequence finishes');
      await pause(450);
      fs.writeFileSync(path.join(temp, 'arrival.png'), (await win.webContents.capturePage()).toPNG());
      await until('spotlightProof.snapshot().fading');
      await pause(300);
      state = await js('spotlightProof.snapshot()');
      assert.ok(state.hit && state.color !== 'rgba(167, 139, 250, 0.52)');
      await until('!spotlightProof.snapshot().hit');
      assert.ok(!(await js('spotlightProof.saved()')).includes('bex-spotlight-hit'));
      console.log('PASS: the highlight fades visibly, disappears, and is not saved as formatting');
      await js('spotlightProof.reset()');
      await pause(100);
      await js('spotlightProof.start()');
      await pause(220);
      win.webContents.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await pause(60);
      const stoppedAt = (await js('spotlightProof.snapshot()')).scroll;
      await pause(1200);
      state = await js('spotlightProof.snapshot()');
      assert.equal(state.scroll, stoppedAt);
      assert.ok(!state.sections[0].open && !state.hit);
      console.log('PASS: a native Escape press cancels movement and all remaining reveals');
      console.log('SCREENSHOT: ' + path.join(temp, 'arrival.png'));
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error); win.destroy(); app.exit(1);
    }
  });
}
