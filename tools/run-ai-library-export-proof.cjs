'use strict';
// Real Home button + native export IPC + disposable encrypted SQLite. No user library.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const database = require('../desktop/database.cjs');
const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-ai-export-'));
const library = path.join(temp, 'Library');
for (const dir of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(library, dir), { recursive: true });
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, server;
app.whenReady().then(async () => {
  try {
    database.initializeDatabase(library, { privacyProtector: createSafeStorageProtector(safeStorage) });
    const { DatabaseSync } = require('node:sqlite');
    const seed = new DatabaseSync(path.join(library, 'Database', database.DATABASE_FILE_NAME));
    seed.prepare('INSERT OR IGNORE INTO local_owner (singleton_id, owner_id, display_name, created_at, updated_at, preferences_json) VALUES (1, ?, ?, ?, ?, ?)')
      .run('export-fixture-owner', 'Fixture Owner', new Date().toISOString(), new Date().toISOString(), '{"theme":"dark"}'); seed.close();
    const chapter = database.createLocalEntity('StudyChapter', { book: 'John', chapter_number: 20, version: 'API:a761ca71e0b3ddcf-01', raw_text: '', notes: '<p>CHAPTER_WRITING.</p>' });
    const commentary = database.createLocalEntity('Annotation', { book: 'John', chapter_number: 20, version: 'API:a761ca71e0b3ddcf-01', start_verse: 23, end_verse: 23, start_token_index: 0, end_token_index: 1, selected_text: 'Anchor text.', content: '<p>ORIGINAL_COMMENTARY.</p>' });
    const link = `/Study?q=John%2020%3A23&annotation_id=${commentary.id}&version=API%3Aa761ca71e0b3ddcf-01`;
    const note = database.createLocalEntity('MindNote', { title: 'Export book', content: Array.from({ length: 12 }, (_, i) => `<!--bex-page-title:Page%20${i + 1}--><details><summary>Heading ${i + 1}</summary><div data-type="detailsContent"><p>EVERY_PAGE_${i + 1}_END.</p>${i === 9 ? `<p><a href="${link}">Commentary</a></p>` : ''}</div></details>`).join('<!--bex-page-break-->') });
    const web = database.createLocalEntity('KnowledgeWeb', { title: 'Export web' });
    const a = database.createLocalEntity('WebCard', { web_id: web.id, title: 'A', description: '<p>CARD_A_WRITING.</p>' });
    const b = database.createLocalEntity('WebCard', { web_id: web.id, title: 'B', description: '<p>CARD_B_WRITING.</p>' });
    database.createLocalEntity('WebConnection', { web_id: web.id, from_card_id: a.id, to_card_id: b.id, has_arrow: true, label: 'questions' });
    database.createLocalEntity('CanvasObject', { web_id: web.id, object_type: 'text', content: '<p>CANVAS_OBJECT_WRITING.</p>' });
    const timeline = database.createLocalEntity('Timegraph', { title: 'Export chronology', events: [{ id: 'early', title: 'Early event', color: 'violet', marker: 'dot', align: 'center', position: 'above', scale: 1, start: { year: 0, precision: 'approximate' }, end: { year: 1, precision: 'year' }, description: '<p>TIMELINE_DESCRIPTION.</p>', links: [{ kind: 'note', id: String(note.id) }, { kind: 'study-chapter', id: String(chapter.id) }] }] });
    database.createLocalEntity('CanvasObject', { web_id: web.id, object_type: 'timegraph', timegraph_id: timeline.id });
    const point = database.createLocalEntity('CanvasObject', { web_id: web.id, object_type: 'point', title: 'ROUTING_POINT' });
    const pointCard = database.createLocalEntity('WebCard', { web_id: web.id, title: 'NUMERIC_ID_OVERLAP', description: '<pre><code>Literal &lt;p&gt;\n\n\nCODE_CONTENT_END</code></pre>' });
    assert.equal(point.id, pointCard.id);
    database.createLocalEntity('WebConnection', { web_id: web.id, from_card_id: pointCard.id, from_kind: 'card', to_card_id: point.id, to_kind: 'point', has_arrow: true, label: 'Typed routing' });
    for (let i = 1; i <= 1002; i++) database.createLocalEntity('Keyword', { title: `Keyword ${i}`, category: 'Fixture', explanation: `<p>KEYWORD_${i}_COMPLETE.</p>` });
    const writingBefore = database.getLocalEntity('MindNote', note.id).content;
    const snapshot = database.readLocalEntitySnapshot(['MindNote', 'StudyChapter', 'Keyword']);
    assert.equal(snapshot.Keyword.length, 1002);
    assert.equal(snapshot.StudyChapter[0].raw_text, '');
    assert.equal(snapshot.MindNote[0].content, writingBefore);
    assert.throws(() => database.readLocalEntitySnapshot(['MindNote', 'MindNote']), /snapshot/);
    assert.throws(() => database.readLocalEntitySnapshot(['NotACollection']), /record/);
    database.lockPrivacyVault();
    assert.throws(() => database.readLocalEntitySnapshot(['MindNote']), /Unlock|locked/i);
    database.unlockPrivacyAutomatically();
    server = http.createServer((request, reply) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/fixture-bootstrap') {
        const session = { tabs: [{ id: 'export-proof', kind: 'home', path: '/LibraryHome', title: 'Export proof' }], activeId: 'export-proof' };
        reply.writeHead(200, { 'Content-Type': 'text/html' });
        reply.end(`<script>localStorage.setItem('bex_workspace_tabs_v1', ${JSON.stringify(JSON.stringify(session))}); location.replace('/LibraryHome');</script>`); return;
      }
      let file = path.resolve(root, 'dist', '.' + url.pathname);
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { reply.writeHead(403); reply.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'dist/index.html');
      reply.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(reply);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    const guarded = new Map();
    require('../desktop/local-entity-ipc.cjs').registerLocalEntityHandlers({ ...database, appUrl, ipcMain: { removeHandler: channel => guarded.delete(channel), handle: (channel, handler) => guarded.set(channel, handler) } });
    const rejected = await guarded.get('local-entity:snapshot')({ senderFrame: { url: 'https://untrusted.example/' } }, ['MindNote']);
    assert.equal(rejected.code, 'BEX_UNTRUSTED_SENDER');
    assert.equal(rejected.snapshot, undefined);
    const trusted = await guarded.get('local-entity:snapshot')({ senderFrame: { url: appUrl + '/LibraryHome' } }, ['MindNote', 'Keyword']);
    assert.equal(trusted.ok, true);
    assert.equal(trusted.snapshot.Keyword.length, 1002);
    require('../desktop/local-entity-ipc.cjs').registerLocalEntityHandlers({ ...database, appUrl, ipcMain });
    require('../desktop/local-owner-ipc.cjs').registerLocalOwnerHandlers({ ...database, appUrl, ipcMain });
    let cancel = false, fail = false, written = 0;
    const output = path.join(temp, 'all-ideas.md');
    require('../desktop/export-file-ipc.cjs').registerExportFileHandlers({ appUrl, ipcMain,
      showSaveDialog: async () => cancel ? { canceled: true } : { canceled: false, filePath: output },
      writeFile: async (file, bytes) => { if (fail) throw new Error('Synthetic disk failure'); await fs.promises.writeFile(file, bytes); written += 1; },
    });
    window = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, webPreferences: { preload: path.join(root, 'desktop/annotation-gutter-proof-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const run = code => window.webContents.executeJavaScript(code);
    const until = async code => { for (let i = 0; i < 180; i++) { if (await run(code)) return; await wait(60); } throw new Error(`Timed out: ${code}; ${await run('document.body.innerText.slice(-1200)')}`); };
    await window.loadURL(`${appUrl}/fixture-bootstrap`);
    await until('!!document.querySelector("[data-testid=library-ai-export-button]")');
    assert.equal(await run('document.body.innerText.includes("Mass Backup")'), false);
    await run('document.querySelector("[data-testid=library-ai-export-button]").click()');
    await until('!!document.querySelector("[data-testid=ai-export-save]:not([disabled])")');
    await run('document.querySelector("[data-testid=ai-export-save]").click()');
    await until('document.body.innerText.includes("Your AI export is saved.")');
    const text = fs.readFileSync(output, 'utf8');
    for (let i = 1; i <= 12; i++) assert.ok(text.includes(`EVERY_PAGE_${i}_END.`));
    for (const marker of ['KEYWORD_1002_COMPLETE.', 'ORIGINAL_COMMENTARY.', 'CARD_A_WRITING.', 'CARD_B_WRITING.', 'CANVAS_OBJECT_WRITING.', 'TIMELINE_DESCRIPTION.', 'CHAPTER_WRITING.', `Source ID: commentary:${commentary.id}`, 'c. 1 BCE', 'questions', 'API:a761ca71e0b3ddcf-01', 'keyword:1002']) assert.ok(text.includes(marker), marker);
    assert.ok(text.includes('hyperlink')); assert.ok(text.includes('timeline note link'));
    assert.ok(text.includes('embedded timeline'));
    assert.ok(text.includes(`C${pointCard.id}["NUMERIC_ID_OVERLAP"]`) && text.includes(`O${point.id}(("ROUTING_POINT"))`));
    assert.ok(text.includes('Literal <p>\n\n\nCODE_CONTENT_END'));
    assert.ok(!text.includes('BEREAN_KNOWLEDGE_WEB:BEGIN') && !text.includes('enc_payload'));
    assert.equal(database.getLocalEntity('MindNote', note.id).content, writingBefore);
    assert.equal(written, 1);
    console.log('PASS: actual Home AI Export saves one readable .md through guarded native IPC, including all 12 pages, 1002 keywords, commentary edition/ID links, timelines, and web relationships; writing is untouched');
    cancel = true;
    await run('document.querySelector("[data-testid=ai-export-save]").click()');
    await until('document.body.innerText.includes("Save canceled. No file was written.")');
    assert.equal(written, 1);
    cancel = false; fail = true;
    await run('document.querySelector("[data-testid=ai-export-save]").click()');
    await until('document.body.innerText.includes("Synthetic disk failure")');
    assert.equal(await run('document.body.innerText.includes("Your AI export is saved.")'), false);
    assert.equal(written, 1);
    console.log('PASS: native cancel and write failures never report a saved file; all synthetic data remains intact');
    console.log(`Export fixture: ${output}`);
    app.exit(0);
  } catch (error) { console.error(error.stack || error); app.exit(1); }
  finally { window?.destroy(); server?.close(); database.closeDatabase(); }
});
