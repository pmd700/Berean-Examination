'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, protocol, safeStorage } = require('electron');
const database = require('./database.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');
const { registerLocalEntityHandlers } = require('./local-entity-ipc.cjs');
const { registerPrivacyHandlers } = require('./privacy-ipc.cjs');
const { registerLocalAttachmentHandlers } = require('./local-attachments-ipc.cjs');
const { AttachmentExternalCopies } = require('./local-attachments.cjs');
const { registerLocalMediaProtocol, registerLocalMediaScheme } = require('./local-media-protocol.cjs');

const phase = process.argv[2];
const proofRoot = path.resolve(process.argv[3]);
const libraryPath = path.join(proofRoot, 'Disposable Berean Library');
const sourceFolder = path.join(proofRoot, 'Source fixtures');
const appUrl = process.env.BEX_ATTACHMENT_PROOF_URL;
const fixtures = JSON.parse(fs.readFileSync(path.join(proofRoot, 'fixtures.json'), 'utf8'));
const manifestPath = path.join(proofRoot, 'attachment-state.json');
const checks = [];
const externalRequests = [];
let selectedPaths = [];
let win;
let externalCopies;
let rendererCrashed = false;

assert.ok(['create', 'reopen'].includes(phase));
assert.ok(appUrl?.startsWith('http://127.0.0.1:'));
app.setName('BEX Launcher Official');
app.setPath('userData', path.join(proofRoot, `electron-${phase}`));
// A hidden proof window does not need hardware composition; native media
// decoding and PDF canvas rendering still run in the actual Chromium renderer.
app.disableHardwareAcceleration();
// Continue the storage checks after closing the disposable renderer window.
app.on('window-all-closed', () => {});
if (process.platform === 'darwin' && app.dock) app.dock.hide();
registerLocalMediaScheme(protocol);

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function js(source) {
  assert.equal(rendererCrashed, false, 'The isolated renderer crashed');
  let timer;
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(source),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Renderer script timed out: ${source.slice(0, 120)}`)), 15000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function until(source, message = source, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (!await js(source)) {
    assert.ok(Date.now() < deadline, `Timed out: ${message}`);
    await pause(50);
  }
}
async function click(selector) {
  await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);
  await pause(50);
  const point = await js(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing click target: ' + ${JSON.stringify(selector)});
    const bounds = element.getBoundingClientRect();
    return {x:Math.round(bounds.x+bounds.width/2), y:Math.round(bounds.y+bounds.height/2)};
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await pause(100);
}
async function attachmentSelector(name) {
  await js(`(() => {
    const block=Array.from(document.querySelectorAll('[data-testid="file-attachment"]')).find(element => element.querySelector('[data-testid="file-attachment-open"]')?.textContent.trim() === ${JSON.stringify(name)});
    if(!block)throw new Error('Missing attachment: '+${JSON.stringify(name)});
    block.setAttribute('data-proof-name',${JSON.stringify(name)});
  })()`);
  return `[data-testid="file-attachment"][data-proof-name=${JSON.stringify(name)}]`;
}
async function clickAttachment(name, action = 'open') {
  await click(`${await attachmentSelector(name)} [data-testid="file-attachment-${action}"]`);
}
async function showPreview(name) {
  await clickAttachment(name, 'options');
  await until(`Boolean(document.querySelector('[data-testid="file-attachment-preview-toggle"]'))`, 'preview option opens');
  await click('[data-testid="file-attachment-preview-toggle"]');
  await until(`!document.querySelector('[data-testid="file-attachment-preview-toggle"]') && getComputedStyle(document.body).pointerEvents !== 'none'`, 'preview menu finishes closing');
}
async function clickViewerAction(label) {
  await js(`(() => {
    const button=Array.from(document.querySelectorAll('[data-testid="attachment-viewer"] button')).find(element => (element.getAttribute('aria-label') || element.textContent).trim() === ${JSON.stringify(label)});
    if(!button)throw new Error('Missing viewer action: '+${JSON.stringify(label)});
    button.setAttribute('data-proof-button',${JSON.stringify(label)});
  })()`);
  await click(`[data-testid="attachment-viewer"] button[data-proof-button=${JSON.stringify(label)}]`);
}
function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
function walkFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(folder, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : entry.isFile() ? [filePath] : [];
  });
}
function assertNoPlaintext() {
  const secrets = [fixtures.privateMarker, ...Object.values(fixtures.names)];
  for (const folderName of ['Database', 'Media', 'Backups']) {
    for (const filePath of walkFiles(path.join(libraryPath, folderName))) {
      const bytes = fs.readFileSync(filePath);
      for (const secret of secrets) {
        assert.equal(bytes.includes(Buffer.from(secret)), false, `Private plaintext found in ${filePath}`);
      }
    }
  }
}
async function mediaBytes(url, options) {
  const media = await database.readLocalMedia(url, options);
  let bytes;
  if (media.bytes) bytes = Buffer.from(media.bytes);
  else bytes = Buffer.from(await new Response(media.body).arrayBuffer());
  return { ...media, bytes };
}
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function openRenderer() {
  process.stderr.write('PROOF: opening isolated renderer\n');
  win = new BrowserWindow({
    width: 1100, height: 850, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  const unexpectedNetwork = [];
  win.webContents.on('did-start-loading', () => process.stderr.write('PROOF: renderer loading\n'));
  win.webContents.on('dom-ready', () => process.stderr.write('PROOF: renderer DOM ready\n'));
  win.webContents.on('did-finish-load', () => process.stderr.write('PROOF: renderer loaded\n'));
  win.webContents.on('did-fail-load', (_event, code, description, url) => process.stderr.write(`PROOF: load failed ${code} ${description} ${url}\n`));
  win.webContents.on('render-process-gone', (_event, details) => {
    rendererCrashed = true;
    process.stderr.write(`PROOF: renderer exited ${JSON.stringify(details)}\n`);
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const isRemote = /^https?:/.test(details.url) && !details.url.startsWith(`${appUrl}/`);
    if (isRemote) unexpectedNetwork.push(details.url);
    callback({ cancel: isRemote });
  });
  win.webContents.on('console-message', (_event, ...details) => {
    // Preserve useful PDF or renderer diagnostics without dumping all Vite logs.
    const message = details.find(value => value && typeof value === 'object' && typeof value.message === 'string')?.message || details.find(value => typeof value === 'string');
    if (message && (/error|failed|uncaught|proof/i.test(message))) process.stderr.write(`RENDERER: ${message}\n`);
  });
  await Promise.race([
    win.loadURL(`${appUrl}/__attachment_proof.html`),
    new Promise((_, reject) => setTimeout(() => reject(new Error('The isolated Electron page did not finish loading within 45 seconds')), 45000)),
  ]);
  await until('Boolean(window.attachmentProof?.ready())', 'real note editor ready');
  process.stderr.write('PROOF: editor script ready\n');
  win.showInactive();
  return unexpectedNetwork;
}

async function closeViewer() {
  const label = await js(`(() => {
    const viewer=document.querySelector('[data-testid="attachment-viewer"]');
    if(!viewer)return null;
    return Array.from(viewer.querySelectorAll('button')).find(button => /close/i.test(button.getAttribute('aria-label') || button.textContent))?.getAttribute('aria-label');
  })()`);
  if (label) await click(`[data-testid="attachment-viewer"] button[aria-label=${JSON.stringify(label)}]`);
  else key('Escape');
  await until(`!document.querySelector('[data-testid="attachment-viewer"]')`, 'viewer closes');
}

async function exercisePdf() {
  await clickAttachment(fixtures.names.pdf);
  await until(`Boolean(document.querySelector('[data-testid="attachment-viewer"] .react-pdf__Page canvas'))`, 'PDF.js renders first page');
  await until(`document.body.innerText.includes('Page 1 of 2')`, 'PDF page count');
  const canvas = await js(`(() => { const c=document.querySelector('[data-testid="attachment-viewer"] .react-pdf__Page canvas');const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return {width:c.width,height:c.height,colored:Array.from(p).some((v,i)=>i%4!==3&&v<230)}; })()`);
  assert.ok(canvas.width > 50 && canvas.height > 50 && canvas.colored, 'PDF must contain rendered pixels');
  await click('[data-testid="attachment-viewer"] button[aria-label="Next page"]');
  await until(`document.body.innerText.includes('Page 2 of 2')`, 'PDF navigation to second page');
  await until(`Boolean(document.querySelector('[data-testid="attachment-viewer"] .react-pdf__Page[data-page-number="2"] canvas'))`, 'second PDF page is rendered');
  const beforeZoom = await js(`document.querySelector('[data-testid="attachment-viewer"] .react-pdf__Page canvas').getBoundingClientRect().width`);
  await click('[data-testid="attachment-viewer"] button[aria-label="Zoom in"]');
  await until(`document.querySelector('[data-testid="attachment-viewer"] .react-pdf__Page canvas')?.getBoundingClientRect().width > ${beforeZoom}`, 'PDF zoom changes rendered size');
  await click('[data-testid="attachment-viewer"] button[aria-label="Previous page"]');
  await until(`document.body.innerText.includes('Page 1 of 2')`, 'PDF navigation back to first page');
  await clickViewerAction('Open in default app');
  assert.equal(externalRequests.at(-1)?.url.includes('.pdf'), true, 'supported PDF has a clean default-app action');
  fs.writeFileSync(path.join(proofRoot, `attachment-pdf-${phase}.png`), (await win.webContents.capturePage()).toPNG());
  await closeViewer();
  checks.push('PDF.js renders real PDF pixels, navigates both pages, zooms, and exposes Open in default app');
}

async function exerciseMedia(kind) {
  const name = fixtures.names[kind];
  await clickAttachment(name);
  const mediaSelector = `[data-testid="attachment-${kind}"]`;
  await until(`document.querySelector(${JSON.stringify(mediaSelector)})?.readyState >= 2`, `${kind} decodes encrypted vault bytes`);
  const start = await js(`document.querySelector(${JSON.stringify(mediaSelector)}).currentTime`);
  await js(`document.querySelector(${JSON.stringify(mediaSelector)}).play().then(()=>true)`);
  await until(`document.querySelector(${JSON.stringify(mediaSelector)}).currentTime > ${start + 0.3}`, `${kind} playback advances`);
  const state = await js(`(() => { const m=document.querySelector(${JSON.stringify(mediaSelector)});m.pause();return {duration:m.duration,error:m.error?.code,width:m.videoWidth,controls:m.controls}; })()`);
  assert.ok(state.duration >= 2 && !state.error && state.controls, `valid native ${kind} player: ${JSON.stringify(state)}`);
  if (kind === 'video') assert.equal(state.width, 160);
  await clickViewerAction('Open in default app');
  assert.equal(externalRequests.at(-1)?.url.includes(kind === 'audio' ? '.wav' : '.webm'), true);
  await closeViewer();
  checks.push(`Chromium's built-in ${kind} player decodes, plays, and offers default-app opening`);
}

async function createPhase(protector) {
  database.initializeDatabase(libraryPath, { privacyProtector: protector });
  const note = database.createLocalEntity('MindNote', { title: 'Disposable attachment note', content: '<p></p>' });
  const sourcePaths = ['pdf', 'audio', 'video', 'other'].map(kind => path.join(sourceFolder, fixtures.names[kind]));
  const originalDigests = Object.fromEntries(sourcePaths.map(filePath => [path.basename(filePath), digest(fs.readFileSync(filePath))]));
  const expectedRange = fs.readFileSync(path.join(sourceFolder, fixtures.names.other)).subarray(1048544, 1048641).toString('hex');
  selectedPaths = sourcePaths;
  const unexpectedNetwork = await openRenderer();
  process.stderr.write('PROOF: focus note\n');
  await js('attachmentProof.focusEnd()');
  await pause(250);
  process.stderr.write('PROOF: type slash\n');
  await win.webContents.insertText('/');
  await until(`Boolean(document.querySelector('[data-testid="button-slash-file"]'))`, '/ menu lists File');
  process.stderr.write('PROOF: slash menu visible\n');
  await win.webContents.insertText('file');
  await until(`Boolean(document.querySelector('[data-testid="button-slash-file"]'))`, '/file filters File');
  await click('[data-testid="button-slash-file"]');
  await until(`document.querySelectorAll('[data-testid="file-attachment"]').length === 4`, 'native picker imports four compact attachment icons');
  await js('attachmentProof.saved()');
  const json = await js('attachmentProof.snapshot()');
  const attachments = json.json.content.filter(node => node.type === 'fileAttachment').map(node => node.attrs);
  assert.equal(attachments.length, 4, JSON.stringify(json));
  assert.ok(attachments.every(item => item.display === 'icon'), 'new attachments default to compact icons');
  assert.equal(await js(`document.querySelectorAll('[data-testid="attachment-preview"]').length`), 0);
  for (const attachment of attachments) {
    const stored = await mediaBytes(attachment.url);
    assert.equal(digest(stored.bytes), originalDigests[attachment.name]);
    stored.bytes.fill(0);
  }
  checks.push('typing / lists File, /file imports native-picker files into minimal named icons and encrypted vault storage');

  // Delete source originals before viewers run: every successful read must use the vault.
  for (const filePath of sourcePaths) fs.unlinkSync(filePath);
  const otherAttachment = attachments.find(item => item.name === fixtures.names.other);
  const fetchedRange = await js(`fetch(${JSON.stringify(otherAttachment.url)},{headers:{Range:'bytes=1048544-1048640'}}).then(async response=>({status:response.status,range:response.headers.get('Content-Range'),bytes:Array.from(new Uint8Array(await response.arrayBuffer())).map(v=>v.toString(16).padStart(2,'0')).join('')}))`);
  assert.equal(fetchedRange.status, 206);
  assert.equal(fetchedRange.bytes, expectedRange);
  assert.equal(fetchedRange.range, `bytes 1048544-1048640/${otherAttachment.size}`);
  checks.push('Electron media protocol serves exact byte ranges across encrypted chunk boundaries');
  await exercisePdf();
  await exerciseMedia('audio');
  await exerciseMedia('video');
  const beforeDefault = externalRequests.length;
  await clickAttachment(fixtures.names.other);
  assert.equal(externalRequests.length, beforeDefault + 1);
  assert.equal(externalRequests.at(-1).url, attachments.find(item => item.name === fixtures.names.other).url);
  assert.equal(await js(`Boolean(document.querySelector('[data-testid="attachment-viewer"]'))`), false);
  checks.push('unsupported files dispatch directly to the default app without a prompt or internal viewer (external opening safely stubbed)');

  await showPreview(fixtures.names.pdf);
  await until(`Boolean(document.querySelector('[data-testid="attachment-preview"] .react-pdf__Page canvas'))`, 'PDF thumbnail preview');
  await showPreview(fixtures.names.audio);
  await until(`Boolean(document.querySelector('audio[aria-label=${JSON.stringify(`Audio preview: ${fixtures.names.audio}`)}]'))`, 'audio inline player preview');
  await showPreview(fixtures.names.video);
  const videoBlock = await attachmentSelector(fixtures.names.video);
  await until(`document.querySelector(${JSON.stringify(`${videoBlock} video`)})?.readyState >= 2`, 'video preview first frame');
  await js('attachmentProof.saved()');
  const savedHtml = database.getLocalEntity('MindNote', note.id).content;
  win.webContents.reload();
  await until('Boolean(window.attachmentProof?.ready())', 'editor ready after reload');
  assert.equal(await js('attachmentProof.html()'), savedHtml);
  await until(`document.querySelectorAll('[data-testid="attachment-preview"]').length === 3`, 'user-selected previews survive reload');
  checks.push('PDF thumbnail, audio controls, and first-frame video previews are optional and persist in encrypted notes after reload');
  fs.writeFileSync(path.join(proofRoot, 'attachment-preview.png'), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(unexpectedNetwork, [], 'all viewer code, workers, PDF assets, and vault media stay local');
  checks.push('the real Electron renderer loads viewers and PDF worker locally with all external HTTP requests blocked');
  win.destroy(); win = null;

  // Existing screenshot image insertion must share the organized encrypted Media tree.
  const image = database.saveLocalImage({ bytes: fs.readFileSync(path.join(sourceFolder, fixtures.names.image)), mimeType: 'image/png', name: fixtures.names.image });
  assert.ok(image.url.startsWith('bex-media://library/'));
  const backup = await database.createLocalBackup();
  const backupPath = path.join(libraryPath, 'Backups', backup.fileName);
  assert.ok(fs.existsSync(`${backupPath}.media`), 'backup has its encrypted Media companion');
  const pdfAttachment = attachments.find(item => item.kind === 'pdf');
  const pdfFileName = new URL(pdfAttachment.url).pathname.slice(1);
  const pdfStoredPath = walkFiles(path.join(libraryPath, 'Media')).find(filePath => path.basename(filePath) === pdfFileName);
  assert.ok(pdfStoredPath, 'PDF is physically stored under Library/Media');
  database.updateLocalEntity('MindNote', note.id, { content: '<p>Changed after snapshot</p>' });
  fs.unlinkSync(pdfStoredPath);
  await database.restoreLocalBackup(backupPath, { privacyProtector: protector });
  assert.equal(database.getLocalEntity('MindNote', note.id).content, savedHtml);
  assert.equal(digest((await mediaBytes(pdfAttachment.url)).bytes), originalDigests[pdfAttachment.name]);
  checks.push('local backup and restore recover both encrypted note attachment references and missing encrypted media bytes');
  fs.writeFileSync(pdfStoredPath, 'Corrupted live encrypted attachment');
  await database.restoreLocalBackup(backupPath, { privacyProtector: protector });
  const recoveredPdf = await mediaBytes(pdfAttachment.url);
  assert.equal(digest(recoveredPdf.bytes), originalDigests[pdfAttachment.name]);
  recoveredPdf.bytes.fill(0);
  checks.push('a verified backup replaces a corrupted existing vault attachment with the original encrypted bytes');
  fs.writeFileSync(manifestPath, JSON.stringify({ noteId: note.id, attachments, originalDigests, savedHtml, image }));
  database.closeDatabase();
  assertNoPlaintext();
  checks.push('filenames, PDF text, and attachment content are absent from plaintext Database, Media, and Backups');
}

async function reopenPhase(protector) {
  const state = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  database.initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(database.getLocalEntity('MindNote', state.noteId).content, state.savedHtml);
  for (const attachment of state.attachments) {
    const stored = await mediaBytes(attachment.url);
    assert.equal(digest(stored.bytes), state.originalDigests[attachment.name]);
    stored.bytes.fill(0);
  }
  assert.equal((await mediaBytes(state.image.url)).mimeType, 'image/png');
  const unexpectedNetwork = await openRenderer();
  assert.equal(await js('attachmentProof.html()'), state.savedHtml);
  assert.deepEqual(await js(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(new Error('Vault screenshot could not render'));image.src=${JSON.stringify(state.image.url)};})`), { width: 1, height: 1 });
  checks.push('existing screenshot images render through the origin-protected media protocol after organized vault storage');
  await until(`document.querySelectorAll('[data-testid="attachment-preview"]').length === 3`, 'preview preferences survive a second Electron launch');
  await until(`Boolean(document.querySelector('[data-testid="attachment-preview"] .react-pdf__Page canvas'))`, 'vault PDF preview renders after restart');
  await exercisePdf();
  await clickAttachment(fixtures.names.audio);
  await until(`document.querySelector('[data-testid="attachment-audio"]')?.readyState >= 2`, 'audio is ready before vault lock');
  await js(`window.proofLockedAudio=document.querySelector('[data-testid="attachment-audio"]');proofLockedAudio.play().then(()=>true)`);
  database.lockPrivacyVault();
  externalCopies.cleanup();
  win.webContents.send('privacy:status-changed', { locked: true });
  await until(`!document.querySelector('[data-testid="attachment-viewer"]') && !document.querySelector('[data-testid="attachment-preview"]')`, 'vault lock removes viewer and previews');
  assert.deepEqual(await js(`({paused:proofLockedAudio.paused,src:proofLockedAudio.getAttribute('src')})`), { paused: true, src: null });
  await assert.rejects(() => mediaBytes(state.attachments[0].url), error => error?.code === 'BEX_PRIVACY_LOCKED');
  assert.equal(await js(`fetch(${JSON.stringify(state.attachments[0].url)}).then(response=>response.status)`), 423);
  database.unlockPrivacyAutomatically();
  win.webContents.send('privacy:status-changed', { locked: false });
  await until(`document.querySelectorAll('[data-testid="attachment-preview"]').length === 3`, 'unlock restores chosen previews');
  checks.push('locking a playing vault file stops and clears native audio, removes all previews, and blocks protocol reads until unlock');
  assert.deepEqual(unexpectedNetwork, []);
  win.destroy(); win = null;
  database.closeDatabase();
  assertNoPlaintext();
  checks.push('a second real Electron launch reopens the encrypted note, all exact file bytes, screenshot, and chosen previews');
  checks.push('vault lock prevents attachment reads; private content remains encrypted after restart');
}

app.whenReady().then(async () => {
  try {
    assert.equal(safeStorage.isEncryptionAvailable(), true, 'macOS protected storage is unavailable');
    const protector = createSafeStorageProtector(safeStorage);
    registerLocalEntityHandlers({ appUrl, ipcMain, ...database });
    registerPrivacyHandlers({ appUrl, ipcMain, ...database });
    externalCopies = new AttachmentExternalCopies({
      tempRoot: path.join(proofRoot, 'external-copies'), readLocalMedia: database.readLocalMedia,
      assertUnlocked: database.assertLocalFilesAvailable,
    });
    registerLocalAttachmentHandlers({
      appUrl, ipcMain,
      assertUnlocked: database.assertLocalFilesAvailable,
      chooseFiles: async () => ({ canceled: selectedPaths.length === 0, filePaths: selectedPaths }),
      saveLocalFile: database.saveLocalFile,
      rollbackLocalFile: database.rollbackLocalFile,
      openLocalFile: url => externalCopies.open(url, async filePath => {
        // Never open the user's external applications in a regression proof.
        assert.ok(filePath.startsWith(path.join(proofRoot, 'external-copies')));
        assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
        externalRequests.push({ url, digest: digest(fs.readFileSync(filePath)), filePath });
        return '';
      }),
    });
    registerLocalMediaProtocol({ protocol, readLocalMedia: database.readLocalMedia, trustedOrigin: appUrl });
    if (phase === 'create') await createPhase(protector);
    else await reopenPhase(protector);
    externalCopies.cleanup();
    assert.equal(walkFiles(path.join(proofRoot, 'external-copies')).length, 0);
    checks.push('default-app handoff uses private temporary copies and cleanup removes those plaintext copies');
    process.stdout.write(`BEX_ATTACHMENT_PROOF ${JSON.stringify({ phase, checks })}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    if (win && !win.isDestroyed() && !rendererCrashed) {
      try {
        process.stderr.write(`STATE: ${JSON.stringify(await js('window.attachmentProof?.snapshot()'))}\n`);
        fs.writeFileSync(path.join(proofRoot, `failure-${phase}.png`), (await win.webContents.capturePage()).toPNG());
      } catch { /* Preserve the original proof failure. */ }
      win.destroy();
    }
    database.closeDatabase();
    externalCopies?.cleanup();
    app.exit(1);
  }
});
