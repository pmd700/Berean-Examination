// Real Chromium layout is required: jsdom cannot model focus-induced scrolling.
// This fixture uses sample cards and an isolated profile, never the user's library.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
    (async () => {
        const output = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-zoom-proof-'));
        const source = fs.readFileSync(path.join(project, 'src/pages/KnowledgeWeb.jsx'), 'utf8');
        const viewportClass = source.match(/\{\/\* Canvas \*\/\}\s*<div\s+className="([^"]+)"/)?.[1];
        assert.ok(viewportClass, 'Use the exact viewport classes from the app, not a reimplementation');
        await require('esbuild').build({ entryPoints: [path.join(project, 'tests/fixtures/zoomControls.jsx')], outfile: path.join(output, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"', VIEWPORT_CLASS: JSON.stringify(viewportClass) } });
        const css = await require('postcss')([require('tailwindcss')({ content: [path.join(project, 'src/**/*.{js,jsx}'), path.join(project, 'tests/fixtures/zoomControls.jsx')], corePlugins: { preflight: true } })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });
        fs.writeFileSync(path.join(output, 'fixture.css'), css.css + '\n.bex-tab-pane .h-screen{height:100%}body{margin:0}');
        fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = require('node:child_process').spawnSync(require('electron'), [__filename, output, ...process.argv.slice(2)], { env, encoding: 'utf8', timeout: 45000 });
        process.stdout.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        if (result.error)
            console.error(result.error);
        process.exitCode = result.status === 0 ? 0 : 1;
    })().catch(e => { console.error(e); process.exitCode = 1; });
}
else {
    const { app, BrowserWindow } = require('electron');
    const output = process.argv[2];
    app.setPath('userData', path.join(output, 'user-data'));
    app.whenReady().then(async () => {
        const win = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        const js = s => win.webContents.executeJavaScript(s), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        const snapshot = () => js('zoomProof.snapshot()');
        const assertAnchored = async () => {
            const s = await snapshot();
            assert.ok(Math.abs(s.dx - 24) < 1 && Math.abs(s.dy - 24) < 1, JSON.stringify(s));
            assert.equal(s.scrollX, 0);
            assert.equal(s.scrollY, 0);
            assert.equal(s.ancestorX, 0);
            assert.equal(s.ancestorY, 0);
        };
        try {
            await win.loadFile(path.join(output, 'index.html'));
            await pause(150);
            await assertAnchored();
            await js('zoomProof.focusDistant()');
            await pause(150);
            if (process.argv.includes('--expect-bug')) {
                const state = await snapshot();
                console.log('BEFORE FIX: ' + JSON.stringify(state));
                assert.ok(state.scrollX > 0 || state.scrollY > 0, 'Must reproduce hidden browser scrolling before claiming a fix');
                fs.writeFileSync(path.join(output, 'before.png'), (await win.webContents.capturePage()).toPNG());
                console.log('SCREENSHOT: ' + path.join(output, 'before.png'));
                win.destroy();
                app.exit(0);
                return;
            }
            await assertAnchored();
            await js('zoomProof.scrollDistant()');
            await pause(100);
            await assertAnchored();
            console.log('PASS focus and scrollIntoView on a distant card cannot displace the controls');
            for (const [x, y, z] of [[-1800, -1200, 1.3], [2200, 1800, 5], [-700, 850, .1]]) {
                await js(`zoomProof.canvas.setPan({x:${x},y:${y}});zoomProof.canvas.setZoom(${z})`);
                await pause(120);
                await assertAnchored();
            }
            await js('zoomProof.canvas.setPan({x:0,y:0});zoomProof.canvas.setZoom(1)');
            await pause(100);
            await js('document.querySelector("[data-testid=button-zoom-in]").click()');
            await pause(350);
            assert.equal((await snapshot()).zoom, 1.3);
            await assertAnchored();
            await js('document.querySelector("[data-testid=button-zoom-out]").click()');
            await pause(350);
            assert.equal((await snapshot()).zoom, 1);
            await assertAnchored();
            await js('zoomProof.canvas.setZoom(2)');
            await pause(80);
            await js('document.querySelector("[data-testid=button-zoom-reset]").click()');
            await pause(350);
            assert.equal((await snapshot()).zoom, 1);
            await assertAnchored();
            console.log('PASS pan, zoom limits and real animated + / - / reset preserve bottom-right anchoring');
            win.setSize(840, 600);
            await pause(150);
            await assertAnchored();
            await js('zoomProof.setSidebar(true)');
            await pause(150);
            await assertAnchored();
            await js('zoomProof.setHidden(true)');
            await pause(50);
            await js('zoomProof.setHidden(false)');
            await pause(150);
            await assertAnchored();
            await js('zoomProof.setSidebar(false)');
            await pause(150);
            await assertAnchored();
            console.log('PASS resize, inspector opening/closing and hiding/reopening a tab');
            fs.writeFileSync(path.join(output, 'after.png'), (await win.webContents.capturePage()).toPNG());
            console.log('SCREENSHOT: ' + path.join(output, 'after.png'));
            win.destroy();
            app.exit(0);
        }
        catch (e) {
            console.error(e);
            win.destroy();
            app.exit(1);
        }
    });
}
