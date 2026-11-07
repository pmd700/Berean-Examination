'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-spreadsheet-proof-'));
    try {
      await require('esbuild').build({ entryPoints: [path.join(root, 'tests/fixtures/spreadsheet.jsx')], outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', alias: { '@/api/desktopClient': path.join(root, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(root, 'src'), '@shared': path.join(root, 'shared') }, loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });
      const styles = fs.readdirSync(path.join(root, 'dist/assets')).filter(f => f.endsWith('.css')).map(f => `<link rel="stylesheet" href="file://${path.join(root, 'dist/assets', f)}">`).join('');
      fs.writeFileSync(path.join(temp, 'index.html'), `<!doctype html><html class="dark"><head>${styles}<link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}body{background:#101620;color:#eee}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); if (result.error) console.error(result.error);
      process.exitCode = result.status === 0 ? 0 : 1;
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron'), temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1400, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const externalRequests = [];
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => { externalRequests.push(request.url); callback({ cancel: true }); });
    const js = code => win.webContents.executeJavaScript(code), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async code => { for (let i = 0; i < 180; i++) { if (await js(code)) return; await pause(25); } throw Error('Timed out: ' + code); };
    const center = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    const click = async (selector, count = 1) => { const { x, y } = await center(selector); win.webContents.sendInputEvent({ type: 'mouseMove', x, y }); win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: count }); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: count }); await pause(60); };
    const key = async keyCode => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(60); };
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      await until(`!!document.querySelector('[data-sheet-cell="A3"]')`);
      await click('[data-sheet-cell="A3"]', 2);
      await until(`!!document.querySelector('textarea[aria-label="Edit A3"]')`);
      await win.webContents.insertText('7'); await key('Enter');
      await until(`sheetProof.record().workbook.sheets[0].cells.A3?.v===7`);
      await click('[data-sheet-cell="B3"]', 2);
      await until(`!!document.querySelector('textarea[aria-label="Edit B3"]')`);
      await win.webContents.insertText('=A3*2'); await key('Enter');
      await until(`document.querySelector('[data-sheet-cell="B3"]')?.textContent==='14'`);
      console.log('PASS: native pointer editing and keyboard Enter commit values and recalculate a dependent formula.');
      await click('[data-sheet-cell="E3"]');
      await key('h');
      await until(`!!document.querySelector('textarea[aria-label="Edit E3"]')`);
      for (const letter of ['e', 'l', 'l', 'o']) {
        win.webContents.sendInputEvent({ type: 'char', keyCode: letter });
        await pause(20);
      }
      assert.equal(await js(`document.querySelector('textarea[aria-label="Edit E3"]').value`), 'hello', 'Sequential typing must append after the initial character.');
      assert.equal(await js(`document.querySelector('textarea[aria-label="Edit E3"]').selectionStart`), 5, 'The typing caret must stay at the end.');
      await key('Enter');
      await until(`sheetProof.record().workbook.sheets[0].cells.E3?.v==='hello'`);
      console.log('PASS: native sequential h/e/l/l/o typing produces hello with the caret at the end.');
      const handle = await center('[aria-label="Resize column A"]');
      win.webContents.sendInputEvent({ type: 'mouseMove', ...handle });
      win.webContents.sendInputEvent({ type: 'mouseDown', ...handle, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: handle.x + 60, y: handle.y });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: handle.x + 60, y: handle.y, button: 'left', clickCount: 1 });
      await until(`sheetProof.record().workbook.sheets[0].columnWidths[0]===360`);
      console.log('PASS: native pointer resizing changes column A independently to 360px.');
      await click('[data-sheet-cell="E3"]');
      await click('[aria-label="Bold"]');
      const edge = await center('.sheet-move-edge[data-edge="top"]'), destination = await center('[data-sheet-cell="F5"]');
      win.webContents.sendInputEvent({ type: 'mouseMove', ...edge });
      win.webContents.sendInputEvent({ type: 'mouseDown', ...edge, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseMove', ...destination });
      await until(`!!document.querySelector('[data-testid="sheet-move-ghost"]')`);
      const ghostStyle = await js(`(()=>{const s=getComputedStyle(document.querySelector('[data-testid="sheet-move-ghost"]'));return{opacity:s.opacity,background:s.backgroundColor}})()`);
      assert.equal(ghostStyle.opacity, '1'); assert.notEqual(ghostStyle.background, 'rgba(0, 0, 0, 0)');
      fs.writeFileSync('/private/tmp/bex-spreadsheet-ghost.png', (await win.webContents.capturePage()).toPNG());
      win.webContents.sendInputEvent({ type: 'mouseUp', ...destination, button: 'left', clickCount: 1 });
      await until(`sheetProof.record().workbook.sheets[0].cells.F5?.v==='hello'&&!sheetProof.record().workbook.sheets[0].cells.E3`);
      assert.equal(await js(`sheetProof.record().workbook.sheets[0].cells.F5.style.bold`), true);
      await click('[aria-label="Undo"]');
      await until(`sheetProof.record().workbook.sheets[0].cells.E3?.v==='hello'&&!sheetProof.record().workbook.sheets[0].cells.F5`);
      console.log('PASS: native selected-edge drag shows an opaque moving ghost, moves the cell and supports Undo.');
      await click('[data-sheet-cell="D8"]');
      const displayMetrics = () => js(`(()=>{const cell=document.querySelector('[data-sheet-cell="D8"]'),span=cell.querySelector('span'),style=getComputedStyle(span);return{mode:cell.dataset.textMode,width:cell.getBoundingClientRect().width,textWidth:span.getBoundingClientRect().width,textHeight:span.getBoundingClientRect().height,overflow:getComputedStyle(cell).overflow,whiteSpace:style.whiteSpace}})()`);
      const overflow = await displayMetrics();
      assert.equal(overflow.mode, 'overflow'); assert.equal(overflow.overflow, 'visible'); assert.ok(overflow.textWidth > overflow.width + 200);
      await js(`(()=>{const select=document.querySelector('[aria-label="Text display"]');select.value='clip';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await until(`document.querySelector('[data-sheet-cell="D8"]').dataset.textMode==='clip'`);
      const clip = await displayMetrics(); assert.equal(clip.overflow, 'hidden'); assert.ok(clip.textWidth < clip.width);
      await js(`(()=>{const select=document.querySelector('[aria-label="Text display"]');select.value='wrap';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await until(`document.querySelector('[data-sheet-cell="D8"]').dataset.textMode==='wrap'`);
      const wrap = await displayMetrics(); assert.equal(wrap.whiteSpace, 'pre-wrap'); assert.ok(wrap.textHeight > clip.textHeight);
      console.log('PASS: native text layout distinguishes overflow beyond the cell, clipped width and multiple wrapped lines.');
      await click('[aria-label="Freeze rows and columns"]');
      for (const label of ['Frozen rows', 'Frozen columns']) {
        await js(`document.querySelector('[aria-label="${label}"]').focus();document.querySelector('[aria-label="${label}"]').select()`);
        await win.webContents.insertText('1');
      }
      await click('[aria-label="Close dialog"]');
      const scrollIssues = await js(`(async()=>{const grid=document.querySelector('.sheet-scroll'),issues=[];for(let i=1;i<=12;i++){grid.scrollTop=i*84;grid.scrollLeft=i*9;await new Promise(requestAnimationFrame);const g=grid.getBoundingClientRect(),column=document.querySelector('.sheet-col-header')?.getBoundingClientRect(),row=document.querySelector('.sheet-row-header')?.getBoundingClientRect(),frozen=document.querySelector('[data-sheet-cell="A1"]')?.getBoundingClientRect();if(!column||Math.abs(column.top-g.top)>1.5)issues.push({i,kind:'column',top:column?.top,grid:g.top});if(!row||Math.abs(row.left-g.left)>1.5)issues.push({i,kind:'row',left:row?.left,grid:g.left});if(!frozen||Math.abs(frozen.top-g.top-30)>1.5||Math.abs(frozen.left-g.left-48)>1.5)issues.push({i,kind:'frozen',top:frozen?.top,left:frozen?.left,gridTop:g.top,gridLeft:g.left});}grid.scrollTop=0;grid.scrollLeft=0;await new Promise(requestAnimationFrame);return issues})()`);
      assert.deepEqual(scrollIssues, [], 'Headers and frozen cells must remain anchored through rapid scroll frames.');
      console.log('PASS: native frames keep column/row headers and frozen A1 anchored during rapid two-axis scrolling.');
      await js(`document.querySelector('[aria-label="Go to cell"]').focus();document.querySelector('[aria-label="Go to cell"]').select()`);
      await win.webContents.insertText('A1024'); await key('Enter');
      await until(`document.querySelector('[data-sheet-cell="A1024"]')?.textContent==='SYNTHETIC-SOURCE-1024'`);
      assert.equal(await js(`document.querySelector('[data-sheet-cell="C1024"]').textContent`), '2048');
      assert.ok(await js(`document.querySelectorAll('[data-sheet-cell]').length<1000`));
      console.log('PASS: go-to navigation reveals row 1024 with correct values while the grid remains virtualized.');
      const roundTrip = await js(`sheetProof.roundTrip()`);
      if (roundTrip.error) { fs.writeFileSync('/private/tmp/bex-spreadsheet-invalid.xml', roundTrip.xml); throw Error(`${roundTrip.errorFile}: ${roundTrip.error}`); }
      assert.equal(roundTrip.a3.v, 7); assert.equal(roundTrip.b3.f, 'A3*2'); assert.equal(roundTrip.row1024.f, 'B1024*2');
      console.log(`PASS: real Chromium XML/ZIP Excel export/import retains typed values and row1024 formulas (${roundTrip.bytes} bytes).`);
      await js(`document.querySelector('[aria-label="Go to cell"]').focus();document.querySelector('[aria-label="Go to cell"]').select()`);
      await win.webContents.insertText('A1'); await key('Enter'); await pause(120);
      await click('[aria-label="Save spreadsheet now"]'); await until(`sheetProof.saves()>0`);
      const capture = await win.webContents.capturePage(); fs.writeFileSync('/private/tmp/bex-spreadsheet-proof.png', capture.toPNG());
      assert.deepEqual(externalRequests, [], 'Spreadsheet proof must remain offline.');
      console.log('PASS: saved screenshot /private/tmp/bex-spreadsheet-proof.png; no personal Vault or network access used.');
      win.destroy(); app.exit(0);
    } catch (error) { console.error(error); const capture = await win.webContents.capturePage(); fs.writeFileSync('/private/tmp/bex-spreadsheet-proof.png', capture.toPNG()); win.destroy(); app.exit(1); }
  });
}
