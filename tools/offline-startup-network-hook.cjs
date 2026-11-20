'use strict';

const assert = require('node:assert/strict');
const { app, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const reportPath = process.env.BEX_STARTUP_PROOF_REPORT;
const proofRoot = fs.realpathSync(process.env.BEX_STARTUP_PROOF_ROOT);
const timeoutMs = Number(process.env.BEX_STARTUP_PROOF_TIMEOUT_MS || 45000);
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist', '.vite', 'manifest.json'), 'utf8'));
const startedAt = Date.now();
const requests = [];
const rendererErrors = [];
const routesVerified = [];
const deferredPagesVerified = [];
let phase = 'startup';
let finished = false;

function isLoopbackUrl(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch { return false; }
}

function finish(result, exitCode) {
  if (finished) return;
  finished = true;
  const outsideRequests = requests.filter(request => request.outside);
  const report = {
    checkedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt,
    onlineModeEnabled: false,
    proofScope: 'Built production desktop main, preload, renderer and real local IPC. Network observation covers the Electron default session.',
    routesVerified, deferredPagesVerified, outsideRequests, rendererErrors, requests, ...result,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write('BEX_STARTUP_PROOF ' + JSON.stringify({ ...result, routesVerified, deferredPagesVerified, outsideRequests, rendererErrors }) + '\n');
  try { require('../desktop/database.cjs').closeDatabase(); } catch { /* Preserve the proof failure. */ }
  app.exit(exitCode);
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readGateState(contents) {
  return contents.executeJavaScript(`(async () => {
    const api = window.bexDesktop;
    if (!api) return { ready: false, reason: 'desktop_bridge_missing' };
    const normalAppVisible = Boolean(document.querySelector('[data-testid="workspace-tab-bar"]'));
    if (!normalAppVisible || !document.querySelector('[data-testid="library-home"]')) {
      return { ready: false, bodyPreview: (document.body?.innerText || '').slice(0, 500) };
    }
    const [library, privacy] = await Promise.all([
      api.getLibraryStatus(), api.getPrivacyStatus(),
    ]);
    return { ready: true, normalAppVisible, library, privacy };
  })()`, true);
}

function watchContents(contents) {
  contents.on('console-message', event => {
    if (event.level === 'error') rendererErrors.push(event.message);
  });
  contents.on('render-process-gone', (_event, detail) => finish({ ok: false, reason: 'renderer_gone', detail }, 1));
  contents.once('did-finish-load', async () => {
    const js = source => contents.executeJavaScript(source, true);
    const until = async (predicate, description) => {
      while (!finished && Date.now() - startedAt < timeoutMs) {
        const value = await predicate();
        if (value) return value;
        await pause(100);
      }
      throw new Error('Timed out waiting for ' + description);
    };
    const visible = selector => js("Boolean(document.querySelector('[data-pane-active=\"true\"]')?.querySelector(" + JSON.stringify(selector) + '))');
    const click = async selector => {
      const point = await js("(() => { const element = document.querySelector('[data-pane-active=\"true\"]')?.querySelector(" + JSON.stringify(selector) + "); if (!element) throw new Error('UI control missing'); const rect = element.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; })()");
      contents.sendInputEvent({ type: 'mouseMove', ...point });
      contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    };
    const pageRequests = page => {
      const file = manifest['src/pages/' + page + '.jsx']?.file;
      assert.ok(file, 'Missing built manifest entry for ' + page);
      return requests.filter(request => new URL(request.url).pathname === '/' + file);
    };
    try {
      const state = await until(async () => {
        const next = await readGateState(contents);
        return next.ready ? next : null;
      }, 'normal Library page and startup gates');
      const libraryReady = state.library?.ok === true && state.library.status?.available === true;
      const privacyReady = state.privacy?.ok === true && state.privacy.status?.locked === false;
      const disposableLibrary = state.library.status.path === path.join(proofRoot, 'library');
      assert.ok(libraryReady && privacyReady && disposableLibrary, 'Startup gates did not accept the disposable library.');
      routesVerified.push('LibraryHome');
      assert.ok(pageRequests('LibraryHome').length, 'The production Library module must load.');
      for (const page of ['Stats', 'Courses']) assert.equal(pageRequests(page).length, 0, page + ' must remain deferred at startup.');

      phase = 'Stats';
      await click('[aria-label="Open Stats"]');
      await until(() => js("window.location.pathname === '/Stats' && [...document.querySelectorAll('[data-pane-active=\"true\"] h1')].some(node => node.textContent === 'Stats')"), 'lazy Stats page');
      assert.ok(pageRequests('Stats').some(request => request.phase === 'Stats'));
      routesVerified.push('Stats'); deferredPagesVerified.push('Stats');
      await click('[data-testid="back-to-library-home"]');
      await until(() => visible('[data-testid="library-home"]'), 'return to Library');

      phase = 'Courses';
      await click('button[title="Courses"]');
      await until(async () => await visible('[data-testid="courses-empty-state"]') && await js("window.location.pathname === '/Courses'"), 'lazy empty Courses library');
      assert.ok(pageRequests('Courses').some(request => request.phase === 'Courses'));
      routesVerified.push('Courses'); deferredPagesVerified.push('Courses');
      await click('[data-testid="back-to-library-home"]');
      await until(() => visible('[data-testid="library-home"]'), 'final Library page');
      routesVerified.push('LibraryHome');
      phase = 'settle';
      await pause(500);
      assert.deepEqual(rendererErrors, []);
      assert.deepEqual(requests.filter(request => request.outside), []);
      finish({ ok: true, libraryReady, privacyReady, disposableLibrary, normalAppVisible: state.normalAppVisible }, 0);
    } catch (error) {
      let finalState;
      try { finalState = await readGateState(contents); } catch { /* Keep the initial error. */ }
      finish({ ok: false, reason: error.stack || String(error), phase, finalState }, 1);
    }
  });
}

app.on('web-contents-created', (_event, contents) => watchContents(contents));
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const outside = !isLoopbackUrl(details.url);
      requests.push({ outside, phase, resourceType: details.resourceType, url: details.url });
      callback({ cancel: outside });
    },
  );
});
setTimeout(() => finish({ ok: false, reason: 'startup_timeout', phase }, 1), timeoutMs);
