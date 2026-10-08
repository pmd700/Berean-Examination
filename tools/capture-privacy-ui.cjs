'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const outputChecking = path.join(projectRoot, '.bex-privacy-checking.png');
const outputSuccess = path.join(
  projectRoot,
  process.env.BEX_PRIVACY_PREVIEW_MODE === 'pin'
    ? '.bex-privacy-pin.png'
    : '.bex-privacy-success.png',
);
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
});

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function startServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    const candidate = path.resolve(distRoot, `.${requestPath}`);
    const safeCandidate = candidate === distRoot || candidate.startsWith(`${distRoot}${path.sep}`);
    let filePath = safeCandidate ? candidate : null;
    try {
      if (!filePath || !fs.statSync(filePath).isFile()) filePath = path.join(distRoot, 'index.html');
    } catch {
      filePath = path.join(distRoot, 'index.html');
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

app.setName('BEX Privacy Visual Proof');
app.whenReady().then(async () => {
  let server;
  try {
    const started = await startServer();
    server = started.server;
    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      backgroundColor: '#080a10',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(projectRoot, 'desktop', 'privacy-ui-preview-preload.cjs'),
        sandbox: true,
      },
    });
    await window.loadURL(started.url);
    await wait(460);
    fs.writeFileSync(outputChecking, (await window.webContents.capturePage()).toPNG());
    await wait(640);
    fs.writeFileSync(outputSuccess, (await window.webContents.capturePage()).toPNG());
    process.stdout.write(`${outputChecking}\n${outputSuccess}\n`);
    window.destroy();
    server.close();
    app.exit(0);
  } catch (error) {
    if (server) server.close();
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
