'use strict';

const { app, session } = require('electron');
const fs = require('node:fs');

const reportPath = process.env.BEX_STARTUP_PROOF_REPORT;
const timeoutMs = Number(process.env.BEX_STARTUP_PROOF_TIMEOUT_MS || 30000);
const startedAt = Date.now();
const requests = [];
let finished = false;
let pollTimer = null;
let timeoutTimer = null;

function isLoopbackUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

function writeReport(report) {
  if (!reportPath) return;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function finish(result, exitCode) {
  if (finished) return;
  finished = true;
  if (pollTimer) clearInterval(pollTimer);
  if (timeoutTimer) clearTimeout(timeoutTimer);

  const outsideRequests = requests.filter((request) => request.outside);
  writeReport({
    checkedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    onlineModeEnabled: false,
    outsideRequests,
    requests,
    ...result,
  });
  process.stdout.write(`BEX_STARTUP_PROOF ${JSON.stringify({ ...result, outsideRequests })}\n`);
  app.exit(exitCode);
}

async function readGateState(contents) {
  return contents.executeJavaScript(`(async () => {
    const api = window.bexDesktop;
    if (!api) return { ready: false, reason: 'desktop_bridge_missing' };
    const normalAppVisible = Boolean(document.querySelector('[data-testid="button-globalnav"]'));
    if (!normalAppVisible) {
      return {
        ready: false,
        reason: 'startup_gates_not_finished',
        bodyPreview: (document.body?.innerText || '').slice(0, 500),
      };
    }
    const [library, activation, privacy] = await Promise.all([
      api.getLibraryStatus(),
      api.getActivationStatus(),
      api.getPrivacyStatus(),
    ]);
    return {
      ready: true,
      route: window.location.pathname,
      title: document.title,
      normalAppVisible,
      library,
      activation,
      privacy,
    };
  })()`, true);
}

function watchContents(contents) {
  const check = async () => {
    if (finished || contents.isDestroyed()) return;
    try {
      const state = await readGateState(contents);
      if (!state.ready) return;
      const libraryReady = state.library?.ok === true && state.library.status?.available === true;
      const activationReady = state.activation?.ok === true && state.activation.status?.activated === true;
      const privacyReady = state.privacy?.ok === true && state.privacy.status?.locked === false;
      finish({
        ok: libraryReady && activationReady && privacyReady,
        libraryReady,
        activationReady,
        privacyReady,
        normalAppVisible: state.normalAppVisible,
        route: state.route,
        title: state.title,
        gateState: {
          library: state.library,
          activation: state.activation,
          privacy: state.privacy,
        },
      }, libraryReady && activationReady && privacyReady ? 0 : 1);
    } catch (error) {
      if (!finished) process.stderr.write(`[startup-proof] ${error?.message || error}\n`);
    }
  };

  contents.on('did-finish-load', () => {
    pollTimer = setInterval(check, 200);
    check();
  });

  timeoutTimer = setTimeout(async () => {
    let finalState = null;
    try {
      finalState = await readGateState(contents);
    } catch (error) {
      finalState = { reason: error?.message || String(error) };
    }
    finish({ ok: false, reason: 'startup_timeout', finalState }, 1);
  }, timeoutMs);
}

app.on('web-contents-created', (_event, contents) => watchContents(contents));

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const outside = !isLoopbackUrl(details.url);
      requests.push({
        outside,
        resourceType: details.resourceType,
        url: details.url,
      });
      callback({ cancel: outside });
    },
  );
});
