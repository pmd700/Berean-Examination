'use strict';

// Real Electron, real editor, and a disposable encrypted Library only.
// Its production renderer fixture exists only in this proof's private server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const { jsPDF } = require('jspdf');

const projectRoot = path.resolve(__dirname, '..');
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-attachment-proof-'));
const libraryPath = path.join(proofRoot, 'Disposable Berean Library');
const fixturePath = path.join(proofRoot, 'Source fixtures');
const runnerPath = path.join(projectRoot, 'desktop', 'local-attachment-proof-runner.cjs');
const privateMarker = 'DISPOSABLE-ATTACHMENT-PRIVATE-MARKER';

for (const folder of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) {
  fs.mkdirSync(path.join(libraryPath, folder), { recursive: true });
}
fs.mkdirSync(fixturePath);

function createFixtures() {
  const names = {
    pdf: 'DISPOSABLE-private-document.pdf',
    audio: 'DISPOSABLE-private-audio.wav',
    video: 'DISPOSABLE-private-video.webm',
    other: 'DISPOSABLE-private-other.txt',
    image: 'DISPOSABLE-private-screenshot.png',
  };
  const pdf = new jsPDF();
  pdf.text(`${privateMarker}: first page`, 20, 30);
  pdf.addPage();
  pdf.text(`${privateMarker}: second page`, 20, 30);
  fs.writeFileSync(path.join(fixturePath, names.pdf), Buffer.from(pdf.output('arraybuffer')));

  // A short uncompressed mono WAV is valid in Chromium without optional codecs.
  const sampleRate = 8000;
  const samples = sampleRate * 3;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) wav.writeInt16LE(Math.sin(i * 440 * 2 * Math.PI / sampleRate) * 4000, 44 + i * 2);
  fs.writeFileSync(path.join(fixturePath, names.audio), wav);
  const video = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=12',
    '-t', '3', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-an', path.join(fixturePath, names.video),
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(video.status, 0, `FFmpeg must generate the disposable video fixture: ${video.stderr || video.error || ''}`);
  const other = Buffer.alloc(2 * 1024 * 1024 + 97, 0x61);
  other.write(privateMarker, 0); other.write(privateMarker, 1024 * 1024 - 8);
  fs.writeFileSync(path.join(fixturePath, names.other), other);
  fs.writeFileSync(path.join(fixturePath, names.image), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64',
  ));
  fs.writeFileSync(path.join(proofRoot, 'fixtures.json'), JSON.stringify({ names, privateMarker }));
}

function rendererFixture() {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import '@/index.css';
import '@/components/logic/logic-renderer.css';
let editor;
let pendingSave = Promise.resolve();
let saveError = null;
function Fixture() {
  const [note, setNote] = React.useState(null);
  const current = React.useRef(null);
  React.useEffect(() => {
    console.log('PROOF renderer requesting note');
    window.bexDesktop.listLocalEntities('MindNote', {}).then(result => {
      console.log('PROOF renderer received note', result.ok);
      if (!result.ok) throw new Error(result.error);
      current.current = result.records[0];
      setNote(current.current);
    }).catch(error => { saveError = error.message; });
  }, []);
  const save = content => {
    pendingSave = pendingSave.then(async () => {
      const response = await window.bexDesktop.updateLocalEntity('MindNote', current.current.id, {content});
      if (!response.ok) throw new Error(response.error);
    }).catch(error => { saveError = error.message; });
  };
  return <MemoryRouter><div style={{maxWidth:900,margin:'40px auto',padding:24}}>
    <h1 style={{fontSize:18,marginBottom:20}}>Disposable attachment proof</h1>
    {note && <TEXT_EDITOR_MACHINERY bare noteAnnotations content={note.content || '<p></p>'}
      onChange={save} onEditorReady={instance => { console.log('PROOF editor ready'); editor = instance; }} />}
  </div></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
window.attachmentProof = {
  ready: () => Boolean(editor),
  focusEnd: () => editor.commands.focus('end'),
  html: () => editor.getHTML(),
  snapshot: () => ({html: editor?.getHTML(), json:editor?.getJSON(), text:document.body.innerText, saveError}),
  saved: async () => { await pendingSave; if (saveError) throw new Error(saveError); return true; },
};
`;
}

async function runPhase(phase, appUrl) {
  const env = { ...process.env, BEX_ATTACHMENT_PROOF_URL: appUrl };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [runnerPath, phase, proofRoot], {
      cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Attachment proof ${phase} timed out.\n${stdout}\n${stderr}`)); }, 180000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; if (process.env.BEX_ATTACHMENT_PROOF_DEBUG === '1') process.stderr.write(chunk); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout);
      const marker = stdout.split(/\r?\n/).find(line => line.startsWith('BEX_ATTACHMENT_PROOF '));
      if (code !== 0 || !marker) {
        reject(new Error(`Attachment proof ${phase} failed (${code}).\n${stdout}\n${stderr}`)); return;
      }
      const result = JSON.parse(marker.slice('BEX_ATTACHMENT_PROOF '.length));
      for (const check of result.checks) process.stdout.write(`PASS: ${check}\n`);
      resolve(result);
    });
  });
}

async function main() {
  let server;
  let failed = true;
  try {
    createFixtures();
    const outputFolder = path.join(proofRoot, 'renderer');
    await require('esbuild').build({
      stdin: { contents: rendererFixture(), sourcefile: 'fixture.jsx', loader: 'jsx', resolveDir: projectRoot },
      outdir: outputFolder, entryNames: 'fixture', bundle: true, format: 'esm', splitting: true,
      platform: 'browser', jsx: 'automatic', logLevel: 'warning',
      alias: { '@': path.join(projectRoot, 'src') },
      loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"BASE_URL":"/"}' },
      plugins: [{ name: 'fixture-pdf-worker', setup(build) {
        build.onLoad({ filter: /PdfAttachmentDocument\.jsx$/ }, async args => ({
          contents: fs.readFileSync(args.path, 'utf8').replace(
            "new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()", "'/pdf.worker.min.mjs'",
          ), loader: 'jsx', resolveDir: path.dirname(args.path),
        }));
      } }],
    });
    const bundledCss = path.join(outputFolder, 'fixture.css');
    const css = await require('postcss')([
      require('tailwindcss')({ config: path.join(projectRoot, 'tailwind.config.js') }),
      require('autoprefixer')(),
    ]).process(fs.readFileSync(bundledCss, 'utf8'), { from: bundledCss });
    fs.writeFileSync(bundledCss, css.css);
    const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    fs.copyFileSync(path.join(pdfRoot, 'build/pdf.worker.min.mjs'), path.join(outputFolder, 'pdf.worker.min.mjs'));
    for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
      fs.cpSync(path.join(pdfRoot, folder), path.join(outputFolder, 'pdf-assets', folder), { recursive: true });
    }
    fs.writeFileSync(path.join(outputFolder, '__attachment_proof.html'), '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{min-height:100%;margin:0;background:#10121b;color:#eee}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
    const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.png': 'image/png' };
    server = http.createServer((request, response) => {
      const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const filePath = path.resolve(outputFolder, `.${relative}`);
      if (!filePath.startsWith(`${outputFolder}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        response.writeHead(404); response.end(); return;
      }
      response.setHeader('Content-Type', types[path.extname(filePath)] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(response);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    const appUrl = `http://127.0.0.1:${address.port}`;
    const created = await runPhase('create', appUrl);
    const reopened = await runPhase('reopen', appUrl);
    process.stdout.write(`PASS: ${created.checks.length + reopened.checks.length} attachment checks across two real Electron launches\n`);
    failed = false;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (failed || process.env.BEX_KEEP_ATTACHMENT_PROOF === '1') {
      process.stdout.write(`PROOF ARTIFACTS: ${proofRoot}\n`);
    } else {
      fs.rmSync(proofRoot, { recursive: true, force: true });
      process.stdout.write('PASS: disposable Library and temporary decrypted copies removed\n');
    }
  }
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
